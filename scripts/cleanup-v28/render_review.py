#!/usr/bin/env python3
"""Same-camera v27/v28 review with production GLSL, source caps and local meshes."""
from pathlib import Path
import argparse,gc,gzip,hashlib,json,sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28-right'))
from exact_transport import read_surface
parser=argparse.ArgumentParser();parser.add_argument('--case',action='append');parser.add_argument('--output',type=Path,default=ROOT/'docs/cleanup-v28/render');parser.add_argument('--lossless-output',type=Path,default=Path('/workspace/data/cleanup-v28/render'));parser.add_argument('--patch-policy',action='append',type=Path);parser.add_argument('--no-patches',action='store_true');parser.add_argument('--quick',action='store_true');parser.add_argument('--stream-triangles',type=int,default=0,help='Offline only: consecutive exact triangles per bounded GL draw.');options=parser.parse_args();saved_options=options
cases=json.loads((ROOT/'scripts/cleanup-v28/review-cameras.json').read_text())
selected=[case for case in cases if not options.case or case['id'] in options.case]
assert options.stream_triangles==0 or (1<=options.stream_triangles<=200_000 and len(selected)==1), 'Streaming requires one cached camera and at most 200,000 triangles per draw.'
review_culling=None;stream_arrays=None;stream_stats=dict(trianglesPerDraw=options.stream_triangles,maximumBatchVertices=0,maximumBatchGpuBytes=0,drawCalls=0)
base=(ROOT/'scripts/cleanup-v27/render_review.py').read_text().split('\ncases=')[0]
base=base[base.index('fixture='):]
base=base.replace("('v26','v27')","('v27','v28')").replace("['v26']","['v27']").replace("active_version='v26'","active_version='v27'")
if len(selected)==1:
    needle="arrays=load_mesh_arrays(manifest,lod);transport=arrays['_transport'];mesh=install_mesh(arrays)"
    replacement="""from cache_review_geometry import sha_file
review_cache=Path('/workspace/data/cleanup-v28/camera-geometry')/selected[0]['id']
review_receipt=json.loads((review_cache/'receipt.json').read_text())
assert review_receipt['camera']==selected[0] and review_receipt['sourceDecodedSha256']==lod['decodedSha256']
assert review_receipt['cullingCodeSha256']==sha_file(ROOT/'scripts/cleanup-v28/review_geometry.py')
assert all(sha_file(review_cache/n)==h for n,h in review_receipt['files'].items())
arrays={n:np.load(review_cache/(n+'.npy'),mmap_mode='r') for n in ['positions','normals','indices']}
arrays.update(bounds=review_receipt['bounds'],vertexCount=review_receipt['vertices'],indexCount=review_receipt['triangles']*3)
for collection in collections.values():
 assert collection['debris']['vertexFlags']['sha256']==review_receipt['flagSha256']
 collection['flags']=np.load(review_cache/'flags.npy',mmap_mode='r')
transport=review_receipt['transport'];review_culling=review_receipt['reviewCulling']
if saved_options.stream_triangles:
 stream_arrays=arrays.copy()
 mesh=install_mesh({**arrays,**{k:arrays[k][:0] for k in ['positions','normals','indices']}})
else:mesh=install_mesh(arrays)"""
    assert needle in base;base=base.replace(needle,replacement)
if options.stream_triangles:
    initial="buffer_data(0x8892,collections['v27']['flags'].nbytes,collections['v27']['flags'].ctypes.data,0x88E4)"
    assert initial in base;base=base.replace(initial,"buffer_data(0x8892,0,None,0x88E4)")
    update="f=collections[name]['flags'];bind_vao(mesh['vao'])"
    assert update in base;base=base.replace(update,"f=collections[name]['flags'][:0];bind_vao(mesh['vao'])")
