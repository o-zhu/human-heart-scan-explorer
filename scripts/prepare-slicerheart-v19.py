#!/usr/bin/env python3
"""Prepare a measured SlicerHeart 4D CT pilot without spatial resampling.

The original public NRRD stays in the research working directory. A single
explicit XYZ crop is shared by every measured phase. Display values are a
documented bounded quantization of the source signed-short intensities, and
frame gzip payloads round-trip byte-exactly. This is not a healthy reference,
an anatomical segmentation, or a paired-ultrasound dataset.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import math
import re
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = 'https://github.com/SlicerHeart/SlicerHeart/releases/download/TestingData/TruncalValve_4DCT.seq.nrrd'
SOURCE_SHA = '7573f1bc7ca92d7d1012eecf98211cfd9939c1d22d87aee1db91c8ab72031cfb'
SOURCE_BYTES = 1267650314
EXPECTED_SHAPE = (218, 391, 512, 21)  # source axis0 list is fastest, then X/Y/Z
SPACING_MM = [0.599609375, 0.599609375, 0.6999999999999998]
SOURCE_WINDOW = [-200, 1000]
SERIES_SPECS = [
    dict(id='overview', label='Cardiac overview · 21 phases',
         cropXYZ=[[60,350],[115,365],[0,218]], stride=2, phaseIndices=list(range(21)),
         description='Fixed cardiac crop at 2× overview spacing; each sample averages its 2×2×2 native source block.'),
    dict(id='native-detail', label='Valve / outflow detail · native spacing',
         cropXYZ=[[140,300],[180,310],[80,180]], stride=1, phaseIndices=list(range(21)),
         defaultFrame=10, defaultSlice=dict(axis=2, position=55/99, flipVertical=False),
         description='Native-spacing heart-base region containing the truncal valve/outflow; peripheral chambers are outside this detail crop.'),
    dict(id='native-reference', label='Cardiac reference · native phase 0',
         cropXYZ=[[60,350],[115,365],[0,218]], stride=1, phaseIndices=[0],
         description='Full cardiac crop at native spacing, source phase 0 only. This reference is static.'),
]
FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
SMALL = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)


def sha_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        while block := f.read(8*1024*1024): h.update(block)
    return h.hexdigest()


def nrrd_header(source):
    with source.open('rb') as f:
        lines=[]
        while True:
            line=f.readline()
            if not line: raise ValueError('NRRD has no header terminator')
            lines.append(line)
            if len(b''.join(lines))>1024*1024: raise ValueError('Unexpectedly large NRRD header')
            if line in (b'\n',b'\r\n'): break
        offset=f.tell()
    text=b''.join(lines).decode('ascii')
    fields={}
    for line in text.splitlines()[1:]:
        if not line or line.startswith('#'): continue
        sep=':=' if ':=' in line else ':'
        key,value=line.split(sep,1);fields[key.strip()]=value.strip()
    assert fields['type']=='short' and fields['encoding']=='gzip' and fields['endian']=='little'
    assert fields['space']=='right-anterior-superior'
    assert fields['sizes']=='21 512 391 218' and fields['kinds']=='list domain domain domain'
    assert fields['axis 0 index values']==' '.join(map(str,range(21)))
    directions=re.findall(r'\(([^)]+)\)',fields['space directions'])
    directions=[list(map(float,v.split(','))) for v in directions]
    assert np.allclose(directions,np.diag(SPACING_MM),rtol=0,atol=1e-10)
    origin=list(map(float,fields['space origin'].strip('()').split(',')))
    return dict(text=text,offset=offset,fields=fields,spacingMm=SPACING_MM,
                directionsRAS=directions,originRASmm=origin,
                phaseIndexValues=list(range(21)),physicalPhaseTimesKnown=False)


def source_array(source,work):
    work.mkdir(parents=True,exist_ok=True)
    assert source.stat().st_size==SOURCE_BYTES,'Unexpected original source size'
    assert sha_file(source)==SOURCE_SHA,'Source differs from official SlicerHeart SHA256'
    header=nrrd_header(source)
    raw=work/'source-zyxt-int16.raw';expected=math.prod(EXPECTED_SHAPE)*2
    if not raw.exists() or raw.stat().st_size!=expected:
        temporary=raw.with_suffix('.raw.part')
        with source.open('rb') as original,temporary.open('wb') as out:
            original.seek(header['offset'])
            with gzip.GzipFile(fileobj=original,mode='rb') as data:
                shutil.copyfileobj(data,out,length=8*1024*1024)
        assert temporary.stat().st_size==expected,'Decoded length differs from NRRD dimensions'
        temporary.replace(raw)
    arr=np.memmap(raw,dtype='<i2',mode='r',shape=EXPECTED_SHAPE)
    return arr,header


def grayscale(values,low=-160,high=700):
    return np.rint(np.clip((values.astype(np.float32)-low)/(high-low),0,1)*255).astype(np.uint8)


def source_review(arr,work):
    plans=[('Axial Z',i,arr[i,:,:,0]) for i in [20,55,90,125,160,195]]
    plans += [('Coronal Y',i,arr[:,i,:,0]) for i in [60,110,160,210,260,310]]
    plans += [('Sagittal X',i,arr[:,:,i,0]) for i in [100,160,220,280,340,400]]
    cellw,cellh=530,430
    sheet=Image.new('RGB',(3*cellw,6*cellh),(8,12,15));draw=ImageDraw.Draw(sheet)
    for k,(axis,index,pixels) in enumerate(plans):
        col=k//6;row=k%6;x=col*cellw;y=row*cellh
        image=Image.fromarray(grayscale(pixels)).convert('RGB')
        image.thumbnail((cellw-10,cellh-45),Image.Resampling.LANCZOS)
        sheet.paste(image,(x+(cellw-image.width)//2,y+35+(cellh-45-image.height)//2))
        draw.text((x+10,y+8),f'{axis}={index} · measured phase0',fill='white',font=FONT)
    sheet.save(work/'source-plane-review.jpg',quality=94)
    samples=np.asarray(arr[::3,::3,::3,:],dtype=np.int16)
    summary=dict(sourceUrl=SOURCE_URL,sourceSha256=SOURCE_SHA,sourceBytes=SOURCE_BYTES,
                 decodedBytes=int(arr.nbytes),shapeZYXT=list(arr.shape),spacingMm=SPACING_MM,
                 intensityUnits='Stored CT scalar values; the NRRD does not declare a Hounsfield calibration.',
                 sampledMin=int(samples.min()),sampledMax=int(samples.max()),
                 sampledPercentiles={str(q):float(np.percentile(samples,q)) for q in [0,.1,1,5,25,50,75,95,99,99.9,100]},
                 phaseIndexValues=list(range(21)),physicalPhaseTimesKnown=False,
                 pathology='Adolescent with repaired truncus arteriosus, as described by the official SlicerHeart sample registration.',
                 exactAgeKnown=False,sexKnown=False,pairedUltrasoundIdentified=False)
    (work/'source-review.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary),flush=True)


def crop_phase(arr, crop, phase, stride):
    (x0,x1),(y0,y1),(z0,z1)=crop
    values=np.asarray(arr[z0:z1,y0:y1,x0:x1,phase],dtype=np.float32)
    if stride==2:
        z,y,x=values.shape
        assert all(n%2==0 for n in values.shape)
        values=values.reshape(z//2,2,y//2,2,x//2,2).mean(axis=(1,3,5))
    else: assert stride==1
    return values


def quantify(values, quantized):
    low,high=SOURCE_WINDOW
    inside=(values>=low)&(values<=high)
    decoded=low+quantized.astype(np.float32)*(high-low)/255
    error=np.abs(decoded[inside]-values[inside])
    return dict(voxels=int(values.size), belowWindowVoxels=int((values<low).sum()),
                aboveWindowVoxels=int((values>high).sum()),
                withinWindowVoxels=int(inside.sum()),
                withinWindowMaxAbsoluteError=float(error.max()),
                withinWindowMeanAbsoluteError=float(error.mean()),
                withinWindowRmse=float(np.sqrt(np.mean(error*error))),
                errorUnits='Stored source scalar units; overview errors are relative to the 2×2×2 block mean.')


def encode_series(arr, header, spec, output):
    folder=output/spec['id'];folder.mkdir(parents=True,exist_ok=True)
    starts=np.array([v[0] for v in spec['cropXYZ']],dtype=float)
    sizes=np.array([v[1]-v[0] for v in spec['cropXYZ']],dtype=int)
    native_spacing=np.array(SPACING_MM)
    native_origin=np.array(header['originRASmm'])+starts*native_spacing
    stride=spec['stride'];spacing=native_spacing*stride
    origin=native_origin+native_spacing*(stride-1)/2
    dimensions=(sizes//stride).tolist()
    frames=[];all_metrics=[];seen={};unique_bytes=0
    for phase in spec['phaseIndices']:
        values=crop_phase(arr,spec['cropXYZ'],phase,stride)
        quantized=grayscale(values,*SOURCE_WINDOW)
        raw=quantized.tobytes(order='C')
        decoded_sha=hashlib.sha256(raw).hexdigest()
        metrics=quantify(values,quantized);metrics['index']=phase;all_metrics.append(metrics)
        if decoded_sha in seen:
            original=seen[decoded_sha]
            entry=dict(original,index=phase,duplicatesFrameIndex=original['index'])
        else:
            payload=gzip.compress(raw,compresslevel=9,mtime=0)
            assert gzip.decompress(payload)==raw,'Frame gzip verification failed'
            filename=f'frame-{phase:02d}.raw.gz'
            (folder/filename).write_bytes(payload)
            entry=dict(index=phase,url=f'/assets/clinical-v19/slicerheart/{spec["id"]}/{filename}',
                       compressedBytes=len(payload),decodedBytes=len(raw),
                       sha256=hashlib.sha256(payload).hexdigest(),decodedSha256=decoded_sha)
            seen[decoded_sha]=entry;unique_bytes+=len(payload)
        frames.append(entry)
        print(json.dumps(dict(series=spec['id'],phase=phase,bytes=entry['compressedBytes'],
                              duplicateOf=entry.get('duplicatesFrameIndex'))),flush=True)
    dimensions_native=sizes.tolist()
    result=dict(id=spec['id'],label=spec['label'],modality='CT',description=spec['description'],
                dimensions=dimensions,spacingMm=spacing.tolist(),frames=frames,
                sourceWindow=SOURCE_WINDOW,defaultThreshold=.36,
                defaultFrame=spec.get('defaultFrame',0),
                defaultSlice=spec.get('defaultSlice',dict(axis=2,position=.5,flipVertical=False)),
                displayWindow=dict(windowEnabled=True,windowLow=.05,windowHigh=.917,
                                   windowGamma=.9,capContrast=1,cutFaceExposure=1),
                encoding=dict(dtype='uint8',compression='gzip',voxelOrder='X-fastest; ZYX C order',
                              transfer='round(clamp((source - (-200)) / 1200, 0, 1) * 255)',
                              storedIntensityLevels=256,maximumWithinWindowQuantizationError=1200/510,
                              intensityUnits='Stored CT scalar values; HU calibration is not declared by the source NRRD.'),
                sourceCrop=dict(boundsXYZ=spec['cropXYZ'],endExclusive=True,nativeDimensions=dimensions_native,
                                fixedAcrossAllPhases=True,physicalSupportRASmm=[
                                    (native_origin-native_spacing/2).tolist(),
                                    (native_origin+(sizes-.5)*native_spacing).tolist()]),
                geometry=dict(space='right-anterior-superior',originRASmm=origin.tolist(),
                              directionsRAS=np.diag(spacing).tolist(),
                              nativeSpacingMm=SPACING_MM,
                              resampling='none; native source samples' if stride==1 else '2×2×2 arithmetic block mean, then intensity encoding'),
                measuredPhaseIndices=spec['phaseIndices'],physicalPhaseTimesKnown=False,
                temporalInterpolation=False,playbackFrameCount=len(seen),
                loopClosingFrameIndex=20 if len(frames)==21 else None,
                uniqueCompressedBytes=unique_bytes,uniqueFrameFiles=len(seen),
                staticReference=len(frames)==1)
    return result,all_metrics


def write_review(arr, spec, work):
    phases=[0,5,10,15,20] if len(spec['phaseIndices'])>1 else [0]
    cellw,cellh=400,335
    sheet=Image.new('RGB',(3*cellw,len(phases)*cellh),(8,12,15));draw=ImageDraw.Draw(sheet)
    for row,phase in enumerate(phases):
        values=crop_phase(arr,spec['cropXYZ'],phase,spec['stride'])
        z,y,x=values.shape
        for col,(label,pixels) in enumerate([
            ('Axial',values[z//2]),('Coronal',values[:,y//2,:][::-1]),('Sagittal',values[:,:,x//2][::-1])]):
            encoded=grayscale(pixels,*SOURCE_WINDOW)
            image=Image.fromarray(encoded).convert('RGB')
            magnification=min((cellw-15)/image.width,(cellh-45)/image.height)
            image=image.resize((round(image.width*magnification),round(image.height*magnification)),
                               Image.Resampling.NEAREST)
            xx=col*cellw;yy=row*cellh
            sheet.paste(image,(xx+(cellw-image.width)//2,yy+35+(cellh-45-image.height)//2))
            draw.text((xx+10,yy+8),f'{label} · source phase {phase}',fill='white',font=FONT)
    sheet.save(work/f'{spec["id"]}-phase-review.jpg',quality=95)


def complete_descriptions(manifest):
    """Keep source context visible in the shared clinical-pilot interface."""
    manifest['defaultSeries']='overview'
    manifest['description']='Measured 4D CT of an adolescent with repaired truncus arteriosus; a clinical example, not a healthy reference.'
    manifest['source']['citation']='SlicerHeart sample data, Truncal Valve 4D CT. Lasso et al., SlicerHeart: An open-source computing platform for cardiac image analysis and modeling. Frontiers in Cardiovascular Medicine 9 (2022), doi:10.3389/fcvm.2022.886549.'
    manifest['source']['license']='The SlicerHeart project BSD-3-Clause notice is preserved. No separate data-specific license statement was found attached to this public sample release asset.'
    for series in manifest['series']:
        overview=series['id']=='overview'
        series['isOverview']=overview
        series['spatialResampling']=overview
        series['samplingDescription']=('1.199 × 1.199 × 1.4 mm overview; 2×2×2 block means of the native source grid' if overview else
                                       '0.600 × 0.600 × 0.700 mm native stored grid; no spatial resampling')
        series['phaseDescription']=('Source indices 0–20; index 20 exactly repeats index 0. Playback uses the 20 unique volumes; physical phase timing is not supplied.' if not series['staticReference'] else
                                    'Source phase 0 only, retained as a static native-spacing reference.')
        series['notes']=[series['description'],
                         'Acquired CT anatomy with a fixed 8-bit display window; the original signed-short source remains available.',
                         'This case has repaired congenital heart disease; no matched ultrasound is identified.']
    return manifest


def encode_pilot(arr,header,work,output):
    output.mkdir(parents=True,exist_ok=True)
    # The final listed index is a repeated closing frame, not a new acquisition.
    # Verify the complete native volume, rather than infer this from a thumbnail.
    closing_equal=all(np.array_equal(arr[z:z+16,:,:,0],arr[z:z+16,:,:,20])
                      for z in range(0,arr.shape[0],16))
    assert closing_equal,'The expected closing duplicate is not identical'
    series=[];metrics={}
    for spec in SERIES_SPECS:
        item,measurements=encode_series(arr,header,spec,output)
        series.append(item);metrics[spec['id']]=measurements
        write_review(arr,spec,work)
    manifest=dict(version=1,id='slicerheart-truncal-valve-4dct',label='SlicerHeart · 4D cardiac CT',
                  modality='CT',sourceUrl=SOURCE_URL,
                  source=dict(originalFilename='TruncalValve_4DCT.seq.nrrd',url=SOURCE_URL,
                              bytes=SOURCE_BYTES,sha256=SOURCE_SHA,
                              dimensions=[512,391,218],spacingMm=SPACING_MM,
                              space='right-anterior-superior',originRASmm=header['originRASmm'],
                              directionsRAS=header['directionsRAS'],dtype='int16',
                              phaseIndices=list(range(21)),uniqueSpatialFrames=20,
                              closingFrameIdenticalToFirst=closing_equal,
                              phaseTiming='The NRRD supplies numeric indices 0–20, without physical phase times or ECG percentages.'),
                  clinicalContext='Adolescent with repaired truncus arteriosus, according to the official SlicerHeart sample registration.',
                  healthyReference=False,exactAgeKnown=False,sexKnown=False,pairedUltrasoundIdentified=False,
                  sourceAttribution=dict(project='SlicerHeart',
                       sourceCode='https://github.com/SlicerHeart/SlicerHeart/blob/master/ValveAnnulusAnalysis/ValveAnnulusAnalysis.py',
                       projectLicense='BSD-3-Clause',licenseNotice='/assets/clinical-v19/slicerheart/SlicerHeart-LICENSE.txt',
                       dataLicenseNote='Public project sample data; no separate data-specific license statement was found attached to this release asset. The repository BSD-3-Clause notice is preserved; it is not represented as a separate clinical-data license.',
                       paperDoi='10.3389/fcvm.2022.886549'),
                  notes=['Measured source phases; no generated intermediate phases.',
                         'Playback timing is illustrative because physical acquisition phase timing is absent.',
                         'The native detail series is a heart-base ROI, not a whole-heart segmentation.',
                         'Air and high-density structures outside the recorded display window are clipped in this uint8 display derivative.',
                         'Original acquisition noise and metal-related artifacts remain present.'],
                  totalUniqueCompressedBytes=sum(s['uniqueCompressedBytes'] for s in series),
                  series=series)
    complete_descriptions(manifest)
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (output/'source-header.txt').write_text(header['text'])
    license_path=work/'SlicerHeart-LICENSE.txt'
    assert license_path.exists(),'Preserve the upstream project license notice'
    shutil.copy2(license_path,output/'SlicerHeart-LICENSE.txt')
    report=dict(sourceVerifiedAgainstOfficialSHA256=True,sourceClosingFrameFullyVerified=closing_equal,
                allGzipPayloadsRoundTripByteExactly=True,
                totalUniqueCompressedBytes=manifest['totalUniqueCompressedBytes'],
                quantization=metrics,
                caveats=['Error measurements exclude clipped values and do not establish perceptual or diagnostic equivalence.',
                         'The overview uses spatial averaging; native reference and native detail do not.',
                         'Cardiac crop coverage was visually reviewed on multiple planes and phases; it is not an expert anatomical segmentation.'])
    (work/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(complete=True,totalUniqueCompressedBytes=manifest['totalUniqueCompressedBytes'],
                         series=[dict(id=s['id'],dimensions=s['dimensions'],files=s['uniqueFrameFiles'],bytes=s['uniqueCompressedBytes']) for s in series])),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--work',type=Path,required=True)
    parser.add_argument('--review',action='store_true')
    parser.add_argument('--output',type=Path,help='Write the documented three-series display pilot here')
    args=parser.parse_args()
    arr,header=source_array(args.source,args.work)
    (args.work/'source-header.txt').write_text(header['text'])
    (args.work/'source-geometry.json').write_text(json.dumps({k:v for k,v in header.items() if k!='text'},indent=2)+'\n')
    if args.review: source_review(arr,args.work)
    if args.output: encode_pilot(arr,header,args.work,args.output)


if __name__=='__main__':main()
