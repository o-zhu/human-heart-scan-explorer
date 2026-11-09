"""Compare native camera frames with settled detail and the former coarse scene.

Uses production GLSL, source-verified measured volumes and prepared Ultra caps.
The native context checks pixels; it does not measure browser input latency or
predict device FPS. JavaScript camera scheduling is covered separately.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if '--output' not in sys.argv:
    sys.argv += ['--output', str(ROOT / 'docs/renderer-camera-v17')]
base = ROOT / 'tests/renderer-responsiveness-v16-native.py'
setup = base.read_text().split('checks=[]')[0]
# The actual default output ceiling is 1.5M pixels; the former scene budget is
# 160k. Use those grids, not an enlarged final canvas as a sharpness surrogate.
setup = setup.replace('W, H, VW, VH = 490, 590, 180, 217', 'W, H, VW, VH = 1500, 1000, 490, 327')
exec(compile(setup, str(base), 'exec'))

configure_base = configure
def configure(program, out, level, cleanup, world, settings, threshold, cap_shape, pose='orbit', **options):
    configure_base(program,out,level,cleanup,world,settings,threshold,cap_shape,**options)
    normal,right0,up0,center=[np.array(world[k]) for k in ['normal','right','up','center']]
    direction=unit(normal+right0*(.38 if pose=='orbit' else .20)+up0*(.14 if pose=='orbit' else .07))
    forward=-direction;right=unit(np.cross(forward,up0));up=unit(np.cross(right,forward))
    distance=max(world['height']/.55,world['width']/.55*H/W)*.82
    if pose=='pan':center=center+right0*.055-up0*.025
    if pose=='zoom':distance*=.77
    for name,value in dict(eye=center+direction*distance,forward=forward,right=right,up=up).items():u3(program,name,value)

checks=[]
for donor in donors:
    manifest=read_json(public_path(donor['manifestUrl']));level=manifest['levels']['high'];texture(0,load_volume(level),True)
    cleanup=read_json(public_path(donor['cleanupManifestUrl']))
    mask=np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()),np.uint8).reshape(*cleanup['dimensions'][::-1]).copy();texture(2,mask)
    views=read_json(public_path(donor['flowViewsUrl']))['presets']
    view=next(v for v in views if v['id']==('lv-inflow' if donor['id']=='ladaf-2021-17' else 'rv-inflow'))
    source_cap=verified_image(view['texture']);texture(1,source_cap,True)
    common=[level,cleanup,view['world'],donor['displayWindow'],view['threshold'],source_cap.shape]
    for pose in ['orbit','pan','zoom']:
        settled=draw(programs['volume'],tiled,*common,pose=pose,bands=True)
        camera=draw(programs['volume'],full,*common,pose=pose)
        assert np.array_equal(camera,settled),(donor['id'],pose,'camera versus settled grid')
        matte=draw(matte_program,composed,*common,pose=pose,scene=tiled)[:,:,0]>0
        draw(programs['volume'],low,*common,pose=pose,skip=1)
        old_camera=draw(programs['composite'],composed,*common,pose=pose,scene=low)
        # A native cap alone was insufficient: compare measured surface pixels
        # outside that cap, where v16 enlarged the cheap volume image.
        surface=(np.max(camera[:,:,:3],axis=2)>25)&~matte
        assert surface.sum()>1000,(donor['id'],pose,'nontrivial surrounding anatomy')
        delta=np.abs(camera[:,:,:3].astype(np.int16)-old_camera[:,:,:3].astype(np.int16))
        item=dict(donor=donor['id'],pose=pose,outputPixels=W*H,cameraVolumePixels=W*H,
                  previousVolumePixels=VW*VH,cameraEqualsSettled=True,maxCameraSettledChannelDifference=0,
                  surroundingSurfacePixels=int(surface.sum()),previousSurfaceMeanChannelError=float(delta[surface].mean()),
                  previousSurfacePixelsChanged=int(np.any(delta[surface]>0,axis=1).sum()),
                  previousSurfaceMaxChannelError=int(delta[surface].max()),
                  unchangedCapPixels=int(matte.sum()),previousCapEqualsSettled=bool(np.array_equal(camera[matte],old_camera[matte])))
        checks.append(item);print(json.dumps(item),flush=True)
        if pose=='orbit':
            Image.fromarray(old_camera).save(OUT/(donor['id']+'-previous-orbit.png'))
            Image.fromarray(camera).save(OUT/(donor['id']+'-native-orbit.png'))
            # Save a magnified, labeled crop for a direct visual check. The
            # point with most local surface error is chosen algorithmically.
            weighted=np.where(surface,delta.mean(axis=2),0.)
            best=(-1,None)
            for y in range(0,H-256,96):
                for x in range(0,W-320,96):
                    score=weighted[y:y+256,x:x+320].mean()
                    if score>best[0]:best=(score,(x,y,x+320,y+256))
            box=best[1];comparison=Image.new('RGB',(1280,560),(12,18,21));label=ImageDraw.Draw(comparison)
            for n,(name,image) in enumerate([('Previous: enlarged 160k scene',old_camera),('v17: native 1.5M scene',camera)]):
                crop=Image.fromarray(image).convert('RGB').crop(box).resize((640,512),Image.Resampling.NEAREST)
                comparison.paste(crop,(n*640,48));label.text((n*640+16,15),name,fill=(230,234,225))
            comparison.save(OUT/(donor['id']+'-orbit-detail-comparison.png'))

report=dict(passed=True,checks=checks,driver=fn('glGetString',C.c_char_p,[U])(0x1F01).decode(),
            shaderSourcesSha256=hashlib.sha256(json.dumps(sources,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
            scope='Production GLSL in native EGL. Three source-verified donor volumes and prepared Ultra caps. At identical orbit/pan/zoom poses, native camera pixels equal the completed full-detail view exactly. The older full-size cap plus 160k scene is compared separately outside the cap. Not browser latency, device FPS or clinical validation.')
(OUT/'native-render-check.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(passed=True,comparisons=len(checks))),flush=True)
