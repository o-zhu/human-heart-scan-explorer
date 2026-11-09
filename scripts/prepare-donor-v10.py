#!/usr/bin/env python3
"""Prepare independently configured HOA donors without a full fine uint16 array.

Source uint16 chunks are verified, decoded in their declared axis/byte order,
windowed once for display, and encoded losslessly. Metadata-based voxel-center
registration and zero padding preserve every declared fine source voxel. No
chamber labels, anatomy, or tissue detail is synthesized by this pipeline.
"""
from __future__ import annotations
import argparse
import concurrent.futures as futures
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import struct
import time
import urllib.error
import urllib.request

try:
    import httpx
except ImportError:
    httpx = None

import blosc2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

PROJECT = Path(__file__).resolve().parents[1]
SHA = lambda b: hashlib.sha256(b).hexdigest()
# Public source chunks use a shared, thread-safe HTTP/1.1 pool. Reusing TLS
# connections avoids repeating the handshake for every 128^3 source block.
# Keep the standard-library path available for existing offline workflows.
SOURCE_HTTP = (httpx.Client(http2=False, follow_redirects=False,
    timeout=httpx.Timeout(60, connect=20),
    limits=httpx.Limits(max_connections=32, max_keepalive_connections=24))
    if httpx is not None else None)


def report(stage, **values):
    print(json.dumps(dict(stage=stage, **values)), flush=True)


