#!/usr/bin/env python3
"""Read-only source/mesh identity of visible arterial fragments.

Uses the exact review camera and production mesh depth/visibility. An extra
flat vertex attribute returns the complete uncut component ID with each visible
surface coordinate. No asset, source sample or production shader is changed.
"""
from pathlib import Path
import ctypes, json, sys, tempfile, subprocess
from scipy import ndimage as ndi
ROOT=Path(__file__).resolve().parents[2]
review_v26='--v26' in sys.argv
DATA=Path('/workspace/data/cleanup-v26/artery-review'+('-v26' if review_v26 else ''));DATA.mkdir(parents=True,exist_ok=True)
DOCS=ROOT/'docs/cleanup-v26/artery-review';DOCS.mkdir(parents=True,exist_ok=True)
prefix=(ROOT/'scripts/cleanup-v25/render_review.py').read_text().split('fine=FineSource')[0]
prefix=prefix.replace("for k in ['positions','normals','indices','_rawOwner']:mesh.pop(k,None)\narrays.clear();del arrays;gc.collect()",'')
sys.argv=[sys.argv[0],'--output',str(DATA)]
exec(compile(prefix,str(ROOT/'scripts/cleanup-v25/render_review.py'),'exec'))
fine=FineSource(cache_bricks=12);meta=fine.meta;extent=manifest['extent']
if review_v26:
    active_manifest=read_json(ROOT/'public/assets/cleanup-v26/lumen-manifest.json')
    for index,item in enumerate(active_manifest['masks']):
        encoded=public_path(item['url']).read_bytes();assert hashlib.sha256(encoded).hexdigest()==item['sha256'];raw=gzip.decompress(encoded);assert hashlib.sha256(raw).hexdigest()==item['decodedSha256']
        dims=item['storageDimensionsXYZ'];a=np.frombuffer(raw,np.uint8).reshape(dims[::-1]);tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));active(0x84C0+6+index);bind(0x806F,tex)
        t3(0x806F,0,0x8229,*dims,0,0x1903,0x1401,a.ctypes.data)
        for k,v in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812F),(0x2803,0x812F),(0x8072,0x812F)]:param(0x806F,k,v)
    active_debris=read_json(ROOT/'public/assets/cleanup-v26/debris-manifest.json')['profiles'][0];flag_item=active_debris['vertexFlags'];encoded=public_path(flag_item['url']).read_bytes();assert hashlib.sha256(encoded).hexdigest()==flag_item['sha256'];active_flags=np.frombuffer(gzip.decompress(encoded),np.uint8);assert hashlib.sha256(active_flags).hexdigest()==flag_item['decodedSha256']
    bind_vao(mesh['vao']);bind_buffer(0x8892,buf_flags);buffer_data(0x8892,active_flags.nbytes,active_flags.ctypes.data,0x88E4);quad()
    original_configure=configure
    def configure(program,*args,**kwargs):
        original_configure(program,*args,**kwargs);ui(program,'lumenMaskCount',len(active_manifest['masks']));ui(program,'lumenMaskBitPacked',1)
        for i,item in enumerate(active_manifest['masks']):
            ui(program,'lumenMaskTexture'+str(i),6+i);u3(program,'lumenMaskOrigin'+str(i),item['lowerFullFineXYZ']);u3(program,'lumenMaskDimensions'+str(i),item['dimensionsXYZ'])
