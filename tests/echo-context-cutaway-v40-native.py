"""Native production-geometry/GLSL review of the fixed LADAF spine cutaway.

Local reference anatomy only. Diagnostic opacity is raised to expose surface
intersections; this is not a screenshot, acquired donor anatomy, or device test.
Run echo-context-clearance-v40.py --export /dev/shm/context-polish-v40/verified first.
"""
from pathlib import Path
import sys

NATIVE_REFERENCE_SCOPE=__doc__
ROOT=Path(__file__).resolve().parents[1]
input_arg=next((v.split('=',1)[1]for v in sys.argv if v.startswith('--input=')),'/dev/shm/context-polish-v40/verified')
sys.argv=[v for v in sys.argv if not v.startswith('--input=')]
INPUT=Path(input_arg)
if '--output' not in sys.argv:sys.argv+=['--output',str(ROOT/'docs/echo-polish-v40/native-context')]
base=ROOT/'tests/tee-depth-native-v4.py'
setup=base.read_text().split('full,comp,low=output()')[0].replace("prior_program = compile_pair(extra['prior']['vertex'], extra['prior']['volume'])","prior_program = None")
exec(compile(setup,str(base),'exec'))

record=next(r for r in read_json(INPUT/'models.json')if r['donorId']=='ladaf-2021-17')
geometry={}
for id_,file in record['files'].items():
    data=(INPUT/file['file']).read_bytes();assert hashlib.sha256(data).hexdigest()==file['sha256']
    vertices=np.frombuffer(data,'<f4').reshape(-1,6).copy()
    vao,buffer=new_vertex_storage(vertices,[(get_attrib(context_program,b'position'),0),(get_attrib(context_program,b'normal'),12)])
    geometry[id_]=dict(vao=vao,buffer=buffer,count=len(vertices),**file)

out=output(440,540);ref=record['referenceMm'];views=[('Anterior',[0,0,1]),('Oblique',[.85,.08,1]),('Lateral',[1,.03,.08])]
target=np.array([-15,24,-69])/ref;identity=np.eye(4,dtype=np.float32)
def unit(v):return np.asarray(v)/np.linalg.norm(v)
def render(view,which):
    away=unit(view);eye=target+away*1.15;forward=-away;right=unit(np.cross(forward,[0,1,0]));up=unit(np.cross(right,forward))
    p=context_program;use(p);bind_fbo(0x8D40,out['framebuffer']);viewport(0,0,out['width'],out['height'])
    fn('glClearColor',None,[F,F,F,F])(.025,.04,.045,1);clear_depth(1);depth_mask(1);clear(0x4000|0x0100)
    for name,value in dict(eye=eye,forward=forward,cameraRight=right,cameraUp=up).items():u3(p,name,value)
    uf(p,'referenceMm',ref);uf(p,'aspect',out['width']/out['height']);uf(p,'gloss',.055)
    fn('glUniformMatrix4fv',None,[I,I,U,P])(loc(p,b'model'),1,0,identity.ctypes.data)
    enable(0x0B71);depth_func(0x0203);depth_mask(0);enable(0x0BE2);enable(0x0B44)
    fn('glBlendFuncSeparate',None,[U,U,U,U])(0x0302,0x0303,1,0x0303)
    for cull in [0x0404,0x0405]:
        fn('glCullFace',None,[U])(cull)
        for name,alpha in [(which,.40),('esophagus',.50)]:
            mesh=geometry[name];bind_array(mesh['vao'])
            fn('glUniform4f',None,[I,F,F,F,F])(loc(p,b'color'),*mesh['color'],alpha)
            draw_arrays(4,0,mesh['count'])
    disable(0x0B44);disable(0x0BE2);depth_mask(1);bind_array(0)
    return read(out)

panel_h=out['height']+34;canvas=Image.new('RGB',(out['width']*2,panel_h*len(views)+46),'#0b1011');draw=ImageDraw.Draw(canvas)
draw.text((12,10),'Reference anatomy only / diagnostic opacity / identical cameras',fill='#d3ded7')
for row,(label,view) in enumerate(views):
    for col,id_ in enumerate(['before','after']):
        pixels=render(view,id_);x=col*out['width'];y=46+row*panel_h
        draw.text((x+12,y+9),label+' / '+('original intersection' if id_=='before' else 'fixed reference-spine cutaway'),fill='#d3ded7')
        canvas.paste(Image.fromarray(pixels).convert('RGB'),(x,y+34))
canvas.save(OUT/'spine-cutaway-before-after.jpg',quality=92)
report={'passed':True,'scope':NATIVE_REFERENCE_SCOPE,'driver':fn('glGetString',C.c_char_p,[U])(0x1F01).decode(),'diagnosticAlpha':{'spine':.4,'esophagus':.5},'views':[v[0]for v in views],'source':record,'glError':get_error(),'shaderSha256':hashlib.sha256(extra['context']['fragment'].encode()).hexdigest()}
assert report['glError']==0
(OUT/'spine-render-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':True,'views':len(views),'glError':report['glError'],'output':str(OUT)}))
