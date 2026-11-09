"""Freeze reviewed main-view geometry and conservative measured camera bounds.

Never changes source data, historical presets, prepared caps or segmentation.
"""
import itertools
from audit import *
from finalists import numpyframe
BOUNDS=np.array([[109.,88.,14.],[402.,405.,512.]])

def full_frame(f,target):
    r,u,n=[f[k] for k in ['right','up','normal']]
    target=np.asarray(target,float);target=target-n*np.dot(target-f['center'],n)
    corners=np.array(list(itertools.product(*BOUNDS.T)))
    a=(corners-target)@r;b=(corners-target)@u
    alo,ahi=np.floor(a.min())-4,np.ceil(a.max())+4
    blo,bhi=np.floor(b.min())-4,np.ceil(b.max())+4
    return dict(center=target+r*(alo+ahi)/2+u*(blo+bhi)/2,right=r,up=u,normal=n,width=float(ahi-alo),height=float(bhi-blo),target=target)

def retained_bounds(v,f=None,flip=False):
    # Count every threshold-supported source voxel, rather than a decimated point cloud.
    lo=np.array([9999.,9999.,9999.]);hi=-lo;count=0
    xmin,ymin,zmin=BOUNDS[0].astype(int);xmax,ymax,zmax=BOUNDS[1].astype(int)
    for z in range(zmin,zmax+1):
        y,x=np.nonzero(v[z,ymin:ymax+1,xmin:xmax+1]>=72);x=x+xmin;y=y+ymin
        if f is not None:
            n=f['normal']*(-1 if flip else 1);c=f['center']
            keep=(x-c[0])*n[0]+(y-c[1])*n[1]+(z-c[2])*n[2]<=0
            x=x[keep];y=y[keep]
        if not len(x):continue
        count+=len(x);lo=np.minimum(lo,[x.min(),y.min(),z]);hi=np.maximum(hi,[x.max(),y.max(),z])
    assert count>100000
    padded_lo=np.maximum(lo-2,BOUNDS[0]-2);padded_hi=np.minimum(hi+2,BOUNDS[1]+2)
    lower=qc.world_point([padded_lo[0],padded_hi[1],padded_lo[2]])
    upper=qc.world_point([padded_hi[0],padded_lo[1],padded_hi[2]])
    return dict(min=lower.tolist(),max=upper.tolist()),dict(sourceMin=lo.tolist(),sourceMax=hi.tolist(),threshold=72,paddingVoxels=2,retainedThresholdedVoxels=count)

DECISIONS={
 'rv-inflow':('retained',[2,4],'The section follows the right atrial outlet into the RV, with the tricuspid region between them.',['Individual tricuspid leaflets and chordae are not separately segmented.']),
 'rv-outflow':('refined',[2,6],'An oblique section follows the RV body through the muscular outlet into the proximal pulmonary artery.',['The nearby aortic root and shared septum remain visible as anatomical context.','Pulmonary leaflet identity and a continuous valve annulus have not been validated.']),
 'lv-inflow':('retained',[1,3],'The section preserves the LA–mitral-region–LV relationship and subvalvular tissue.',['The fixed specimen is partly collapsed; individual mitral leaflets are not labeled.']),
 'lv-outflow':('retained',[1,5],'The section follows the LV outlet toward the aortic root, with mitral-side context.',['Aortic leaflet identity and annular measurements are not validated.']),
 'ra-inflow':('retained',[4],'The section shows the right atrial cavity and its preserved venous-entry side.',['The preserved vessel ends are truncated; this is not a complete bicaval view.']),
 'ra-outflow':('retained',[4,2],'The atrial-side cut uses the reviewed tricuspid hinge region, with the RV beyond it.',['This is a regional anatomical cut, not a segmented or measured tricuspid annulus.']),
 'la-inflow':('retained',[3],'The section shows the preserved pulmonary-venous-entry side and the left atrial cavity.',['Named pulmonary veins and all four vein ostia are not individually verified.']),
 'la-outflow':('refined',[3,1],'The cut sits slightly toward the atrial side of the LA–LV junction to show the mitral region with less ventricular wall.',['Leaflets and the mitral annulus are not separately segmented; no valve-area measurement is implied.'])
}

def build():
 v,l,meta,ps=sources();review=qc.read('docs/main-view-qc-v3/rv-outflow-search.json')
 selected=next(r for r in review['review'] if r['id']==3972)
 frames={k:frame_of(p) for k,p in ps.items()}
 rv=numpyframe(selected['sourceFrame']);frames['rv-outflow']=full_frame(rv,[174,292,226])
 la=frames['la-outflow'];moved=qc.rotated(la,offset_mm=3,pivot=la['target']);moved['target']=la['target']+moved['normal']*3/MM
 frames['la-outflow']=full_frame(moved,moved['target'])
 catalog=dict(datasetId='1659197537',specimen='LADAF-2021-17',version='main-view-qc-v3',labelRevision=meta['labels']['revision'],
   scope='Measured-source anatomical starting views of a fixed, partly collapsed specimen. Approximate tissue-region labels guide this review; they are not validated chamber or valve segmentations.',views={})
 report=dict(source=meta,rvSearchConfigurations=review['evaluated'],nonRvNeighborhoodSections=91,sourceBounds=BOUNDS,views={})
 for key in ORDER:
    p=ps[key];f=frames[key];status,ids,summary,limits=DECISIONS[key];bounds,br=retained_bounds(v,f,p['flip'])
    item=dict(status=status,targetRegionIds=ids,summary=summary,remainingLimits=limits,flip=p['flip'],fitBounds=bounds,overviewTarget=((np.array(bounds['min'])+bounds['max'])/2).tolist(),cameraOffset=dict(right=.24,up=.10))
    if status=='refined':
       wf=qc.world_frame(f);wf['target']=qc.world_point(f['target']).tolist();wf.pop('displayMirrorX');wf.pop('displayRotate180');item['world']=wf
       item['cameraDistance']=1.65 if key=='rv-outflow' else 1.4
       item['closeDistance']=.72 if key=='rv-outflow' else p['closeDistance']
    catalog['views'][key]=item
    report['views'][key]=dict(status=status,sourceFrame=f,bounds=br,review=summary,remainingLimits=limits,focusMetrics=region_metrics(v,l,focus_frame(f,p)))
 bounds,br=retained_bounds(v);catalog['wholeHeart']=dict(fitBounds=bounds,overviewTarget=((np.array(bounds['min'])+bounds['max'])/2).tolist())
 report['wholeHeartBounds']=br
 write('selected-review.json',report)
 out=ROOT/'public/assets/main-view-qc-v3.json';out.write_text(json.dumps(catalog,indent=2,default=serial)+'\n')
 print(json.dumps(catalog,default=serial),flush=True)
if __name__=='__main__':build()
