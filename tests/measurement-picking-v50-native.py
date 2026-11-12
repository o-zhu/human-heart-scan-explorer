"""Production measurement/mesh GLSL in native EGL on a small calibrated fixture.

This checks actual rasterized front/back surfaces, debris and clip rejection,
depth packing, current cut caps and resident volume picking. It is not browser,
physical iPad, performance or clinical measurement validation.
"""
from pathlib import Path
import ctypes as C
import hashlib
import json
import subprocess
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
P, I, U, F = C.c_void_p, C.c_int, C.c_uint, C.c_float
E = C.CDLL('libEGL.so.1')
E.eglGetProcAddress.argtypes = [C.c_char_p]
E.eglGetProcAddress.restype = P
get_display = C.CFUNCTYPE(P, U, P, C.POINTER(I))(E.eglGetProcAddress(b'eglGetPlatformDisplayEXT'))
display = get_display(0x31DD, None, None)
E.eglInitialize.argtypes = [P, C.POINTER(I), C.POINTER(I)]
E.eglInitialize.restype = U
major, minor = I(), I()
assert E.eglInitialize(display, C.byref(major), C.byref(minor)), 'EGL unavailable'
E.eglBindAPI.argtypes = [U]
E.eglBindAPI.restype = U
assert E.eglBindAPI(0x30A0)
attributes = (I * 9)(0x3033, 1, 0x3040, 0x40, 0x3024, 8, 0x3023, 8, 0x3038)
E.eglChooseConfig.argtypes = [P, C.POINTER(I), C.POINTER(P), I, C.POINTER(I)]
E.eglChooseConfig.restype = U
config, count = P(), I()
assert E.eglChooseConfig(display, attributes, C.byref(config), 1, C.byref(count)) and count.value
E.eglCreateContext.argtypes = [P, P, P, C.POINTER(I)]
E.eglCreateContext.restype = P
context = E.eglCreateContext(display, config, None, (I * 3)(0x3098, 3, 0x3038))
assert context, 'OpenGL ES 3 unavailable'
E.eglMakeCurrent.argtypes = [P, P, P, P]
E.eglMakeCurrent.restype = U
assert E.eglMakeCurrent(display, None, None, context)


def fn(name, result, args):
    return C.CFUNCTYPE(result, *args)(E.eglGetProcAddress(name.encode()))


sources = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    'import {measurementPickingShaderSources as pick} from "./public/measurement-picking.js";'
    'import {fineSurfaceShaderSources as mesh} from "./public/fine-surface.js";'
    'process.stdout.write(JSON.stringify({pick,mesh}));'
], cwd=ROOT))


def program(vertex, fragment):
    output = fn('glCreateProgram', U, [])()
    for kind, source in [(0x8B31, vertex), (0x8B30, fragment)]:
        shader = fn('glCreateShader', U, [U])(kind)
        text = C.c_char_p(source.encode())
        fn('glShaderSource', None, [U, I, C.POINTER(C.c_char_p), C.POINTER(I)])(shader, 1, C.byref(text), None)
        fn('glCompileShader', None, [U])(shader)
        ok, log = I(), C.create_string_buffer(16384)
        fn('glGetShaderiv', None, [U, U, C.POINTER(I)])(shader, 0x8B81, C.byref(ok))
        fn('glGetShaderInfoLog', None, [U, I, P, C.c_char_p])(shader, len(log), None, log)
        assert ok.value, log.value.decode()
        fn('glAttachShader', None, [U, U])(output, shader)
        fn('glDeleteShader', None, [U])(shader)
    fn('glLinkProgram', None, [U])(output)
    ok, log = I(), C.create_string_buffer(16384)
    fn('glGetProgramiv', None, [U, U, C.POINTER(I)])(output, 0x8B82, C.byref(ok))
    fn('glGetProgramInfoLog', None, [U, I, P, C.c_char_p])(output, len(log), None, log)
    assert ok.value, log.value.decode()
    return output


