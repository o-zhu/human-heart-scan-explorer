"""Verify the experimental fine mesh with production GLSL in native EGL.

This is an offscreen geometry, clipping and measured-cap check. It does not use
a browser, measure user-device frame rates, establish clinical validity, or
claim that smoothing/decimation preserves all acquired detail.
"""
from pathlib import Path
import sys
import struct

ROOT = Path(__file__).resolve().parents[1]
if '--output' not in sys.argv:
    sys.argv += ['--output', str(ROOT/'docs/fine-surface-v19/native')]
fixture = ROOT/'tests/renderer-responsiveness-v16-native.py'
setup = fixture.read_text().split('checks=[]')[0]
setup = setup.replace('W, H, VW, VH = 490, 590, 180, 217', 'W, H, VW, VH = 720, 840, 180, 210')
# A mesh program has its own position/normal attributes; the common fixture's
# screen-quad attribute is inactive there. Keep its real uniform setup only.
setup = setup.replace(
    "    fn('glEnableVertexAttribArray',None,[U])(position)\n    fn('glVertexAttribPointer',None,[U,I,U,U,I,P])(position,2,0x1406,0,0,None)",
    "    if position >= 0:\n        fn('glEnableVertexAttribArray',None,[U])(position)\n        fn('glVertexAttribPointer',None,[U,I,U,U,I,P])(position,2,0x1406,0,0,None)")
setup = setup.replace('eye=center+direction*distance,forward=forward',
    "eye=np.asarray(world.get('_cameraTarget',center))+direction*distance*world.get('_cameraScale',1.),forward=forward")
exec(compile(setup, str(fixture), 'exec'))

fine_sources = node('import {fineSurfaceShaderSources} from "./public/fine-surface.js";'
                    'console.log(JSON.stringify(fineSurfaceShaderSources));')


def compile_mesh(vertex, fragment):
    old = sources['vertex']
    sources['vertex'] = vertex
    try:
        return compile_program(fragment)
    finally:
        sources['vertex'] = old


mesh_program = compile_mesh(fine_sources['vertex'], fine_sources['fragment'])
background_program = compile_program(fine_sources['background'])
projection_program = compile_mesh(
    fine_sources['vertex'].replace('void main(){', 'void main(){gl_PointSize=7.;'),
    '#version 300 es\nprecision highp float;out vec4 fragColor;void main(){fragColor=vec4(1.,0.,1.,1.);}')
gen_vao = fn('glGenVertexArrays', None, [I, C.POINTER(U)])
bind_vao = fn('glBindVertexArray', None, [U])
bind_buffer = fn('glBindBuffer', None, [U, U])
buffer_data = fn('glBufferData', None, [U, C.c_ssize_t, P, U])
vertex_pointer = fn('glVertexAttribPointer', None, [U, I, U, U, I, P])
enable_attribute = fn('glEnableVertexAttribArray', None, [U])
draw_elements = fn('glDrawElements', None, [U, I, U, P])


def quad():
    bind_vao(0)
    bind_buffer(0x8892, buf)
    enable_attribute(0)
    vertex_pointer(0, 2, 0x1406, 0, 0, None)


def depth_output(width, height):
    out = output(width, height, True)
    depth = U()
    fn('glGenRenderbuffers', None, [I, C.POINTER(U)])(1, C.byref(depth))
    fn('glBindRenderbuffer', None, [U, U])(0x8D41, depth)
    fn('glRenderbufferStorage', None, [U, U, I, I])(0x8D41, 0x81A6, width, height)
    fn('glFramebufferRenderbuffer', None, [U, U, U, U])(0x8D40, 0x8D00, 0x8D41, depth)
    assert fn('glCheckFramebufferStatus', U, [U])(0x8D40) == 0x8CD5
    out['depth'] = depth
    return out


mesh_target = depth_output(W, H)