def write_json(path, value, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.part')
    temporary.write_text(json.dumps(value, indent=None if compact else 2,
                                   separators=(',', ':') if compact else None,
                                   allow_nan=False) + '\n')
    temporary.replace(path)


def fetch(url, path, attempts=5):
    if path.exists():
        return path.read_bytes(), True
    for attempt in range(attempts):
        try:
            if SOURCE_HTTP is not None:
                response = SOURCE_HTTP.get(url)
                response.raise_for_status()
                payload = response.content
            else:
                with urllib.request.urlopen(url, timeout=60) as response:
                    payload = response.read()
            path.parent.mkdir(parents=True, exist_ok=True)
            temp = path.with_suffix(path.suffix + '.part')
            temp.write_bytes(payload); temp.replace(path)
            return payload, False
        except Exception as error:
            status = getattr(error, 'code', None) or getattr(getattr(error, 'response', None), 'status_code', None)
            if status == 404 or attempt + 1 == attempts:
                raise
        time.sleep(min(4, 2**attempt))


def decode_chunk(payload, kind, chunk_xyz):
    """Return ZYX uint16; N5 X-fast big-endian differs from Zarr Z-fast LE."""
    if kind == 'n5':
        if len(payload) < 16:
            raise ValueError('Truncated N5 header')
        mode, ndim = struct.unpack('>HH', payload[:4])
        if mode != 0 or ndim != 3:
            raise ValueError(f'Unsupported N5 header {mode}, {ndim}')
        dims = struct.unpack('>III', payload[4:16])
        if any(d <= 0 or d > c for d, c in zip(dims, chunk_xyz)):
            raise ValueError(f'Unexpected N5 block dimensions {dims}')
        raw = blosc2.decompress(payload[16:])
        if len(raw) != math.prod(dims) * 2:
            raise ValueError('N5 decoded length mismatch')
        array = np.frombuffer(raw, dtype='>u2').reshape(dims[::-1])
    elif kind == 'zarr':
        dims = tuple(chunk_xyz)
        raw = blosc2.decompress(payload)
        if len(raw) != math.prod(dims) * 2:
            raise ValueError('Zarr decoded length mismatch')
        array = np.frombuffer(raw, dtype='<u2').reshape(dims).transpose(2, 1, 0)
    else:
        raise ValueError(f'Unsupported source format {kind}')
    return array, SHA(raw)


def uint16_window_lut(window):
    """Exact linear uint16-to-uint8 quantization, nearest integer / ties to even.

    The small lookup table avoids both full-volume int64 temporaries and binary
    reciprocal errors at exact half steps. Source windows with nonintegral
    endpoints retain an explicit float64 fallback in encode_window.
    """
    if not np.array_equal(window, np.rint(window)):
        return None
    low, high = map(int, window)
    denominator = high-low
    numerator = np.clip(np.arange(65536, dtype=np.int64)-low, 0, denominator)*255
    whole, remainder = np.divmod(numerator, denominator)
    increment = (2*remainder > denominator) | ((2*remainder == denominator) & (whole % 2 == 1))
    return (whole+increment).astype(np.uint8)


class Source:
    def __init__(self, spec, cache, project):
        self.spec, self.cache, self.project = spec, cache, project
        self.slug, self.dataset = spec['slug'], spec['datasetId']
        self.kind, self.base = spec['source']['format'], spec['source']['baseUrl']
        self.levels = spec['source']['levels']
        self.fine_level, self.high_level = str(spec['source']['fineLevel']), str(spec['source']['highLevel'])
        self.assets = project/'public/assets/donors'/self.slug
        self.docs = project/'docs/donors'/self.slug
        for p in [cache, self.assets, self.docs]: p.mkdir(parents=True, exist_ok=True)
        self.window = np.array(spec['source']['window'], float)
        if self.window.shape != (2,) or self.window[1] <= self.window[0]:
            raise ValueError('Invalid display encoding window')
        self.window_lut = uint16_window_lut(self.window)
        self.attrs, self.transforms = {}, {}
        self.bootstrap()

    def bootstrap(self):
        provenance = Path(self.spec['metadataDirectory'])
        for name in ['source-metadata.json', 'source-neuroglancer.json']:
            target = self.cache/name
            if not target.exists():
                original = provenance/name
                if not original.exists(): original = self.docs/name
                if not original.exists(): raise FileNotFoundError(f'Missing provenance {name}')
                target.write_bytes(original.read_bytes())
            (self.docs/name).write_bytes(target.read_bytes())
        if self.kind == 'zarr':
            payload, _ = fetch(self.base+'.zattrs', self.cache/'source-root-attributes.json')
            root = json.loads(payload); multiscale = root['multiscales'][0]
            if [a['name'] for a in multiscale['axes']] != ['x', 'y', 'z']:
                raise ValueError('Source axes must be reviewed before conversion')
            if any(a.get('unit') not in ['micrometer', 'micrometre', 'um'] for a in multiscale['axes']):
                raise ValueError('Unsupported OME physical units')
            datasets = {d['path']: d for d in multiscale['datasets']}
        else:
            payload, _ = fetch(self.base+'attributes.json', self.cache/'source-root-attributes.json')
            root = json.loads(payload)
            if root['axes'] != ['x', 'y', 'z'] or root['units'] != ['um']*3:
                raise ValueError('N5 axes/units require review')
        for level, expected in self.levels.items():
            path = level+'/.zarray' if self.kind == 'zarr' else 's'+level+'/attributes.json'
            payload, _ = fetch(self.base+path, self.cache/f's{level}-attributes.json')
            a = json.loads(payload)
            dims = a['shape'] if self.kind == 'zarr' else a['dimensions']
            chunks = a['chunks'] if self.kind == 'zarr' else a['blockSize']
            if dims != expected['dimensionsXYZ'] or chunks != [128]*3:
                raise ValueError(f'Source dimensions changed: level {level}: {dims}')
            if self.kind == 'zarr':
                if a['dtype'] != '<u2' or a['order'] != 'C' or a.get('filters') or a['compressor']['id'] != 'blosc' or a.get('dimension_separator') != '/':
                    raise ValueError('Unsupported Zarr codec/layout')
                trans = datasets[level]['coordinateTransformations']
                scale = np.array(next(t['scale'] for t in trans if t['type'] == 'scale'), float)
                origin = np.array(next((t['translation'] for t in trans if t['type'] == 'translation'), [0]*3), float)
                convention = 'Explicit OME-Zarr scale and translation in micrometers, interpreted as source sample centers.'
            else:
                if a['dataType'] != 'uint16' or a['compression']['type'] != 'blosc':
                    raise ValueError('Unsupported N5 data type/codec')
                scale = np.array(root['resolution'], float)*np.array(root['downsamplingFactors'][int(level)], float)
                # The atlas links this N5 through Neuroglancer. Its N5 driver
                # applies root downsampling scales to a zero-offset cell grid;
                # density samples lie at cell centers (i + 0.5) * spacing.
                origin = scale/2
                convention = 'Neuroglancer N5 zero-offset cell grid: sample center=(index+0.5)*resolution*downsamplingFactor.'
            if not np.allclose(scale, [expected['voxelMicrons']]*3, rtol=0, atol=1e-8):
                raise ValueError('Source spacing differs from reviewed configuration')
            self.attrs[level] = dict(dimensions=np.array(dims), chunks=np.array(chunks), path=level if self.kind == 'zarr' else 's'+level)
            self.transforms[level] = dict(scale=scale, origin=origin, convention=convention)
            (self.docs/f's{level}-attributes.json').write_bytes(payload)
        (self.docs/'source-root-attributes.json').write_bytes((self.cache/'source-root-attributes.json').read_bytes())
        self.fine_spacing = float(self.transforms[self.fine_level]['scale'][0])
        self.high_spacing = float(self.transforms[self.high_level]['scale'][0])
        ratio = self.high_spacing/self.fine_spacing
        if abs(ratio-round(ratio)) > 1e-8:
            raise ValueError('Registered sections require integer source-level ratio')
        self.ratio = int(round(ratio))
        self.source_fine = self.attrs[self.fine_level]['dimensions']
        # Cover the entire source, padding up to ratio-1 zero columns instead
        # of deleting terminal tissue to obtain a shared integer sample grid.
        self.high_dims = np.ceil((self.source_fine-1)/self.ratio).astype(int)+1
        self.full = (self.high_dims-1)*self.ratio+1
        self.low_dims = np.ceil((self.high_dims-1)/2).astype(int)+1
        self.low_spacing = (self.full-1)*self.fine_spacing/(self.low_dims-1)
        self.high_shift = (self.transforms[self.fine_level]['origin']-self.transforms[self.high_level]['origin'])/self.transforms[self.high_level]['scale']
        self.extent_um = (self.full-1)*self.fine_spacing
        self.longest_mm = float(max(self.extent_um)/1000)
        write_json(self.docs/'pipeline-config.json', self.spec)
        geometry = dict(highDimensionsXYZ=self.high_dims.tolist(), lowDimensionsXYZ=self.low_dims.tolist(),
                        fullFineDimensionsXYZ=self.full.tolist(), sourceFineDimensionsXYZ=self.source_fine.tolist(),
                        highSpacingUm=self.high_spacing, lowSpacingUmXYZ=self.low_spacing.tolist(),
                        fineSpacingUm=self.fine_spacing, longestMm=self.longest_mm,
                        extent=(self.extent_um[[0,2,1]]/max(self.extent_um)).tolist(),
                        fineSourcePhysicalOriginUm=self.transforms[self.fine_level]['origin'].tolist(),
                        highOriginalSourceIndexShift=self.high_shift.tolist(),
                        paddingFineColumnsXYZ=(self.full-self.source_fine).tolist(),
                        worldMapping='Centered physical source coordinates [X,Z,-Y], normalized by longest physical center extent.',
                        sourceCenterConvention=self.transforms[self.fine_level]['convention'])
        write_json(self.cache/'browser-geometry.json', geometry)
        write_json(self.docs/'browser-geometry.json', geometry)

    def chunk(self, level, coordinate):
        a = self.attrs[level]; x,y,z = map(int, coordinate)
        url = self.base+a['path']+f'/{x}/{y}/{z}'
        target = self.cache/f'chunks-s{level}'/f'{x}_{y}_{z}.bin'
        payload, cached = fetch(url, target)
        array, decoded_sha = decode_chunk(payload, self.kind, a['chunks'])
        record = dict(coordinateXYZ=[x,y,z], url=url, bytes=len(payload), sha256=SHA(payload),
                      decodedSha256=decoded_sha, cached=cached)
        return array, record

    def encode_window(self, raw):
        if self.window_lut is not None and raw.dtype.kind == 'u' and raw.dtype.itemsize <= 2:
            return self.window_lut[raw]
        return np.rint(np.clip((raw.astype(np.float64)-self.window[0])/(self.window[1]-self.window[0]), 0, 1)*255).astype(np.uint8)


def download_high(source, workers):
    level = source.high_level; attrs = source.attrs[level]; dims, chunks = attrs['dimensions'], attrs['chunks']
    counts = np.ceil(dims/chunks).astype(int)
    jobs = [(x,y,z) for z in range(counts[2]) for y in range(counts[1]) for x in range(counts[0])]
    path = source.cache/'source-high-u16.npy'
    array = np.lib.format.open_memmap(path, mode='r+' if path.exists() else 'w+', dtype=np.uint16, shape=tuple(map(int,dims[::-1])))
    records = []; start = time.monotonic()
    def one(c):
        decoded, record = source.chunk(level, c)
        x,y,z = np.array(c)*chunks; sx,sy,sz = np.minimum(chunks, dims-np.array(c)*chunks)
        array[z:z+sz,y:y+sy,x:x+sx] = decoded[:sz,:sy,:sx]
        return record
    with futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for r in pool.map(one, jobs):
            records.append(r)
            if len(records)%16 == 0 or len(records) == len(jobs):
                report('download-high', donor=source.slug, completed=len(records), total=len(jobs), seconds=round(time.monotonic()-start,1))
    array.flush()
    write_json(source.cache/'high-download.json', dict(source=source.base, format=source.kind,
        dimensionsXYZ=dims.tolist(), records=records, compressedBytes=sum(r['bytes'] for r in records)))
    (source.docs/'source-high-chunks.json').write_bytes((source.cache/'high-download.json').read_bytes())
    sample=np.asarray(array[::2,::2,::2]); histogram=np.bincount(sample.ravel(), minlength=65536)
    write_json(source.cache/'high-intensity-review.json', dict(datasetId=source.dataset,
        sourceWindow=source.window.tolist(), sampleCount=int(sample.size),
        percentiles={str(p):float(np.percentile(sample,p)) for p in [0,1,5,10,25,50,75,90,95,99,99.9,100]},
        histogram65536=histogram.tolist()), True)
    make_review(array, source, 'source-high-review.jpg')
    report('download-ready', donor=source.slug, path=str(path), dimensionsXYZ=dims.tolist(), compressedBytes=sum(r['bytes'] for r in records))
    return array


def make_review(array, source, filename, support=None):
    panels=[]
    for axis in range(3):
        for frac in [.25,.5,.75]:
            index=round(frac*(array.shape[2-axis]-1))
            p=array[:,:,index] if axis==0 else array[:,index,:] if axis==1 else array[index]
            if p.dtype != np.uint8: p=source.encode_window(p)
            image=Image.fromarray(p).convert('RGB')
            image.thumbnail((360,360), Image.Resampling.LANCZOS)
            canvas=Image.new('RGB',(380,395),'#0b1217');canvas.paste(image,((380-image.width)//2,25+(360-image.height)//2))
            ImageDraw.Draw(canvas).text((12,7),f'{source.spec["specimen"]} {"XYZ"[axis]}={index}',fill='#e8e5dc')
            panels.append(canvas)
    sheet=Image.new('RGB',(3*380,3*395),'#0b1217')
    for i,p in enumerate(panels):sheet.paste(p,((i%3)*380,(i//3)*395))
    sheet.save(source.cache/filename,quality=92)
    sheet.save(source.docs/filename,quality=92)


def encode_volume(data, path, project, clean=False):
    """Select reversible byte prediction, retaining only the best candidate."""
    best=None; sizes={}; raw_sha=SHA(data.tobytes())
    for name in ['none','delta-x','delta-z']:
        if name=='none': predicted=data
        else:
            predicted=data.copy();axis=2 if name=='delta-x' else 0
            if axis==2: predicted[:,:,1:]=data[:,:,1:]-data[:,:,:-1]
            else: predicted[1:]=data[1:]-data[:-1]
        packed=gzip.compress(predicted.tobytes(),compresslevel=6,mtime=0);sizes[name]=len(packed)
        if best is None or len(packed)<len(best[1]):best=(name,packed)
        del predicted,packed
    name,packed=best; decoded=np.frombuffer(gzip.decompress(packed),np.uint8).reshape(data.shape)
    if name!='none':decoded=np.cumsum(decoded,axis=2 if name=='delta-x' else 0,dtype=np.uint8)
    assert np.array_equal(decoded,data), 'Display volume round trip failed'
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(packed)
    return dict(url=str(path.relative_to(project/'public')),bytes=len(packed),uncompressedBytes=int(data.size),
                sha256=SHA(packed),rawSha256=raw_sha,predictor=name,cleaned=clean,zRange=[0,len(data)]),sizes


def encode_volume_parts(data,path,project,clean=False):
    """Bound public assets below16MiB; reset each predictor at its own z range."""
    plane_bytes=int(data.shape[1]*data.shape[2])
    step=len(data) if data.nbytes<=15*1024**2 else min(64,max(1,(15*1024**2)//plane_bytes))
    jobs=[(i,z,min(len(data),z+step)) for i,z in enumerate(range(0,len(data),step))]
    def one(job):
        i,z0,z1=job
        target=path if len(jobs)==1 else path.with_name(path.name.replace('.raw.gz',f'-{i:02d}.raw.gz'))
        entry,sizes=encode_volume(data[z0:z1],target,project,clean)
        entry['zRange']=[z0,z1]
        if entry['bytes']>=16*1024**2:raise ValueError('Encoded volume part exceeds public asset budget')
        return entry,sizes
    with futures.ThreadPoolExecutor(max_workers=min(4,len(jobs))) as pool:results=list(pool.map(one,jobs))
    return [r[0] for r in results],[r[1] for r in results]


def support_indices(source, dims_xyz):
    return [np.floor(np.arange(n)/(n-1)*(source.low_dims[a]-1)+.5).astype(int) for a,n in enumerate(dims_xyz)]


def preview(source, workers):
    raw_path=source.cache/'source-high-u16.npy'
    raw=np.load(raw_path,mmap_mode='r') if raw_path.exists() else download_high(source,workers)
    threshold=source.spec['cleanup'].get('thresholdRaw')
    if threshold is None:
        raise ValueError('Review high-intensity-review.json/contact sheets and set cleanup.thresholdRaw before preview')
    high_raw=np.lib.format.open_memmap(source.cache/'display-high-raw-u16.npy',mode='w+',dtype=np.uint16,shape=tuple(map(int,source.high_dims[::-1])))
    coords=[np.arange(n,dtype=np.float32)+source.high_shift[a] for a,n in enumerate(source.high_dims)]
    gy,gx=np.meshgrid(coords[1],coords[0],indexing='ij')
    valid_x=np.arange(source.high_dims[0])*source.ratio<source.source_fine[0]
    valid_y=np.arange(source.high_dims[1])*source.ratio<source.source_fine[1]
    for z in range(source.high_dims[2]):
        values=ndi.map_coordinates(raw,[np.full(gx.shape,coords[2][z],np.float32),gy,gx],order=1,mode='nearest',prefilter=False,output=np.uint16)
        if z*source.ratio>=source.source_fine[2]:values[:]=0
        else:values[~(valid_y[:,None]&valid_x[None,:])]=0
        high_raw[z]=values
    high_raw.flush();high=source.encode_window(high_raw);np.save(source.cache/'display-high-u8.npy',high)
    foreground=np.asarray(high_raw>threshold)
    labels,number=ndi.label(foreground,structure=ndi.generate_binary_structure(3,2))
    sizes=np.bincount(labels.ravel());sizes[0]=0
    core_id=int(sizes.argmax())
    policy=source.spec['cleanup'].get('componentPolicy','largest')
    keep_ids={core_id}
    if policy=='major-components':
        fraction=float(source.spec['cleanup'].get('minimumComponentFraction',.01))
        keep_ids.update(map(int,np.flatnonzero(sizes>=max(32,int(sizes[core_id]*fraction)))))
    elif policy!='largest':raise ValueError(f'Unknown component policy {policy}')
    seed_records=[]
    for seed in source.spec['cleanup'].get('seedHighSourceXYZ',[]):
        p=np.rint(np.array(seed)-source.high_shift).astype(int)
        if np.any(p<0) or np.any(p>=source.high_dims):raise ValueError('Support seed outside registered source')
        label=int(labels[p[2],p[1],p[0]])
        if label==0:raise ValueError(f'Support seed is below reviewed threshold: {seed}')
        keep_ids.add(label);seed_records.append(dict(sourceXYZ=seed,registeredXYZ=p.tolist(),componentId=label,componentVoxels=int(sizes[label])))
    keep_ids.discard(0)
    core=np.isin(labels,list(keep_ids));roi_review=None
    roi=source.spec['cleanup'].get('reviewedHeartRoiHighSourceXYZ')
    if roi and source.spec['cleanup'].get('preserveAllForegroundInReviewedRoi',False):
        bounds=np.array(roi,float)
        lo=np.floor(bounds[:,0]-source.high_shift).astype(int).clip(0,source.high_dims-1)
        hi=np.ceil(bounds[:,1]-source.high_shift).astype(int).clip(0,source.high_dims-1)
        sl=(slice(lo[2],hi[2]+1),slice(lo[1],hi[1]+1),slice(lo[0],hi[0]+1))
        extra=int((foreground[sl]&~core[sl]).sum());core[sl]|=foreground[sl]
        roi_review=dict(sourceHighXYZ=roi,registeredInclusiveXYZ=np.stack([lo,hi],axis=1).tolist(),
                        thresholdVoxels=int(foreground[sl].sum()),additionalCoreVoxels=extra,
                        policy='Preserve all above-threshold source voxels in independently inspected cardiac ROI before conservative dilation.')
    core_count=int(core.sum())
    top=sorted(map(int,sizes[1:]),reverse=True)[:12];del labels,sizes
    if not core_count:raise ValueError('No connected tissue core at reviewed threshold')
    margin=int(source.spec['cleanup'].get('marginHighVoxels',3))
    support=ndi.binary_dilation(core,structure=ndi.generate_binary_structure(3,1),iterations=margin)
    support=ndi.maximum_filter(support,size=3,mode='constant')
    sample_ix=[np.floor(np.linspace(0,source.high_dims[a]-1,source.low_dims[a])+.5).astype(int) for a in range(3)]
    compact=support[np.ix_(sample_ix[2],sample_ix[1],sample_ix[0])].astype(np.uint8)*255
    ix=support_indices(source,source.high_dims);represented=compact[np.ix_(ix[2],ix[1],ix[0])]>0
    retained=int((core&represented).sum())
    if retained!=core_count:raise ValueError(f'Compact support loses {core_count-retained} core voxels')
    np.save(source.cache/'support-low-u8.npy',compact)
    support_bytes=compact.tobytes();encoded=gzip.compress(support_bytes,compresslevel=9,mtime=0)
    target=source.assets/'cleanup/heart-support.raw.gz';target.parent.mkdir(exist_ok=True);target.write_bytes(encoded)
    cleanup=dict(schemaVersion=1,specimen=source.spec['specimen'],datasetId=source.dataset,
        dimensions=source.low_dims.tolist(),volumeUrl=f'assets/donors/{source.slug}/cleanup/heart-support.raw.gz',dtype='uint8',arrayOrder='ZYX, X fastest',
        values={'0':'excluded','255':'retained'},physicalCenterExtentUm=source.extent_um.tolist(),
        sourceThresholdRaw=float(threshold),sourceThresholdDisplay=float((threshold-source.window[0])/(source.window[1]-source.window[0])),
        sourceDimensions=source.high_dims.tolist(),sourceSpacingUm=source.high_spacing,
        method=f'Reviewed {policy} 18-connected source-threshold support, 3-voxel Manhattan margin and conservative sampling guard; endpoint-registered support.',
        componentPolicy=policy,retainedComponentIds=sorted(keep_ids),reviewedSupportSeeds=seed_records,reviewedHeartRoi=roi_review,
        coreConnectivity=18,marginVoxels=margin,coreComponentVoxels=core_count,sourceForegroundVoxels=int(foreground.sum()),
        sourceComponents=int(number),coreVoxelsRetained=retained,topComponentSizes=top,rawBytes=len(support_bytes),compressedBytes=len(encoded),sha256=SHA(encoded),
        intensitiesModified=False,limitations='Exterior display support is not anatomical segmentation. Original windowed volume is available by disabling cleanup.')
    write_json(source.assets/'cleanup/manifest.json',cleanup)
    if roi_review:
        write_json(source.docs/'heart-roi-support-review.json',dict(datasetId=source.dataset,
            reviewedHeartRoiSourceHighXYZ=roi_review['sourceHighXYZ'],registeredRoiInclusiveXYZ=roi_review['registeredInclusiveXYZ'],
            thresholdRaw=float(threshold),thresholdTissueVoxels=roi_review['thresholdVoxels'],
            retainedByConservativeSupport=roi_review['thresholdVoxels'],omittedThresholdVoxels=0,retainedFraction=1,
            evidence='Every above-threshold voxel in the inspected cardiac ROI was included in core; compact support was then checked to retain every core voxel exactly.',
            additionalCoreVoxels=roi_review['additionalCoreVoxels']))
    del core,foreground,support,represented
    filtered=ndi.gaussian_filter(high.astype(np.float32),sigma=.5,mode='nearest')
    low=np.rint(ndi.zoom(filtered,source.low_dims[::-1]/np.array(high.shape),order=1,mode='nearest',prefilter=False,grid_mode=False)).clip(0,255).astype(np.uint8)
    del filtered
    np.save(source.cache/'display-low-u8.npy',low)
    levels={};compression={}
    for key,data,spacing in [('low',low,source.low_spacing.tolist()),('high',high,source.high_spacing)]:
        original,osizes=encode_volume_parts(data,source.assets/f'volume/{key}-original.raw.gz',source.project)
        indices=support_indices(source,np.array(data.shape[::-1]));mask=compact[np.ix_(indices[2],indices[1],indices[0])]>0
        guard=ndi.binary_dilation(mask,structure=np.ones((3,3,3),bool),iterations=3)
        clean=np.where(guard,data,0).astype(np.uint8);np.save(source.cache/f'display-{key}-clean-u8.npy',clean)
        packed,csizes=encode_volume_parts(clean,source.assets/f'volume/{key}-clean.raw.gz',source.project,True)
        label_spacing=max(spacing) if isinstance(spacing,list) else spacing
        levels[key]=dict(label=f'{"Fast" if key=="low" else "Detailed"} · {label_spacing:.3f} µm',dimensions=list(data.shape[::-1]),spacingUm=spacing,
            parts=packed,originalParts=original,originalCompressedBytes=sum(p['bytes'] for p in original),compressedBytes=sum(p['bytes'] for p in packed),uncompressedBytes=int(data.size),
            sourceOffset=[0,0,0],dtype='uint8',arrayOrder='ZYX, X fastest',physicalCenterExtentUm=source.extent_um.tolist(),
            supportCompressed=True,supportCompression=dict(method='Conservative support plus 3-voxel interpolation halo; reversible byte prediction and gzip.',maximumRetainedByteError=0,originalRestoration='Load originalParts'),
            processing='Source high pyramid resampled at derived fine-registered physical centers; preview Gaussian sigma0.5 and endpoint-preserving trilinear resampling; display window encoded once.')
        compression[key]=dict(chosenPredictors=[p['predictor'] for p in packed],compressedBytes=sum(p['bytes'] for p in packed),alternatives=csizes,originalCompressedBytes=sum(p['bytes'] for p in original),partCount=len(packed),roundTripExact=True)
        if key=='high':make_review(clean,source,'clean-high-review.jpg')
    metadata=json.loads((source.cache/'source-metadata.json').read_text())
    manifest=dict(schemaVersion=1,specimen=source.spec['specimen'],organ='heart',datasetId=source.dataset,
        datasetUrl=f'https://human-organ-atlas.esrf.fr/datasets/{source.dataset}',doi=source.spec['doi'],doiUrl='https://doi.org/'+source.spec['doi'],
        title=metadata.get('DOI_title',f'Complete heart of {source.spec["specimen"]}'),attribution='Human Organ Atlas Collaboration / ESRF',license='CC BY 4.0',licenseUrl='https://creativecommons.org/licenses/by/4.0/',
        donorAge=source.spec['donorAge'],donorSex=source.spec.get('donorSex'),donorMedicalInfo=source.spec['donorMedicalInfo'],
        nativeDimensions=source.levels['0']['dimensionsXYZ'],nativeSpacingUm=source.spec['source']['nativeSpacingUm'],
        sourceHttp=source.base,sourceFormat='OME-Zarr v2' if source.kind=='zarr' else 'N5',sourceScale=source.attrs[source.high_level]['path'],
        sourceScaleDimensions=source.attrs[source.high_level]['dimensions'].tolist(),sourceScaleSpacingUm=source.high_spacing,sourceWindow=source.window.tolist(),sourceDtype='uint16',
        sourcePhysicalOriginUm=source.transforms[source.fine_level]['origin'].tolist(),sourceAxes=['x','y','z'],
        sourceScaleCenterExtentUm=source.extent_um.tolist(),levels=levels,previewLevel='low',defaultLevel='high',
        defaultThreshold=float(source.spec.get('defaultThreshold',(threshold-source.window[0])/(source.window[1]-source.window[0]))),
        registration='Fine source first sample center anchors every level. High centers use exact integer fine-index stride; preview shares endpoints. All acquired fine voxels retained; added terminal columns are zero.',
        registrationPadding=dict(sourceFineDimensionsXYZ=source.source_fine.tolist(),displayFineDimensionsXYZ=source.full.tolist(),zeroPaddedFineColumnsXYZ=(source.full-source.source_fine).tolist(),sourceVoxelsOmitted=0),
        processingSummary=f'Authentic {source.spec["specimen"]} whole-heart voxels. Donor metadata are recorded independently for this source. Source-specific display encoding and reversible exterior cleanup. Clinical orientation and anatomical labels require donor-specific review.',
        retrievedDate=datetime.now(timezone.utc).date().isoformat())
    if source.spec.get('displayWindow'):manifest['displayWindow']=source.spec['displayWindow']
    write_json(source.assets/'manifest.json',manifest)
    write_json(source.docs/'volume-preparation.json',dict(manifest=manifest,compression=compression,cleanup=cleanup,registration= json.loads((source.cache/'browser-geometry.json').read_text())))
    report('preview-ready',donor=source.slug,dimensionsXYZ=source.high_dims.tolist(),compression=compression,thresholdRaw=threshold,coreVoxels=core_count,topComponents=top)


def pack(source,workers):
    """Repack cached registered preview arrays without repeating preprocessing."""
    manifest=json.loads((source.assets/'manifest.json').read_text())
    for key in ['low','high']:
        level=manifest['levels'][key]
        for clean in [False,True]:
            suffix='clean' if clean else 'original'
            data=np.load(source.cache/f'display-{key}{"-clean" if clean else ""}-u8.npy',mmap_mode='r')
            old_path=source.assets/f'volume/{key}-{suffix}.raw.gz'
            parts,sizes=encode_volume_parts(data,old_path,source.project,clean)
            level['parts' if clean else 'originalParts']=parts
            level['compressedBytes' if clean else 'originalCompressedBytes']=sum(p['bytes'] for p in parts)
            if len(parts)>1 and old_path.exists():old_path.unlink() # only superseded outputs of this new pipeline
    if source.spec.get('displayWindow'):manifest['displayWindow']=source.spec['displayWindow']
    write_json(source.assets/'manifest.json',manifest)
    p=source.docs/'volume-preparation.json';prep=json.loads(p.read_text());prep['manifest']=manifest
    prep['compression']={k:dict(chosenPredictors=[p['predictor'] for p in v['parts']],
        compressedBytes=v['compressedBytes'],originalCompressedBytes=v['originalCompressedBytes'],
        partCount=len(v['parts']),roundTripExact=True) for k,v in manifest['levels'].items()}
    prep['publicAssetPacking']=dict(maximumBytes=max(p['bytes'] for level in manifest['levels'].values() for key in ['parts','originalParts'] for p in level[key]),targetLimitBytes=16*1024**2,method='Independent z slabs with reversible predictor reset and byte-exact round trip.')
    write_json(p,prep)
    report('pack-ready',donor=source.slug,levels={k:dict(bytes=v['compressedBytes'],parts=len(v['parts']),originalBytes=v['originalCompressedBytes']) for k,v in manifest['levels'].items()})


def fine(source, workers):
    planning_start=time.monotonic()
    compact=np.load(source.cache/'support-low-u8.npy',mmap_mode='r')
    indices=support_indices(source,source.full)
    zz,yy,xx=np.where(compact)
    limits=[]
    for axis,positions in enumerate((xx,yy,zz)):
        valid=np.flatnonzero((indices[axis]>=positions.min())&(indices[axis]<=positions.max()))
        start=int(valid.min()//2*2);end=int(min(source.full[axis]-1,(int(valid.max())+1)//2*2))
        limits.append((start,end))
    origin=np.array([a for a,b in limits]);shape=np.array([b-a+1 for a,b in limits])
    required=int(np.prod(shape))+1024**3
    free=shutil.disk_usage(source.cache).free
    if free<required:raise OSError(f'Fine crop needs {required:,} free bytes plus compressed downloads/banks; only {free:,} available')
    (source.cache/'s2-clean-display.json').unlink(missing_ok=True)
    write_json(source.cache/'fine-in-progress.json',dict(datasetId=source.dataset,shapeXYZ=shape.tolist(),
        message='Fine array is being rebuilt. Do not sample prepared images until s2-clean-display.json is atomically written.'))
    path=source.cache/'s2-clean-display-u8.npy'
    display=np.lib.format.open_memmap(path,mode='w+',dtype=np.uint8,shape=tuple(map(int,shape[::-1])))
    attrs=source.attrs[source.fine_level];chunks=attrs['chunks'];dims=attrs['dimensions'];counts=np.ceil(dims/chunks).astype(int)
    jobs=[]
    for z in range(counts[2]):
        for y in range(counts[1]):
            for x in range(counts[0]):
                begin=np.array([x,y,z])*chunks;end=np.minimum(begin+chunks,dims)
                lo=np.maximum(begin,origin);hi=np.minimum(end,origin+shape)
                if np.any(hi<=lo):continue
                a=[indices[i][lo[i]:hi[i]] for i in range(3)]
                # Fine indices repeat each compact support cell about8 times.
                # Their monotone image is contiguous, so inspect the tiny
                # compact box directly instead of materializing128^3 repeats.
                if compact[a[2][0]:a[2][-1]+1,a[1][0]:a[1][-1]+1,a[0][0]:a[0][-1]+1].any():jobs.append((x,y,z))
    records=[];start=time.monotonic()
    report('fine-plan',donor=source.slug,chunks=len(jobs),shapeXYZ=shape.tolist(),originXYZ=origin.tolist(),
           decodedDisplayBytes=int(np.prod(shape)),planningSeconds=round(start-planning_start,2),workers=workers,
           freeBytes=shutil.disk_usage(source.cache).free)
    def one(c):
        array,record=source.chunk(source.fine_level,c)
        begin=np.array(c)*chunks;end=np.minimum(begin+chunks,dims)
        lo=np.maximum(begin,origin);hi=np.minimum(end,origin+shape)
        local0,local1=lo-begin,hi-begin
        values=source.encode_window(array[local0[2]:local1[2],local0[1]:local1[1],local0[0]:local1[0]])
        a=[indices[i][lo[i]:hi[i]] for i in range(3)]
        starts=[int(v[0]) for v in a]
        sub=compact[starts[2]:a[2][-1]+1,starts[1]:a[1][-1]+1,starts[0]:a[0][-1]+1]
        mask=np.take(np.take(np.take(sub,a[0]-starts[0],axis=2),a[1]-starts[1],axis=1),a[2]-starts[2],axis=0)>0
        values[~mask]=0
        out0,out1=lo-origin,hi-origin
        display[out0[2]:out1[2],out0[1]:out1[1],out0[0]:out1[0]]=values
        record['retainedDisplaySha256']=SHA(values.tobytes());record['retainedNonzeroVoxels']=int(np.count_nonzero(values))
        return record
    with futures.ThreadPoolExecutor(max_workers=workers) as pool:
        tasks=[pool.submit(one,job) for job in jobs]
        for task in futures.as_completed(tasks):
            r=task.result()
            records.append(r)
            if len(records)%32==0 or len(records)==len(jobs):
                display.flush();report('fine-streaming',donor=source.slug,completed=len(records),total=len(jobs),sourceBytes=sum(r['bytes'] for r in records),seconds=round(time.monotonic()-start,1),freeBytes=shutil.disk_usage(source.cache).free)
    display.flush();records.sort(key=lambda r:r['coordinateXYZ'][::-1])
    meta=dict(identity=dict(maskSha256=SHA(compact.tobytes()),window=source.window.tolist(),fullXYZ=source.full.tolist(),sourceHttp=source.base+attrs['path']+'/',sourceSpacingUm=source.fine_spacing),
        originXYZ=origin.tolist(),shapeXYZ=shape.tolist(),sourceSpacingUm=source.fine_spacing,sourceFineDimensionsXYZ=dims.tolist(),outsideSupportValue=0,cleaned=True,quantitativeIntensityData=False,
        processing='Support-selected source chunks decoded and windowed directly into cropped uint8. No full fine uint16 intermediate. Padding beyond acquired source is zero.')
    write_json(source.cache/'s2-clean-display.json',meta)
    (source.cache/'fine-in-progress.json').unlink(missing_ok=True)
    write_json(source.cache/'fine-download.json',dict(records=records,compressedBytes=sum(r['bytes'] for r in records),completeSupportedChunks=True))
    (source.docs/'source-fine-chunks.json').write_bytes((source.cache/'fine-download.json').read_bytes())
    write_json(source.docs/'fine-source.json',dict(metadata=meta,sourceChunkCount=len(records),compressedSourceBytes=sum(r['bytes'] for r in records),decodedDisplayBytes=int(display.size),nativeDetailSynthesized=False,sourceVoxelsOmittedByRegistration=0))
    report('fine-ready',donor=source.slug,shapeXYZ=shape.tolist(),originXYZ=origin.tolist(),bytes=int(display.size),sourceChunks=len(records))


def section(display,origin,source,axis,index,plane=None):
    a='xyz'.index(axis);local=source.ratio*index-origin[a]
    width=int(source.full[1] if axis=='x' else source.full[0]);height=int(source.full[1] if axis=='z' else source.full[2])
    if local<0 or local>=display.shape[2-a]:return np.zeros((1,1),np.uint8),[0,0,1,1],width,height
    if axis=='x':p=display[:,:,local] if plane is None else plane;ox,oy=origin[1],origin[2]
    elif axis=='y':p=display[:,local,:] if plane is None else plane;ox,oy=origin[0],origin[2]
    else:p=display[local];ox,oy=origin[0],origin[1]
    rows=np.flatnonzero(p.any(axis=1));cols=np.flatnonzero(p.any(axis=0))
    if not len(rows) or not len(cols):return np.zeros((1,1),np.uint8),[0,0,1,1],width,height
    x0=max(0,(int(cols[0])-2)//2*2);y0=max(0,(int(rows[0])-2)//2*2)
    x1=min(p.shape[1]-1,(int(cols[-1])+3)//2*2);y1=min(p.shape[0]-1,(int(rows[-1])+3)//2*2)
    crop=[x0+ox,y0+oy,x1-x0+1,y1-y0+1]
    assert crop[0]%2==0 and crop[1]%2==0 and crop[2]%2==1 and crop[3]%2==1,crop
    return np.ascontiguousarray(p[y0:y1+1,x0:x1+1]),crop,width,height


def sections(source,workers):
    display=np.load(source.cache/'s2-clean-display-u8.npy',mmap_mode='r');meta=json.loads((source.cache/'s2-clean-display.json').read_text());origin=meta['originXYZ']
    out=source.project/'data/donors'/source.slug/'ultra-sections';out.mkdir(parents=True,exist_ok=True)
    def encode(p):
        buffer=io.BytesIO();Image.fromarray(p).save(buffer,format='WEBP',lossless=True,quality=0,method=2,exact=True)
        b=buffer.getvalue();assert np.array_equal(np.asarray(Image.open(io.BytesIO(b)).convert('L')),p)
        return b
    empty=encode(np.zeros((1,1),np.uint8));(out/'empty.webp').write_bytes(empty)
    for a in 'xyz':(out/a).mkdir(exist_ok=True)
    total=int(sum(source.high_dims));records=[];start=time.monotonic()
    def one(job):
        a,i=job[:2];p,crop,w,h=section(display,origin,source,a,i,job[2] if len(job)>2 else None);is_empty=p.shape==(1,1) and p[0,0]==0
        path='empty.webp' if is_empty else f'{a}/{i:04d}.webp';b=empty if is_empty else None;reused=False
        if not is_empty and (out/path).exists():
            try:
                candidate=(out/path).read_bytes()
                if np.array_equal(np.asarray(Image.open(io.BytesIO(candidate)).convert('L')),p):b=candidate;reused=True
            except (OSError,ValueError):pass
        if b is None:
            b=encode(p);target=out/path;temp=target.with_suffix('.webp.part');temp.write_bytes(b);temp.replace(target)
        return dict(axis=a,index=i,sourceIndex=source.ratio*i,path=path,crop=crop,fullWidth=w,fullHeight=h,bytes=len(b),empty=bool(is_empty),sha256=SHA(b),sourceDisplaySha256=SHA(p.tobytes()),losslessRoundTripVerified=True,encoder='verified-existing-lossless' if reused else 'webp-lossless-method2-quality0')
    def collect(iterator):
        for r in iterator:
            records.append(r)
            if len(records)%80==0 or len(records)==total:report('sections',donor=source.slug,completed=len(records),total=total,seconds=round(time.monotonic()-start,1))
    with futures.ThreadPoolExecutor(max_workers=workers) as pool:
        # Copy32 X/Y planes in one ZYX pass, then encode a bounded RAM slab.
        # This avoids repeated strided page-cache scans on an8GiB host.
        for axis,axis_index in [('x',0),('y',1)]:
            for first in range(0,int(source.high_dims[axis_index]),32):
                ids=list(range(first,min(first+32,int(source.high_dims[axis_index]))))
                valid=[i for i in ids if 0<=source.ratio*i-origin[axis_index]<display.shape[2-axis_index]]
                planes={}
                if valid:
                    lo=source.ratio*valid[0]-origin[axis_index];hi=source.ratio*valid[-1]-origin[axis_index]+1
                    subset=display[:,:,lo:hi:source.ratio] if axis=='x' else display[:,lo:hi:source.ratio,:]
                    slab=np.array(subset,order='C',copy=True)
                    stack=np.ascontiguousarray(slab.transpose(2,0,1) if axis=='x' else slab.transpose(1,0,2));del slab,subset
                    planes={i:stack[j] for j,i in enumerate(valid)}
                collect(pool.map(one,[(axis,i,planes.get(i)) for i in ids]))
                planes.clear()
                if valid:del stack
        collect(pool.map(one,[('z',i) for i in range(int(source.high_dims[2]))]))
    manifest=dict(schemaVersion=2,specimen=source.spec['specimen'],organ='heart',datasetId=source.dataset,datasetUrl=f'https://human-organ-atlas.esrf.fr/datasets/{source.dataset}',doi=source.spec['doi'],license='CC BY 4.0',attribution='Human Organ Atlas Collaboration / ESRF',
        sourceFormat=source.kind,sourceScale=source.attrs[source.fine_level]['path'],sourceDimensionsXYZ=source.source_fine.tolist(),sourceDtype='uint16',sourceWindow=source.window.tolist(),displayDtype='uint8',sourceSpacingUm=source.fine_spacing,spacingUm=source.fine_spacing,nativeSpacingUm=source.spec['source']['nativeSpacingUm'],
        sourceIndexStep=source.ratio,sliceSpacingUm=source.high_spacing,sliceCounts=source.high_dims.tolist(),imageDimensionsXYZ=source.full.tolist(),physicalCenterExtentUm=source.extent_um.tolist(),format='image/webp',compressionLossless=True,codecLossless=True,grayQuantizationStep=1,
        encoding='New sections use lossless WebP method2/effort0; source-identical existing lossless files may be reused. Every image is decoded and compared with its exact source pixels.',
        totalBytes=sum(r['bytes'] for r in records if not r['empty'])+len(empty),imageCount=len(records),nonemptyImageCount=sum(not r['empty'] for r in records),cropped=True,hosted=True,emptyPath='empty.webp',assetBaseUrl=f'/api/donors/{source.slug}/ultra/',
        registration='Section i uses exact fine source index i*sourceIndexStep, with crop coordinates in the registered fine grid. Acquired terminal source columns are retained; alignment padding is zero.',background='Outside donor-specific conservative display support is zero. Retained windowed source values round-trip byte-exactly.',supportMaskSha256=meta['identity']['maskSha256'],cleaned=True,
        limitations=f'Windowed 8-bit display textures at {source.fine_spacing} µm. Native and quantitative uint16 data remain in the atlas.',
        slices={a:[{k:r[k] for k in ['path','crop','bytes','empty','sha256','sourceDisplaySha256']} for r in records if r['axis']==a] for a in 'xyz'},generatedDate=datetime.now(timezone.utc).date().isoformat(),generator='scripts/prepare-donor-v10.py')
    write_json(source.assets/'ultra-sections.json',manifest,True);write_json(out/'manifest.json',manifest,True)
    write_json(out/'encoding-records.json',dict(records=records,totalBytes=manifest['totalBytes']),True)
    index={r['path']:dict(bytes=r['bytes'],sha256=r['sha256']) for r in records}
    write_json(source.project/'server/donors'/source.slug/'ultra-index.json',index,True)
    write_json(source.docs/'section-preparation.json',dict(imageCount=len(records),uniqueFiles=len(index),encodedBytes=manifest['totalBytes'],inPlaneSpacingUm=source.fine_spacing,sliceSpacingUm=source.high_spacing,byteExactRoundTrips=len(records),maximumDisplayByteError=0,
        encodingPreset='lossless WebP method2 / effort0',verifiedExistingFilesReused=sum(r['encoder']=='verified-existing-lossless' for r in records),maximumObjectBytes=max(r['bytes'] for r in records),stridedPlaneBatchSize=32))
    report('sections-ready',donor=source.slug,files=len(index),bytes=manifest['totalBytes'])


def bricks(source,workers):
    data=np.load(source.cache/'s2-clean-display-u8.npy',mmap_mode='r');meta=json.loads((source.cache/'s2-clean-display.json').read_text());shape=np.array(meta['shapeXYZ']);counts=np.ceil(shape/64).astype(int)
    out=source.project/'data/donors'/source.slug/'ultra-volume';out.mkdir(parents=True,exist_ok=True)
    jobs=[(x,y,z) for z in range(counts[2]) for y in range(counts[1]) for x in range(counts[0])];records={};start=time.monotonic()
    def one(c):
        bx,by,bz=c;x,y,z=np.array(c)*64;p=data[z:z+65,y:y+65,x:x+65]
        if not p.any():return None
        stored=np.zeros((65,65,65),np.uint8);stored[:p.shape[0],:p.shape[1],:p.shape[2]]=p
        raw=stored.tobytes();encoded=gzip.compress(raw,compresslevel=3,mtime=0);assert gzip.decompress(encoded)==raw
        path=f'{bz:02d}/{by:02d}/{bx:02d}.gz';target=out/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(encoded)
        ident=int(bx+counts[0]*(by+counts[1]*bz))
        return str(ident),dict(path=path,bytes=len(encoded),sha256=SHA(encoded),rawSha256=SHA(raw))
    with futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for i,r in enumerate(pool.map(one,jobs),1):
            if r:records[r[0]]=r[1]
            if i%750==0 or i==len(jobs):report('bricks',donor=source.slug,completed=i,total=len(jobs),nonempty=len(records),seconds=round(time.monotonic()-start,1))
    manifest=dict(schemaVersion=1,version=f'heart-{source.slug}-ultra-v10',specimen=source.spec['specimen'],datasetId=source.dataset,
        sourceSpacingUm=source.fine_spacing,sourceOriginXYZ=meta['originXYZ'],sourceShapeXYZ=meta['shapeXYZ'],fullDimensionsXYZ=source.full.tolist(),longestMm=source.longest_mm,extent=(source.extent_um[[0,2,1]]/max(source.extent_um)).tolist(),
        brickSize=64,storedEdge=65,brickCountsXYZ=counts.tolist(),codec='gzip-u8-zyx-positive-halo',decodedBrickBytes=65**3,emptyValue=0,assetBaseUrl=f'/api/donors/{source.slug}/volume/',sourceHttp=source.base+source.attrs[source.fine_level]['path']+'/',source='s2-clean-display-u8.npy',cleaned=True,quantitativeIntensityData=False,
        sourceWindow=source.window.tolist(),sourceMaskSha256=meta['identity']['maskSha256'],totalEncodedBytes=sum(r['bytes'] for r in records.values()),blocks=records,preparedPlanes=[])
    probe_path=source.assets/'probe-textures.json'
    if probe_path.exists():
        probe=json.loads(probe_path.read_text())
        if probe.get('datasetId')==source.dataset and abs(float(probe.get('sourceSpacingUm',0))-source.fine_spacing)<1e-8:
            manifest['preparedPlanes']=probe.get('preparedPlanes',[])
    write_json(source.assets/'ultra-volume.json',manifest,True)
    write_json(source.project/'server/donors'/source.slug/'volume-index.json',{r['path']:dict(bytes=r['bytes'],sha256=r['sha256']) for r in records.values()},True)
    write_json(source.docs/'brick-preparation.json',dict(sourceSpacingUm=source.fine_spacing,sourceShapeXYZ=meta['shapeXYZ'],fullDimensionsXYZ=source.full.tolist(),decodedSourceBytes=int(data.size),nonemptyBrickCount=len(records),implicitEmptyBrickCount=len(jobs)-len(records),encodedBytes=manifest['totalEncodedBytes'],storedEdge=65,brickSize=64,allBrickRoundTripsExact=True,maximumDisplayByteError=0))
    report('bricks-ready',donor=source.slug,files=len(records),bytes=manifest['totalEncodedBytes'])


def verify(source,workers):
    """Check complete output inventory before raw intermediates are released."""
    verified={}
    for name,target in [('high-download.json','source-high-chunks.json'),('fine-download.json','source-fine-chunks.json')]:
        (source.docs/target).write_bytes((source.cache/name).read_bytes())
    for name,index_name in [('ultra-sections','ultra-index.json'),('ultra-volume','volume-index.json')]:
        index=json.loads((source.project/'server/donors'/source.slug/index_name).read_text())
        root=source.project/'data/donors'/source.slug/name
        for path,entry in index.items():
            b=(root/path).read_bytes()
            assert len(b)==entry['bytes'] and SHA(b)==entry['sha256'],path
        verified[name]=dict(files=len(index),bytes=sum(e['bytes'] for e in index.values()),sha256AllVerified=True)
    meta=json.loads((source.cache/'s2-clean-display.json').read_text())
    data=np.load(source.cache/'s2-clean-display-u8.npy',mmap_mode='r')
    compact=np.load(source.cache/'support-low-u8.npy',mmap_mode='r')
    rng=np.random.default_rng(20261105);n=20000
    points=np.column_stack([rng.integers(0,int(d),n) for d in meta['shapeXYZ']])
    global_points=points+np.array(meta['originXYZ'])
    mask_points=np.floor(global_points/(source.full-1)*(source.low_dims-1)+.5).astype(int)
    allowed=compact[mask_points[:,2],mask_points[:,1],mask_points[:,0]]>0
    acquired=(global_points<source.source_fine).all(axis=1)
    actual=data[points[:,2],points[:,1],points[:,0]];expected=np.zeros(n,np.uint8)
    groups={}
    for i in np.flatnonzero(allowed&acquired):
        key=tuple(map(int,global_points[i]//128));groups.setdefault(key,[]).append(int(i))
    for key,ids in groups.items():
        chunk,_=source.chunk(source.fine_level,key);p=global_points[ids]-np.array(key)*128
        expected[ids]=source.encode_window(chunk[p[:,2],p[:,1],p[:,0]])
    assert np.array_equal(actual,expected), f'Fine source mismatch: {np.count_nonzero(actual!=expected)} / {n}'
    section_manifest=json.loads((source.assets/'ultra-sections.json').read_text())
    brick_manifest=json.loads((source.assets/'ultra-volume.json').read_text())
    assert section_manifest['datasetId']==source.dataset and brick_manifest['datasetId']==source.dataset
    assert section_manifest['sourceWindow']==source.window.tolist()==brick_manifest['sourceWindow']
    assert section_manifest['supportMaskSha256']==meta['identity']['maskSha256']==brick_manifest['sourceMaskSha256']
    assert brick_manifest['sourceOriginXYZ']==meta['originXYZ'] and brick_manifest['sourceShapeXYZ']==meta['shapeXYZ']
    assert section_manifest['imageDimensionsXYZ']==source.full.tolist()==brick_manifest['fullDimensionsXYZ']
    section_samples=0
    for axis,n_axis in zip('xyz',source.high_dims):
        for fraction in [.25,.5,.75]:
            index=int(round((n_axis-1)*fraction));pixels,crop,_,_=section(data,meta['originXYZ'],source,axis,index)
            record=section_manifest['slices'][axis][index]
            assert crop==record['crop'] and SHA(pixels.tobytes())==record['sourceDisplaySha256']
            section_samples+=1
    blocks=list(brick_manifest['blocks'].items());chosen=rng.choice(len(blocks),min(32,len(blocks)),replace=False)
    counts=np.array(brick_manifest['brickCountsXYZ'])
    for selection in chosen:
        ident,entry=blocks[int(selection)];ident=int(ident)
        x=(ident%counts[0])*64;y=((ident//counts[0])%counts[1])*64;z=(ident//(counts[0]*counts[1]))*64
        block=data[z:z+65,y:y+65,x:x+65];expected_block=np.zeros((65,65,65),np.uint8)
        expected_block[:block.shape[0],:block.shape[1],:block.shape[2]]=block
        decoded=gzip.decompress((source.project/'data/donors'/source.slug/'ultra-volume'/entry['path']).read_bytes())
        assert decoded==expected_block.tobytes(),f'Brick source/halo mismatch: {ident}'
    high_points=np.column_stack([rng.uniform(0,int(d)-1,4096) for d in source.high_dims])
    fine_physical=source.transforms[source.fine_level]['origin']+high_points*source.ratio*source.fine_spacing
    high_physical=source.transforms[source.high_level]['origin']+(high_points+source.high_shift)*source.high_spacing
    error=float(np.max(np.abs(fine_physical-high_physical)))
    assert error<1e-8
    assert np.allclose((source.low_dims-1)*source.low_spacing,source.extent_um,rtol=0,atol=1e-8)
    assert np.all(source.full>=source.source_fine)
    h=hashlib.sha256()
    for z in range(0,len(data),8):h.update(np.ascontiguousarray(data[z:z+8]).tobytes())
    validation=dict(datasetId=source.dataset,collections=verified,verifiedDate=datetime.now(timezone.utc).date().isoformat(),
                    fineSourceSamples=n,maximumDisplayByteError=int(np.max(np.abs(actual.astype(int)-expected.astype(int)))),
                    physicalRegistrationPoints=4096,maximumPhysicalRegistrationErrorUm=error,
                    sectionSourceHashChecks=section_samples,brickSourceAndPositiveHaloChecks=len(chosen),
                    decodedDisplaySha256=h.hexdigest(),decodedDisplayBytes=int(data.size),
                    sourceVoxelsOmittedByRegistration=0,previewEndpointsVerified=True)
    write_json(source.docs/'encoded-bank-verification.json',validation)
    report('verified',donor=source.slug,collections=verified,sourceSamples=n,physicalErrorUm=error)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config',required=True,type=Path)
    p.add_argument('--cache',type=Path)
    p.add_argument('--project',type=Path,default=PROJECT)
    p.add_argument('--workers',type=int,default=8)
    p.add_argument('--stage',choices=['download','preview','pack','fine','sections','bricks','verify','all'],default='all')
    args=p.parse_args();spec=json.loads(args.config.read_text());cache=args.cache or Path('/workspace/data')/f'heart-donor-{spec["datasetId"]}'
    blosc2.set_nthreads(1);source=Source(spec,cache,args.project)
    stages=['download','preview','fine','sections','bricks','verify'] if args.stage=='all' else [args.stage]
    for stage in stages:
        (download_high if stage=='download' else globals()[stage])(source,max(1,min(args.workers,24)))


if __name__=='__main__':main()