options.lossless_output.mkdir(parents=True,exist_ok=True)
exec(compile(base,str(ROOT/'scripts/cleanup-v27/render_review.py'),'exec'));options=saved_options
patches=[]
if not options.no_patches:
    if options.patch_policy:
        for path in options.patch_policy:
            policy=json.loads(path.read_text());patches.append((policy,path.parent))
    else:
        pm=json.loads((ROOT/'public/assets/cleanup-v28/surface-manifest.json').read_text())
        patches=[(p,ROOT/'public') for p in pm['patches']]

def asset_bytes(item,root):
    path=root/item.get('url',item.get('file')).removeprefix('./');return read_surface(path,item)
def patch_install(policy,root,index):
    item=policy['surface'];raw=asset_bytes(item,root);h=np.frombuffer(raw,'<u4',8);float_positions=int(h[0])==0x31524653;assert int(h[0]) in (0x31524653,0x314d4648)
    n=int(h[2]);count=int(h[3]);p=np.frombuffer(raw,'<f4' if float_positions else '<u2',n*3,int(h[4]));normals=np.frombuffer(raw,'<i2',n*3,int(h[5]));indices=np.frombuffer(raw,'<u4',count,int(h[6]));assert int(indices.max())<n
    vao=U();gen_vao(1,C.byref(vao));bind_vao(vao);buffers=[]
    for slot,value,kind,normalised in [(0,p,0x1406 if float_positions else 0x1403,0 if float_positions else 1),(1,normals,0x1402,1)]:
        buffer=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));buffers.append(buffer);bind_buffer(0x8892,buffer);buffer_data(0x8892,value.nbytes,value.ctypes.data,0x88E4);enable_attribute(slot);vertex_pointer(slot,3,kind,normalised,0,None)
    fn('glDisableVertexAttribArray',None,[U])(2);fn('glVertexAttrib1f',None,[U,F])(2,0)
    buffer=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));buffers.append(buffer);bind_buffer(0x8893,buffer);buffer_data(0x8893,indices.nbytes,indices.ctypes.data,0x88E4);quad()
    mask=policy['lowBandMask'];maskraw=asset_bytes(mask,root);dims=mask['storageDimensionsXYZ'];array=np.frombuffer(maskraw,np.uint8).reshape(dims[::-1]);tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));active(0x84C0+10+index);bind(0x806F,tex);t3(0x806F,0,0x8229,*dims,0,0x1903,0x1401,array.ctypes.data)
    for k,v in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812F),(0x2803,0x812F),(0x8072,0x812F)]:param(0x806F,k,v)
    a=world_from_fine(policy['lowerFullFineXYZ']);b=world_from_fine(np.array(policy['upperFullFineXYZ'])-1)
    gl_check('patch upload '+policy['id'])
    return dict(policy=policy,vao=vao,buffers=buffers,indexCount=count,texture=tex,replacementBounds=dict(min=np.minimum(a,b).tolist(),max=np.maximum(a,b).tolist()),bounds=dict(min=[0,0,0],max=[1,1,1]) if float_positions else item['bounds'])
patches=[patch_install(p,r,i) for i,(p,r) in enumerate(patches)];gc.collect()
old_configure=configure
def configure(program,*args,**kwargs):
    old_configure(program,*args,**kwargs)
    enabled=active_version=='v28' and cleanup_on and bool(patches)
    ui(program,'refinementReady',int(enabled));ui(program,'refinementCount',len(patches) if enabled else 0);ui(program,'refinementPatchPass',0);ui(program,'refinementPatchIndex',-1)
    for i in range(4):
        item=patches[i] if i<len(patches) else None;active(0x84C0+10+i);bind(0x806F,item['texture'] if item else collections[active_version]['textures'][0]);ui(program,'refinementMask'+str(i),10+i)
        for name,value in dict(refinementOrigin=item['policy']['lowerFullFineXYZ'] if item else [0,0,0],refinementDimensions=item['policy']['lowBandMask']['dimensionsXYZ'] if item else [1,1,1],refinementMin=item['replacementBounds']['min'] if item else [0,0,0],refinementMax=item['replacementBounds']['max'] if item else [0,0,0]).items():u3(program,name+str(i),value)
    gl_check('local configure')
