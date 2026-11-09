#!/usr/bin/env python3
"""Locate visible retained fragments in the original fine source coordinates.

This diagnostic uses the production vertex projection, visibility masks and
depth buffer. Its extra float framebuffer records the visible surface position;
it never alters source or shipped rendering code.
"""
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[2]
prefix=(ROOT/'scripts/cleanup-v25/render_review.py').read_text().split('fine=FineSource')[0]
sys.argv=[sys.argv[0],'--output',str(ROOT/'docs/cleanup-v26/locate')]
exec(compile(prefix,str(ROOT/'scripts/cleanup-v25/render_review.py'),'exec'))
fine=FineSource(cache_bricks=16);meta=fine.meta;extent=manifest['extent']
DATA=Path('/workspace/data/cleanup-v26');DATA.mkdir(parents=True,exist_ok=True)

def world_from_fine(xyz):
    q=(np.array(xyz)-(np.array(meta['fullDimensionsXYZ'])-1)/2)*meta['sourceSpacingUm']/1000/meta['longestMm']
    return q[[0,2,1]]*[1,1,-1]

location_fragment=fine_sources['fragment'].replace('fragColor=vec4(pow(max(color,vec3(0.)),vec3(.89)),1.);','fragColor=vec4(toTex(meshPosition)*(lumenFineDimensions-1.),1.);')
location_program=compile_mesh(fine_sources['vertex'],location_fragment)
location_target=depth_output(W,H)
active(0x84C5);bind(0x0DE1,location_target['texture'])
t2(0x0DE1,0,0x8814,W,H,0,0x1908,0x1406,None)
bind_fbo(0x8D40,location_target['framebuffer'])
assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5

for name,coordinate,target,distance in [
 ('atrial-305',1216,[1220,1216,870],.50),
 ('outflow-305',1216,[950,1216,540],.65),
 ('valves-265',1056,[1060,1056,1180],.60),
 ('rv-apex-249',992,[800,992,1560],.55),
]:
    cap=np.take(fine.region([0,coordinate,0],[1897,coordinate+1,2117]),0,axis=1).copy();texture(1,cap,True)
    center=world_from_fine([948,coordinate,1058]);target=world_from_fine(target)
    normal=np.array([0,0,-1.]);right=np.array([1.,0,0]);up=np.array([0,-1.,0]);direction=unit(normal+.08*right+.025*up)
    world=dict(center=center.tolist(),normal=normal.tolist(),right=right.tolist(),up=up.tolist(),width=extent[0],height=extent[1],_eye=(target+direction*distance).tolist(),_target=target.tolist())
    common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]
    cleanup_on=True
    after=render_mesh(mesh,common)
    lossless=DATA/'locate';lossless.mkdir(parents=True,exist_ok=True)
    Image.fromarray(after).save(lossless/(name+'-v25.png'))
    Image.fromarray(after[:,:,:3]).save(OUT/(name+'-v25.jpg'),quality=93)
    configure(location_program,location_target,*common,ready=1,side=1,clipped=True,skip=1)
    enable(0x0B71);fn('glDepthFunc',None,[U])(0x0203)
    fn('glClearColor',None,[F,F,F,F])(0,0,0,0);fn('glClearDepthf',None,[F])(1.)
    fn('glClear',None,[U])(0x4000|0x0100)
    u3(location_program,'boundsMin',mesh['bounds']['min']);u3(location_program,'boundsMax',mesh['bounds']['max'])
    bind_vao(mesh['vao']);draw_elements(4,mesh['indexCount'],0x1405,None)
    fn('glFinish',None,[])()
    locations=np.zeros((H,W,4),np.float32)
    fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,W,H,0x1908,0x1406,locations.ctypes.data)
    assert fn('glGetError',U,[])()==0
    locations=locations[::-1].copy()
    np.savez_compressed(DATA/(name+'-locations.npz'),locations=locations,world=world)
    quad();disable(0x0B71)
    print(name,flush=True)
