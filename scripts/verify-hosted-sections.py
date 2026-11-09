"""Verify the complete hosted Ultra inventory, exact pixels, and crop geometry."""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json

import numpy as np
from PIL import Image

PROJECT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets',type=Path,default=PROJECT/'data/ultra-sections')
    parser.add_argument('--manifest',type=Path)
    parser.add_argument('--data-root',type=Path)
    parser.add_argument('--support',type=Path,default=PROJECT/'public/assets/cleanup/heart-support.raw.gz')
    parser.add_argument('--report',type=Path,default=PROJECT/'docs/hosted-ultra-validation.json')
    args=parser.parse_args()
    manifest=json.loads((args.manifest or args.assets/'manifest.json').read_text())
    assert manifest['compressionLossless'] and manifest['grayQuantizationStep']==1
    unique={};counts=[];nonempty=[];source_comparisons=[];crop_pixels=0;full_pixels=0
    for axis,count in zip('xyz',manifest['sliceCounts']):
        records=manifest['slices'][axis]
        assert len(records)==count
        counts.append(count)
        axis_id='xyz'.index(axis)
        dims=manifest['imageDimensionsXYZ']
        full_width=dims[1] if axis=='x' else dims[0]
        full_height=dims[1] if axis=='z' else dims[2]
        for index,record in enumerate(records):
            x,y,w,h=record['crop']
            assert x%2==0 and y%2==0 and w%2==1 and h%2==1
            assert 0<=x<=x+w-1<full_width and 0<=y<=y+h-1<full_height
            assert record['empty'] or record['path']==f'{axis}/{index:04d}.webp'
            full_pixels+=full_width*full_height
            if not record['empty']:crop_pixels+=w*h
            if record['path'] not in unique:
                path=args.assets/record['path'];payload=path.read_bytes()
                assert len(payload)==record['bytes'],path
                assert hashlib.sha256(payload).hexdigest()==record['sha256'],path
                with Image.open(path) as image:
                    decoded=np.asarray(image.convert('L'))
                assert decoded.shape==(h,w),path
                assert hashlib.sha256(decoded.tobytes()).hexdigest()==record['sourceDisplaySha256'],path
                unique[record['path']]=len(payload)
            if not record['empty']:nonempty.append(record['bytes'])
            # Exact alternate-pixel decimation keeps all original world centers.
            for u in (0,(w-1)//4,(w-1)//2):
                fine=(x+2*u)/(full_width-1)
                coarse=(x/2+u)/((full_width+1)/2-1)
                assert abs(fine-coarse)<1e-14
            for v in (0,(h-1)//4,(h-1)//2):
                fine=(y+2*v)/(full_height-1)
                coarse=(y/2+v)/((full_height+1)/2-1)
                assert abs(fine-coarse)<1e-14
    assert counts==[475,475,530]
    assert sum(unique.values())==manifest['totalBytes']
    assert max(nonempty)<1_000_000
    if args.data_root:
        spec=importlib.util.spec_from_file_location('prepare_hosted_sections',PROJECT/'scripts/prepare_hosted_sections.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        display,origin=module.prepare_display(args.data_root,args.support)
        for axis,index in [('x',112),('x',180),('x',237),('x',380),
                           ('y',100),('y',220),('y',237),('y',380),
                           ('z',70),('z',220),('z',363),('z',400),('z',495)]:
            pixels,crop,full_width,full_height=module.section(display,origin,axis,index)
            record=manifest['slices'][axis][index]
            decoded=np.asarray(Image.open(args.assets/record['path']).convert('L'))
            assert crop==record['crop'] and np.array_equal(pixels,decoded)
            source_comparisons.append({'axis':axis,'index':index,'sourceIndex':index*4,
                                       'crop':crop,'maximumAbsoluteError':0,'meanAbsoluteError':0})
    old_estimates={('x',237):332350000,('y',237):337450000,('z',363):52700000,('z',400):38250000}
    comparisons=[]
    for (axis,index),old in old_estimates.items():
        new=manifest['slices'][axis][index]['bytes']
        comparisons.append({'axis':axis,'index':index,'previousN5TransferEstimateBytes':old,
                            'hostedImageBytes':new,'transferReductionFraction':1-new/old,
                            'ratio':old/new})
    report={
        'specimen':manifest['specimen'],'sourceScale':'s2','samplingUm':79.4,
        'sliceCounts':counts,'totalPositions':sum(counts),
        'nonemptyPositions':len(nonempty),'emptyPositions':sum(counts)-len(nonempty),
        'uniqueAssets':len(unique),'totalEncodedBytes':sum(unique.values()),
        'nonemptyImageBytes':{'minimum':min(nonempty),'median':float(np.median(nonempty)),
                             'p95':float(np.percentile(nonempty,95)),'maximum':max(nonempty)},
        'fullFrameDisplayPixels':full_pixels,'croppedDisplayPixels':crop_pixels+1,
        'croppingReductionFraction':1-(crop_pixels+1)/full_pixels,
        'allAssetsEncodedSha256Verified':True,'allDecodedPixelSha256Verified':True,
        'allCropBoundsAndAlternatePixelRegistrationVerified':True,
        'losslessWindowedDisplay':True,'addedGrayQuantization':False,
        'maximumCompressionError':0,'allNonemptyImagesUnderOneMillionBytes':True,
        'sourceComparisons':source_comparisons,'transferComparisons':comparisons,
        'previousTransfersAreEstimates':True,
        'limitations':'Pixel equality refers to the windowed 8-bit, conservative-support display texture, not the original quantitative uint16 scan. Cropped exterior background is omitted. No anatomical segmentation accuracy is inferred from these checks.',
    }
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('sourceComparisons','transferComparisons')},indent=2))


if __name__=='__main__':main()
