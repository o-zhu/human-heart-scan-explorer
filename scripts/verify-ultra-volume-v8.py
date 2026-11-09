#!/usr/bin/env python3
"""Compare the shipped JS fine API to independent SciPy reformats of donor2629."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

ROOT=Path(__file__).resolve().parents[1]
SLUG='ucl-zcr-2629'
SHA=lambda b:hashlib.sha256(b).hexdigest()


def reference(volume,meta,plane):
    full=np.asarray(meta['fullDimensionsXYZ']);L=int(max(full-1));pitch=meta['sourceSpacingUm']
    width=math.ceil(plane['width']*meta['longestMm']*1000/pitch)+1
    height=math.ceil(plane['height']*meta['longestMm']*1000/pitch)+1
    center,right,up=[np.asarray(plane[k],float) for k in ['center','right','up']]
    output=np.zeros((height,width),np.uint8)
    columns=np.linspace(-plane['width']/2,plane['width']/2,width)
    rows=np.linspace(plane['height']/2,-plane['height']/2,height)
    origin=np.asarray(meta['sourceOriginXYZ'])
    for start in range(0,height,32):
        world=center+columns[None,:,None]*right+rows[start:start+32,None,None]*up
        xyz=np.stack([world[...,0]*L+(full[0]-1)/2,-world[...,2]*L+(full[1]-1)/2,world[...,1]*L+(full[2]-1)/2],axis=-1)-origin
        output[start:start+32]=map_coordinates(volume,[xyz[...,2],xyz[...,1],xyz[...,0]],order=1,mode='constant',cval=0,prefilter=False)
    return output


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache',type=Path,default=Path('/workspace/data/heart-donor-2298522198'))
    args=parser.parse_args()
    manifest_path=ROOT/'public/assets/donors'/SLUG/'ultra-volume.json'
    meta=json.loads(manifest_path.read_text())
    frames=json.loads((ROOT/'public/assets/donors'/SLUG/'echo-planes.json').read_text())['frames']
    source=np.load(args.cache/'s2-clean-display-u8.npy',mmap_mode='r')
    with tempfile.TemporaryDirectory(prefix='heart-fine-v8-') as temp:
        temp=Path(temp);jobs=[]
        common=dict(manifest=str(manifest_path),root=str(ROOT/'data/donors'/SLUG/'ultra-volume'),public=str(ROOT/'public'),decodedLimit=16*1024*1024)
        for name in ['a4c','plax','me4c']:
            plane={k:v for k,v in frames[name]['world'].items() if k in ['center','normal','right','up','width','height']}
            plane['center']=list(np.asarray(plane['center'])+np.asarray(plane['normal'])*.00673)
            plane['width']=.41;plane['height']=.47
            expected=reference(source,meta,plane);path=temp/f'adjusted-{name}.r8';path.write_bytes(expected.tobytes())
            jobs.append(dict(**common,name=f'adjusted-{name}',plane=plane,width=expected.shape[1],height=expected.shape[0],expected=str(path)))
        outside=dict(center=[0,0,2],right=[1,0,0],up=[0,1,0],width=.4,height=.4)
        expected=reference(source,meta,outside);path=temp/'outside.r8';path.write_bytes(expected.tobytes())
        jobs.append(dict(**common,name='outside-support',plane=outside,width=expected.shape[1],height=expected.shape[0],expected=str(path)))
        for record in meta['preparedPlanes']:
            if record['id'] not in ['apical','atrial']:continue
            encoded=(ROOT/'public'/record['url'].removeprefix('./')).read_bytes()
            assert SHA(encoded)==record['sha256']
            pixels=np.asarray(Image.open(ROOT/'public'/record['url'].removeprefix('./')).convert('L'))
            assert SHA(pixels.tobytes())==record['pixelSha256']
            # Independent measured-volume reformat verifies that the fast-path
            # image corresponds to this exact registered plane.
            expected=reference(source,meta,record['plane'])
            assert pixels.shape==expected.shape and np.array_equal(pixels,expected),record['id']
            path=temp/f'prepared-{record["id"]}.r8';path.write_bytes(expected.tobytes())
            jobs.append(dict(**common,name='prepared-'+record['id'],plane=record['plane'],width=record['width'],height=record['height'],expected=str(path),prepared=True))
        assert sum(bool(j.get('prepared')) for j in jobs)==2,'Both TTE and TEE prepared Probe starts are required.'
        path=temp/'jobs.json';path.write_text(json.dumps(jobs))
        process=subprocess.run(['node',str(ROOT/'scripts/verify-ultra-volume-v8.mjs'),str(path)],cwd=ROOT,text=True,capture_output=True,check=True)
        result=json.loads(process.stdout)
        assert result['passed']
        result.update(source='Measured UCL-ZCR-2629 28.128 µm cleaned display density',
            reference='Independent scipy.ndimage.map_coordinates(order=1), with exact prepared-image source comparison',
            sampledPixelCount=sum(row['sourcePixels'] for row in result['checks']))
        output=ROOT/'docs/donors'/SLUG/'fine-api-verification.json';output.write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result,indent=2))

if __name__=='__main__':main()
