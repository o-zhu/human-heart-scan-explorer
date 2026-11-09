"""Render actual mobile meshes with the production cleanup shaders in native EGL.

The atlas input is exported by the production bounded loader, not a substitute
mask. Two original prepared LA sections and both smaller surface profiles are
checked off/on/off at the same camera. This is not an iOS performance test.
"""
from pathlib import Path
import argparse
import gc
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--atlas', type=Path, required=True,
                    help='Production-loader export with manifest.json, index.raw and payload.raw')
parser.add_argument('--output', type=Path, default=ROOT / 'docs/echo-mobile-v41/native-mobile')
options = parser.parse_args()
atlas_path, report_output = options.atlas, options.output
sys.argv = [sys.argv[0], '--output', str(report_output)]
fixture = ROOT / 'tests/fine-surface-v19-native.py'
exec(compile(fixture.read_text().split('\ndonor = ')[0], str(fixture), 'exec'))

atlas = read_json(atlas_path / 'manifest.json')
index = np.frombuffer((atlas_path / 'index.raw').read_bytes(), '<u4').copy()
payload = np.frombuffer((atlas_path / 'payload.raw').read_bytes(), np.uint8).copy()
assert index.nbytes == atlas['indexTexture']['byteLength']
assert payload.nbytes == atlas['payloadTexture']['byteLength']
assert len(atlas['fields']) == 4
assert all(f['kind'] == 'lumen' for f in atlas['fields'])
assert [f['id'] for f in atlas['fields']] == ['lumen:atrial', 'lumen:arterial',
                                           'lumen:valve-region', 'lumen:rv']
atlas_textures = []
for unit_index, meta, data, internal, format_, type_ in [
    (6, atlas['indexTexture'], index, 0x8236, 0x8D94, 0x1405),
    (7, atlas['payloadTexture'], payload, 0x8058, 0x1908, 0x1401),
]:
    tex = U()
    fn('glGenTextures', None, [I, C.POINTER(U)])(1, C.byref(tex))
    atlas_textures.append(tex)
    active(0x84C0 + unit_index)
    bind(0x0DE1, tex)
    for key, value in [(0x2801, 0x2600), (0x2800, 0x2600),
                       (0x2802, 0x812F), (0x2803, 0x812F)]:
        param(0x0DE1, key, value)
    t2(0x0DE1, 0, internal, meta['width'], meta['height'], 0,
       format_, type_, data.ctypes.data)
    assert fn('glGetError', U, [])() == 0
offsets = np.zeros(8, np.int32)
grids = np.zeros((8, 3), np.int32)
for i, f in enumerate(atlas['fields']):
    offsets[i] = f['indexOffset']
    grids[i] = f['brickGridXYZ']

base_configure = configure
mask_enabled = False


def configure(program, *args, **kwargs):
    base_configure(program, *args, **kwargs)
    # The current composite has a depth sampler absent from the older common
    # fixture. Assign it a valid 2D unit even while depth compositing is off;
    # otherwise its default unit 0 conflicts with the 3D volume sampler.
    ui(program, 'sceneDepthTexture', 5)
    ui(program, 'sceneDepthReady', 0)
    for slot, tex in zip([6, 7], atlas_textures):
        active(0x84C0 + slot)
        bind(0x0DE1, tex)
    ui(program, 'reviewedMaskIndex', 6)
    ui(program, 'reviewedMaskPayload', 7)
    ui(program, 'reviewedMaskReady', 1)
    fn('glUniform1iv', None, [I, I, P])(
        loc(program, b'reviewedMaskOffsets[0]'), 8, offsets.ctypes.data)
    fn('glUniform3iv', None, [I, I, P])(
        loc(program, b'reviewedMaskGrids[0]'), 8, grids.ctypes.data)
    ui(program, 'lumenCleanupReady', 1)
    ui(program, 'lumenCleanupEnabled', int(mask_enabled))
    ui(program, 'lumenMaskCount', 4)
    u3(program, 'lumenFineDimensions', atlas['sourceFullDimensionsXYZ'])
    for i, f in enumerate(atlas['fields']):
        ui(program, 'lumenMaskField' + str(i), i)
        u3(program, 'lumenMaskOrigin' + str(i), f['lowerFullFineXYZ'])
        u3(program, 'lumenMaskDimensions' + str(i), f['dimensionsXYZ'])
    # Mobile has no Gentle-bound component attribute or local replacement mesh.
    for name in ['debrisCleanupEnabled', 'refinementReady', 'nativeReplacementEnabled']:
        ui(program, name, 0)


