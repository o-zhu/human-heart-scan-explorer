#!/usr/bin/env python3
"""Reproducible, source-registered display pipeline for HOA donor UCL-ZCR-2629.

The official OME-Zarr uint16 values are decoded without spatial modification.
Browser derivatives use the official Neuroglancer intensity window, conservative
connected-component support, lossless uint8 compression, registered lossless
orthogonal sections, and sparse 65^3 density bricks. No anatomy is synthesized.
The new donor has its own namespace; the LADAF-2021-17 assets remain untouched.
"""
from __future__ import annotations
import argparse
import concurrent.futures as futures
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import time
import urllib.error
import urllib.request

import blosc2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

PROJECT = Path(__file__).resolve().parents[1]
SLUG = 'ucl-zcr-2629'
SPECIMEN = 'UCL-ZCR-2629'
DATASET_ID = '2298522198'
BASE = ('https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/'
        'UCL-ZCR-2629/heart/7.032um_complete-organ_bm18.ome.zarr/')
SOURCE_WINDOW = (35893, 38534)
NATIVE_SPACING = 7.032
FINE_SPACING = 28.128
DISPLAY_SPACING = 112.512
# The exact dimensions and axes advertised by OME-Zarr take precedence over
# the web record's differently ordered X/Y reconstruction fields.
EXPECTED = {'0': [4615,4675,7300], '2': [1154,1169,1825], '4': [289,293,457]}
COUNTS = np.array(EXPECTED['4'], dtype=int)
FULL = (COUNTS-1)*4+1
LOW = (COUNTS+1)//2
SHA = lambda b: hashlib.sha256(b).hexdigest()


def write_json(path, value, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(',', ':') if compact else None,
                               indent=None if compact else 2)+'\n')


def fetch(url, path, attempts=5):
    if path.exists():
        return path.read_bytes(), True
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                payload = response.read()
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(path.suffix+'.part')
            temporary.write_bytes(payload)
            temporary.replace(path)
            return payload, False
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise
            if attempt+1 == attempts:
                raise
        except Exception:
            if attempt+1 == attempts:
                raise
        time.sleep(min(4, 2**attempt))


def attributes(cache, level):
    payload, _ = fetch(BASE+level+'/.zarray', cache/f'zarr-{level}.json')
    a = json.loads(payload)
    if (a['shape'] != EXPECTED[level] or a['chunks'] != [128]*3 or a['dtype'] != '<u2'
        or a['order'] != 'C' or a['compressor']['id'] != 'blosc'
        or a.get('filters') or a.get('dimension_separator') != '/'):
        raise ValueError(f'Unsupported or changed source array metadata: {a}')
    return a


def download(cache, level, workers, coords=None):
    attrs = attributes(cache, level)
    dims = np.array(attrs['shape'])
    chunks = np.array(attrs['chunks'])
    counts = np.ceil(dims/chunks).astype(int)
    if coords is None:
        coords = [(x,y,z) for z in range(counts[2]) for y in range(counts[1]) for x in range(counts[0])]
    path = cache/f's{level}-source-u16.npy'
    mode = 'r+' if path.exists() else 'w+'
    volume = np.lib.format.open_memmap(path, mode=mode, dtype=np.uint16, shape=tuple(map(int,dims[::-1])))
    records = []
    blosc2.set_nthreads(1)
    start = time.monotonic()
    print(json.dumps({'stage':'download','level':level,'chunks':len(coords),'dimensionsXYZ':dims.tolist()}), flush=True)

    def one(c):
        x,y,z = map(int,c)
        relative = f'{x}/{y}/{z}'
        dest = cache/f'chunks-s{level}'/f'{x}_{y}_{z}.blosc'
        payload, cached = fetch(BASE+level+'/'+relative, dest)
        raw = blosc2.decompress(payload)
        if len(raw) != int(np.prod(chunks))*2:
            raise ValueError(f'Incorrect source chunk length: {relative}: {len(raw)}')
        # OME axes are XYZ and the array is C-order (Z fastest). Our internal
        # renderer arrays are ZYX (X fastest), so transpose exactly once.
        decoded = np.frombuffer(raw,dtype='<u2').reshape(tuple(chunks)).transpose(2,1,0)
        size = np.minimum(chunks, dims-np.array(c)*chunks)
        dx,dy,dz = map(int,size)
        volume[z*128:z*128+dz,y*128:y*128+dy,x*128:x*128+dx] = decoded[:dz,:dy,:dx]
        return {'coordinateXYZ':[x,y,z],'url':BASE+level+'/'+relative,
                'bytes':len(payload),'sha256':SHA(payload),'decodedSha256':SHA(raw),'cached':cached}

    with futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for result in pool.map(one,coords):
            records.append(result)
            if len(records)%16 == 0 or len(records)==len(coords):
                print(json.dumps({'stage':'download','level':level,'completed':len(records),'total':len(coords),
                                  'bytes':sum(r['bytes'] for r in records),'seconds':round(time.monotonic()-start,1)}),flush=True)
    volume.flush()
    report = {'sourceHttp':BASE,'arrayPath':level,'sourceAxes':'XYZ','arrayOrder':'C',
              'internalOrder':'ZYX','dtype':'uint16','dimensionsXYZ':dims.tolist(),
              'chunks':len(records),'compressedBytes':sum(r['bytes'] for r in records),
              'completeFullArray':len(coords)==int(np.prod(counts)),
              'unfetchedExteriorValue':0,'records':records}
    write_json(cache/f's{level}-download.json',report)
    return volume, report


