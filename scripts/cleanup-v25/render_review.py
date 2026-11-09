#!/usr/bin/env python3
"""Production-GLSL before/after review at the user's section planes.

Reuses the native EGL fixture and source-verifying decoder. This is scientific
offscreen verification, not browser/device frame-rate measurement.
"""
from pathlib import Path
import argparse,sys,gc
ROOT=Path(__file__).resolve().parents[2]
arg=argparse.ArgumentParser();arg.add_argument('--output',type=Path,default=ROOT/'docs/cleanup-v25/render');arg.add_argument('--case',action='append');options=arg.parse_args()
fixture=ROOT/'tests/fine-surface-v19-native.py'
sys.argv=[sys.argv[0],'--output',str(options.output)]
__file__=str(fixture)
exec(compile(fixture.read_text().split('\ndonor = ')[0],str(fixture),'exec'))
sys.path.insert(0,str(ROOT/'scripts/lumen-artifacts-v23'))
from mesh_transport import load_mesh_arrays
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource

manifest=read_json(ROOT/'public/assets/fine-surface-v23/manifest.json');lod=manifest['lods'][0]
donor=next(d for d in donors if d['id']=='ladaf-2021-17')
volume_manifest=read_json(public_path(donor['manifestUrl']));level=volume_manifest['levels']['high']
texture(0,load_volume(level),True)
cleanup=read_json(public_path(donor['cleanupManifestUrl']))
texture(2,np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()),np.uint8).reshape(*cleanup['dimensions'][::-1]).copy())
lumen_manifest=read_json(ROOT/'public/assets/cleanup-v25/lumen-manifest.json')
for index,item in enumerate(lumen_manifest['masks']):
    packed=public_path(item['url']).read_bytes();assert hashlib.sha256(packed).hexdigest()==item['sha256']
    raw=gzip.decompress(packed);assert hashlib.sha256(raw).hexdigest()==item['decodedSha256']
    a=np.frombuffer(raw,np.uint8).reshape(item['dimensionsXYZ'][::-1])
    tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));active(0x84C0+6+index);bind(0x806F,tex)
    t3(0x806F,0,0x8229,*a.shape[::-1],0,0x1903,0x1401,a.ctypes.data)
    for k,v in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812F),(0x2803,0x812F),(0x8072,0x812F)]:param(0x806F,k,v)
    del a,raw,packed

print('Loading verified gentle geometry',flush=True)
arrays=load_mesh_arrays(manifest,lod);transport=arrays['_transport'];mesh=install_mesh(arrays)
debris_path=ROOT/'public/assets/cleanup-v25/debris-manifest.json';debris_profile=None
if debris_path.exists():
    debris=read_json(debris_path);debris_profile=next(p for p in debris['profiles'] if p['lodId']=='gentle')
    assert debris_profile['sourceDecodedSha256']==lod['decodedSha256']
    item=debris_profile['vertexFlags'];packed=public_path(item['url']).read_bytes();assert hashlib.sha256(packed).hexdigest()==item['sha256']
    raw=gzip.decompress(packed);assert hashlib.sha256(raw).hexdigest()==item['decodedSha256']
    flags=np.frombuffer(raw,np.uint8);assert len(flags)==arrays['vertexCount']
    bind_vao(mesh['vao']);buf_flags=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buf_flags));mesh['buffers'].append(buf_flags)
    bind_buffer(0x8892,buf_flags);buffer_data(0x8892,flags.nbytes,flags.ctypes.data,0x88E4);enable_attribute(2);vertex_pointer(2,1,0x1401,1,0,None);quad()
    del raw,packed,flags
for k in ['positions','normals','indices','_rawOwner']:mesh.pop(k,None)
arrays.clear();del arrays;gc.collect()

base_configure=configure;cleanup_on=False
def configure(program,out,level,cleanup,world,*args,**kwargs):
    base_configure(program,out,level,cleanup,world,*args,**kwargs)
    if world.get('_whole'):ui(program,'clipAxis',-1)
    eye=np.array(world['_eye']);target=np.array(world['_target']);forward=unit(target-eye)
    right=unit(np.cross(forward,np.array(world['up'])));up=unit(np.cross(right,forward))
    for name,value in dict(eye=eye,forward=forward,right=right,up=up).items():u3(program,name,value)
    ui(program,'lumenCleanupReady',1);ui(program,'lumenCleanupEnabled',int(cleanup_on));u3(program,'lumenFineDimensions',lumen_manifest['sourceFullDimensionsXYZ'])
    ui(program,'debrisCleanupEnabled',int(cleanup_on and debris_profile is not None))
    for i,item in enumerate(lumen_manifest['masks']):
        ui(program,'lumenMaskTexture'+str(i),6+i);u3(program,'lumenMaskOrigin'+str(i),item['lowerFullFineXYZ']);u3(program,'lumenMaskDimensions'+str(i),item['dimensionsXYZ'])

