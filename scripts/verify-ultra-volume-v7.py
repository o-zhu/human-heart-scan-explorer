"""Independently check the shipped JS brick sampler against SciPy and the source.

Requires numpy, scipy and Pillow only for validation/preparation; the exported
viewer itself has no Python package dependencies.
"""
import gzip, hashlib, json, math, pathlib, subprocess, tempfile
import numpy as np
from scipy.ndimage import map_coordinates

ROOT = pathlib.Path(__file__).resolve().parents[1]
sha = lambda b: hashlib.sha256(b).hexdigest()
checks = []

def reference(volume, meta, plane, spacing=79.4):
    full = np.asarray(meta['fullDimensionsXYZ'])
    longest = max(full - 1)
    w = math.ceil(plane['width']*meta['longestMm']*1000/spacing)+1
    h = math.ceil(plane['height']*meta['longestMm']*1000/spacing)+1
    c, r, u = (np.asarray(plane[k]) for k in ('center','right','up'))
    out = np.zeros((h,w),np.uint8)
    xs = np.linspace(-plane['width']/2,plane['width']/2,w)
    ys = np.linspace(plane['height']/2,-plane['height']/2,h)
    for start in range(0,h,32):
        world = c + xs[None,:,None]*r + ys[start:start+32,None,None]*u
        source = np.stack((world[...,0]*longest+(full[0]-1)/2,
                           -world[...,2]*longest+(full[1]-1)/2,
                           world[...,1]*longest+(full[2]-1)/2),axis=-1)-meta['sourceOriginXYZ']
        out[start:start+32] = map_coordinates(volume,[source[...,2],source[...,1],source[...,0]],order=1,mode='constant',cval=0,prefilter=False)
    return out

with tempfile.TemporaryDirectory(prefix='heart-fine-v7-') as temp:
    temp = pathlib.Path(temp)
    rng = np.random.default_rng(1707)
    phantom = rng.integers(0,256,size=(35,31,25),dtype=np.uint8)
    phantom[:18,:18,:18] = 0
    # A deliberately sparse, cropped, non-cubic volume crosses partial bricks.
    m = dict(schemaVersion=1,codec='gzip-u8-zyx-positive-halo',sourceSpacingUm=79.4,
             fullDimensionsXYZ=[49,53,59],sourceOriginXYZ=[10,7,4],sourceShapeXYZ=[25,31,35],
             longestMm=58*79.4/1000,brickSize=8,storedEdge=9,decodedBrickBytes=9**3,
             brickCountsXYZ=[4,4,5],assetBaseUrl='/api/ultra-volume/v7/',blocks={})
    for bz in range(5):
      for by in range(4):
       for bx in range(4):
        part=phantom[bz*8:bz*8+9,by*8:by*8+9,bx*8:bx*8+9]
        if not part.any(): continue
        padded=np.zeros((9,9,9),np.uint8);padded[:part.shape[0],:part.shape[1],:part.shape[2]]=part
        raw=padded.tobytes();encoded=gzip.compress(raw,mtime=0)
        path=f'{bz:02}/{by:02}/{bx:02}.gz';target=temp/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(encoded)
        m['blocks'][str(bx+4*(by+4*bz))]=dict(path=path,bytes=len(encoded),sha256=sha(encoded),rawSha256=sha(raw))
    (temp/'phantom.json').write_text(json.dumps(m))
    planes = [
      dict(center=[-.021,-.09,.04],right=[1,0,0],up=[0,1,0],width=1.04,height=1.17),
      dict(center=[.013,-.17,.03],right=[0,0,1],up=[0,1,0],width=.95,height=1.15),
      dict(center=[-.04,-.13,-.01],right=[1/np.sqrt(2),0,1/np.sqrt(2)],up=[0,1,0],width=1.14,height=1.11),
      dict(center=[-.04,-.13,-.01],right=[1/np.sqrt(2),0,1/np.sqrt(2)],up=[-1/np.sqrt(6),2/np.sqrt(6),1/np.sqrt(6)],width=1.14,height=1.11),
      dict(center=[0,0,2],right=[1,0,0],up=[0,1,0],width=.5,height=.6)
    ]
    jobs=[]
    for i,p in enumerate(planes):
        expected=reference(phantom,m,p);path=temp/f'phantom-{i}.r8';path.write_bytes(expected.tobytes())
        jobs.append(dict(name=f'phantom-{i}',manifest=str(temp/'phantom.json'),root=str(temp),plane=p,width=expected.shape[1],height=expected.shape[0],expected=str(path),decodedLimit=2*9**3))

    real=json.loads((ROOT/'public/assets/ultra-volume-v7.json').read_text())
    source=np.load('/workspace/data/heart-atlas-cache/s2-clean-display-u8.npy',mmap_mode='r')
    for name in ['apical','parasternal','short-axis']:
        p=dict(next(r for r in real['preparedPlanes'] if r['id']==name)['plane'])
        # Deliberate adjustment forbids the prepared-image fast path, and a
        # central field includes tissue, cavities, brick seams and fine edges.
        p['center']=list(np.asarray(p['center'])+np.asarray(p['normal'])*.00673)
        p['width']=.41;p['height']=.47
        expected=reference(source,real,p);path=temp/f'real-{name}.r8';path.write_bytes(expected.tobytes())
        jobs.append(dict(name=f'real-{name}',manifest=str(ROOT/'public/assets/ultra-volume-v7.json'),root=str(ROOT/'data/ultra-volume-v7'),plane=p,width=expected.shape[1],height=expected.shape[0],expected=str(path),decodedLimit=16*1024*1024))
    (temp/'jobs.json').write_text(json.dumps(jobs))
    run=subprocess.run(['node',str(ROOT/'scripts/verify-ultra-volume-v7.mjs'),str(temp/'jobs.json')],cwd=ROOT,check=True,text=True,capture_output=True)
    result=json.loads(run.stdout)
    assert result['passed']
    output=dict(passed=True,source='Original 79.4 µm cleaned display volume and independent sparse phantom',reference='scipy.ndimage.map_coordinates(order=1)',**{k:v for k,v in result.items() if k!='passed'})
    (ROOT/'docs/ultra-volume-v7-validation.json').write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps(output,indent=2))
