#!/usr/bin/env python3
"""Production-GLSL mesh cutaways near the user screenshot planes.

Exact screenshot camera is unavailable. These are reproducible nearby views,
with candidate geometry highlighted by source-space ROI solely for review.
No mesh or measured section is altered by this diagnostic.
"""
from pathlib import Path
import sys
import argparse
import gc

REPOSITORY = Path(__file__).resolve().parents[2]
arguments=argparse.ArgumentParser(description=__doc__)
arguments.add_argument('--mesh-manifest',type=Path,default=REPOSITORY/'public/assets/fine-surface-v19/manifest.json')
arguments.add_argument('--output',type=Path,default=REPOSITORY/'docs/lumen-artifacts-v23')
arguments.add_argument('--stream-mesh',action='store_true',help='Stream ordered gzip parts into one decoded buffer, upload once and release CPU geometry before rendering.')
options=arguments.parse_args()
fixture = REPOSITORY / 'tests/fine-surface-v19-native.py'
sys.argv = [sys.argv[0], '--output', str(options.output)]
# Existing native-EGL helpers, production GLSL and source verification only.
original_file = __file__
__file__ = str(fixture)
setup = fixture.read_text().split('\ndonor = ')[0]
exec(compile(setup, str(fixture), 'exec'))
__file__ = original_file

sys.path.insert(0, str(REPOSITORY / 'scripts/fine-detail-v23'))
from source import FineSource
if options.stream_mesh:
    from mesh_transport import load_mesh_arrays
(OUT/'candidates').mkdir(parents=True,exist_ok=True)

base_configure = configure
mask_enabled = False


def configure(program, out, level, cleanup, world, *args, **kwargs):
    base_configure(program, out, level, cleanup, world, *args, **kwargs)
    eye = np.asarray(world['_eye']); target = np.asarray(world['_target'])
    forward = unit(target - eye)
    right = unit(np.cross(forward, np.asarray(world['up'])))
    up = unit(np.cross(right, forward))
    for name, value in dict(eye=eye, forward=forward, right=right, up=up).items():
        u3(program, name, value)
    ui(program,'lumenCleanupReady',1)
    ui(program,'lumenCleanupEnabled',1 if mask_enabled else 0)
    u3(program,'lumenFineDimensions',lumen_manifest['sourceFullDimensionsXYZ'])
    for index,item in enumerate(lumen_manifest['masks']):
        ui(program,'lumenMaskTexture'+str(index),6+index)
        u3(program,'lumenMaskOrigin'+str(index),item['lowerFullFineXYZ'])
        u3(program,'lumenMaskDimensions'+str(index),item['dimensionsXYZ'])


def world_from_fine(xyz, meta):
    p = (np.asarray(xyz) - (np.asarray(meta['fullDimensionsXYZ']) - 1) / 2) * meta['sourceSpacingUm'] / 1000 / meta['longestMm']
    return p[[0, 2, 1]] * [1, 1, -1]


donor = next(d for d in donors if d['id'] == 'ladaf-2021-17')
manifest = read_json(options.mesh_manifest)
assert manifest['donorId']==donor['id'] and manifest['format']=='HFM1' and manifest['sourceSpacingUm']==79.4
assert abs(manifest['threshold']-.28)<1e-12
volume_manifest = read_json(public_path(donor['manifestUrl']))
level = volume_manifest['levels']['high']; texture(0, load_volume(level), True)
cleanup = read_json(public_path(donor['cleanupManifestUrl']))
cleanup_raw = gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes())
texture(2, np.frombuffer(cleanup_raw, np.uint8).reshape(*cleanup['dimensions'][::-1]).copy())
fine = FineSource(cache_bricks=16)
meta = fine.meta
extent = manifest['extent']
lumen_manifest=read_json(REPOSITORY/'public/assets/lumen-cleanup-v23/manifest.json')
for index,item in enumerate(lumen_manifest['masks']):
    blob=public_path(item['url']).read_bytes()
    assert hashlib.sha256(blob).hexdigest()==item['sha256']
    raw=gzip.decompress(blob)
    assert hashlib.sha256(raw).hexdigest()==item['decodedSha256']
    data=np.frombuffer(raw,np.uint8).reshape(item['dimensionsXYZ'][::-1]).copy()
    mask_tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(mask_tex))
    active(0x84C0+6+index);bind(0x806F,mask_tex)
    t3(0x806F,0,0x8229,*data.shape[::-1],0,0x1903,0x1401,data.ctypes.data)
    for key,value in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812F),(0x2803,0x812F),(0x8072,0x812F)]:param(0x806F,key,value)
render_checks=[]
mesh_cache={}
mesh_transport_receipts={}


