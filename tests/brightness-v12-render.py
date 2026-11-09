"""Render production GLSL and measured donor caps with display-only exposure.

Native offscreen EGL (no browser automation). Source images and volumes are
verified against published hashes and never changed. Rendering is not clinical
validation or a browser/device performance measurement.
"""
from pathlib import Path
import argparse
import ctypes as C
import gzip
import hashlib
import json
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path)
parser.add_argument('--current-donor-defaults', action='store_true', help='Compare the prior 1.15/1.80 donor brightness against current profiles; preserve the historical v12 comparison otherwise.')
args = parser.parse_args()
OUT = args.output or ROOT / ('docs/brightness-v14' if args.current_donor_defaults else 'docs/brightness-v12')
OUT.mkdir(parents=True, exist_ok=True)
read_json = lambda path: json.loads(path.read_text())
public_path = lambda url: ROOT / 'public' / url.removeprefix('./').split('?')[0]
node = lambda script: json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=ROOT, text=True))
donors = node('import {DONORS} from "./public/donors.js";console.log(JSON.stringify(DONORS));')
gains = {'ladaf-2021-17': 1.15, 's-20-29': 1.8, 's-20-28': 1.8}
donors = [d for d in donors if d['id'] in gains]
baseline_gains = dict(gains) if args.current_donor_defaults else {d['id']: 1 for d in donors}
if args.current_donor_defaults:
    gains = {d['id']: d['displayWindow']['cutFaceExposure'] for d in donors}
sources = node('import {volumeShaderSources} from "./public/renderer.js";console.log(JSON.stringify(volumeShaderSources));')

E = C.CDLL('libEGL.so.1')
P, I, U, F = C.c_void_p, C.c_int, C.c_uint, C.c_float
E.eglGetProcAddress.argtypes = [C.c_char_p]
E.eglGetProcAddress.restype = P
get_display = C.CFUNCTYPE(P, U, P, C.POINTER(I))(E.eglGetProcAddress(b'eglGetPlatformDisplayEXT'))
display = get_display(0x31DD, None, None)
E.eglInitialize.argtypes = [P, C.POINTER(I), C.POINTER(I)]
E.eglInitialize.restype = U
major, minor = I(), I()
assert E.eglInitialize(display, C.byref(major), C.byref(minor))
E.eglBindAPI.argtypes = [U]
E.eglBindAPI.restype = U
assert E.eglBindAPI(0x30A0)
attrs = (I*9)(0x3033, 1, 0x3040, 0x40, 0x3024, 8, 0x3023, 8, 0x3038)
E.eglChooseConfig.argtypes = [P, C.POINTER(I), C.POINTER(P), I, C.POINTER(I)]
E.eglChooseConfig.restype = U
config, n = P(), I()
assert E.eglChooseConfig(display, attrs, C.byref(config), 1, C.byref(n)) and n.value
E.eglCreateContext.argtypes = [P, P, P, C.POINTER(I)]
E.eglCreateContext.restype = P
context = E.eglCreateContext(display, config, None, (I*3)(0x3098, 3, 0x3038))
E.eglMakeCurrent.argtypes = [P, P, P, P]
E.eglMakeCurrent.restype = U
assert context and E.eglMakeCurrent(display, None, None, context)


def fn(name, restype, args):
    return C.CFUNCTYPE(restype, *args)(E.eglGetProcAddress(name.encode()))


def compile_program(fragment):
    shaders = []
    for kind, text in [(0x8B31, sources['vertex']), (0x8B30, fragment)]:
        shader = fn('glCreateShader', U, [U])(kind)
        src = C.c_char_p(text.encode())
        fn('glShaderSource', None, [U, I, C.POINTER(C.c_char_p), P])(shader, 1, C.byref(src), None)
        fn('glCompileShader', None, [U])(shader)
        ok, log = I(), C.create_string_buffer(32768)
        fn('glGetShaderiv', None, [U, U, C.POINTER(I)])(shader, 0x8B81, C.byref(ok))
        fn('glGetShaderInfoLog', None, [U, I, P, C.c_char_p])(shader, 32768, None, log)
        assert ok.value, log.value.decode()
        shaders.append(shader)
    program = fn('glCreateProgram', U, [])()
    for shader in shaders:
        fn('glAttachShader', None, [U, U])(program, shader)
    fn('glLinkProgram', None, [U])(program)
    ok = I()
    fn('glGetProgramiv', None, [U, U, C.POINTER(I)])(program, 0x8B82, C.byref(ok))
    assert ok.value
    return program


