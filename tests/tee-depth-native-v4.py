"""Independent native EGL review of production TEE depth composition.

Synthetic slabs/cavities exercise the actual volume, fine-surface, cut-face and
shared-context GLSL. They establish rendering behavior, not anatomical accuracy,
browser compatibility, performance, or acquired source detail.
"""
from pathlib import Path
import sys

NATIVE_REVIEW_SCOPE = __doc__
ROOT = Path(__file__).resolve().parents[1]
base = ROOT / 'tests/brightness-v12-render.py'
if '--output' not in sys.argv:
    sys.argv += ['--output', str(ROOT / 'docs/tee-spatial-v4/native')]
exec(compile(base.read_text().split('profiles = ')[0], str(base), 'exec'))

BASELINE = '5ee02eb261e372b1e864a282434939d92ea6c391'
extra = node('''
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {fineSurfaceShaderSources} from './public/fine-surface.js';
import {sharedGeometryShaderSources} from './public/probe-scene.js';
const old=execFileSync('git',['show',''' + json.dumps(BASELINE + ':public/renderer.js') + '''],{encoding:'utf8'});
const absolute=old.replace(/from (['"])(\\.\\/[^'"]+)\\1/g,(_,q,path)=>'from '+q+new URL(path,pathToFileURL(process.cwd()+'/public/renderer.js')).href+q);
const prior=await import('data:text/javascript;base64,'+Buffer.from(absolute).toString('base64'));
console.log(JSON.stringify({fine:fineSurfaceShaderSources,context:sharedGeometryShaderSources,prior:prior.volumeShaderSources}));
''')


def compile_pair(vertex, fragment):
    saved = sources['vertex']
    sources['vertex'] = vertex
    try:
        return compile_program(fragment)
    finally:
        sources['vertex'] = saved


prior_program = compile_pair(extra['prior']['vertex'], extra['prior']['volume'])
fine_program = compile_pair(extra['fine']['vertex'], extra['fine']['fragment'])
context_program = compile_pair(extra['context']['vertex'], extra['context']['fragment'])
background_program = compile_program(extra['fine']['background'])
bind_fbo = fn('glBindFramebuffer', None, [U, U])
viewport = fn('glViewport', None, [I, I, I, I])
draw_arrays = fn('glDrawArrays', None, [U, I, I])
enable = fn('glEnable', None, [U])
disable = fn('glDisable', None, [U])
depth_func = fn('glDepthFunc', None, [U])
depth_mask = fn('glDepthMask', None, [U])
clear_depth = fn('glClearDepthf', None, [F])
clear = fn('glClear', None, [U])
bind_array = fn('glBindVertexArray', None, [U])
bind_buffer = fn('glBindBuffer', None, [U, U])
get_attrib = fn('glGetAttribLocation', I, [U, C.c_char_p])
enable_attrib = fn('glEnableVertexAttribArray', None, [U])
attrib_pointer = fn('glVertexAttribPointer', None, [U, I, U, U, I, P])
get_error = fn('glGetError', U, [])
W, H, REF = 320, 320, 168.0104


def output(w=W, h=H, linear_color=False):
    color, depth, fb = U(), U(), U()
    fn('glGenTextures', None, [I, C.POINTER(U)])(1, C.byref(color))
    fn('glGenTextures', None, [I, C.POINTER(U)])(1, C.byref(depth))
    for tex, slot, internal, fmt, dtype in [(color, 5, 0x8058, 0x1908, 0x1401), (depth, 14, 0x81A6, 0x1902, 0x1405)]:
        active(0x84C0+slot);bind(0x0DE1,tex)
        t2(0x0DE1,0,internal,w,h,0,fmt,dtype,None)
        filtering=0x2601 if slot==5 and linear_color else 0x2600
        for key,value in [(0x2801,filtering),(0x2800,filtering),(0x2802,0x812F),(0x2803,0x812F)]:param(0x0DE1,key,value)
    fn('glGenFramebuffers',None,[I,C.POINTER(U)])(1,C.byref(fb));bind_fbo(0x8D40,fb)
    attach=fn('glFramebufferTexture2D',None,[U,U,U,U,I])
    attach(0x8D40,0x8CE0,0x0DE1,color,0);attach(0x8D40,0x8D00,0x0DE1,depth,0)
    assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5
    return dict(texture=color,depth=depth,framebuffer=fb,width=w,height=h)


