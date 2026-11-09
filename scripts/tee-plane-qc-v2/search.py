"""Broad-to-fine, landmark-constrained candidate generation for TEE reformats.

The objective is a geometric prioritization aid, not a clinical accuracy metric.
Required regional connections and defining exclusions are checked before the
continuous ranking cost. Every shortlisted candidate is resampled from the
unchanged measured resident volume. Unsupported ostia remain explicitly unknown.
"""
import argparse,csv,gzip,itertools,json,math
import numpy as np
from common import *

VIEWS=read('docs/tee-plane-qc-v2/baselines.json')['views']
BASE={k:source_frame(v['frame']) for k,v in VIEWS.items() if not v['frame'].get('outsideScan')}
FLOW={p['id']:p['source'] for p in read('public/assets/flow-views-v5.json')['presets']}
TRACKS=read('docs/anatomy/cavity-tracks.json')
POINTS={
 'apex':[191,251,478],'LVmid':[246,279,360],'LVbase':[278,278,300],
 'MV':[302,272,274],'LA':[313,263,220],'LAroof':[307,267,180],
 'TV':[240,186,294],'RA':[240,168,230],'RAroof':[230,182,150],
 'RVmid':[195,184,330],'RVapex':[190,218,448],'RVOT':[174,278,245],
 'PV':[174,292,226],'PA':[205,317,210],
 'LVOT':[268,266,287],'AV':[250,258,250],'AVcusps':[242.5,252,235],
 'AAprox':[224,264,205],'AA':[206,260,165],'AAtop':[183,276,105],
 'LAvenous':[310,302,190], 'LAlateral':[322,302,190],
}
POINTS={k:np.array(v,float) for k,v in POINTS.items()}
LVAXIS=unit(POINTS['apex']-POINTS['MV'])
AVAXIS=unit(POINTS['AAprox']-POINTS['AV'])
AAAXIS=unit(POINTS['AAtop']-POINTS['AAprox'])

def inc(key,tol,weight=1,gate=None):
 return dict(name=key,point=POINTS[key],toleranceMm=tol,weight=weight,gateMm=gate)
def orient(f,reference,up_hint=None):
 n=unit(f['normal']);u=reference['up'] if up_hint is None else np.array(up_hint)
 u=unit(u-n*np.dot(n,u));r=unit(np.cross(u,n))
 if np.dot(r,reference['right'])<0:r=-r
 return frame(f['center'],r,u,f['width'],f['height'])
def flow_frame(key,ref,width=None,height=None):
 a=FLOW[key];f=frame(a['target'],a['right'],a['up'],width or ref['width'],height or ref['height']);return orient(f,ref)
def target_frame(names,ref,weights=None,width=None,height=None):
 f=fitted_plane([POINTS[n] for n in names],weights,ref['up'],ref['right'],width or ref['width'],height or ref['height'])
 return orient(f,ref)
def sax_frame(center,axis,ref,width=350,height=330,near=None):
 r=unit(ref['right']-axis*np.dot(axis,ref['right']));u=unit(np.cross(axis,r))
 if np.dot(u,ref['up'])<0:u=-u
 f=frame(center,r,u,width,height)
 return orient(f,ref,near) if near is not None else f

