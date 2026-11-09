#!/usr/bin/env python3
"""Bounded, actual-production v28 render with diagnostic source XYZ readback.

Only the diagnostic program's color output is replaced. Its clipping, masks,
current local surfaces, camera, and geometry remain the production path.
"""
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28'))
base=(ROOT/'scripts/cleanup-v28/render_review.py').read_text().split('\nchecks=[]')[0]
base=base.replace("ROOT/'scripts/cleanup-v28/review-cameras.json'", "ROOT/'scripts/cleanup-v29-left/review-cameras.json'")
base=base.replace("Path('/workspace/data/cleanup-v28/camera-geometry')", "Path('/workspace/data/cleanup-v29-left/camera-geometry')")
base=base.replace("ROOT/'docs/cleanup-v28/render'", "ROOT/'docs/cleanup-v29-left/locate'")
base=base.replace("Path('/workspace/data/cleanup-v28/render')", "Path('/workspace/data/cleanup-v29-left/locate')")
exec(compile(base,str(ROOT/'scripts/cleanup-v28/render_review.py'),'exec'))
set_version('v28')

needle='fragColor=vec4(pow(max(color,vec3(0.)),vec3(.89)),1.);'
assert needle in fine_sources['fragment']
position_program=compile_mesh(fine_sources['vertex'],fine_sources['fragment'].replace(needle,'fragColor=vec4(meshPosition,1.);'))
positions_target=depth_output(W,H)
active(0x84C0+12);bind(0x0DE1,positions_target['texture'])
t2(0x0DE1,0,0x8814,W,H,0,0x1908,0x1406,None)
bind_fbo(0x8D40,positions_target['framebuffer'])
assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5
gl_check('float diagnostic target')

checks=[]
section_manifest=json.loads((ROOT/'public/assets/ultra-sections/manifest.json').read_text())
def exact_section(axis,coordinate):
    assert coordinate%4==0 and section_manifest['codecLossless']
    entry=section_manifest['slices']['xyz'[axis]][coordinate//4]
    path=ROOT/'data/ultra-sections'/entry['path']
    encoded=path.read_bytes();assert len(encoded)==entry['bytes'] and hashlib.sha256(encoded).hexdigest()==entry['sha256']
    crop=np.asarray(Image.open(path).convert('L'))
    assert hashlib.sha256(crop.tobytes()).hexdigest()==entry['sourceDisplaySha256']
    x,y,w,h=entry['crop'];assert crop.shape==(h,w)
    shape=tuple(np.delete(np.asarray(meta['fullDimensionsXYZ']),axis)[::-1])
    cap=np.zeros(shape,np.uint8);cap[y:y+h,x:x+w]=crop
    return cap,entry
for case in selected:
    axis=case['axis'];coordinate=case['coordinate'];lo=[0,0,0];hi=meta['fullDimensionsXYZ'].copy();lo[axis]=coordinate;hi[axis]=coordinate+1
    cap,cap_entry=exact_section(axis,coordinate);texture(1,cap,True)
    xyz=[948,948,1058];xyz[axis]=coordinate;center=world_from_fine(xyz);target=world_from_fine(case['target'])
    normal=np.array([[1.,0,0],[0,0,-1.],[0,1.,0]][axis]);right=np.array([[0,0,-1.],[1.,0,0],[1.,0,0]][axis]);up=np.array([[0,-1.,0],[0,-1.,0],[0,0,1.]][axis])
    direction=unit(np.array(case.get('direction',normal+.08*right+.025*up)))
    world=dict(center=center.tolist(),normal=normal.tolist(),right=right.tolist(),up=up.tolist(),width=extent[2 if axis==0 else 0],height=extent[2 if axis==2 else 1],_eye=(target+direction*case['distance']).tolist(),_target=target.tolist())
    common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]
    image=render_mesh(mesh,common)
    Image.fromarray(image).save(options.lossless_output/(case['id']+'-v28.png'))
    Image.fromarray(image[:,:,:3]).save(OUT/(case['id']+'-v28.jpg'),quality=97)
    matte=draw(matte_program,composed,*common,ready=1,scene=mesh_target)[:,:,0]>0
    quad();configure(position_program,positions_target,*common,ready=1,skip=1)
    enable(0x0B71);fn('glDepthFunc',None,[U])(0x0203);fn('glClearDepthf',None,[F])(1.)
    fn('glClearColor',None,[F,F,F,F])(0,0,0,0);fn('glClear',None,[U])(0x4000|0x0100)
    u3(position_program,'boundsMin',mesh['bounds']['min']);u3(position_program,'boundsMax',mesh['bounds']['max']);draw_base_mesh()
    if cleanup_on and patches:
        ui(position_program,'refinementPatchPass',1);ui(position_program,'debrisCleanupEnabled',0)
        for i,patch in enumerate(patches):
            ui(position_program,'refinementPatchIndex',i);u3(position_program,'boundsMin',patch['bounds']['min']);u3(position_program,'boundsMax',patch['bounds']['max']);bind_vao(patch['vao']);fn('glVertexAttrib1f',None,[U,F])(2,0);draw_elements(4,patch['indexCount'],0x1405,None)
    fn('glFinish',None,[])();result=np.empty((H,W,4),np.float32)
    fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,W,H,0x1908,0x1406,result.ctypes.data)
    result=result[::-1].copy();gl_check('position readback');disable(0x0B71);quad()
    fine_xyz=result[:,:,[0,2,1]]*np.array([1,-1,1],np.float32)*meta['longestMm']/.0794+(np.array(meta['fullDimensionsXYZ'],np.float32)-1)/2
    fine_xyz[(result[:,:,3]<.5)|matte]=np.nan
    np.save(options.lossless_output/(case['id']+'-fine-xyz.npy'),fine_xyz.astype(np.float32))
    checks.append(dict(case=case,world=world,imageSize=[W,H],sourceCap=cap_entry,validMeshPixels=int(np.isfinite(fine_xyz[:,:,0]).sum()),fineXYZArray=str(options.lossless_output/(case['id']+'-fine-xyz.npy'))))
    print(json.dumps(checks[-1]),flush=True)
(OUT/'validation.json').write_text(json.dumps(dict(source=fine.receipt(),reviewCulling=review_culling,reviewStreaming=stream_stats,checks=checks,scope='Unchanged v28 original geometry plus current local patches and masks. Actual production color render; diagnostic Float32 world-position attachment excludes visible measured cap pixels. Nearby reproducible camera, not exact screenshot registration.'),indent=2)+'\n')
