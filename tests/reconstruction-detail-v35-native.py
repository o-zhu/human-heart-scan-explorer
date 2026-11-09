"""Same-camera output-detail audit with measured donor data and production GLSL.

Native EGL only. No invented geometry, browser automation, clinical inference,
or device-FPS claim. The optional mesh check uses the existing, hash-verified
compact decode in /workspace/data and all current prepared cleanup pieces.
"""
from pathlib import Path
import sys, os, struct, time, gc

ROOT = Path(__file__).resolve().parents[1]
if '--output' not in sys.argv:
    sys.argv += ['--output', str(ROOT/'docs/reconstruction-detail-v35')]
fixture = ROOT/'tests/fine-surface-v19-native.py'
setup = fixture.read_text().split('\ndonor = next')[0]
setup = setup.replace("'W, H, VW, VH = 720, 840, 180, 210'",
                      "'W, H, VW, VH = 2400, 1600, 1500, 1000'")
exec(compile(setup, str(fixture), 'exec'))

camera = dict(yaw=.32, pitch=.12, roll=np.pi, distance=1.65, pan=[0,0,0])
basis = node('import {VolumeRenderer} from "./public/renderer.js";'
             'console.log(JSON.stringify(VolumeRenderer.prototype.basis.call({camera:'+json.dumps(camera)+'})));')
extra_textures=[]
def upload_2d(slot, internal, width, height, format_, type_, data):
    tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));extra_textures.append(tex)
    active(0x84C0+slot);bind(0x0DE1,tex)
    for key,value in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812F),(0x2803,0x812F)]:param(0x0DE1,key,value)
    t2(0x0DE1,0,internal,width,height,0,format_,type_,data.ctypes.data)

