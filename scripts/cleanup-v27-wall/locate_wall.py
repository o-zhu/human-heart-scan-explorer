#!/usr/bin/env python3
"""Read-only production-camera diagnosis of the reported v27 wall defect.

Original geometry and the frozen v25/v26 display assets are compared. A separate
float target reports the first visible mesh coordinate and uncut component ID.
The diagnostic never changes source pixels, meshes, masks or production code.
"""
from pathlib import Path
import ctypes
import json
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
DATA = Path('/workspace/data/cleanup-v27-wall')
DOCS = ROOT/'docs/cleanup-v27-wall'
DATA.mkdir(parents=True, exist_ok=True)
DOCS.mkdir(parents=True, exist_ok=True)
repair_all = '--repair-all' in sys.argv
repair = '--repair' in sys.argv or repair_all
requested = [x for x in sys.argv[1:] if x not in ('--repair','--repair-all')]
prefix = (ROOT/'scripts/cleanup-v26/render_review.py').read_text().split('fine=FineSource')[0]
prefix = prefix.replace("for key in ('positions','normals','indices','_rawOwner'):mesh.pop(key,None)\narrays.clear();del arrays;gc.collect()", '')
sys.argv = [sys.argv[0], '--output', str(DOCS), '--lossless-output', str(DATA)]
exec(compile(prefix, str(ROOT/'scripts/cleanup-v26/render_review.py'), 'exec'))

fine = FineSource(cache_bricks=16)
meta = fine.meta
extent = manifest['extent']
if repair:
    from importlib.util import spec_from_file_location, module_from_spec
    spec=spec_from_file_location('wall_restore',ROOT/'scripts/cleanup-v27-wall/restore_wall.py')
    restoration=module_from_spec(spec);spec.loader.exec_module(restoration)
    repair_lo,repair_hi,repair_bits,repair_report=(restoration.restore_all_selections(fine) if repair_all else restoration.restore_selection(fine))
    atrial=next(i for i in collections['v26']['manifest']['masks'] if i['id']=='atrial')
    original_atrial=np.frombuffer(gzip.decompress(public_path(atrial['url']).read_bytes()),np.uint8).reshape(atrial['storageDimensionsXYZ'][::-1]).copy()
    logical=np.unpackbits(original_atrial,axis=2,bitorder='little')[:,:,:atrial['dimensionsXYZ'][0]].astype(bool)
    origin=np.array(atrial['lowerFullFineXYZ'])
    slices=tuple(slice(int(a),int(b)) for a,b in zip((repair_lo-origin)[::-1],(repair_hi-origin)[::-1]))
    logical[slices]&=~repair_bits
    repaired_atrial=np.packbits(logical,axis=2,bitorder='little')
    del logical

def use_repair(enabled):
    value=repaired_atrial if enabled else original_atrial
    tex=collections['v26']['textures'][0]
    active(0x84C6);bind(0x806F,tex)
    t3(0x806F,0,0x8229,*atrial['storageDimensionsXYZ'],0,0x1903,0x1401,value.ctypes.data)
    gl_check('read-only candidate atrial texture')
labels = np.empty(mesh['vertexCount'], np.uint32)
with tempfile.TemporaryDirectory(prefix='heart-wall-v27-') as temp:
    binary = Path(temp)/'components.so'
    subprocess.run(['g++','-O3','-std=c++17','-shared','-fPIC',str(ROOT/'scripts/cleanup-v25/debris_components.cpp'),'-o',str(binary)], check=True)
    library = ctypes.CDLL(str(binary))
    arr = np.ctypeslib.ndpointer
    library.debris_labels.argtypes = [ctypes.c_uint32]*2 + [arr(np.uint32,1,flags='C_CONTIGUOUS')]*2
    library.debris_labels.restype = ctypes.c_uint32
    component_count = int(library.debris_labels(mesh['vertexCount'],mesh['indexCount']//3,mesh['indices'],labels))
counts = np.bincount(labels[mesh['indices'][::3]], minlength=component_count)
np.save(DATA/'component-triangles.npy', counts)
np.save(DATA/'vertex-components.npy', labels)
print('Complete mesh components', component_count, flush=True)
component_attribute = labels.astype(np.float32)
bind_vao(mesh['vao'])
component_buffer = U()
fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(component_buffer))
bind_buffer(0x8892,component_buffer)
buffer_data(0x8892,component_attribute.nbytes,component_attribute.ctypes.data,0x88E4)
enable_attribute(3)
vertex_pointer(3,1,0x1406,0,0,None)
quad()
for key in ('positions','normals','indices','_rawOwner'):
    mesh.pop(key,None)
arrays.clear()
del arrays, labels, component_attribute
gc.collect()

vertex = fine_sources['vertex'].replace('void main(){','layout(location=3) in float componentAttribute;\nflat out highp float fragmentComponent;\nvoid main(){fragmentComponent=componentAttribute;')
needle = 'fragColor=vec4(pow(max(color,vec3(0.)),vec3(.89)),1.);'
assert needle in fine_sources['fragment'], 'The production output changed; review diagnostic replacement.'
fragment = fine_sources['fragment'].replace('void main(){','flat in highp float fragmentComponent;\nvoid main(){').replace(needle,'fragColor=vec4(toTex(meshPosition)*(lumenFineDimensions-1.),fragmentComponent+1.);')
location_program = compile_mesh(vertex, fragment)
location_target = depth_output(W,H)
active(0x84C5)
bind(0x0DE1,location_target['texture'])
t2(0x0DE1,0,0x8814,W,H,0,0x1908,0x1406,None)
bind_fbo(0x8D40,location_target['framebuffer'])
assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5

def world_from_fine(xyz):
    q = (np.array(xyz)-(np.array(meta['fullDimensionsXYZ'])-1)/2)*.0794/meta['longestMm']
    return q[[0,2,1]]*[1,1,-1]

def set_version(name):
    global active_version
    active_version = name
    f = collections[name]['flags']
    bind_vao(mesh['vao']);bind_buffer(0x8892,flag_buffer)
    buffer_data(0x8892,f.nbytes,f.ctypes.data,0x88E4);quad()

def locations(common):
    configure(location_program,location_target,*common,ready=1,side=1,clipped=True,skip=1)
    enable(0x0B71);fn('glDepthFunc',None,[U])(0x0203)
    fn('glClearColor',None,[F,F,F,F])(0,0,0,0);fn('glClearDepthf',None,[F])(1.)
    fn('glClear',None,[U])(0x4000|0x0100)
    u3(location_program,'boundsMin',mesh['bounds']['min']);u3(location_program,'boundsMax',mesh['bounds']['max'])
    bind_vao(mesh['vao']);draw_elements(4,mesh['indexCount'],0x1405,None)
    fn('glFinish',None,[])()
    result = np.zeros((H,W,4),np.float32)
    fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,W,H,0x1908,0x1406,result.ctypes.data)
    assert fn('glGetError',U,[])()==0
    quad();disable(0x0B71)
    return result[::-1].copy()