programs = {name: program(sources['pick']['vertex'], sources['pick'][name]) for name in ['fine', 'volume']}
mesh_program = program(sources['mesh']['vertex'], sources['mesh']['fragment'])
use = fn('glUseProgram', None, [U])
location = fn('glGetUniformLocation', I, [U, C.c_char_p])


def ui(p, name, value):
    fn('glUniform1i', None, [I, I])(location(p, name.encode()), value)


def uf(p, name, value):
    fn('glUniform1f', None, [I, F])(location(p, name.encode()), value)


def uv(p, name, values):
    values = np.asarray(values, np.float32)
    fn('glUniform' + str(len(values)) + 'fv', None, [I, I, P])(location(p, name.encode()), 1, values.ctypes.data)


active = fn('glActiveTexture', None, [U])
bind = fn('glBindTexture', None, [U, U])
parameter = fn('glTexParameteri', None, [U, U, I])
tex2 = fn('glTexImage2D', None, [U, I, I, I, I, I, U, U, P])
tex3 = fn('glTexImage3D', None, [U, I, I, I, I, I, I, U, U, P])
bind_fbo = fn('glBindFramebuffer', None, [U, U])
draw = fn('glDrawArrays', None, [U, I, I])
viewport = fn('glViewport', None, [I, I, I, I])
error = fn('glGetError', U, [])


def texture(unit, data, internal=0x8229, format_=0x1903, type_=0x1401, depth=False):
    tex = U()
    fn('glGenTextures', None, [I, C.POINTER(U)])(1, C.byref(tex))
    target = 0x806F if depth else 0x0DE1
    active(0x84C0 + unit)
    bind(target, tex)
    for key, value in [(0x2801, 0x2600), (0x2800, 0x2600), (0x2802, 0x812F), (0x2803, 0x812F)]:
        parameter(target, key, value)
    if depth:
        parameter(target, 0x8072, 0x812F)
        tex3(target, 0, internal, data.shape[2], data.shape[1], data.shape[0], 0, format_, type_, data.ctypes.data)
    else:
        tex2(target, 0, internal, data.shape[1], data.shape[0], 0, format_, type_, data.ctypes.data)
    assert error() == 0
    return tex


fn('glPixelStorei', None, [U, I])(0x0CF5, 1)
white3 = np.full((2, 2, 2), 255, np.uint8)
volume_texture = texture(0, white3, depth=True)
cap_texture = texture(1, np.full((2, 2), 255, np.uint8))
cleanup_texture = texture(2, white3, depth=True)
texture(3, white3, depth=True)
texture(4, white3, depth=True)
scene_texture = texture(5, np.zeros((9, 9, 4), np.uint8), 0x8058, 0x1908)
texture(6, np.zeros((1, 1), np.uint32), 0x8236, 0x8D94, 0x1405)
texture(7, np.zeros((1, 1, 4), np.uint8), 0x8058, 0x1908)
texture(8, white3, depth=True)
depth_texture = texture(14, np.full((9, 9), 0xFFFFFFFF, np.uint32), 0x81A6, 0x1902, 0x1405)
output_texture = texture(15, np.zeros((9, 9, 4), np.uint8), 0x8058, 0x1908)


def framebuffer(color, depth=None):
    fb = U()
    fn('glGenFramebuffers', None, [I, C.POINTER(U)])(1, C.byref(fb))
    bind_fbo(0x8D40, fb)
    attach = fn('glFramebufferTexture2D', None, [U, U, U, U, I])
    attach(0x8D40, 0x8CE0, 0x0DE1, color, 0)
    if depth is not None:
        attach(0x8D40, 0x8D00, 0x0DE1, depth, 0)
    assert fn('glCheckFramebufferStatus', U, [U])(0x8D40) == 0x8CD5
    return fb


