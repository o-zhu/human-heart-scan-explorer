#!/usr/bin/env python3
"""Actual production native tile and Gentle ROI in one EGL framebuffer.

Reads one verified native tile and one decoded Gentle transport buffer. Keeps
only a local Gentle ROI before installing GL data. No full native bank load.
"""
from pathlib import Path
import argparse, sys, gc, subprocess
ROOT=Path(__file__).resolve().parents[2]
arg=argparse.ArgumentParser();arg.add_argument('--output',type=Path,default=ROOT/'docs/cleanup-v25/native-render');arg.add_argument('--fixture',type=Path,required=True);options=arg.parse_args()
subprocess.run(['node',str(ROOT/'scripts/cleanup-v25/export_native_fixture.mjs'),str(options.fixture)],check=True)
fixture=ROOT/'tests/fine-surface-v19-native.py';sys.argv=[sys.argv[0],'--output',str(options.output)]
__file__=str(fixture);exec(compile(fixture.read_text().split('\ndonor = ')[0],str(fixture),'exec'))
sys.path.insert(0,str(ROOT/'scripts/lumen-artifacts-v23'))
from mesh_transport import load_mesh_arrays

native=read_json(options.fixture/'native-fixture.json')
manifest=read_json(ROOT/'public/assets/fine-surface-v23/manifest.json');lod=manifest['lods'][0]
arrays=load_mesh_arrays(manifest,lod);transport=arrays['_transport']
minimum,maximum=np.asarray(arrays['bounds']['min']),np.asarray(arrays['bounds']['max'])
lo=np.asarray(native['bounds']['min'])-.04;hi=np.asarray(native['bounds']['max'])+.04
faces=arrays['indices'].reshape(-1,3);kept=[]
for start in range(0,len(faces),100_000):
    face=faces[start:start+100_000]
    points=minimum+arrays['positions'][face].astype(np.float32)/65535*(maximum-minimum)
    inside=np.all(points.max(axis=1)>=lo,axis=1)&np.all(points.min(axis=1)<=hi,axis=1)
    kept.append(face[inside].copy())
indices=np.concatenate(kept).ravel();used,reindex=np.unique(indices,return_inverse=True)
local=dict(positions=arrays['positions'][used].copy(),normals=arrays['normals'][used].copy(),indices=reindex.astype(np.uint32),bounds=arrays['bounds'],vertexCount=len(used),indexCount=len(indices))
fine_triangles=len(indices)//3
arrays.clear();del faces,arrays,points,indices,kept;gc.collect()
gentle=install_mesh(local)
for key in ['positions','normals','indices']:gentle.pop(key,None)
del local;gc.collect()

def install_native(part):
    raw=(options.fixture/part['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==part['sha256']
    vao=U();gen_vao(1,C.byref(vao));bind_vao(vao);buffers=[]
    for slot,offset,dtype,count,kind,normalized in [(0,part['positionOffset'],'<f4',part['vertexCount']*3,0x1406,0),(1,part['normalOffset'],'<i2',part['vertexCount']*3,0x1402,1)]:
        data=np.frombuffer(raw,dtype,count,offset);buffer=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));buffers.append(buffer)
        bind_buffer(0x8892,buffer);buffer_data(0x8892,data.nbytes,data.ctypes.data,0x88E4);enable_attribute(slot);vertex_pointer(slot,3,kind,normalized,0,None)
    fn('glDisableVertexAttribArray',None,[U])(2);fn('glVertexAttrib1f',None,[U,F])(2,0.)
    data=np.frombuffer(raw,'<u4',part['indexCount'],part['indexOffset']);buffer=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));buffers.append(buffer)
    bind_buffer(0x8893,buffer);buffer_data(0x8893,data.nbytes,data.ctypes.data,0x88E4);quad()
    return dict(vao=vao,buffers=buffers,indexCount=part['indexCount'])
pieces=[install_native(p) for p in native['pieces']]
donor=next(d for d in donors if d['id']=='ladaf-2021-17');volume_manifest=read_json(public_path(donor['manifestUrl']));level=volume_manifest['levels']['high'];texture(0,load_volume(level),True)
cleanup=read_json(public_path(donor['cleanupManifestUrl']));texture(2,np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()),np.uint8).reshape(*cleanup['dimensions'][::-1]).copy())
texture(1,np.zeros((2,2),np.uint8),True)
lumen=read_json(ROOT/'public/assets/cleanup-v25/lumen-manifest.json')
for index,item in enumerate(lumen['masks']):
    packed=public_path(item['url']).read_bytes();assert hashlib.sha256(packed).hexdigest()==item['sha256'];raw=gzip.decompress(packed);assert hashlib.sha256(raw).hexdigest()==item['decodedSha256']
    data=np.frombuffer(raw,np.uint8).reshape(item['dimensionsXYZ'][::-1])
    tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));active(0x84C0+6+index);bind(0x806F,tex)
    t3(0x806F,0,0x8229,*data.shape[::-1],0,0x1903,0x1401,data.ctypes.data)
    for key,value in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812F),(0x2803,0x812F),(0x8072,0x812F)]:param(0x806F,key,value)

