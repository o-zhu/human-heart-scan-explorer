"""Native EGL comparison for reusable cap storage, including real crop boundaries.

This uses the existing native EGL fixture, not a browser. It compares complete
production renders, including holes and the retained 3D surface, against an
exact-size texture. Uploaded display pixels and spatial frames are unchanged.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
base = ROOT / 'tests/brightness-v12-render.py'
# Reuse only EGL setup and verified source loading; do not run or overwrite the
# historical brightness measurements. --output selects this test's own folder.
if '--output' not in sys.argv:
    sys.argv += ['--output', str(ROOT / 'docs/renderer-latency-v15')]
setup = base.read_text()
exec(compile(setup.split('profiles = ')[0], str(base), 'exec'))
exec(compile(setup[setup.index('def verified_image('):setup.index('unit = lambda')], str(base), 'exec'))

old_sampling = 'vec2 size=vec2(textureSize(capTexture,0));return texture(capTexture,(uv*(size-1.)+.5)/size).r;'
new_sampling = '''vec2 storage=vec2(textureSize(capTexture,0));
 vec2 size=capRasterSize.x>0.?capRasterSize:storage;
 vec2 sourceUv=(uv*(size-1.)+.5)/size;
 vec2 texel=clamp(sourceUv*size,vec2(.5),size-.5);
 return texture(capTexture,texel/storage).r;'''

def baseline(fragment):
    return fragment.replace('uniform vec2 capSize, capRasterSize;', 'uniform vec2 capSize;').replace(new_sampling, old_sampling)

def padded(fragment):
    return baseline(fragment).replace('uniform vec2 capSize;', 'uniform vec2 capSize, capRasterSize;').replace(old_sampling, new_sampling)

variants = {name: {kind: compile_program(transform(sources[kind])) for kind in ['volume', 'composite']}
            for name, transform in [('baseline', baseline), ('padded', padded)]}
for name, transform in [('baseline', baseline), ('padded', padded)]:
    matte = transform(sources['composite']).replace('vec3 color=texture(sceneTexture,screen).rgb;', 'vec3 color=vec3(0.);').replace('color=pow(max(capShade(p,value),vec3(0.)),vec3(.89));', 'color=vec3(1.);')
    variants[name]['matte'] = compile_program(matte)
    density = transform(sources['composite']).replace('vec3 color=texture(sceneTexture,screen).rgb;', 'vec3 color=vec3(0.);').replace('if(value>threshold)color=pow(max(capShade(p,value),vec3(0.)),vec3(.89));', 'color=vec3(value);')
    variants[name]['density'] = compile_program(density)
sub2 = fn('glTexSubImage2D', None, [U, I, I, I, I, I, U, U, P])
W, H, VW, VH = 490, 590, 180, 217

def output(width, height):
    tex, fb = U(), U()
    fn('glGenTextures', None, [I, C.POINTER(U)])(1, C.byref(tex))
    active(0x84C6); bind(0x0DE1, tex)
    t2(0x0DE1, 0, 0x8058, width, height, 0, 0x1908, 0x1401, None)
    for key, value in [(0x2801, 0x2601), (0x2800, 0x2601), (0x2802, 0x812F), (0x2803, 0x812F)]:
        param(0x0DE1, key, value)
    fn('glGenFramebuffers', None, [I, C.POINTER(U)])(1, C.byref(fb))
    fn('glBindFramebuffer', None, [U, U])(0x8D40, fb)
    fn('glFramebufferTexture2D', None, [U, U, U, U, I])(0x8D40, 0x8CE0, 0x0DE1, tex, 0)
    assert fn('glCheckFramebufferStatus', U, [U])(0x8D40) == 0x8CD5
    return dict(texture=tex, framebuffer=fb, width=width, height=height)

full, low = output(W, H), output(VW, VH)
unit = lambda x: np.asarray(x)/np.linalg.norm(x)

def draw(program, out, level, cleanup, world, settings, threshold, cap_shape, side=1, skip=0, scene=None):
    use(program)
    fn('glBindFramebuffer', None, [U, U])(0x8D40, out['framebuffer'])
    fn('glViewport', None, [I, I, I, I])(0, 0, out['width'], out['height'])
    pos = fn('glGetAttribLocation', I, [U, C.c_char_p])(program, b'position')
    fn('glEnableVertexAttribArray', None, [U])(pos)
    fn('glVertexAttribPointer', None, [U, I, U, U, I, P])(pos, 2, 0x1406, 0, 0, None)
    for name, slot in dict(volume=0, capTexture=1, cleanupTexture=2, anatomyTexture=3, accelerationTexture=4, sceneTexture=5).items():
        ui(program, name, slot)
    if scene:
        active(0x84C5); bind(0x0DE1, scene['texture'])
    profile_uniforms(program, settings)
    normal, right0, up0, center = [np.array(world[k]) for k in ['normal', 'right', 'up', 'center']]
    direction = unit(normal*side + right0*.20*side + up0*.07)
    forward = -direction; right = unit(np.cross(forward, up0)); up = unit(np.cross(right, forward))
    nx, ny, nz = level['dimensions']; longest = max(nx-1, ny-1, nz-1)
    distance = max(world['height']/.55, world['width']/.55*H/W)*.82
    for name, value in dict(cleanupReady=1, cleanupEnabled=1, anatomyReady=0, mode=0, palette=4, clipAxis=3, clipFlip=0, showPlanes=0, capReady=1, capCleaned=1, skipCap=skip, surfaceSmoothing=1, accelerationReady=0).items():
        ui(program, name, value)
    for name, value in dict(fov=.32, cameraAspect=W/H, threshold=threshold, opacity=.8, stepSize=.9/max(nx,ny,nz), clipPosition=.5, planeDistance=np.dot(normal,center)).items():
        uf(program, name, value)
    for name, value in dict(dimensions=[nx,ny,nz], textureDimensions=[nx,ny,nz], textureOffset=[0,0,0], cleanupDimensions=cleanup['dimensions'], anatomyDimensions=[1,1,1], extent=[(nx-1)/longest,(nz-1)/longest,(ny-1)/longest], planeNormal=normal, capCenter=center, capRight=right0, capUp=up0, eye=center+direction*distance, forward=forward, right=right, up=up, slicePositions=[.5,.5,.5]).items():
        u3(program, name, value)
    u2(program, 'resolution', [out['width'], out['height']])
    u2(program, 'capSize', [world['width'], world['height']])
    u2(program, 'capRasterSize', [cap_shape[1], cap_shape[0]])
    return pixels(out['width'], out['height'])

def upload(cap, padding):
    if not padding:
        texture(1, cap, True)
        return list(cap.shape[::-1])
    # Bright previous pixels deliberately remain outside the smaller valid
    # rectangle: a crop must never interpolate them into its edge or holes.
    width, height = [((int(n)+255)//256)*256+256 for n in cap.shape[::-1]]
    poison = np.full((height, width), 255, np.uint8)
    texture(1, poison, True)
    sub2(0x0DE1, 0, 0, 0, cap.shape[1], cap.shape[0], 0x1903, 0x1401, cap.ctypes.data)
    return [width, height]

def crop_frame(cap, world):
    # Slice through measured tissue at the new crop border. This deliberately
    # stresses nonzero edges as well as ordinary black surrounding background.
    h, w = cap.shape; x, y = w//5, h//6; width, height = w-x-w//9, h-y-h//10
    shifted = dict(world)
    shifted['center'] = (np.array(world['center']) + np.array(world['right'])*world['width']*((x+(width-1)/2)/(w-1)-.5) + np.array(world['up'])*world['height']*(.5-(y+(height-1)/2)/(h-1))).tolist()
    shifted['width'] = world['width']*(width-1)/(w-1)
    shifted['height'] = world['height']*(height-1)/(h-1)
    return cap[y:y+height, x:x+width].copy(), shifted

checks, evidence = [], []
for donor in donors:
    manifest = read_json(public_path(donor['manifestUrl']))
    level = manifest['levels']['high']; texture(0, load_volume(level), True)
    cleanup = read_json(public_path(donor['cleanupManifestUrl']))
    mask = np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()), np.uint8).reshape(*cleanup['dimensions'][::-1]).copy()
    texture(2, mask)
    views = read_json(public_path(donor['flowViewsUrl']))['presets']
    view = next(v for v in views if v['id'] == ('lv-inflow' if donor['id'] == 'ladaf-2021-17' else 'rv-inflow'))
    source_cap = verified_image(view['texture'])
    evidence.append(dict(donor=donor['id'], volumeManifest=donor['manifestUrl'], capUrl=view['texture']['url'], capSha256=view['texture']['sha256'], capPixels=list(source_cap.shape[::-1]), sourcePixelsModified=False))
    for crop in [False, True]:
        cap, world = crop_frame(source_cap, view['world']) if crop else (source_cap, view['world'])
        for side in ([1, -1] if crop else [1]):
            for moving in [False, True]:
                rendered, mattes, densities = {}, {}, {}
                for name in variants:
                    capacity = upload(cap, name == 'padded')
                    if not moving:
                        mattes[name] = draw(variants[name]['matte'], full, level, cleanup, world, donor['displayWindow'], view['threshold'], cap.shape, side)
                        densities[name] = draw(variants[name]['density'], full, level, cleanup, world, donor['displayWindow'], view['threshold'], cap.shape, side)
                    if moving:
                        draw(variants[name]['volume'], low, level, cleanup, world, donor['displayWindow'], view['threshold'], cap.shape, side, skip=1)
                        rendered[name] = draw(variants[name]['composite'], full, level, cleanup, world, donor['displayWindow'], view['threshold'], cap.shape, side, scene=low)
                    else:
                        rendered[name] = draw(variants[name]['volume'], full, level, cleanup, world, donor['displayWindow'], view['threshold'], cap.shape, side)
                delta = np.abs(rendered['baseline'].astype(np.int16)-rendered['padded'].astype(np.int16))[:,:,:3]
                check = dict(donor=donor['id'], cropped=crop, retainedSide=side<0, twoPass=moving, rasterPixels=list(cap.shape[::-1]), capacityPixels=capacity, maxChannelDifference=int(delta.max()), changedPixels=int(np.any(delta,axis=2).sum()), meanChannelDifference=float(delta.mean()))
                if mattes:
                    check['changedOpaquePixels'] = int(np.any(mattes['baseline']!=mattes['padded'],axis=2).sum())
                    check['maxDensityByteDifference'] = int(np.abs(densities['baseline'].astype(np.int16)-densities['padded'].astype(np.int16)).max())
                    assert check['changedOpaquePixels']<=2 and check['maxDensityByteDifference']<=1,check
                checks.append(check);print(json.dumps(check), flush=True)
                if crop and side==1 and not moving:
                    Image.fromarray(rendered['padded']).save(OUT/(donor['id']+'-crop.png'))
                assert check['changedPixels']<W*H*.001,check

report = dict(passed=True, checks=checks, sourceEvidence=evidence, driver=fn('glGetString', C.c_char_p, [U])(0x1F01).decode(), shaderSha256=hashlib.sha256((ROOT/'public/renderer.js').read_bytes()).hexdigest(),
              tolerances='No crop/frame/source changes. NPOT texture-storage remapping can change hardware bilinear rounding by one display byte. At most two isolated threshold-edge pixels and fewer than 0.1% changed color pixels are permitted per 289,100-pixel comparison; actual counts are recorded without hiding threshold-induced color differences.',
              scope='Complete native EGL images at 490 × 590, with 180 × 217 moving volume. Three source-verified donor volumes/caps, fine holes and nonzero cropped edges, bright stale padding, single-pass and full-resolution cap composite, retained-side occlusion. Not browser FPS or clinical validation.')
(OUT/'cap-storage-validation.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(dict(passed=True, comparisons=len(checks), maximumChannelDifference=max(c['maxChannelDifference'] for c in checks))), flush=True)