def read(out):
    bind_fbo(0x8D40,out['framebuffer']);fn('glFinish',None,[])()
    result=np.empty((out['height'],out['width'],4),np.uint8)
    fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,out['width'],out['height'],0x1908,0x1401,result.ctypes.data)
    error=get_error();assert error==0,hex(error)
    return result[::-1].copy()


def screen_triangle(program):
    bind_array(0);bind_buffer(0x8892,buf)
    position=get_attrib(program,b'position');enable_attrib(position)
    attrib_pointer(position,2,0x1406,0,0,None)


def common(program,out,clip=False,cap=False,skip=False):
    use(program);bind_fbo(0x8D40,out['framebuffer']);viewport(0,0,out['width'],out['height'])
    for name,slot in dict(volume=0,capTexture=1,cleanupTexture=2,anatomyTexture=3,accelerationTexture=4,sceneTexture=5,sceneDepthTexture=14).items():ui(program,name,slot)
    for name,value in dict(cleanupReady=0,cleanupEnabled=0,lumenCleanupReady=0,lumenCleanupEnabled=0,refinementReady=0,refinementCount=0,anatomyReady=0,anatomySelected=0,mode=0,palette=4,clipAxis=3 if clip else -1,clipFlip=0,showPlanes=0,capReady=cap,capCleaned=1,skipCap=skip,surfaceSmoothing=1,accelerationReady=0,sceneDepthReady=0,windowEnabled=0).items():ui(program,name,value)
    for name,value in dict(fov=.32,cameraAspect=1,threshold=.28,opacity=.8,stepSize=.006,clipPosition=.5,planeDistance=.06,capContrast=1.8,windowLow=0,windowHigh=1,windowGamma=1,cutFaceExposure=1.35).items():uf(program,name,value)
    for name,value in dict(dimensions=[64,64,64],textureDimensions=[64,64,64],textureOffset=[0,0,0],cleanupDimensions=[1,1,1],anatomyDimensions=[1,1,1],extent=[1,1,1],planeNormal=[0,0,1],capCenter=[0,0,.06],capRight=[1,0,0],capUp=[0,1,0],eye=[0,0,2],forward=[0,0,-1],right=[1,0,0],up=[0,1,0],slicePositions=[.5,.5,.5]).items():u3(program,name,value)
    u2(program,'resolution',[out['width'],out['height']]);u2(program,'capSize',[1,1]);u2(program,'capRasterSize',[256,256])
    disable(0x0BE2);disable(0x0B44);enable(0x0B71);depth_mask(1);depth_func(0x0207)


def volume(out,program=programs['volume'],**options):
    common(program,out,**options);screen_triangle(program);draw_arrays(4,0,3)
    return read(out)


def composite(scene,out,**options):
    program=programs['composite'];common(program,out,**options);screen_triangle(program)
    active(0x84C5);bind(0x0DE1,scene['texture']);active(0x84CE);bind(0x0DE1,scene['depth']);ui(program,'sceneDepthReady',1)
    draw_arrays(4,0,3);return read(out)


def new_vertex_storage(data,attributes):
    vao,buffer=U(),U();fn('glGenVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(vao));bind_array(vao)
    fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));bind_buffer(0x8892,buffer)
    fn('glBufferData',None,[U,C.c_ssize_t,P,U])(0x8892,data.nbytes,data.ctypes.data,0x88E4)
    for location,offset in attributes:
        enable_attrib(location);attrib_pointer(location,3,0x1406,0,24,P(offset))
    return vao,buffer


def rectangles(rects,z):
    vertices=[]
    for x0,x1,y0,y1 in rects:
        for x,y in [(x0,y0),(x1,y0),(x1,y1),(x0,y0),(x1,y1),(x0,y1)]:vertices.append([x,y,z,0,0,1])
    return np.asarray(vertices,np.float32)