def mesh_arrays(manifest, lod):
    blob = public_path(lod['url']).read_bytes()
    assert len(blob) == lod['compressedBytes']
    assert hashlib.sha256(blob).hexdigest() == lod['sha256']
    raw = gzip.decompress(blob)
    assert len(raw) == lod['decodedBytes']
    assert hashlib.sha256(raw).hexdigest() == lod['decodedSha256']
    magic, version, count, index_count, p, n, i, reserved = struct.unpack_from('<8I', raw)
    assert magic == 0x314d4648 and version == 1 and reserved == 0
    assert count == lod['vertices'] and index_count == lod['triangles'] * 3
    assert p >= 32 and not any(offset % 4 for offset in [p,n,i])
    assert p+count*6 <= n and n+count*6 <= i and i+index_count*4 == len(raw)
    positions = np.frombuffer(raw, '<u2', count*3, p).reshape(count,3).copy()
    normals = np.frombuffer(raw, '<i2', count*3, n).reshape(count,3).copy()
    indices = np.frombuffer(raw, '<u4', index_count, i).copy()
    assert int(indices.max()) < count
    bounds = lod.get('bounds', manifest['bounds'])
    lo, hi = np.asarray(bounds['min']), np.asarray(bounds['max'])
    points = lo + positions.astype(np.float64)/65535 * (hi-lo)
    norms = np.linalg.norm(normals.astype(float)/32767, axis=1)
    nonzero = norms > 1e-8
    assert nonzero.all(), 'A shipped vertex has an undefined surface normal.'
    assert np.abs(norms[nonzero]-1).max() < .00008
    return dict(positions=positions,normals=normals,indices=indices,points=points,bounds=bounds,
                vertexCount=count,indexCount=index_count,bytes=len(blob),normalError=float(np.abs(norms-1).max()))


def install_mesh(arrays):
    vao=U();gen_vao(1,C.byref(vao));bind_vao(vao)
    buffers=[]
    for slot,key,kind in [(0,'positions',0x1403),(1,'normals',0x1402)]:
        value=arrays[key];buffer=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));buffers.append(buffer)
        bind_buffer(0x8892,buffer);buffer_data(0x8892,value.nbytes,value.ctypes.data,0x88E4)
        enable_attribute(slot);vertex_pointer(slot,3,kind,1,0,None)
    value=arrays['indices'];buffer=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));buffers.append(buffer)
    bind_buffer(0x8893,buffer);buffer_data(0x8893,value.nbytes,value.ctypes.data,0x88E4)
    quad()
    return dict(vao=vao,buffers=buffers,**arrays)


def render_mesh(mesh, common, side=1, clipped=True):
    quad();bind_fbo(0x8D40,mesh_target['framebuffer']);viewport(0,0,W,H)
    disable(0x0B71);use(background_program)
    u2(background_program,'resolution',[W,H]);ui(background_program,'palette',4)
    draw_arrays(4,0,3)
    enable(0x0B71);fn('glDepthFunc',None,[U])(0x0203)
    fn('glClearDepthf',None,[F])(1.);fn('glClear',None,[U])(0x0100)
    configure(mesh_program,mesh_target,*common,ready=1,side=side,clipped=clipped,skip=1)
    u3(mesh_program,'boundsMin',mesh['bounds']['min']);u3(mesh_program,'boundsMax',mesh['bounds']['max'])
    bind_vao(mesh['vao']);draw_elements(4,mesh['indexCount'],0x1405,None)
    quad();disable(0x0B71)
    return draw(programs['composite'],composed,*common,ready=1,side=side,clipped=clipped,scene=mesh_target)


donor = next(d for d in donors if d['id']=='ladaf-2021-17')
manifest = read_json(ROOT/'public/assets/fine-surface-v19/manifest.json')
assert manifest['donorId'] == donor['id'] and manifest['format'] == 'HFM1'
volume_manifest = read_json(public_path(donor['manifestUrl']))
fine_meta = read_json(ROOT/'public/assets/ultra-volume-v7.json')
extent_checks=[]
for name, level in volume_manifest['levels'].items():
    dims=np.asarray(level['dimensions']);spacing=np.asarray(level['spacingUm'])
    size=(dims-1)*spacing;extent=(size[[0,2,1]]/max(size)).tolist()
    error=float(np.abs(np.array(extent)-manifest['extent']).max())
    assert error < 1e-12, (name,'existing source extent is inconsistent with the mesh')
    extent_checks.append(dict(level=name,dimensions=dims.tolist(),normalizedExtent=extent,maximumExtentError=error))

