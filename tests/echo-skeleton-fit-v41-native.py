"""Native review of actual original and fitted reference skeleton/GI geometry.

Uses current production context GLSL and verified reference meshes. Diagnostic
opacity is raised to expose intersections. These are reference-anatomy images,
not acquired donor anatomy, website screenshots or physical-device tests.
Run echo-skeleton-fit-v41.py --export /dev/shm/context-fit-v41/final first.
"""
from pathlib import Path
import sys

NATIVE_SKELETON_SCOPE=__doc__
ROOT=Path(__file__).resolve().parents[1]
input_arg=next((v.split('=',1)[1]for v in sys.argv if v.startswith('--input=')),'/dev/shm/context-fit-v41/final')
sys.argv=[v for v in sys.argv if not v.startswith('--input=')];INPUT=Path(input_arg)
if '--output' not in sys.argv:sys.argv+=['--output',str(ROOT/'docs/echo-mobile-v41/native-skeleton')]
base=ROOT/'tests/tee-depth-native-v4.py'
setup=base.read_text().split('full,comp,low=output()')[0].replace("prior_program = compile_pair(extra['prior']['vertex'], extra['prior']['volume'])","prior_program = None")
exec(compile(setup,str(base),'exec'))

record=read_json(INPUT/'model.json');geometry={}
for id_,file in record['files'].items():
    if id_=='skin':continue
    data=(INPUT/file['file']).read_bytes();assert hashlib.sha256(data).hexdigest()==file['sha256']
    vertices=np.frombuffer(data,'<f4').reshape(-1,6).copy()
    vao,buffer=new_vertex_storage(vertices,[(get_attrib(context_program,b'position'),0),(get_attrib(context_program,b'normal'),12)])
    geometry[id_]=dict(vao=vao,buffer=buffer,count=len(vertices),**file)
out=output(440,520);ref=record['frame']['referenceMm'];identity=np.eye(4,dtype=np.float32)
views=[('Complete skeleton',[.45,.06,1],[-20,12,-15],3.0),('Esophagus / spine',[1,.025,.12],[-20,23,-65],1.12)]
def unit(v):return np.asarray(v)/np.linalg.norm(v)
def render(view,target,distance,which):
    target=np.asarray(target)/ref;away=unit(view);eye=target+away*distance;forward=-away;right=unit(np.cross(forward,[0,1,0]));up=unit(np.cross(right,forward))
    p=context_program;use(p);bind_fbo(0x8D40,out['framebuffer']);viewport(0,0,out['width'],out['height'])
    fn('glClearColor',None,[F,F,F,F])(.025,.04,.045,1);clear_depth(1);depth_mask(1);clear(0x4000|0x0100)
    for name,value in dict(eye=eye,forward=forward,cameraRight=right,cameraUp=up).items():u3(p,name,value)
    uf(p,'referenceMm',ref);uf(p,'aspect',out['width']/out['height']);uf(p,'gloss',.055)
    fn('glUniformMatrix4fv',None,[I,I,U,P])(loc(p,b'model'),1,0,identity.ctypes.data)
    enable(0x0B71);depth_func(0x0203);depth_mask(0);enable(0x0BE2);enable(0x0B44)
    fn('glBlendFuncSeparate',None,[U,U,U,U])(0x0302,0x0303,1,0x0303)
    for cull in [0x0404,0x0405]:
        fn('glCullFace',None,[U])(cull)
        for name,alpha in [('bones-'+which,.18),('spine-'+which,.4),('esophagus',.5),('stomach',.16)]:
            mesh=geometry[name];bind_array(mesh['vao'])
            fn('glUniform4f',None,[I,F,F,F,F])(loc(p,b'color'),*mesh['color'],alpha)
            draw_arrays(4,0,mesh['count'])
    disable(0x0B44);disable(0x0BE2);depth_mask(1);bind_array(0)
    return read(out)

panel_h=out['height']+34;canvas=Image.new('RGB',(out['width']*2,panel_h*len(views)+46),'#0b1011');draw=ImageDraw.Draw(canvas)
draw.text((12,10),'Actual reference meshes / diagnostic opacity / identical cameras',fill='#d3ded7')
for row,(label,view,target,distance) in enumerate(views):
    for col,which in enumerate(['before','after']):
        pixels=render(view,target,distance,which);x=col*out['width'];y=46+row*panel_h
        draw.text((x+12,y+9),label+' / '+('original intact geometry' if which=='before' else 'fitted intact skeleton'),fill='#d3ded7')
        canvas.paste(Image.fromarray(pixels).convert('RGB'),(x,y+34))
canvas.save(OUT/'skeleton-fit-before-after.jpg',quality=92)
report={'passed':True,'scope':NATIVE_SKELETON_SCOPE,'driver':fn('glGetString',C.c_char_p,[U])(0x1F01).decode(),'views':[v[0]for v in views],'reference':record,'glError':get_error(),
    'sourceHashes':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()for p in ['public/echo-skeleton-fit.js','public/echo-anatomy-context-v2.js','public/tee-scene.js']},'shaderSha256':hashlib.sha256(extra['context']['fragment'].encode()).hexdigest()}
assert report['glError']==0
(OUT/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':True,'views':len(views),'glError':report['glError'],'output':str(OUT)}))
