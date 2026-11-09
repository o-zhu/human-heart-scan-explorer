"""Actual source/GPU proof that coronary exposure leaves CT cut faces unchanged."""
from pathlib import Path
import os,sys,gc
os.environ.setdefault('LP_NUM_THREADS','2')
ROOT=Path(__file__).resolve().parents[1]
fixture=ROOT/'tests/reconstruction-detail-v35-native.py'
if '--output' not in sys.argv:sys.argv+=['--output',str(ROOT/'docs/coronary-v36/runtime')]
setup=fixture.read_text().split('\nchecks=[];source_checks=[]')[0]
setup=setup.replace('2400, 1600, 1500, 1000','480, 480, 240, 240')
exec(compile(setup,str(fixture),'exec'))

manifest=read_json(ROOT/'public/assets/coronary-v36/manifest.json')
field_texture=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(field_texture))
coronary_on=False;profile=None
configure_original=configure
def configure(program,*args,**options):
    configure_original(program,*args,**options)
    ui(program,'coronaryTexture',8);ui(program,'coronaryReady',int(coronary_on))
    u3(program,'coronaryDimensions',profile['dimensions']);uf(program,'coronaryThreshold',profile['threshold'])
    ui(program,'surfaceSmoothing',2 if coronary_on else 1)

checks=[]
for donor in donors:
    current_donor=donor['id'];profile=manifest['donors'][current_donor]
    source_manifest=read_json(public_path(donor['manifestUrl']));level=source_manifest['levels']['high']
    source=load_volume(level);source_hash=hashlib.sha256(source).hexdigest();texture(0,source,True)
    field=load_volume(profile)
    assert hashlib.sha256(field).hexdigest()==profile['rawSha256']
    active(0x84C0+8);bind(0x806F,field_texture)
    t3(0x806F,0,0x8229,*field.shape[::-1],0,0x1903,0x1401,field.ctypes.data)
    for key,value in [(0x2801,0x2601),(0x2800,0x2601),(0x2802,0x812F),(0x2803,0x812F),(0x8072,0x812F)]:param(0x806F,key,value)
    cleanup=read_json(public_path(donor['cleanupManifestUrl']))
    texture(2,np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()),np.uint8).reshape(*cleanup['dimensions'][::-1]).copy())
    views=read_json(public_path(donor['flowViewsUrl']))['presets']
    view=next(v for v in views if v['id']==('lv-inflow' if current_donor=='ladaf-2021-17' else 'rv-inflow'))
    source_cap=verified_image(view['texture']);texture(1,source_cap,True)
    world=view['world'];normal,right0,up0,center=[np.asarray(world[k]) for k in ['normal','right','up','center']]
    direction=unit(normal+right0*.20+up0*.07);forward=-direction;right=unit(np.cross(forward,up0));up=unit(np.cross(right,forward))
    distance=max(world['height']/.55,world['width']/.55)*.82
    basis=dict(eye=center+direction*distance,forward=forward,right=right,up=up)
    common=[level,cleanup,world,donor['displayWindow'],view['threshold'],source_cap.shape]
    for ready in [0,1]:
        coronary_on=False
        original=draw(programs['volume'],full,*common,ready=ready)
        matte=draw(matte_program,composed,*common,scene=full,ready=ready)[:,:,0]>0
        assert matte.sum()>500,(current_donor,ready,'Nontrivial measured face')
        coronary_on=True
        reveal=draw(programs['volume'],tiled,*common,ready=ready)
        assert np.array_equal(original[matte],reveal[matte]),(current_donor,ready,'Coronary mode altered a source CT face')
        composed_reveal=draw(programs['composite'],composed,*common,ready=ready,scene=tiled)
        assert np.array_equal(reveal,composed_reveal),(current_donor,ready,'Direct/composite mismatch')
        coronary_on=False
        restored=draw(programs['volume'],full,*common,ready=ready)
        assert np.array_equal(restored,original),(current_donor,ready,'Restore changed original pixels')
        assert hashlib.sha256(source).hexdigest()==source_hash
        item=dict(donor=current_donor,cap='prepared-fine' if ready else 'resident-original',
                  unchangedCutFacePixels=int(matte.sum()),maximumCutFaceChannelDifference=0,
                  restorationPixelExact=True,directEqualsComposite=True,originalSourceUnchanged=True,
                  sourceSha256=source_hash,preparedFieldSha256=profile['rawSha256'])
        checks.append(item);print(json.dumps(item),flush=True)
    del source,field;gc.collect()

report=dict(passed=True,checks=checks,driver=fn('glGetString',C.c_char_p,[U])(0x1F01).decode(),
            scope='Current production volume/composite GLSL with all three real donor volumes, independently prepared fields on texture8, existing reviewed masks, original source CT caps and separate surface thresholds. No browser/FPS claim.')
(OUT/'cap-invariance.json').write_text(json.dumps(report,indent=2)+'\n')
