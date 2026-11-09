"""Native scientific review of all Echo atlas acquisition planes and anchors.

Unmodified production volume and shared-geometry GLSL, actual measured resident
source, exact production-MPR caps, and captured production draw/guide commands.
No browser, headless-browser substitute, build, publication, or image synthesis.
This 317.6 µm review establishes geometry/composition, not Ultra surface detail.
"""
from pathlib import Path
import argparse
import ast
import ctypes as C
import gzip
import hashlib
import json
import math
import re
import sys
import time
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageColor

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', type=Path, default=Path('/tmp/echo-alignment-v5'))
parser.add_argument('--output', type=Path, default=ROOT/'docs/echo-alignment-v5/native')
parser.add_argument('--ids', help='Optional comma-separated smoke-test subset.')
parser.add_argument('--allow-stale', action='store_true', help='Only for smoke testing a prior exported snapshot; reported in evidence.')
parser.add_argument('--no-lumen-cleanup', action='store_true')
ARGS = parser.parse_args()
OUT = ARGS.output.resolve(); OUT.mkdir(parents=True, exist_ok=True)
INPUT = ARGS.input.resolve()
read_json = lambda p: json.loads(p.read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
review = read_json(INPUT/'review.json'); caps = read_json(INPUT/'caps.json')
if caps.get('exportSha256') != sha((INPUT/'review.json').read_bytes()):
    raise RuntimeError('CT caps do not belong to this accepted geometry export; run sample-caps.mjs again.')
captured_shaders = read_json(INPUT/'shaders.json')
W,H = review['width'],review['height']
selected = set(ARGS.ids.split(',')) if ARGS.ids else None
cases = [c for c in review['cases'] if selected is None or c['id'] in selected]
if selected and selected != {c['id'] for c in cases}:
    raise RuntimeError('One or more requested view IDs are absent from the export.')
stale = [p for p,h in review['sourceHashes'].items() if sha((ROOT/p).read_bytes()) != h]
if stale and not ARGS.allow_stale:
    raise RuntimeError('Production sources changed after export; export again: '+', '.join(stale))

# Reuse only the established native EGL setup and verified-volume decoder.
# All rendering below has a single real color/depth target; this is not the
# old coarse-silhouette probe script and does not invoke a browser library.
base = ROOT/'tests/brightness-v12-render.py'
native = {'__file__':str(base),'__name__':'echo_alignment_native_fixture'}
saved_argv=sys.argv;sys.argv=[str(base),'--output',str(OUT)]
exec(compile(base.read_text().split('profiles = ')[0],str(base),'exec'),native)
sys.argv=saved_argv
tree=ast.parse(base.read_text())
for node_ in tree.body:
    if isinstance(node_,ast.FunctionDef) and node_.name=='load_volume':
        exec(compile(ast.Module(body=[node_],type_ignores=[]),str(base),'exec'),native)
for name in ['P','I','U','F','fn','use','loc','ui','uf','u2','u3','active','bind','param','t2','t3','texture','profile_uniforms','load_volume','buf','donors','public_path']:
    globals()[name]=native[name]
native['sources']=dict(captured_shaders['volume'])
program=native['compile_program'](native['sources']['volume'])
native['sources']['vertex']=captured_shaders['geometry']['vertex']
geometry_program=native['compile_program'](captured_shaders['geometry']['fragment'])
native['sources']['vertex']=captured_shaders['volume']['vertex']
gl_error=fn('glGetError',U,[])
gl_string=fn('glGetString',C.c_char_p,[U])
driver={k:gl_string(v).decode() for k,v in [('vendor',0x1F00),('renderer',0x1F01),('version',0x1F02),('shadingLanguageVersion',0x8B8C)]}
enable=fn('glEnable',None,[U]);disable=fn('glDisable',None,[U])
bind_fbo=fn('glBindFramebuffer',None,[U,U]);viewport=fn('glViewport',None,[I,I,I,I])
draw_arrays=fn('glDrawArrays',None,[U,I,I]);bind_buffer=fn('glBindBuffer',None,[U,U])
bind_vao=fn('glBindVertexArray',None,[U]);depth_mask=fn('glDepthMask',None,[U])
depth_func=fn('glDepthFunc',None,[U]);cull_face=fn('glCullFace',None,[U])
vertex_pointer=fn('glVertexAttribPointer',None,[U,I,U,U,I,P])
enable_attribute=fn('glEnableVertexAttribArray',None,[U])
buffer_data=fn('glBufferData',None,[U,C.c_ssize_t,P,U])
uniform_matrix=fn('glUniformMatrix4fv',None,[I,I,U,P])
uniform4=fn('glUniform4f',None,[I,F,F,F,F])
volume_vao,geometry_vao=U(),U()
fn('glGenVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(volume_vao))
fn('glGenVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(geometry_vao))

extra_textures=[]
def upload_2d(slot,internal,width,height,format_,type_,data=None,linear=False):
    tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));extra_textures.append(tex)
    active(0x84C0+slot);bind(0x0DE1,tex)
    for key,value in [(0x2801,0x2601 if linear else 0x2600),(0x2800,0x2601 if linear else 0x2600),(0x2802,0x812F),(0x2803,0x812F)]:
        param(0x0DE1,key,value)
    t2(0x0DE1,0,internal,width,height,0,format_,type_,data.ctypes.data if data is not None else None)
    assert gl_error()==0,('texture upload',slot)
    return tex

# Actual reviewed lumen fields can be routed through the production sampler.
# Local surface replacement/exclusion is intentionally disabled: the resident
# volume has no corresponding fine replacement mesh in this review harness.
mask_path=ROOT/'public/assets/reviewed-mask-v32/manifest.json'
mask_manifest=read_json(mask_path);mask_asset=mask_manifest['asset']
packed=public_path(mask_asset['url']).read_bytes()
assert sha(packed)==mask_asset['sha256']
decoded=gzip.decompress(packed);assert sha(decoded)==mask_asset['decodedSha256']
ix,px=mask_manifest['indexTexture'],mask_manifest['payloadTexture']
index_data=np.frombuffer(decoded,'<u4',count=ix['byteLength']//4,offset=ix['offset']).copy()
payload_data=np.frombuffer(decoded,np.uint8,count=px['byteLength'],offset=px['offset']).copy()
upload_2d(6,0x8236,ix['width'],ix['height'],0x8D94,0x1405,index_data)
upload_2d(7,0x8058,px['width'],px['height'],0x1908,0x1401,payload_data)
mask_offsets=np.asarray([f['indexOffset'] for f in mask_manifest['fields']],np.int32)
mask_grids=np.asarray([f['brickGridXYZ'] for f in mask_manifest['fields']],np.int32)
lumen_fields=[(i,f) for i,f in enumerate(mask_manifest['fields']) if f['kind']=='lumen']
assert len(lumen_fields)==4
color_texture=upload_2d(8,0x8058,W,H,0x1908,0x1401)
depth_texture=upload_2d(9,0x81A6,W,H,0x1902,0x1405)
framebuffer=U();fn('glGenFramebuffers',None,[I,C.POINTER(U)])(1,C.byref(framebuffer))
bind_fbo(0x8D40,framebuffer)
attach=fn('glFramebufferTexture2D',None,[U,U,U,U,I])
attach(0x8D40,0x8CE0,0x0DE1,color_texture,0);attach(0x8D40,0x8D00,0x0DE1,depth_texture,0)
assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5

donor=next(d for d in donors if d['id']==review['donor'])
manifest=read_json(public_path(donor['manifestUrl']));level=manifest['levels']['high']
source=load_volume(level);texture(0,source,True)
cleanup=read_json(public_path(donor['cleanupManifestUrl']))
cleanup_packed=public_path(cleanup['volumeUrl']).read_bytes();cleanup_raw=gzip.decompress(cleanup_packed)
assert cleanup['sha256'] in (sha(cleanup_packed),sha(cleanup_raw))
cleanup_data=np.frombuffer(cleanup_raw,np.uint8).reshape(*cleanup['dimensions'][::-1]).copy();texture(2,cleanup_data)
extent=np.asarray(caps['extent']);dims=np.asarray(level['dimensions'])
assert np.max(np.abs(extent-np.asarray(mask_manifest['extent'])))<1e-12
assert abs(caps['referenceMm']-review['referenceMm'])<1e-8
cap_index={c['id']:c for c in caps['caps']}
settings=donor['displayWindow'];threshold=.32
vertex_buffers={}
identity=np.eye(4,dtype=np.float32).flatten(order='F')
for asset in review['assets']:
    data=(INPUT/asset['file']).read_bytes();assert sha(data)==asset['sha256']
    vertices=np.frombuffer(data,'<f4').copy();buffer=U()
    fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer))
    bind_buffer(0x8892,buffer);buffer_data(0x8892,vertices.nbytes,vertices.ctypes.data,0x88E4)
    vertex_buffers[asset['file']]={'buffer':buffer,'count':len(vertices)//6}

def volume_pass(case,camera,cap):
    use(program);bind_vao(volume_vao);bind_fbo(0x8D40,framebuffer);viewport(0,0,W,H)
    disable(0x0BE2);disable(0x0B44);enable(0x0B71);depth_func(0x0207);depth_mask(1)
    fn('glClearColor',None,[F,F,F,F])(0,0,0,1);fn('glClearDepthf',None,[F])(1)
    fn('glClear',None,[U])(0x4000|0x0100)
    bind_buffer(0x8892,buf);position=fn('glGetAttribLocation',I,[U,C.c_char_p])(program,b'position')
    enable_attribute(position);vertex_pointer(position,2,0x1406,0,0,None)
    for name,slot in dict(volume=0,capTexture=1,cleanupTexture=2,anatomyTexture=3,accelerationTexture=4,sceneTexture=5,reviewedMaskIndex=6,reviewedMaskPayload=7,sceneDepthTexture=14).items():ui(program,name,slot)
    profile_uniforms(program,settings)
    p=case['plane'];n=np.asarray(p['normal'])*(-1 if case['clipFlip'] else 1)
    values=dict(cleanupReady=1,cleanupEnabled=1,anatomyReady=0,mode=0,palette=4,clipAxis=-1 if case['outsideScan'] else 3,
        clipFlip=int(case['clipFlip']),showPlanes=0,capReady=0 if case['outsideScan'] else 1,capCleaned=0,skipCap=0,
        surfaceSmoothing=1,accelerationReady=0,reviewedMaskReady=1,lumenCleanupReady=1,lumenCleanupEnabled=not ARGS.no_lumen_cleanup,
        lumenMaskCount=4,lumenMaskBitPacked=1,refinementReady=0,refinementCount=0)
    for name,value in values.items():ui(program,name,value)
    fn('glUniform1iv',None,[I,I,P])(loc(program,b'reviewedMaskOffsets[0]'),8,mask_offsets.ctypes.data)
    fn('glUniform3iv',None,[I,I,P])(loc(program,b'reviewedMaskGrids[0]'),8,mask_grids.ctypes.data)
    u3(program,'lumenFineDimensions',mask_manifest['sourceFullDimensionsXYZ'])
    for j,(field,f) in enumerate(lumen_fields):
        ui(program,'lumenMaskField'+str(j),field);u3(program,'lumenMaskOrigin'+str(j),f['lowerFullFineXYZ']);u3(program,'lumenMaskDimensions'+str(j),f['dimensionsXYZ'])
    normalized_step=min(extent[0]/(dims[0]-1),extent[2]/(dims[1]-1),extent[1]/(dims[2]-1))*.65
    for name,value in dict(fov=.32,cameraAspect=W/H,threshold=threshold,opacity=.8,stepSize=normalized_step,clipPosition=.5,planeDistance=np.dot(n,p['center'])).items():uf(program,name,value)
    for name,value in dict(dimensions=dims,textureDimensions=dims,textureOffset=[0,0,0],cleanupDimensions=cleanup['dimensions'],anatomyDimensions=[1,1,1],extent=extent,
        planeNormal=n,capCenter=p['center'],capRight=p['right'],capUp=p['up'],slicePositions=[.5,.5,.5],**camera['basis']).items():u3(program,name,value)
    u2(program,'resolution',[W,H]);u2(program,'capSize',[p['width'],p['height']]);u2(program,'capRasterSize',[cap.shape[1],cap.shape[0]])
    draw_arrays(4,0,3);assert gl_error()==0,('volume pass',case['id'])

def geometry_pass(case,camera,key):
    use(geometry_program);bind_vao(geometry_vao);viewport(0,0,W,H)
    enable(0x0B71);depth_func(0x0203);enable(0x0BE2);disable(0x0B44)
    fn('glBlendFuncSeparate',None,[U,U,U,U])(0x0302,0x0303,1,0x0303)
    for name,value in [('eye',camera['basis']['eye']),('forward',camera['basis']['forward']),('cameraRight',camera['basis']['right']),('cameraUp',camera['basis']['up'])]:u3(geometry_program,name,value)
    uf(geometry_program,'referenceMm',review['referenceMm']);uf(geometry_program,'aspect',W/H)
    position=fn('glGetAttribLocation',I,[U,C.c_char_p])(geometry_program,b'position')
    normal=fn('glGetAttribLocation',I,[U,C.c_char_p])(geometry_program,b'normal')
    enable_attribute(position);enable_attribute(normal)
    for command in case['drawsByCamera'][key]:
        mesh=vertex_buffers[command['file']];bind_buffer(0x8892,mesh['buffer'])
        vertex_pointer(position,3,0x1406,0,24,None);vertex_pointer(normal,3,0x1406,0,24,P(12))
        matrix=np.asarray(command['model'],np.float32) if command['model'] is not None else identity
        uniform_matrix(loc(geometry_program,b'model'),1,0,matrix.ctypes.data)
        uniform4(loc(geometry_program,b'color'),*command['color'],command['alpha']);uf(geometry_program,'gloss',command['gloss'])
        if command['cull']:
            enable(0x0B44);cull_face(0x0404 if command['cull']=='front' else 0x0405)
        else:disable(0x0B44)
        depth_mask(int(command['alpha']>.7));draw_arrays(4,0,mesh['count'])
    depth_mask(1);disable(0x0B44);disable(0x0BE2)
    assert gl_error()==0,('geometry pass',case['id'],key)

def read_pixels():
    fn('glFinish',None,[])();a=np.empty((H,W,4),np.uint8)
    fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,W,H,0x1908,0x1401,a.ctypes.data)
    assert gl_error()==0
    return a[::-1].copy()

