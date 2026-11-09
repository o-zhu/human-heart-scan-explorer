"""Reproducible approximate oblique anatomy frames for LADAF-2021-17.
This is manual visual calibration of a fixed specimen, not a segmentation,
patient coordinate registration, acoustic simulation, or diagnostic validation.
"""
from pathlib import Path
import argparse
import json
import numpy as np
from scipy.ndimage import map_coordinates
from PIL import Image, ImageDraw

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data-root',type=Path,default=Path.cwd()/'heart-data')
parser.add_argument('--volume',type=Path,help='Input s4-volume-u16.npy (default: DATA_ROOT/s4-volume-u16.npy)')
parser.add_argument('--output',type=Path,default=Path.cwd()/'echo-geometry',help='Directory for echo-planes.json and its review contact sheet')
args=parser.parse_args()
OUT=args.output.resolve(); OUT.mkdir(parents=True,exist_ok=True)
RAW=(args.volume or args.data_root/'s4-volume-u16.npy').resolve()
DIMS=np.array([475.,475.,530.]); SPAN=DIMS-1; WORLD_SCALE=529.
def unit(v):
    a=np.asarray(v,dtype=float);return a/np.linalg.norm(a)
def arr(v): return [round(float(a),9) for a in v]
def to_world_vector(v): return np.array([v[0],v[2],-v[1]])
def to_world_point(p): return np.array([p[0]-237.,p[2]-264.5,237.-p[1]])/WORLD_SCALE
apex=np.array([191.,252.,478.]); base=np.array([282.,280.,281.])
long_axis=unit(base-apex)
rv_mid=np.array([180.,190.,350.]); lv_mid=apex+(350-apex[2])/(base[2]-apex[2])*(base-apex)
# This direction was visually checked against the RV-like thin-wall crescent.
r4=unit(np.array([-1.,-1.,0.])-long_axis*np.dot([-1.,-1.,0.],long_axis))
n4=unit(np.cross(r4,long_axis)); center=apex+.78*(base-apex)
def radial(deg):
    t=np.deg2rad(deg); return unit(r4*np.cos(t)+n4*np.sin(t))
frames={}
def add(key,p,r,u,width=.72,height=.95,confidence='approximate',note='',family='',copy_of=None):
    p=np.array(p,dtype=float);r=unit(r);u=unit(u-r*np.dot(r,u));n=unit(np.cross(r,u))
    frames[key]={
        'id':key,'confidence':confidence,'family':family,'note':note,
        'voxelXYZ':{'center':arr(p),'normal':arr(n),'right':arr(r),'up':arr(u),'width':width*WORLD_SCALE,'height':height*WORLD_SCALE},
        'sourceNormalized':{'center':arr(p/SPAN),'normal':arr(unit(n*SPAN)),
                            'rightPerWorldUnit':arr(r*WORLD_SCALE/SPAN),'upPerWorldUnit':arr(u*WORLD_SCALE/SPAN)},
        'world':{'center':arr(to_world_point(p)),'normal':arr(to_world_vector(n)),'right':arr(to_world_vector(r)),'up':arr(to_world_vector(u)),
                 'width':width,'height':height,'widthWorld':width,'heightWorld':height},
        'sourcePlaneEquation':'dot(sourceNormalized.normal, sourceTextureXYZ - sourceNormalized.center) = 0'
    }
    if copy_of:frames[key]['sameAnatomicPlaneAs']=copy_of
add('a4c',center,-r4,-long_axis,confidence='approximate, visually checked',family='ventricular long axis',note='LV apex/base axis and interventricular direction were checked in the raw volume. Both ventricular cavities are visible; valve/atrial segmentation is unavailable. Educational four-chamber-like starting plane.')
add('a2c',center,-radial(90),-long_axis,confidence='approximate, visually checked',family='ventricular long axis',note='90-degree rotation about the estimated LV long axis. Visually gives an LV/atrial long section with most of the RV excluded; exact mitral/atrial landmarks are not segmented.')
add('a3c',center,-radial(120),-long_axis,confidence='provisional; adjust to anatomy',family='ventricular long axis',note='120-degree rotation about the estimated LV axis. Useful LV long-axis starting plane; LV outflow/aortic-valve inclusion is not verified. Bright superior tube remains unclassified.')
add('plax',center,long_axis,-radial(120),width=.95,height=.72,confidence='provisional; adjust to anatomy',family='ventricular long axis',note='Same geometric plane as the provisional three-chamber section, rolled for a horizontal long-axis presentation. Parasternal probe position cannot be registered from an isolated organ.',copy_of='a3c')
sax_up=unit(np.cross(long_axis,r4))
for key,level,confidence,note in [
 ('psax_papillary',.55,'approximate, visually checked','Ventricular short-axis section with LV thick wall, internal papillary-like structures and adjacent RV crescent. Level is approximately mid-ventricular; no structure segmentation.'),
 ('psax_mitral',.95,'provisional; adjust to anatomy','Basal ventricular short-axis starting plane. Exact mitral leaflet/annulus level is unverified.'),
 ('meavsax',1.17,'provisional; manual placement needed','Basal/outflow short-axis starting plane only. Aortic valve is not identified confidently; a conspicuous bright tube must not be labeled as aortic anatomy.')]:
 add(key,apex+level*(base-apex),r4,sax_up,width=.72,height=.72,confidence=confidence,family='short axis',note=note)
