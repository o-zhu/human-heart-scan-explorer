"""Verify actual GLSL windowing against JS, and inspect measured donor caps in EGL.

No browser automation. This checks tone transfer and source geometry, not clinical
segmentation, browser layout or user-device speed.
"""
from pathlib import Path
import ctypes as C
import hashlib
import json
import subprocess
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/windowing-v10'
OUT.mkdir(parents=True, exist_ok=True)
# Existing fixture checks source hashes, decodes the hosted volume, compiles the
# production shader and uploads this donor's conservative support mask.
fixture = ROOT / 'scripts/render-donor-v8.py'
scope = {'__file__': str(fixture), '__name__': 'windowing_v10_egl'}
exec(compile(fixture.read_text().split('W,H=520,600')[0], str(fixture), 'exec'), scope)
fn, U, I, F, P = (scope[k] for k in ['fn', 'U', 'I', 'F', 'P'])
active, bind, t2, param, gen = (scope[k] for k in ['active', 'bind', 't2', 'param', 'gen'])
ui, uf, u2, u3 = (scope[k] for k in ['ui', 'uf', 'u2', 'u3'])
glscope = scope['scope']
sources = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
    'import {volumeShaderSources} from "./public/renderer.js"; console.log(JSON.stringify(volumeShaderSources));'], cwd=ROOT, text=True))


def compile_program(fragment):
    shaders = []
    for kind, source in [(0x8B31, sources['vertex']), (0x8B30, fragment)]:
        shader = glscope['create'](kind)
        encoded = C.c_char_p(source.encode())
        glscope['source'](shader, 1, C.byref(encoded), None)
        glscope['compile_shader'](shader)
        ok = I()
        glscope['getiv'](shader, 0x8B81, C.byref(ok))
        log = C.create_string_buffer(32768)
        glscope['getlog'](shader, 32768, None, log)
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


composite = compile_program(sources['composite'])
lut_program = compile_program(sources['volume'].split('void main(){')[0] + '''
void main(){
 float value=floor(gl_FragCoord.x)/255.;
 fragColor=vec4(pow(max(capShade(vec3(0.),value),vec3(0.)),vec3(.89)),1.);
}''')
profile = dict(windowEnabled=True, windowLow=(36500-35893)/2641, windowHigh=1, windowGamma=1.1, capContrast=1)
profiles = [dict(profile, windowEnabled=False, capContrast=1.8), profile,
            dict(profile, windowLow=.4, windowHigh=.95, windowGamma=1.5, capContrast=.85)]
expected = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
    'import {capColor} from "./public/render-styles.js"; const profiles=' + json.dumps(profiles) + ';'
    'console.log(JSON.stringify(profiles.map(s=>Array.from({length:6},(_,p)=>Array.from({length:256},(_,i)=>capColor(i/255,s.capContrast,p,s).map(c=>Math.round(Math.pow(Math.max(0,c),.89)*255)))))));'], cwd=ROOT, text=True))


def target(program, width, height):
    glscope['use'](program)
    active(0x84C5)
    bind(0x0DE1, scope['target'])
    t2(0x0DE1, 0, 0x8058, width, height, 0, 0x1908, 0x1401, None)
    assert fn('glCheckFramebufferStatus', U, [U])(0x8D40) == 0x8CD5
    position = fn('glGetAttribLocation', I, [U, C.c_char_p])(program, b'position')
    fn('glEnableVertexAttribArray', None, [U])(position)
    fn('glVertexAttribPointer', None, [U, I, U, U, I, P])(position, 2, 0x1406, 0, 0, None)
    fn('glViewport', None, [I, I, I, I])(0, 0, width, height)


def set_window(program, settings):
    ui(program, 'windowEnabled', int(settings['windowEnabled']))
    for name in ['windowLow', 'windowHigh', 'windowGamma', 'capContrast']:
        uf(program, name, settings[name])


def pixels(width, height):
    fn('glDrawArrays', None, [U, I, I])(4, 0, 3)
    fn('glFinish', None, [])()
    result = np.empty((height, width, 4), np.uint8)
    fn('glReadPixels', None, [I, I, I, I, U, U, P])(0, 0, width, height, 0x1908, 0x1401, result.ctypes.data)
    assert fn('glGetError', U, [])() == 0
    return result[::-1].copy()


