"""Real prepared-model graphics check for bounded indexed draws.

Native EGL, not browser automation. Uses the production shaders and the exact
draw ranges returned by the JavaScript helper. The rejected-draw image omits
only the oversized base draw, reproducing Firefox's documented 30M guard.
"""
from pathlib import Path
import sys, os, struct, time

ROOT = Path(__file__).resolve().parents[1]
if '--output' not in sys.argv:
    sys.argv += ['--output', str(ROOT/'docs/firefox-tee-v37/native')]
fixture = ROOT/'tests/reconstruction-detail-v35-native.py'
setup = fixture.read_text().split('checks=[];source_checks=[];scalar_ladaf=None;common_ladaf=None')[0]
setup = setup.replace('W, H, VW, VH = 2400, 1600, 1500, 1000',
                      'W, H, VW, VH = 720, 720, 180, 180')
exec(compile(setup, str(fixture), 'exec'))

started = time.monotonic()
current_donor = 'ladaf-2021-17'
donor = next(d for d in donors if d['id'] == current_donor)
volume_manifest = read_json(public_path(donor['manifestUrl']))
level = volume_manifest['levels']['high']
texture(0, load_volume(level), True)
cleanup = read_json(public_path(donor['cleanupManifestUrl']))
texture(2, np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()), np.uint8)
        .reshape(*cleanup['dimensions'][::-1]).copy())
world = dict(normal=[0,0,1], right=[1,0,0], up=[0,1,0], center=[0,0,0], width=1, height=1)
common = [level, cleanup, world, donor['displayWindow'], .28, (1,1)]
manifest = read_json(ROOT/'public/assets/display-compact-v29/surface-manifest.json')
lod = manifest['lods'][0]
mesh_path = Path(os.environ.get('HEART_VERIFIED_COMPACT_MESH',
    '/workspace/data/heart-v29-compress/mesh-compact-consolidated-decoded.hfm'))
digest = hashlib.sha256()
with mesh_path.open('rb') as stream:
    for block in iter(lambda: stream.read(1024*1024), b''): digest.update(block)
assert mesh_path.stat().st_size == lod['decodedBytes'] and digest.hexdigest() == lod['decodedSha256']

def arrays(raw, bounds):
    magic, version, vertices, count, p, n, i, reserved = struct.unpack_from('<8I', raw)
    assert magic == 0x314d4648 and version == 1 and reserved == 0
    return dict(positions=np.frombuffer(raw,'<u2',vertices*3,p).reshape(vertices,3),
                normals=np.frombuffer(raw,'<i2',vertices*3,n).reshape(vertices,3),
                indices=np.frombuffer(raw,'<u4',count,i), bounds=bounds,
                vertexCount=vertices, indexCount=count)

base = arrays(np.memmap(mesh_path,np.uint8,mode='r'), manifest['bounds'])
assert base['indexCount'] == 70_856_055
debris = read_json(ROOT/'public/assets/cleanup-v26/debris-manifest.json')['profiles'][0]['vertexFlags']
packed = public_path(debris['url']).read_bytes()
assert hashlib.sha256(packed).hexdigest() == debris['sha256']
flags = gzip.decompress(packed)
assert hashlib.sha256(flags).hexdigest() == debris['decodedSha256']
base['flags'] = np.frombuffer(flags,np.uint8)
pieces = []
for entry in patch_manifest['patches']:
    s = entry['surface']; packed = public_path(s['url']).read_bytes()
    assert hashlib.sha256(packed).hexdigest() == s['sha256']
    raw = gzip.decompress(packed)
    assert len(raw) == s['decodedBytes'] and hashlib.sha256(raw).hexdigest() == s['decodedSha256']
    piece = arrays(raw,s['bounds']); piece['flags'] = np.zeros(piece['vertexCount'],np.uint8)
    pieces.append(piece)

counts = [base['indexCount'], *[p['indexCount'] for p in pieces]]
plans = node('import {drawIndexedTriangles} from "./public/mesh-draw.js";'
    'console.log(JSON.stringify('+json.dumps(counts)+'.map(n=>{const calls=[];'
    'drawIndexedTriangles({TRIANGLES:4,UNSIGNED_INT:5125,drawElements:(m,c,t,o)=>calls.push([c,o])},n);return calls;})));')