add('subcostal',center,long_axis,-r4,width=.95,height=.72,confidence='approximate presentation only',family='ventricular long axis',note='The four-chamber-like anatomy plane rolled horizontally. Actual subcostal acoustic entry is not inferable from this isolated fixed organ.',copy_of='a4c')
for key,original in [('me4c','a4c'),('me2c','a2c'),('melax','a3c'),('tgpapillary','psax_papillary')]:
 src=frames[original];v=src['voxelXYZ'];w=src['world']
 roll=-1 if original in ['a4c','a2c','a3c'] else 1
 add(key,v['center'],np.array(v['right'])*roll,np.array(v['up'])*roll,w['width'],w['height'],confidence=src['confidence'],family=src['family'],note=f"Shares the {original} anatomic plane. TEE window label describes the educational target, not a registered esophageal probe location or simulated ultrasound acquisition. "+src['note'],copy_of=original)
ra=np.array([230.,175.,210.]);la=np.array([315.,285.,215.]);atrial_r=unit((la-ra)-long_axis*np.dot(la-ra,long_axis))
add('bicaval',ra,atrial_r,long_axis,width=.72,height=.72,confidence='provisional; manual placement needed',family='atrial long axis',note='Long section through a visually estimated right-atrial region toward the interatrial direction. SVC/IVC endpoints and atrial septum are not segmented or confirmed. Adjust plane before interpreting as a bicaval target.')
landmarks={
 'lvApicalMyocardium':{'voxelXYZ':arr(apex),'confidence':'approximate regional landmark','note':'Apical myocardial region chosen visually; not a segmented epicardial/endocardial apex.'},
 'lvBasalValveRegion':{'voxelXYZ':arr(base),'confidence':'approximate regional landmark','note':'Basal LV/chordal region; annulus is not segmented.'},
 'rvMidCavity':{'voxelXYZ':arr(rv_mid),'confidence':'approximate regional landmark','note':'Thin-wall crescent adjacent to the LV.'},
 'lvMidAxisAtSourceZ350':{'voxelXYZ':arr(lv_mid),'confidence':'derived axis point'},
 'rightAtrialRegion':{'voxelXYZ':arr(ra),'confidence':'low; provisional'},
 'leftAtrialRegion':{'voxelXYZ':arr(la),'confidence':'low; provisional'},
 'aorticRoot':{'voxelXYZ':None,'confidence':'unresolved','note':'No aortic-root label assigned. Bright superior tubular object is unclassified.'}}
for lm in landmarks.values():
 if lm['voxelXYZ'] is not None:lm['sourceNormalized']=arr(np.array(lm['voxelXYZ'])/SPAN)
result={'schemaVersion':1,'dataset':'LADAF-2021-17, complete heart, s4','voxelSpacingMm':.3176,'dimensionsXYZ':[475,475,530],
 'worldExtentXYZ':arr(np.array([474.,529.,474.])/529.),'worldMapping':'[(x-237)/529, (z-264.5)/529, (237-y)/529] for source voxel XYZ',
 'normalConvention':'normal = cross(right, up); camera may approach center along +normal. Flip the retained clipping half explicitly if needed.',
 'displayOrientation':'Apical TTE: apex at top. Midesophageal TEE: base/atria at top, apex at bottom. PLAX/subcostal: long axis horizontal. This presentation is not patient/probe registration.',
 'validation':'Manually inspected grayscale source-volume multiplanar reconstructions; no patient orientation, chamber segmentation, acoustic model or clinical validation.',
 'limitations':['Fixed-specimen LV lumen is slit-like/collapsed.','Landmarks are approximate regions, not clinically measured coordinates.','Named windows are adjustable educational starting planes.','Probe angle labels do not constitute scanner-to-patient or scanner-to-probe registration.','AV and bicaval candidates require manual placement; bright superior tubular structure is unclassified.'],
 'landmarks':landmarks,'lvAxisVoxelXYZ':arr(long_axis),'interventricularDirectionVoxelXYZ':arr(r4),'frames':frames}
(OUT/'echo-planes.json').write_text(json.dumps(result,indent=2)+'\n')
# Review contact sheet uses square physical pixels and a [15500,22500] preview contrast window; application textures use [14640,23545].
v=np.load(RAW,mmap_mode='r')
selected=[('a4c','Four-chamber-like'),('a2c','Two-chamber-like'),('a3c','Long axis, provisional'),('psax_papillary','Mid-ventricular short axis'),('psax_mitral','Basal short axis, provisional'),('meavsax','Outflow level, unverified')]
W=450;H=550;sheet=Image.new('RGB',(3*W,2*H),(14,18,19));draw=ImageDraw.Draw(sheet)
for idx,(key,title) in enumerate(selected):
 f=frames[key]['voxelXYZ'];p=np.array(f['center']);r=np.array(f['right']);u=np.array(f['up'])
 # Every preview has isotropic sampling; padding covers the wider field.
 span=max(f['width'],f['height']); xx,yy=np.meshgrid(np.linspace(-span/2,span/2,W),np.linspace(span/2,-span/2,W))
 q=p+xx[...,None]*r+yy[...,None]*u
 s=map_coordinates(v,[q[...,2],q[...,1],q[...,0]],order=1,mode='constant',cval=0,prefilter=False)
 im=Image.fromarray((np.clip((s.astype(np.float32)-15500)/7000.,0,1)*255).astype('uint8')).convert('RGB')
 ox=(idx%3)*W;oy=(idx//3)*H
 sheet.paste(im,(ox,oy+55));draw.text((ox+12,oy+12),title,fill='white');draw.text((ox+12,oy+30),key+' | '+frames[key]['confidence'],fill=(221,167,145))
 # 20 mm physical scale.
 scale=20/.3176/span*W;draw.line((ox+20,oy+525,ox+20+scale,oy+525),fill='white',width=2);draw.text((ox+20,oy+509),'20 mm',fill='white')
sheet.save(OUT/'candidate-planes-contact-sheet.png')
print(OUT/'echo-planes.json');print(OUT/'candidate-planes-contact-sheet.png')