def installed_mesh(lod):
    if not options.stream_mesh:return install_mesh(mesh_arrays(manifest,lod))
    if lod['id'] not in mesh_cache:
        arrays=load_mesh_arrays(manifest,lod)
        mesh=install_mesh(arrays)
        mesh_transport_receipts[lod['id']]=arrays['_transport']
        for key in ['positions','normals','indices','_rawOwner']:
            mesh.pop(key,None)
        arrays.clear();del arrays;gc.collect()
        mesh_cache[lod['id']]=mesh
    return mesh_cache[lod['id']]


def permitted_pixel_region(world):
    """Project conservative mask support plus the four-sample AO radius."""
    from itertools import product
    eye=np.array(world['_eye']);forward=unit(np.array(world['_target'])-eye)
    right=unit(np.cross(forward,np.array(world['up'])));up=unit(np.cross(right,forward))
    region=np.zeros((H,W),bool);boxes=[]
    for item in lumen_manifest['masks']:
        a,b=np.array(item['nonzeroBoundsFullFineXYZ'])
        p,q=world_from_fine(a-.5,meta),world_from_fine(b-.5,meta)
        # AO samples extend at most 0.024 world units from the lit surface.
        low=np.minimum(p,q)-.025;high=np.maximum(p,q)+.025
        corners=np.array(list(product(*zip(low,high))))
        vectors=corners-eye;depth=vectors@forward
        assert np.all(depth>.01)
        px=(vectors@right/(depth*.32*(W/H))+1)*W/2-.5
        py=(1-vectors@up/(depth*.32))*H/2-.5
        x0,x1=int(np.floor(px.min()))-2,int(np.ceil(px.max()))+3
        y0,y1=int(np.floor(py.min()))-2,int(np.ceil(py.max()))+3
        region[max(0,y0):max(0,min(H,y1)),max(0,x0):max(0,min(W,x1))]=True
        boxes.append(dict(id=item['id'],xyxy=[x0,y0,x1,y1],worldGuard=.025))
    return region,boxes

cases = [
    dict(id='atrial', axis=1, coordinate=1184, target=[1050, 1184, 760], distance=.78,
         normal=[0,0,-1], right=[1,0,0], up=[0,-1,0], roi=[[1120,1040,680],[1340,1260,1050]]),
    dict(id='outflow', axis=0, coordinate=980, target=[980,1130,520], distance=.69,
         normal=[-1,0,0], right=[0,0,-1], up=[0,-1,0], roi=[[940,990,260],[1100,1110,370]]),
]

