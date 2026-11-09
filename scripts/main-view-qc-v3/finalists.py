"""Matched-scale grayscale and tissue-region plates for final decisions."""
import copy,json,numpy as np
from audit import *

def numpyframe(f):
    f=copy.deepcopy(f)
    for k in ['center','right','up','normal','target']:
        if k in f:f[k]=np.asarray(f[k],float)
    return f

def main():
 v,l,meta,ps=sources();search=qc.read('docs/main-view-qc-v3/rv-outflow-search.json');by={r['id']:r for r in search['review']}
 ids=[0,3947,3972,3977,3030,3200];picked=[]
 for key in ids:
  r=by[key];f=numpyframe(r['reviewFrame']);a,b=qc.sample(v,f,760,l);m=region_metrics(v,l,f,600)
  frac=m['regionFractionOfThresholdedSection'];detail=' '.join(f'{n} {frac[n]:.0%}' for n in ['RV','LV','pulmonary','aorta'])
  items=[(qc.image(a),f'Candidate {key} · actual source','Same display range for all candidates'),(qc.image(a,b,.68),f'Candidate {key} · approximate regions',detail)]
  qc.contact_sheet(items,OUT/f'rv-outflow-finalist-{key}.jpg',f'RV outflow candidate {key} · grayscale and regional ownership',cols=2,cell=520,row=700)
  picked.append({'id':key,'sourceFrame':f,'metrics':m})
 write('rv-outflow-finalists.json',picked)
 base=frame_of(ps['la-outflow']);items=[];records=[]
 for d in [0,1.5,2.25,3,3.75,4.5,6]:
  f=qc.rotated(base,offset_mm=d,pivot=base['target']);f['target']=base['target']+f['normal']*(d/MM);g=focus_frame(f,ps['la-outflow'],1.08)
  a,b=qc.sample(v,g,650,l);m=region_metrics(v,l,g,600)
  for tint,mode in [(0,'source'),(.68,'regions')]:items.append((qc.image(a,b,tint),f'Shift {d:+g} mm · {mode}','Toward atrial side; unchanged viewing orientation'))
  records.append({'offsetMm':d,'sourceFrame':f,'reviewFrame':g,'metrics':m})
 qc.contact_sheet(items,OUT/'la-outflow-fine-neighbors.jpg','LA outlet · atrial/ventricular interface in paired measured-source sections',cols=4,cell=390,row=490)
 write('la-outflow-fine-neighbors.json',records)
 print('Finalist and fine offset plates ready',flush=True)
if __name__=='__main__':main()