def rgba(color):
    if color.startswith('rgba('):
        r,g,b,a=map(float,re.findall(r'[\d.]+',color));return (round(r),round(g),round(b),round(a*255))
    return (*ImageColor.getrgb(color),255)

def replay_guides(image,commands):
    # Exact production projected paths/colors, with native antialiased 2D
    # stroke rasterization. This is not a claim of Canvas2D pixel identity.
    ratio=3;layer=Image.new('RGBA',(W*ratio,H*ratio));draw=ImageDraw.Draw(layer)
    for command in commands:
        points=[(p[0]*ratio,p[1]*ratio) for p in command['points']]
        if len(points)<2:continue
        color=rgba(command['color'])
        if command['kind']=='fill':draw.polygon(points,fill=color);continue
        if command['closed']:points.append(points[0])
        width=max(1,round(command.get('width',1)*ratio));dash=command.get('dash',[])
        if not dash:draw.line(points,fill=color,width=width,joint='curve');continue
        pattern=[v*ratio for v in dash];segment=0;remaining=pattern[0];paint=True
        for a,b in zip(points,points[1:]):
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy);at=0
            if length<1e-9:continue
            while at<length-1e-9:
                step=min(remaining,length-at)
                if paint:draw.line([(a[0]+dx*at/length,a[1]+dy*at/length),(a[0]+dx*(at+step)/length,a[1]+dy*(at+step)/length)],fill=color,width=width)
                at+=step;remaining-=step
                if remaining<=1e-9:segment=(segment+1)%len(pattern);remaining=pattern[segment];paint=segment%2==0
    image=Image.alpha_composite(image.convert('RGBA'),layer.resize((W,H),Image.Resampling.LANCZOS))
    return image.convert('RGB')

