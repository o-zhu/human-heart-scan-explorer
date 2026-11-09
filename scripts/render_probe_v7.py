"""Native inspection of actual Probe GLSL, camera, guide and fine-derived sectors.

First run verify-probe-v7.mjs --source --out=/workspace/data/probe-v7.
This uses the production shader in offscreen EGL and records the production
Canvas guide paths as SVG. It is not a browser screenshot or FPS benchmark.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/workspace/data/probe-v7')
OUT = ROOT / 'docs/probe-v7'
OUT.mkdir(exist_ok=True)
harness = ROOT / 'scripts/render_flow_views_v5.py'
code = harness.read_text().split("results={'driver':")[0]
old = """ direction=norm(normal*side+r*.24*side+u*.10)
 camera_up=norm(u-direction*np.dot(direction,u));forward=-direction;right=norm(np.cross(forward,camera_up));camera_up=norm(np.cross(right,forward))
 eye=target+direction*preset['closeDistance' if close else 'cameraDistance']"""
new = """ basis=preset['basis'];eye=np.array(basis['eye']);forward=np.array(basis['forward']);right=np.array(basis['right']);camera_up=np.array(basis['up'])"""
assert old in code
code = code.replace(old, new)
scope = {'__file__': str(harness), '__name__': 'probe_native_validation'}
exec(compile(code, str(harness), 'exec'), scope)

width, height = 680, 650
sheet = Image.new('RGB', (width * 2, (height + 70) * 2), '#0d1519')
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 19)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
checks = []
for row, ident in enumerate(['apical', 'atrial']):
    scene = json.loads((SOURCE / f'{ident}-scene.json').read_text())
    world = {**scene['plane'], 'target': scene['camera']['pan']}
    item = {'world': world, 'flip': scene['state']['flip'], 'threshold': .28,
            'texture': scene['texture'], 'basis': scene['basis']}
    pixels = scope['render_flow'](item, w=width, h=height)
    visible = int((np.max(pixels[:, :, :3], axis=2) > 50).sum())
    assert visible > 10000, (ident, 'empty or badly framed cutaway')
    native = Image.fromarray(pixels).convert('RGBA')
    guide_path = SOURCE / f'{ident}-guide.png'
    subprocess.run(['inkscape', str(SOURCE / f'{ident}-guide.svg'),
                    '--export-type=png', f'--export-filename={guide_path}'],
                   check=True, capture_output=True)
    guide = Image.open(guide_path).convert('RGBA')
    assert guide.size == native.size
    assert np.asarray(guide)[:, :, 3].min() == 0, 'Guide background must remain transparent'
    composite = Image.alpha_composite(native, guide).convert('RGB')
    composite.save(SOURCE / f'{ident}-native-guide.png')
    ultrasound = Image.open(SOURCE / f'{ident}-us.pgm').convert('RGB')
    ultrasound.thumbnail((width, height), Image.Resampling.LANCZOS)
    image_panel = Image.new('RGB', (width, height), '#030709')
    image_panel.paste(ultrasound, ((width-ultrasound.width)//2, (height-ultrasound.height)//2))
    y = row * (height + 70)
    sheet.paste(composite, (0, y+70))
    sheet.paste(image_panel, (width, y+70))
    kind = 'TTE skin guide' if ident == 'apical' else 'TEE esophageal-wall guide'
    draw.text((16, y+10), kind + ' / locked contact', font=font, fill='#eee8dc')
    draw.text((16, y+38), 'Production GLSL + production guide paths / 79.4 micrometre cut face', font=small, fill='#9aacaf')
    draw.text((width+16, y+10), 'CT-derived simulated ultrasound / same probe pose', font=font, fill='#eee8dc')
    draw.text((width+16, y+38), '1100 pixel sector / fine CT input / fixed specimen, no heartbeat', font=small, fill='#9aacaf')
    checks.append({'preset': ident, 'contactKind': scene['pose']['contact']['kind'],
                   'nonBackgroundPixels': visible, 'glError': 0,
                   'sourceSpacingUm': scene['texture']['sourceSpacingUm'],
                   'capSize': [scene['texture']['width'], scene['texture']['height']],
                   'panelSize': [width, height]})

sheet.save(OUT / 'native-comparison.jpg', quality=94)
report = {'passed': True, 'driver': scope['driver'],
          'shaderSha256': hashlib.sha256((ROOT/'public/renderer.js').read_bytes()).hexdigest(),
          'checks': checks,
          'scope': 'Actual production GLSL, actual camera basis, recorded production Canvas guide paths, and fine-derived simulated sectors. Offscreen EGL and native SVG rendering; not a browser layout, cursor-permission or frame-rate test.'}
(OUT / 'native-validation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report), flush=True)
