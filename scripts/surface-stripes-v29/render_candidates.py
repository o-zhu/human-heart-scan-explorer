#!/usr/bin/env python3
"""Same-geometry, actual-production shading comparison for the stripe report."""
from pathlib import Path
import sys,os
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28'))
base=(ROOT/'scripts/cleanup-v29-left/locate.py').read_text().split('\nneedle=')[0]
exec(compile(base,str(ROOT/'scripts/cleanup-v29-left/locate.py'),'exec'))
assert saved_options.stream_triangles,'Use bounded streamed source triangles.'
normal_root=Path('/workspace/data/heart-v29-stripes')
source=(ROOT/'scripts/cleanup-v29-left/locate.py').read_text()
cap_code=source[source.index('section_manifest='):source.index('\nfor case in selected:')]
exec(compile(cap_code,str(ROOT/'scripts/cleanup-v29-left/locate.py'),'exec'))
reports=[]
for case in selected:
    used=np.load(Path('/workspace/data/cleanup-v29-left/camera-geometry')/case['id']/'used.npy',mmap_mode='r')
    assert len(used)==stream_arrays['vertexCount']
    axis=case['axis'];coordinate=case['coordinate'];cap,cap_entry=exact_section(axis,coordinate);texture(1,cap,True)
    xyz=[948,948,1058];xyz[axis]=coordinate;center=world_from_fine(xyz);target=world_from_fine(case['target'])
    normal=np.array([[1.,0,0],[0,0,-1.],[0,1.,0]][axis]);right=np.array([[0,0,-1.],[1.,0,0],[1.,0,0]][axis]);up=np.array([[0,-1.,0],[0,-1.,0],[0,0,1.]][axis])
    direction=unit(np.array(case.get('direction',normal+.08*right+.025*up)))
    world=dict(center=center.tolist(),normal=normal.tolist(),right=right.tolist(),up=up.tolist(),width=extent[2 if axis==0 else 0],height=extent[2 if axis==2 else 1],_eye=(target+direction*case['distance']).tolist(),_target=target.tolist())
    common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]
    original_normals=stream_arrays['normals']
    before=render_mesh(mesh,common)
    matte=draw(matte_program,composed,*common,ready=1,scene=mesh_target)[:,:,0]>0
    images=[('Original unit weights',before)]
    for name in os.environ.get('HEART_NORMAL_CANDIDATES','area,angle').split(','):
        candidate=np.load(normal_root/(name+'-normals.npy'),mmap_mode='r')
        stream_arrays['normals']=candidate[used]
        after=render_mesh(mesh,common)
        assert np.array_equal(before[matte],after[matte]),'Measured cap changed'
        Image.fromarray(after).save(options.lossless_output/(case['id']+'-'+name+'.png'))
        images.append((name.title()+' normals',after))
        reports.append({'case':case,'normalCandidate':name,'changedPixels':int(np.any(before!=after,axis=2).sum()),'measuredCapIdentical':True,'originalGeometryUnchanged':True,'sourceNormals':str(normal_root/(name+'-normals.npy'))})
    stream_arrays['normals']=original_normals
    restored=render_mesh(mesh,common);assert np.array_equal(before,restored)
    sheet=Image.new('RGB',(W*len(images),H+64),'#0b1317');pen=ImageDraw.Draw(sheet);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
    for i,(label,pixels) in enumerate(images):
        sheet.paste(Image.fromarray(pixels[:,:,:3]),(W*i,64));pen.text((W*i+18,18),label,font=font,fill='#efece0')
    sheet.save(OUT/(case['id']+'-normals.jpg'),quality=97)
report={'productionShaders':True,'positionsUnchanged':True,'trianglesUnchanged':True,'exactOriginalRestoration':True,'checks':reports,'scope':'Shading-only native EGL comparison; no claim of browser performance or anatomical validation.'}
(OUT/'normal-render-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
