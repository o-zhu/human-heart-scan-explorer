"""Reproject review anchors and independently check measured scalar + label values."""
from audit import *

catalog=read('docs/tee-sanity-v3/review-catalog.json')
planes=read('public/assets/tee-atlas/plane-fit-v2.json')['views']
volume,source=load_volume();labels=load_labels();rows=[]
for key,view in catalog['views'].items():
    for anchor in view.get('regionAnchors',[]):
        f=planes[key]['frame']
        center,right,up,normal=[np.asarray(f[k],float) for k in ['center','right','up','normal']]
        point=np.asarray(anchor['world'],float);delta=point-center
        uv=np.array([.5+delta@right/f['width'],.5-delta@up/f['height']])
        normal_distance_mm=abs(delta@normal)*529*.3176
        assert normal_distance_mm<1e-5,(key,normal_distance_mm)
        assert np.all(uv>0) and np.all(uv<1),(key,uv)
        assert np.max(np.abs(uv-anchor['normalizedXY']))<2e-6,(key,uv,anchor['normalizedXY'])
        xyz=np.array([point[0]*529+237,237-point[2]*529,point[1]*529+264.5])
        labelxyz=np.rint(xyz*(np.array(labels.shape[::-1])-1)/[474,474,529]).astype(int)
        measured_label=int(labels[labelxyz[2],labelxyz[1],labelxyz[0]])
        measured_scalar=int(map_coordinates(volume,[[xyz[2]],[xyz[1]],[xyz[0]]],order=1,mode='constant',cval=0,prefilter=False)[0])
        assert measured_label==anchor['regionId'],(key,measured_label,anchor['regionId'])
        assert measured_scalar>65 and abs(measured_scalar-anchor['sourceValue'])<=1,(key,measured_scalar)
        rows.append(dict(view=key,region=anchor['text'],scalar=measured_scalar,label=measured_label,inFrame=True,normalDistanceMm=float(normal_distance_mm),maxNormalizedProjectionError=float(np.abs(uv-anchor['normalizedXY']).max()),interiorDistanceMm=anchor['interiorDistanceMm']))
report=dict(anchorsChecked=len(rows),allInExactReviewedFrame=True,allOnMeasuredTissue=True,allLabelsMatch=True,maximumNormalDistanceMm=max(r['normalDistanceMm'] for r in rows),maximumNormalizedProjectionError=max(r['maxNormalizedProjectionError'] for r in rows),minimumSourceValue=min(r['scalar'] for r in rows),minimumInteriorDistanceMm=min(r['interiorDistanceMm'] for r in rows),results=rows)
(OUT/'anchor-registration-check.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2))
