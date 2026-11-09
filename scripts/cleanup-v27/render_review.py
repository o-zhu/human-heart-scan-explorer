#!/usr/bin/env python3
"""Compare the previous v26 display with v27 using production GLSL and data."""
from pathlib import Path
import argparse,gc,gzip,hashlib,json,sys
ROOT=Path(__file__).resolve().parents[2]
arg=argparse.ArgumentParser();arg.add_argument('--case',action='append');arg.add_argument('--output',type=Path,default=ROOT/'docs/cleanup-v27/render');arg.add_argument('--lossless-output',type=Path,default=Path('/workspace/data/cleanup-v27/render'));options=arg.parse_args();options.lossless_output.mkdir(parents=True,exist_ok=True)
fixture=ROOT/'tests/fine-surface-v19-native.py';sys.argv=[sys.argv[0],'--output',str(options.output)];__file__=str(fixture)
fixture_source=fixture.read_text().split('\ndonor = ')[0].replace("ui(background_program,'palette',4)","ui(background_program,'palette',common[2].get('_palette',4))")
exec(compile(fixture_source,str(fixture),'exec'))
sys.path.insert(0,str(ROOT/'scripts/lumen-artifacts-v23'));from mesh_transport import load_mesh_arrays
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'));from source import FineSource

manifest=read_json(ROOT/'public/assets/fine-surface-v23/manifest.json');lod=next(x for x in manifest['lods'] if x['id']=='gentle')
donor=next(d for d in donors if d['id']=='ladaf-2021-17');volume_manifest=read_json(public_path(donor['manifestUrl']));level=volume_manifest['levels']['high'];texture(0,load_volume(level),True)
cleanup=read_json(public_path(donor['cleanupManifestUrl']));texture(2,np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()),np.uint8).reshape(*cleanup['dimensions'][::-1]).copy())

collections={}
def gl_check(stage):
    error=int(fn('glGetError',U,[])())
    if error:raise RuntimeError(f'GL error {error:#x} after {stage}')
for version in ('v26','v27'):
    if not (ROOT/f'public/assets/cleanup-{version}/lumen-manifest.json').exists():continue
    lm=read_json(ROOT/f'public/assets/cleanup-{version}/lumen-manifest.json');mask_textures=[]
    for index,item in enumerate(lm['masks']):
        encoded=public_path(item['url']).read_bytes();assert hashlib.sha256(encoded).hexdigest()==item['sha256'];raw=gzip.decompress(encoded);assert hashlib.sha256(raw).hexdigest()==item['decodedSha256']
        dims=item.get('storageDimensionsXYZ',item['dimensionsXYZ']);a=np.frombuffer(raw,np.uint8).reshape(dims[::-1]);tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));active(0x84C0+6+index);bind(0x806F,tex)
        t3(0x806F,0,0x8229,*dims,0,0x1903,0x1401,a.ctypes.data)
        for k,v in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812F),(0x2803,0x812F),(0x8072,0x812F)]:param(0x806F,k,v)
        mask_textures.append(tex);del a,raw,encoded
    debris=read_json(ROOT/'public/assets/cleanup-v26/debris-manifest.json')['profiles'][0];item=debris['vertexFlags'];encoded=public_path(item['url']).read_bytes();assert hashlib.sha256(encoded).hexdigest()==item['sha256'];raw=gzip.decompress(encoded);assert hashlib.sha256(raw).hexdigest()==item['decodedSha256']
    collections[version]=dict(manifest=lm,textures=mask_textures,flags=np.frombuffer(raw,np.uint8),debris=debris)
    gl_check('loading '+version+' masks and flags')

print('Loading verified source geometry',flush=True)
arrays=load_mesh_arrays(manifest,lod);transport=arrays['_transport'];mesh=install_mesh(arrays)
gl_check('installing source mesh')
bind_vao(mesh['vao']);flag_buffer=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(flag_buffer));bind_buffer(0x8892,flag_buffer)
buffer_data(0x8892,collections['v26']['flags'].nbytes,collections['v26']['flags'].ctypes.data,0x88E4);enable_attribute(2);vertex_pointer(2,1,0x1401,1,0,None);quad()
for key in ('positions','normals','indices','_rawOwner'):mesh.pop(key,None)
arrays.clear();del arrays;gc.collect()
gl_check('installing flags')

base_configure=configure;active_version='v26';cleanup_on=True
def configure(program,out,level,cleanup,world,*args,**kwargs):
    gl_check('entering configure '+str(program))
    base_configure(program,out,level,cleanup,world,*args,**kwargs)
    ui(program,'palette',world.get('_palette',4))
    gl_check('base configure '+str(program))
    if world.get('_whole'):ui(program,'clipAxis',-1)
    eye=np.array(world['_eye']);target=np.array(world['_target']);forward=unit(target-eye);right=unit(np.cross(forward,np.array(world['up'])));up=unit(np.cross(right,forward))
    for name,value in dict(eye=eye,forward=forward,right=right,up=up).items():u3(program,name,value)
    gl_check('camera configure '+str(program))
    collection=collections[active_version];lm=collection['manifest']
    ui(program,'lumenCleanupReady',1);ui(program,'lumenCleanupEnabled',int(cleanup_on));ui(program,'lumenMaskCount',len(lm['masks']));ui(program,'lumenMaskBitPacked',1);u3(program,'lumenFineDimensions',lm['sourceFullDimensionsXYZ'])
    ui(program,'debrisCleanupEnabled',int(cleanup_on))
    gl_check('flags configure '+str(program))
    for i,(item,tex) in enumerate(zip(lm['masks'],collection['textures'])):
        active(0x84C0+6+i);bind(0x806F,tex);ui(program,'lumenMaskTexture'+str(i),6+i);u3(program,'lumenMaskOrigin'+str(i),item['lowerFullFineXYZ']);u3(program,'lumenMaskDimensions'+str(i),item['dimensionsXYZ'])
    gl_check('configuring '+str(program))