for case in cases:
    lo = [0,0,0]; hi = meta['fullDimensionsXYZ'].copy()
    lo[case['axis']], hi[case['axis']] = case['coordinate'], case['coordinate'] + 1
    slab = fine.region(lo, hi)
    cap = np.take(slab, 0, axis=2-case['axis']).copy()
    # Texture first row is +up; scientific section raster has source z down.
    texture(1, cap, True)
    center = world_from_fine([(n-1)/2 if axis != case['axis'] else case['coordinate'] for axis,n in enumerate(meta['fullDimensionsXYZ'])], meta)
    target = world_from_fine(case['target'], meta)
    normal = np.asarray(case['normal'], dtype=float)
    right = np.asarray(case['right'], dtype=float)
    up = np.asarray(case['up'], dtype=float)
    direction = unit(normal + .08*right + .025*up)
    world = dict(center=center.tolist(), normal=normal.tolist(), right=right.tolist(), up=up.tolist(), width=extent[0], height=extent[1], _eye=(target+direction*case['distance']).tolist(), _target=target.tolist())
    common = [level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]
    # The diagnostic ROI only tints geometry; it never discards a fragment.
    rlo, rhi = np.array(case['roi'][0]), np.array(case['roi'][1])
    p1, p2 = world_from_fine(rlo,meta), world_from_fine(rhi,meta)
    wlo,wmax = np.minimum(p1,p2),np.maximum(p1,p2)
    gl_lo='vec3('+','.join(f'{x:.9f}' for x in wlo)+')'
    gl_hi='vec3('+','.join(f'{x:.9f}' for x in wmax)+')'
    fragment = fine_sources['fragment'].replace('fragColor=vec4(',f'if(all(greaterThanEqual(meshPosition,{gl_lo}))&&all(lessThanEqual(meshPosition,{gl_hi}))) color=mix(color,vec3(1.,.12,.05),.7);\n fragColor=vec4(')
    mark_program = compile_mesh(fine_sources['vertex'],fragment)
    outputs=[]
    for lod in manifest['lods']:
        mesh = installed_mesh(lod)
        mask_enabled=False
        clean = render_mesh(mesh, common)
        old_program = mesh_program; mesh_program = mark_program
        mark = render_mesh(mesh, common)
        mesh_program = old_program
        mask_enabled=True
        after=render_mesh(mesh,common)
        mask_enabled=False
        restored=render_mesh(mesh,common)
        assert np.array_equal(clean,restored),'Turning cleanup off did not exactly restore the image.'
        permitted,boxes=permitted_pixel_region(world)
        changed=np.any(after!=clean,axis=2)
        outside=int((changed&~permitted).sum())
        assert outside==0,(case['id'],lod['id'],'pixels outside projected candidate/AO support changed',outside)
        assert changed.sum()>20,'Optional cleanup did not affect the intended view.'
        render_checks.append(dict(case=case['id'],lod=lod['id'],changedPixels=int(changed.sum()),unchangedPixels=int((~changed).sum()),outsideTargetInfluenceChangedPixels=outside,permittedInfluencePixels=int(permitted.sum()),influenceBoxes=boxes,offOnOffRestoresExactly=True,productionShader=True,sourceCapSha256=hashlib.sha256(cap.tobytes()).hexdigest()))
        Image.fromarray(clean).save(OUT/(case['id']+'-'+lod['id']+'-review.png'))
        Image.fromarray(mark).save(OUT/(case['id']+'-'+lod['id']+'-candidate-highlight.png'))
        Image.fromarray(after).save(OUT/'candidates'/(case['id']+'-'+lod['id']+'-candidate-hidden.png'))
        outputs.append((lod['id'],clean,mark,after))
        if not options.stream_mesh:
            fn('glDeleteVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(mesh['vao']))
            for buffer in mesh['buffers']:fn('glDeleteBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer))
    sheet=Image.new('RGB',(W*2,(H+46)*len(outputs)),'#0b1317')
    pen=ImageDraw.Draw(sheet); font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
    for row,(lod,clean,mark,after) in enumerate(outputs):
        sheet.paste(Image.fromarray(clean[:,:,:3]),(0,row*(H+46)+46))
        sheet.paste(Image.fromarray(mark[:,:,:3]),(W,row*(H+46)+46))
        pen.text((12,row*(H+46)+12),f'{case["id"].title()} candidate · {lod} mesh',font=font,fill='#efece0')
        pen.text((W+12,row*(H+46)+12),'Candidate region highlighted for review',font=font,fill='#efece0')
    sheet.save(OUT/(case['id']+'-geometry-review.jpg'),quality=95)
    for row,(lod,clean,mark,after) in enumerate(outputs):
        sheet.paste(Image.fromarray(after[:,:,:3]),(W,row*(H+46)+46))
        pen.rectangle([W,row*(H+46),2*W,row*(H+46)+45],fill='#0b1317')
        pen.text((W+12,row*(H+46)+12),'Optional candidate material exclusion',font=font,fill='#efece0')
    sheet.save(OUT/'candidates'/(case['id']+'-display-exclusion-review.jpg'),quality=95)
    (OUT/(case['id']+'-geometry-review.json')).write_text(json.dumps(dict(case=case,world=world,exactScreenshotCamera=False,source=fine.receipt(),scope='Production mesh/cap rendering at screenshot plane with a nearby reproducible camera. Highlight is a region of interest, not a removal mask or anatomical segmentation.'),indent=2)+'\n')
for mesh in mesh_cache.values():
    fn('glDeleteVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(mesh['vao']))
    for buffer in mesh['buffers']:fn('glDeleteBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer))
shader_hash=lambda value:hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
report=dict(passed=True,source=fine.receipt(),productionShaders=True,meshManifest=str(options.mesh_manifest),meshManifestSha256=hashlib.sha256(options.mesh_manifest.read_bytes()).hexdigest(),transport=mesh_transport_receipts,rendererShaderSha256=hashlib.sha256((REPOSITORY/'public/renderer.js').read_bytes()).hexdigest(),fineSurfaceShaderSha256=hashlib.sha256((REPOSITORY/'public/fine-surface.js').read_bytes()).hexdigest(),exportedGlslSha256=dict(volume=shader_hash(sources),fine=shader_hash(fine_sources)),renderParameters=dict(outputPixels=[W,H],fov=.32,palette=4,surfaceSmoothing=1,threshold=manifest['threshold'],displayWindow=donor['displayWindow']),maskManifestSha256=hashlib.sha256((REPOSITORY/'public/assets/lumen-cleanup-v23/manifest.json').read_bytes()).hexdigest(),checks=render_checks,scope='Actual production GLSL and frozen public masks in native EGL; same-camera off/on/off and outside projected mask plus finite AO support invariance. Source cap texture bytes unchanged. Not a browser/device performance or biological accuracy claim.')
(OUT/'production-mask-render-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(completed=True,checks=render_checks,source=fine.receipt())),flush=True)
