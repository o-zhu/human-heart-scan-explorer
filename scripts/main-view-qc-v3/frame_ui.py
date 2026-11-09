"""Move overview camera targets around measured upper-corner UI overlays.

Physical sampling planes and closer targets are not moved. All calculations
use projected convex support from measured thresholded source coordinates.
"""
import json,numpy as np
from scipy.spatial import ConvexHull
from audit import *
from fit_support import hull_support
from finalists import numpyframe
W,H,ASPECT=944,856,1.104

def clip(poly,axis,bound,keep_low):
    if not len(poly):return []
    out=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        ain=(a[axis]<=bound) if keep_low else (a[axis]>=bound);bin=(b[axis]<=bound) if keep_low else (b[axis]>=bound)
        if ain:out.append(a)
        if ain!=bin:
            t=(bound-a[axis])/(b[axis]-a[axis]);out.append([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])])
    return out

def intersection(poly,rect):
    for axis,bound,low in [(0,rect[0],False),(0,rect[2],True),(1,rect[1],False),(1,rect[3],True)]:poly=clip(poly,axis,bound,low)
    if len(poly)<3:return 0.
    return abs(sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(poly,poly[1:]+poly[:1])))/2

def main():
 v,l,meta,ps=sources();catalog=qc.read('public/assets/main-view-qc-v3.json');review=qc.read('docs/main-view-qc-v3/selected-review.json');results={}
 for key in ORDER:
    item=catalog['views'][key];f=numpyframe(review['views'][key]['sourceFrame']);wf=qc.world_frame(f);flip=ps[key]['flip'];world,info=hull_support(v,f,flip)
    side=-1 if flip else 1;n=qc.unit(np.array(wf['normal'])*side+np.array(wf['right'])*.24*side+np.array(wf['up'])*.10);u=qc.unit(np.array(wf['up'])-n*np.dot(wf['up'],n));r=qc.unit(np.cross(-n,u))
    original=(np.array(item['fitBounds']['min'])+item['fitBounds']['max'])/2;points=np.asarray(item['fitPoints']['overview']);rows=[]
    for dr in np.arange(0,-.1801,-.005):
      for du in np.arange(0,.1201,.005):
        target=original+r*dr+u*du;q=points-target
        distance=float(np.maximum(np.abs(q@r)/(.32*ASPECT*.84)+q@n,np.abs(q@u)/(.32*.76)+q@n).max())
        d=world-target;depth=distance-d@n;xy=np.column_stack(((.5+(d@r)/depth/(.32*ASPECT)*.5)*W,(.5-(d@u)/depth/.32*.5)*H))
        hull=xy[ConvexHull(xy).vertices].tolist();a=intersection(hull,[0,0,373,228]);b=intersection(hull,[W-278,0,W,98]);cost=distance+.4*np.hypot(dr,du)
        rows.append(dict(dr=float(dr),du=float(du),distance=distance,overlapIntro=a,overlapToolbar=b,cost=float(cost),target=target.tolist(),imageBounds=[xy.min(0).tolist(),xy.max(0).tolist()]))
    eligible=[row for row in rows if row['overlapIntro']<.1 and row['overlapToolbar']<.1];best=min(eligible,key=lambda row:row['cost']);item['overviewTarget']=best['target'];results[key]=dict(selected=best,prior=rows[0],marginPixels=8,sourceHull=info,considered=len(rows))
    print(key,json.dumps(best),flush=True)
 write('overlay-target-fit.json',results);(ROOT/'public/assets/main-view-qc-v3.json').write_text(json.dumps(catalog,separators=(',',':'))+'\n')
if __name__=='__main__':main()