checks = []
for row, settings in enumerate(profiles):
    for palette in range(6):
        target(lut_program, 256, 1)
        ui(lut_program, 'palette', palette)
        ui(lut_program, 'anatomyReady', 0)
        u3(lut_program, 'eye', [0, 0, 2])
        u3(lut_program, 'planeNormal', [0, 0, 1])
        set_window(lut_program, settings)
        image = pixels(256, 1)[0, :, :3]
        difference = np.abs(image.astype(np.int16)-np.array(expected[row][palette], np.int16))
        assert difference.max() <= 1, (row, palette, difference.max())
        checks.append(dict(profile=row, palette=palette, maxChannelDifference=int(difference.max()), meanChannelDifference=float(difference.mean())))

W, H = 520, 600
unit = lambda a: np.asarray(a)/np.linalg.norm(a)


def render(key, enabled):
    world = scope['frames'][key]['world']
    normal, source_right, source_up, center = [np.array(world[k]) for k in ['normal', 'right', 'up', 'center']]
    direction = unit(normal + source_right*.28 + source_up*.08)
    forward = -direction
    right = unit(np.cross(forward, source_up))
    up = unit(np.cross(right, forward))
    cap = np.asarray(Image.open(ROOT/'public'/scope['textures'][key]['url']).convert('L')).copy()
    active(0x84C1)
    bind(0x0DE1, scope['texcap'])
    t2(0x0DE1, 0, 0x8229, cap.shape[1], cap.shape[0], 0, 0x1903, 0x1401, cap.ctypes.data)
    program = glscope['programs']['after']
    target(program, W, H)
    for name, value in dict(volume=0, capTexture=1, cleanupTexture=2, cleanupReady=1, cleanupEnabled=1, anatomyReady=0,
            anatomyTexture=3, mode=0, palette=4, clipAxis=3, clipFlip=0, showPlanes=0, capReady=1, capCleaned=1,
            skipCap=0, surfaceSmoothing=1, accelerationTexture=4, accelerationReady=0).items():
        ui(program, name, value)
    dims = scope['dims']
    for name, value in dict(fov=.32, cameraAspect=W/H, threshold=scope['manifest']['defaultThreshold'], opacity=.8,
            stepSize=.9/max(dims), clipPosition=.5, planeDistance=np.dot(normal, center)).items():
        uf(program, name, value)
    set_window(program, profiles[1 if enabled else 0])
    nx, ny, nz = dims
    longest = max(n-1 for n in dims)
    for name, value in dict(dimensions=dims, textureDimensions=dims, textureOffset=[0, 0, 0],
            cleanupDimensions=scope['cleanup_meta']['dimensions'], anatomyDimensions=[1, 1, 1],
            extent=[(nx-1)/longest, (nz-1)/longest, (ny-1)/longest], planeNormal=normal, capCenter=center,
            capRight=source_right, capUp=source_up, eye=center+direction*1.55, forward=forward, right=right, up=up,
            slicePositions=[.5, .5, .5]).items():
        u3(program, name, value)
    u2(program, 'resolution', [W, H])
    u2(program, 'capSize', [world['width'], world['height']])
    image = pixels(W, H)
    return Image.fromarray(image).convert('RGB')


sheet = Image.new('RGB', (W*2, (H+55)*2), '#0c1317')
draw = ImageDraw.Draw(sheet)
for row, key in enumerate(['a4c', 'plax']):
    for column, enabled in enumerate([False, True]):
        image = render(key, enabled)
        sheet.paste(image, (W*column, (H+55)*row+55))
        draw.text((W*column+14, (H+55)*row+11), 'Current bright transfer' if not enabled else 'Source-specific display window', fill='#eee8dd')
        draw.text((W*column+14, (H+55)*row+30), f'{key} candidate | 28.128 um measured cut face | identical geometry', fill='#93aeb0')
sheet.save(OUT/'production-window-comparison.png')
report = dict(passed=True, driver=glscope['driver'], datasetId='2298522198', displayProfile=profile,
    compiledPrograms=['volume', 'composite', 'production-cap-LUT'], transferChecks=checks,
    comparedIntensities=18*256, productionShaderSha256=hashlib.sha256((ROOT/'public/renderer.js').read_bytes()).hexdigest(),
    volumeRawSha256=hashlib.sha256(scope['volume'].tobytes()).hexdigest(),
    scope='Actual production GLSL compiled and rendered in native offscreen EGL, compared with shared JS for all 256 intensities, six palettes and three profiles. Measured donor caps with unchanged threshold, source arrays, mask and coordinates. No browser/device performance or clinical validation claim.')
(OUT/'gpu-validation.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(dict(passed=True, comparedIntensities=report['comparedIntensities'], maxChannelDifference=max(c['maxChannelDifference'] for c in checks), output=str(OUT))), flush=True)
