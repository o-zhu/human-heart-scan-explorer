"""Compare production GLSL lossless mask sampling against dense reference samples.

Uses native EGL, not browser automation. Includes all four fields, X byte edges,
unused tail bits, ROI edges and offsets near the nearest-neighbor boundaries.
"""
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
base=ROOT/'tests/brightness-v12-render.py'
if '--output' not in sys.argv:sys.argv+=['--output',str(ROOT/'docs/cleanup-v26/bitpack')]
exec(compile(base.read_text().split('profiles = ')[0],str(base),'exec'))

program=compile_program(sources['volume'].split('void main(){')[0]+'''
uniform float sampleOffset;
void main(){
 int index=int(floor(gl_FragCoord.x))+int(floor(gl_FragCoord.y))*128;
 ivec3 cell=ivec3(index%41,(index/41)%17,index/(41*17));
 vec3 f=vec3(cell)+vec3(sampleOffset);
 float value=lumenExcluded(fromTex(f/(lumenFineDimensions-1.)));
 fragColor=vec4(value,value,value,1.);
}
''')
full=np.array([41,17,13]);expected=np.zeros(tuple(full[::-1]),np.uint8)
masks=[];rng=np.random.default_rng(20261106)
for i,(lo,dim) in enumerate([([1,1,1],[19,9,7]),([21,2,2],[17,8,6]),([5,11,3],[25,5,8]),([29,7,9],[11,9,3])]):
    a=(rng.random(tuple(dim[::-1]))>.62).astype(np.uint8)
    x,y,z=lo;dx,dy,dz=dim
    expected[z:z+dz,y:y+dy,x:x+dx]|=a
    masks.append((lo,dim,a))
    tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex))
    active(0x84C0+6+i);bind(0x806F,tex)
    for key,value in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812F),(0x2803,0x812F),(0x8072,0x812F)]:param(0x806F,key,value)

width,height=128,int(np.ceil(np.prod(full)/128));checks=[]
for packed in [False,True]:
    target(program,width,height)
    ui(program,'lumenCleanupReady',1);ui(program,'lumenCleanupEnabled',1)
    ui(program,'lumenMaskCount',4);ui(program,'lumenMaskBitPacked',packed)
    u3(program,'lumenFineDimensions',full);u3(program,'extent',[.9,1,.9])
    for i,(lo,dim,a) in enumerate(masks):
        active(0x84C0+6+i)
        data=np.packbits(a,axis=2,bitorder='little') if packed else a*255
        t3(0x806F,0,0x8229,*data.shape[::-1],0,0x1903,0x1401,data.ctypes.data)
        ui(program,'lumenMaskTexture'+str(i),6+i);u3(program,'lumenMaskOrigin'+str(i),lo);u3(program,'lumenMaskDimensions'+str(i),dim)
    for offset in [-.499,0,.499]:
        uf(program,'sampleOffset',offset)
        result=pixels(width,height)[::-1,:,0].reshape(-1)[:np.prod(full)]
        assert np.array_equal(result,expected.reshape(-1)*255),(packed,offset,int(np.count_nonzero(result!=expected.reshape(-1)*255)))
        checks.append(dict(bitPacked=packed,offset=offset,samples=int(np.prod(full)),exact=True))
    ui(program,'lumenCleanupEnabled',0)
    assert not pixels(width,height)[:,:,:3].any()
report=dict(passed=True,productionShaderSha256=hashlib.sha256(sources['volume'].encode()).hexdigest(),checks=checks,
    logicalSamples=int(sum(a.size for _,_,a in masks)),packedBytes=int(sum(np.packbits(a,axis=2,bitorder='little').nbytes for _,_,a in masks)),
    scope='Production GLSL in native EGL; exact dense-versus-bitpacked logical samples and off restoration, not browser performance or anatomy validation.')
(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