labels=np.empty(mesh['vertexCount'],np.uint32)
with tempfile.TemporaryDirectory(prefix='heart-artery-review-v26-') as temp:
    binary=Path(temp)/'components.so'
    subprocess.run(['g++','-O3','-std=c++17','-shared','-fPIC',str(ROOT/'scripts/cleanup-v25/debris_components.cpp'),'-o',str(binary)],check=True)
    lib=ctypes.CDLL(str(binary));arr=np.ctypeslib.ndpointer
    lib.debris_labels.argtypes=[ctypes.c_uint32]*2+[arr(np.uint32,1,flags='C_CONTIGUOUS'),arr(np.uint32,1,flags='C_CONTIGUOUS')]
    lib.debris_labels.restype=ctypes.c_uint32
    component_count=int(lib.debris_labels(mesh['vertexCount'],mesh['indexCount']//3,mesh['indices'],labels))
print('Components',component_count,flush=True)
component_attribute=labels.astype(np.float32)
bind_vao(mesh['vao']);component_buffer=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(component_buffer));mesh['buffers'].append(component_buffer)
bind_buffer(0x8892,component_buffer);buffer_data(0x8892,component_attribute.nbytes,component_attribute.ctypes.data,0x88E4);enable_attribute(3);vertex_pointer(3,1,0x1406,0,0,None);quad();del component_attribute
vertex=fine_sources['vertex'].replace('void main(){','layout(location=3) in float componentAttribute;\nflat out highp float fragmentComponent;\nvoid main(){fragmentComponent=componentAttribute;')
fragment=fine_sources['fragment'].replace('void main(){','flat in highp float fragmentComponent;\nvoid main(){').replace('fragColor=vec4(pow(max(color,vec3(0.)),vec3(.89)),1.);','fragColor=vec4(toTex(meshPosition)*(lumenFineDimensions-1.),fragmentComponent+1.);')
location_program=compile_mesh(vertex,fragment)
location_target=depth_output(W,H)
active(0x84C5);bind(0x0DE1,location_target['texture']);t2(0x0DE1,0,0x8814,W,H,0,0x1908,0x1406,None)
bind_fbo(0x8D40,location_target['framebuffer']);assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5

def world_from_fine(xyz):
    q=(np.array(xyz)-(np.array(meta['fullDimensionsXYZ'])-1)/2)*meta['sourceSpacingUm']/1000/meta['longestMm'];return q[[0,2,1]]*[1,1,-1]

cases=[
 dict(id='pulmonary',coordinate=1216,target=[1000,1216,480],distance=.37,
      pixels=[(245,465),(325,450),(285,550),(320,575),(335,605),(300,635),(280,680),(390,400),(365,460),(260,710)]),
 dict(id='aortic',coordinate=1216,target=[700,1216,490],distance=.42,
      pixels=[(360,420),(250,540),(420,560),(400,650)]),
]
records=[]
for case in cases:
    coordinate=case['coordinate'];cap=np.take(fine.region([0,coordinate,0],[1897,coordinate+1,2117]),0,axis=1).copy();texture(1,cap,True)
    center=world_from_fine([948,coordinate,1058]);target=world_from_fine(case['target']);normal=np.array([0,0,-1.]);right=np.array([1.,0,0]);up=np.array([0,-1.,0]);direction=unit(normal+.08*right+.025*up)
    world=dict(center=center.tolist(),normal=normal.tolist(),right=right.tolist(),up=up.tolist(),width=extent[0],height=extent[1],_eye=(target+direction*case['distance']).tolist(),_target=target.tolist())
    common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]
    cleanup_on=True
    visible=render_mesh(mesh,common);Image.fromarray(visible).save(DATA/(case['id']+'-source.png'))
    configure(location_program,location_target,*common,ready=1,side=1,clipped=True,skip=1)
    enable(0x0B71);fn('glDepthFunc',None,[U])(0x0203);fn('glClearColor',None,[F,F,F,F])(0,0,0,0);fn('glClearDepthf',None,[F])(1.);fn('glClear',None,[U])(0x4000|0x0100)
    u3(location_program,'boundsMin',mesh['bounds']['min']);u3(location_program,'boundsMax',mesh['bounds']['max']);bind_vao(mesh['vao']);draw_elements(4,mesh['indexCount'],0x1405,None);fn('glFinish',None,[])()
    positions=np.zeros((H,W,4),np.float32);fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,W,H,0x1908,0x1406,positions.ctypes.data);assert fn('glGetError',U,[])()==0;positions=positions[::-1].copy()
    np.savez_compressed(DATA/(case['id']+'-locations.npz'),locations=positions,world=world)
    for point in case['pixels']:
        x,y=point;y-=44
        value=positions[y,x];record=dict(case=case['id'],comparisonPixel=list(point),sourceXYZ=value[:3].tolist(),component=int(round(float(value[3])))-1)
        records.append(record);print(json.dumps(record),flush=True)
    quad();disable(0x0B71)