programs = {name: compile_program(sources[name]) for name in ['volume', 'composite']}
programs['ramp'] = compile_program(sources['volume'].split('void main(){')[0] + '''
void main(){float value=floor(gl_FragCoord.x)/255.;
fragColor=vec4(pow(max(capShade(vec3(0.),value),vec3(0.)),vec3(.89)),1.);}
''')
use = fn('glUseProgram', None, [U])
loc = fn('glGetUniformLocation', I, [U, C.c_char_p])
ui = lambda p, n, v: fn('glUniform1i', None, [I, I])(loc(p, n.encode()), int(v))
uf = lambda p, n, v: fn('glUniform1f', None, [I, F])(loc(p, n.encode()), float(v))
u2 = lambda p, n, v: fn('glUniform2f', None, [I, F, F])(loc(p, n.encode()), *v)
u3 = lambda p, n, v: fn('glUniform3f', None, [I, F, F, F])(loc(p, n.encode()), *v)
active = fn('glActiveTexture', None, [U])
bind = fn('glBindTexture', None, [U, U])
param = fn('glTexParameteri', None, [U, U, I])
t2 = fn('glTexImage2D', None, [U, I, I, I, I, I, U, U, P])
t3 = fn('glTexImage3D', None, [U, I, I, I, I, I, I, U, U, P])
fn('glPixelStorei', None, [U, I])(0x0CF5, 1)
textures = []
for slot in range(6):
    tex = U()
    fn('glGenTextures', None, [I, C.POINTER(U)])(1, C.byref(tex))
    textures.append(tex)


def texture(slot, data=None, linear=False, size=None):
    three = slot in [0, 2, 3, 4]
    target = 0x806F if three else 0x0DE1
    active(0x84C0+slot)
    bind(target, textures[slot])
    if three:
        t3(target, 0, 0x8229, *data.shape[::-1], 0, 0x1903, 0x1401, data.ctypes.data)
    elif data is None:
        t2(target, 0, 0x8058, *size, 0, 0x1908, 0x1401, None)
    else:
        t2(target, 0, 0x8229, *data.shape[::-1], 0, 0x1903, 0x1401, data.ctypes.data)
    for key, value in [(0x2801, 0x2601 if linear else 0x2600), (0x2800, 0x2601 if linear else 0x2600), (0x2802, 0x812F), (0x2803, 0x812F)]:
        param(target, key, value)
    if three:
        param(target, 0x8072, 0x812F)


for slot in [0, 2, 3, 4]:
    texture(slot, np.zeros((1, 1, 1), np.uint8))
texture(1, np.zeros((2, 2), np.uint8))
texture(5, size=(256, 1))
fbo = U()
fn('glGenFramebuffers', None, [I, C.POINTER(U)])(1, C.byref(fbo))
fn('glBindFramebuffer', None, [U, U])(0x8D40, fbo)
fn('glFramebufferTexture2D', None, [U, U, U, U, I])(0x8D40, 0x8CE0, 0x0DE1, textures[5], 0)
buf = U()
fn('glGenBuffers', None, [I, C.POINTER(U)])(1, C.byref(buf))
fn('glBindBuffer', None, [U, U])(0x8892, buf)
verts = np.array([-1, -1, 3, -1, -1, 3], np.float32)
fn('glBufferData', None, [U, C.c_ssize_t, P, U])(0x8892, verts.nbytes, verts.ctypes.data, 0x88E4)


