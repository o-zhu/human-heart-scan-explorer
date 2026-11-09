"""Production GLSL/EGL proof of the heart-priority contextual cutaway.

Uses synthetic source/fine-mesh/cap fixtures to check compositing, not clinical
anatomy, browser performance or device compatibility. No new GPU mask is used.
"""
from pathlib import Path
import sys

NATIVE_CONTEXT_SCOPE=__doc__
ROOT=Path(__file__).resolve().parents[1]
if '--output' not in sys.argv:
    sys.argv += ['--output',str(ROOT/'docs/echo-polish-v40/native-context')]
base=ROOT/'tests/tee-depth-native-v4.py'
# Reuse its current-program/EGL fixture setup, not the historical color-compare
# program (that old renderer imports mask GLSL from a different revision).
setup=base.read_text().split('full,comp,low=output()')[0].replace("prior_program = compile_pair(extra['prior']['vertex'], extra['prior']['volume'])","prior_program = None")
exec(compile(setup,str(base),'exec'))
# Modern production shaders always declare the reviewed-mask integer index.
# Even when disabled, its sampler must not alias a floating-point volume unit.
empty_mask_textures=[]
for slot,internal,format_,type_,data in [(6,0x8236,0x8D94,0x1405,np.zeros((1,1),np.uint32)),(7,0x8058,0x1908,0x1401,np.zeros((1,1,4),np.uint8))]:
    tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));empty_mask_textures.append(tex)
    active(0x84C0+slot);bind(0x0DE1,tex);t2(0x0DE1,0,internal,1,1,0,format_,type_,data.ctypes.data)
    for key,value in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812F),(0x2803,0x812F)]:param(0x0DE1,key,value)
legacy_common=common
def common(program,out,**options):
    legacy_common(program,out,**options)
    ui(program,'reviewedMaskIndex',6);ui(program,'reviewedMaskPayload',7);ui(program,'reviewedMaskReady',0)
    ui(program,'coronaryTexture',8);ui(program,'coronaryReady',0);active(0x84C0+8);bind(0x806F,textures[0])
depth_range=fn('glDepthRangef',None,[F,F])
scope=node("""
import {withHeartPriority} from './public/echo-context-presentation.js';
const state={};const gl={enable(){},depthFunc(){},depthMask(){},depthRange(a,b){state.range=[a,b];}};
let during;withHeartPriority(gl,()=>during=[...state.range]);console.log(JSON.stringify({during,after:state.range}));
""")
assert scope=={'during':[1,1],'after':[0,1]}

full,comp,low=output(),output(),output(128,128,linear_color=True)
zsrc,ysrc,xsrc=np.indices((64,64,64));x=xsrc/63-.5;y=zsrc/63-.5;z=.5-ysrc/63
material=(abs(x)<.30)&(abs(y)<.30)&(abs(z)<.12)&((x*x+y*y)>.11**2)
texture(0,np.where(material,210,0).astype(np.uint8),True)
cy,cx=np.indices((256,256));capx=cx/255-.5;capy=.5-cy/255
cap_mask=((abs(capx)<.27)&(abs(capy)<.27)&~((capx>.04)&(capx<.14)&(abs(capy)<.06)))
texture(1,np.where(cap_mask,210,0).astype(np.uint8),True)
checks=[];plates=[]

def priority_context(out,z,**options):
    depth_range(*scope['during'])
    try:return context(out,z,**options)
    finally:depth_range(*scope['after'])

def verify(name,render,out,open_center=True):
    before=render();mask=before[:,:,:3].max(2)>22
    assert mask.sum()>2000,(name,'nontrivial tissue')
    for label,z in [('foreground',.24),('background',-.22)]:
        render();after=priority_context(out,z)
        assert np.array_equal(before[mask],after[mask]),(name,label,'context tinted accepted heart/cap')
        assert np.count_nonzero(np.any(before[~mask]!=after[~mask],axis=1))>3000,(name,'context missing outside tissue')
        if open_center:assert np.max(np.abs(after[H//2,W//2,:3].astype(int)-before[H//2,W//2,:3]))>12,(name,'open cavity closed')
        else:assert np.array_equal(before[H//2,W//2],after[H//2,W//2]),(name,'fine cap island tinted')
        plates.append((after,name+' / '+label))
    render();outline=priority_context(out,.24,alpha=.55,rects=[(.185,.195,-.43,.43)])
    assert np.array_equal(before[mask],outline[mask]),(name,'foreground contour tinted heart')
    render();probe=context(out,.24,alpha=1)
    assert np.count_nonzero(np.any(before[mask]!=probe[mask],axis=1))>.90*mask.sum(),(name,'instrument lost normal depth')
    checks.append(dict(case=name,heartPixels=int(mask.sum()),foregroundAndRearContextExactRGBA=True,contourExactRGBA=True,instrumentPerspectivePreserved=True,openCavity=open_center))

verify('Resident surface',lambda:volume(full),full)
verify('Resident cap',lambda:volume(full,clip=True,cap=False),full)
verify('Exact fine cap',lambda:volume(full,clip=True,cap=True),full,False)
def moving():
    volume(low,clip=True,cap=True,skip=True);return composite(low,comp,clip=True,cap=True)
verify('Moving volume + exact cap',moving,comp,False)
def fine():
    fine_scene(full);return composite(full,comp)
verify('Prepared fine mesh',fine,comp)
def fine_cut():
    fine_scene(full,clip=True);return composite(full,comp,clip=True,cap=True)
verify('Fine mesh + exact cap',fine_cut,comp,False)

canvas=Image.new('RGB',(W*2,(H+30)*len(checks)),'#0b1011');draw=ImageDraw.Draw(canvas)
for i,(pixels,label) in enumerate(plates):
    col,row=i%2,i//2;canvas.paste(Image.fromarray(pixels).convert('RGB'),(col*W,row*(H+30)+30));draw.text((col*W+9,row*(H+30)+9),label,fill='#d3ded7')
canvas.save(OUT/'heart-priority-context.jpg',quality=90)
report=dict(passed=True,scope=NATIVE_CONTEXT_SCOPE,driver=fn('glGetString',C.c_char_p,[U])(0x1F01).decode(),checks=checks,glError=get_error(),additionalMaskAllocations=0,
 sourceHashes={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()for p in ['public/echo-context-presentation.js','public/tee-scene.js','public/tte-atlas-geometry.js','public/renderer.js','public/fine-surface.js']})
assert report['glError']==0
(OUT/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(passed=True,cases=len(checks),glError=report['glError'],output=str(OUT))))