raw_draw_elements=draw_elements
def draw_elements(*args):
    raw_draw_elements(*args);gl_check('drawing mesh '+active_version)

fine=FineSource(cache_bricks=16);meta=fine.meta;extent=manifest['extent']
def world_from_fine(xyz):
    q=(np.array(xyz)-(np.array(meta['fullDimensionsXYZ'])-1)/2)*.0794/meta['longestMm'];return q[[0,2,1]]*[1,1,-1]
def set_version(name):
    global active_version
    active_version=name;f=collections[name]['flags'];bind_vao(mesh['vao']);bind_buffer(0x8892,flag_buffer);buffer_data(0x8892,f.nbytes,f.ctypes.data,0x88E4);quad()

cases=json.loads((ROOT/'docs/cleanup-v27/review-cameras.json').read_text())['cameras']

checks=[]
for case in cases:
    if options.case and case['id'] not in options.case:continue
    y=case['coordinate'];cap=np.take(fine.region([0,y,0],[1897,y+1,2117]),0,axis=1).copy();cap_hash=hashlib.sha256(cap.tobytes()).hexdigest();texture(1,cap,True)
    center=world_from_fine([948,y,1058]);target=world_from_fine(case['target']);normal=np.array(case.get('normal',[0,0,-1.]));right=np.array([1.,0,0]);up=np.array([0,-1.,0]);direction=unit(np.array(case.get('direction',normal+.08*right+.025*up)))
    world=dict(center=center.tolist(),normal=normal.tolist(),right=right.tolist(),up=up.tolist(),width=extent[0],height=extent[1],_eye=(target+direction*case['distance']).tolist(),_target=target.tolist(),_whole=case.get('whole',False))
    common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]
    side=case.get('side',1)
    set_version('v26');cleanup_on=True;before=render_mesh(mesh,common,side=side)
    set_version('v27');after=render_mesh(mesh,common,side=side)
    set_version('v26');restored=render_mesh(mesh,common,side=side);assert np.array_equal(before,restored)
    assert hashlib.sha256(cap.tobytes()).hexdigest()==cap_hash
    # Both current cleanup toggles return the unchanged pre-v27 display source.
    cleanup_on=False;old_off=render_mesh(mesh,common,side=side);set_version('v27');new_off=render_mesh(mesh,common,side=side);assert np.array_equal(old_off,new_off);cleanup_on=True
    Image.fromarray(before).save(options.lossless_output/(case['id']+'-v26.png'));Image.fromarray(after).save(options.lossless_output/(case['id']+'-v27.png'));Image.fromarray(old_off).save(options.lossless_output/(case['id']+'-cleanup-off.png'))
    sheet=Image.new('RGB',(2*W,H+64),'#0b1317');sheet.paste(Image.fromarray(before[:,:,:3]),(0,64));sheet.paste(Image.fromarray(after[:,:,:3]),(W,64));pen=ImageDraw.Draw(sheet);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
    pen.text((18,18),'v26 · Before',font=font,fill='#efece0');pen.text((W+18,18),'v27 · Updated',font=font,fill='#efece0');sheet.save(OUT/(case['id']+'-comparison.jpg'),quality=97)
    item=dict(case=case,changedPixels=int(np.count_nonzero(np.any(before!=after,axis=2))),totalPixels=W*H,v26V27V26RestoresExactly=True,originalOffViewsIdentical=True,sourceCapSha256=cap_hash,rawImageArrayShape=list(before.shape),rawImageSha256=dict(v26=hashlib.sha256(before.tobytes()).hexdigest(),v27=hashlib.sha256(after.tobytes()).hexdigest(),originalOff=hashlib.sha256(old_off.tobytes()).hexdigest()),world=world);checks.append(item);print(json.dumps(item),flush=True)
    if case['id']=='overview-284':
        world['_palette']=6;coloured=render_mesh(mesh,common,side=side);world.pop('_palette')
        Image.fromarray(coloured).save(options.lossless_output/(case['id']+'-v27-palette6.png'))
        Image.fromarray(coloured[:,:,:3]).save(OUT/(case['id']+'-v27-palette6.jpg'),quality=97)
        item['palette6ImageSha256']=hashlib.sha256(coloured.tobytes()).hexdigest()
report=dict(productionShaders=True,source=fine.receipt(),transport=transport,maskManifestSha256={v:hashlib.sha256((ROOT/f'public/assets/cleanup-{v}/lumen-manifest.json').read_bytes()).hexdigest() for v in collections},debrisManifestSha256={v:hashlib.sha256((ROOT/'public/assets/cleanup-v26/debris-manifest.json').read_bytes()).hexdigest() for v in collections},rendererShaderSha256=hashlib.sha256((ROOT/'public/renderer.js').read_bytes()).hexdigest(),fineSurfaceShaderSha256=hashlib.sha256((ROOT/'public/fine-surface.js').read_bytes()).hexdigest(),checks=checks,scope='Exact verified source assets, actual production GLSL, same-camera v26-to-v27 comparison, unchanged source pixels and reversible display. Nearby reproducible cameras, not exact screenshot registration. No anatomical-identity or browser-performance claim.')
(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
