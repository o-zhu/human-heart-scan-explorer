"""Bounded independent checks of the offline review triangle rejection.

Uses homogeneous polygon clipping as an independent oracle and a sampled,
checksum-verified shipped mesh. This does not initialize EGL or alter assets.
"""
from pathlib import Path
import gzip, hashlib, importlib.util, json, resource, struct
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/cleanup-v28/review_geometry.py'
spec = importlib.util.spec_from_file_location('review_geometry', SCRIPT)
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)
CASES = json.loads((ROOT / 'scripts/cleanup-v28/review-cameras.json').read_text())
META = json.loads((ROOT / 'public/assets/ultra-volume-v7.json').read_text())
WIDTH, HEIGHT = 720, 840


def source_world(point):
    center = (np.array(META['fullDimensionsXYZ']) - 1) / 2
    point = (np.asarray(point) - center) * (META['sourceSpacingUm'] / 1000) / META['longestMm']
    return point[[0, 2, 1]] * [1, 1, -1]


def production_camera(case):
    axis = case['axis']
    normal = np.array([[1., 0, 0], [0, 0, -1.], [0, 1., 0]][axis])
    planar_right = np.array([[0, 0, -1.], [1., 0, 0], [1., 0, 0]][axis])
    planar_up = np.array([[0, -1., 0], [0, -1., 0], [0, 0, 1.]][axis])
    direction = np.array(case.get('direction', normal + .08 * planar_right + .025 * planar_up))
    direction /= np.linalg.norm(direction)
    target = source_world(case['target'])
    eye = target + direction * case['distance']
    forward = target - eye; forward /= np.linalg.norm(forward)
    right = np.cross(forward, planar_up); right /= np.linalg.norm(right)
    up = np.cross(right, forward); up /= np.linalg.norm(up)
    center = (np.array(META['fullDimensionsXYZ']) - 1) / 2
    center[axis] = case['coordinate']
    return dict(eye=eye, forward=forward, right=right, up=up,
                normal=normal, center=source_world(center))


def gpu_clip_vertices(arrays, indices, view, interpolation):
    """Float32 implementation of the production vertex shader, not the culler."""
    lo = np.asarray(arrays['bounds']['min'], np.float32)
    hi = np.asarray(arrays['bounds']['max'], np.float32)
    q = arrays['positions'][indices].astype(np.float32) / np.float32(65535)
    points = lo + q * (hi - lo) if interpolation == 'subtract' else lo * (1-q) + hi * q
    d = points - np.asarray(view['eye'], np.float32)
    depth = d @ np.asarray(view['forward'], np.float32)
    fov = np.float32(.32); aspect = np.float32(WIDTH / HEIGHT)
    near = np.float32(.01); far = np.float32(10)
    x = (d @ np.asarray(view['right'], np.float32)) / (fov * aspect)
    y = (d @ np.asarray(view['up'], np.float32)) / fov
    z = ((far + near) / (far - near)) * depth - 2 * far * near / (far - near)
    normal = np.asarray(view['normal'], np.float32)
    plane_distance = np.float32(np.dot(view['normal'], view['center']))
    cut = plane_distance - points @ normal
    return np.stack([x, y, z, depth, cut], axis=-1).astype(np.float64)


def polygon_survives(vertices, cut):
    """Sutherland–Hodgman clipping in homogeneous coordinates.

    A retained polygon may be degenerate; treating that as visible makes the
    oracle more conservative. The production cut is affine in world position.
    """
    polygon = list(vertices)
    planes = [(0, 1), (0, -1), (1, 1), (1, -1), (2, 1), (2, -1)]
    if cut: planes.append((4, 1))
    for component, sign in planes:
        if not polygon: return False
        out = []
        previous = polygon[-1]
        a = previous[4] if component == 4 else previous[3] + sign * previous[component]
        for current in polygon:
            b = current[4] if component == 4 else current[3] + sign * current[component]
            if (a >= 0) != (b >= 0): out.append(previous + (current-previous) * (a/(a-b)))
            if b >= 0: out.append(current)
            previous, a = current, b
        polygon = out
    return bool(polygon)


def check(arrays, case):
    old_indices = arrays['indices'].copy()
    attribute_hashes = {k: hashlib.sha256(arrays[k].tobytes()).hexdigest() for k in ['positions', 'normals']}
    result, receipt = review.cull_review_triangles(arrays, case, WIDTH, HEIGHT)
    for key, digest in attribute_hashes.items():
        assert result[key] is arrays[key]
        assert hashlib.sha256(arrays[key].tobytes()).hexdigest() == digest
    assert np.array_equal(arrays['indices'], old_indices)
    assert result['bounds'] is arrays['bounds']
    faces = old_indices.reshape(-1, 3)
    retained = {tuple(face) for face in result['indices'].reshape(-1, 3)}
    retained_mask = np.array([tuple(face) in retained for face in faces])
    assert np.array_equal(faces[retained_mask].ravel(), result['indices']), 'Retained corner/draw ordering changed'
    view = production_camera(case)
    for interpolation in ['subtract', 'weighted']:
        clip = gpu_clip_vertices(arrays, faces[~retained_mask], view, interpolation)
        for triangle in clip:
            assert not polygon_survives(triangle, not case.get('whole', False)), (case['id'], 'Visible triangle removed', triangle)
    return receipt


def encode(points):
    points = np.asarray(points, float)
    lo, hi = points.min(axis=0)-1e-7, points.max(axis=0)+1e-7
    return dict(positions=np.rint((points-lo)/(hi-lo)*65535).astype('<u2'),
                normals=np.tile(np.array([32767, 0, 0], '<i2'), (len(points), 1)),
                indices=np.arange(len(points), dtype='<u4'),
                bounds=dict(min=lo.tolist(), max=hi.tolist()),
                indexCount=len(points), vertexCount=len(points))


