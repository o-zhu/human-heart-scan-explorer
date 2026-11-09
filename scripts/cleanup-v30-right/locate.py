#!/usr/bin/env python3
"""Current v29 or supplied v30 color render and source-coordinate readback.

Original base vertices, normals, masks and local meshes are unchanged. The
diagnostic attachment reports visible mesh coordinates and excludes measured
cut-face pixels. It is not a substitute scientific image or a browser test.
"""
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28'))
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28-right'))
source=(ROOT/'scripts/cleanup-v28/render_review.py').read_text().split('\nchecks=[]')[0]
source=source.replace("ROOT/'scripts/cleanup-v28/review-cameras.json'", "ROOT/'scripts/cleanup-v30-right/review-cameras.json'")
source=source.replace("Path('/workspace/data/cleanup-v28/camera-geometry')", "Path('/workspace/data/cleanup-v30-right/camera-geometry')")
source=source.replace("ROOT/'docs/cleanup-v28/render'", "ROOT/'docs/cleanup-v30-right/locate'")
source=source.replace("Path('/workspace/data/cleanup-v28/render')", "Path('/workspace/data/cleanup-v30-right/locate')")
source=source.replace("ROOT/'public/assets/cleanup-v28/surface-manifest.json'", "ROOT/'public/assets/cleanup-v29/surface-manifest.json'")
source=source.replace('options=parser.parse_args();saved_options=options',"parser.add_argument('--replace',action='append',default=[],help='old-slot-id=policy.json');options=parser.parse_args();saved_options=options")
source=source.replace("base=base[base.index('fixture='):]", "base=base[base.index('fixture='):]\nbase=base.replace(\"lm=read_json(ROOT/f'public/assets/cleanup-{version}/lumen-manifest.json')\", \"lm=read_json(ROOT/'public/assets/cleanup-v29/lumen-manifest.json')\")")
exec(compile(source,str(ROOT/'scripts/cleanup-v28/render_review.py'),'exec'))
previous_configure=configure
def configure(program,*args,**kwargs):
    previous_configure(program,*args,**kwargs)
    ui(program,'sceneDepthTexture',5);ui(program,'sceneDepthReady',0)

for replacement in options.replace:
    old_id,file=replacement.split('=',1);path=Path(file);index=next(i for i,p in enumerate(patches) if p['policy']['id']==old_id)
    patches[index]=patch_install(json.loads(path.read_text()),path.parent,index)

