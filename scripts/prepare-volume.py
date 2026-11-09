"""Prepare display-only uint8 assets from authentic HOA N5 s4 voxels.

No anatomical model or segmentation is synthesized. The full declared s4 extent
is retained. A circular mounting-container exclusion affects only voxels farther
than 210 s4 pixels from the XY field center. Central intensity data are retained.
"""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import pathlib
import time

import numpy as np
from scipy import ndimage

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cache',type=pathlib.Path,default=pathlib.Path('.cache/hoa-heart'))
parser.add_argument('--output',type=pathlib.Path,default=pathlib.Path('public/assets'))
args=parser.parse_args()
ROOT=args.cache.resolve()
OUT=args.output.resolve()
OUT.mkdir(parents=True,exist_ok=True)
NATIVE_SPACING=19.85
S4_SPACING=NATIVE_SPACING*16
WINDOW=(14640,23545)
RADIUS=210

raw=np.load(ROOT/'s4-volume-u16.npy',mmap_mode='r')
assert raw.shape==(530,475,475)
y,x=np.ogrid[:475,:475]
keep=(x-237)**2+(y-237)**2<=RADIUS**2
high=np.empty(raw.shape,np.uint8)
for z in range(len(high)):
    values=(raw[z].astype(np.float32)-WINDOW[0])*(255.0/(WINDOW[1]-WINDOW[0]))
    high[z]=np.rint(np.clip(values,0,255)).astype(np.uint8)
    high[z,~keep]=0
print('Prepared high',high.shape,flush=True)

# A small Gaussian prefilter limits aliasing. zoom grid_mode=False preserves
# the first/last voxel centers. Actual per-axis display spacing is recorded,
# including the slightly different Z spacing arising from odd interval count.
filtered=ndimage.gaussian_filter(high.astype(np.float32),sigma=.5,mode='nearest')
low_shape=(265,238,238)
low=np.rint(ndimage.zoom(filtered,[b/a for a,b in zip(high.shape,low_shape)],order=1,mode='nearest',prefilter=False,grid_mode=False)).clip(0,255).astype(np.uint8)
del filtered
assert low.shape==low_shape
print('Prepared low',low.shape,flush=True)

def pack(part):
    level,i,array,z0,z1=part
    rawbytes=np.ascontiguousarray(array[z0:z1]).tobytes(order='C')
    data=gzip.compress(rawbytes,compresslevel=6,mtime=0)
    filename=f'heart-{level}-{i:02d}.raw.gz'
    (OUT/filename).write_bytes(data)
    return level,i,{'url':'assets/'+filename,'bytes':len(data),'uncompressedBytes':len(rawbytes),'zRange':[z0,z1],'sha256':hashlib.sha256(data).hexdigest(),'rawSha256':hashlib.sha256(rawbytes).hexdigest()}

jobs=[]
for level,a,zstep in [('low',low,265),('high',high,64)]:
    for i,z0 in enumerate(range(0,len(a),zstep)):
        jobs.append((level,i,a,z0,min(len(a),z0+zstep)))
packed={}
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    for level,i,meta in pool.map(pack,jobs):
        packed.setdefault(level,[]).append((i,meta))
        print('Packed',level,i,meta['bytes'],flush=True)

levels={}
for key,a,factor,label in [('low',low,32,'Fast · ~635 µm'),('high',high,16,'Detailed · 317.6 µm')]:
    dims=list(a.shape[::-1]);hdims=list(high.shape[::-1])
    spacing=[S4_SPACING*(h-1)/(l-1) for h,l in zip(hdims,dims)]
    parts=[p for i,p in sorted(packed[key])]
    levels[key]={
        'label':label,'dimensions':dims,'spacingUm':spacing if key=='low' else S4_SPACING,
        'parts':parts,'compressedBytes':sum(p['bytes'] for p in parts),
        'uncompressedBytes':int(a.size),'downsampleFactor':factor,
        'downsampleFactorsXYZ':[v/NATIVE_SPACING for v in spacing],
        'sourceOffset':[0,0,0],'dtype':'uint8','byteOrder':'not-applicable','arrayOrder':'ZYX, X fastest',
        'physicalCenterExtentUm':[(h-1)*S4_SPACING for h in hdims],
        'processing':'N5 s4 normalized to 8-bit; mounting-container display mask' if key=='high' else 'Gaussian prefilter sigma 0.5 s4 voxel; trilinear scipy.ndimage.zoom preserving first/last voxel centers; 8-bit display values',
    }

manifest={
    'schemaVersion':1,'specimen':'LADAF-2021-17','organ':'heart',
    'datasetId':'1659197537','datasetUrl':'https://human-organ-atlas.esrf.fr/datasets/1659197537',
    'doi':'10.15151/ESRF-DC-1634390196','doiUrl':'https://doi.org/10.15151/ESRF-DC-1634390196',
    'title':'Complete scan at 19.85 um of the heart of the body donor LADAF-2021-17',
    'attribution':'Brunet et al. / ESRF Human Organ Atlas',
    'license':'CC BY 4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/',
    'nativeDimensions':[7614,7614,8480],'nativeSpacingUm':19.85,
    'sourceN5':'n5://gs://ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/LADAF-2021-17/heart/19.85um_complete-organ_bm18/',
    'sourceHttp':'https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/LADAF-2021-17/heart/19.85um_complete-organ_bm18/',
    'sourceScale':'s4','sourceScaleDimensions':[475,475,530],'sourceScaleSpacingUm':317.6,
    'sourceScaleVoxelExtentUm':[475*317.6,475*317.6,530*317.6],
    'sourceScaleCenterExtentUm':[474*317.6,474*317.6,529*317.6],
    'sourceWindow':list(WINDOW),'sourceDtype':'uint16',
    'containerMask':{'kind':'cylindrical display exclusion','centerXY':[237,237],'radiusVoxels':RADIUS,'radiusUm':RADIUS*S4_SPACING,'zExtent':'all','outsideValue':0,'anatomicalSegmentation':False},
    'levels':levels,'defaultLevel':'low','defaultThreshold':.32,
    'processingSummary':'Authentic whole-organ HiP-CT voxels from LADAF-2021-17, displayed at 317.6 µm or approximately 635 µm. Source intensities 14640–23545 are mapped to 8-bit display values. A conservative circular exclusion removes the surrounding mounting container; all central voxels and the full Z extent are retained. Brightness and threshold controls change visibility. This is an intensity-based reconstruction, without labeled anatomical segmentation. X, Y and Z are scan axes; clinical orientation is unverified.',
    'retrievedDate':'2026-11-04',
}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(ROOT/'browser-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('READY',json.dumps({k:{'dimensions':v['dimensions'],'spacingUm':v['spacingUm'],'compressedBytes':v['compressedBytes']} for k,v in levels.items()}),flush=True)