def draw_base_mesh():
    bind_vao(mesh['vao'])
    if not options.stream_triangles:
        draw_elements(4,mesh['indexCount'],0x1405,None);return
    # All faces retain their original order, corner order, quantized attributes,
    # flags and world bounds. No new surface, camera or shader is introduced.
    # Finishing each batch releases Mesa's transient transformed-vertex storage
    # before the same four GPU buffers are reused. The framebuffer/depth buffer
    # stays bound and is never cleared between consecutive draws.
    indices=stream_arrays['indices'];flags=collections[active_version]['flags']
    step=options.stream_triangles*3
    for start in range(0,len(indices),step):
        source_indices=indices[start:start+step]
        used,remapped=np.unique(source_indices,return_inverse=True)
        local_indices=remapped.astype('<u4');positions=stream_arrays['positions'][used];normals=stream_arrays['normals'][used];local_flags=flags[used]
        for target,buffer,value in [(0x8892,mesh['buffers'][0],positions),(0x8892,mesh['buffers'][1],normals),(0x8892,flag_buffer,local_flags),(0x8893,mesh['buffers'][2],local_indices)]:
            bind_buffer(target,buffer);buffer_data(target,value.nbytes,value.ctypes.data,0x88E4)
        draw_elements(4,len(local_indices),0x1405,None)
        fn('glFinish',None,[])();gl_check('finishing streamed source batch')
        stream_stats['maximumBatchVertices']=max(stream_stats['maximumBatchVertices'],len(used))
        stream_stats['maximumBatchGpuBytes']=max(stream_stats['maximumBatchGpuBytes'],sum(a.nbytes for a in [positions,normals,local_flags,local_indices]))
        stream_stats['drawCalls']+=1
def render_mesh(mesh,common,side=1,clipped=True):
    quad();bind_fbo(0x8D40,mesh_target['framebuffer']);viewport(0,0,W,H);disable(0x0B71);use(background_program);u2(background_program,'resolution',[W,H]);ui(background_program,'palette',common[2].get('_palette',4));draw_arrays(4,0,3)
    enable(0x0B71);fn('glDepthFunc',None,[U])(0x0203);fn('glClearDepthf',None,[F])(1.);fn('glClear',None,[U])(0x0100)
    configure(mesh_program,mesh_target,*common,ready=1,side=side,clipped=clipped,skip=1)
    u3(mesh_program,'boundsMin',mesh['bounds']['min']);u3(mesh_program,'boundsMax',mesh['bounds']['max']);draw_base_mesh()
    if active_version=='v28' and cleanup_on and patches:
        ui(mesh_program,'refinementPatchPass',1);ui(mesh_program,'debrisCleanupEnabled',0)
        for i,patch in enumerate(patches):
            ui(mesh_program,'refinementPatchIndex',i);u3(mesh_program,'boundsMin',patch['bounds']['min']);u3(mesh_program,'boundsMax',patch['bounds']['max']);bind_vao(patch['vao']);fn('glVertexAttrib1f',None,[U,F])(2,0);draw_elements(4,patch['indexCount'],0x1405,None)
    quad();disable(0x0B71);return draw(programs['composite'],composed,*common,ready=1,side=side,clipped=clipped,scene=mesh_target)

