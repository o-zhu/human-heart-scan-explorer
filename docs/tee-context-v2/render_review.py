#!/usr/bin/env python3
"""Scientific EGL review of the actual procedural meshes and production shader.

Run node tests/tee-context-v2.mjs --render-data={temporary-cache} first.
This is not a browser screenshot or performance measurement. The optional
grey heart is a coarse, thresholded source-volume silhouette for placement QC.
"""
from pathlib import Path
import argparse
import gzip
import json
import re
import numpy as np
import moderngl
from PIL import Image, ImageDraw, ImageFont
from PIL import ImageColor

ROOT = Path(__file__).resolve().parents[2]
PARSER = argparse.ArgumentParser()
PARSER.add_argument('--data', default='{temporary-cache}')
PARSER.add_argument('--out', default=str(Path(__file__).resolve().parent))
PARSER.add_argument('--heart', action='store_true')
ARGS = PARSER.parse_args()
DATA, OUT = Path(ARGS.data), Path(ARGS.out)
OUT.mkdir(parents=True, exist_ok=True)
MODEL = json.loads((DATA / 'model.json').read_text())
W, H = 800, 800
ctx = moderngl.create_standalone_context(backend='egl')
source = (ROOT / 'public/probe-scene.js').read_text()
vert = re.search(r'const VERTEX=`([\s\S]*?)`;', source).group(1)
frag = re.search(r'const FRAGMENT=`([\s\S]*?)`;', source).group(1)
vert = '#version 330\n' + vert.replace('attribute ', 'in ').replace('varying ', 'out ')
frag = '#version 330\nout vec4 outColor;\n' + frag.replace('precision highp float;', '').replace('varying ', 'in ').replace('gl_FragColor', 'outColor')
program = ctx.program(vertex_shader=vert, fragment_shader=frag)
target = ctx.simple_framebuffer((W, H), components=4)
target.use()
meshes = []
for item in MODEL['meshes']:
    vertices = np.fromfile(DATA / item['file'], np.float32).reshape(-1, 6)
    buffer = ctx.buffer(vertices.tobytes())
    vao = ctx.vertex_array(program, [(buffer, '3f 3f', 'position', 'normal')])
    meshes.append(dict(item, vao=vao, vertices=vertices))

heart = None
if ARGS.heart:
    from skimage.measure import marching_cubes
    from scipy.ndimage import gaussian_filter
    manifest = json.loads((ROOT / 'public/assets/manifest.json').read_text())
    level = manifest['levels']['low']
    part = level['parts'][0]
    array = np.frombuffer(gzip.decompress((ROOT / 'public' / part['url']).read_bytes()), np.uint8).reshape(level['dimensions'][::-1])
    if part.get('predictor') == 'delta-z':
        array = np.cumsum(array, axis=0, dtype=np.uint8)
    array = gaussian_filter(array.astype(np.float32), .65)
    v, f, n, _ = marching_cubes(array, 71.4, step_size=3, allow_degenerate=False)
    extent = np.array(level['physicalCenterExtentUm']) / 1000
    v = (v[:, ::-1] / (np.array(level['dimensions']) - 1) - .5) * extent
    v = v[:, [0, 2, 1]] * np.array([1, 1, -1])
    n = n[:, [2, 0, 1]] * np.array([1, 1, -1])
    expanded = np.concatenate([v[f], n[f]], axis=-1).astype(np.float32).reshape(-1, 6)
    heart_buffer = ctx.buffer(expanded.tobytes())
    heart = ctx.vertex_array(program, [(heart_buffer, '3f 3f', 'position', 'normal')])

font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 19)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
reports = []


def camera(case):
    for key, shader in [('eye', 'eye'), ('forward', 'forward'), ('right', 'cameraRight'), ('up', 'cameraUp')]:
        program[shader].value = tuple(case[key])
    program['referenceMm'].value = MODEL['referenceMm']
    program['aspect'].value = W / H
    program['model'].write(np.eye(4, dtype=np.float32).tobytes())


def project(point, case):
    q = np.array(point) / MODEL['referenceMm'] - np.array(case['eye'])
    depth = q @ case['forward']
    return ((.5 + (q @ case['right']) / (.64 * depth)) * W,
            (.5 - (q @ case['up']) / (.64 * depth)) * H)