def window(raw):
    return np.rint(np.clip((raw.astype(np.float32)-SOURCE_WINDOW[0]) *
                          (255.0/(SOURCE_WINDOW[1]-SOURCE_WINDOW[0])),0,255)).astype(np.uint8)


def encode_volume(data, target, root, clean=False):
    variants = {}
    raw = data.tobytes()
    for kind in ('none','delta-x','delta-z'):
        a = data.copy()
        if kind == 'delta-x': a[:,:,1:] = data[:,:,1:]-data[:,:,:-1]
        elif kind == 'delta-z': a[1:] = data[1:]-data[:-1]
        encoded = gzip.compress(a.tobytes(),compresslevel=6,mtime=0)
        variants[kind] = encoded
    chosen = min(variants,key=lambda k:len(variants[k]))
    encoded = variants[chosen]
    restored=np.frombuffer(gzip.decompress(encoded),np.uint8).reshape(data.shape)
    if chosen == 'delta-x': restored=np.cumsum(restored,axis=2,dtype=np.uint8)
    elif chosen == 'delta-z': restored=np.cumsum(restored,axis=0,dtype=np.uint8)
    assert np.array_equal(data,restored)
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(encoded)
    return {'url':str(target.relative_to(root/'public')),'bytes':len(encoded),
            'uncompressedBytes':len(raw),'zRange':[0,data.shape[0]],'sha256':SHA(encoded),
            'rawSha256':SHA(raw),'predictor':chosen}, {k:len(v) for k,v in variants.items()}


