"""Reproduce the three reported cropped-face failures with actual fine meshes.

Uses frozen v73 GLSL for BEFORE and current production GLSL for AFTER. Both use
the same hash-verified v19 detail mesh, original accepted plane/probe camera,
unchanged 0.28 mesh threshold, and identical resident-sampled ROI pixels.
This tests the immediate same-plane fallback, not a fine-source download or iOS.
"""
from pathlib import Path
import argparse
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', type=Path, required=True)
parser.add_argument('--before-shaders', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
options = parser.parse_args()
input_path, frozen_path, report_output = options.input, options.before_shaders, options.output
sys.argv = [sys.argv[0], '--output', str(report_output)]
fixture = ROOT / 'tests/fine-surface-v19-native.py'
setup = fixture.read_text().split('\ndonor = ')[0]
setup = setup.replace('720, 840, 180, 210', '960, 840, 240, 210')
exec(compile(setup, str(fixture), 'exec'))

samples = read_json(input_path / 'targeted/samples.json')
frozen = read_json(frozen_path)
current = dict(volume=sources, fine=fine_sources)
assert frozen['volume'] != current['volume'], 'Expected a pre-fix/post-fix shader difference.'
assert 'return cleanupAt(p)<.5?0.:sourceDensity(p);' in current['volume']['composite']
before_hash = hashlib.sha256(frozen_path.read_bytes()).hexdigest()
after_source_hash = hashlib.sha256((ROOT / 'public/renderer.js').read_bytes()).hexdigest()


def program_set(shader_set):
    global sources
    sources = shader_set['volume']
    return dict(
        composite=compile_program(sources['composite']),
        matte=compile_program(sources['composite'].replace(
            'vec3 color=texture(sceneTexture,screen).rgb;', 'vec3 color=vec3(0.);').replace(
            'color=pow(max(capShade(p,value),vec3(0.)),vec3(.89));', 'color=vec3(1.);')),
        mesh=compile_mesh(shader_set['fine']['vertex'], shader_set['fine']['fragment']),
        background=compile_program(shader_set['fine']['background']))


sets = {key: program_set(value) for key, value in [('before', frozen), ('after', current)]}

# All active sampler types need nonconflicting units even when their optional
# cleanup branch is off. The source fixture predates reviewed sparse-mask and
# scene-depth samplers; install bounded dummy textures only for this harness.
dummy_textures = []
for slot, internal, format_, type_, value in [
    (6, 0x8236, 0x8D94, 0x1405, np.zeros(1, np.uint32)),
    (7, 0x8058, 0x1908, 0x1401, np.zeros(4, np.uint8)),
]:
    tex = U(); fn('glGenTextures', None, [I, C.POINTER(U)])(1, C.byref(tex))
    active(0x84C0 + slot); bind(0x0DE1, tex)
    t2(0x0DE1, 0, internal, 1, 1, 0, format_, type_, value.ctypes.data)
    for key, value in [(0x2801, 0x2600), (0x2800, 0x2600), (0x2802, 0x812F), (0x2803, 0x812F)]:
        param(0x0DE1, key, value)
    dummy_textures.append(tex)

base_configure = configure
active_row = None
force_resident = False


def configure(program, *args, **kwargs):
    base_configure(program, *args, **kwargs)
    ui(program, 'sceneDepthTexture', 5); ui(program, 'sceneDepthReady', 0)
    for slot, tex in zip([6, 7], dummy_textures):
        active(0x84C0 + slot); bind(0x0DE1, tex)
    ui(program, 'reviewedMaskIndex', 6); ui(program, 'reviewedMaskPayload', 7)
    for name in ['reviewedMaskReady', 'lumenCleanupReady', 'lumenCleanupEnabled',
                 'debrisCleanupEnabled', 'refinementReady', 'nativeReplacementEnabled']:
        ui(program, name, 0)
    ui(program, 'capCleaned', 0)
    if force_resident:
        ui(program, 'capReady', 0)
    for name, value in active_row['camera']['basis'].items():
        u3(program, name, value)
    u3(program, 'extent', samples['extent'])
    ui(program, 'clipFlip', active_row['clipFlip'])


donor = next(d for d in donors if d['id'] == samples['donor'])
manifest_path = ROOT / 'public/assets/fine-surface-v19/manifest.json'
manifest = read_json(manifest_path)
lod = next(lod for lod in manifest['lods'] if lod['id'] == 'detail')
assert manifest['threshold'] == .28
volume_manifest = read_json(public_path(donor['manifestUrl']))
level = volume_manifest['levels']['high']
texture(0, load_volume(level), True)
cleanup = read_json(public_path(donor['cleanupManifestUrl']))
cleanup_raw = gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes())
assert hashlib.sha256(cleanup_raw).hexdigest() == samples['cleanupDecodedSha256']
texture(2, np.frombuffer(cleanup_raw, np.uint8).reshape(*cleanup['dimensions'][::-1]).copy())
mesh = install_mesh(mesh_arrays(manifest, lod))
rows, images = [], []
for row in samples['rows']:
    active_row = row
    roi = row['crop']
    cap_bytes = (input_path / 'targeted' / roi['file']).read_bytes()
    assert hashlib.sha256(cap_bytes).hexdigest() == roi['sha256']
    cap = np.frombuffer(cap_bytes, np.uint8).reshape(roi['height'], roi['width']).copy()
    texture(1, cap, True)
    common = [level, cleanup, roi['plane'], donor['displayWindow'], manifest['threshold'], cap.shape]
    results, mattes = {}, {}
    for key in ['before', 'after']:
        programs['composite'] = sets[key]['composite']
        mesh_program = sets[key]['mesh']; background_program = sets[key]['background']
        results[key] = render_mesh(mesh, common)
        mattes[key] = draw(sets[key]['matte'], composed, *common, scene=mesh_target)[:, :, 0] > 0
        Image.fromarray(results[key]).save(OUT / f'{row["id"]}-{key}.png')
    before_pixels, after_pixels = int(mattes['before'].sum()), int(mattes['after'].sum())
    restored = mattes['after'] & ~mattes['before']
    assert restored.sum() > 100, (row['id'], 'Fixture did not reproduce cropped cut-face loss.')
    assert np.array_equal(results['before'][mattes['before']], results['after'][mattes['before']]), 'ROI pixels changed.'
    assert np.array_equal(results['before'][~mattes['after']], results['after'][~mattes['after']]), 'Unrelated surface pixels changed.'
    force_resident = True
    resident = render_mesh(mesh, common)
    force_resident = False
    assert np.array_equal(resident[restored], results['after'][restored]), 'Fallback diverges from same-plane resident source.'
    metric = dict(id=row['id'],threshold=.28,beforeCapPixels=before_pixels,afterCapPixels=after_pixels,
        restoredCutFacePixels=int(restored.sum()),roiCapPixelsByteIdentical=True,unrelatedSurfacePixelsByteIdentical=True,
        restoredPixelsEqualResidentPlane=True,planeUnchanged=True,sourceRoiSha256=roi['sha256'])
    rows.append(metric); images.append((row['id'], results['before'], results['after']))
    print(json.dumps(metric), flush=True)

