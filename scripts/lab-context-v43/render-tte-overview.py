"""Render captured production TTE linked-chest draws in native EGL.

Measured coarse donor outlines, exact probe/sector coordinates and fixed fitted
context. This verifies rendering and spatial display, not browser screenshots,
clinical registration, fine-detail fidelity or physical-device performance.
"""
from pathlib import Path
import argparse
import ctypes as C
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
OUT = args.output.resolve(); OUT.mkdir(parents=True, exist_ok=True)
INPUT = args.input.resolve()
sha = lambda data: hashlib.sha256(data).hexdigest()
report = json.loads((INPUT/'review.json').read_text())
for path, expected in report['sourceHashes'].items():
    assert sha((ROOT/path).read_bytes()) == expected, ('stale runtime', path)
shaders = json.loads((INPUT/'shaders.json').read_text())
W, H = report['width'], report['height']
exec((ROOT/'scripts/verify-shader.py').read_text().split("create=fn('glCreateShader'")[0])
F = C.c_float
create = fn('glCreateShader', U, [U]); shader_source = fn('glShaderSource', None, [U,I,C.POINTER(C.c_char_p),C.POINTER(I)])
compile_shader = fn('glCompileShader', None, [U]); shader_status = fn('glGetShaderiv', None, [U,U,C.POINTER(I)])
shader_log = fn('glGetShaderInfoLog', None, [U,I,C.POINTER(I),C.c_char_p])
program = fn('glCreateProgram', U, [])()
for key, kind in [('vertex',0x8B31),('fragment',0x8B30)]:
    shader = create(kind); text = C.c_char_p(shaders[key].encode()); shader_source(shader,1,C.byref(text),None); compile_shader(shader)
    ok = I(); shader_status(shader,0x8B81,C.byref(ok)); log = C.create_string_buffer(16384); shader_log(shader,16384,None,log)
    assert ok.value, log.value.decode()
    fn('glAttachShader',None,[U,U])(program,shader)
fn('glLinkProgram',None,[U])(program); ok=I(); fn('glGetProgramiv',None,[U,U,C.POINTER(I)])(program,0x8B82,C.byref(ok)); assert ok.value
fn('glUseProgram',None,[U])(program)
loc=fn('glGetUniformLocation',I,[U,C.c_char_p]); uf=fn('glUniform1f',None,[I,F]); u3=fn('glUniform3f',None,[I,F,F,F])
u4=fn('glUniform4f',None,[I,F,F,F,F]); um=fn('glUniformMatrix4fv',None,[I,I,U,P])
color,depth,fbo=U(),U(),U()
fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(color));fn('glBindTexture',None,[U,U])(0x0DE1,color)
fn('glTexImage2D',None,[U,I,I,I,I,I,U,U,P])(0x0DE1,0,0x8058,W,H,0,0x1908,0x1401,None)
fn('glGenFramebuffers',None,[I,C.POINTER(U)])(1,C.byref(fbo));fn('glBindFramebuffer',None,[U,U])(0x8D40,fbo)
fn('glFramebufferTexture2D',None,[U,U,U,U,I])(0x8D40,0x8CE0,0x0DE1,color,0)
fn('glGenRenderbuffers',None,[I,C.POINTER(U)])(1,C.byref(depth));fn('glBindRenderbuffer',None,[U,U])(0x8D41,depth)
fn('glRenderbufferStorage',None,[U,U,I,I])(0x8D41,0x81A6,W,H);fn('glFramebufferRenderbuffer',None,[U,U,U,U])(0x8D40,0x8D00,0x8D41,depth)
assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5
position=fn('glGetAttribLocation',I,[U,C.c_char_p])(program,b'position'); normal=fn('glGetAttribLocation',I,[U,C.c_char_p])(program,b'normal')
for attribute in [position,normal]:fn('glEnableVertexAttribArray',None,[U])(attribute)
buffers={}
for asset in report['assets']:
    data=(INPUT/asset['file']).read_bytes();assert sha(data)==asset['sha256'];vertices=np.frombuffer(data,'<f4').copy();buffer=U()
    fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));fn('glBindBuffer',None,[U,U])(0x8892,buffer)
    fn('glBufferData',None,[U,C.c_ssize_t,P,U])(0x8892,vertices.nbytes,vertices.ctypes.data,0x88E4);buffers[asset['file']]=(buffer,len(vertices)//6)
identity=np.eye(4,dtype=np.float32).ravel()
get_error=fn('glGetError',U,[]); depth_range=fn('glDepthRangef',None,[F,F]); depth_mask=fn('glDepthMask',None,[U])

def render(case, context=True, heart_only=False):
    depth_range(0,1);depth_mask(1);fn('glViewport',None,[I,I,I,I])(0,0,W,H)
    fn('glClearColor',None,[F,F,F,F])(0,0,0,0);fn('glClearDepthf',None,[F])(1);fn('glClear',None,[U])(0x4000|0x0100)
    fn('glEnable',None,[U])(0x0B71);fn('glDepthFunc',None,[U])(0x0203);fn('glEnable',None,[U])(0x0BE2);fn('glDisable',None,[U])(0x0B44)
    fn('glBlendFuncSeparate',None,[U,U,U,U])(0x0302,0x0303,1,0x0303)
    for name,value in [('eye',case['basis']['eye']),('forward',case['basis']['forward']),('cameraRight',case['basis']['right']),('cameraUp',case['basis']['up'])]:u3(loc(program,name.encode()),*value)
    uf(loc(program,b'referenceMm'),case['referenceMm']);uf(loc(program,b'aspect'),W/H)
    for i,command in enumerate(case['draws']):
        if heart_only and i>0:break
        if not context and command['depthRange']==[1,1]:continue
        buffer,count=buffers[command['file']];fn('glBindBuffer',None,[U,U])(0x8892,buffer)
        fn('glVertexAttribPointer',None,[U,I,U,U,I,P])(position,3,0x1406,0,24,None)
        fn('glVertexAttribPointer',None,[U,I,U,U,I,P])(normal,3,0x1406,0,24,P(12))
        matrix=np.asarray(command['model'],np.float32) if command['model'] is not None else identity
        um(loc(program,b'model'),1,0,matrix.ctypes.data);u4(loc(program,b'color'),*command['color'],command['alpha']);uf(loc(program,b'gloss'),command['gloss'])
        depth_range(*command['depthRange']);depth_mask(command['alpha']>.7);fn('glDrawArrays',None,[U,I,I])(4,0,count);depth_mask(1)
    depth_range(0,1);fn('glFinish',None,[])();pixels=np.empty((H,W,4),np.uint8)
    fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,W,H,0x1908,0x1401,pixels.ctypes.data)
    assert get_error()==0
    return pixels[::-1].copy()