def preview(cache, root, workers):
    raw, download_report = download(cache,'4',workers)
    assets = root/'public/assets/donors'/SLUG
    docs = root/'docs/donors'/SLUG
    assets.mkdir(parents=True,exist_ok=True)
    docs.mkdir(parents=True,exist_ok=True)
    metadata=json.loads((cache/'source-metadata.json').read_text())
    for source in ['source-metadata.json','source-neuroglancer.json','zarr-.zattrs','zarr-.zgroup','zarr-0.json','zarr-2.json','zarr-4.json']:
        p=cache/source
        if p.exists():(docs/source).write_bytes(p.read_bytes())
    # OME level4 centers: 112.512*i + 56.256 µm. Browser coordinates are
    # anchored to level2 centers: 28.128*j + 14.064 µm, j=4*i. Therefore
    # resampling level4 at i-0.375 is required; blindly using 4*i would shift
    # the fine cap by 42.192 µm in every source direction.
    shift=-.375
    zz,yy,xx=[np.arange(n,dtype=np.float32)+shift for n in COUNTS[::-1]]
    high_raw=np.empty(tuple(COUNTS[::-1]),np.float32)
    grid_y,grid_x=np.meshgrid(yy,xx,indexing='ij')
    for z in range(len(zz)):
        grid_z=np.full(grid_x.shape,zz[z],np.float32)
        high_raw[z]=ndi.map_coordinates(raw,[grid_z,grid_y,grid_x],order=1,mode='nearest',prefilter=False,output=np.uint16)
    high=window(high_raw)
    np.save(cache/'display-high-u8.npy',high)
    np.save(cache/'display-high-raw-f32.npy',high_raw)
    # Conservative, reversible exterior support. A source-connected myocardial
    # core is preserved, including a three-voxel margin and a sampling guard.
    threshold=SOURCE_WINDOW[0]+.32*(SOURCE_WINDOW[1]-SOURCE_WINDOW[0])
    foreground=high_raw>threshold
    labels,number=ndi.label(foreground,structure=ndi.generate_binary_structure(3,2))
    sizes=np.bincount(labels.ravel());sizes[0]=0
    label=int(sizes.argmax());core=labels==label
    core_count=int(sizes[label]);top=sorted([int(n) for n in sizes[1:]],reverse=True)[:12]
    del labels,sizes
    margin=ndi.binary_dilation(core,structure=ndi.generate_binary_structure(3,1),iterations=3)
    support=ndi.maximum_filter(margin,size=3,mode='constant')
    compact=support[::2,::2,::2].astype(np.uint8)*255
    # Protect every retained coarse core voxel after nearest resampling.
    ix=[np.floor(np.arange(n)/2+.5).astype(int).clip(0,compact.shape[a]-1) for a,n in enumerate(high.shape)]
    represented=compact[np.ix_(*ix)]>0
    retained=int((core&represented).sum())
    assert retained==core_count,(retained,core_count)
    np.save(cache/'support-low-u8.npy',compact)
    support_bytes=compact.tobytes();encoded=gzip.compress(support_bytes,compresslevel=9,mtime=0)
    (assets/'cleanup').mkdir(exist_ok=True);(assets/'cleanup/heart-support.raw.gz').write_bytes(encoded)
    support_manifest={'schemaVersion':1,'specimen':SPECIMEN,'dimensions':LOW.tolist(),
        'volumeUrl':f'assets/donors/{SLUG}/cleanup/heart-support.raw.gz','dtype':'uint8',
        'arrayOrder':'ZYX, X fastest','values':{'0':'excluded','255':'retained'},
        'physicalCenterExtentUm':((FULL-1)*FINE_SPACING).tolist(),
        'registration':'Fine level2 first and last voxel centers; OME half-voxel translations accounted for.',
        'sourceScale':'OME-Zarr level4','sourceDimensions':COUNTS.tolist(),'sourceThresholdRaw':threshold,
        'sourceThresholdDisplay':.32,'method':'Largest 18-connected tissue component plus 3 Manhattan voxels and one conservative resampling guard.',
        'coreConnectivity':18,'marginVoxelsS4':3,'sourceSpacingUm':DISPLAY_SPACING,
        'coreComponentVoxels':core_count,'sourceForegroundVoxels':int(foreground.sum()),
        'sourceComponents':int(number),'coreVoxelsRetained':retained,'topComponentSizes':top,
        'rawBytes':len(support_bytes),'compressedBytes':len(encoded),'sha256':SHA(encoded),
        'limitations':'Conservative display support removes exterior debris; it is not an anatomical segmentation. Original windowed intensities remain available by disabling Clean Scan.',
        'intensitiesModified':False}
    write_json(assets/'cleanup/manifest.json',support_manifest)
    filtered=ndi.gaussian_filter(high.astype(np.float32),sigma=.5,mode='nearest')
    low=np.rint(filtered[::2,::2,::2]).clip(0,255).astype(np.uint8)
    np.save(cache/'display-low-u8.npy',low)
    del filtered
    levels={};compression={}
    for key,data,spacing in [('low',low,DISPLAY_SPACING*2),('high',high,DISPLAY_SPACING)]:
        original,original_sizes=encode_volume(data,assets/f'volume/{key}-original.raw.gz',root)
        indices=[np.floor(np.linspace(0,compact.shape[i]-1,data.shape[i])+.5).astype(int) for i in range(3)]
        mask=compact[np.ix_(*indices)]>0
        guard=ndi.binary_dilation(mask,structure=np.ones((3,3,3),bool),iterations=3)
        clean=np.where(guard,data,0).astype(np.uint8)
        bounds=[[int(q[0]),int(q[-1])] for q in [np.flatnonzero(guard.any(axis=(0,1))), np.flatnonzero(guard.any(axis=(0,2))), np.flatnonzero(guard.any(axis=(1,2)))]]
        packed,sizes=encode_volume(clean,assets/f'volume/{key}-clean.raw.gz',root,True)
        np.save(cache/f'display-{key}-clean-u8.npy',clean)
        dimensions=list(data.shape[::-1])
        levels[key]={'label':f'{"Fast" if key=="low" else "Detailed"} · {spacing:.3f} µm',
            'dimensions':dimensions,'spacingUm':spacing,'parts':[packed],
            'originalParts':[original],'originalCompressedBytes':original['bytes'],
            'compressedBytes':packed['bytes'],'uncompressedBytes':int(data.size),
            'sourceOffset':[0,0,0],'dtype':'uint8','arrayOrder':'ZYX, X fastest',
            'physicalCenterExtentUm':((FULL-1)*FINE_SPACING).tolist(),
            'downsampleFactor':spacing/NATIVE_SPACING,'downsampleFactorsXYZ':[spacing/NATIVE_SPACING]*3,
            'supportCompressed':True,'supportCompression':{'method':'Conservative support plus a 3-voxel interpolation halo; reversible byte prediction and gzip.',
            'guardVoxels':3,'boundsXYZ':bounds,'maximumRetainedByteError':0,'originalRestoration':'Load originalParts when cleanup is disabled'},
            'processing':'Official OME level 4 trilinearly aligned to the level 2 first-center grid with nearest uint16 output (at most 0.5 raw unit rounding); display window 35893–38534; low uses Gaussian sigma 0.5 and exact alternate coarse samples.'}
        compression[key]={'chosenPredictor':packed['predictor'],'compressedBytes':packed['bytes'],
                          'uncompressedBytes':int(data.size),'alternatives':sizes,
                          'originalCompressedBytes':original['bytes'],'roundTripExact':True}
    manifest={'schemaVersion':1,'specimen':SPECIMEN,'organ':'heart','datasetId':DATASET_ID,
        'datasetUrl':f'https://human-organ-atlas.esrf.fr/datasets/{DATASET_ID}',
        'doi':metadata['doi'],'doiUrl':'https://doi.org/'+metadata['doi'],'title':metadata['DOI_title'],
        'attribution':'Human Organ Atlas Collaboration / ESRF','license':'CC BY 4.0',
        'licenseUrl':'https://creativecommons.org/licenses/by/4.0/',
        'donorAge':'<18','donorSex':None,'donorMedicalInfo':'Disease free',
        'nativeDimensions':EXPECTED['0'],'nativeSpacingUm':NATIVE_SPACING,
        'portalReconstructionDimensionsXYZ':[4675,4615,7300],
        'sourceHttp':BASE,'sourceFormat':'OME-Zarr v2','sourceScale':'4',
        'sourceScaleDimensions':COUNTS.tolist(),'sourceScaleSpacingUm':DISPLAY_SPACING,
        'sourceWindow':list(SOURCE_WINDOW),'sourceDtype':'uint16',
        'sourcePhysicalOriginUm':[14.064]*3,'sourceAxes':['x','y','z'],
        'sourceScaleCenterExtentUm':((FULL-1)*FINE_SPACING).tolist(),
        'sourceScaleVoxelExtentUm':(COUNTS*DISPLAY_SPACING).tolist(),
        'levels':levels,'previewLevel':'low','defaultLevel':'high','defaultThreshold':.32,
        'registration':'Browser extent shares exact first and last centers with the cropped OME level 2 lattice [1153,1169,1825]. Level 4 samples use index i−0.375 on each axis to respect OME half-voxel translations. Native OME axis order XYZ takes precedence over the portal X/Y field ordering.',
        'processingSummary':'Authentic UCL-ZCR-2629 complete-heart voxels. Official donor record: under 18, disease free; exact age and sex not supplied. Preview 225.024 µm, detailed 112.512 µm, Ultra 28.128 µm. Conservative exterior cleanup is reversible for the 3D display. Regional annotations and clinical window orientation require donor-specific review.',
        'retrievedDate':'2026-11-05'}
    assert not compact[:,:,-1].any(), 'The terminal X column intersects retained support.'
    manifest['registrationTrim']={
        'sourceFineDimensionsXYZ':EXPECTED['2'],'displayFineDimensionsXYZ':FULL.tolist(),
        'omittedFineColumns':{'x':[1153],'y':[],'z':[]},
        'reason':'One terminal X column omitted to keep fine/coarse voxel-center extents identical and exact alternate-pixel crops odd-sized.',
        'omittedColumnInsideConservativeSupport':False,
        'supportCheck':'The entire terminal X cell of the compact support is zero; the excluded fine column maps to this cell.'}
    write_json(assets/'manifest.json',manifest)
    write_json(docs/'volume-preparation.json',{'manifest':manifest,'compression':compression,
        'cleanup':support_manifest,'downloadedSourceBytes':download_report['compressedBytes'],
        'sourceChunkCount':download_report['chunks'],'sourceWindowOrigin':'Official linked Neuroglancer shaderControls.normalized.range',
        'maximumRetainedByteError':0})
    write_json(cache/'browser-geometry.json',{'highDimensionsXYZ':COUNTS.tolist(),'lowDimensionsXYZ':LOW.tolist(),
        'fullFineDimensionsXYZ':FULL.tolist(),'highSpacingUm':DISPLAY_SPACING,'fineSpacingUm':FINE_SPACING,
        'longestMm':float(max(FULL-1)*FINE_SPACING/1000),'extent':[(FULL[0]-1)/(FULL[2]-1),1,(FULL[1]-1)/(FULL[2]-1)],
        'worldToFineXYZ':'[worldX*1824+576, -worldZ*1824+584, worldY*1824+912]',
        'fineSourcePhysicalOriginUm':[14.064]*3,'highOriginalSourceIndexShift':-.375})
    print(json.dumps({'stage':'preview-ready','dimensionsXYZ':COUNTS.tolist(),'window':SOURCE_WINDOW,
                      'coreVoxels':core_count,'foregroundVoxels':int(foreground.sum()),
                      'topComponents':top,'compression':compression,'manifest':str(assets/'manifest.json')}),flush=True)