atlas_manifest=read_json(ROOT/'public/assets/reviewed-mask-v32/manifest.json')
asset=atlas_manifest['asset'];packed=public_path(asset['url']).read_bytes()
assert len(packed)==asset['compressedBytes'] and hashlib.sha256(packed).hexdigest()==asset['sha256']
atlas_raw=gzip.decompress(packed)
assert len(atlas_raw)==asset['decodedBytes'] and hashlib.sha256(atlas_raw).hexdigest()==asset['decodedSha256']
im,pm=atlas_manifest['indexTexture'],atlas_manifest['payloadTexture']
upload_2d(6,0x8236,im['width'],im['height'],0x8D94,0x1405,np.frombuffer(atlas_raw,'<u4',im['byteLength']//4,im['offset']))
upload_2d(7,0x8058,pm['width'],pm['height'],0x1908,0x1401,np.frombuffer(atlas_raw,np.uint8,pm['byteLength'],pm['offset']))
offsets=np.asarray([f['indexOffset'] for f in atlas_manifest['fields']],np.int32)
grids=np.asarray([f['brickGridXYZ'] for f in atlas_manifest['fields']],np.int32)
patch_manifest=read_json(ROOT/'public/assets/cleanup-v30/surface-manifest.json')
prepared=False
current_donor=None
configure_base=configure
def configure(program,out,level,cleanup,world,settings,threshold,cap_shape,**options):
    configure_base(program,out,level,cleanup,world,settings,threshold,cap_shape,**options)
    for name,value in basis.items():u3(program,name,value)
    dims=np.asarray(level['dimensions']);spacing=np.asarray(level['spacingUm'])
    size=(dims-1)*spacing;extent=size[[0,2,1]]/max(size)
    u3(program,'extent',extent)
    uf(program,'stepSize',.9*min(extent/((dims-1)[[0,2,1]])))
    ui(program,'sceneDepthTexture',1);ui(program,'sceneDepthReady',0)
    ui(program,'reviewedMaskIndex',6);ui(program,'reviewedMaskPayload',7)
    ui(program,'reviewedMaskReady',1)
    fn('glUniform1iv',None,[I,I,P])(loc(program,b'reviewedMaskOffsets[0]'),8,offsets.ctypes.data)
    fn('glUniform3iv',None,[I,I,P])(loc(program,b'reviewedMaskGrids[0]'),8,grids.ctypes.data)
    has_lumen=current_donor=='ladaf-2021-17'
    ui(program,'lumenCleanupReady',int(has_lumen));ui(program,'lumenCleanupEnabled',int(has_lumen))
    u3(program,'lumenFineDimensions',atlas_manifest['sourceFullDimensionsXYZ'])
    ui(program,'lumenMaskCount',4)
    for i,f in enumerate(atlas_manifest['fields'][:4]):
        ui(program,'lumenMaskField'+str(i),i)
        u3(program,'lumenMaskOrigin'+str(i),f['lowerFullFineXYZ']);u3(program,'lumenMaskDimensions'+str(i),f['dimensionsXYZ'])
    ui(program,'refinementReady',int(prepared));ui(program,'refinementCount',4 if prepared else 0)
    ui(program,'refinementPatchPass',0);ui(program,'refinementPatchIndex',-1)
    ui(program,'debrisCleanupEnabled',int(prepared));ui(program,'nativeReplacementEnabled',0);ui(program,'nativePatchPass',0)
    for i,p in enumerate(patch_manifest['patches']):
        world_point=lambda p:np.asarray([(p[0]-948)/2116,(p[2]-1058)/2116,-(p[1]-948)/2116])
        a,b=world_point(p['lowerFullFineXYZ']),world_point(np.asarray(p['upperFullFineXYZ'])-1)
        ui(program,'refinementField'+str(i),i+4)
        u3(program,'refinementOrigin'+str(i),p['lowerFullFineXYZ']);u3(program,'refinementDimensions'+str(i),p['lowBandMask']['dimensionsXYZ'])
        u3(program,'refinementMin'+str(i),np.minimum(a,b));u3(program,'refinementMax'+str(i),np.maximum(a,b))

def image_comparison(name,before,after,description):
    # Bilinear display enlargement represents the old small canvas at the same
    # physical display size. The new image itself is rendered at this grid.
    old=np.asarray(Image.fromarray(before).resize((after.shape[1],after.shape[0]),Image.Resampling.BILINEAR))
    surface=after[:,:,:3].max(axis=2)>45
    delta=np.abs(old[:,:,:3].astype(np.int16)-after[:,:,:3].astype(np.int16))
    luminance=after[:,:,:3].mean(axis=2)
    edge=np.zeros(surface.shape)
    edge[:,1:]+=np.abs(np.diff(luminance,axis=1));edge[1:]+=np.abs(np.diff(luminance,axis=0))
    # Choose a reproducible tissue-rich crop; report its location instead of
    # assigning an unverified coronary/anatomical label to a high-contrast ridge.
    crop_w,crop_h=600,500;best=(-1,None)
    for y in range(100,after.shape[0]-crop_h-80,80):
        for x in range(80,after.shape[1]-crop_w-80,80):
            area=surface[y:y+crop_h,x:x+crop_w]
            if area.mean()<.90:continue
            score=edge[y:y+crop_h,x:x+crop_w].mean()
            if score>best[0]:best=(score,(x,y,x+crop_w,y+crop_h))
    assert best[1] is not None,(name,'Tissue-filled detail crop')
    box=best[1]
    sheet=Image.new('RGB',(1200,555),'#0b1317');pen=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
    for column,(label,pixels_) in enumerate([('Previous · 1.5M Display Samples',old),('Updated · '+description,after)]):
        sheet.paste(Image.fromarray(pixels_).convert('RGB').crop(box),(column*600,55))
        pen.text((column*600+14,18),label,font=font,fill='#efeee4')
    sheet.save(OUT/(name+'-detail.png'))
    Image.fromarray(after[:,:,:3]).save(OUT/(name+'-whole.jpg'),quality=94)
    return dict(id=name,oldGrid=[before.shape[1],before.shape[0]],newGrid=[after.shape[1],after.shape[0]],
                sourceSamplesUnchanged=True,sameCamera=True,sameThreshold=True,sameShader=True,
                sourceSurfacePixels=int(surface.sum()),changedSurfacePixels=int(np.any(delta[surface]>0,axis=1).sum()),
                oldDisplayMeanChannelDifference=float(delta[surface].mean()),oldDisplayMaximumChannelDifference=int(delta[surface].max()),
                detailCrop=list(box),detailCropSelection='Highest measured surface edge contrast in a >90% tissue-filled 600×500 crop; not an anatomical label.')

checks=[];source_checks=[];scalar_ladaf=None;common_ladaf=None
for donor in donors:
    current_donor=donor['id'];manifest=read_json(public_path(donor['manifestUrl']));level=manifest['levels']['high']
    data=load_volume(level);texture(0,data,True)
    cleanup=read_json(public_path(donor['cleanupManifestUrl']))
    clean=public_path(cleanup['volumeUrl']).read_bytes();mask=gzip.decompress(clean)
    texture(2,np.frombuffer(mask,np.uint8).reshape(*cleanup['dimensions'][::-1]).copy())
    world=dict(normal=[0,0,1],right=[1,0,0],up=[0,1,0],center=[0,0,0],width=1,height=1)
    common=[level,cleanup,world,donor['displayWindow'],manifest['defaultThreshold'],(1,1)]
    before=draw(programs['volume'],low,*common,clipped=False,ready=0)
    after=draw(programs['volume'],full,*common,clipped=False,ready=0)
    same=draw(programs['volume'],tiled,*common,clipped=False,ready=0,bands=True)
    assert np.array_equal(after,same),(current_donor,'Direct and completed-band source rays must match')
    checks.append(image_comparison(current_donor,before,after,'3.84M Display Samples'))
    checks[-1]['bandedEqualsDirect']=True
    checks[-1]['threshold']=manifest['defaultThreshold'];checks[-1]['sourceSpacingUm']=level['spacingUm']
    source_checks.append(dict(donor=current_donor,dimensions=level['dimensions'],sourceSpacingUm=level['spacingUm'],
                             scalarSha256=hashlib.sha256(data.tobytes()).hexdigest(),threshold=manifest['defaultThreshold'],surfaceSmoothing=1))
    if current_donor=='ladaf-2021-17':
        scalar_ladaf=after;common_ladaf=common
    print(json.dumps(checks[-1]),flush=True)
    del data,before,after,same;gc.collect()

mesh_path=Path(os.environ.get('HEART_VERIFIED_COMPACT_MESH','/workspace/data/heart-v29-compress/mesh-compact-consolidated-decoded.hfm'))
if mesh_path.is_file():
    current_donor='ladaf-2021-17';donor=next(d for d in donors if d['id']==current_donor)
    level=common_ladaf[0];texture(0,load_volume(level),True)
    cleanup=common_ladaf[1];texture(2,np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()),np.uint8).reshape(*cleanup['dimensions'][::-1]).copy())
    manifest=read_json(ROOT/'public/assets/display-compact-v29/surface-manifest.json');lod=manifest['lods'][0]
    digest=hashlib.sha256()
    with mesh_path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    assert mesh_path.stat().st_size==lod['decodedBytes'] and digest.hexdigest()==lod['decodedSha256']
    raw=np.memmap(mesh_path,np.uint8,mode='r');magic,version,count,index_count,p,n,i,reserved=struct.unpack_from('<8I',raw)
    assert magic==0x314d4648 and version==1 and count==lod['vertices'] and index_count==lod['triangles']*3
    arrays=dict(positions=np.frombuffer(raw,'<u2',count*3,p).reshape(count,3),normals=np.frombuffer(raw,'<i2',count*3,n).reshape(count,3),indices=np.frombuffer(raw,'<u4',index_count,i),bounds=manifest['bounds'])
    debris=read_json(ROOT/'public/assets/cleanup-v26/debris-manifest.json')['profiles'][0]['vertexFlags']
    flag_packed=public_path(debris['url']).read_bytes();assert hashlib.sha256(flag_packed).hexdigest()==debris['sha256']
    flags=gzip.decompress(flag_packed);assert hashlib.sha256(flags).hexdigest()==debris['decodedSha256']
    arrays['flags']=np.frombuffer(flags,np.uint8)
    # One small reusable geometry buffer preserves exact triangle order and
    # attributes without requiring llvmpipe to retain 23.6M transformed faces.
    empty={**arrays,**{k:arrays[k][:0] for k in ['positions','normals','indices']}}
    mesh=install_mesh(empty);bind_vao(mesh['vao'])
    flag_buffer=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(flag_buffer))
    bind_buffer(0x8892,flag_buffer);enable_attribute(2);vertex_pointer(2,1,0x1401,1,0,None);quad()
    patches=[]
    for entry in patch_manifest['patches']:
        s=entry['surface'];blob=public_path(s['url']).read_bytes()
        assert len(blob)==s['compressedBytes'] and hashlib.sha256(blob).hexdigest()==s['sha256']
        decoded=gzip.decompress(blob);assert len(decoded)==s['decodedBytes'] and hashlib.sha256(decoded).hexdigest()==s['decodedSha256']
        _,_,vertices,indices,p,n,i,_=struct.unpack_from('<8I',decoded)
        patch=dict(positions=np.frombuffer(decoded,'<u2',vertices*3,p).reshape(vertices,3),normals=np.frombuffer(decoded,'<i2',vertices*3,n).reshape(vertices,3),indices=np.frombuffer(decoded,'<u4',indices,i),bounds=s['bounds'],flags=np.zeros(vertices,np.uint8))
        patches.append(patch)
    def stream_mesh(item):
        u3(mesh_program,'boundsMin',item['bounds']['min']);u3(mesh_program,'boundsMax',item['bounds']['max']);bind_vao(mesh['vao'])
        for start in range(0,len(item['indices']),300000):
            original=item['indices'][start:start+300000];used,remapped=np.unique(original,return_inverse=True)
            local=[item['positions'][used],item['normals'][used],item['flags'][used],remapped.astype('<u4')]
            for target,buffer,value in zip([0x8892]*3+[0x8893],[mesh['buffers'][0],mesh['buffers'][1],flag_buffer,mesh['buffers'][2]],local):
                bind_buffer(target,buffer);buffer_data(target,value.nbytes,value.ctypes.data,0x88E4)
            draw_elements(4,len(original),0x1405,None);fn('glFinish',None,[])()
        assert fn('glGetError',U,[])()==0
    def draw_prepared(out):
        quad();bind_fbo(0x8D40,out['framebuffer']);viewport(0,0,out['width'],out['height'])
        disable(0x0B71);use(background_program);u2(background_program,'resolution',[out['width'],out['height']]);ui(background_program,'palette',4);draw_arrays(4,0,3)
        enable(0x0B71);fn('glDepthFunc',None,[U])(0x0203);fn('glClearDepthf',None,[F])(1.);fn('glClear',None,[U])(0x0100)
        common=[*common_ladaf];common[4]=.28
        configure(mesh_program,out,*common,clipped=False,ready=0,skip=1)
        stream_mesh(arrays)
        ui(mesh_program,'refinementPatchPass',1);ui(mesh_program,'debrisCleanupEnabled',0)
        for index,patch in enumerate(patches):ui(mesh_program,'refinementPatchIndex',index);stream_mesh(patch)
        quad();disable(0x0B71);return read_target(out)
    prepared=True
    old_target=depth_output(1500,1000);new_target=depth_output(3000,2000)
    before=draw_prepared(old_target);after=draw_prepared(new_target)
    check=image_comparison('ladaf-finalized-mesh',before,after,'6M Display Samples')
    check.update(sourceSpacingUm=79.4,threshold=.28,triangles=lod['triangles'],decodedSha256=lod['decodedSha256'],geometrySourceSha256=lod['sourceDecodedSha256'],allPreparedPatches=True,reviewedAtlasSha256=asset['decodedSha256'])
    checks.append(check);print(json.dumps(check),flush=True)
else:
    raise RuntimeError('Set HEART_VERIFIED_COMPACT_MESH to the existing verified 437 MB compact decode; do not silently omit finalized-model validation.')

report=dict(passed=True,checks=checks,sources=source_checks,camera=camera,
            shaderSourcesSha256=hashlib.sha256(json.dumps(sources,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
            driver=fn('glGetString',C.c_char_p,[U])(0x1F01).decode(),
            scope='Identical camera, physical source, threshold, cubic scalar shading, cleanup and production shaders. Different actual raster grids only. All three HOA source volumes and the finalized 79.4 µm mesh with its four prepared patches. Direct and completed-band scalar pixels are exactly equal.',
            limits='Display-detail proof, not added source resolution, recreated coronary anatomy, browser performance, Safari certification, or clinical validation.')
(OUT/'native-render-check.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(passed=True,comparisons=len(checks))),flush=True)