level=volume_manifest['levels']['high'];texture(0,load_volume(level),True)
cleanup=read_json(public_path(donor['cleanupManifestUrl']))
cleanup_raw=gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes())
texture(2,np.frombuffer(cleanup_raw,np.uint8).reshape(*cleanup['dimensions'][::-1]).copy())
views=read_json(public_path(donor['flowViewsUrl']))['presets']
view=next(v for v in views if v['id']=='lv-inflow')
cap=verified_image(view['texture']);cap_hash=hashlib.sha256(cap.tobytes()).hexdigest();texture(1,cap,True)
common=[level,cleanup,view['world'],donor['displayWindow'],manifest['threshold'],cap.shape]
reference=draw(programs['volume'],full,*common)
matte=draw(matte_program,composed,*common,scene=full)[:,:,0]>0
assert matte.sum()>1000
Image.fromarray(reference).save(OUT/'interactive-volume.png')
whole_reference=draw(programs['volume'],full,*common,clipped=False)
Image.fromarray(whole_reference).save(OUT/'interactive-volume-whole.png')
close_common=common.copy()
close_common[2]=dict(view['world'],_cameraTarget=view['world']['target'],_cameraScale=.58)
close_reference=draw(programs['volume'],full,*close_common)
close_matte=draw(matte_program,composed,*close_common,scene=full)[:,:,0]>0
Image.fromarray(close_reference).save(OUT/'interactive-volume-valve-closeup.png')
checks=[];mesh_images=[];close_images=[];whole_images=[]
for lod in manifest['lods']:
    mesh=install_mesh(mesh_arrays(manifest,lod))
    # The encoded world coordinates must map back into the retained native
    # source field. This catches a swapped/reflected axis or wrong origin.
    world=mesh['points']
    scan_mm=world[:,[0,2,1]]*np.array([1,-1,1])*fine_meta['longestMm']
    full_index=scan_mm/(fine_meta['sourceSpacingUm']/1000)+(np.asarray(fine_meta['fullDimensionsXYZ'])-1)/2
    local=full_index-np.asarray(fine_meta['sourceOriginXYZ'])
    assert np.all(local.min(axis=0)>-1.1) and np.all(local.max(axis=0)<np.asarray(fine_meta['sourceShapeXYZ'])+.1)
    image=render_mesh(mesh,common)
    error=np.abs(image[matte].astype(np.int16)-reference[matte].astype(np.int16))
    assert error.max()==0, (lod['id'],'fine-mesh cap diverged from the exact production measured cap')
    assert hashlib.sha256(cap.tobytes()).hexdigest()==cap_hash
    assert (image[:,:,:3].max(axis=2)>45).sum()>15000
    Image.fromarray(image).save(OUT/(lod['id']+'-cutaway.png'));mesh_images.append((lod,image))
    close_image=render_mesh(mesh,close_common)
    close_error=np.abs(close_image[close_matte].astype(np.int16)-close_reference[close_matte].astype(np.int16))
    assert close_error.max()==0,(lod['id'],'close-up measured cap diverged')
    Image.fromarray(close_image).save(OUT/(lod['id']+'-valve-closeup.png'));close_images.append((lod,close_image))
    whole=render_mesh(mesh,common,clipped=False)
    Image.fromarray(whole).save(OUT/(lod['id']+'-whole.png'));whole_images.append((lod,whole))
    retained=render_mesh(mesh,common,side=-1)
    retained_matte=draw(matte_program,composed,*common,side=-1,scene=mesh_target)[:,:,0]>0
    assert not retained_matte.any(),'A cut face incorrectly overlays the retained side.'
    Image.fromarray(retained).save(OUT/(lod['id']+'-retained-side.png'))
    item=dict(lod=lod['id'],vertices=lod['vertices'],triangles=lod['triangles'],compressedBytes=lod['compressedBytes'],
              sourceExtentMatches=True,sourceBoundsLocalMin=local.min(axis=0).tolist(),sourceBoundsLocalMax=local.max(axis=0).tolist(),
              maximumNormalLengthError=mesh['normalError'],measuredCapPixels=int(matte.sum()),maximumCapChannelError=int(error.max()),
              closeupCapPixels=int(close_matte.sum()),closeupMaximumCapChannelError=int(close_error.max()),
              measuredSourceCapUnchanged=True,retainedSideCapOcclusion=True,glErrors=0)
    checks.append(item);print(json.dumps(item),flush=True)
    fn('glDeleteVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(mesh['vao']))
    for buffer in mesh['buffers']:fn('glDeleteBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer))

# Quantized point markers exercise the exact production mesh projection and
# compare it against the same camera rays used by the cap shader. Only gl_PointSize
# is added for this diagnostic; no diagnostic markers enter the shipped assets.
world=view['world'];normal,right0,up0,center=[np.asarray(world[k]) for k in ['normal','right','up','center']]
direction=unit(normal+right0*.20+up0*.07);forward=-direction;right=unit(np.cross(forward,up0));up=unit(np.cross(right,forward))
distance=max(world['height']/.55,world['width']/.55*H/W)*.82;eye=center+direction*distance
bounds=manifest['bounds'];minimum,maximum=np.asarray(bounds['min']),np.asarray(bounds['max'])
markers=[center,center+.18*right0,center-.18*right0,center+.22*up0,center-.22*up0]
projection_checks=[]
for number,point in enumerate(markers):
    q=np.rint((point-minimum)/(maximum-minimum)*65535).astype(np.uint16)
    reconstructed=minimum+q.astype(float)/65535*(maximum-minimum)
    vao=U();gen_vao(1,C.byref(vao));bind_vao(vao);buffer=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer))
    bind_buffer(0x8892,buffer);buffer_data(0x8892,q.nbytes,q.ctypes.data,0x88E4);enable_attribute(0);vertex_pointer(0,3,0x1403,1,0,None)
    bind_fbo(0x8D40,composed['framebuffer']);viewport(0,0,W,H);use(projection_program)
    fn('glClearColor',None,[F,F,F,F])(0,0,0,1);fn('glClear',None,[U])(0x4000)
    for name,value in dict(boundsMin=minimum,boundsMax=maximum,eye=eye,forward=forward,right=right,up=up).items():u3(projection_program,name,value)
    uf(projection_program,'fov',.32);uf(projection_program,'cameraAspect',W/H)
    draw_arrays(0,0,1);image=read_target(composed)
    ys,xs=np.where((image[:,:,0]>250)&(image[:,:,1]<5)&(image[:,:,2]>250));assert len(xs)>10
    v=reconstructed-eye;z=np.dot(v,forward)
    expected=np.array([(np.dot(v,right)/(z*.32*(W/H))+1)*W/2-.5,
                       (1-np.dot(v,up)/(z*.32))*H/2-.5])
    observed=np.array([xs.mean(),ys.mean()]);error=np.abs(observed-expected)
    assert error.max()<.6,(number,observed,expected,error)
    projection_checks.append(dict(marker=number,expectedPixel=expected.tolist(),observedPixel=observed.tolist(),maximumPixelError=float(error.max())))
    quad();fn('glDeleteVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(vao));fn('glDeleteBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer))