def configs():
 C={}
 def add(key,include,seeds=(),exclude=(),axis=None,axis_mode='inplane',angle_sigma=30,limits=(),pivot=None):
  C[key]=dict(include=include,seeds=[('baseline',BASE[key])]+list(seeds),exclude=list(exclude),axis=axis,axis_mode=axis_mode,angle_sigma=angle_sigma,limits=list(limits),pivot=np.array(pivot if pivot is not None else np.average([x['point'] for x in include],axis=0,weights=[x['weight'] for x in include]),float))
 f4=target_frame(['MV','TV','apex','LA','RA'],BASE['me4c'],[3,2,4,1,1],390,470)
 f2=target_frame(['MV','LA','apex','LVmid'],BASE['me2c'],[4,2,4,1],340,465)
 lax=target_frame(['MV','LVOT','AV','AAprox','apex'],BASE['melax'],[2,3,3,1,2],360,480)
 add('me4c',[inc('MV',2.5,3,4),inc('TV',4,2,7),inc('apex',2.5,4,4),inc('LA',6,1,9),inc('RA',8,1,12),inc('RVmid',9,.5)], [('landmark-fit',f4)], [('AV',6.5,3)],axis=LVAXIS,angle_sigma=32)
 add('me5c',[inc('MV',4,2,7),inc('TV',6,1,10),inc('LVOT',3,3,5),inc('AV',3,3,5),inc('LA',8,1),inc('RA',10,.5),inc('apex',12,.4)], [('four-chamber-fit',f4),('LVOT-reviewed',orient(flow_frame('lv-outflow',BASE['me5c']),BASE['me5c']))],axis=LVAXIS,angle_sigma=40,limits=['Some apical foreshortening is accepted for the five-chamber target.'])
 add('me2c',[inc('MV',2.5,4,4),inc('LA',5,2,8),inc('apex',2.5,4,4),inc('LVmid',4,1)], [('LA-MV-apex-fit',f2)], [('AV',6,3),('RVmid',12,2),('TV',7,1)],axis=LVAXIS,angle_sigma=45)
 comm=rotated(f2,yaw=-25,pivot=POINTS['MV'])
 add('mecommissural',[inc('MV',2.5,5,4),inc('LA',6,1,9),inc('apex',5,1),inc('LVmid',6,1)], [('MV-commissural',comm),('LV-inflow-reviewed',orient(flow_frame('lv-inflow',BASE['mecommissural']),BASE['mecommissural']))], [('AV',4,3)],axis=LVAXIS,angle_sigma=20,limits=['Individual P3/A2/P1 scallops and paired papillary identities are not independently annotated.'])
 add('melax',[inc('MV',4,2,6),inc('LVOT',2.5,3,4),inc('AV',3,3,5),inc('AAprox',5,1,8),inc('apex',4,2,7),inc('LA',7,.6)], [('outflow-landmark-fit',lax),('LVOT-reviewed',flow_frame('lv-outflow',BASE['melax']))],axis=LVAXIS,angle_sigma=45)
 avlong=target_frame(['MV','LVOT','AV','AAprox','AA','LA'],BASE['meavlax'],[1,2,3,2,1,2],255,315)
 add('meavlax',[inc('LVOT',3,2,5),inc('AV',2,3,4),inc('AVcusps',2.5,3,4),inc('AAprox',3,2,5),inc('AA',6,.5),inc('LA',5,2,8)], [('root-axis-LA-fit',avlong),('LVOT-reviewed',flow_frame('lv-outflow',BASE['meavlax'],255,315))],axis=AVAXIS,angle_sigma=40,pivot=POINTS['AVcusps'])
 # A line alone cannot choose the ultrasound fan's azimuth. The measured LA
 # region gives a near-field anatomical constraint independent of the probe art.
 aalong=target_frame(['AAprox','AA','AAtop','LAroof'],BASE['meaaolax'],[1,2,1,1],295,245)
 add('meaaolax',[inc('AAprox',3,2,5),inc('AA',2.5,4,4),inc('AAtop',3,2,5),inc('LAroof',5,1,9)], [('aorta-centerline-LA-fit',aalong)],axis=AAAXIS,angle_sigma=30,pivot=POINTS['AA'])
 aaShort=sax_frame(POINTS['AA'],AAAXIS,BASE['meaaosax'],300,290,POINTS['LAroof']-POINTS['AA'])
 add('meaaosax',[inc('AA',2.5,4,4)], [('ascending-cross-section',aaShort)],axis=AAAXIS,axis_mode='normal',angle_sigma=28,limits=['SVC and right pulmonary-artery identities are not independently established.'],pivot=POINTS['AA'])
 avShort=sax_frame(POINTS['AVcusps'],AVAXIS,BASE['meavsax'],300,290,POINTS['LA']-POINTS['AVcusps'])
 add('meavsax',[inc('AVcusps',2,5,3.5)], [('cusp-level-cross-section',avShort)],axis=AVAXIS,axis_mode='normal',angle_sigma=25,pivot=POINTS['AVcusps'])
 rvfit=target_frame(['TV','RVOT','PV','RVmid'],BASE['mervinout'],[3,3,3,1],350,390)
 for key in ['mervinout','tgrvinout']:
  add(key,[inc('TV',3.5,3,6),inc('RVOT',3,3,5),inc('PV',3,3,5),inc('RVmid',7,1)], [('RV-inflow-outflow-fit',orient(rvfit,BASE[key])),('RVOT-reviewed',flow_frame('rv-outflow',BASE[key],350,390))],angle_sigma=60,limits=['Regional inflow/outflow continuity is visually reviewed; individual valve leaflets/cusps are not segmented or verified.'])
 tvra=target_frame(['TV','RA','RAroof','RVmid'],BASE['memodbicaval'],[4,2,1,2],330,390)
 add('memodbicaval',[inc('TV',3,4,5),inc('RA',5,2,8),inc('RAroof',7,1,10),inc('RVmid',5,2,8)], [('RA-TV-RV-fit',tvra),('RV-inflow-reviewed',flow_frame('rv-inflow',BASE['memodbicaval'],330,390))],angle_sigma=45,limits=['Caval ostia and leaflet identities remain unresolved.'])
 bicfit=target_frame(['RAroof','RA','LA'],BASE['bicaval'],[2,2,1],350,365)
 add('bicaval',[inc('RAroof',4,2,7),inc('RA',4,2,7),inc('LA',6,1,10)], [('atrial-continuity-fit',bicfit),('RA-inflow-reviewed',flow_frame('ra-inflow',BASE['bicaval'],350,365))], [('LVmid',15,1),('AV',5,1)],angle_sigma=45,limits=['Both caval ostia and continuous IAS cannot be confidently identified in the truncated specimen.'])
 for key in ['merpv','mepv','melaa']:
  target='LAlateral' if key=='melaa' else 'LAvenous';candidate=flow_frame('la-inflow',BASE[key],310,345)
  add(key,[inc('LA',4,3,7),inc(target,5,2,8),inc('LAroof',5,1,9)], [('LA-continuity-reviewed',candidate)],angle_sigma=28,limits=['Individual pulmonary-vein ostia and LAA are not separately annotated; no complete named-target correspondence is asserted.'])
 basal=sax_frame(POINTS['MV']+LVAXIS*8,LVAXIS,BASE['tgbasalsax'],350,340)
 pap=sax_frame(POINTS['MV']+LVAXIS*(29/MM),LVAXIS,BASE['tgpapillary'],350,335)
 apic=sax_frame(POINTS['MV']+LVAXIS*(48/MM),LVAXIS,BASE['tgapicalsax'],305,300)
 for key,f,tol in [('tgbasalsax',basal,2.5),('tgpapillary',pap,4),('tgapicalsax',apic,4)]:
  pname=key+'-level';POINTS[pname]=f['center'];includes=[inc(pname,tol,4,6)]
  add(key,includes,[('ventricular-level',f)],axis=LVAXIS,axis_mode='normal',angle_sigma=25,pivot=f['center'],limits=['Papillary/leaflet profiles are assessed on measured pixels; the fixed LV cavity is collapsed.'])
 hinges=np.array(read('docs/anatomy/boundary-landmarks.json')['tricuspidHingeSourceXYZ'])
 tvplane=fitted_plane(hinges,up_hint=BASE['tgrvbasal']['up'],right_hint=BASE['tgrvbasal']['right'],width=350,height=340);tvplane=orient(tvplane,BASE['tgrvbasal']);tvplane['center']-=tvplane['normal']*(1.5/MM)
 POINTS['TVplane']=tvplane['center']
 add('tgrvbasal',[inc('TVplane',2.5,4,4)],[('TV-hinge-best-fit',tvplane)],axis=tvplane['normal'],axis_mode='normal',angle_sigma=25,pivot=tvplane['center'],limits=['The curved tricuspid hinge departs from a flat plane; this is not an annular measurement.'])
 for key,src in [('deeptg5c','me5c'),('tg2c','me2c'),('tglax','melax')]:
  c=C[src];seed=f2 if key=='tg2c' else lax if key=='tglax' else f4
  seed=orient(seed,BASE[key]);seed['width']=360;seed['height']=475
  add(key,[dict(t) for t in c['include']],[('gastric-family-landmarks',seed)],c['exclude'],axis=LVAXIS,angle_sigma=65,limits=['Gastric approach orientation is illustrative; esophagus and stomach are absent from the scan.'])
  if key=='tg2c':C[key]['seeds'].append(('me2c-physical-family',orient(BASE['me2c'],BASE[key])))
 rvlong=target_frame(['TV','RA','RVmid','RVapex'],BASE['tgrvin'],[4,1,2,2],330,430)
 add('tgrvin',[inc('TV',3,4,5),inc('RVmid',4,3,7),inc('RVapex',5,2,8),inc('RA',7,1)], [('TV-RV-apex-fit',rvlong),('RV-inflow-reviewed',flow_frame('rv-inflow',BASE['tgrvin'],330,430))],angle_sigma=55)
 return C