for view, case in MODEL['cameras'].items():
    camera(case)
    for mode in ['surface', 'transparent']:
        target.clear(.024, .042, .047, 1, depth=1)
        ctx.enable(moderngl.DEPTH_TEST | moderngl.BLEND)
        ctx.depth_func = '<='
        ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA, moderngl.ONE, moderngl.ONE_MINUS_SRC_ALPHA)
        if heart is not None:
            ctx.depth_mask = True
            program['color'].value = (.55, .59, .57, 1)
            program['gloss'].value = .13
            heart.render()
            # Production anatomy is a second WebGL canvas; retain the heart
            # colour while clearing depth so this reproduces x-ray context.
            if mode == 'transparent':
                ctx.depth_mask = True
                # moderngl has no portable depth-only clear; disable depth
                # testing for the intentionally depth-independent ghost layer.
                ctx.disable(moderngl.DEPTH_TEST)
        ordered = sorted(meshes, key=lambda m: -np.dot(np.array(m['bounds']['center']) / MODEL['referenceMm'] - case['eye'], case['forward']))
        for m in ordered:
            alpha = m['alpha'] if mode == 'transparent' else (.72 if m['id'] in ['diaphragm', 'central-tendon'] else 1)
            ctx.depth_mask = mode == 'surface'
            program['color'].value = (*m['color'], alpha)
            program['gloss'].value = m['gloss']
            m['vao'].render()
        image = Image.frombytes('RGBA', (W, H), target.read(components=4, alignment=1)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).convert('RGB')
        pen = ImageDraw.Draw(image)
        pen.rectangle((0, 0, W, 45), fill='#081115')
        pen.text((18, 12), f'TEE spatial context · {view} · {mode}', fill='#dbe4df', font=font)
        if mode == 'transparent':
            for label in MODEL['labels']:
                if label['priority'] > 2:
                    continue
                x, y = project(label['pointMm'], case)
                pen.ellipse((x-2, y-2, x+2, y+2), fill='#b4c8bd')
                pen.text((x+8, y-7), label['text'], fill='#bdcec4', font=small)
        pen.rectangle((0, H-40, W, H), fill='#081115')
        pen.text((18, H-29), 'Illustrative organs · source-anchored orientation is approximate · native EGL review', fill='#879e95', font=small)
        image.save(OUT / f'{view}-{mode}.png')
        reports.append(dict(view=view, mode=mode, file=f'{view}-{mode}.png', renderer=ctx.info['GL_RENDERER']))