font_root=Path('/usr/share/fonts/truetype/dejavu')
font=lambda size,bold=False:ImageFont.truetype(str(font_root/('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')),size)
def fit_text(draw,text,width,initial=14,bold=False):
    size=initial
    while size>9 and draw.textlength(text,font=font(size,bold))>width:size-=1
    return font(size,bold)

def contact_sheet(mode,key,rendered):
    chosen=[c for c in cases if c['mode']==mode]
    if not chosen:return None
    cols=4;cell_w=320;cell_h=round(H/W*cell_w);header=88;caption=57;rows=math.ceil(len(chosen)/cols)
    sheet=Image.new('RGB',(cols*cell_w,header+rows*(cell_h+caption)+40),(9,16,20));d=ImageDraw.Draw(sheet)
    anchor='Anchor by Probe View' if key=='probe' else 'Anchor by Anatomy'
    d.text((16,12),f'{mode.upper()} · {anchor} · {len(chosen)} views',font=font(23,True),fill='#f0eee7')
    d.text((16,44),'Production GLSL + measured 317.6 µm CT + fixed illustrative anatomy',font=font(15),fill='#b3c3c5')
    d.text((16,66),'Exact accepted cut / shared depth. Outside-scan targets have no CT cap.',font=font(12),fill='#899fa4')
    for i,c in enumerate(chosen):
        x=(i%cols)*cell_w;y=header+(i//cols)*(cell_h+caption)
        im=Image.open(OUT/f"{c['mode']}-{c['id']}-{key}.jpg");sheet.paste(im.resize((cell_w,cell_h),Image.Resampling.LANCZOS),(x,y))
        title=f"{c['code']} · {c.get('tableRow') or ('ASE '+str(c.get('aseNumber')))}"
        d.text((x+9,y+cell_h+5),title,font=fit_text(d,title,cell_w-18,14,True),fill='#e8ece9')
        name=c.get('shortName') or c['name'];d.text((x+9,y+cell_h+25),name,font=fit_text(d,name,cell_w-18,12),fill='#9fb5b8')
        if c['outsideScan']:d.text((x+cell_w-116,y+8),'OUTSIDE SCAN',font=font(11,True),fill='#e5c08b')
    d.text((16,sheet.height-34),'CT: Brunet et al. / ESRF Human Organ Atlas · BodyParts3D: © DBCLS · CC BY 4.0',font=font(12),fill='#899fa4')
    d.text((16,sheet.height-17),'Native scientific render, not a browser screenshot. Reference anatomy and probe are not patient registered.',font=font(11),fill='#768f95')
    path=OUT/f'{mode}-{key}-gallery.jpg';sheet.save(path,quality=94);return path.name

started=time.monotonic();rendered=[]
print(json.dumps({'driver':driver,'views':len(cases),'output':[W,H],'residentSourceSpacingUm':caps['sourceSpacingUm']}),flush=True)
for c in cases:
    cap_meta=cap_index[c['id']]
    if cap_meta['available']:
        raw=(INPUT/cap_meta['file']).read_bytes();assert sha(raw)==cap_meta['sha256']
        cap=np.frombuffer(raw,np.uint8).reshape(cap_meta['height'],cap_meta['width']).copy()
        Image.fromarray(cap).save(OUT/f"{c['mode']}-{c['id']}-ct-source.png")
    else:cap=np.zeros((2,2),np.uint8)
    texture(1,cap,True)
    images={}
    for key,camera in c['cameras'].items():
        t0=time.monotonic();volume_pass(c,camera,cap);geometry_pass(c,camera,key)
        pixels=read_pixels();image=replay_guides(Image.fromarray(pixels),c['guidesByCamera'][key]);images[key]=image
        filename=f"{c['mode']}-{c['id']}-{key}.jpg";image.save(OUT/filename,quality=95,subsampling=0)
        item={'id':c['id'],'mode':c['mode'],'camera':key,'image':filename,'capSha256':cap_meta.get('sha256'),'outsideScan':c['outsideScan'],
            'draws':len(c['drawsByCamera'][key]),'guideCommands':len(c['guidesByCamera'][key]),'glError':int(gl_error()),'elapsedSeconds':round(time.monotonic()-t0,3)}
        rendered.append(item);print(json.dumps(item),flush=True)
    pair=Image.new('RGB',(W*2,H+88),(9,16,20));pair.paste(images['probe'],(0,60));pair.paste(images['anatomy'],(W,60));d=ImageDraw.Draw(pair)
    d.text((16,8),f"{c['mode'].upper()} · {c['code']} · {c['name']}",font=fit_text(d,c['name'],W*2-32,18,True),fill='#e8ece9')
    d.text((16,35),'Anchor by Probe View',font=font(14),fill='#9eb7b8');d.text((W+16,35),'Anchor by Anatomy',font=font(14),fill='#9eb7b8')
    note='Outside acquired scan: illustrative probe/context only; no fabricated CT section.' if c['outsideScan'] else 'Measured 317.6 µm source · exact same accepted plane and cap in both cameras · illustrative fixed body'
    d.text((16,H+66),note,font=font(12),fill='#9fb2b6');pair.save(OUT/f"{c['mode']}-{c['id']}-pair.jpg",quality=94)
galleries=[contact_sheet(mode,key,rendered) for mode in ['tte','tee'] for key in ['probe','anatomy']]
evidence={'schemaVersion':1,'passed':all(r['glError']==0 for r in rendered),'views':len(cases),'renders':len(rendered),'dimensions':[W,H],
    'scope':__doc__,'sourceSpacingUm':caps['sourceSpacingUm'],'sourceDimensions':caps['sourceDimensions'],'sourceManifestSha256':caps['manifestSha256'],
    'sourceParts':caps['sourceParts'],'mprWorkerSha256':caps['workerSha256'],'shaderSourcesSha256':sha((INPUT/'shaders.json').read_bytes()),
    'sourceAttribution':{k:manifest.get(k) for k in ['attribution','license','licenseUrl','datasetUrl','doiUrl']},'anatomy':review['models'],
    'exportSha256':sha((INPUT/'review.json').read_bytes()),'sourceHashes':review['sourceHashes'],'staleSourceFiles':stale,'driver':driver,
    'depth':{'shared':True,'near':.01,'far':10,'attachment':'DEPTH_COMPONENT24','heartDepthFunction':'ALWAYS; production shader gl_FragDepth','geometryDepthFunction':'LEQUAL; production shared geometry shader','translucentContextWritesDepth':False},
    'display':{'palette':4,'threshold':threshold,**settings,'reviewedLumenCleanup':not ARGS.no_lumen_cleanup,'localReplacementMeshes':False,'localExclusionFields':False,'fineOrUltraSource':False},
    'cap':{'actualProductionWorker':True,'rasterCount':sum(cap_index[c['id']]['available'] for c in cases),'outsideScanCount':sum(c['outsideScan'] for c in cases),'metadata':caps['caps']},
    'acceptedViews':[{'id':c['id'],'mode':c['mode'],'outsideScan':c['outsideScan'],'clipFlip':c['clipFlip'],
        'plane':{k:c['plane'][k] for k in ['center','right','up','normal','width','height']},'acquisition':c['plane'].get('acquisition'),
        'pose':c['pose'],'cameras':c['cameras'],'sourceRaster':None if c['outsideScan'] else f"{c['mode']}-{c['id']}-ct-source.png"} for c in cases],
    'guide':'Actual production projected Canvas2D vector commands, antialiased by Pillow; sector guides intentionally unoccluded, as in production. Font callouts are omitted; projected paths/colors are preserved, not Canvas2D pixel equivalence.',
    'limitations':['Not a browser screenshot or browser performance measurement.','Resident source spacing 317.6 µm; not the 79.4 µm Ultra surface or 19.85 µm native region.','Local fine replacement meshes/exclusions are omitted together; current reviewed lumen masks and baseline source-support cleanup are applied.','Illustrative body/instruments are fixed references, not clinically registered patient anatomy.','No clinical correspondence validation is inferred from geometric coplanarity.'],
    'galleries':[g for g in galleries if g],'elapsedSeconds':round(time.monotonic()-started,2),'checks':rendered}
(OUT/'review.json').write_text(json.dumps(evidence,indent=2)+'\n')
print(json.dumps({'passed':evidence['passed'],'views':len(cases),'renders':len(rendered),'galleries':evidence['galleries'],'elapsedSeconds':evidence['elapsedSeconds'],'report':str(OUT/'review.json')}),flush=True)
