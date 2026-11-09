#!/usr/bin/env python3
"""Render actual production TEE meshes, camera, CT and acoustic frames in EGL.

No browser automation or performance claim. The images use the original
317.6 µm resident display volume so they are labeled previews, not Ultra data.
Run export_review.mjs first. Intermediate source rasters stay outside Git.
"""
from pathlib import Path
import ctypes as C
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/workspace/data/tee-lab-v26/render')
OUT = ROOT / 'docs/tee-lab-v26/render'
OUT.mkdir(parents=True, exist_ok=True)
scene = json.loads((DATA / 'fixture.json').read_text())
fixture = ROOT / 'tests/renderer-responsiveness-v16-native.py'
sys.argv = [sys.argv[0], '--output', str(OUT)]
__file__ = str(fixture)
setup = fixture.read_text().split('checks=[]')[0].replace('W, H, VW, VH = 490, 590, 180, 217', 'W, H, VW, VH = 600, 660, 180, 198')
exec(compile(setup, str(fixture), 'exec'))

level, cleanup = scene['meta'], scene['cleanup']
texture(0, load_volume(level), True)
texture(2, np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()), np.uint8).reshape(*cleanup['dimensions'][::-1]).copy())
base_configure = configure


def configure(program, out, level, cleanup, world, *args, **kwargs):
    fn('glBindBuffer', None, [U, U])(0x8892, buf)
    base_configure(program, out, level, cleanup, world, *args, **kwargs)
    basis = world['_basis']
    for name, value in dict(eye=basis['eye'], forward=basis['forward'], right=basis['right'], up=basis['up']).items():
        u3(program, name, value)
    ui(program, 'lumenCleanupReady', 0)


runtime = (ROOT / 'public/probe-scene.js').read_text()
vertex = re.search(r'const VERTEX=`([\s\S]*?)`;', runtime).group(1)
fragment = re.search(r'const FRAGMENT=`([\s\S]*?)`;', runtime).group(1)
original_vertex = sources['vertex']
sources['vertex'] = vertex
geometry_program = compile_program(fragment)
sources['vertex'] = original_vertex
geometry_target = output(W, H)
depth = U()
fn('glGenRenderbuffers', None, [I, C.POINTER(U)])(1, C.byref(depth))
fn('glBindRenderbuffer', None, [U, U])(0x8D41, depth)
fn('glRenderbufferStorage', None, [U, U, I, I])(0x8D41, 0x81A6, W, H)
fn('glFramebufferRenderbuffer', None, [U, U, U, U])(0x8D40, 0x8D00, 0x8D41, depth)
assert fn('glCheckFramebufferStatus', U, [U])(0x8D40) == 0x8CD5
mesh_buffer = U()
fn('glGenBuffers', None, [I, C.POINTER(U)])(1, C.byref(mesh_buffer))
position = fn('glGetAttribLocation', I, [U, C.c_char_p])(geometry_program, b'position')
normal = fn('glGetAttribLocation', I, [U, C.c_char_p])(geometry_program, b'normal')


def render_instrument(case):
    use(geometry_program)
    bind_fbo(0x8D40, geometry_target['framebuffer'])
    viewport(0, 0, W, H)
    fn('glClearColor', None, [F, F, F, F])(0, 0, 0, 0)
    fn('glClear', None, [U])(0x4000 | 0x0100)
    enable(0x0B71)
    fn('glDepthFunc', None, [U])(0x0203)
    enable(0x0BE2)
    fn('glBlendFuncSeparate', None, [U, U, U, U])(0x0302, 0x0303, 1, 0x0303)
    for name, key in [('eye', 'eye'), ('forward', 'forward'), ('cameraRight', 'right'), ('cameraUp', 'up')]:
        u3(geometry_program, name, case['basis'][key])
    uf(geometry_program, 'referenceMm', scene['referenceMm'])
    uf(geometry_program, 'aspect', W/H)
    fn('glBindBuffer', None, [U, U])(0x8892, mesh_buffer)
    for attribute in [position, normal]:
        fn('glEnableVertexAttribArray', None, [U])(attribute)
    for mesh in case['meshes']:
        vertices = np.asarray(mesh['vertices'], np.float32).reshape(-1, 6)
        fn('glBufferData', None, [U, C.c_ssize_t, P, U])(0x8892, vertices.nbytes, vertices.ctypes.data, 0x88E4)
        pointer = fn('glVertexAttribPointer', None, [U, I, U, U, I, P])
        pointer(position, 3, 0x1406, 0, 24, None)
        pointer(normal, 3, 0x1406, 0, 24, 12)
        model = np.asarray(mesh['model'] or np.eye(4).ravel(), np.float32)
        fn('glUniformMatrix4fv', None, [I, I, U, P])(loc(geometry_program, b'model'), 1, 0, model.ctypes.data)
        fn('glUniform4f', None, [I, F, F, F, F])(loc(geometry_program, b'color'), *mesh['color'], mesh.get('alpha', 1))
        uf(geometry_program, 'gloss', mesh.get('gloss', .1))
        draw_arrays(4, 0, len(vertices))
    pixels = read_target(geometry_target)
    disable(0x0BE2)
    disable(0x0B71)
    return pixels


