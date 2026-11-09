"""Encode registered, cropped 79.4 µm sections from authentic HOA N5 s2 data.

Run download_s2.py first. Only an existing conservative exterior support mask
is applied: values inside it retain the original display window at every
threshold. Empty margins are cropped, never stretched. The optional bounded
gray-level quantization changes intensities only, without spatial filtering.
"""
from pathlib import Path
import argparse
import concurrent.futures
import gzip
import hashlib
import io
import json
import time

import numpy as np
from PIL import Image

PROJECT = Path(__file__).resolve().parents[1]
FULL_XYZ = (1897,1897,2117)
COUNTS = (475,475,530)
WINDOW = (14640,23545)
SPACING = 79.4


def prepare_display(root, support_path):
    """Memory-map a compact bounding box with exactly the renderer's mask."""
    support_bytes = gzip.decompress(support_path.read_bytes())
    support = np.frombuffer(support_bytes, np.uint8).reshape((265,238,238))
    source_stat=(root/'s2-supported-u16.npy').stat()
    identity = {'maskSha256':hashlib.sha256(support_bytes).hexdigest(),
                'window':WINDOW, 'fullXYZ':FULL_XYZ,
                'source':'s2-supported-u16.npy','sourceSize':source_stat.st_size,
                'sourceMtimeNs':source_stat.st_mtime_ns}
    cache_path = root/'s2-clean-display.json'
    data_path = root/'s2-clean-display-u8.npy'
    if cache_path.exists() and data_path.exists():
        cache = json.loads(cache_path.read_text())
        if json.dumps(cache['identity'], sort_keys=True) == json.dumps(identity, sort_keys=True):
            return np.load(data_path, mmap_mode='r'), cache['originXYZ']
    coords = [np.floor(np.arange(n)*(s-1)/(n-1)+.5).astype(int)
              for n,s in zip(FULL_XYZ,(238,238,265))]
    sz,sy,sx = np.where(support)
    limits = []
    for axis, positions in enumerate((sx,sy,sz)):
        valid = np.flatnonzero((coords[axis]>=positions.min()) &
                              (coords[axis]<=positions.max()))
        start = int(valid.min()//2*2)
        end = int(min(FULL_XYZ[axis]-1,(int(valid.max())+1)//2*2))
        limits.append((start,end))
    origin = [a for a,b in limits]
    shape_xyz = [b-a+1 for a,b in limits]
    source = np.load(root/'s2-supported-u16.npy',mmap_mode='r')
    display = np.lib.format.open_memmap(data_path,mode='w+',dtype=np.uint8,
                                      shape=tuple(shape_xyz[::-1]))
    x0,x1=limits[0];y0,y1=limits[1];z0,z1=limits[2]
    xx=coords[0][x0:x1+1];yy=coords[1][y0:y1+1]
    for z in range(z0,z1+1):
        plane = source[z,y0:y1+1,x0:x1+1].astype(np.float32)
        values = np.rint(np.clip((plane-WINDOW[0])*255/(WINDOW[1]-WINDOW[0]),0,255)).astype(np.uint8)
        inside = support[coords[2][z]][np.ix_(yy,xx)]>0
        values[~inside]=0
        display[z-z0]=values
    display.flush()
    cache={'identity':identity,'originXYZ':origin,'shapeXYZ':shape_xyz,
           'supportMask':'Existing conservative display-cleanup support',
           'outsideSupportValue':0,'quantitativeIntensityData':False}
    cache_path.write_text(json.dumps(cache,indent=2)+'\n')
    return display,origin


def section(display, origin, axis, index):
    axis_id='xyz'.index(axis)
    source_index=4*index
    local=source_index-origin[axis_id]
    dims=display.shape[::-1]
    full_width=FULL_XYZ[1] if axis=='x' else FULL_XYZ[0]
    full_height=FULL_XYZ[1] if axis=='z' else FULL_XYZ[2]
    if local<0 or local>=dims[axis_id]:
        return np.zeros((1,1),np.uint8),[0,0,1,1],full_width,full_height
    if axis=='x':
        plane=display[:,:,local];ox,oy=origin[1],origin[2]
    elif axis=='y':
        plane=display[:,local,:];ox,oy=origin[0],origin[2]
    else:
        plane=display[local,:,:];ox,oy=origin[0],origin[1]
    # A two-sample zero guard preserves reconstruction at crop edges. Origins
    # and final pixel centers stay even, enabling exact alternate-pixel detail.
    rows=np.flatnonzero(np.any(plane,axis=1));cols=np.flatnonzero(np.any(plane,axis=0))
    if not len(rows) or not len(cols):
        return np.zeros((1,1),np.uint8),[0,0,1,1],full_width,full_height
    x0=max(0,(int(cols[0])-2)//2*2);y0=max(0,(int(rows[0])-2)//2*2)
    x1=min(plane.shape[1]-1,(int(cols[-1])+3)//2*2)
    y1=min(plane.shape[0]-1,(int(rows[-1])+3)//2*2)
    crop=[x0+ox,y0+oy,x1-x0+1,y1-y0+1]
    assert crop[0]%2==0 and crop[1]%2==0 and crop[2]%2==1 and crop[3]%2==1,crop
    return np.ascontiguousarray(plane[y0:y1+1,x0:x1+1]),crop,full_width,full_height


def encode_pixels(pixels, codec, quant_step=1, quality=95, lossless=False, speed=6, method=4):
    if quant_step>1:
        pixels=np.minimum(255,(pixels.astype(np.uint16)+quant_step//2)//quant_step*quant_step).astype(np.uint8)
    result=io.BytesIO()
    options={'compress_level':9} if codec=='png' else (
        {'lossless':lossless,'quality':quality,'method':method,'exact':True}
        if codec=='webp' else {'quality':quality,'speed':speed,'max_threads':1})
    Image.fromarray(pixels).save(result,format=codec.upper(),**options)
    return result.getvalue()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--support',type=Path,default=PROJECT/'public/assets/cleanup/heart-support.raw.gz')
    parser.add_argument('--codec',choices=['png','webp','avif'],default='webp')
    parser.add_argument('--quality',type=int,default=95)
    parser.add_argument('--lossless',action='store_true')
    parser.add_argument('--quant-step',type=int,default=1)
    parser.add_argument('--speed',type=int,default=6)
    parser.add_argument('--method',type=int,default=4)
    parser.add_argument('--asset-base',default='/api/ultra/v4/')
    parser.add_argument('--workers',type=int,default=6)
    parser.add_argument('--sample-step',type=int,default=1,
                        help='For codec sizing only; non-1 does not create a production manifest.')
    args=parser.parse_args()
    started=time.monotonic()
    args.output.mkdir(parents=True,exist_ok=True)
    for axis in 'xyz':(args.output/axis).mkdir(exist_ok=True)
    display,origin=prepare_display(args.data_root,args.support)
    print('Prepared display',list(display.shape),'origin',origin,flush=True)
    empty=encode_pixels(np.zeros((1,1),np.uint8),args.codec,args.quant_step,
                        args.quality,args.lossless,args.speed,args.method)
    (args.output/f'empty.{args.codec}').write_bytes(empty)
    jobs=[(axis,index) for axis,count in zip('xyz',COUNTS)
          for index in range(0,count,args.sample_step)]
    records=[]

    def encode(job):
        axis,index=job
        pixels,crop,full_width,full_height=section(display,origin,axis,index)
        is_empty=pixels.shape==(1,1) and pixels[0,0]==0
        payload=empty if is_empty else encode_pixels(pixels,args.codec,args.quant_step,
                                                    args.quality,args.lossless,args.speed,args.method)
        path=f'empty.{args.codec}' if is_empty else f'{axis}/{index:04d}.{args.codec}'
        if not is_empty:(args.output/path).write_bytes(payload)
        record={'axis':axis,'index':index,'sourceIndex':4*index,'path':path,
                'crop':crop,'fullWidth':full_width,'fullHeight':full_height,
                'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest(),
                'sourceDisplaySha256':hashlib.sha256(pixels.tobytes()).hexdigest(),
                'empty':bool(is_empty),'retainedPixels':int(np.count_nonzero(pixels))}
        if not is_empty and ((args.lossless or args.codec=='png') or index%20==0 or index in (220,237,363)):
            decoded=np.asarray(Image.open(io.BytesIO(payload)).convert('L'))
            error=decoded.astype(np.int16)-pixels.astype(np.int16)
            tissue=pixels>81
            errs=error[tissue] if tissue.any() else error[pixels>0]
            mse=float(np.mean(errs.astype(float)**2))
            record['validation']={'tissuePixels':int(tissue.sum()),
                'meanAbsoluteError':float(np.abs(errs).mean()),
                'maximumAbsoluteError':int(np.abs(error).max()),
                'psnrDb':float(10*np.log10(255**2/mse)) if mse else None}
            if args.quant_step==1 and (args.lossless or args.codec=='png'):
                assert np.array_equal(decoded,pixels),(axis,index,'Lossless round trip failed')
                record['losslessRoundTripVerified']=True
        return record

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for record in pool.map(encode,jobs):
            records.append(record)
            if len(records)%50==0 or len(records)==len(jobs):
                size=sum(r['bytes'] for r in records if not r['empty'])+len(empty)
                print(f'{len(records)}/{len(jobs)} images; {size/1e6:.2f} MB; '
                      f'{time.monotonic()-started:.1f}s',flush=True)
    metadata={'codec':args.codec,'quality':args.quality,'lossless':args.lossless or args.codec=='png',
              'quantizationStep':args.quant_step,'sampleStep':args.sample_step,'method':args.method,
              'originXYZ':origin,'encodedBytes':sum(r['bytes'] for r in records if not r['empty'])+len(empty),
              'elapsedSeconds':round(time.monotonic()-started,2),'records':records}
    (args.output/'encoding-records.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(json.dumps({k:v for k,v in metadata.items() if k!='records'}),flush=True)
    if args.sample_step!=1:return
    manifest={
        'schemaVersion':2,'specimen':'LADAF-2021-17','organ':'heart',
        'datasetUrl':'https://human-organ-atlas.esrf.fr/datasets/1659197537',
        'doi':'10.15151/ESRF-DC-1634390196','license':'CC BY 4.0',
        'attribution':'Brunet et al. / ESRF Human Organ Atlas',
        'sourceScale':'s2','sourceDimensionsXYZ':[1903,1903,2120],
        'sourceDtype':'uint16','sourceWindow':list(WINDOW),'displayDtype':'uint8',
        'sourceSpacingUm':SPACING,'spacingUm':SPACING,'nativeSpacingUm':19.85,
        'sourceIndexStep':4,'sliceSpacingUm':317.6,'sliceCounts':list(COUNTS),
        'imageDimensionsXYZ':list(FULL_XYZ),
        'physicalCenterExtentUm':[(v-1)*SPACING for v in FULL_XYZ],
        'format':'image/'+args.codec,'compressionLossless':bool((args.lossless or args.codec=='png') and args.quant_step==1),
        'codecLossless':bool(args.lossless or args.codec=='png'),
        'grayQuantizationStep':args.quant_step,'quality':args.quality,
        'totalBytes':metadata['encodedBytes'],'imageCount':len(records),
        'nonemptyImageCount':sum(not r['empty'] for r in records),
        'cropped':True,'hosted':True,'emptyPath':f'empty.{args.codec}',
        'assetBaseUrl':args.asset_base,
        'registration':'Section i uses exact N5 s2 index 4*i. Crop x/y is the position of the first stored pixel center in the full image. No flip, spatial upsampling, or sharpening is applied. Crop origins are even and dimensions odd, enabling exact alternate-pixel 158.8 um display.',
        'background':'Values outside the existing conservative organ-support mask are zero. All original windowed values inside support are retained before the documented image compression; no rendering-threshold clipping is applied.',
        'supportMaskSha256':hashlib.sha256(gzip.decompress(args.support.read_bytes())).hexdigest(),
        'limitations':'Windowed 8-bit display textures, not quantitative raw intensity data or native 19.85 um detail. The hosted Ultra pack includes conservative exterior cleanup; turning off the viewer cleanup does not restore the omitted exterior background in these textures.',
        'slices':{axis:[{k:r[k] for k in ('path','crop','bytes','empty','sha256','sourceDisplaySha256')}
                         for r in records if r['axis']==axis] for axis in 'xyz'},
        'generatedDate':'2026-11-04','generator':'scripts/prepare_hosted_sections.py',
    }
    (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')


if __name__=='__main__':main()