def regional_exclusion(f,key,volume,labels):
 """Reject visibly wrong-family right-heart tissue in left-only long sections.

 This uses coarse existing regional annotations only as an exclusion aid.
 It never identifies an ostium, cusp, scallop, or clinical chamber boundary.
 """
 if key not in ('me2c','tg2c','mecommissural'):return 0,0,{}
 a,b=sample(volume,f,72,labels);mask=a>40;n=max(1,int(mask.sum()))
 fractions={str(i):float(((b==i)&mask).sum()/n) for i in range(7)}
 limits={2:.035,4:.035,5:.025}
 gates=sum(fractions[str(i)]>limit for i,limit in limits.items())
 penalty=sum((max(0,fractions[str(i)]-limit*.3)/limit)**2*.8 for i,limit in limits.items())
 # A pulmonary artery may be present outside the sonographic near-field sector;
 # its area is only a mild continuous term, never a defining rejection gate.
 penalty+=max(0,fractions['6']-.06)*2
 return gates,penalty,fractions

def evaluate(f,c):
 distances={t['name']:abs(float(np.dot(t['point']-f['center'],f['normal'])))*MM for t in c['include']}
 gates=sum(distances[t['name']]>t['gateMm'] for t in c['include'] if t['gateMm'] is not None)
 cost=sum(t['weight']*(distances[t['name']]/t['toleranceMm'])**2 for t in c['include'])/sum(t['weight'] for t in c['include'])
 excluded={}
 for key,clearance,weight in c['exclude']:
  dist=abs(float(np.dot(POINTS[key]-f['center'],f['normal'])))*MM;excluded[key]=dist
  cost+=weight*(max(0,clearance-dist)/clearance)**2
  gates+=int(dist<clearance*.75)
 if c['axis'] is not None:
  cosine=abs(float(np.dot(f['normal'],c['axis'])));deviation=np.rad2deg(np.arcsin(np.clip(cosine,0,1))) if c['axis_mode']=='inplane' else np.rad2deg(np.arccos(np.clip(cosine,0,1)))
  cost+=(deviation/12.)**2*.4
  if c['axis_mode']=='normal':gates+=int(deviation>22)
 else:deviation=None
 # Penalize departure from the nearest anatomically authored start only weakly.
 angles=[np.rad2deg(np.arccos(np.clip(abs(np.dot(f['normal'],s['normal'])),-1,1))) for _,s in c['seeds']]
 cost+=(min(angles)/c['angle_sigma'])**2*.12
 return int(gates),float(cost),distances,excluded,deviation

