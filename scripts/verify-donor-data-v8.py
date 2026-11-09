#!/usr/bin/env python3
"""Independent byte, axis, registration and sparse-delivery checks for donor2629."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import struct
import time

import blosc2
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
SLUG='ucl-zcr-2629'
SHA=lambda data:hashlib.sha256(data).hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cache',type=Path,default=Path('/workspace/data/heart-donor-2298522198'))
    p.add_argument('--project',type=Path,default=ROOT)
    a=p.parse_args();start=time.monotonic();r=a.project
    public=r/'public';assets=public/'assets/donors'/SLUG;docs=r/'docs/donors'/SLUG
    manifest=json.loads((assets/'manifest.json').read_text())
    sections=json.loads((assets/'ultra-sections.json').read_text())
    bricks=json.loads((assets/'ultra-volume.json').read_text())
    compact=np.load(a.cache/'support-low-u8.npy',mmap_mode='r')
    fine=np.load(a.cache/'s2-source-u16.npy',mmap_mode='r')
    display=np.load(a.cache/'s2-clean-display-u8.npy',mmap_mode='r')
    origin=np.asarray(bricks['sourceOriginXYZ']);source_shape=np.asarray(bricks['sourceShapeXYZ'])
    low,high=manifest['sourceWindow'];scale=255/(high-low)
    checks=[]
    rng=np.random.default_rng(2298522198)
    # Byte-level Zarr C-order indexing independently checks the importer's XYZ
    # to ZYX transpose against the actual little-endian source bytes.
    source_tests=0
    for level in ['4','2']:
        records=json.loads((a.cache/f's{level}-download.json').read_text())['records']
        volume=np.load(a.cache/f's{level}-source-u16.npy',mmap_mode='r')
        selected=np.linspace(0,len(records)-1,min(12,len(records))).round().astype(int)
        for i in selected:
            rec=records[int(i)];cx,cy,cz=rec['coordinateXYZ']
            encoded=(a.cache/f'chunks-s{level}'/f'{cx}_{cy}_{cz}.blosc').read_bytes()
            assert SHA(encoded)==rec['sha256']
            raw=blosc2.decompress(encoded)
            assert SHA(raw)==rec['decodedSha256']
            for _ in range(64):
                x,y,z=rng.integers(0,128,size=3)
                gx,gy,gz=cx*128+x,cy*128+y,cz*128+z
                if gx>=volume.shape[2] or gy>=volume.shape[1] or gz>=volume.shape[0]:continue
                offset=int(((x*128+y)*128+z)*2)
                value=int.from_bytes(raw[offset:offset+2],'little')
                assert value==int(volume[gz,gy,gx]),(level,(gx,gy,gz),value)
                source_tests+=1
    checks.append({'name':'OME XYZ C-order byte offsets versus internal ZYX source voxels','samples':source_tests,'maximumIntegerError':0})
    # Check physical coordinates using the published OME transforms and manual
    # eight-neighbor interpolation, independent of scipy.map_coordinates.
    source4=np.load(a.cache/'s4-source-u16.npy',mmap_mode='r')
    target=np.load(a.cache/'display-high-u8.npy',mmap_mode='r')
    maximum=0;maximum_raw_rounding=0
    coarse_raw=np.load(a.cache/'display-high-raw-f32.npy',mmap_mode='r')
    for _ in range(4096):
        z,y,x=[int(rng.integers(0,n)) for n in target.shape]
        physical=np.array([x,y,z])*112.512+14.064
        coarse=(physical-56.256)/112.512
        coarse=np.clip(coarse,[0,0,0],np.array(target.shape[::-1])-1)
        exact_eighths=np.round(coarse*8)/8
        assert np.max(np.abs(coarse-exact_eighths))<1e-10
        coarse=exact_eighths
        lo=np.floor(coarse).astype(int);hi=np.minimum(lo+1,np.array(target.shape[::-1])-1);fraction=coarse-lo
        value=0.
        for dz in [0,1]:
            for dy in [0,1]:
                for dx in [0,1]:
                    xx=hi[0] if dx else lo[0];yy=hi[1] if dy else lo[1];zz=hi[2] if dz else lo[2]
                    weights=np.where([dx,dy,dz],fraction,1-fraction)
                    value+=float(source4[zz,yy,xx])*float(np.prod(weights))
        # The declared coarse resampler produces nearest uint16, preserving the
        # source storage type. Its rounding is bounded to half a raw unit.
        raw_rounding=abs(value-float(coarse_raw[z,y,x]))
        maximum_raw_rounding=max(maximum_raw_rounding,raw_rounding)
        assert raw_rounding<=.5
        expected=int(np.rint(np.clip((np.float32(np.floor(value+.5))-np.float32(low))*np.float32(scale),0,255)))
        error=abs(expected-int(target[z,y,x]));maximum=max(maximum,error)
        assert error==0,(x,y,z,expected,int(target[z,y,x]))
    for n,dim in zip(sections['imageDimensionsXYZ'],manifest['sourceScaleDimensions']):assert (dim-1)*4+1==n
    assert not compact[:,:,-1].any(),'Omitted terminal fine X column intersects retained support.'
    checks.append({'name':'OME half-voxel translations and common first/last centers','samples':4096,'maximumDisplayByteError':maximum,
                   'correctedOffsetUmPerAxis':42.192,'maximumRawInterpolationRounding':maximum_raw_rounding,'terminalXColumnOutsideRetainedSupport':True})
    # Clean and original browser volumes must decompress and invert the declared
    # byte predictor exactly, with no image or tissue quantization beyond windowing.
    part_tests=0
    for key,level in manifest['levels'].items():
        for clean,label in [(True,'parts'),(False,'originalParts')]:
            pieces=[]
            for part in level[label]:
                encoded=(public/part['url']).read_bytes();assert SHA(encoded)==part['sha256']
                decoded=np.frombuffer(gzip.decompress(encoded),np.uint8).reshape(tuple(level['dimensions'][::-1]))
                if part.get('predictor')=='delta-z':decoded=np.cumsum(decoded,axis=0,dtype=np.uint8)
                elif part.get('predictor')=='delta-x':decoded=np.cumsum(decoded,axis=2,dtype=np.uint8)
                assert SHA(decoded.tobytes())==part['rawSha256']
                source=np.load(a.cache/f'display-{key}{"-clean" if clean else ""}-u8.npy',mmap_mode='r')
                assert np.array_equal(decoded,source)
                part_tests+=1
    checks.append({'name':'Clean and original volume prediction/gzip round trips','parts':part_tests,'maximumByteError':0})
    # Validate the scalar display against true source values at independently
    # chosen global coordinates, including zeroed exterior support.
    xyz=rng.integers([0,0,0],source_shape,size=(20000,3));global_xyz=xyz+origin
    raw=fine[global_xyz[:,2],global_xyz[:,1],global_xyz[:,0]].astype(np.float32)
    support_xyz=np.floor(global_xyz/8+.5).astype(int)
    support=compact[support_xyz[:,2],support_xyz[:,1],support_xyz[:,0]]>0
    expected=np.rint(np.clip((raw-low)*np.float32(scale),0,255)).astype(np.uint8);expected[~support]=0
    actual=display[xyz[:,2],xyz[:,1],xyz[:,0]]
    assert np.array_equal(actual,expected)
    checks.append({'name':'Fine display source intensities and donor-specific support','samples':len(xyz),'maximumByteError':0,
                   'window':[low,high],'sourceSpacingUm':bricks['sourceSpacingUm']})
    # Every hosted object is checked against its immutable serving allowlist.
    inventory={}
    for kind,indexname in [('ultra-sections','ultra-index.json'),('ultra-volume','volume-index.json')]:
        index=json.loads((r/'server/donors'/SLUG/indexname).read_text())
        total=0
        for path,entry in index.items():
            encoded=(r/'data/donors'/SLUG/kind/path).read_bytes()
            assert len(encoded)==entry['bytes'] and SHA(encoded)==entry['sha256'],path
            total+=len(encoded)
        inventory[kind]={'objects':len(index),'bytes':total}
    checks.append({'name':'All served objects match immutable size/hash allowlists','inventory':inventory})
    # Representative orthogonal images compare all pixels to the original
    # source-derived density, with crop origins and exact through-plane indices.
    image_count=0;image_pixels=0
    for axis in 'xyz':
        n=len(sections['slices'][axis])
        for index in np.unique(np.linspace(0,n-1,17).round().astype(int)):
            rec=sections['slices'][axis][int(index)]
            image=np.asarray(Image.open(r/'data/donors'/SLUG/'ultra-sections'/rec['path']).convert('L'))
            assert SHA(image.tobytes())==rec['sourceDisplaySha256']
            x0,y0,w,h=rec['crop'];assert image.shape==(h,w)
            assert x0%2==0 and y0%2==0 and w%2==1 and h%2==1
            if rec['empty']:
                assert not image.any();image_count+=1;continue
            if axis=='x':
                expected=display[y0-origin[2]:y0-origin[2]+h,x0-origin[1]:x0-origin[1]+w,int(index)*4-origin[0]]
            elif axis=='y':
                expected=display[y0-origin[2]:y0-origin[2]+h,int(index)*4-origin[1],x0-origin[0]:x0-origin[0]+w]
            else:
                expected=display[int(index)*4-origin[2],y0-origin[1]:y0-origin[1]+h,x0-origin[0]:x0-origin[0]+w]
            assert np.array_equal(image,expected),(axis,index,rec['crop'])
            image_pixels+=image.size;image_count+=1
    checks.append({'name':'Orthogonal cut-face pixels, crop origins, and exact plane positions','images':image_count,
                   'comparedPixels':image_pixels,'maximumDisplayByteError':0})
    # Independently compare every voxel of sampled density blocks, especially
    # the +X/+Y/+Z halo used by the in-browser trilinear interpolator.
    ids=list(bricks['blocks']);selected=np.linspace(0,len(ids)-1,min(80,len(ids))).round().astype(int)
    nx,ny,nz=bricks['brickCountsXYZ'];sampled=0;voxel_count=0
    for i in selected:
        key=ids[int(i)];record=bricks['blocks'][key];ident=int(key)
        bx=ident%nx;by=(ident//nx)%ny;bz=ident//(nx*ny)
        encoded=(r/'data/donors'/SLUG/'ultra-volume'/record['path']).read_bytes()
        decoded=gzip.decompress(encoded);assert SHA(decoded)==record['rawSha256']
        actual=np.frombuffer(decoded,np.uint8).reshape((65,65,65));expected=np.zeros_like(actual)
        source=display[bz*64:bz*64+65,by*64:by*64+65,bx*64:bx*64+65]
        expected[:source.shape[0],:source.shape[1],:source.shape[2]]=source
        assert np.array_equal(actual,expected),record['path']
        sampled+=1;voxel_count+=actual.size
    checks.append({'name':'Fine brick interiors and all positive halos','bricks':sampled,'voxels':voxel_count,'maximumByteError':0})
    report={'specimen':'UCL-ZCR-2629','datasetId':'2298522198','passed':True,'checks':checks,
            'elapsedSeconds':round(time.monotonic()-start,2),
            'scope':'Source decoding, physical registration, intensity preservation, compression, and object integrity. No clinical segmentation accuracy is asserted.'}
    docs.mkdir(parents=True,exist_ok=True);(docs/'data-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
