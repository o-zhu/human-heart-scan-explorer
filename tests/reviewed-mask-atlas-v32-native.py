"""Check production reviewed-mask sampling on native EGL against original masks.

No browser automation, mesh decode, or anatomical inference. The builder proves
all-byte storage equivalence; this independently checks actual integer-index and
normalized-byte GPU texture sampling, including the production world transforms.
"""
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
if '--output' not in sys.argv:
    sys.argv += ['--output', str(ROOT / 'docs/verified-model-v32')]
started = time.monotonic()
base = ROOT / 'tests/brightness-v12-render.py'
exec(compile(base.read_text().split('profiles = ')[0], str(base), 'exec'))

manifest_path = ROOT / 'public/assets/reviewed-mask-v32/manifest.json'
manifest = read_json(manifest_path)
proof_path = ROOT / 'docs/verified-model-v32/mask-atlas.json'
proof = read_json(proof_path)
assert proof['passed'] and proof['mismatchedBytes'] == 0
assert proof['manifest']['sha256'] == hashlib.sha256(manifest_path.read_bytes()).hexdigest()
asset = manifest['asset']
packed = public_path(asset['url']).read_bytes()
assert len(packed) == asset['compressedBytes']
assert hashlib.sha256(packed).hexdigest() == asset['sha256']
decoded = gzip.decompress(packed)
assert len(decoded) == asset['decodedBytes']
assert hashlib.sha256(decoded).hexdigest() == asset['decodedSha256']
index_meta, payload_meta = manifest['indexTexture'], manifest['payloadTexture']
index_data = np.frombuffer(decoded, '<u4', count=index_meta['byteLength']//4,
                           offset=index_meta['offset']).copy()
payload_data = np.frombuffer(decoded, np.uint8, count=payload_meta['byteLength'],
                             offset=payload_meta['offset']).copy()
brick_bytes = payload_data[:payload_meta['brickCount']*512].reshape(-1, 512)
first_nonzero = np.argmax(brick_bytes != 0, axis=1)
assert np.all(brick_bytes[np.arange(len(brick_bytes)), first_nonzero] != 0)
global_references = np.bincount(index_data[:index_meta['entryCount']],
                               minlength=payload_meta['brickCount']+1)

# The shared helper already compiles the full production volume/composite pair.
# Compile the genuine mesh vertex + fragment pair as well, without loading mesh data.
fine = node('import {fineSurfaceShaderSources} from "./public/fine-surface.js";'
            'console.log(JSON.stringify(fineSurfaceShaderSources));')
original_vertex = sources['vertex']
sources['vertex'] = fine['vertex']
fine_program = compile_program(fine['fragment'])
sources['vertex'] = original_vertex

fixture = sources['volume'].split('void main(){')[0] + '''
uniform highp sampler2D testSamples;
uniform int testField,testPath;
uniform vec3 testDimensions,testOffset,testOrigin;
void main(){
 vec3 q=texelFetch(testSamples,ivec2(gl_FragCoord.xy),0).xyz+testOffset;
 float exact=reviewedMaskAt(testField,q,testDimensions);
 vec3 p=fromTex((q+testOrigin)/vec3(1896.,1896.,2116.));
 float routed=testPath==1?lumenExcluded(p):localRefinementExcluded(p);
 fragColor=vec4(exact,routed,0.,1.);
}
'''
program = compile_program(fixture)
gl_error = fn('glGetError', U, [])
gl_string = fn('glGetString', C.c_char_p, [U])
context_info = {name: gl_string(key).decode() for name, key in
                [('vendor', 0x1F00), ('renderer', 0x1F01), ('version', 0x1F02),
                 ('shadingLanguageVersion', 0x8B8C)]}

extra_textures = []
def upload_2d(slot, internal, width, height, format_, type_, data):
    while len(extra_textures) <= slot-6:
        tex = U()
        fn('glGenTextures', None, [I, C.POINTER(U)])(1, C.byref(tex))
        extra_textures.append(tex)
    active(0x84C0+slot)
    bind(0x0DE1, extra_textures[slot-6])
    for key, value in [(0x2801, 0x2600), (0x2800, 0x2600),
                       (0x2802, 0x812F), (0x2803, 0x812F)]:
        param(0x0DE1, key, value)
    t2(0x0DE1, 0, internal, width, height, 0, format_, type_, data.ctypes.data)
    assert gl_error() == 0, ('texture upload', slot)