def fine(cache, root, workers):
    compact=np.load(cache/'support-low-u8.npy',mmap_mode='r')
    source_dims=np.array(EXPECTED['2']);chunk_counts=np.ceil(source_dims/128).astype(int)
    coords=[]
    for z in range(chunk_counts[2]):
        for y in range(chunk_counts[1]):
            for x in range(chunk_counts[0]):
                starts=np.floor(np.array([x,y,z])*128/8+.5).astype(int)
                ends=np.floor((np.minimum(np.array([x,y,z])*128+128,FULL)-1)/8+.5).astype(int)+1
                starts=np.maximum(starts-1,0);ends=np.minimum(ends+1,LOW)
                if np.all(ends>starts) and compact[starts[2]:ends[2],starts[1]:ends[1],starts[0]:ends[0]].any():
                    coords.append((x,y,z))
    raw,report=download(cache,'2',workers,coords)
    indices=[np.floor(np.arange(n)/8+.5).astype(int).clip(0,compact.shape[2-a]-1) for a,n in enumerate(FULL)]
    sz,sy,sx=np.where(compact)
    limits=[]
    for i,positions in enumerate((sx,sy,sz)):
        valid=np.flatnonzero((indices[i]>=positions.min())&(indices[i]<=positions.max()))
        start=int(valid.min()//2*2);end=int(min(FULL[i]-1,(int(valid.max())+1)//2*2))
        limits.append((start,end))
    origin=[a for a,b in limits];shape=[b-a+1 for a,b in limits]
    display=np.lib.format.open_memmap(cache/'s2-clean-display-u8.npy',mode='w+',dtype=np.uint8,shape=tuple(shape[::-1]))
    x0,x1=limits[0];y0,y1=limits[1];z0,z1=limits[2]
    xx=indices[0][x0:x1+1];yy=indices[1][y0:y1+1]
    for z in range(z0,z1+1):
        values=window(raw[z,y0:y1+1,x0:x1+1])
        mask=compact[indices[2][z]][np.ix_(yy,xx)]>0
        values[~mask]=0;display[z-z0]=values
    display.flush()
    metadata={'identity':{'maskSha256':SHA(compact.tobytes()),'window':list(SOURCE_WINDOW),
                        'fullXYZ':FULL.tolist(),'source':'s2-source-u16.npy','sourceHttp':BASE+'2/',
                        'sourceAxes':'XYZ','sourceOrder':'C','sourceSpacingUm':FINE_SPACING},
              'originXYZ':origin,'shapeXYZ':shape,'sourceSpacingUm':FINE_SPACING,
              'supportMask':'Donor-specific conservative connected-component exterior support',
              'outsideSupportValue':0,'quantitativeIntensityData':False,'cleaned':True}
    write_json(cache/'s2-clean-display.json',metadata)
    write_json(root/'docs/donors'/SLUG/'fine-source.json',{'metadata':metadata,
              'sourceChunks':report['chunks'],'compressedSourceBytes':report['compressedBytes'],
              'decodedDisplayBytes':int(display.size),'fullSourceDimensionsXYZ':EXPECTED['2'],
              'registrationMaximumErrorUm':0,'nativeDetailSynthesized':False})
    print(json.dumps({'stage':'fine-ready','originXYZ':origin,'shapeXYZ':shape,
                      'bytes':int(display.size),'sourceChunks':report['chunks']}),flush=True)


def section(display,origin,axis,index):
    a='xyz'.index(axis);local=4*index-origin[a]
    full_width=int(FULL[1] if axis=='x' else FULL[0]);full_height=int(FULL[1] if axis=='z' else FULL[2])
    if local<0 or local>=display.shape[2-a]:
        return np.zeros((1,1),np.uint8),[0,0,1,1],full_width,full_height
    if axis=='x':p=display[:,:,local];ox,oy=origin[1],origin[2]
    elif axis=='y':p=display[:,local,:];ox,oy=origin[0],origin[2]
    else:p=display[local];ox,oy=origin[0],origin[1]
    rows=np.flatnonzero(p.any(axis=1));cols=np.flatnonzero(p.any(axis=0))
    if not len(rows) or not len(cols):return np.zeros((1,1),np.uint8),[0,0,1,1],full_width,full_height
    x0=max(0,(int(cols[0])-2)//2*2);y0=max(0,(int(rows[0])-2)//2*2)
    x1=min(p.shape[1]-1,(int(cols[-1])+3)//2*2);y1=min(p.shape[0]-1,(int(rows[-1])+3)//2*2)
    crop=[x0+ox,y0+oy,x1-x0+1,y1-y0+1]
    assert crop[0]%2==0 and crop[1]%2==0 and crop[2]%2==1 and crop[3]%2==1,crop
    return np.ascontiguousarray(p[y0:y1+1,x0:x1+1]),crop,full_width,full_height


def sections(cache,root,workers):
    display=np.load(cache/'s2-clean-display-u8.npy',mmap_mode='r')
    meta=json.loads((cache/'s2-clean-display.json').read_text());origin=meta['originXYZ']
    out=root/'data/donors'/SLUG/'ultra-sections';out.mkdir(parents=True,exist_ok=True)
    def encode(p):
        buffer=io.BytesIO();Image.fromarray(p).save(buffer,format='WEBP',lossless=True,quality=100,method=4,exact=True)
        b=buffer.getvalue();assert np.array_equal(np.asarray(Image.open(io.BytesIO(b)).convert('L')),p)
        return b
    empty=encode(np.zeros((1,1),np.uint8));(out/'empty.webp').write_bytes(empty)
    for a in 'xyz':(out/a).mkdir(exist_ok=True)
    jobs=[(a,i) for a,n in zip('xyz',COUNTS) for i in range(int(n))]
    start=time.monotonic();records=[]
    def one(job):
        axis,index=job;p,crop,w,h=section(display,origin,axis,index)
        is_empty=p.shape==(1,1) and p[0,0]==0
        payload=empty if is_empty else encode(p)
        path='empty.webp' if is_empty else f'{axis}/{index:04d}.webp'
        if not is_empty:(out/path).write_bytes(payload)
        return {'axis':axis,'index':index,'sourceIndex':4*index,'path':path,'crop':crop,
                'fullWidth':w,'fullHeight':h,'bytes':len(payload),'empty':bool(is_empty),
                'sha256':SHA(payload),'sourceDisplaySha256':SHA(p.tobytes()),
                'losslessRoundTripVerified':True,'retainedPixels':int(np.count_nonzero(p))}
    with futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for record in pool.map(one,jobs):
            records.append(record)
            if len(records)%80==0 or len(records)==len(jobs):
                print(json.dumps({'stage':'sections','completed':len(records),'total':len(jobs),
                                  'bytes':sum(r['bytes'] for r in records if not r['empty']),
                                  'seconds':round(time.monotonic()-start,1)}),flush=True)
    manifest={'schemaVersion':2,'specimen':SPECIMEN,'organ':'heart','datasetId':DATASET_ID,
        'datasetUrl':f'https://human-organ-atlas.esrf.fr/datasets/{DATASET_ID}',
        'doi':'10.15151/ESRF-DC-2299323295','license':'CC BY 4.0','attribution':'Human Organ Atlas Collaboration / ESRF',
        'sourceFormat':'OME-Zarr v2','sourceScale':'2','sourceDimensionsXYZ':EXPECTED['2'],
        'sourceDtype':'uint16','sourceWindow':list(SOURCE_WINDOW),'displayDtype':'uint8',
        'sourceSpacingUm':FINE_SPACING,'spacingUm':FINE_SPACING,'nativeSpacingUm':NATIVE_SPACING,
        'sourceIndexStep':4,'sliceSpacingUm':DISPLAY_SPACING,'sliceCounts':COUNTS.tolist(),
        'imageDimensionsXYZ':FULL.tolist(),'physicalCenterExtentUm':((FULL-1)*FINE_SPACING).tolist(),
        'format':'image/webp','compressionLossless':True,'codecLossless':True,'grayQuantizationStep':1,
        'totalBytes':sum(r['bytes'] for r in records if not r['empty'])+len(empty),'imageCount':len(records),
        'nonemptyImageCount':sum(not r['empty'] for r in records),'cropped':True,'hosted':True,
        'emptyPath':'empty.webp','assetBaseUrl':f'/api/donors/{SLUG}/ultra/',
        'registration':'Section i uses exact OME level 2 index 4*i. Crop origins are positions in the full fine image. High/low volume coordinates account for OME pyramid translations. No sharpening or spatial upsampling.',
        'background':'Values outside donor-specific conservative exterior support are zero. Windowed source values inside support round-trip byte-exactly.',
        'supportMaskSha256':meta['identity']['maskSha256'],'cleaned':True,
        'limitations':'Windowed 8-bit display textures at 28.128 µm; quantitative raw 16-bit measurements and native 7.032 µm detail remain in the source atlas.',
        'slices':{a:[{k:r[k] for k in ['path','crop','bytes','empty','sha256','sourceDisplaySha256']} for r in records if r['axis']==a] for a in 'xyz'},
        'generatedDate':'2026-11-05','generator':'scripts/prepare-donor-v8.py'}
    write_json(root/'public/assets/donors'/SLUG/'ultra-sections.json',manifest,True)
    write_json(out/'manifest.json',manifest,True)
    write_json(out/'encoding-records.json',{'records':records,'totalBytes':manifest['totalBytes']},True)
    index={r['path']:{'bytes':r['bytes'],'sha256':r['sha256']} for r in records}
    write_json(root/'server/donors'/SLUG/'ultra-index.json',index,True)
    write_json(root/'docs/donors'/SLUG/'section-preparation.json',{
        'imageCount':len(records),'nonemptyImageCount':manifest['nonemptyImageCount'],
        'emptyImageCount':len(records)-manifest['nonemptyImageCount'],'uniqueFiles':len(index),
        'encodedBytes':manifest['totalBytes'],'inPlaneSpacingUm':FINE_SPACING,
        'sliceSpacingUm':DISPLAY_SPACING,'sourceIndexStep':4,'byteExactRoundTrips':len(records),
        'maximumDisplayByteError':0,'elapsedSeconds':round(time.monotonic()-start,2)})
    print(json.dumps({'stage':'sections-ready','files':len(index),'bytes':manifest['totalBytes']}),flush=True)


def bricks(cache,root,workers):
    data=np.load(cache/'s2-clean-display-u8.npy',mmap_mode='r')
    meta=json.loads((cache/'s2-clean-display.json').read_text());shape=np.array(meta['shapeXYZ']);counts=np.ceil(shape/64).astype(int)
    out=root/'data/donors'/SLUG/'ultra-volume';out.mkdir(parents=True,exist_ok=True)
    jobs=[(x,y,z) for z in range(counts[2]) for y in range(counts[1]) for x in range(counts[0])]
    start=time.monotonic();records={}
    def one(position):
        bx,by,bz=position;x,y,z=bx*64,by*64,bz*64
        p=data[z:z+65,y:y+65,x:x+65]
        if not p.any():return None
        stored=np.zeros((65,65,65),np.uint8);stored[:p.shape[0],:p.shape[1],:p.shape[2]]=p
        raw=stored.tobytes();encoded=gzip.compress(raw,compresslevel=3,mtime=0)
        assert gzip.decompress(encoded)==raw
        path=f'{bz:02d}/{by:02d}/{bx:02d}.gz';target=out/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(encoded)
        ident=int(bx+counts[0]*(by+counts[1]*bz))
        return str(ident),{'path':path,'bytes':len(encoded),'sha256':SHA(encoded),'rawSha256':SHA(raw)}
    with futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for i,result in enumerate(pool.map(one,jobs),1):
            if result:records[result[0]]=result[1]
            if i%750==0 or i==len(jobs):
                print(json.dumps({'stage':'bricks','completed':i,'total':len(jobs),'nonempty':len(records),'seconds':round(time.monotonic()-start,1)}),flush=True)
    longest=int(max(FULL-1))
    manifest={'schemaVersion':1,'version':f'heart-{SLUG}-ultra-v8','specimen':SPECIMEN,
        'sourceSpacingUm':FINE_SPACING,'sourceOriginXYZ':meta['originXYZ'],'sourceShapeXYZ':meta['shapeXYZ'],
        'fullDimensionsXYZ':FULL.tolist(),'longestMm':longest*FINE_SPACING/1000,
        'extent':[(FULL[0]-1)/longest,(FULL[2]-1)/longest,(FULL[1]-1)/longest],
        'brickSize':64,'storedEdge':65,'brickCountsXYZ':counts.tolist(),'codec':'gzip-u8-zyx-positive-halo',
        'decodedBrickBytes':65**3,'emptyValue':0,'assetBaseUrl':f'/api/donors/{SLUG}/volume/',
        'sourceHttp':BASE+'2/','source':'s2-clean-display-u8.npy','cleaned':True,'quantitativeIntensityData':False,
        'sourceWindow':list(SOURCE_WINDOW),'sourceMaskSha256':meta['identity']['maskSha256'],
        'totalEncodedBytes':sum(e['bytes'] for e in records.values()),'blocks':records,'preparedPlanes':[]}
    write_json(root/'public/assets/donors'/SLUG/'ultra-volume.json',manifest,True)
    write_json(root/'server/donors'/SLUG/'volume-index.json',{e['path']:{'bytes':e['bytes'],'sha256':e['sha256']} for e in records.values()},True)
    write_json(root/'docs/donors'/SLUG/'brick-preparation.json',{
        'sourceSpacingUm':FINE_SPACING,'sourceShapeXYZ':meta['shapeXYZ'],'fullDimensionsXYZ':FULL.tolist(),
        'decodedSourceBytes':int(data.size),'nonemptyBrickCount':len(records),'implicitEmptyBrickCount':len(jobs)-len(records),
        'encodedBytes':manifest['totalEncodedBytes'],'storedEdge':65,'brickSize':64,
        'allBrickRoundTripsExact':True,'maximumDisplayByteError':0,
        'encoding':'Lossless uint8 display-density gzip bricks with one positive halo for continuous trilinear sampling.',
        'elapsedSeconds':round(time.monotonic()-start,2)})
    print(json.dumps({'stage':'bricks-ready','files':len(records),'bytes':manifest['totalEncodedBytes']}),flush=True)


def bootstrap(cache, root):
    """Use recorded public provenance, then verify the live OME coordinate contract."""
    docs=root/'docs/donors'/SLUG
    for name in ['source-metadata.json','source-neuroglancer.json']:
        target=cache/name
        if not target.exists():
            snapshot=docs/name
            if not snapshot.exists():
                raise FileNotFoundError(f'Missing source provenance: {snapshot}')
            target.write_bytes(snapshot.read_bytes())
    payload,_=fetch(BASE+'.zattrs',cache/'zarr-.zattrs')
    fetch(BASE+'.zgroup',cache/'zarr-.zgroup')
    multiscale=json.loads(payload)['multiscales'][0]
    if [a['name'] for a in multiscale['axes']] != ['x','y','z']:
        raise ValueError('OME source axes changed; inspect before processing.')
    by_path={d['path']:d for d in multiscale['datasets']}
    for level in ['0','2','4']:
        attributes(cache,level)
        transforms=by_path[level]['coordinateTransformations']
        scale=next(t['scale'] for t in transforms if t['type']=='scale')
        translation=next(t['translation'] for t in transforms if t['type']=='translation')
        spacing=NATIVE_SPACING*2**int(level)
        if not np.allclose(scale,[spacing]*3,rtol=0,atol=1e-8) or not np.allclose(translation,[spacing/2]*3,rtol=0,atol=1e-8):
            raise ValueError('OME physical coordinate transforms changed; inspect before processing.')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cache',type=Path,default=Path('/workspace/data/heart-donor-2298522198'))
    p.add_argument('--project',type=Path,default=PROJECT)
    p.add_argument('--workers',type=int,default=12)
    p.add_argument('--stage',choices=['preview','fine','sections','bricks','all'],default='all')
    args=p.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
    bootstrap(args.cache,args.project)
    stages=['preview','fine','sections','bricks'] if args.stage=='all' else [args.stage]
    for stage in stages:globals()[stage](args.cache,args.project,max(1,min(args.workers,24)))

if __name__=='__main__':main()