donor = next(d for d in donors if d['id'] == 'ladaf-2021-17')
surface_path = ROOT / 'public/assets/fine-surface-v19/manifest.json'
manifest = read_json(surface_path)
volume_manifest = read_json(public_path(donor['manifestUrl']))
level = volume_manifest['levels']['high']
texture(0, load_volume(level), True)
cleanup = read_json(public_path(donor['cleanupManifestUrl']))
cleanup_bytes = gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes())
texture(2, np.frombuffer(cleanup_bytes, np.uint8).reshape(cleanup['dimensions'][::-1]).copy())
views = read_json(public_path(donor['flowViewsUrl']))['presets']
checks, rows = [], []
for lod in manifest['lods']:
    assert lod['id'] in ['detail', 'balanced']
    mesh = install_mesh(mesh_arrays(manifest, lod))
    geometry_hashes = {key: hashlib.sha256(mesh[key].tobytes()).hexdigest()
                       for key in ['positions', 'normals', 'indices']}
    for view_id in ['la-inflow', 'la-outflow']:
        view = next(v for v in views if v['id'] == view_id)
        cap = verified_image(view['texture'])
        cap_hash = hashlib.sha256(cap.tobytes()).hexdigest()
        texture(1, cap, True)
        world = dict(view['world'], _cameraTarget=view['world']['target'], _cameraScale=.52)
        common = [level, cleanup, world, donor['displayWindow'], manifest['threshold'], cap.shape]
        mask_enabled = False
        before = render_mesh(mesh, common)
        mask_enabled = True
        after = render_mesh(mesh, common)
        mask_enabled = False
        restored = render_mesh(mesh, common)
        assert np.array_equal(before, restored), (lod['id'], view_id, 'off/on/off mismatch')
        changed = np.any(before != after, axis=2)
        assert changed.sum() > 50, (lod['id'], view_id, 'cleanup did not affect the LA view')
        assert hashlib.sha256(cap.tobytes()).hexdigest() == cap_hash
        assert all(hashlib.sha256(mesh[k].tobytes()).hexdigest() == h
                   for k, h in geometry_hashes.items())
        item = dict(lod=lod['id'], view=view_id, changedPixels=int(changed.sum()),
                    unchangedPixels=int((~changed).sum()), offOnOffRestoresExactly=True,
                    originalGeometryArraysUnchanged=True, measuredCapBytesUnchanged=True,
                    sourceCapSha256=cap_hash, glErrors=0)
        checks.append(item)
        print(json.dumps(item), flush=True)
        rows.append((lod['id'], view_id, before, after))
    fn('glDeleteVertexArrays', None, [I, C.POINTER(U)])(1, C.byref(mesh['vao']))
    for buffer in mesh['buffers']:
        fn('glDeleteBuffers', None, [I, C.POINTER(U)])(1, C.byref(buffer))
    del mesh
    gc.collect()

font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 20)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
sheet = Image.new('RGB', (W * 2, (H + 64) * len(rows)), '#091015')
pen = ImageDraw.Draw(sheet)
for row, (lod, view, before, after) in enumerate(rows):
    y = row * (H + 64)
    for col, (label, pixels_) in enumerate([('Previous mobile cleanup', before),
                                           ('Reviewed lumen cleanup restored', after)]):
        sheet.paste(Image.fromarray(pixels_[:, :, :3]), (col * W, y + 64))
        pen.text((col * W + 12, y + 9), label, font=font, fill='#eceade')
        pen.text((col * W + 12, y + 36),
                 f'{lod} · {view} · same mesh, measured cap, camera and source masks',
                 font=small, fill='#aec3be')
sheet.save(OUT / 'mobile-la-cleanup.jpg', quality=93)
# A separate, readable proof of the commonly selected Mobile Detail LA view.
detail_row = next(i for i, (lod, view, _, _) in enumerate(rows)
                  if lod == 'detail' and view == 'la-inflow')
sheet.crop((0, detail_row * (H + 64), W * 2,
            (detail_row + 1) * (H + 64))).save(OUT / 'mobile-la-inflow.jpg', quality=93)
report = dict(passed=True, checks=checks, outputPixels=[W, H],
              renderer=fn('glGetString', C.c_char_p, [U])(0x1F01).decode(),
              atlasManifestSha256=hashlib.sha256((atlas_path / 'manifest.json').read_bytes()).hexdigest(),
              atlasIndexSha256=hashlib.sha256(index.tobytes()).hexdigest(),
              atlasPayloadSha256=hashlib.sha256(payload.tobytes()).hexdigest(),
              runtimeHashes={f: hashlib.sha256((ROOT / 'public' / f).read_bytes()).hexdigest()
                             for f in ['fine-surface.js', 'renderer.js', 'reviewed-mask-atlas.js']},
              surfaceManifestSha256=hashlib.sha256(surface_path.read_bytes()).hexdigest(),
              scope='Actual smaller HFM meshes and verified measured LA caps, production shaders and '
                    'production-loader atlas in native EGL. Same-camera off/on/off display check; '
                    'no geometry or source-pixel edits. Not physical iOS testing or a memory/FPS measurement.')
(OUT / 'mobile-lumen-native.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(dict(passed=True, cases=len(checks))), flush=True)