checks=[]
for case in cases:
    if options.case and case['id'] not in options.case:continue
    axis=case['axis'];coordinate=case['coordinate'];lo=[0,0,0];hi=meta['fullDimensionsXYZ'].copy();lo[axis]=coordinate;hi[axis]=coordinate+1
    cap=np.take(fine.region(lo,hi),0,axis=2-axis).copy();cap_hash=hashlib.sha256(cap.tobytes()).hexdigest();texture(1,cap,True)
    xyz=[948,948,1058];xyz[axis]=coordinate;center=world_from_fine(xyz);target=world_from_fine(case['target']);normal=np.array([[1.,0,0],[0,0,-1.],[0,1.,0]][axis]);right=np.array([[0,0,-1.],[1.,0,0],[1.,0,0]][axis]);up=np.array([[0,-1.,0],[0,-1.,0],[0,0,1.]][axis]);direction=unit(np.array(case.get('direction',normal+.08*right+.025*up)))
    world=dict(center=center.tolist(),normal=normal.tolist(),right=right.tolist(),up=up.tolist(),width=extent[2 if axis==0 else 0],height=extent[2 if axis==2 else 1],_eye=(target+direction*case['distance']).tolist(),_target=target.tolist(),_whole=case.get('whole',False))
    common=[level,cleanup,world,donor['displayWindow'],manifest['threshold'],cap.shape]
    set_version('v27');cleanup_on=True;before=render_mesh(mesh,common);set_version('v28');after=render_mesh(mesh,common)
    off_same=None;restore_same=None
    if not options.quick:
        set_version('v27');again=render_mesh(mesh,common);restore_same=bool(np.array_equal(before,again));assert restore_same
        cleanup_on=False;old_off=render_mesh(mesh,common);set_version('v28');new_off=render_mesh(mesh,common);off_same=bool(np.array_equal(old_off,new_off));assert off_same;cleanup_on=True
        Image.fromarray(new_off).save(options.lossless_output/(case['id']+'-cleanup-off.png'))
    assert hashlib.sha256(cap.tobytes()).hexdigest()==cap_hash
    Image.fromarray(before).save(options.lossless_output/(case['id']+'-v27.png'));Image.fromarray(after).save(options.lossless_output/(case['id']+'-v28.png'))
    sheet=Image.new('RGB',(W*2,H+64),'#0b1317');sheet.paste(Image.fromarray(before[:,:,:3]),(0,64));sheet.paste(Image.fromarray(after[:,:,:3]),(W,64));pen=ImageDraw.Draw(sheet);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22);pen.text((18,18),'v27 · Before',font=font,fill='#efece0');pen.text((W+18,18),'v28 · Source-guided refinement',font=font,fill='#efece0');sheet.save(OUT/(case['id']+'-comparison.jpg'),quality=97)
    check=dict(case=case,changedPixels=int(np.count_nonzero(np.any(before!=after,axis=2))),totalPixels=W*H,reversible=restore_same,originalOffExact=off_same,sourceCapSha256=cap_hash,imageHashes=dict(v27=hashlib.sha256(before.tobytes()).hexdigest(),v28=hashlib.sha256(after.tobytes()).hexdigest()),world=world);checks.append(check);print(json.dumps(check),flush=True)
report=dict(source=fine.receipt(),patches=[dict(id=p['policy']['id'],surface=p['policy']['surface'],lowBandMask=p['policy']['lowBandMask'],replacementBounds=p['replacementBounds']) for p in patches],sourceTransport=transport,reviewCulling=review_culling,maskManifestSha256={v:hashlib.sha256((ROOT/f'public/assets/cleanup-{v}/lumen-manifest.json').read_bytes()).hexdigest() for v in collections},productionShaders=True,rendererSha256=hashlib.sha256((ROOT/'public/renderer.js').read_bytes()).hexdigest(),fineSurfaceSha256=hashlib.sha256((ROOT/'public/fine-surface.js').read_bytes()).hexdigest(),checks=checks,scope='Verified Gentle source geometry with conservative offline camera culling, exact production GLSL and local replacement drawing, same-camera before/after, unchanged measured source caps. Nearby reproducible views, not exact screenshot registration. No clinical-validation or browser-performance claim.')
if options.stream_triangles:report['reviewStreaming']={**stream_stats,'triangleOrderPreserved':True,'sourceAttributesUnchanged':True,'framebufferAndDepthPreservedBetweenBatches':True,'productionShadersUnmodified':True}
(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
