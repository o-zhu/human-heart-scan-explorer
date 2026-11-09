"""Independent asset integrity and world-to-source registration checks."""
from pathlib import Path
import hashlib
import json
import subprocess
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
manifest = json.loads((PUBLIC / 'assets/echo-textures.json').read_text())
frames = json.loads((PUBLIC / 'assets/echo-planes.json').read_text())['frames']
assert set(frames)==set(manifest['textures']) and len(frames)==13
source = np.load('/workspace/data/heart-atlas-cache/s2-clean-display-u8.npy',mmap_mode='r')
origin = np.array(manifest['sourceOriginXYZ'])
registration = []
for key, item in manifest['textures'].items():
    path=PUBLIC/item['url'].removeprefix('./')
    raw=path.read_bytes()
    assert len(raw)==item['bytes']
    assert hashlib.sha256(raw).hexdigest()==item['sha256']
    image=np.asarray(Image.open(path).convert('L'))
    assert image.shape==(item['height'],item['width'])
    assert hashlib.sha256(image.tobytes()).hexdigest()==item['pixelSha256']
    assert item['sourceSpacingUm']==79.4 and item['maxDecodedPixelError']==0
    assert np.max(np.abs(np.array(item['actualSpacingUmXY'])-79.4))<.04
    # Independently derive source coordinates from renderer-world geometry.
    world=frames[key]['world']
    ys,xs=np.mgrid[0:image.shape[0]:31j,0:image.shape[1]:31j]
    ys=np.minimum(np.rint(ys).astype(int),image.shape[0]-1)
    xs=np.minimum(np.rint(xs).astype(int),image.shape[1]-1)
    u=xs/(image.shape[1]-1)-.5;v=.5-ys/(image.shape[0]-1)
    p=np.array(world['center'])+u[...,None]*world['width']*np.array(world['right'])+v[...,None]*world['height']*np.array(world['up'])
    xyz=np.stack((p[...,0]*529+237,237-p[...,2]*529,p[...,1]*529+264.5),axis=-1)*4-origin
    reference=map_coordinates(source,[xyz[...,2],xyz[...,1],xyz[...,0]],order=1,mode='constant',cval=0,prefilter=False)
    difference=np.abs(reference.astype(int)-image[ys,xs].astype(int))
    # World geometry was rounded to 9 decimals by the original v2 frame exporter.
    assert difference.max()<=1,(key,difference.max())
    assert (difference==0).mean()>.995,(key,(difference==0).mean())
    registration.append({'id':key,'maxError':int(difference.max()),'exactFraction':float((difference==0).mean())})

catalog=json.loads((PUBLIC/'assets/echo-media-v6.json').read_text())
assert len(catalog['clips'])==12
assert {c['preset'] for c in catalog['clips']}==set(frames)-{'meavsax'}
assert 'meavsax' in catalog['unavailable']
for clip in catalog['clips']:
    path=PUBLIC/clip['url'].removeprefix('./')
    assert path.stat().st_size==clip['bytes']
    assert hashlib.sha256(path.read_bytes()).hexdigest()==clip['sha256']
    assert (PUBLIC/clip['poster'].removeprefix('./')).is_file()
    assert clip['sourceUrl'].startswith('https://') and clip['licenseUrl'].startswith('https://creativecommons.org/')
    metadata=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_entries','stream=codec_type,codec_name,width,height,nb_read_frames','-of','json',str(path)]))
    assert len(metadata['streams'])==1
    video=metadata['streams'][0]
    assert video['codec_name']=='h264' and video['codec_type']=='video'
    assert (video['width'],video['height'])==(clip['width'],clip['height'])
    assert int(video['nb_read_frames'])==clip['frames'] and clip['frames']>1
print(json.dumps({'textures':13,'uniqueTextures':len(set(x['url'] for x in manifest['textures'].values())),
                  'textureBytes':manifest['totalUniqueEncodedBytes'],'cineClips':12,
                  'cineBytes':catalog['totalVideoBytes'],'registration':registration},indent=2))