def target(program, width, height):
    use(program)
    texture(5, size=(width, height))
    assert fn('glCheckFramebufferStatus', U, [U])(0x8D40) == 0x8CD5
    position = fn('glGetAttribLocation', I, [U, C.c_char_p])(program, b'position')
    fn('glEnableVertexAttribArray', None, [U])(position)
    fn('glVertexAttribPointer', None, [U, I, U, U, I, P])(position, 2, 0x1406, 0, 0, None)
    fn('glViewport', None, [I, I, I, I])(0, 0, width, height)
    # All sampler types use distinct units, including uniforms inactive in a fixture.
    for name, slot in dict(volume=0, capTexture=1, cleanupTexture=2, anatomyTexture=3, accelerationTexture=4, sceneTexture=5).items():
        ui(program, name, slot)


def profile_uniforms(program, settings):
    ui(program, 'windowEnabled', settings.get('windowEnabled', False))
    for name in ['windowLow', 'windowHigh', 'windowGamma', 'capContrast', 'cutFaceExposure']:
        uf(program, name, settings[name])


def pixels(width, height):
    fn('glDrawArrays', None, [U, I, I])(4, 0, 3)
    fn('glFinish', None, [])()
    output = np.empty((height, width, 4), np.uint8)
    fn('glReadPixels', None, [I, I, I, I, U, U, P])(0, 0, width, height, 0x1908, 0x1401, output.ctypes.data)
    assert fn('glGetError', U, [])() == 0
    return output[::-1].copy()


profiles = [dict(d['displayWindow'], cutFaceExposure=gain) for d in donors for gain in [baseline_gains[d['id']], gains[d['id']]]]
expected = node('import {capColor} from "./public/render-styles.js";const ps='+json.dumps(profiles)+';'
                'console.log(JSON.stringify(ps.map(s=>Array.from({length:6},(_,p)=>Array.from({length:256},(_,b)=>capColor(b/255,s.capContrast,p,s).map(c=>Math.round(Math.pow(Math.max(0,c),.89)*255)))))));')
checks, gpu_luts = [], []
for i, settings in enumerate(profiles):
    all_palettes = []
    for palette in range(6):
        p = programs['ramp']
        target(p, 256, 1)
        profile_uniforms(p, settings)
        ui(p, 'palette', palette)
        ui(p, 'anatomyReady', 0)
        u3(p, 'planeNormal', [0, 0, 1])
        u3(p, 'eye', [0, 0, 2])
        image = pixels(256, 1)[0, :, :3]
        delta = np.abs(image.astype(np.int16)-np.array(expected[i][palette], np.int16))
        assert delta.max() <= 1, (i, palette, delta.max())
        checks.append(dict(profile=i, palette=palette, maxChannelDifference=int(delta.max()), meanChannelDifference=float(delta.mean())))
        all_palettes.append(image)
    gpu_luts.append(all_palettes)

# The same native cap shader must preserve label hue and avoid bright RGB clipping.
colors = node('import {buildAnatomyPalette} from "./public/render-styles.js";console.log(JSON.stringify(buildAnatomyPalette()));')
expected_anatomy = node('import {capColor,capAnatomyColor,buildAnatomyPalette} from "./public/render-styles.js";const ps='+json.dumps(profiles)+';'
    'console.log(JSON.stringify(ps.map(s=>Array.from({length:6},(_,j)=>[0,2].map(selected=>Array.from({length:256},(_,b)=>capAnatomyColor(capColor(b/255,s.capContrast,5,s),j+1,buildAnatomyPalette(),.65,selected).map(c=>Math.round(Math.pow(Math.max(0,c),.89)*255))))))));')
