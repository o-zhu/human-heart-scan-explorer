"""Adaptive measured-pixel level review after geometric-score failure analysis.

Short-axis anatomy is determined visually from source profiles, not by a chosen
distance from a guessed mitral center. These sweeps deliberately include original
papillary/apical sections even where an anatomical-level proxy ranked them poorly.
"""
from common import *
from search import BASE,POINTS,LVAXIS,sax_frame,serialize
import itertools

volume,meta=load_volume();labels=load_labels();record={}
for key,offsets in [('tgpapillary',[-4,-2,-1,0,1,2,4]),('tgapicalsax',[-4,-2,-1,0,1,2,4])]:
 base=BASE[key];items=[];entries=[]
 for i,(off,pitch) in enumerate(itertools.product(offsets,[-4,0,4])):
  f=rotated(base,pitch=pitch);f['center']=base['center']+LVAXIS*(off/MM)
  a,b=sample(volume,f,440,labels);id=10000+i
  items.append((image(a,b),f"{key} #{id}",f"original level {off:+}mm, tilt {pitch:+}°"));entries.append(dict(id=id,frame=serialize(f),offsetFromOriginalMm=off,tiltDegrees=pitch))
 contact_sheet(items,OUT/f'adaptive/{key}.jpg',f'{key} • source-pixel sweep around original, not score-ranked',cols=3)
 record[key]=entries

# The first basal family remained contaminated by aortic-root anatomy. Inspect
# ventricular-side offsets and independent local/basal orientation seeds.
base=sax_frame(POINTS['MV']+LVAXIS*8,LVAXIS,BASE['tgbasalsax'],350,340)
seeds=[('LV axis',base),('local source axial',sax_frame([305,276,289],np.array([0,0,1]),BASE['tgbasalsax'],340,330)),('LA-LV interface estimate',sax_frame([314,280,274],unit([-.1693,.2971,.9397]),BASE['tgbasalsax'],340,330))]
entries=[]
for si,(name,seed) in enumerate(seeds):
 items=[]
 for j,(off,pitch) in enumerate(itertools.product([0,3,6,9],[-12,0,12])):
  f=rotated(seed,pitch=pitch);f['center']=seed['center']+LVAXIS*(off/MM)
  a,b=sample(volume,f,450,labels);id=11000+si*100+j
  items.append((image(a,b),f"Basal #{id} • {name}",f"ventricular shift {off:+}mm, tilt {pitch:+}°"));entries.append(dict(id=id,frame=serialize(f),seed=name,ventricularShiftMm=off,tiltDegrees=pitch))
 contact_sheet(items,OUT/f'adaptive/tgbasalsax-{si}.jpg',f'Basal MV region • {name} • exact measured source',cols=3)
record['tgbasalsax']=entries
write('docs/tee-plane-qc-v2/adaptive-level-review.json',dict(method='Manual source-pixel comparison of independent level/orientation sweeps after rejecting proxy-score winners.',views=record,totalMeasuredReformats=sum(len(x) for x in record.values())))
print('Rendered',sum(len(x) for x in record.values()),'adaptive measured source sections')