font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 23)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 17)
sheet = Image.new('RGB', (W * 2, (H + 75) * len(images)), '#091015'); pen = ImageDraw.Draw(sheet)
for i, (name, before, after) in enumerate(images):
    y = i * (H + 75)
    for col, label, data in [(0, 'Before · v73 crop leaves part of cut face open', before),
                             (1, 'After · production same-plane fallback', after)]:
        sheet.paste(Image.fromarray(data[:, :, :3]), (col * W, y + 75))
        pen.text((col * W + 15, y + 10), name + '  |  ' + label, font=font, fill='#ecece4')
        pen.text((col * W + 15, y + 43), 'Actual 1,986,313-triangle detail mesh · original probe camera · threshold 0.28', font=small, fill='#aebdbb')
sheet.save(OUT / 'reported-view-comparison.jpg', quality=94)
report = dict(passed=True,donor=samples['donor'],rows=rows,outputPixels=[W,H],
    beforeShaderFileSha256=before_hash,afterRendererSourceSha256=after_source_hash,
    meshManifestSha256=hashlib.sha256(manifest_path.read_bytes()).hexdigest(),mesh=lod,
    sourceSpacingUm=samples['sourceSpacingUm'],renderer=fn('glGetString', C.c_char_p, [U])(0x1F01).decode(),
    scope='Actual smaller high-fidelity detail mesh and production GLSL in native EGL. Identical unchanged accepted planes, probe cameras, threshold 0.28, source volume, support mask and ROI pixels. This isolates immediate 317.6 µm same-plane fallback; it does not test fine-source downloads, optional reviewed masks, browser/device frame rate or physical iOS.')
(OUT / 'reported-view-native.json').write_text(json.dumps(report, indent=2) + '\n')