for i, settings in enumerate(profiles):
    for label in range(1,7):
        texture(3,np.full((1,1,1),label,np.uint8))
        for selection_index, selected in enumerate([0,2]):
            p=programs['ramp']
            target(p,256,1)
            profile_uniforms(p,settings)
            ui(p,'palette',5)
            ui(p,'anatomyReady',1)
            ui(p,'anatomySelected',selected)
            uf(p,'anatomyOpacity',.65)
            u3(p,'anatomyDimensions',[1,1,1])
            u3(p,'extent',[1,1,1])
            palette_array=np.asarray(colors,np.float32)
            fn('glUniform3fv',None,[I,I,P])(loc(p,b'anatomyColors[0]'),16,palette_array.ctypes.data)
            image=pixels(256,1)[0,:,:3]
            delta=np.abs(image.astype(np.int16)-np.array(expected_anatomy[i][label-1][selection_index],np.int16))
            assert delta.max()<=1,(i,label,selected,delta.max())
            assert image.max()<255,'Colored caps must stay below hard channel clipping.'
            checks.append(dict(profile=i,palette=5,label=label,selected=selected,maxChannelDifference=int(delta.max()),meanChannelDifference=float(delta.mean())))


def verified_image(item):
    path = public_path(item['url'])
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']
    array = np.asarray(Image.open(path).convert('L')).copy()
    expected_hash = item.get('decodedSha256', item.get('pixelSha256'))
    if expected_hash:
        assert hashlib.sha256(array.tobytes()).hexdigest() == expected_hash
    return array


def load_volume(level):
    nx, ny, nz = level['dimensions']
    volume = np.empty((nz, ny, nx), np.uint8)
    for part in level['parts']:
        encoded = public_path(part['url']).read_bytes()
        assert hashlib.sha256(encoded).hexdigest() == part['sha256']
        start, end = part['zRange']
        array = np.frombuffer(gzip.decompress(encoded), np.uint8).reshape(end-start, ny, nx).copy()
        axis = {'delta-z': 0, 'delta-x': 2}.get(part.get('predictor'))
        if axis is not None:
            np.cumsum(array, axis=axis, dtype=np.uint8, out=array)
        assert hashlib.sha256(array.tobytes()).hexdigest() == part['rawSha256']
        volume[start:end] = array
    return volume