scene_fbo, output_fbo = framebuffer(scene_texture, depth_texture), framebuffer(output_texture)
positions = np.rint((np.asarray([[-.3, -.3, .2], [.3, -.3, .2], [0, .3, .2], [-.3, -.3, 0], [.3, -.3, 0], [0, .3, 0]]) + .5) * 65535).astype(np.uint16)
normals = np.asarray([[0, 0, 32767]] * 6, np.int16)
flags = np.asarray([255, 255, 255, 0, 0, 0], np.uint8)
mesh_vao = U()
fn('glGenVertexArrays', None, [I, C.POINTER(U)])(1, C.byref(mesh_vao))
bind_vao = fn('glBindVertexArray', None, [U])
bind_vao(mesh_vao)
for slot, array, kind, size in [(0, positions, 0x1403, 3), (1, normals, 0x1402, 3), (2, flags, 0x1401, 1)]:
    buffer = U()
    fn('glGenBuffers', None, [I, C.POINTER(U)])(1, C.byref(buffer))
    fn('glBindBuffer', None, [U, U])(0x8892, buffer)
    fn('glBufferData', None, [U, C.c_ssize_t, P, U])(0x8892, array.nbytes, array.ctypes.data, 0x88E4)
    fn('glEnableVertexAttribArray', None, [U])(slot)
    fn('glVertexAttribPointer', None, [U, I, U, U, I, P])(slot, size, kind, 1, 0, None)


def configure(p, clip=False, composite=False, scene_size=9):
    use(p)
    for name, unit in dict(volume=0, capTexture=1, cleanupTexture=2, anatomyTexture=3, accelerationTexture=4, sceneTexture=5, reviewedMaskIndex=6, reviewedMaskPayload=7, coronaryTexture=8, sceneDepthTexture=14).items():
        ui(p, name, unit)
    for name, value in dict(mode=0, showPlanes=0, clipAxis=3 if clip else -1, palette=4, cleanupReady=0, cleanupEnabled=1, capReady=1, capCleaned=1, skipCap=int(composite), coronaryReady=0, lumenCleanupReady=0, reviewedMaskReady=0, refinementReady=0, nativeReplacementEnabled=0, nativePatchPass=0, refinementPatchPass=0, debrisCleanupEnabled=0, sceneDepthReady=1, measurementComposite=int(composite)).items():
        ui(p, name, value)
    for name, value in dict(fov=.32, cameraAspect=1, threshold=.3, opacity=.8, stepSize=.01, planeDistance=.25, capContrast=1.8).items():
        uf(p, name, value)
    for name, value in dict(eye=[0, 0, 2], forward=[0, 0, -1], right=[1, 0, 0], up=[0, 1, 0], extent=[1, 1, 1], dimensions=[2, 2, 2], textureDimensions=[2, 2, 2], textureOffset=[0, 0, 0], cleanupDimensions=[2, 2, 2], planeNormal=[0, 0, 1], capCenter=[0, 0, .25], capRight=[1, 0, 0], capUp=[0, 1, 0], boundsMin=[-.5, -.5, -.5], boundsMax=[.5, .5, .5]).items():
        uv(p, name, value)
    for name, value in dict(resolution=[scene_size, scene_size], capSize=[1, 1], capRasterSize=[2, 2], measurementOrigin=[0, 0], measurementOutputSize=[9, 9]).items():
        uv(p, name, value)


def surface(clean=False, clipped=False):
    bind_fbo(0x8D40, scene_fbo)
    viewport(0, 0, 9, 9)
    configure(mesh_program, clipped)
    ui(mesh_program, 'debrisCleanupEnabled', int(clean))
    if clipped:
        uf(mesh_program, 'planeDistance', .1)
    fn('glEnable', None, [U])(0x0B71)
    fn('glDepthFunc', None, [U])(0x0203)
    fn('glClearDepthf', None, [F])(1)
    fn('glClear', None, [U])(0x00004000 | 0x00000100)
    bind_vao(mesh_vao)
    draw(4, 0, 6)
    assert error() == 0


def pick(kind='fine', clip=False, composite=False, scene_size=9, overrides=None):
    bind_fbo(0x8D40, output_fbo)
    viewport(0, 0, 9, 9)
    bind_vao(0)
    fn('glDisable', None, [U])(0x0B71)
    fn('glDisable', None, [U])(0x0BD0)
    p = programs[kind]
    configure(p, clip, composite, scene_size)
    if overrides:
        overrides(p)
    draw(4, 0, 3)
    image = np.empty((9, 9, 4), np.uint8)
    fn('glReadPixels', None, [I, I, I, I, U, U, P])(0, 0, 9, 9, 0x1908, 0x1401, image.ctypes.data)
    assert error() == 0
    return image


