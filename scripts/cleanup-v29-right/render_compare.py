#!/usr/bin/env python3
"""Exact-camera current-v28 versus bounded v29 replacement EGL evidence.

Uses production shaders, the same original scene, source cap and camera, and
consecutive exact source triangles. Only the supplied replacement slots vary.
"""
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28'))
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28-right'))
code=(ROOT/'scripts/cleanup-v28/render_review.py').read_text().split('\nchecks=[]')[0]
code=code.replace("ROOT/'scripts/cleanup-v28/review-cameras.json'", "ROOT/'scripts/cleanup-v29-right/review-cameras.json'")
code=code.replace("Path('/workspace/data/cleanup-v28/camera-geometry')", "Path('/workspace/data/cleanup-v29-right/camera-geometry')")
code=code.replace("ROOT/'docs/cleanup-v28/render'", "ROOT/'docs/cleanup-v29-right/render'")
code=code.replace("Path('/workspace/data/cleanup-v28/render')", "Path('/workspace/data/cleanup-v29-right/render')")
code=code.replace('options=parser.parse_args();saved_options=options',"parser.add_argument('--replace',action='append',default=[],help='old-slot-id=policy.json');parser.add_argument('--append',action='append',default=[],help='policy.json for one additional slot');options=parser.parse_args();saved_options=options")
exec(compile(code,str(ROOT/'scripts/cleanup-v28/render_review.py'),'exec'))
old_patches=patches.copy();candidate=patches.copy()
for replacement in options.replace:
    old_id,file=replacement.split('=',1);path=Path(file);index=next(i for i,p in enumerate(candidate) if p['policy']['id']==old_id)
    candidate[index]=patch_install(json.loads(path.read_text()),path.parent,index)
for file in options.append:
    path=Path(file);candidate.append(patch_install(json.loads(path.read_text()),path.parent,len(candidate)))
assert len(candidate)<=4
checks=[]
cap_loader=(ROOT/'scripts/cleanup-v29-right/locate.py').read_text().split('cap_sources=[]',1)[1].split('\nfor case in selected:',1)[0]
cap_sources=[]
exec(compile(cap_loader,str(ROOT/'scripts/cleanup-v29-right/locate.py'),'exec'))
for case in selected:
    axis=case['axis'];coordinate=case['coordinate'];lo=[0,0,0];hi=meta['fullDimensionsXYZ'].copy();lo[axis]=coordinate;hi[axis]=coordinate+1
    cap=measured_cap(axis,coordinate,lo,hi);cap_hash=hashlib.sha256(cap.tobytes()).hexdigest();texture(1,cap,True)
    xyz=[948,948,1058];xyz[axis]=coordinate;center=world_from_fine(xyz);target=world_from_fine(case['target'])
    normal=np.array([[1.,0,0],[0,0,-1.],[0,1.,0]][axis]);right=np.array([[0,0,-1.],[1.,0,0],[1.,0,0]][axis]);up=np.array([[0,-1.,0],[0,-1.,0],[0,0,1.]][axis]);direction=unit(np.array(case.get('direction',normal+.08*right+.025*up)))
    world=dict(center=center.tolist(),normal=normal.tolist(),right=right.tolist(),up=up.tolist(),width=extent[2 if axis==0 else 0],height=extent[2 if axis==2 else 1],_eye=(target+direction*case['distance']).tolist(),_target=target.tolist(),_whole=case.get('whole',False))
    common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]
    set_version('v28');cleanup_on=True;patches=old_patches;before=render_mesh(mesh,common);patches=candidate;after=render_mesh(mesh,common)
    restored=None;off_exact=None
    if not options.quick:
        patches=old_patches;again=render_mesh(mesh,common);restored=bool(np.array_equal(before,again));assert restored
        cleanup_on=False;old_off=render_mesh(mesh,common);patches=candidate;new_off=render_mesh(mesh,common);off_exact=bool(np.array_equal(old_off,new_off));assert off_exact;cleanup_on=True
    assert hashlib.sha256(cap.tobytes()).hexdigest()==cap_hash
    Image.fromarray(before).save(options.lossless_output/(case['id']+'-before.png'));Image.fromarray(after).save(options.lossless_output/(case['id']+'-after.png'))
    sheet=Image.new('RGB',(W*2,H+64),'#0b1317');sheet.paste(Image.fromarray(before[:,:,:3]),(0,64));sheet.paste(Image.fromarray(after[:,:,:3]),(W,64));pen=ImageDraw.Draw(sheet);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22);pen.text((18,18),'Current v28',font=font,fill='#efece0');pen.text((W+18,18),'Bounded v29 candidate',font=font,fill='#efece0');sheet.save(OUT/(case['id']+'-comparison.jpg'),quality=97)
    check=dict(case=case,changedPixels=int(np.count_nonzero(np.any(before!=after,axis=2))),totalPixels=W*H,reversible=restored,originalOffExact=off_exact,sourceCapSha256=cap_hash,imageHashes=dict(before=hashlib.sha256(before.tobytes()).hexdigest(),after=hashlib.sha256(after.tobytes()).hexdigest()),world=world);checks.append(check);print(json.dumps(check),flush=True)
report=dict(source=fine.receipt(),capSources=cap_sources,checks=checks,originalPatches=[p['policy'] for p in old_patches],candidatePatches=[p['policy'] for p in candidate],reviewCulling=review_culling,productionShaders=True,rendererSha256=hashlib.sha256((ROOT/'public/renderer.js').read_bytes()).hexdigest(),fineSurfaceSha256=hashlib.sha256((ROOT/'public/fine-surface.js').read_bytes()).hexdigest(),scope='Same camera, production GLSL, exact source vertices and measured source cap. This compares only bounded surface replacements. Not a clinical validation or browser-performance claim.')
report['reviewStreaming']={**stream_stats,'triangleOrderPreserved':True,'sourceAttributesUnchanged':True,'framebufferAndDepthPreservedBetweenBatches':True,'productionShadersUnmodified':True}
(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