counts=np.bincount(labels[mesh['indices'][::3]],minlength=component_count)
new_debris=json.loads((ROOT/'public/assets/cleanup-v26/debris-manifest.json').read_text())['profiles'][0]
new_flags=np.frombuffer(gzip.decompress(public_path(new_debris['vertexFlags']['url']).read_bytes()),np.uint8)
details=[]
for component in sorted({r['component'] for r in records if r['component']>=0}):
    v=np.flatnonzero(labels==component)
    info=dict(component=component,vertices=len(v),triangles=int(counts[component]),v26Excluded=bool(new_flags[v[0]]),largestComponent=component==int(counts.argmax()))
    if not info['largestComponent']:
        vertices=mesh['positions'][v].astype(np.float64)/65535
        world=np.array(mesh['bounds']['min'])+vertices*(np.array(mesh['bounds']['max'])-np.array(mesh['bounds']['min']))
        xyz=world[:,[0,2,1]]*[1,-1,1]*meta['longestMm']/.0794+(np.array(meta['fullDimensionsXYZ'])-1)/2
        info.update(lowerFineXYZ=xyz.min(axis=0).tolist(),upperFineXYZ=xyz.max(axis=0).tolist(),bboxDiagonalMm=float(np.linalg.norm(xyz.max(axis=0)-xyz.min(axis=0))*.0794))
        np.save(DATA/(str(component)+'-vertices-fine.npy'),xyz)
    details.append(info);print(json.dumps(info),flush=True)
report=dict(displayVersion='v26' if review_v26 else 'v25',isFinalReleaseAcceptance=False,reviewStage='Diagnostic runtime snapshot',sourceHfmSha256=lod['decodedSha256'],componentCount=component_count,points=records,components=details,scope='Exact production-camera first visible mesh surface, complete uncut mesh connectivity, no biological classification.')
if review_v26:
    report['sampledDisplayAssets']=dict(maskPayloads={m['id']:m['decodedSha256'] for m in active_manifest['masks']},vertexFlagsDecodedSha256=active_debris['vertexFlags']['decodedSha256'])
(DOCS/('visible-fragment-identities'+('-v26' if review_v26 else '')+'.json')).write_text(json.dumps(report,indent=2)+'\n')

# Independently reproduce the builder's source support at each sampled point.
# This quantifies the existing guard; it does not relabel its tissue identity.
arterial_lo=np.array([510,900,180]);arterial_hi=np.array([1160,1281,740]);metrics=[]
for point in records:
    xyz=np.asarray(point['sourceXYZ']);xi,y,zi=np.floor(xyz+.5).astype(int)
    if not (arterial_lo[1]+4<=y<arterial_hi[1]-4):continue
    a=arterial_lo.copy();b=arterial_hi.copy();a[1]=y-4;b[1]=y+5
    raw=fine.region(a,b);f05=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3);f08=ndi.gaussian_filter(raw.astype(np.float32),.8,truncate=3)
    s=raw[:,4,:];s05=f05[:,4,:];s08=f08[:,4,:]
    strong=(s>=190)|(s05>=135)|(s08>=135);strong_labels,n=ndi.label(strong,structure=np.ones((3,3),bool));strong_counts=np.bincount(strong_labels.ravel());large=strong_counts>=400;large[0]=False;wall=large[strong_labels]
    distance=ndi.distance_transform_edt(~wall);fgdistance=ndi.distance_transform_edt(~(s05>=71.4));z=zi-arterial_lo[2];x=xi-arterial_lo[0]
    metrics.append({**point,'raw':int(s[z,x]),'sigma05':float(s05[z,x]),'sigma08':float(s08[z,x]),'strongComponentSamples':int(strong_counts[strong_labels[z,x]]) if strong_labels[z,x] else 0,'wallDistanceFineSamples':float(distance[z,x]),'foregroundDistanceFineSamples':float(fgdistance[z,x])})
(DOCS/('source-support-metrics'+('-v26' if review_v26 else '')+'.json')).write_text(json.dumps(dict(metrics=metrics,source=fine.receipt()),indent=2)+'\n')