def forward_depth(pixel):
    value = (int(pixel[0]) * 65536 + int(pixel[1]) * 256 + int(pixel[2])) / 16777215
    return .1 / (10 - value * 9.99)


checks = []
surface()
image = pick()
assert image[4, 4, 3] == 1 and image[0, 0, 3] == 0
front_z = positions[0, 2] / 65535 - .5
assert abs(forward_depth(image[4, 4]) - (2 - front_z)) < .00008
checks.append('nearest actual rasterized surface and background rejection')
surface(clean=True)
image = pick()
back_z = positions[3, 2] / 65535 - .5
assert abs(forward_depth(image[4, 4]) - (2 - back_z)) < .00008
checks.append('production detached-debris discard reveals the correct deeper surface')
surface(clipped=True)
assert abs(forward_depth(pick()[4, 4]) - (2 - back_z)) < .00008
checks.append('production clip discard changes the sampled surface')
surface()
image = pick(clip=True)
assert image[4, 4, 3] == 2 and abs(forward_depth(image[4, 4]) - 1.75) < .00008
checks.append('current prepared cap replaces mesh depth and marks its plane')
active(0x84C1)
bind(0x0DE1, cap_texture)
empty = np.zeros((2, 2), np.uint8)
tex2(0x0DE1, 0, 0x8229, 2, 2, 0, 0x1903, 0x1401, empty.ctypes.data)
image = pick(clip=True)
assert image[4, 4, 3] == 1 and abs(forward_depth(image[4, 4]) - (2 - front_z)) < .00008
checks.append('empty cap pixels expose the visible surface instead of inventing a plane')
image = pick(clip=True, overrides=lambda p: uv(p, 'capSize', [.1, .1]))
assert image[4, 4, 3] == 1 and image[4, 5, 3] == 2
checks.append('outside a focused cap crop uses resident tissue at the actual plane')
white = np.full((2, 2), 255, np.uint8)
active(0x84C1)
bind(0x0DE1, cap_texture)
tex2(0x0DE1, 0, 0x8229, 2, 2, 0, 0x1903, 0x1401, white.ctypes.data)
active(0x84C2)
bind(0x806F, cleanup_texture)
black3 = np.zeros((2, 2, 2), np.uint8)
tex3(0x806F, 0, 0x8229, 2, 2, 2, 0, 0x1903, 0x1401, black3.ctypes.data)
assert pick(clip=True, overrides=lambda p: ui(p, 'cleanupReady', 1))[4, 4, 3] == 2
assert pick(clip=True, overrides=lambda p: (ui(p, 'cleanupReady', 1), ui(p, 'capCleaned', 0)))[4, 4, 3] == 1
checks.append('prepared fine-cap cleanup is not erased by the coarser support mask')
image = pick('volume')
assert image[4, 4, 3] == 1 and abs(forward_depth(image[4, 4]) - 1.5) < .00008
image = pick('volume', clip=True, composite=True, scene_size=3)
assert image[4, 4, 3] == 2 and abs(forward_depth(image[4, 4]) - 1.75) < .00008
checks.append('resident scalar ray and full-output cap remain coherent in a reduced scene grid')

report = dict(passed=True, checks=checks, driver=fn('glGetString', C.c_char_p, [U])(0x1F01).decode(),
              nativeFixturePixels=81, nativeFixtureVertices=6, forwardDepthToleranceWorldUnits=.00008,
              runtimeHashes={name: hashlib.sha256((ROOT / 'public' / name).read_bytes()).hexdigest()
                             for name in ['measurement-picking.js', 'measurement-frame.js', 'renderer.js', 'fine-surface.js']},
              scope='Native EGL production-shader regression with calibrated synthetic geometry. Not browser, physical-device, performance or clinical validation.')
out = ROOT / 'docs/measurement-v50'
out.mkdir(parents=True, exist_ok=True)
(out / 'native-picking-check.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
