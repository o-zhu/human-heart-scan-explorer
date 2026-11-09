#!/usr/bin/env python3
"""Orthographic native scientific inspection of actual TTE pose/mesh exports.

The production procedural geometry and shading are retained. Projection is
orthographic to compare positions with one stable camera. The optional opaque
heart is a coarse source silhouette, not the user's final reconstructed surface.
Head-center dots are review markers; this is not a browser screenshot.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import itertools
import json
import re
import numpy as np
import moderngl
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter
from skimage.measure import marching_cubes

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--data', default='/tmp/tte-atlas-v1')
parser.add_argument('--out', default=str(ROOT / 'docs/tte-atlas-v1'))
args = parser.parse_args()
data, out = Path(args.data), Path(args.out)
out.mkdir(parents=True, exist_ok=True)
review = json.loads((data / 'review.json').read_text())
W, H = 480, 480
ctx = moderngl.create_standalone_context(backend='egl')
source = (ROOT / 'public/probe-scene.js').read_text()
fragment = re.search(r'const FRAGMENT=`([\s\S]*?)`;', source).group(1)
fragment = '#version 330\nout vec4 outColor;\n' + fragment.replace('precision highp float;', '').replace('varying ', 'in ').replace('gl_FragColor', 'outColor')
vertex = '''#version 330
in vec3 position,normal;uniform mat4 model;
uniform vec3 target,cameraRight,cameraUp,forward;uniform float halfWidth,halfHeight,referenceMm;
out vec3 vNormal,vWorld;
void main(){vec3 world=(model*vec4(position,1.)).xyz;vec3 q=world-target;
gl_Position=vec4(dot(q,cameraRight)/halfWidth,dot(q,cameraUp)/halfHeight,dot(q,forward)/600.,1.);
vNormal=normalize(mat3(model)*normal);vWorld=world/referenceMm;}
'''
program = ctx.program(vertex_shader=vertex, fragment_shader=fragment)
target = ctx.simple_framebuffer((W, H), components=4)
target.use()
ctx.enable(moderngl.DEPTH_TEST | moderngl.BLEND)
ctx.depth_func = '<='
ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA,
                  moderngl.ONE, moderngl.ONE_MINUS_SRC_ALPHA)
buffers = []


def vao(vertices):
    buffer = ctx.buffer(np.ascontiguousarray(vertices, dtype=np.float32).tobytes())
    buffers.append(buffer)
    return ctx.vertex_array(program, [(buffer, '3f 3f', 'position', 'normal')])


assets = {name: vao(np.fromfile(data / name, np.float32).reshape(-1, 6))
          for name in sorted({draw['file'] for case in review['cases'] for draw in case['draws']})}
manifest = json.loads((ROOT / 'public/assets/manifest.json').read_text())
level = manifest['levels']['low']
part = level['parts'][0]
raw = (ROOT / 'public' / part['url']).read_bytes()
scalar = np.frombuffer(gzip.decompress(raw), np.uint8).reshape(level['dimensions'][::-1])
if part.get('predictor') == 'delta-z':
    scalar = np.cumsum(scalar, axis=0, dtype=np.uint8)
filtered = gaussian_filter(scalar.astype(np.float32), .65)
vertices, faces, normals, _ = marching_cubes(filtered, 71.4, step_size=3, allow_degenerate=False)
extent = np.array(level['physicalCenterExtentUm']) / 1000
vertices = (vertices[:, ::-1] / (np.array(level['dimensions']) - 1) - .5) * extent
vertices = vertices[:, [0, 2, 1]] * np.array([1, 1, -1])
normals = normals[:, [2, 0, 1]] * np.array([1, 1, -1])
heart = vao(np.concatenate([vertices[faces], normals[faces]], axis=-1).reshape(-1, 6))
identity = np.eye(4, dtype=np.float32).ravel()
camera = {key: np.array(value) for key, value in review['camera'].items()}
forward, right, up = (camera[key] for key in ('forward', 'right', 'up'))
global_target = (np.array(review['bounds']['min']) + review['bounds']['max']) / 2
corners = np.array(list(itertools.product(*zip(review['bounds']['min'], review['bounds']['max']))))
global_half = max(np.abs((corners-global_target) @ right).max(), np.abs((corners-global_target) @ up).max()) * 1.08
font_dir = '/usr/share/fonts/truetype/dejavu'
title_font = ImageFont.truetype(f'{font_dir}/DejaVuSans.ttf', 19)
small_font = ImageFont.truetype(f'{font_dir}/DejaVuSans.ttf', 14)
mono_font = ImageFont.truetype(f'{font_dir}/DejaVuSansMono.ttf', 14)
heading_font = ImageFont.truetype(f'{font_dir}/DejaVuSans.ttf', 26)


def projection(point, center, half):
    q = np.asarray(point)-center
    return ((.5+(q @ right)/(2*half))*W,
            (.5-(q @ up)/(2*half))*H)


def render(case, center, half):
    target.use()
    target.depth_mask = True
    target.clear(.025, .042, .047, 1, depth=1)
    ctx.disable(moderngl.CULL_FACE)
    for key, value in [('target', center), ('cameraRight', right), ('cameraUp', up), ('forward', forward),
                       ('eye', (center-forward*700)/review['referenceMm'])]:
        program[key].value = tuple(value)
    program['halfWidth'].value = half
    program['halfHeight'].value = half
    program['referenceMm'].value = review['referenceMm']
    program['model'].write(identity.tobytes())
    program['color'].value = (.46, .51, .49, 1)
    program['gloss'].value = .08
    heart.render()
    for command in case['draws']:
        if command['cull']:
            ctx.enable(moderngl.CULL_FACE)
            ctx.cull_face = command['cull']
        else:
            ctx.disable(moderngl.CULL_FACE)
        program['model'].write(np.asarray(command['model'] or identity, np.float32).tobytes())
        program['color'].value = (*command['color'], command['alpha'])
        program['gloss'].value = command['gloss']
        target.depth_mask = command['alpha'] > .7
        assets[command['file']].render()
    image = Image.frombytes('RGBA', (W, H), target.read(components=4, alignment=1)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).convert('RGB')
    pen = ImageDraw.Draw(image)
    fit = case['pose']['contextFit']
    color = '#e3b575' if fit['estimated'] else '#9fd5bd'
    x, y = projection(case['pose']['originMm'], center, half)
    pen.ellipse((x-5, y-5, x+5, y+5), outline=color, width=2)
    pen.line((x-9, y, x-4, y), fill=color, width=1)
    pen.line((x+4, y, x+9, y), fill=color, width=1)
    error = ctx.error
    if error != 'GL_NO_ERROR':
        raise RuntimeError(error)
    card = Image.new('RGB', (W, H+78), '#081115')
    card.paste(image, (0, 40))
    pen = ImageDraw.Draw(card)
    pen.text((14, 8), f"{case['tableRow']}  {case['code']}", font=mono_font, fill='#dce6e1')
    pen.text((14, H+44), case['shortName'], font=title_font, fill='#e0e7e2')
    note = 'Estimated external probe · unregistered'
    pen.text((14, H+65), note, font=small_font, fill=color)
    return card


def sheet(cards, columns, title, subtitle, filename):
    rows = (len(cards)+columns-1)//columns
    cw, ch = cards[0].size
    result = Image.new('RGB', (columns*cw, rows*ch+116), '#081115')
    pen = ImageDraw.Draw(result)
    pen.text((18, 14), title, font=heading_font, fill='#edf1ec')
    pen.text((18, 51), subtitle, font=small_font, fill='#b4c5bc')
    for i, card in enumerate(cards):
        result.paste(card, ((i % columns)*cw, 80+(i//columns)*ch))
    pen.text((18, result.height-26), 'Actual production geometry · native orthographic review · coarse source-heart silhouette · not a browser screenshot', font=small_font, fill='#8ca59b')
    result.save(out / filename, quality=93)


cards = [render(case, global_target, global_half) for case in review['cases']]
sheet(cards, 4, 'TTE external probe positions · all 28 acquisitions',
      'One fixed anterior-oblique camera. Green = plane-coincident estimate; amber = independent acoustic-window estimate.',
      'probe-positions-all28.jpg')
selected = ['plax', 'psax_papillary', 'a4c', 'subcostal', 'ssn_arch']
details = []
for id in selected:
    case = next(c for c in review['cases'] if c['id'] == id)
    center = np.array(case['pose']['originMm']) + up*8
    details.append(render(case, center, 64))
sheet(details, 3, 'TTE acoustic windows · instrument details',
      'Actual authored meshes and production poses; estimated chest context is not donor segmentation.',
      'probe-positions-details.jpg')
report = dict(scope=__doc__,productionMeshes=True,productionFragmentShader=True,orthographicProjection=True,browserScreenshot=False,
              sourceHashes=review['sourceHashes'],sourceHeart=dict(spacingUm=level['spacingUm'],compressedSha256=hashlib.sha256(raw).hexdigest(),
                                                               triangles=len(faces),threshold=71.4,displayGaussianSigma=.65,marchingStep=3),
              camera=dict(direction='anterior-oblique',forward=forward.tolist(),right=right.tolist(),up=up.tolist(),targetMm=global_target.tolist(),halfHeightMm=global_half),
              cases=[dict(id=c['id'],window=c['group'],estimated=c['pose']['contextFit']['estimated'],
                          patientRegistered=False,glError='GL_NO_ERROR') for c in review['cases']],
              renderer=ctx.info['GL_RENDERER'],outputs=['probe-positions-all28.jpg','probe-positions-details.jpg'])
(out / 'probe-render-review.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(dict(views=len(cards),detailViews=len(details),renderer=ctx.info['GL_RENDERER'],output=str(out))))
