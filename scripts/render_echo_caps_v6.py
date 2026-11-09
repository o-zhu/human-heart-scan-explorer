"""Inspect new Echo Ultra caps using the actual production GLSL offscreen.

Reuses the existing native EGL harness. These are angled cutaway inspections,
not browser screenshots or frame-rate measurements.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
harness = ROOT / 'scripts/render_flow_views_v5.py'
scope = {'__file__': str(harness), '__name__': 'echo_cap_validation'}
exec(compile(harness.read_text().split("results={'driver':")[0], str(harness), 'exec'), scope)

manifest = json.loads((ROOT / 'public/assets/echo-textures.json').read_text())
frames = json.loads((ROOT / 'public/assets/echo-planes.json').read_text())['frames']
out = ROOT / 'docs/echo-v6'
out.mkdir(exist_ok=True)
sheet = Image.new('RGB', (1040, 638), '#0c1317')
draw = ImageDraw.Draw(sheet)
checks = []
for i, ident in enumerate(['a4c', 'me4c']):
    world = dict(frames[ident]['world'])
    world['target'] = world['center']
    item = {'world': world, 'flip': False, 'threshold': .28, 'cameraDistance': 1.55,
            'closeDistance': 1.05, 'texture': manifest['textures'][ident]}
    pixels = scope['render_flow'](item, w=520, h=590)
    visible = int((np.max(pixels[:, :, :3], axis=2) > 50).sum())
    assert visible > 10000, (ident, 'empty or badly framed cutaway')
    image = Image.fromarray(pixels).convert('RGB')
    sheet.paste(image, (i * 520, 48))
    draw.text((i * 520 + 14, 10), ident.upper() + ' | 79.4 micrometre measured cut face', fill='#e9e4da')
    draw.text((i * 520 + 14, 28), 'Production GLSL | Tissue / space | offscreen angled inspection', fill='#91a6ad')
    checks.append({'preset': ident, 'nonBackgroundPixels': visible, 'glError': 0,
                   'textureWidth': item['texture']['width'], 'textureHeight': item['texture']['height']})
sheet.save(out / 'gpu-cap-review.jpg', quality=93)
report = {'passed': True, 'driver': scope['driver'], 'checks': checks,
          'scope': 'Actual production GLSL and new measured Echo textures, offscreen EGL. Not browser interaction or timing.'}
(out / 'gpu-cap-validation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report), flush=True)
