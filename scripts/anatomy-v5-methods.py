"""Compare boundary refinements on measured tissue with fixed, recorded seeds.

Candidate methods are diagnostic experiments. The selected anatomical constraints
are reviewed separately before producing a viewer label asset.
"""
from pathlib import Path
import argparse, ctypes, json, time, subprocess
import numpy as np
from scipy import ndimage as ndi
from skimage.segmentation import watershed

ROOT=Path(__file__).resolve().parents[1]
WORK=Path('/workspace/data/anatomy-v5')
SOURCE=np.array([475,475,530]); DIMS=np.array([317,317,354]); SCALE=(DIMS-1)/(SOURCE-1)

def geodesic(image,mask,markers,work,edge_scale=700,gap_penalty=3,max_cost=65,allowed=None):
    libpath=work/'anatomy-v5-geodesic.so'
    source=ROOT/'scripts/anatomy-v5-geodesic.cpp'
    if not libpath.exists() or libpath.stat().st_mtime<source.stat().st_mtime:
        subprocess.run(['g++','-O3','-shared','-fPIC','-std=c++17',str(source),'-o',str(libpath)],check=True)
    lib=ctypes.CDLL(str(libpath));fn=lib.propagate
    image=np.ascontiguousarray(image,np.uint16);mask=np.ascontiguousarray(mask,np.uint8);markers=np.ascontiguousarray(markers,np.uint8)
    out=np.zeros_like(markers);distance=np.full(markers.shape,np.inf,np.float32)
    allowed=np.full(markers.shape,127,np.uint8) if allowed is None else np.ascontiguousarray(allowed,np.uint8)
    u8=np.ctypeslib.ndpointer(dtype=np.uint8,ndim=3,flags='C_CONTIGUOUS');u16=np.ctypeslib.ndpointer(dtype=np.uint16,ndim=3,flags='C_CONTIGUOUS');f32=np.ctypeslib.ndpointer(dtype=np.float32,ndim=3,flags='C_CONTIGUOUS')
    fn.argtypes=[u16,u8,u8,u8,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_float,ctypes.c_float,ctypes.c_float,u8,f32]
    fn.restype=None;fn(image,mask,markers,allowed,*image.shape[::-1],edge_scale,gap_penalty,max_cost,out,distance)
    return out,distance

def label_boundaries(labels):
    boundary=np.zeros(labels.shape,bool)
    for axis in range(3):
        lo=[slice(None)]*3;hi=lo.copy();lo[axis]=slice(None,-1);hi[axis]=slice(1,None)
        a,b=labels[tuple(lo)],labels[tuple(hi)];different=(a>0)&(b>0)&(a!=b)
        boundary[tuple(lo)]|=different;boundary[tuple(hi)]|=different
    return boundary

def tube_guide(track,z,xx,yy):
    points=np.array(track['points'],float)
    cx,cy,rx,ry=[np.interp(z,points[:,0],points[:,k]) for k in range(1,5)]
    return ((xx-cx)/rx)**2+((yy-cy)/ry)**2

def largest_component(mask):
    labels,n=ndi.label(mask,structure=ndi.generate_binary_structure(3,2));sizes=np.bincount(labels.ravel());sizes[0]=0
    return labels==sizes.argmax()