assert all(sum(c for c,o in plan) == count for plan,count in zip(plans,counts))
assert max(c for plan in plans for c,o in plan) == 3_000_000

def install(item):
    mesh = install_mesh(item); bind_vao(mesh['vao'])
    flag = U(); fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(flag))
    bind_buffer(0x8892,flag); buffer_data(0x8892,item['flags'].nbytes,item['flags'].ctypes.data,0x88E4)
    enable_attribute(2); vertex_pointer(2,1,0x1401,1,0,None)
    mesh['flagBuffer'] = flag
    return mesh

meshes = [install(base), *[install(p) for p in pieces]]
out = depth_output(720,720)
# The historical fixture allocates render targets on texture unit 6. Restore
# the real production atlas bindings before sampling the reviewed masks.
for texture_unit,tex in zip([6,7],extra_textures): active(0x84C0+texture_unit); bind(0x0DE1,tex)
prepared = True

def draw_piece(mesh,plan):
    u3(mesh_program,'boundsMin',mesh['bounds']['min']); u3(mesh_program,'boundsMax',mesh['bounds']['max'])
    bind_vao(mesh['vao'])
    for count,offset in plan:
        draw_elements(4,count,0x1405,C.c_void_p(offset))
        # Bound the software driver's transient transformed geometry in QA.
        fn('glFinish',None,[])()
    assert fn('glGetError',U,[])() == 0

def render(include_base,subdivide=False):
    quad(); bind_fbo(0x8D40,out['framebuffer']); viewport(0,0,720,720)
    disable(0x0B71); use(background_program)
    u2(background_program,'resolution',[720,720]); ui(background_program,'palette',4); draw_arrays(4,0,3)
    enable(0x0B71); fn('glDepthFunc',None,[U])(0x0203)
    fn('glClearDepthf',None,[F])(1.); fn('glClear',None,[U])(0x0100)
    configure(mesh_program,out,*common,clipped=False,ready=0,skip=1)
    if include_base:
        plan=plans[0] if not subdivide else [(min(300000,base['indexCount']-i),i*4) for i in range(0,base['indexCount'],300000)]
        draw_piece(meshes[0],plan)
    ui(mesh_program,'refinementPatchPass',1); ui(mesh_program,'debrisCleanupEnabled',0)
    for index,(mesh,plan) in enumerate(zip(meshes[1:],plans[1:])):
        ui(mesh_program,'refinementPatchIndex',index); draw_piece(mesh,plan)
    quad(); disable(0x0B71)
    return read_target(out)

missing = render(False)
Image.fromarray(missing).save(OUT/'rejected-base-draw.png')
print(json.dumps({'stage':'rejected-base-draw','elapsedSeconds':time.monotonic()-started}),flush=True)
complete = render(True)
Image.fromarray(complete).save(OUT/'complete-batched-model.png')
print(json.dumps({'stage':'complete-batched-model','elapsedSeconds':time.monotonic()-started}),flush=True)
reference = render(True,True)
assert np.array_equal(complete,reference), 'Changing submission boundaries must preserve the exact rendered pixels.'
changed = int(np.any(complete!=missing,axis=2).sum())
assert changed > 5000, 'The rejected base must produce a materially incomplete image.'
report = dict(passed=True, baseIndices=base['indexCount'], baseTriangles=base['indexCount']//3,
    baseDrawCalls=len(plans[0]), maximumIndicesPerDraw=3_000_000, patchIndices=counts[1:],
    exactPixelsAgainstSmallerBatches=True, missingBaseChangedPixels=changed,
    decodedSha256=lod['decodedSha256'], sourceGeometrySha256=lod['sourceDecodedSha256'],
    shaderSha256=hashlib.sha256(json.dumps(fine_sources,sort_keys=True).encode()).hexdigest(),
    elapsedSeconds=time.monotonic()-started,
    driver=fn('glGetString',C.c_char_p,[U])(0x1F01).decode(),
    scope='Native EGL with actual source geometry, flags, four patches, reviewed atlas and production shaders. Exact production JavaScript draw ranges; omitted base draw models the documented Firefox rejection. Not a Firefox screenshot, browser latency test or clinical validation.')
(OUT/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