font_path='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font=lambda size:ImageFont.truetype(font_path,size)
images={};checks=[]
for case in report['cases']:
    heart=render(case,heart_only=True);mask=heart[:,:,3]>250;assert mask.sum()>100
    without=render(case,context=False);pixels=render(case)
    assert np.array_equal(without[mask],pixels[mask]), ('context tinted measured heart',case['donor'],case['preset'])
    assert np.count_nonzero(np.any(without[~mask]!=pixels[~mask],axis=1))>500
    # Composite the transparent geometry against the dark CSS pane background.
    alpha=pixels[:,:,3:4]/255;rgb=pixels[:,:,:3].astype(float)+np.array([12,22,24])*(1-alpha)
    image=Image.fromarray(np.uint8(np.clip(rgb,0,255)))
    name='-'.join([case['donor'],case['preset'],case['variant'],case['camera']])
    images[name]=image;checks.append({k:case[k] for k in ['donor','preset','variant','camera','sourcePlaneOutsideHeartBounds'] }|{'heartPixels':int(mask.sum()),'heartPixelsUnchangedByContext':True,'glError':0})
    if case['preset']=='apical' and case['camera']=='oblique':image.save(OUT/(name+'.jpg'),quality=90)
for donor in report['donors']:
    selected=[case for case in report['cases'] if case['donor']==donor['id']]
    cw,ch=280,round(H/W*280);caption=48;header=78
    sheet=Image.new('RGB',(cw*4,header+4*(ch+caption)+40),'#0b1215');draw=ImageDraw.Draw(sheet)
    draw.text((14,10),donor['id']+' · linked chest / measured donor outline',font=font(20),fill='#e0e8dc')
    draw.text((14,38),'Each row: start front / start oblique / missed plane front / missed plane oblique',font=font(13),fill='#a9bfb4')
    draw.text((14,58),'Probe/plane are exact donor coordinates; the fitted reference chest stays fixed.',font=font(12),fill='#8fa79e')
    for index,case in enumerate(selected):
        x=(index%4)*cw;y=header+(index//4)*(ch+caption);name='-'.join([case['donor'],case['preset'],case['variant'],case['camera']])
        sheet.paste(images[name].resize((cw,ch),Image.Resampling.LANCZOS),(x,y))
        draw.text((x+9,y+ch+5),case['name'],font=font(13),fill='#dfdfcc')
        draw.text((x+9,y+ch+25),case['variant']+' · '+case['camera'],font=font(12),fill='#b5c7b9')
    draw.text((14,sheet.height-31),'Native production render; coarse orientation display, not a browser screenshot or patient registration.',font=font(11),fill='#93a69b')
    draw.text((14,sheet.height-16),'Measured source: Human Organ Atlas / ESRF. Reference context: BodyParts3D / DBCLS · CC BY 4.0.',font=font(11),fill='#93a69b')
    sheet.save(OUT/(donor['id']+'-overview-review.jpg'),quality=90)
evidence={'passed':True,'scope':__doc__,'cases':len(checks),'sourceHashes':report['sourceHashes'],'exportSha256':sha((INPUT/'review.json').read_bytes()),'shaderSha256':sha((INPUT/'shaders.json').read_bytes()),'donors':report['donors'],'checks':checks,'driver':fn('glGetString',C.c_char_p,[U])(0x1F01).decode()}
(OUT/'verification.json').write_text(json.dumps(evidence,indent=2)+'\n')
print(json.dumps({'passed':True,'cases':len(checks),'output':str(OUT)}))
