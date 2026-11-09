"""Native EGL checks for interruptible full-detail bands and resident cut-face shading.

No browser automation. Production GLSL, verified donor volumes and original
prepared caps are used. Timing here is not a browser or user-device FPS claim.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
base = ROOT / 'tests/brightness-v12-render.py'
if '--output' not in sys.argv:
    sys.argv += ['--output', str(ROOT / 'docs/renderer-responsiveness-v16')]
setup = base.read_text()
exec(compile(setup.split('profiles = ')[0], str(base), 'exec'))
exec(compile(setup[setup.index('def verified_image('):setup.index('unit = lambda')], str(base), 'exec'))

matte_source = sources['composite'].replace('vec3 color=texture(sceneTexture,screen).rgb;', 'vec3 color=vec3(0.);').replace('color=pow(max(capShade(p,value),vec3(0.)),vec3(.89));', 'color=vec3(1.);')
matte_program = compile_program(matte_source)
W, H, VW, VH = 490, 590, 180, 217
bind_fbo = fn('glBindFramebuffer', None, [U, U])
viewport = fn('glViewport', None, [I, I, I, I])
draw_arrays = fn('glDrawArrays', None, [U, I, I])
enable = fn('glEnable', None, [U])
disable = fn('glDisable', None, [U])
scissor = fn('glScissor', None, [I, I, I, I])

def output(width, height, nearest=False):
    tex, fb = U(), U()
    fn('glGenTextures', None, [I, C.POINTER(U)])(1, C.byref(tex))
    active(0x84C6); bind(0x0DE1, tex)
    t2(0x0DE1, 0, 0x8058, width, height, 0, 0x1908, 0x1401, None)
    for key, value in [(0x2801, 0x2600 if nearest else 0x2601), (0x2800, 0x2600 if nearest else 0x2601), (0x2802, 0x812F), (0x2803, 0x812F)]:
        param(0x0DE1, key, value)
    fn('glGenFramebuffers', None, [I, C.POINTER(U)])(1, C.byref(fb))
    bind_fbo(0x8D40, fb)
    fn('glFramebufferTexture2D', None, [U, U, U, U, I])(0x8D40, 0x8CE0, 0x0DE1, tex, 0)
    assert fn('glCheckFramebufferStatus', U, [U])(0x8D40) == 0x8CD5
    return dict(texture=tex, framebuffer=fb, width=width, height=height)

full, tiled, composed, low = output(W,H), output(W,H,True), output(W,H), output(VW,VH)
unit = lambda x: np.asarray(x)/np.linalg.norm(x)

def read_target(out):
    fn('glFinish', None, [])()
    image = np.empty((out['height'],out['width'],4),np.uint8)
    fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,out['width'],out['height'],0x1908,0x1401,image.ctypes.data)
    assert fn('glGetError',U,[])()==0
    return image[::-1].copy()

def configure(program, out, level, cleanup, world, settings, threshold, cap_shape, ready=1, side=1, mode=0, clipped=True, skip=0, scene=None):
    use(program);bind_fbo(0x8D40,out['framebuffer']);viewport(0,0,out['width'],out['height'])
    position=fn('glGetAttribLocation',I,[U,C.c_char_p])(program,b'position')
    fn('glEnableVertexAttribArray',None,[U])(position)
    fn('glVertexAttribPointer',None,[U,I,U,U,I,P])(position,2,0x1406,0,0,None)
    for name,slot in dict(volume=0,capTexture=1,cleanupTexture=2,anatomyTexture=3,accelerationTexture=4,sceneTexture=5).items():ui(program,name,slot)
    if scene:active(0x84C5);bind(0x0DE1,scene['texture'])
    profile_uniforms(program,settings)
    normal,right0,up0,center=[np.array(world[k]) for k in ['normal','right','up','center']]
    direction=unit(normal*side+right0*.20*side+up0*.07)
    forward=-direction;right=unit(np.cross(forward,up0));up=unit(np.cross(right,forward))
    nx,ny,nz=level['dimensions'];longest=max(nx-1,ny-1,nz-1)
    distance=max(world['height']/.55,world['width']/.55*H/W)*.82
    for name,value in dict(cleanupReady=1,cleanupEnabled=1,anatomyReady=0,mode=mode,palette=4,clipAxis=3 if clipped else -1,clipFlip=0,showPlanes=0,capReady=ready,capCleaned=1,skipCap=skip,surfaceSmoothing=1,accelerationReady=0).items():ui(program,name,value)
    for name,value in dict(fov=.32,cameraAspect=W/H,threshold=threshold,opacity=.8,stepSize=.9/max(nx,ny,nz),clipPosition=.5,planeDistance=np.dot(normal,center)).items():uf(program,name,value)
    for name,value in dict(dimensions=[nx,ny,nz],textureDimensions=[nx,ny,nz],textureOffset=[0,0,0],cleanupDimensions=cleanup['dimensions'],anatomyDimensions=[1,1,1],extent=[(nx-1)/longest,(nz-1)/longest,(ny-1)/longest],planeNormal=normal,capCenter=center,capRight=right0,capUp=up0,eye=center+direction*distance,forward=forward,right=right,up=up,slicePositions=[.5,.5,.5]).items():u3(program,name,value)
    u2(program,'resolution',[out['width'],out['height']]);u2(program,'capSize',[world['width'],world['height']]);u2(program,'capRasterSize',[cap_shape[1],cap_shape[0]])

def draw(program,out,*args,bands=False,**options):
    configure(program,out,*args,**options)
    if bands:
        # Prime the target with stale bright pixels. Every row must be replaced
        # by the full-resolution shader before the result may be presented.
        fn('glClearColor',None,[F,F,F,F])(1,0,1,1);fn('glClear',None,[U])(0x4000)
        enable(0x0C11)
        for row in range(0,out['height'],31):
            scissor(0,row,out['width'],min(31,out['height']-row));draw_arrays(4,0,3)
        disable(0x0C11)
    else:draw_arrays(4,0,3)
    return read_target(out)

checks=[]
for donor in donors:
    manifest=read_json(public_path(donor['manifestUrl']));level=manifest['levels']['high'];texture(0,load_volume(level),True)
    cleanup=read_json(public_path(donor['cleanupManifestUrl']))
    mask=np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()),np.uint8).reshape(*cleanup['dimensions'][::-1]).copy();texture(2,mask)
    views=read_json(public_path(donor['flowViewsUrl']))['presets']
    view=next(v for v in views if v['id']==('lv-inflow' if donor['id']=='ladaf-2021-17' else 'rv-inflow'))
    source_cap=verified_image(view['texture']);texture(1,source_cap,True)
    common=[level,cleanup,view['world'],donor['displayWindow'],view['threshold'],source_cap.shape]
    for ready in [0,1]:
        for side in [1,-1]:
            opts=dict(ready=ready,side=side)
            reference=draw(programs['volume'],full,*common,**opts)
            banded=draw(programs['volume'],tiled,*common,bands=True,**opts)
            final=draw(programs['composite'],composed,*common,scene=tiled,**opts)
            assert np.array_equal(reference,banded),(donor['id'],ready,side,'tile coordinates')
            assert np.array_equal(reference,final),(donor['id'],ready,side,'final presentation')
            matte=draw(matte_program,composed,*common,scene=tiled,**opts)[:,:,0]>0
            draw(programs['volume'],low,*common,skip=1,**opts)
            moving=draw(programs['composite'],composed,*common,scene=low,**opts)
            assert np.array_equal(reference[matte],moving[matte]),(donor['id'],ready,side,'cut-face transfer')
            if side<0:assert not matte.any(),(donor['id'],'retained-side overlay')
            else:assert matte.sum()>1000,(donor['id'],'nontrivial face')
            item=dict(donor=donor['id'],source='prepared-ultra' if ready else 'resident-volume',retainedSide=side<0,
                      tiledEqualsSinglePass=True,finalCompositeEqualsSinglePass=True,capPixels=int(matte.sum()),
                      movingFaceEqualsSinglePass=True,outputPixels=W*H,maxBandPixels=W*31)
            checks.append(item);print(json.dumps(item),flush=True)
            if ready==0 and side==1:Image.fromarray(moving).save(OUT/(donor['id']+'-resident-preview.png'))
    if donor['id']=='ladaf-2021-17':
        # Jittered translucent and MIP modes also use unchanged full pixel
        # coordinates in every band. Small outputs keep this check bounded.
        for mode in [0,1,2]:
            for clipped in [False,True]:
                a,b=output(180,217),output(180,217,True)
                options=dict(ready=0,mode=mode,clipped=clipped)
                reference=draw(programs['volume'],a,*common,**options)
                result=draw(programs['volume'],b,*common,bands=True,**options)
                assert np.array_equal(reference,result),(mode,clipped)
                item=dict(donor=donor['id'],mode=mode,clipped=clipped,tiledEqualsSinglePass=True,outputPixels=180*217,maxBandPixels=180*31)
                checks.append(item);print(json.dumps(item),flush=True)

report=dict(passed=True,checks=checks,driver=fn('glGetString',C.c_char_p,[U])(0x1F01).decode(),
            shaderSourcesSha256=hashlib.sha256(json.dumps(sources,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
            scope='Production GLSL in native EGL. Three hash-verified measured donor volumes/caps; resident/prepared faces, retained-side occlusion, singlepass versus banded fullresolution output, complete final composition, all modes and clipped/wholeorgan coordinates. Not browser FPS or a clinical validation.')
(OUT/'native-render-check.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(passed=True,comparisons=len(checks))),flush=True)