def hybrid_markers(v,old,markers,work):
    tracks=json.loads((ROOT/'docs/anatomy/cavity-tracks.json').read_text())
    xx,yy=np.meshgrid(np.linspace(0,474,DIMS[0]),np.linspace(0,474,DIMS[1]),indexing='xy')
    zs=np.linspace(0,529,DIMS[2]);aortic_roi=np.zeros(v.shape,bool);pulmonary_roi=np.zeros(v.shape,bool);rvot=np.zeros(v.shape,bool)
    # A curved corridor follows the observed RV outflow rather than extending
    # the tricuspid divider across the arterial outflow. The pulmonary hinge
    # surface was reviewed in source Y290/Y305 and X175 planes.
    pv_gate=220+.50*(xx-175)+.13*(yy-290)
    rvz=np.array([205,225,245,265,285,300]);rxc=np.array([153,161,164,176,191,200]);ryc=np.array([281,281,274,250,222,201]);rrx=np.array([34,38,42,46,54,58]);rry=np.array([50,50,54,57,59,56])
    for iz,z in enumerate(zs):
        qa=tube_guide(tracks['5'],z,xx,yy);qp=tube_guide(tracks['6'],z,xx,yy)
        # Shape guides locate measured vessels; their boundaries are not circles.
        aortic_roi[iz]=(qa<2.1)&(z>=38)&(z<=282)
        pulmonary_roi[iz]=(qp<2.2)&(z>=32)&(z<pv_gate+3)
        cx=np.interp(z,rvz,rxc);cy=np.interp(z,rvz,ryc);rx=np.interp(z,rvz,rrx);ry=np.interp(z,rvz,rry)
        rvot[iz]=(((xx-cx)/rx)**2+((yy-cy)/ry)**2<1.25)&(z>=pv_gate+2)&(z<=300)&(yy>207)&(xx<270)
    # Distinct arterial-wall intensity is an additional source cue. It is not
    # sufficient by itself: spatial, connected-component and valve constraints
    # prevent a bright myocardial patch from becoming an arterial label.
    near_aorta=ndi.binary_dilation(old==5,iterations=6)
    near_aorta_tight=ndi.binary_dilation(old==5,iterations=3)
    aortic_roi&=near_aorta
    allowed=np.full(old.shape,127,np.uint8)
    forbidden=((old==1)&(~near_aorta))|(((old==3)|(old==6))&(~near_aorta_tight))
    forbidden|=((zs[:,None,None]<180)&(old!=5))|(xx[None,:,:]>=295)
    allowed[forbidden]&=np.uint8(127-(1<<5))
    aortic_roi&=~forbidden
    av=largest_component((v>=20100)&aortic_roi)
    pv=largest_component((v>=19050)&pulmonary_roi&(~av))
    av_distance=ndi.distance_transform_edt(~av).astype(np.float32)
    pv_distance=ndi.distance_transform_edt(~pv).astype(np.float32)
    # A new arterial identity may only occupy the immediate measured shell.
    # Otherwise nearby bright LV fibers or the aortomitral junction can attract
    # the arterial front. The compact-LV envelope continues to protect LV mass.
    allowed[(old!=5)&(av_distance>3)]&=np.uint8(127-(1<<5))
    allowed[old==1]&=np.uint8(127-(1<<6))
    out=markers.copy()
    # Reconsider the ambiguous collar on both sides of an arterial wall; do not
    # freeze the v4 cavity-distance assignments as truth in that collar.
    collar=((av_distance<5)&aortic_roi)|((pv_distance<4)&pulmonary_roi)
    out[collar]=0
    out[(out==5)&(av_distance>3)]=0
    out[(out==6)&(pv_distance>3)]=0
    out[av]=5;out[pv&(~av)]=6
    ventricular=rvot&(old!=1)&(old!=5)&(v>=17800)&(old>0)
    out[ventricular]=2
    allowed[rvot&(old!=1)&(old!=5)]&=np.uint8(127-(1<<4)-(1<<6))
    # Do not turn aortic root pixels into RVOT where the arterial shell and
    # the muscular outflow are closely opposed.
    out[av]=5;out[pv&(~av)]=6
    out[(out>0)&((allowed&(1<<out))==0)]=0
    np.save(work/'markers-hybrid.npy',out);np.save(work/'aortic-wall-core.npy',av);np.save(work/'pulmonary-wall-core.npy',pv);np.save(work/'rvot-corridor.npy',rvot)
    info={'aorticCoreThreshold':20100,'pulmonaryCoreThreshold':19050,'aorticCoreVoxels':int(av.sum()),'pulmonaryCoreVoxels':int(pv.sum()),'rvotNewSeedVoxels':int(ventricular.sum()),'newAorticIdentityMaximumDistanceWorkingVoxels':3,'pulmonaryGate':'sourceZ = 220 + 0.50*(sourceX-175) + 0.13*(sourceY-290), visually estimated'}
    return out,allowed,info

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--work',type=Path,default=WORK);p.add_argument('--working-volume',type=Path,default=Path('/workspace/scratch/7d584d74921e/anatomy-v4/work/working-volume.npy'));p.add_argument('--method',choices=['all','watershed','geodesic','hybrid'],default='all');a=p.parse_args()
    w=a.work;w.mkdir(parents=True,exist_ok=True);start=time.monotonic()
    v=np.load(a.working_volume);old=np.load(w/'v4-labels.npy')
    # Ignore label/background boundaries when selecting reliable interior seeds:
    # thin, isolated chamber walls still need seed support.
    edge=label_boundaries(old);band=ndi.binary_dilation(edge,iterations=5)
    tissue=(v>17450)&(old>0)
    mask=ndi.binary_dilation(old>0,iterations=1)
    markers=np.where((~band)&tissue,old,0).astype(np.uint8)
    np.save(w/'markers-baseline.npy',markers);np.save(w/'propagation-mask.npy',mask)
    record={'seedVoxels':int((markers>0).sum()),'candidateMaskVoxels':int(mask.sum()),'contestedVoxels':int((mask&(markers==0)).sum()),'boundaryBandWorkingVoxels':5}
    if a.method in ('all','watershed'):
        t=time.monotonic();gradient=ndi.gaussian_gradient_magnitude(v.astype(np.float32),.75)
        result=watershed(gradient,markers,mask=mask,connectivity=1).astype(np.uint8)
        np.save(w/'candidate-watershed.npy',result);record['watershedSeconds']=round(time.monotonic()-t,3);del gradient,result
    if a.method in ('all','geodesic'):
        t=time.monotonic();result,distance=geodesic(v,mask,markers,w)
        np.save(w/'candidate-geodesic.npy',result);np.save(w/'distance-geodesic.npy',distance);record['geodesicSeconds']=round(time.monotonic()-t,3)
    if a.method in ('all','hybrid'):
        t=time.monotonic();hybrid,allowed,info=hybrid_markers(v,old,markers,w)
        result,distance=geodesic(v,mask,hybrid,w,edge_scale=600,gap_penalty=4,max_cost=85,allowed=allowed)
        np.save(w/'candidate-hybrid.npy',result);np.save(w/'distance-hybrid.npy',distance);record['hybrid']=info;record['hybridSeconds']=round(time.monotonic()-t,3)
    record['elapsedSeconds']=round(time.monotonic()-start,3);(w/'method-experiment.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)

if __name__=='__main__':main()
