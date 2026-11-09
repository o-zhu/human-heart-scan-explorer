"""Exact convex support of retained thresholded source samples for camera fitting."""
import copy,json,numpy as np
from scipy.spatial import ConvexHull
from audit import *
from build_catalog import BOUNDS
from finalists import numpyframe

def hull_support(v,f=None,flip=False):
    edge=[];xmin,ymin,zmin=BOUNDS[0].astype(int);xmax,ymax,zmax=BOUNDS[1].astype(int)
    for z in range(zmin,zmax+1):
        y,x=np.nonzero(v[z,ymin:ymax+1,xmin:xmax+1]>=72);x=x+xmin;y=y+ymin
        if f is not None:
            n=f['normal']*(-1 if flip else 1);c=f['center'];keep=(x-c[0])*n[0]+(y-c[1])*n[1]+(z-c[2])*n[2]<=0;x=x[keep];y=y[keep]
        if not len(x):continue
        start=np.r_[0,np.flatnonzero(np.diff(y))+1];end=np.r_[start[1:]-1,len(x)-1];idx=np.unique(np.r_[start,end]);edge.append(np.column_stack((x[idx],y[idx],np.full(len(idx),z))))
    points=np.concatenate(edge);h=ConvexHull(points);points=points[h.vertices];world=np.column_stack((points[:,0]-237,points[:,2]-264.5,237-points[:,1]))/529
    return world,dict(rowEndpoints=len(edge),hullVertices=len(points),sourceThreshold=72,sourceBounds=BOUNDS.tolist(),meaning='Exact convex hull of retained source voxel centers meeting uint8 display threshold 72 within reviewed heart bounds. Background/blank plane corners omitted; no labels used for cropping.')

def critical_points(world,frame,flip,section=False):
    n=np.asarray(frame['normal'])*(-1 if flip else 1);u=np.asarray(frame['up']);r=np.asarray(frame['right'])
    if not section:n=qc.unit(n+r*.24*(-1 if flip else 1)+u*.10)
    u=qc.unit(u-n*np.dot(n,u));r=qc.unit(np.cross(-n,u))
    # For D >= q.n + abs(q.r)/(.32*aspect*.84), the upper convex
    # hull in (q.r,q.n) contains every possible maximum at any aspect.
    project=np.column_stack((world@r,world@n));h=ConvexHull(project);ids=list(h.vertices)
    left=int(np.argmin(project[ids,0]));right=int(np.argmax(project[ids,0]));selected=[];i=right
    while True:
        selected.append(ids[i])
        if i==left:break
        i=(i+1)%len(ids)
    for sign in [-1,1]:selected.append(int(np.argmax(world@n+sign*(world@u)/(.32*.76))))
    selected=sorted(set(selected));points=world[selected]
    # Verify exact support against every full hull vertex for a dense aspect
    # sweep, and preserve the entire mathematical upper chain for continuity.
    for aspect in np.geomspace(.2,8,100):
        needed=np.maximum(np.abs(world@r)/(.32*aspect*.84)+world@n,np.abs(world@u)/(.32*.76)+world@n).max()
        got=np.maximum(np.abs(points@r)/(.32*aspect*.84)+points@n,np.abs(points@u)/(.32*.76)+points@n).max()
        assert abs(needed-got)<1e-10,(aspect,needed,got)
    return points.round(8).tolist(),dict(fullHullVertices=len(world),criticalVertices=len(points),cameraNormal=n.tolist(),cameraUp=u.tolist(),cameraRight=r.tolist(),exactSupportVerifiedAspects=[.2,8],denseChecks=100)

def main():
 v,l,meta,ps=sources();review=qc.read('docs/main-view-qc-v3/selected-review.json');catalog=qc.read('public/assets/main-view-qc-v3.json');report={}
 for key in ORDER:
    f=numpyframe(review['views'][key]['sourceFrame']);item=catalog['views'][key];wf=qc.world_frame(f);byhalf={};halfinfo={}
    for flipped in [False,True]:
        flip=bool(ps[key]['flip'])!=flipped;byhalf[flipped],halfinfo[flipped]=hull_support(v,f,flip)
    sets={};info={}
    for name,flipped,section in [('overview',False,False),('section',False,True),('flippedOverview',True,False),('flippedSection',True,True)]:
        flip=bool(ps[key]['flip'])!=flipped;sets[name],info[name]=critical_points(byhalf[flipped],wf,flip,section)
    item['fitPoints']=sets;report[key]=dict(sourceHalves=halfinfo,poses=info)
    print(key,{name:len(points) for name,points in sets.items()},flush=True)
 catalog['wholeHeart'].pop('fitPoints',None)
 catalog['fitPointsContract']=dict(fov=.32,horizontalSafety=.84,verticalSafety=.76,sourceSupportThreshold=72,coordinateSystem='world',meaning='Actual measured-support extrema, including the opposite retained half for flipped poses; exact frustum support at any aspect for the fixed starting-camera basis. Fit bounds remain a fallback. Source and labels are unchanged.')
 write('support-hulls.json',report)
 (ROOT/'public/assets/main-view-qc-v3.json').write_text(json.dumps(catalog,separators=(',',':'))+'\n')
 print('Catalog bytes', (ROOT/'public/assets/main-view-qc-v3.json').stat().st_size,flush=True)
if __name__=='__main__':main()