center=(np.asarray(native['bounds']['min'])+np.asarray(native['bounds']['max']))/2
direction=unit(np.array([.4,.18,1.]));forward=-direction;right=unit(np.cross(forward,[0,1,0]));up=unit(np.cross(right,forward));eye=center+direction*.055
world=dict(center=center.tolist(),normal=direction.tolist(),right=right.tolist(),up=up.tolist(),width=.04,height=.05)
common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],(2,2)]
base_configure=configure
def configure(program,out,*args,**kwargs):
    base_configure(program,out,*args,**kwargs)
    for name,value in dict(eye=eye,forward=forward,right=right,up=up).items():u3(program,name,value)
    ui(program,'capReady',0);ui(program,'lumenCleanupReady',1);ui(program,'lumenCleanupEnabled',1);u3(program,'lumenFineDimensions',lumen['sourceFullDimensionsXYZ'])
    ui(program,'debrisCleanupEnabled',0)
    for index,item in enumerate(lumen['masks']):ui(program,'lumenMaskTexture'+str(index),6+index);u3(program,'lumenMaskOrigin'+str(index),item['lowerFullFineXYZ']);u3(program,'lumenMaskDimensions'+str(index),item['dimensionsXYZ'])

def render(replacement,clipped=False):
    quad();bind_fbo(0x8D40,mesh_target['framebuffer']);viewport(0,0,W,H);disable(0x0B71);use(background_program);u2(background_program,'resolution',[W,H]);ui(background_program,'palette',4);draw_arrays(4,0,3)
    enable(0x0B71);fn('glDepthFunc',None,[U])(0x0203);fn('glClearDepthf',None,[F])(1.);fn('glClear',None,[U])(0x0100)
    configure(mesh_program,mesh_target,*common,ready=0,side=1,clipped=clipped,skip=1)
    ui(mesh_program,'nativeReplacementEnabled',int(replacement));ui(mesh_program,'nativePatchPass',0);u3(mesh_program,'nativeRegionMin',native['bounds']['min']);u3(mesh_program,'nativeRegionMax',native['bounds']['max'])
    u3(mesh_program,'boundsMin',gentle['bounds']['min']);u3(mesh_program,'boundsMax',gentle['bounds']['max']);bind_vao(gentle['vao']);draw_elements(4,gentle['indexCount'],0x1405,None)
    if replacement:
        ui(mesh_program,'nativePatchPass',1);u3(mesh_program,'boundsMin',[0,0,0]);u3(mesh_program,'boundsMax',[1,1,1])
        for piece in pieces:bind_vao(piece['vao']);draw_elements(4,piece['indexCount'],0x1405,None)
    ui(mesh_program,'nativePatchPass',0);quad();disable(0x0B71)
    return draw(programs['composite'],composed,*common,ready=0,side=1,clipped=clipped,scene=mesh_target)

checks=[]
for clipped in [False,True]:
    before=render(False,clipped);after=render(True,clipped);restored=render(False,clipped)
    assert np.array_equal(before,restored)
    changed=int(np.count_nonzero(np.any(before!=after,axis=2)));assert changed>100
    prefix='cut' if clipped else 'whole'
    Image.fromarray(before).save(OUT/(prefix+'-gentle.png'));Image.fromarray(after).save(OUT/(prefix+'-native-region.png'))
    sheet=Image.new('RGB',(W*2,H+42),'#0c1418');sheet.paste(Image.fromarray(before[:,:,:3]),(0,42));sheet.paste(Image.fromarray(after[:,:,:3]),(W,42))
    pen=ImageDraw.Draw(sheet);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
    pen.text((12,10),'Gentle · 79.4 µm source',font=font,fill='#eae8df');pen.text((W+12,10),'Local replacement · 19.85 µm source',font=font,fill='#eae8df');sheet.save(OUT/(prefix+'-comparison.jpg'),quality=94)
    checks.append(dict(clipped=clipped,changedPixels=changed,offOnOffRestoresExactly=True,glError=0))
report=dict(passed=True,nativeSource=native['source'],nativeTriangles=native['triangles'],nativeSourceTriangles=native['sourceTriangles'],gentleROITriangles=fine_triangles,bounds=native['bounds'],eye=eye.tolist(),forward=forward.tolist(),right=right.tolist(),up=up.tolist(),productionShaders=True,sameFramebuffer=True,sameDepthBuffer=True,productionLumenMasks=True,checks=checks,transport=transport,scope='One actual production tile with browser-native decoding/cleanup/registration and the actual Gentle ROI. Offscreen EGL; not browser performance or anatomical accuracy. Region transitions are not welded.')
(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['passed','nativeTriangles','gentleROITriangles','checks']}),flush=True)
