#!/usr/bin/env python3
"""Production GLSL comparison using only bounded Gentle review geometry."""
from pathlib import Path
import argparse,sys,json,gzip,struct,gc
import numpy as np
from exact_transport import read_surface
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('region',choices=['tricuspid','pulmonary']);p.add_argument('--policy',type=Path);p.add_argument('--output',type=Path);p.add_argument('--lossless-output',type=Path);a=p.parse_args();region=a.region
DATA=Path('/workspace/data/cleanup-v28-right');OUT28=a.output or ROOT/'docs/cleanup-v28-right/render';OUT28.mkdir(parents=True,exist_ok=True)
LOSSLESS28=a.lossless_output or DATA/'render';LOSSLESS28.mkdir(parents=True,exist_ok=True)
POLICY28=a.policy
roi_path=DATA/(region+'-gentle-roi.npz')
prefix=(ROOT/'scripts/cleanup-v27/render_review.py').read_text().split('\ncases=')[0]
prefix=prefix.replace("('v26','v27')","('v27',)").replace("['v26']","['v27']").replace("active_version='v26'","active_version='v27'")
needle="arrays=load_mesh_arrays(manifest,lod);transport=arrays['_transport'];mesh=install_mesh(arrays)"
replacement="""local=np.load(roi_path)
arrays=dict(positions=local['positions'],normals=local['normals'],indices=local['indices'],bounds={'min':local['boundsMin'].tolist(),'max':local['boundsMax'].tolist()},vertexCount=len(local['positions']),indexCount=len(local['indices']))
for collection in collections.values():collection['flags']=local['flags']
transport={'boundedGentleRoi':str(roi_path),'triangles':len(arrays['indices'])//3}
mesh=install_mesh(arrays);local.close()"""
assert needle in prefix;prefix=prefix.replace(needle,replacement)
sys.argv=[sys.argv[0],'--output',str(OUT28),'--lossless-output',str(LOSSLESS28)]
exec(compile(prefix,str(ROOT/'scripts/cleanup-v27/render_review.py'),'exec'))

name='tricuspid-core-surface' if region=='tricuspid' else 'pulmonary-valve-lumen-surface'
policy_path=POLICY28 or ROOT/'docs/cleanup-v28-right/patch'/(name+'-policy.json');policy=read_json(policy_path);item=policy['surface']
payload=read_surface(policy_path.parent/item['file'],item);magic,version,nv,ni,po,no,io,_=struct.unpack_from('<8I',payload);assert magic==0x314d4648
arr=dict(positions=np.frombuffer(payload,'<u2',nv*3,po).reshape(nv,3),normals=np.frombuffer(payload,'<i2',nv*3,no).reshape(nv,3),indices=np.frombuffer(payload,'<u4',ni,io),bounds=item['bounds'],vertexCount=nv,indexCount=ni)
patch=install_mesh(arr)
bind_vao(patch['vao']);fn('glDisableVertexAttribArray',None,[U])(2);fn('glVertexAttrib1f',None,[U,F])(2,0.);quad()
for key in ['positions','normals','indices']:patch.pop(key,None)
del arr,payload;gc.collect()

case=(dict(id='tricuspid-y263',axis=1,coordinate=1048,target=[730,1048,1155],distance=.37) if region=='tricuspid' else dict(id='pulmonary-x194',axis=0,coordinate=772,target=[772,1260,825],distance=.37))
axis=case['axis'];coordinate=case['coordinate'];lo=[0,0,0];hi=meta['fullDimensionsXYZ'].copy();lo[axis]=coordinate;hi[axis]=coordinate+1
cap=np.take(fine.region(lo,hi),0,axis=2-axis).copy();texture(1,cap,True)
xyz=[948,948,1058];xyz[axis]=coordinate;center=world_from_fine(xyz);target=world_from_fine(case['target'])
normal=np.array([[1.,0,0],[0,0,-1.]][axis]);right=np.array([[0,0,-1.],[1.,0,0]][axis]);up=np.array([0,-1.,0]);direction=unit(normal+.08*right+.025*up)
world=dict(center=center.tolist(),normal=normal.tolist(),right=right.tolist(),up=up.tolist(),width=extent[2 if axis==0 else 0],height=extent[1],_eye=(target+direction*case['distance']).tolist(),_target=target.tolist())
common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]

def render(replacement):
    quad();bind_fbo(0x8D40,mesh_target['framebuffer']);viewport(0,0,W,H);disable(0x0B71);use(background_program);u2(background_program,'resolution',[W,H]);ui(background_program,'palette',4);draw_arrays(4,0,3)
    enable(0x0B71);fn('glDepthFunc',None,[U])(0x0203);fn('glClearDepthf',None,[F])(1.);fn('glClear',None,[U])(0x0100)
    configure(mesh_program,mesh_target,*common,ready=1,side=1,clipped=True,skip=1)
    ui(mesh_program,'nativeReplacementEnabled',int(replacement));ui(mesh_program,'nativePatchPass',0)
    u3(mesh_program,'nativeRegionMin',item['bounds']['min']);u3(mesh_program,'nativeRegionMax',item['bounds']['max'])
    u3(mesh_program,'boundsMin',mesh['bounds']['min']);u3(mesh_program,'boundsMax',mesh['bounds']['max']);bind_vao(mesh['vao']);draw_elements(4,mesh['indexCount'],0x1405,None)
    if replacement:
        ui(mesh_program,'nativePatchPass',1);u3(mesh_program,'boundsMin',patch['bounds']['min']);u3(mesh_program,'boundsMax',patch['bounds']['max']);bind_vao(patch['vao']);draw_elements(4,patch['indexCount'],0x1405,None)
    ui(mesh_program,'nativeReplacementEnabled',0);ui(mesh_program,'nativePatchPass',0);quad();disable(0x0B71)
    return draw(programs['composite'],composed,*common,ready=1,side=1,clipped=True,scene=mesh_target)
before=render(False);after=render(True);restored=render(False);assert np.array_equal(before,restored)
sheet=Image.new('RGB',(2*W,H+48),'#101a1d');font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20);pen=ImageDraw.Draw(sheet)
for i,(title,img) in enumerate([('v27 Gentle ROI',before),('Source-guided refined surface',after)]):
    sheet.paste(Image.fromarray(img[:,:,:3]),(i*W,48));pen.text((i*W+16,14),title,font=font,fill='#eee9dd')
    Image.fromarray(img).save(LOSSLESS28/(region+('-after.png' if i else '-before.png')))
sheet.save(OUT28/(region+'-comparison.jpg'),quality=96)
checks=dict(case=case,originalRoiTriangles=mesh['indexCount']//3,refinedTriangles=patch['indexCount']//3,changedPixels=int(np.any(before!=after,axis=2).sum()),offOnOffExact=True,sourceCapSha256=hashlib.sha256(cap.tobytes()).hexdigest(),shaderSha256=hashlib.sha256((ROOT/'public/fine-surface.js').read_bytes()).hexdigest(),scope='Actual production GLSL, bounded originalGentleROI and source-refined local patch. The before/after sourcecap is heldfixed here; integrated density/cap low-band exclusion is tested by root. No fullGentleGLupload or browserperformance claim.')
(OUT28/(region+'-validation.json')).write_text(json.dumps(checks,indent=2)+'\n');print(json.dumps(checks),flush=True)
