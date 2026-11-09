"""Render the calibrated live probe fan from unchanged measured source data."""
from common import *

report=read('docs/tee-plane-qc-v2/free-lab-calibration.json')
volume,_=load_volume();labels=load_labels();items=[]
for result in report['presets']:
 state=result['state'];depth=state['depthMm']/MM;half=np.deg2rad(state['angleDeg']/2)
 origin=source_point(np.array(result['originMm'])/168.0104)
 beam=source_vec(result['beam']);right=source_vec(result['right']);width=2*depth*np.sin(half)
 f=frame(origin+beam*depth/2,right,-beam,width,depth)
 pixels,regions=sample(volume,f,650,labels);ny,nx=pixels.shape
 x=np.linspace(-width/2,width/2,nx);y=np.linspace(0,depth,ny);X,Y=np.meshgrid(x,y)
 mask=(X*X+Y*Y<=depth*depth)&(np.abs(np.arctan2(X,Y))<=half)
 pixels[~mask]=0;regions[~mask]=0
 items.append((image(pixels,regions),f"{result['id']} • {state['multiplaneDeg']:g}° model preset",f"depth {state['depthMm']:.0f}mm · sector {state['angleDeg']:.0f}° · measured source"))
contact_sheet(items,OUT/'free-lab-source-fans.jpg','Calibrated free-lab fans • nominal clinical angles; illustrative physical tract',cols=2,cell=650,row=650)
print('Rendered four measured-source fans from actual runtime teePose outputs.')