font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13)
for name,baseline,collection in [('surface-comparison',reference,mesh_images),('valve-closeup-comparison',close_reference,close_images),('whole-surface-comparison',whole_reference,whole_images)]:
    sheet=Image.new('RGB',(W*(len(collection)+1),H+62),'#091015');pen=ImageDraw.Draw(sheet)
    for column,(label,image) in enumerate([('Interactive volume · 317.6 µm surface',baseline)]+
                                         [(f"{lod['label']} · {lod['triangles']:,} triangles",image) for lod,image in collection]):
        sheet.paste(Image.fromarray(image[:,:,:3]),(column*W,62));pen.text((column*W+10,8),label,font=font,fill='#eae8df')
        caption='Same transfer and camera · production GLSL' if name=='whole-surface-comparison' else 'Identical 79.4 µm measured cap, transfer and camera · production GLSL'
        pen.text((column*W+10,34),caption,font=small,fill='#a9bdbb')
    sheet.save(OUT/(name+'.jpg'),quality=95)
report=dict(passed=True,outputPixels=[W,H],renderer=fn('glGetString',C.c_char_p,[U])(0x1F01).decode(),
            fineSurfaceShaderSha256=hashlib.sha256(json.dumps(fine_sources,sort_keys=True).encode()).hexdigest(),
            fineSurfaceModuleSha256=hashlib.sha256((ROOT/'public/fine-surface.js').read_bytes()).hexdigest(),
            productionRendererSha256=hashlib.sha256((ROOT/'public/renderer.js').read_bytes()).hexdigest(),
            fineManifestSha256=hashlib.sha256((ROOT/'public/assets/fine-surface-v19/manifest.json').read_bytes()).hexdigest(),
            measuredCapSha256=cap_hash,extentChecks=extent_checks,meshChecks=checks,projectionChecks=projection_checks,
            scope='Production mesh shaders, actual HFM1 assets, measured Ultra cap, same-camera full-volume comparison, source-coordinate bounds, marker projection and retained-side cap occlusion in native EGL. No browser/device FPS or clinical validation.')
(OUT/'fine-surface-native.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(passed=True,meshLevels=len(checks),projectionMarkers=len(projection_checks))),flush=True)
