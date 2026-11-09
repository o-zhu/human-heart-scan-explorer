"""Native production-shader orientation review; not browser layout QA."""
from pathlib import Path
import sys
REPO=Path(__file__).resolve().parents[1]
__file__=str(REPO/'scripts/verify-clinical-native-v19.py')
if '--output' not in sys.argv: sys.argv += ['--output',str(REPO/'docs/slicerheart-ui-v1')]
exec(compile((REPO/'scripts/verify-clinical-native-v19.py').read_text().split('checks=[];captures={}')[0],__file__,'exec'))
# The current renderer adds an integer mask sampler; keep its sampler type on
# its own unit even though masks are disabled for this clinical series.
for slot,internal,fmt,dtype,empty in [(6,0x8236,0x8D94,0x1405,np.zeros(1,np.uint32)),(7,0x8058,0x1908,0x1401,np.zeros(4,np.uint8))]:
 tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));textures.append(tex)
 active(0x84C0+slot);bind(0x0DE1,tex)
 t2(0x0DE1,0,internal,1,1,0,fmt,dtype,empty.ctypes.data)
 for key,value in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812F),(0x2803,0x812F)]:param(0x0DE1,key,value)
base_target=target
def target(program,width,height):
 base_target(program,width,height)
 for name,value in dict(reviewedMaskIndex=6,reviewedMaskPayload=7,reviewedMaskReady=0,lumenCleanupReady=0,lumenCleanupEnabled=0).items():ui(program,name,value)
W=H=480
manifest=json.loads((ROOT/'public/assets/clinical-v19/slicerheart/manifest.json').read_text()); series=manifest['series'][0]
data=frame_data(series);texture(0,data,True)
# Reuse exact production geometry/uniform setup, with an uncut camera basis.
oldcapture=capture
source=(REPO/'scripts/verify-clinical-native-v19.py').read_text()
func=source[source.index('def capture('):source.index('checks=[];captures={}')]
func=func.replace('def capture(','def whole_capture(').replace('distance=None):','distance=None,yaw=1.15):')
func=func.replace('direction=unit(normal+(.32*right0+.10*up0 if oblique else 0))','center=np.zeros(3);up0=np.array([0,1,0]);direction=np.array([math.sin(yaw)*math.cos(.12),math.sin(.12),math.cos(yaw)*math.cos(.12)])')
func=func.replace('clipAxis=axis,','clipAxis=-1,')
exec(compile(func,__file__,'exec'))
uprightfunc=source[source.index('def capture('):source.index('checks=[];captures={}')]
uprightfunc=uprightfunc.replace('def capture(','def upright_capture(').replace('forward=-direction;right=','up0=-up0;forward=-direction;right=')
exec(compile(uprightfunc,__file__,'exec'))
frames=[]
for yaw in [.32,1.15,-1.15,2.0]:
 im,meta=whole_capture(series,yaw=yaw)
 Image.fromarray(im).save(OUT/f'whole-yaw-{yaw}.png');frames.append((f'Whole volume | yaw {yaw}',im))
 print(json.dumps({'yaw':yaw,'foreground':meta['foregroundPixels']}),flush=True)
for axis in [0,1]:
 position=[54/144,62/124][axis]
 im,meta=oldcapture(series,axis=axis,position=position)
 frames.append((['Sagittal','Coronal'][axis]+' | previous',im))
 im,meta=upright_capture(series,axis=axis,position=position)
 frames.append((['Sagittal','Coronal'][axis]+' | upright',im))
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
sheet=Image.new('RGB',(W*4,(H+35)*2),(8,13,16));pen=ImageDraw.Draw(sheet)
for i,(name,im) in enumerate(frames):
 x=(i%4)*W;y=(i//4)*(H+35);sheet.paste(Image.fromarray(im[:,:,:3]),(x,y+35));pen.text((x+10,y+9),name,fill='#e8efeb',font=font)
sheet.save(OUT/'root-camera-review.jpg',quality=90)
print(str(OUT/'root-camera-review.jpg'),flush=True)