# Exactly the production units, dimensions, formats, filtering, and alignment.
upload_2d(6, 0x8236, index_meta['width'], index_meta['height'],
          0x8D94, 0x1405, index_data)  # R32UI / RED_INTEGER / UNSIGNED_INT
upload_2d(7, 0x8058, payload_meta['width'], payload_meta['height'],
          0x1908, 0x1401, payload_data)  # RGBA8 / RGBA / UNSIGNED_BYTE
offsets = np.asarray([f['indexOffset'] for f in manifest['fields']], np.int32)
grids = np.asarray([f['brickGridXYZ'] for f in manifest['fields']], np.int32)
dimensions_full = np.asarray(manifest['sourceFullDimensionsXYZ'])
rng = np.random.default_rng(20261107)
field_checks = []
guards = []
total_queries = 0

def original_bits(data, dims, q):
    """Independent direct X-bit lookup in the verified source, no atlas logic."""
    valid = np.all((q >= -.5) & (q < dims-.5), axis=1)
    answer = np.zeros(len(q), np.uint8)
    cells = np.floor(q[valid]+np.float32(.5)).astype(np.int64)
    x, y, z = cells.T
    answer[valid] = ((data[z, y, x//8] >> (x % 8)) & 1)*255
    return answer

def draw_queries(field_index, f, q, offset=0., ready=1, route=True):
    width = 1024
    height = (len(q)+width-1)//width
    samples = np.zeros((height*width, 4), np.float32)
    samples[:len(q), :3] = q
    upload_2d(8, 0x8814, width, height, 0x1908, 0x1406, samples)  # RGBA32F
    target(program, width, height)
    ui(program, 'testSamples', 8)
    ui(program, 'reviewedMaskIndex', 6)
    ui(program, 'reviewedMaskPayload', 7)
    ui(program, 'reviewedMaskReady', ready)
    fn('glUniform1iv', None, [I, I, P])(loc(program, b'reviewedMaskOffsets[0]'), 8, offsets.ctypes.data)
    fn('glUniform3iv', None, [I, I, P])(loc(program, b'reviewedMaskGrids[0]'), 8, grids.ctypes.data)
    ui(program, 'testField', field_index)
    u3(program, 'testDimensions', f['dimensionsXYZ'])
    u3(program, 'testOffset', [offset]*3)
    u3(program, 'testOrigin', f['lowerFullFineXYZ'])
    u3(program, 'extent', manifest['extent'])
    u3(program, 'lumenFineDimensions', dimensions_full)
    for prefix in ['lumenMask', 'refinement']:
        ui(program, prefix+'Field0', field_index)
        u3(program, prefix+'Origin0', f['lowerFullFineXYZ'])
        u3(program, prefix+'Dimensions0', f['dimensionsXYZ'])
    ui(program, 'lumenCleanupReady', 1)
    ui(program, 'lumenCleanupEnabled', 1)
    ui(program, 'lumenMaskCount', 1)
    ui(program, 'refinementReady', 1)
    ui(program, 'refinementCount', 1)
    ui(program, 'testPath', 1 if f['kind'] == 'lumen' else 2)
    # pixels() returns image coordinates; invert that for gl_FragCoord ordering.
    return pixels(width, height)[::-1].reshape(-1, 4)[:len(q), :2 if route else 1]

def byte_points(flat, storage):
    z, y, x = np.unravel_index(flat, tuple(storage[::-1]))
    p = np.column_stack([x*8, y, z])
    p = np.repeat(p, 8, axis=0)
    p[:, 0] += np.tile(np.arange(8), len(flat))
    return p

for field_index, f in enumerate(manifest['fields']):
    dims = np.asarray(f['dimensionsXYZ'], np.int64)
    storage = np.asarray(f['storageDimensionsXYZ'], np.int64)
    grid = np.asarray(f['brickGridXYZ'], np.int64)
    source_packed = public_path(f['sourceUrl']).read_bytes()
    assert len(source_packed) == f['sourceCompressedBytes']
    assert hashlib.sha256(source_packed).hexdigest() == f['sourceCompressedSha256']
    source_bytes = gzip.decompress(source_packed)
    assert len(source_bytes) == f['sourceDecodedBytes']
    assert hashlib.sha256(source_bytes).hexdigest() == f['sourceDecodedSha256']
    source = np.frombuffer(source_bytes, np.uint8).reshape(tuple(storage[::-1]))
    count = int(np.prod(grid))
    ids = index_data[f['indexOffset']:f['indexOffset']+count]
    z, y, x = np.unravel_index(np.arange(count), tuple(grid[::-1]))
    brick_positions = np.column_stack([x, y, z])
    local = np.where(ids > 0, first_nonzero[np.maximum(ids.astype(np.int64)-1, 0)], 0)
    local_positions = np.column_stack([local % 8, (local//8) % 8, local//64])
    stored = brick_positions*8 + local_positions
    stored = np.minimum(stored, storage-1)
    all_bricks = np.repeat(stored*np.array([8, 1, 1]), 8, axis=0)
    all_bricks[:, 0] += np.tile(np.arange(8), count)

    # Known mixed bytes ensure real mask boundaries and both bit values, rather
    # than a mostly-zero spatial sample; include adjacent packed-byte boundaries.
    mixed = np.flatnonzero((source.ravel() != 0) & (source.ravel() != 255))
    picked = rng.choice(mixed, min(1024, len(mixed)), replace=False)
    adjacent = np.unique(np.clip(np.concatenate([picked-1, picked, picked+1]), 0, source.size-1))
    edges = byte_points(adjacent, storage)
    random = rng.integers(0, dims, size=(4096, 3))

    # First/last source cells on every face, plus all bounding-box corners.
    faces = []
    for axis in range(3):
        for side in [0, dims[axis]-1]:
            points = rng.integers(0, dims, size=(128, 3))
            points[:, axis] = side
            faces.append(points)
    corners = np.array([[a, b, c] for a in [0, dims[0]-1]
                        for b in [0, dims[1]-1] for c in [0, dims[2]-1]])

    # Exercise original packed-byte / atlas-brick transitions at both sides.
    brick_edges = []
    for axis, step in enumerate([64, 8, 8]):
        for side in [-1, 0]:
            points = rng.integers(0, dims, size=(512, 3))
            points[:, axis] = np.clip((points[:, axis]//step)*step+side, 0, dims[axis]-1)
            brick_edges.append(points)

    # RGBA8 row boundaries: each 8192-byte texture row holds 16 bricks. Include
    # all four channel offsets on the two sides, for every referenced edge brick.
    payload_edges = []
    for remainder, local_bytes in [(1, range(4)), (0, range(508, 512))]:
        selected = np.flatnonzero((ids > 0) & (ids % 16 == remainder))
        for local_byte in local_bytes:
            stored_edge = brick_positions[selected]*8 + np.array(
                [local_byte % 8, (local_byte//8) % 8, local_byte//64])
            p = np.repeat(stored_edge*np.array([8, 1, 1]), 8, axis=0)
            p[:, 0] += np.tile(np.arange(8), len(selected))
            payload_edges.append(p)
    cases = np.concatenate([all_bricks, edges, random, corners, *faces,
                            *brick_edges, *payload_edges]).astype(np.float32)
    checks = []
    for offset in [-.499, 0., .499]:
        q = cases + np.float32(offset)
        expected = original_bits(source, dims, q)
        actual = draw_queries(field_index, f, cases, offset)
        difference = actual != expected[:, None]
        if np.any(difference):
            first = np.flatnonzero(np.any(difference, axis=1))[:8]
            raise AssertionError((f['id'], offset, first.tolist(), q[first].tolist(),
                                  actual[first].tolist(), expected[first].tolist()))
        total_queries += len(cases)*2
        checks.append(dict(offsetXYZ=[offset]*3, queries=len(cases),
                           directMismatches=0, productionWorldPathMismatches=0,
                           expectedOneCount=int(np.count_nonzero(expected))))

    # Exact half-cell bounds are direct helper tests: world->texture floating
    # round trips have their own +/-0.499 coverage above, away from tie rounding.
    boundary = []
    for axis in range(3):
        for value in [-1., -.501, -.5, -.499, dims[axis]-.501,
                      dims[axis]-.5, dims[axis]-.499, float(dims[axis])]:
            p = rng.integers(0, dims, size=(64, 3)).astype(np.float32)
            p[:, axis] = value
            boundary.append(p)
    boundary = np.concatenate(boundary)
    expected = original_bits(source, dims, boundary)
    actual = draw_queries(field_index, f, boundary, route=False)[:, 0]
    assert np.array_equal(actual, expected), (f['id'], 'half-cell bounds')
    total_queries += len(boundary)
    zero_count = int(np.count_nonzero(ids == 0))
    duplicate_count = int(np.count_nonzero((ids > 0) & (global_references[ids] > 1)))
    index_row_edges = int(np.count_nonzero(np.isin(
        (f['indexOffset']+np.arange(count)) % index_meta['width'], [0, index_meta['width']-1])))
    assert zero_count and duplicate_count and all(c['expectedOneCount'] > 0 for c in checks)
    field_checks.append(dict(id=f['id'], sourceDecodedSha256=f['sourceDecodedSha256'],
        logicalBrickReferences=count, zeroSentinelReferences=zero_count,
        globallyDeduplicatedReferences=duplicate_count, allBitPositions=list(range(8)),
        indexTextureRowBoundaryReferences=index_row_edges,
        payloadTextureRowBoundaryQueries=sum(len(p) for p in payload_edges),
        packedMaskAndByteEdgeQueries=len(edges), sourceBoundingFaceQueries=768,
        brickEdgeQueries=3072, halfCellBoundaryQueries=len(boundary), checks=checks,
        mismatches=0))

    # Disabled readiness and invalid field indices must not sample neighboring
    # metadata or undefined texture data, including at known positive positions.
    guard_points = cases[:min(len(cases), 16384)]
    for invalid, ready, label in [(field_index, 0, 'not-ready'), (-1, 1, 'negative-field'),
                                  (8, 1, 'field-after-last')]:
        actual = draw_queries(invalid, f, guard_points, ready=ready)
        assert not actual.any(), (f['id'], label)
        total_queries += actual.size
        guards.append(dict(field=f['id'], guard=label, queries=len(guard_points),
                           directMismatches=0, productionWorldPathMismatches=0))
    print(f"{f['id']}: {len(cases):,} positions x 3 offsets, exact direct + world-path results", flush=True)

report = dict(schema='heart-reviewed-mask-gpu-validation-v32', version=1, passed=True,
    test='tests/reviewed-mask-atlas-v32-native.py',
    testSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    environment=context_info, elapsedSeconds=round(time.monotonic()-started, 3),
    productionShadersCompiled=['volume vertex/fragment', 'composite vertex/fragment',
                               'fine-surface mesh vertex/fragment'],
    shaderSha256={name: hashlib.sha256(text.encode()).hexdigest() for name, text in
        [('volume', sources['volume']), ('composite', sources['composite']),
         ('fineSurfaceVertex', fine['vertex']), ('fineSurfaceFragment', fine['fragment']),
         ('samplingFixture', fixture)]},
    atlas=dict(compressedSha256=asset['sha256'], decodedSha256=asset['decodedSha256'],
               indexTexture=index_meta, payloadTexture=payload_meta,
               productionBindings=dict(indexUnit=6, payloadUnit=7),
               textureBytes=index_meta['byteLength']+payload_meta['byteLength']),
    originalMaskSourceBytesVerified=sum(f['sourceDecodedBytes'] for f in manifest['fields']),
    allByteBuilderProof=dict(path=str(proof_path.relative_to(ROOT)),
                             sha256=hashlib.sha256(proof_path.read_bytes()).hexdigest(),
                             sourceBytesCompared=proof['sourceBytesCompared'], mismatchedBytes=0),
    comparisons=total_queries, mismatches=0, fields=field_checks, guards=guards,
    scope='Native EGL executes production GLSL and checks sampled logical mask bits against original verified packed source masks. All original mask bytes are separately proven by the linked builder report. No mesh is decoded or changed.',
    limits='Software EGL correctness check, not browser/device performance, full mesh rendering, or new anatomical validation. Exact half-cell ties are checked directly; production world-coordinate paths use offsets -0.499, 0, +0.499.')
destination = OUT / 'gpu-validation.json'
destination.write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(dict(passed=True, comparisons=total_queries, mismatches=0,
                      report=str(destination), elapsedSeconds=report['elapsedSeconds'])))