font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
reports = []
for case in scene['cases']:
    cap_bytes = (DATA / (case['id'] + '-cap.raw')).read_bytes()
    assert hashlib.sha256(cap_bytes).hexdigest() == case['capSha256']
    cap = np.frombuffer(cap_bytes, np.uint8).reshape(case['capHeight'], case['capWidth'])
    texture(1, cap, True)
    world = dict(case['plane'], _basis=case['basis'])
    heart = draw(programs['volume'], full, level, cleanup, world, scene['settings'], .28, cap.shape)
    assert np.count_nonzero(heart[:, :, 0] > 60) > 5000
    instrument = render_instrument(case)
    instrument_pixels = int(np.count_nonzero(instrument[:, :, 3]))
    assert instrument_pixels > 50
    view = Image.alpha_composite(Image.fromarray(heart), Image.fromarray(instrument)).convert('RGB')
    guide = ImageDraw.Draw(view)
    tract = [(p['x'], p['y']) for p in case['path'] if p]
    for i in range(0, len(tract)-1, 3):
        guide.line(tract[i:i+2], fill='#a57d95', width=1)
    arc = [(p['x'], p['y']) for p in case['sector'] if p]
    if case['origin'] and len(arc) == len(case['sector']):
        origin = (case['origin']['x'], case['origin']['y'])
        guide.line([origin, *arc, origin], fill='#8abfa4', width=2)
    sheet = Image.new('RGB', (3*W, H+88), '#0b1417')
    sheet.paste(view, (0, 48))
    for column, suffix in [(1, 'ct.rgb'), (2, 'us.rgb')]:
        image = Image.frombytes('RGB', (case['width'], case['height']), (DATA / (case['id'] + '-' + suffix)).read_bytes())
        image.thumbnail((W, H), Image.Resampling.LANCZOS)
        sheet.paste(image, (column*W+(W-image.width)//2, 48+(H-image.height)//2))
    pen = ImageDraw.Draw(sheet)
    for column, label in enumerate([case['label']+' · probe & plane', 'Measured CT · matched sector', 'Simulated ultrasound · CT-derived']):
        pen.text((column*W+15, 14), label, font=font, fill='#dde5d8')
    state = case['state']
    pen.text((15, H+61), f"{state['insertionCm']:.1f} cm model · multiplane {state['multiplaneDeg']}° · shaft {state['shaftRotationDeg']}° · flexion {state['anteflexDeg']}° / {state['lateralFlexDeg']}°", font=small, fill='#adbfaf')
    pen.text((W+15, H+61), '317.6 µm source preview · source pixels unchanged', font=small, fill='#adbfaf')
    pen.text((2*W+15, H+61), 'Illustrative tract · fixed specimen · no clinical registration', font=small, fill='#adbfaf')
    sheet.save(OUT / (case['id']+'-matched-views.jpg'), quality=92)
    item = dict(id=case['id'], sourceSpacingUm=case['stats']['sourceSpacingUm'], capSpacingUm=case['capSpacingUm'], capSha256=case['capSha256'], tissueFraction=case['stats']['tissueFraction'], instrumentPixels=instrument_pixels, glError=fn('glGetError', U, [])())
    assert item['glError'] == 0
    reports.append(item)
    print(json.dumps(item), flush=True)

(OUT / 'validation.json').write_text(json.dumps(dict(scope=scene['scope'], productionMeshesAndShaders=True, productionAcoustics=True, source=scene['source'], driver=fn('glGetString', C.c_char_p, [U])(0x1F01).decode(), checks=reports), indent=2)+'\n')
