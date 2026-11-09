"""Bounded review of main preset neighborhoods and independent RV outflow starts.

Ranking identifies inspection candidates; final source appearance decides.
Regional label proportions are descriptive checks, not an anatomical objective.
"""
from pathlib import Path
import copy, itertools, json
import numpy as np
from audit import ROOT,OUT,qc,MM,sources,frame_of,region_metrics,focus_frame,write,serial

def from_normal(center,normal,up_hint=(0,0,-1),width=400,height=500):
    n=qc.unit(normal);u=qc.unit(np.asarray(up_hint)-n*np.dot(up_hint,n));r=qc.unit(np.cross(u,n))
    return qc.frame(center,r,u,width,height)

def same_plane(a,b):
    return abs(np.dot(a['normal'],b['normal']))>.9997 and abs(np.dot(a['center']-b['center'],a['normal']))*MM<.6

def rv_outflow():
    v,l,meta,ps=sources();p=ps['rv-outflow'];baseline=frame_of(p)
    points=np.array([[174,292,226],[174,278,245],[211,329,190],[195,184,330],[180,184,370]],float)
    weights=np.array([3,3,2,2,1.]);tol=np.array([3,3,4,5,8.]);pivot=np.average(points,axis=0,weights=weights)
    fit=qc.fitted_plane(points,weights,up_hint=[0,0,-1],width=400,height=500)
    if fit['normal'][0]>0:fit['right']=-fit['right'];fit['normal']=-fit['normal']
    tee=qc.source_frame(qc.read('public/assets/tee-atlas/plane-fit-v2.json')['views']['mervinout']['frame'])
    if tee['normal'][0]>0:tee['right']=-tee['right'];tee['normal']=-tee['normal']
    # Start the displayed long axis with the root above the ventricle.
    tee=from_normal(pivot,tee['normal'])
    seeds=[('previous',baseline),('RV-root-PA-fit',fit),('lateral-RV',from_normal([185,260,270],[-1,0,0])),('TEE-RV-route',tee)]
    records=[]
    def measure(f,seed,angles):
        d=np.abs((points-f['center'])@f['normal'])*MM
        cost=float(np.sum(weights*(d/tol)**2)/weights.sum())
        return {'id':len(records),'seed':seed,'angles':angles,'sourceFrame':f,'cost':cost,
          'landmarkPlaneDistanceMm':dict(zip(['PV-region','RVOT','proximal-PA','RV-body','distal-RV'],d.round(3)))}
    records.append(measure(baseline,'previous',[0,0,0]))
    for name,start in seeds:
        for a,b,c in itertools.product(range(-36,37,9),range(-36,37,9),[-8,-6,-4,-2,0,2,4,6,8]):
            f=qc.rotated(start,a,b,c,pivot=pivot)
            records.append(measure(f,name,[a,b,c]))
    candidates=sorted(records,key=lambda r:r['cost'])
    diverse=[]
    for r in candidates:
        if not any(same_plane(r['sourceFrame'],x['sourceFrame']) for x in diverse):diverse.append(r)
        if len(diverse)==16:break
    for r in list(diverse):
        for a,b,c in itertools.product([-4,-2,0,2,4],[-4,-2,0,2,4],[-1.5,-.75,0,.75,1.5]):
            f=qc.rotated(r['sourceFrame'],a,b,c,pivot=pivot)
            records.append(measure(f,f"fine:{r['id']}",[a,b,c]))
    candidates=sorted(records,key=lambda r:r['cost']);diverse=[]
    for r in candidates:
        if not any(same_plane(r['sourceFrame'],x['sourceFrame']) for x in diverse):diverse.append(r)
        if len(diverse)==32:break
    # Inspect diverse best geometric fits plus independent unperturbed starts.
    chosen=[records[0]]+diverse
    for name,f in seeds[1:]:chosen.append({'id':f'seed-{name}','seed':name,'angles':[0,0,0],'sourceFrame':f,'cost':None})
    review=[];items=[]
    for r in chosen:
        f=copy.deepcopy(r['sourceFrame']);f['target']=pivot-f['normal']*np.dot(pivot-f['center'],f['normal'])
        f['center']=f['target'];f['width']=330;f['height']=430
        m=region_metrics(v,l,f);a,b=qc.sample(v,f,460,l);r['reviewFrame']=f;r['metrics']=m
        frac=m['regionFractionOfThresholdedSection']
        items.append((qc.image(a,b,.68),f"{r['id']} {r['seed']}",f"RV{frac['RV']:.0%} LV{frac['LV']:.0%} PA{frac['pulmonary']:.0%} AO{frac['aorta']:.0%}"))
        review.append(r)
    qc.contact_sheet(items,OUT/'rv-outflow-candidates.jpg','RV outflow · independent starts and diverse fitted source sections',cols=6,cell=330,row=465)
    write('rv-outflow-search.json',{'points':points,'weights':weights,'tolerancesMm':tol,'evaluated':len(records),'records':records,'review':review})
    print(json.dumps({'evaluated':len(records),'rendered':len(review),'top':[{k:r[k] for k in ['id','cost','landmarkPlaneDistanceMm']} for r in diverse[:6]]},default=serial),flush=True)

def neighbors():
    v,l,meta,ps=sources();report={}
    for key,p in ps.items():
        if key=='rv-outflow':continue
        base=frame_of(p);pivot=base['target'];items=[];records=[]
        # Separate angle and offset neighbors avoid an uninformative large grid.
        cases=[(0,0,0)]+[(a,0,0) for a in [-16,-8,8,16]]+[(0,b,0) for b in [-16,-8,8,16]]+[(0,0,c) for c in [-6,-3,3,6]]
        for i,(a,b,c) in enumerate(cases):
            f=qc.rotated(base,a,b,c,pivot=pivot);f['target']=pivot+f['normal']*(c/MM)
            g=focus_frame(f,p,1.08);im,labels=qc.sample(v,g,400,l);m=region_metrics(v,l,g)
            records.append({'id':i,'angles':[a,b,c],'sourceFrame':f,'metrics':m})
            fs=m['regionFractionOfThresholdedSection']
            items.append((qc.image(im,labels,.68),f"{i} yaw {a:+} tilt {b:+} shift {c:+} mm",' '.join(f'{n}{fs[n]:.0%}' for n in ['RV','LV','RA','LA'])))
        qc.contact_sheet(items,OUT/f'{key}-neighbors.jpg',key+' · original and measured neighboring sections',cols=5,cell=310,row=410)
        report[key]=records
    write('neighbor-review.json',report);print('Reviewed 13 sections per unchanged-family preset',flush=True)

if __name__=='__main__':
    import sys
    if len(sys.argv)>1 and sys.argv[1]=='neighbors':neighbors()
    else:rv_outflow()