def serialize(f):return {k:v.tolist() if isinstance(v,np.ndarray) else v for k,v in f.items()}
def diversity_pick(candidates,count=12,min_angle=4,min_offset=2):
 chosen=[]
 for c in candidates:
  f=c['frame'];distinct=True
  for p in chosen:
   g=p['frame'];ang=np.rad2deg(np.arccos(np.clip(abs(np.dot(f['normal'],g['normal'])),-1,1)));off=abs(np.dot(f['center']-g['center'],g['normal']))*MM
   if ang<min_angle and off<min_offset:distinct=False;break
  if distinct:chosen.append(c)
  if len(chosen)>=count:break
 return chosen

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--views',nargs='*');parser.add_argument('--no-render',action='store_true');args=parser.parse_args()
 configs_all=configs();volume,meta=load_volume();labels=load_labels();ledgers=[];summary={}
 keys=args.views or list(BASE)
 prior_path=OUT/'search-results.json'
 if args.views and prior_path.exists():summary=json.loads(prior_path.read_text())['views']
 ledger_path=OUT/'candidate-ledger.csv.gz'
 if args.views and ledger_path.exists():
  with gzip.open(ledger_path,'rt',newline='') as file:
   reader=csv.reader(file);next(reader)
   ledgers.extend(row for row in reader if row[0] not in keys)
 for key in keys:
  c=configs_all[key];candidates=[]
  def add_candidate(f,stage,seed,params):
   gates,cost,dist,exc,dev=evaluate(f,c);rgates,rcost,fractions=regional_exclusion(f,key,volume,labels)
   candidate=dict(id=len(candidates),frame=f,stage=stage,seed=seed,params=params,gates=gates+rgates,cost=cost+rcost,distancesMm=dist,exclusionDistancesMm=exc,axisDeviationDegrees=dev,regionalTissueFractions=fractions)
   candidates.append(candidate)
  add_candidate(BASE[key],'baseline','baseline',[0,0,0])
  for name,seed in c['seeds']:
   # 9x9x9 candidates per independent starting geometry; ±32°, ±16mm.
   for yaw,pitch,off in itertools.product(range(-32,33,8),range(-32,33,8),range(-16,17,4)):
    add_candidate(rotated(seed,yaw,pitch,off,c['pivot']),'broad',name,[yaw,pitch,off])
  ranked=sorted(candidates,key=lambda x:(x['gates'],x['cost']));broad=diversity_pick(ranked,10,5,2)
  for parent in broad:
   for yaw,pitch,off in itertools.product([-4,-2,0,2,4],[-4,-2,0,2,4],[-2,-1,0,1,2]):
    add_candidate(rotated(parent['frame'],yaw,pitch,off,c['pivot']),'fine',f"candidate-{parent['id']}",[yaw,pitch,off])
  ranked=sorted(candidates,key=lambda x:(x['gates'],x['cost']));shortlist=diversity_pick(ranked,19,2.5,.9)
  # Include broader alternatives, so local numerical minima do not hide anatomy.
  top=[candidates[0]]+shortlist[:11]+broad[:8]
  seen=set();top=[x for x in top if not (x['id'] in seen or seen.add(x['id']))]
  source_count=0;items=[]
  for i,can in enumerate(top):
   if not args.no_render:
    a,b=sample(volume,can['frame'],430,labels);source_count+=1
    items.append((image(a,b),f"{key}  #{can['id']}  {can['stage']}",f"gates {can['gates']} · geometric cost {can['cost']:.3f}"))
   can['frame']=serialize(can['frame'])
  if not args.no_render:contact_sheet(items,OUT/f'candidates/{key}.jpg',f"{VIEWS[key]['aseNumber']:02d} {VIEWS[key]['name']} • source candidate comparison",cols=4)
  summary[key]=dict(view=VIEWS[key]['name'],candidatesEvaluated=len(candidates),broadCandidates=1+729*len(c['seeds']),fineCandidates=125*len(broad),measuredReformatsRendered=source_count,selectedCandidateId=shortlist[0]['id'],shortlist=top,limits=c['limits'])
  for can in candidates:
   f=can['frame'];ledgers.append([key,can['id'],can['stage'],can['seed'],*can['params'],can['gates'],round(can['cost'],7),*np.round(f['center'],6),*np.round(f['normal'],8)])
  print(key,len(candidates),'best',shortlist[0]['id'],'gates',shortlist[0]['gates'],'cost',round(shortlist[0]['cost'],3),flush=True)
 write('docs/tee-plane-qc-v2/search-results.json',dict(schemaVersion=1,method='Landmark inclusion/exclusion and anatomical-axis broad-to-fine exploration. Costs prioritize candidates for source-pixel review; not clinical accuracy.',views=summary,totalCandidates=sum(x['candidatesEvaluated'] for x in summary.values()),totalMeasuredReformats=sum(x['measuredReformatsRendered'] for x in summary.values())))
 with gzip.open(OUT/'candidate-ledger.csv.gz','wt',newline='') as file:
  w=csv.writer(file);w.writerow(['view','candidate','stage','seed','yawDegrees','pitchDegrees','offsetMm','failedGeometricGates','rankingCost','centerX','centerY','centerZ','normalX','normalY','normalZ']);w.writerows(ledgers)
 write('docs/tee-plane-qc-v2/search-targets.json',{key:{'include':[{**t,'point':t['point'].tolist()} for t in c['include']],'exclude':c['exclude'],'axis':None if c['axis'] is None else c['axis'].tolist(),'axisMode':c['axis_mode'],'pivot':c['pivot'].tolist(),'seeds':[{ 'name':name,'frame':serialize(f)} for name,f in c['seeds']],'limits':c['limits']} for key,c in configs_all.items()})

if __name__=='__main__':main()
