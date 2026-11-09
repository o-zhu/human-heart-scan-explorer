#!/usr/bin/env python3
"""Review the optional Atlas palette with actual production GLSL and measured data.

Reuses the small verified v19 surface and resident-source fixture, so the review
does not need to upload the 25-million-triangle Gentle bank. It exercises the
same FineSurfacePass fragment used by Gentle and by native replacement pieces.
This is an offscreen transfer/geometry check, not a browser performance study.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'docs/atlas-cinematic-v27'
fixture = ROOT/'tests/fine-surface-v19-native.py'
sys.argv = [sys.argv[0], '--output', str(OUT)]
__file__ = str(fixture)
exec(compile(fixture.read_text().split('\ndonor = ')[0], str(fixture), 'exec'))

baseline = read_json(OUT/'baseline-shaders.json')
old_volume = compile_program(baseline['volume']['volume'])
old_composite = compile_program(baseline['volume']['composite'])
old_mesh = compile_mesh(baseline['fine']['vertex'], baseline['fine']['fragment'])
old_background = compile_program(baseline['fine']['background'])

# Compile the complete production function prefix for CPU/GPU transfer matching.
ramp_suffix = '''
void main(){float value=floor(gl_FragCoord.x)/255.;
fragColor=vec4(pow(max(capShade(vec3(0.),value),vec3(0.)),vec3(.89)),1.);}
'''
old_ramp = compile_program(baseline['volume']['volume'].split('void main(){')[0]+ramp_suffix)
profiles = [dict(windowLow=0,windowHigh=1,windowGamma=1,**profile) if 'windowLow' not in profile else profile for profile in baseline['profiles']]
expected = node('import {capColor} from "./public/render-styles.js";const profiles='+json.dumps(profiles)+';'
    'console.log(JSON.stringify(profiles.map(s=>Array.from({length:7},(_,p)=>Array.from({length:256},(_,i)=>'
    'capColor(i/255,s.capContrast,p,s).map(c=>Math.round(Math.pow(Math.max(0,c),.89)*255)))))));')
transfer_checks=[]
ramp_target=output(256,1)
for row,settings in enumerate(profiles):
    for palette in range(7):
        images=[]
        for program in ([old_ramp,programs['ramp']] if palette<6 else [programs['ramp']]):
            quad();use(program);bind_fbo(0x8D40,ramp_target['framebuffer']);viewport(0,0,256,1)
            ui(program,'palette',palette);ui(program,'anatomyReady',0)
            u3(program,'planeNormal',[0,0,1]);u3(program,'eye',[0,0,2])
            profile_uniforms(program,settings);draw_arrays(4,0,3)
            images.append(read_target(ramp_target)[0,:,:3])
        if len(images)==2:assert np.array_equal(images[0],images[1]),(row,palette,'prior transfer changed')
        delta=np.abs(images[-1].astype(np.int16)-np.asarray(expected[row][palette],np.int16))
        assert delta.max()<=1,(row,palette,int(delta.max()))
        transfer_checks.append(dict(profile=row,palette=palette,maxJsGpuChannelDifference=int(delta.max()),priorTransferExact=palette<6))

donor=next(d for d in donors if d['id']=='ladaf-2021-17')
manifest=read_json(ROOT/'public/assets/fine-surface-v19/manifest.json')
volume_manifest=read_json(public_path(donor['manifestUrl']));level=volume_manifest['levels']['high']
resident=load_volume(level);resident_hash=hashlib.sha256(resident.tobytes()).hexdigest();texture(0,resident,True)
cleanup=read_json(public_path(donor['cleanupManifestUrl']))
texture(2,np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()),np.uint8).reshape(*cleanup['dimensions'][::-1]).copy())
views=read_json(public_path(donor['flowViewsUrl']))['presets']
view=next(v for v in views if v['id']=='lv-inflow')
cap=verified_image(view['texture']);cap_hash=hashlib.sha256(cap.tobytes()).hexdigest();texture(1,cap,True)
common=[level,cleanup,view['world'],donor['displayWindow'],manifest['threshold'],cap.shape]
lod=next(lod for lod in manifest['lods'] if lod['id']=='detail')
mesh=install_mesh(mesh_arrays(manifest,lod))
palette=4
configure_base=configure
def configure(program,*args,**kwargs):
    configure_base(program,*args,**kwargs);ui(program,'palette',palette)

def mesh_image(common,clipped=True,old=False):
    mp=old_mesh if old else mesh_program;bp=old_background if old else background_program
    cp=old_composite if old else programs['composite']
    quad();bind_fbo(0x8D40,mesh_target['framebuffer']);viewport(0,0,W,H)
    disable(0x0B71);use(bp);u2(bp,'resolution',[W,H]);ui(bp,'palette',palette);draw_arrays(4,0,3)
    enable(0x0B71);fn('glDepthFunc',None,[U])(0x0203)
    fn('glClearDepthf',None,[F])(1.);fn('glClear',None,[U])(0x0100)
    configure(mp,mesh_target,*common,ready=1,clipped=clipped,skip=1)
    u3(mp,'boundsMin',mesh['bounds']['min']);u3(mp,'boundsMax',mesh['bounds']['max'])
    bind_vao(mesh['vao']);draw_elements(4,mesh['indexCount'],0x1405,None)
    quad();disable(0x0B71)
    return draw(cp,composed,*common,ready=1,clipped=clipped,scene=mesh_target)

render_checks=[]
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',19)
for name,clipped,close in [('cutaway',True,False),('valve-closeup',True,True),('whole-heart',False,False)]:
    local=common.copy()
    if close:local[2]=dict(view['world'],_cameraTarget=view['world']['target'],_cameraScale=.58)
    palette=4;prior=mesh_image(local,clipped,True);current=mesh_image(local,clipped)
    assert np.array_equal(prior,current),(name,'default fine surface changed')
    palette=6;atlas=mesh_image(local,clipped)
    palette=4;restored=mesh_image(local,clipped)
    assert np.array_equal(current,restored),(name,'palette restoration changed')
    sheet=Image.new('RGB',(2*W,H+44),'#0b1317')
    sheet.paste(Image.fromarray(current[:,:,:3]),(0,44));sheet.paste(Image.fromarray(atlas[:,:,:3]),(W,44))
    pen=ImageDraw.Draw(sheet);pen.text((12,12),'Tissue / space · existing default',font=font,fill='#efece0')
    pen.text((W+12,12),'Atlas cinematic · optional intensity colors',font=font,fill='#efece0')
    sheet.save(OUT/(name+'-comparison.jpg'),quality=95)
    Image.fromarray(atlas).save(OUT/(name+'-atlas.png'))
    render_checks.append(dict(view=name,kind='fine-mesh',priorDefaultByteExact=True,paletteRestorationByteExact=True,changedPixels=int(np.count_nonzero(np.any(atlas!=current,axis=2)))))
    print(json.dumps(render_checks[-1]),flush=True)

# Preserve scalar modes and old palette identities as well as the fine pass.
for mode in [0,1,2]:
    target_small=output(180,210)
    for palette in range(6):
        old=draw(old_volume,target_small,*common,mode=mode)
        new=draw(programs['volume'],target_small,*common,mode=mode)
        assert np.array_equal(old,new),(mode,palette,'prior scalar palette changed')
    palette=6
    atlas=draw(programs['volume'],target_small,*common,mode=mode)
    Image.fromarray(atlas).save(OUT/('scalar-mode-'+str(mode)+'-atlas.png'))
    render_checks.append(dict(kind='scalar-volume',mode=mode,priorPalettesByteExact=list(range(6)),atlasRendered=True))

assert hashlib.sha256(cap.tobytes()).hexdigest()==cap_hash
assert hashlib.sha256(resident.tobytes()).hexdigest()==resident_hash
shader_hash=lambda value:hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
report=dict(passed=True,sourceCommitBaseline=baseline['sourceCommit'],donorId=donor['id'],
    residentSourceHash=resident_hash,capSourceHash=cap_hash,fineMeshHash=lod['decodedSha256'],
    fineMeshTriangles=lod['triangles'],fineSourceSpacingUm=manifest['sourceSpacingUm'],
    compiledProductionPrograms=['volume','cap-composite','fine-surface','fine-background'],
    shaderSha256=dict(volume=shader_hash(sources),fine=shader_hash(fine_sources)),
    transferChecks=transfer_checks,renderChecks=render_checks,
    scope='Exact production GLSL in native offscreen EGL with verified measured source arrays and a v19 detailed surface; same shader also serves Ultra-high Fidelity and native replacement. Palette6 uses two resident intensity reads along the existing normal. Same geometry/threshold/source bytes. No anatomical classification, authored figure preset, path tracing or browser performance claim.')
(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(passed=True,output=str(OUT))),flush=True)