position_fragment=fine_sources['fragment'].replace('fragColor=vec4(pow(max(color,vec3(0.)),vec3(.89)),1.);','fragColor=vec4(meshPosition,1.);')
assert position_fragment!=fine_sources['fragment']
position_program=compile_mesh(fine_sources['vertex'],position_fragment)
positions_target=depth_output(W,H)
active(0x84C0+14);bind(0x0DE1,positions_target['texture']);t2(0x0DE1,0,0x8814,W,H,0,0x1908,0x1406,None)
bind_fbo(0x8D40,positions_target['framebuffer']);assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5
gl_check('float target')
checks=[]
cap_sources=[]
def measured_cap(axis,coordinate,lo,hi):
    try:
        value=np.take(fine.region(lo,hi),0,axis=2-axis).copy()
        cap_sources.append(dict(kind='Verified original ultra-volume bricks',axis=axis,coordinate=coordinate))
        return value
    except FileNotFoundError:
        assert coordinate%4==0
        pack=json.loads((ROOT/'public/assets/ultra-sections/manifest.json').read_text())
        axis_name='xyz'[axis];item=pack['slices'][axis_name][coordinate//4]
        file=ROOT/'data/ultra-sections'/item['path'];encoded=file.read_bytes()
        assert hashlib.sha256(encoded).hexdigest()==item['sha256']
        pixels=np.asarray(Image.open(file).convert('L'));x,y,width,height=item['crop'];assert pixels.shape==(height,width)
        assert hashlib.sha256(pixels.tobytes()).hexdigest()==item['sourceDisplaySha256']
        dims=[pack['imageDimensionsXYZ'][i] for i in range(3) if i!=axis]
        value=np.zeros(dims[::-1],np.uint8);value[y:y+height,x:x+width]=pixels
        cap_sources.append(dict(kind='Verified original lossless Ultra section with exact crop placement',axis=axis,coordinate=coordinate,path=item['path'],sha256=item['sha256'],sourceDisplaySha256=item['sourceDisplaySha256'],crop=item['crop']))
        return value
for case in selected:
    axis=case['axis'];coordinate=case['coordinate'];lo=[0,0,0];hi=meta['fullDimensionsXYZ'].copy();lo[axis]=coordinate;hi[axis]=coordinate+1
    cap=measured_cap(axis,coordinate,lo,hi);texture(1,cap,True)
    xyz=[948,948,1058];xyz[axis]=coordinate;center=world_from_fine(xyz);target=world_from_fine(case['target'])
    normal=np.array([[1.,0,0],[0,0,-1.],[0,1.,0]][axis]);right=np.array([[0,0,-1.],[1.,0,0],[1.,0,0]][axis]);up=np.array([[0,-1.,0],[0,-1.,0],[0,0,1.]][axis])
    direction=unit(np.array(case.get('direction',normal+.08*right+.025*up)))
    world=dict(center=center.tolist(),normal=normal.tolist(),right=right.tolist(),up=up.tolist(),width=extent[2 if axis==0 else 0],height=extent[2 if axis==2 else 1],_eye=(target+direction*case['distance']).tolist(),_target=target.tolist(),_whole=case.get('whole',False))
    common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]
    set_version('v28');cleanup_on=True;colour=render_mesh(mesh,common)
    Image.fromarray(colour).save(options.lossless_output/(case['id']+'-v28.png'))
    Image.fromarray(colour[:,:,:3]).save(OUT/(case['id']+'-v28.jpg'),quality=97)
    matte=draw(matte_program,composed,*common,ready=1,scene=mesh_target)[:,:,0]>0
    quad();configure(position_program,positions_target,*common,ready=1,skip=1)
    enable(0x0B71);fn('glDepthFunc',None,[U])(0x0203);fn('glClearDepthf',None,[F])(1.)
    fn('glClearColor',None,[F,F,F,F])(0,0,0,0);fn('glClear',None,[U])(0x4000|0x0100)
    u3(position_program,'boundsMin',mesh['bounds']['min']);u3(position_program,'boundsMax',mesh['bounds']['max']);draw_base_mesh()
    if patches:
        ui(position_program,'refinementPatchPass',1);ui(position_program,'debrisCleanupEnabled',0)
        for i,patch in enumerate(patches):
            ui(position_program,'refinementPatchIndex',i);u3(position_program,'boundsMin',patch['bounds']['min']);u3(position_program,'boundsMax',patch['bounds']['max']);bind_vao(patch['vao']);fn('glVertexAttrib1f',None,[U,F])(2,0);draw_elements(4,patch['indexCount'],0x1405,None)
    fn('glFinish',None,[])();result=np.empty((H,W,4),np.float32)
    fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,W,H,0x1908,0x1406,result.ctypes.data)
    result=result[::-1].copy();gl_check('source readback');disable(0x0B71);quad()
    fine_xyz=result[:,:,[0,2,1]]*np.array([1,-1,1],np.float32)*meta['longestMm']/.0794+(np.array(meta['fullDimensionsXYZ'],np.float32)-1)/2
    fine_xyz[(result[:,:,3]<.5)|matte]=np.nan
    np.save(options.lossless_output/(case['id']+'-fine-xyz.npy'),fine_xyz.astype(np.float32))
    checks.append(dict(case=case,world=world,imageSize=[W,H],validMeshPixels=int(np.isfinite(fine_xyz[:,:,0]).sum()),fineXYZArray=str(options.lossless_output/(case['id']+'-fine-xyz.npy'))))
    print(json.dumps(checks[-1]),flush=True)
(OUT/'validation.json').write_text(json.dumps(dict(source=fine.receipt(),capSources=cap_sources,checks=checks,reviewCulling=review_culling,scope='Current v28 source geometry, local surfaces and masks. Actual production color GLSL; diagnostic Float32 coordinates exclude visible cap pixels. Nearby reproducible camera, not exact screenshot registration.'),indent=2)+'\n')