combined = []
probe_manifest = DATA / 'production-probes.json'
if probe_manifest.exists():
    production = json.loads(probe_manifest.read_text())
    overlay_target = ctx.simple_framebuffer((W, H), components=4)
    draw_assets = {}
    for case in production['cases']:
        basis = case['basis']
        camera(basis)
        target.use()
        ctx.disable(moderngl.CULL_FACE)
        ctx.enable(moderngl.DEPTH_TEST)
        ctx.depth_mask = True
        target.clear(.024, .042, .047, 1, depth=1)
        if heart is not None:
            program['color'].value = (.55, .59, .57, 1)
            program['gloss'].value = .13
            heart.render()
        background = Image.frombytes('RGBA', (W, H), target.read(components=4, alignment=1)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        overlay_target.use()
        overlay_target.clear(0, 0, 0, 0, depth=1)
        ctx.enable(moderngl.DEPTH_TEST | moderngl.BLEND)
        ctx.blend_func = (moderngl.SRC_ALPHA, moderngl.ONE_MINUS_SRC_ALPHA, moderngl.ONE, moderngl.ONE_MINUS_SRC_ALPHA)
        for command in case['draws']:
            file = command['file']
            if file not in draw_assets:
                buffer = ctx.buffer((DATA / file).read_bytes())
                draw_assets[file] = ctx.vertex_array(program, [(buffer, '3f 3f', 'position', 'normal')])
            if command['cull']:
                ctx.enable(moderngl.CULL_FACE)
                ctx.cull_face = command['cull']
            else:
                ctx.disable(moderngl.CULL_FACE)
            program['model'].write(np.array(command['model'] or np.eye(4).ravel(), dtype=np.float32).tobytes())
            program['color'].value = (*command['color'], command['alpha'])
            program['gloss'].value = command['gloss']
            ctx.depth_mask = command['alpha'] > .7
            draw_assets[file].render()
        raw = np.frombuffer(overlay_target.read(components=4, alignment=1), np.uint8).reshape(H, W, 4)[::-1].copy()
        # Canvas uses premultiplied alpha. Pillow expects straight-alpha input.
        alpha = raw[:, :, 3:4].astype(float) / 255
        raw[:, :, :3] = np.round(np.clip(raw[:, :, :3] / np.maximum(alpha, 1e-6), 0, 255)).astype(np.uint8)
        image = Image.alpha_composite(background, Image.fromarray(raw))

        def color(css):
            if css.startswith('rgba'):
                v = [float(x) for x in re.findall(r'[\d.]+', css)]
                return tuple(round(x) for x in v[:3]) + (round(v[3]*255),)
            return ImageColor.getrgb(css) + (255,)

        for command in case['guide']:
            layer = Image.new('RGBA', (W, H))
            pen = ImageDraw.Draw(layer)
            rgba = color(command['color'])
            kind = command['type']
            if kind in ('fill', 'stroke'):
                points = [tuple(p) for p in command['points']]
                if len(points) < 2:
                    continue
                if kind == 'fill':
                    pen.polygon(points, fill=rgba)
                elif command.get('dash'):
                    dash = command['dash']
                    for a, b in zip(points, points[1:]):
                        a, b = np.array(a), np.array(b)
                        length = np.linalg.norm(b-a)
                        if length < 1e-8:
                            continue
                        for start in np.arange(0, length, sum(dash)):
                            end = min(length, start+dash[0])
                            pen.line([tuple(a+(b-a)*start/length), tuple(a+(b-a)*end/length)], fill=rgba, width=max(1, round(command['width'])))
                else:
                    pen.line(points, fill=rgba, width=max(1, round(command['width'])))
            elif kind == 'rect':
                pen.rectangle(command['rect'], fill=rgba)
            elif kind == 'text':
                size = int(re.search(r'(\d+)px', command['font']).group(1))
                text_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', size)
                pen.text((command['x'], command['y']-size), command['text'], font=text_font, fill=rgba)
            image = Image.alpha_composite(image, layer)
        image = image.convert('RGB')
        pen = ImageDraw.Draw(image)
        pen.rectangle((0, 0, W, 46), fill='#081115')
        pen.text((18, 13), f"{case['name']} · production probe & fan", fill='#dbe4df', font=font)
        fit = case['pose'].get('contextFit', {})
        pen.rectangle((0, H-45, W, H), fill='#081115')
        pen.text((18, H-36), f"{fit.get('insertionCm', 0):.1f} model cm · plane/tract {fit.get('distanceMm', 0):.2f} mm · same global camera", fill='#a5b9ad', font=small)
        pen.text((18, H-19), 'Illustrative organs and probe · coarse source-heart silhouette · native EGL, not a browser screenshot', fill='#879e95', font=small)
        name = f"production-{case['id']}.png"
        image.save(OUT / name)
        combined.append(image)
        reports.append(dict(view=case['id'], mode='actual-production-overlay', file=name, contextFit=fit, renderer=ctx.info['GL_RENDERER']))
    if combined:
        triptych = Image.new('RGB', (W*len(combined), H), '#081115')
        for i, image in enumerate(combined):
            triptych.paste(image, (W*i, 0))
        triptych.save(OUT / 'production-probes-triptych.png')

(OUT / 'render-verification.json').write_text(json.dumps(dict(productionMeshGenerator=True, productionGeometryShader=True, productionOverlayCommands=bool(combined), browserScreenshot=False, sourceHeart='Coarse 635 µm thresholded source silhouette' if heart else None, sourceHashes=production.get('sourceHashes') if combined else None, renders=reports), indent=2)+'\n')
print(json.dumps(dict(renderer=ctx.info['GL_RENDERER'], images=len(reports), output=str(OUT))))
