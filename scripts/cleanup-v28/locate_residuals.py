#!/usr/bin/env python3
"""Source-coordinate readbacks of the unchanged v27 Gentle surface.

Diagnostic float attachments do not modify production source or geometry.
The paired color image uses the actual production shader and measured cap.
"""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
base = (ROOT/'scripts/cleanup-v27/render_review.py').read_text().split('\ncases=')[0]
base = base.replace("ROOT/'docs/cleanup-v27/render'", "ROOT/'docs/cleanup-v28/locate'")
base = base.replace("Path('/workspace/data/cleanup-v27/render')", "Path('/workspace/data/cleanup-v28/locate')")
base = base.replace("('v26','v27')", "('v27',)").replace("['v26']", "['v27']").replace("active_version='v26'", "active_version='v27'")
exec(compile(base, str(ROOT/'scripts/cleanup-v27/render_review.py'), 'exec'))

position_fragment = fine_sources['fragment'].replace(
    'fragColor=vec4(pow(max(color,vec3(0.)),vec3(.89)),1.);',
    'fragColor=vec4(meshPosition,1.);')
assert position_fragment != fine_sources['fragment']
position_program = compile_mesh(fine_sources['vertex'], position_fragment)
positions_target = depth_output(W, H)
active(0x84C0+12); bind(0x0DE1,positions_target['texture'])
t2(0x0DE1,0,0x8814,W,H,0,0x1908,0x1406,None)
bind_fbo(0x8D40,positions_target['framebuffer'])
assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5
gl_check('float diagnostic target')

cases = [
    dict(id='lvot-y262',axis=1,coordinate=1044,target=[1080,1044,1120],distance=.5),
    dict(id='la-y316',axis=1,coordinate=1260,target=[1270,1260,810],distance=.5),
    dict(id='tricuspid-y263',axis=1,coordinate=1048,target=[760,1048,1220],distance=.55),
    dict(id='pulmonary-x194',axis=0,coordinate=772,target=[772,1280,750],distance=.55),
    dict(id='pulmonary-x313',axis=0,coordinate=1248,target=[1100,1280,710],distance=.6),
    dict(id='inlet-x313',axis=0,coordinate=1248,target=[1248,850,650],distance=.55),
]
checks=[]
for case in cases:
    if options.case and case['id'] not in options.case: continue
    axis=case['axis']; coordinate=case['coordinate'];lo=[0,0,0];hi=meta['fullDimensionsXYZ'].copy();lo[axis]=coordinate;hi[axis]=coordinate+1
    cap=np.take(fine.region(lo,hi),0,axis=2-axis).copy();texture(1,cap,True)
    xyz=[948,948,1058];xyz[axis]=coordinate;center=world_from_fine(xyz);target=world_from_fine(case['target'])
    normal=np.array([[1.,0,0],[0,0,-1.],[0,1.,0]][axis]);right=np.array([[0,0,-1.],[1.,0,0],[1.,0,0]][axis]);up=np.array([[0,-1.,0],[0,-1.,0],[0,0,1.]][axis])
    direction=unit(normal+.08*right+.025*up)
    world=dict(center=center.tolist(),normal=normal.tolist(),right=right.tolist(),up=up.tolist(),width=extent[2 if axis==0 else 0],height=extent[2 if axis==2 else 1],_eye=(target+direction*case['distance']).tolist(),_target=target.tolist())
    common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]
    image=render_mesh(mesh,common)
    Image.fromarray(image).save(options.lossless_output/(case['id']+'-v27.png'))
    Image.fromarray(image[:,:,:3]).save(OUT/(case['id']+'-v27.jpg'),quality=97)
    matte=draw(matte_program,composed,*common,ready=1,scene=mesh_target)[:,:,0]>0
    quad();configure(position_program,positions_target,*common,ready=1,skip=1)
    enable(0x0B71);fn('glDepthFunc',None,[U])(0x0203);fn('glClearDepthf',None,[F])(1.)
    fn('glClearColor',None,[F,F,F,F])(0,0,0,0);fn('glClear',None,[U])(0x4000|0x0100)
    u3(position_program,'boundsMin',mesh['bounds']['min']);u3(position_program,'boundsMax',mesh['bounds']['max'])
    bind_vao(mesh['vao']);draw_elements(4,mesh['indexCount'],0x1405,None)
    fn('glFinish',None,[])();result=np.empty((H,W,4),np.float32)
    fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,W,H,0x1908,0x1406,result.ctypes.data)
    result=result[::-1].copy();gl_check('position readback');disable(0x0B71);quad()
    fine_xyz=result[:,:,[0,2,1]]*np.array([1,-1,1],np.float32)*meta['longestMm']/.0794+(np.array(meta['fullDimensionsXYZ'],np.float32)-1)/2
    fine_xyz[(result[:,:,3]<.5)|matte]=np.nan
    np.save(options.lossless_output/(case['id']+'-fine-xyz.npy'),fine_xyz.astype(np.float32))
    checks.append(dict(case=case,world=world,imageSize=[W,H],validMeshPixels=int(np.isfinite(fine_xyz[:,:,0]).sum()),fineXYZArray=str(options.lossless_output/(case['id']+'-fine-xyz.npy'))))
    print(json.dumps(checks[-1]),flush=True)
(OUT/'validation.json').write_text(json.dumps(dict(source=fine.receipt(),checks=checks,scope='Unchanged v27 source geometry and cleanup. Actual production color render; diagnostic Float32 world-position attachment excludes visible measured cap pixels. Nearby reproducible camera, not exact screenshot registration.'),indent=2)+'\n')