def context(out,z,alpha=.38,rects=None):
    # The actual shared-context projection, shading, blend and depth state.
    p=context_program;use(p);bind_fbo(0x8D40,out['framebuffer']);viewport(0,0,out['width'],out['height'])
    vertices=rectangles(rects or [(-.44,.44,-.44,.44)],z);vertices[:,:3]*=REF
    vao,buffer=new_vertex_storage(vertices,[(get_attrib(p,b'position'),0),(get_attrib(p,b'normal'),12)])
    for name,value in dict(eye=[0,0,2],forward=[0,0,-1],cameraRight=[1,0,0],cameraUp=[0,1,0]).items():u3(p,name,value)
    uf(p,'referenceMm',REF);uf(p,'aspect',1);uf(p,'gloss',.08)
    identity=np.eye(4,dtype=np.float32);fn('glUniformMatrix4fv',None,[I,I,U,P])(loc(p,b'model'),1,0,identity.ctypes.data)
    fn('glUniform4f',None,[I,F,F,F,F])(loc(p,b'color'),.16,.74,.60,alpha)
    enable(0x0B71);depth_func(0x0203);depth_mask(alpha>.7);disable(0x0B44);enable(0x0BE2)
    fn('glBlendFuncSeparate',None,[U,U,U,U])(0x0302,0x0303,1,0x0303)
    draw_arrays(4,0,len(vertices));depth_mask(1);disable(0x0BE2);bind_array(0)
    fn('glDeleteBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));fn('glDeleteVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(vao))
    return read(out)


def fine_scene(out,clip=False):
    use(background_program);bind_fbo(0x8D40,out['framebuffer']);viewport(0,0,out['width'],out['height'])
    disable(0x0B71);disable(0x0BE2);u2(background_program,'resolution',[out['width'],out['height']]);ui(background_program,'palette',4)
    screen_triangle(background_program);draw_arrays(4,0,3)
    clear_depth(1);depth_mask(1);clear(0x0100)
    common(fine_program,out,clip=clip,skip=True)
    ui(fine_program,'debrisCleanupEnabled',0);ui(fine_program,'nativeReplacementEnabled',0);ui(fine_program,'nativePatchPass',0);ui(fine_program,'refinementPatchPass',0)
    u3(fine_program,'boundsMin',[-.5,-.5,-.5]);u3(fine_program,'boundsMax',[.5,.5,.5])
    ring=[(-.3,-.11,-.3,.3),(.11,.3,-.3,.3),(-.11,.11,-.3,-.11),(-.11,.11,.11,.3)]
    vertices=rectangles(ring,.12);vertices[:,:3]+=.5
    vao,buffer=new_vertex_storage(vertices,[(0,0),(1,12)])
    fn('glDisableVertexAttribArray',None,[U])(2);fn('glVertexAttrib1f',None,[U,F])(2,0)
    depth_func(0x0203);draw_arrays(4,0,len(vertices));bind_array(0)
    fn('glDeleteBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));fn('glDeleteVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(vao))
    return read(out)


full,comp,low=output(),output(),output(128,128,linear_color=True)
zsrc,ysrc,xsrc=np.indices((64,64,64));x=xsrc/63-.5;y=zsrc/63-.5;z=.5-ysrc/63
material=(abs(x)<.30)&(abs(y)<.30)&(abs(z)<.12)&((x*x+y*y)>.11**2)
fixture=np.where(material,210,0).astype(np.uint8);texture(0,fixture,True)
cy,cx=np.indices((256,256));capx=cx/255-.5;capy=.5-cy/255
# Fine-only islands include a feature through the resident cavity. Fine caps
# must supply their own exact depth, not inherit a coarse scene's empty pixel.
cap_mask=((abs(capx)<.27)&(abs(capy)<.27)&~((capx>.04)&(capx<.14)&(abs(capy)<.06)))
cap_data=np.where(cap_mask,210,0).astype(np.uint8);texture(1,cap_data,True)
checks=[];plates=[]