unit = lambda x: np.asarray(x)/np.linalg.norm(x)
W, H = 490, 590
sheet = Image.new('RGB', (2*W, 3*(H+58)), '#0b1115')
source_sheet = Image.new('RGB', (2*W, 3*(H+58)), '#0b1115')
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
stats = []
for index, donor in enumerate(donors):
    manifest = read_json(public_path(donor['manifestUrl']))
    views = read_json(public_path(donor['flowViewsUrl']))['presets']
    key = 'lv-inflow' if donor['id'] == 'ladaf-2021-17' else 'rv-inflow'
    view = next(v for v in views if v['id'] == key)
    cap = verified_image(view['texture'])
    threshold = view['threshold']
    # Use all eight fine presets for current-default calibration; retain the
    # original pair for reproducible historical v12 evidence.
    hist = np.zeros(256, np.int64)
    evidence = []
    measured_views = views if args.current_donor_defaults else [view, next(v for v in views if v['id'] == 'rv-outflow')]
    for v in measured_views:
        a = verified_image(v['texture'])
        hist += np.bincount(a[a/255 >= v['threshold']], minlength=256)
        evidence.append(dict(url=v['texture']['url'], sha256=v['texture']['sha256'], sourceSpacingUm=v['texture'].get('sourceSpacingUm', v['texture']['spacingUm'])))
    metrics = []
    for column, gain in enumerate([baseline_gains[donor['id']], gains[donor['id']]]):
        lut = gpu_luts[index*2+column][4]
        luminance = lut @ np.array([.2126, .7152, .0722])
        cdf = np.cumsum(hist)/hist.sum()
        quantiles = [float(luminance[np.searchsorted(cdf, q)]) for q in [.1, .5, .9]]
        metrics.append(dict(exposure=gain, tissuePixels=int(hist.sum()), meanLuminance255=float(np.dot(hist,luminance)/hist.sum()), p10MedianP90Luminance255=quantiles, whitePixels=int(hist[np.all(lut == 255, axis=1)].sum())))
        source_rgb = lut[cap]
        source_rgb[cap/255 < threshold] = 0
        source_image = Image.fromarray(source_rgb)
        source_image.thumbnail((W, H), Image.Resampling.LANCZOS)
        source_sheet.paste(source_image, (column*W+(W-source_image.width)//2, index*(H+58)+58+(H-source_image.height)//2))
    stats.append(dict(donor=donor['id'], transfer='Tissue & space', sourceEvidence=evidence, measurements=metrics))

    level = manifest['levels']['high']
    volume = load_volume(level)
    texture(0, volume, True)
    cleanup = read_json(public_path(donor['cleanupManifestUrl']))
    mask = np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()),np.uint8).reshape(*cleanup['dimensions'][::-1]).copy()
    texture(2, mask)
    texture(1, cap, True)
    world = view['world']
    normal, right0, up0, center = [np.array(world[k]) for k in ['normal', 'right', 'up', 'center']]
    direction = unit(normal+right0*.20+up0*.07)
    forward = -direction
    right = unit(np.cross(forward, up0))
    up = unit(np.cross(right, forward))
    nx, ny, nz = level['dimensions']
    longest = max(nx-1, ny-1, nz-1)
    distance = max(world['height']/.55, world['width']/.55*H/W)*.82
    for column, gain in enumerate([baseline_gains[donor['id']], gains[donor['id']]]):
        p = programs['volume']
        target(p, W, H)
        profile_uniforms(p, dict(donor['displayWindow'], cutFaceExposure=gain))
        for name, value in dict(cleanupReady=1, cleanupEnabled=1, anatomyReady=0, mode=0, palette=4, clipAxis=3, clipFlip=0, showPlanes=0, capReady=1, capCleaned=1, skipCap=0, surfaceSmoothing=1, accelerationReady=0).items():
            ui(p, name, value)
        for name, value in dict(fov=.32, cameraAspect=W/H, threshold=threshold, opacity=.8, stepSize=.9/max(nx,ny,nz), clipPosition=.5, planeDistance=np.dot(normal,center)).items():
            uf(p, name, value)
        for name, value in dict(dimensions=[nx,ny,nz], textureDimensions=[nx,ny,nz], textureOffset=[0,0,0], cleanupDimensions=cleanup['dimensions'], anatomyDimensions=[1,1,1], extent=[(nx-1)/longest,(nz-1)/longest,(ny-1)/longest], planeNormal=normal, capCenter=center, capRight=right0, capUp=up0, eye=center+direction*distance, forward=forward, right=right, up=up, slicePositions=[.5,.5,.5]).items():
            u3(p, name, value)
        u2(p, 'resolution', [W,H])
        u2(p, 'capSize', [world['width'],world['height']])
        rgb = pixels(W,H)[:,:,:3]
        sheet.paste(Image.fromarray(rgb),(column*W,index*(H+58)+58))
        for page in [sheet,source_sheet]:
            draw = ImageDraw.Draw(page)
            label = f'{"Before" if column == 0 else "After"} · brightness {gain:.2f}'
            draw.text((column*W+14,index*(H+58)+9),donor['specimen']+' — '+label,font=font,fill='#eee8df')
            draw.text((column*W+14,index*(H+58)+32),f'Measured {donor["fineSpacingUm"]:g} µm plane · same bytes / threshold',font=small,fill='#9ab0b2')
    print(donor['id'],json.dumps(metrics),flush=True)

sheet.save(OUT/'production-caps-before-after.png')
source_sheet.save(OUT/'measured-sections-before-after.png')
report=dict(passed=True,driver=fn('glGetString',C.c_char_p,[U])(0x1F01).decode(),compiledPrograms=list(programs),
            comparedIntensities=len(checks)*256,transferChecks=checks,donorMeasurements=stats,
            productionShaderSha256=hashlib.sha256((ROOT/'public/renderer.js').read_bytes()).hexdigest(),
            scope='Native production GLSL, 3 donor profiles, 6 palettes, 2 exposure settings; all six anatomy colors, global and selected-label modes. Source-verified measured CT and high-detail volumes. No browser QA, clinical validation or device-speed claim.')
(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(passed=True,maxChannelDifference=max(c['maxChannelDifference'] for c in checks),comparedIntensities=report['comparedIntensities'],output=str(OUT))),flush=True)