cases = [
 dict(id='overview-284',coordinate=1132,target=[1000,1132,1000],distance=1.15),
 dict(id='wall-284',coordinate=1132,target=[1270,1132,900],distance=.50),
 dict(id='wall-284-oblique',coordinate=1132,target=[1210,1132,1000],distance=.48,tilt=[.38,.02]),
 dict(id='nodule-284',coordinate=1132,target=[1080,1132,1030],distance=.43),
 dict(id='appendage-313',coordinate=1248,target=[1270,1248,810],distance=.50),
 dict(id='vein-320',coordinate=1276,target=[1270,1276,810],distance=.50),
 dict(id='pulmonary-335',coordinate=1336,target=[1000,1336,570],distance=.48),
 dict(id='tricuspid-222',coordinate=884,target=[760,884,1220],distance=.50),
]
reports = []
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
for case in cases:
    if requested and case['id'] not in requested:
        continue
    y = case['coordinate']
    cap = np.take(fine.region([0,y,0],[1897,y+1,2117]),0,axis=1).copy()
    cap_hash = hashlib.sha256(cap.tobytes()).hexdigest()
    texture(1,cap,True)
    center = world_from_fine([948,y,1058]);target=world_from_fine(case['target'])
    normal=np.array([0,0,-1.]);right=np.array([1.,0,0]);up=np.array([0,-1.,0]);tilt=case.get('tilt',[.08,.025]);direction=unit(normal+tilt[0]*right+tilt[1]*up)
    world=dict(center=center.tolist(),normal=normal.tolist(),right=right.tolist(),up=up.tolist(),width=extent[0],height=extent[1],_eye=(target+direction*case['distance']).tolist(),_target=target.tolist())
    common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]
    repaired_name='repair-all' if repair_all else 'repair'
    versions = [('v26',True),(repaired_name,True)] if repair else [('v26',True),('original-display',False)]
    rendered=[]
    for version, enabled in versions:
        if repair:use_repair(version==repaired_name)
        set_version('v26');cleanup_on=enabled
        frame=render_mesh(mesh,common)
        Image.fromarray(frame).save(DATA/(case['id']+'-'+version+'.png'))
        Image.fromarray(frame[:,:,:3]).save(DOCS/(case['id']+'-'+version+'.jpg'),quality=94)
        xyz=locations(common)
        np.savez_compressed(DATA/(case['id']+'-'+version+'-locations.npz'),locations=xyz,world=world)
        rendered.append(frame)
        print(case['id'], version, 'rendered and located', flush=True)
    sheet=Image.new('RGB',(2*W,H+44),'#0b1317')
    pen=ImageDraw.Draw(sheet)
    titles=('Frozen v26 display','Restore original wall visibility') if repair else ('Frozen v26 display','Cleanup disabled · original geometry')
    for i,(title,frame) in enumerate(zip(titles,rendered)):
        sheet.paste(Image.fromarray(frame[:,:,:3]),(i*W,44));pen.text((i*W+12,12),title,font=font,fill='#efece0')
    suffix='-repair-all-comparison.jpg' if repair_all else ('-repair-comparison.jpg' if repair else '-comparison.jpg')
    sheet.save(DOCS/(case['id']+suffix),quality=94)
    assert hashlib.sha256(cap.tobytes()).hexdigest()==cap_hash
    reports.append(dict(case=case,world=world,sourceCapSha256=cap_hash,changedPixels=int(np.any(rendered[0]!=rendered[1],axis=2).sum())))
    report_name='repair-all-cameras.json' if repair_all else ('repair-cameras.json' if repair else 'location-cameras.json')
    (DOCS/report_name).write_text(json.dumps(dict(componentCount=component_count,cameras=reports,source=fine.receipt(),scope='Nearby reproducible production cameras; not exact screenshot registration. Source geometry and acquired cap pixels unchanged.'),indent=2)+'\n')