def verify_case(name,render,out,open_center=True):
    before=render();mask=before[:,:,:3].max(2)>22
    assert mask.sum()>2000,(name,'nontrivial tissue')
    behind=context(out,-.22)
    test_mask=mask
    assert np.array_equal(before[test_mask],behind[test_mask]),(name,'context leaked through opaque tissue',int(np.count_nonzero(np.any(before[test_mask]!=behind[test_mask],axis=1))))
    if open_center:assert np.max(np.abs(behind[H//2,W//2,:3].astype(int)-before[H//2,W//2,:3]))>12,(name,'open cavity did not reveal context')
    else:assert np.array_equal(behind[H//2,W//2],before[H//2,W//2]),(name,'fine-only cap island failed to occlude')
    assert np.count_nonzero(np.any(behind[~mask]!=before[~mask],axis=1))>3000,(name,'context lost outside tissue')
    render();front=context(out,.24)
    changed=np.any(front[test_mask]!=before[test_mask],axis=1)
    assert changed.sum()>.90*len(changed),(name,'foreground context incorrectly hidden')
    render();contour=context(out,-.22,alpha=.55,rects=[(.185,.195,-.43,.43)])
    assert np.array_equal(before[test_mask],contour[test_mask]),(name,'rear contour leaked through tissue')
    assert np.count_nonzero(np.any(contour[~mask]!=before[~mask],axis=1))>15,(name,'rear contour erased everywhere')
    checks.append(dict(case=name,tissuePixels=int(test_mask.sum()),rearContextUnchanged=True,rearContourUnchanged=True,foregroundContextVisible=True,
      centerAssertion=dict(passed=True,expected='rear context visible through open cavity' if open_center else 'rear context occluded by fine-only cap island'),
      tissueFootprint=dict(mode='full fixture footprint, including interpolation edges',threshold='maximum RGB channel > 22',excludedEdgePixels=0)))
    plates.extend([(before,name+' · source fixture'),(behind,name+' · context behind'),(front,name+' · context in front')])


# Adding depth writes alone must not change the synthetic source fixture's RGB.
for clipped in [False,True]:
    before=volume(full,program=prior_program,clip=clipped,cap=clipped)
    after=volume(full,clip=clipped,cap=clipped)
    assert np.array_equal(before,after),('no-context RGB changed',clipped)
    checks.append(dict(case='No-context color invariance',clipped=clipped,exactRGBAEquality=True))

verify_case('Resident surface',lambda:volume(full),full)
verify_case('Resident cut face',lambda:volume(full,clip=True,cap=False),full)
verify_case('Exact fine cut face',lambda:volume(full,clip=True,cap=True),full,open_center=False)


def moving_composite():
    volume(low,clip=True,cap=True,skip=True)
    return composite(low,comp,clip=True,cap=True)


def moving_surface():
    volume(low)
    return composite(low,comp)


verify_case('Preview + resident surface',moving_surface,comp)
verify_case('Preview + exact fine cap',moving_composite,comp,open_center=False)


def surface_composite():
    fine_scene(full)
    return composite(full,comp)


verify_case('Fine mesh + depth composite',surface_composite,comp)


def fine_cap_composite():
    fine_scene(full,clip=True)
    return composite(full,comp,clip=True,cap=True)


verify_case('Fine mesh + exact cap',fine_cap_composite,comp,open_center=False)

# A copy through the compositor must keep both color and usable geometry depth.
raw=fine_scene(full);copied=composite(full,comp)
assert np.array_equal(raw,copied), 'Fine scene changed color during depth composition'
checks.append(dict(case='Fine-mesh no-context composite',exactRGBAEquality=True))

canvas=Image.new('RGB',(W*3,(H+30)*(len(plates)//3)),'#0b1011');draw=ImageDraw.Draw(canvas)
for index,(pixels,label) in enumerate(plates):
    col,row=index%3,index//3;canvas.paste(Image.fromarray(pixels).convert('RGB'),(col*W,row*(H+30)+30))
    draw.text((col*W+9,row*(H+30)+9),label,fill='#d3ded7')
canvas.save(OUT/'depth-occlusion-fixtures.jpg',quality=92)
shader_map=dict(volume=sources['volume'],composite=sources['composite'],fineVertex=extra['fine']['vertex'],fineFragment=extra['fine']['fragment'],contextVertex=extra['context']['vertex'],contextFragment=extra['context']['fragment'])
report=dict(passed=True,scope=NATIVE_REVIEW_SCOPE,baselineCommit=BASELINE,driver=fn('glGetString',C.c_char_p,[U])(0x1F01).decode(),shaderHashes={key:hashlib.sha256(text.encode()).hexdigest() for key,text in shader_map.items()},checks=checks,glError=get_error())
(OUT/'depth-occlusion-check.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(passed=True,checks=len(checks),glError=report['glError'],output=str(OUT)),indent=2))