camera_errors = []
for case in CASES:
    expected, actual = production_camera(case), review.camera(case)
    error = max(float(np.max(np.abs(expected[k]-actual[k]))) for k in expected)
    assert error < 1e-14
    camera_errors.append(dict(case=case['id'], maximumAbsoluteBasisOrPositionError=error))

# A triangle can have no vertex inside the viewport yet cover its center.
# These cases explicitly protect that distinction and the retained cut side.
test_case = {**CASES[0], 'whole': True}
v = production_camera(test_case)
def from_camera(points):
    return np.asarray(v['eye']) + np.asarray(points) @ np.stack([v['right'], v['up'], v['forward']])
edge_cases = [
    ('all-vertices-outside-different-planes', [[-1, -1, 1], [1, -1, 1], [0, 1, 1]], True),
    ('crosses-near-plane', [[-.001, -.001, .009], [.001, -.001, .011], [0, .001, .011]], True),
    ('outside-near-plane', [[-.001, -.001, .005], [.001, -.001, .005], [0, .001, .005]], False),
    ('outside-far-plane', [[-.1, -.1, 11], [.1, -.1, 11], [0, .1, 11]], False),
    ('outside-right-plane', [[.6, -.01, 1], [.7, -.01, 1], [.6, .01, 1]], False),
    ('crosses-right-plane', [[.20, -.01, 1], [.4, -.01, 1], [.20, .01, 1]], True),
]
edge_receipts = []
for name, points, keep in edge_cases:
    receipt = check(encode(from_camera(points)), {**test_case, 'id': name})
    assert (receipt['submittedTriangles'] == 1) == keep
    edge_receipts.append(dict(case=name, retained=keep))

for offset, keep, name in [(0, True, 'crosses-cut'), (.01, False, 'fully-cut'), (-.01, True, 'retained-cut-side')]:
    c = CASES[0]; v = production_camera(c)
    center = v['center'] + v['normal'] * offset
    points = [center+v['right']*.002-v['normal']*.001, center-v['right']*.002, center+v['up']*.002+v['normal']*.001]
    receipt = check(encode(points), {**c, 'id': name})
    assert (receipt['submittedTriangles'] == 1) == keep
    edge_receipts.append(dict(case=name, retained=keep))

# Read only the small existing balanced HFM asset, never the full Gentle mesh.
manifest = json.loads((ROOT / 'public/assets/fine-surface-v19/manifest.json').read_text())
lod = next(x for x in manifest['lods'] if x['id'] == 'balanced')
encoded = (ROOT / 'public' / lod['url'].removeprefix('./')).read_bytes()
assert hashlib.sha256(encoded).hexdigest() == lod['sha256']
raw = gzip.decompress(encoded); del encoded
assert hashlib.sha256(raw).hexdigest() == lod['decodedSha256']
magic, version, count, index_count, p, n, i, reserved = struct.unpack_from('<8I', raw)
assert (magic, version, reserved) == (0x314d4648, 1, 0)
full_faces = np.frombuffer(raw, '<u4', index_count, i).reshape(-1, 3)
sample = np.linspace(0, len(full_faces)-1, 2400, dtype=int)
arrays = dict(positions=np.frombuffer(raw, '<u2', count*3, p).reshape(count, 3),
              normals=np.frombuffer(raw, '<i2', count*3, n).reshape(count, 3),
              indices=full_faces[sample].copy().ravel(), bounds=lod.get('bounds', manifest['bounds']),
              vertexCount=count, indexCount=len(sample)*3)
mesh_checks = [check(arrays, case) for case in CASES]

# Compare only new nested outputs that have a culling receipt; the old top-level
# final-review PNGs were created by the earlier full-geometry harness.
parity = []
image_root = Path('/workspace/data/cleanup-v28')
for case_id, baseline_folder in [('lvot-y262', 'left-review'), ('la-y316', 'left-review'), ('inlet-x313', 'inlet-candidate')]:
    before = image_root / baseline_folder / (case_id+'-v27.png')
    after = image_root / 'final-review' / case_id / (case_id+'-v27.png')
    receipt_path = ROOT / 'docs/cleanup-v28/final-review' / case_id / 'validation.json'
    if not (before.exists() and after.exists() and receipt_path.exists()):
        parity.append(dict(case=case_id, status='Awaiting completed culled render'))
        continue
    render_receipt = json.loads(receipt_path.read_text())
    assert render_receipt.get('reviewCulling')
    a, b = np.asarray(Image.open(before)), np.asarray(Image.open(after))
    assert np.array_equal(a, b), (case_id, 'Culled image differs from full-geometry baseline')
    parity.append(dict(case=case_id, status='Exact decoded RGBA equality', rawSha256=hashlib.sha256(a.tobytes()).hexdigest()))

report = dict(scriptSha256=hashlib.sha256(SCRIPT.read_bytes()).hexdigest(), width=WIDTH, height=HEIGHT,
              scope='Independent float32 homogeneous polygon-clipping oracle, shipped quantized geometry sample and exact attribute/order checks. No new GL run in this test.',
              cameraChecks=camera_errors, edgeCases=edge_receipts,
              sampleSource=dict(url=lod['url'], sha256=lod['sha256'], decodedSha256=lod['decodedSha256'], trianglesPerCamera=len(sample)),
              meshChecks=mesh_checks, pixelParity=parity,
              maximumResidentBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024)
out = ROOT / 'docs/cleanup-v28/review-geometry-validation.json'
out.write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(dict(cameraCount=len(CASES), edgeCases=len(edge_cases)+3,
                     realTriangleChecks=len(CASES)*len(sample)*2,
                     maximumResidentBytes=report['maximumResidentBytes'], pixelParity=parity)))