fine=FineSource(cache_bricks=16);meta=fine.meta;extent=manifest['extent']
def world_from_fine(xyz):
    q=(np.array(xyz)-(np.array(meta['fullDimensionsXYZ'])-1)/2)*meta['sourceSpacingUm']/1000/meta['longestMm']
    return q[[0,2,1]]*[1,1,-1]
cases=[
 dict(id='atrial-section-289',axis=1,coordinate=1152,target=[1180,1152,840],distance=.56,normal=[0,0,-1],right=[1,0,0],up=[0,-1,0]),
 dict(id='atrial-section-310',axis=1,coordinate=1236,target=[1220,1236,870],distance=.50,normal=[0,0,-1],right=[1,0,0],up=[0,-1,0]),
 dict(id='outflow',axis=0,coordinate=980,target=[980,1130,480],distance=.59,normal=[-1,0,0],right=[0,0,-1],up=[0,-1,0]),
 dict(id='aortic-lumen',axis=1,coordinate=1236,target=[780,1236,590],distance=.53,normal=[0,0,-1],right=[1,0,0],up=[0,-1,0]),
 dict(id='right-ventricle',axis=1,coordinate=1124,target=[720,1124,1020],distance=.42,normal=[0,0,-1],right=[1,0,0],up=[0,-1,0]),
 dict(id='mitral-region',axis=1,coordinate=1152,target=[1200,1152,1260],distance=.45,normal=[0,0,-1],right=[1,0,0],up=[0,-1,0]),
 dict(id='outer-surface',axis=1,coordinate=1152,target=[948,948,1220],distance=1.12,normal=[.45,.08,-.89],right=[.89,0,.45],up=[0,-1,0],whole=True),
]
checks=[]
for case in cases:
    if options.case and case['id'] not in options.case:continue
    lo=[0,0,0];hi=meta['fullDimensionsXYZ'].copy();lo[case['axis']]=case['coordinate'];hi[case['axis']]=case['coordinate']+1
    cap=np.take(fine.region(lo,hi),0,axis=2-case['axis']).copy();cap_hash=hashlib.sha256(cap.tobytes()).hexdigest();texture(1,cap,True)
    center=world_from_fine([(n-1)/2 if a!=case['axis'] else case['coordinate'] for a,n in enumerate(meta['fullDimensionsXYZ'])]);target=world_from_fine(case['target'])
    normal,right,up=[np.array(case[k],dtype=float) for k in ['normal','right','up']];direction=unit(normal+.08*right+.025*up)
    world=dict(center=center.tolist(),normal=normal.tolist(),right=right.tolist(),up=up.tolist(),width=extent[0],height=extent[1],_eye=(target+direction*case['distance']).tolist(),_target=target.tolist())
    world['_whole']=case.get('whole',False)
    common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]
    cleanup_on=False;before=render_mesh(mesh,common)
    cleanup_on=True;after=render_mesh(mesh,common)
    cleanup_on=False;restored=render_mesh(mesh,common)
    assert np.array_equal(before,restored),'Original view failed exact restoration'
    assert hashlib.sha256(cap.tobytes()).hexdigest()==cap_hash
    changed=int(np.count_nonzero(np.any(before!=after,axis=2)))
    Image.fromarray(before).save(OUT/(case['id']+'-before.png'));Image.fromarray(after).save(OUT/(case['id']+'-after.png'))
    sheet=Image.new('RGB',(2*W,H+44),'#0b1317');sheet.paste(Image.fromarray(before[:,:,:3]),(0,44));sheet.paste(Image.fromarray(after[:,:,:3]),(W,44))
    pen=ImageDraw.Draw(sheet);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',19)
    pen.text((12,12),'Original Gentle detail',font=font,fill='#efece0');pen.text((W+12,12),'Reviewed cleanup · retained geometry unchanged',font=font,fill='#efece0')
    sheet.save(OUT/(case['id']+'-comparison.jpg'),quality=95)
    check=dict(case=case,changedPixels=changed,totalPixels=W*H,offOnOffRestoresExactly=True,sourceCapSha256=cap_hash,world=world);checks.append(check);print(json.dumps(check),flush=True)
report=dict(productionShaders=True,source=fine.receipt(),transport=transport,maskManifestSha256=hashlib.sha256((ROOT/'public/assets/cleanup-v25/lumen-manifest.json').read_bytes()).hexdigest(),debrisManifestSha256=hashlib.sha256(debris_path.read_bytes()).hexdigest() if debris_path.exists() else None,rendererShaderSha256=hashlib.sha256((ROOT/'public/renderer.js').read_bytes()).hexdigest(),fineSurfaceShaderSha256=hashlib.sha256((ROOT/'public/fine-surface.js').read_bytes()).hexdigest(),checks=checks,scope='Exact source asset decoding, actual production GLSL, unchanged source cap bytes and reversible display. Nearby reproducible cameras, not exact screenshot registration. No biological or browser-performance validation.')
(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
