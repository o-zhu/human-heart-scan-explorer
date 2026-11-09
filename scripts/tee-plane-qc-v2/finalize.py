"""Publish only visually adjudicated, display-oriented derived TEE frames.

Original atlas frames, textures, source data, and anatomical labels stay intact.
The production file is intentionally small; the full exploration stays in docs.
"""
from common import *
from search import BASE,POINTS,VIEWS,serialize
import math

results=read('docs/tee-plane-qc-v2/search-results.json')
adaptive=read('docs/tee-plane-qc-v2/adaptive-level-review.json')
CHOICE={'me2c':1777,'tgbasalsax':11201,'tgpapillary':0,'tgapicalsax':0,'melaa':0}
LIMITED={'mecommissural','merpv','memodbicaval','bicaval','mepv','melaa','tgbasalsax','tgrvbasal'}
SUMMARIES={
 'me5c':'Both ventricular/AV-junction regions are retained with a stronger LV outflow and aortic-root section; some apical foreshortening is accepted.',
 'me4c':'The plane now follows both AV-junction regions and the LV apex while removing the previously dominant aortic-outflow profile.',
 'mecommissural':'A broader mitral-region and long-LV section replaces the outflow-containing starting plane; scallop correspondence remains unresolved.',
 'me2c':'Long LA–mitral-region–LV continuity is retained with little right-heart tissue; visually cleaner than lower-cost candidates that resembled four-chamber sections.',
 'melax':'A continuous source section connects the LV/mitral region with the LV outflow and elongated aortic root; display orientation places outflow to the right.',
 'meavlax':'Root/cusp and proximal ascending-aortic continuity were selected together with the LA near-field region; the root axis is displayed horizontally.',
 'meaaolax':'A long section follows the retained ascending-aortic lumen and walls; the LA region constrains the plane azimuth.',
 'meaaosax':'The selected section is perpendicular to the retained ascending-aortic segment, separate from the valve-level short-axis target.',
 'merpv':'The closest available LA/venous-entry region was reviewed in multiple planes; the two right pulmonary-vein ostia are not individually confirmed.',
 'meavsax':'The plane is moved from ventricular/outflow tissue to the source-observed three-sinus/cusp region of the aortic root.',
 'mervinout':'An anatomy-fitted section connects the tricuspid-side RV with the muscular outflow/pulmonary-valve region; inflow is displayed to the left.',
 'memodbicaval':'The section is centered on RA–tricuspid-region–RV continuity, while individual caval and leaflet identities remain uncertain.',
 'bicaval':'Atrial and septal-side continuity is favored over ventricular/outflow tissue; the preserved specimen does not establish both caval ostia.',
 'mepv':'A source-reviewed LA/venous-entry plane is shown; right and left pulmonary-vein acquisitions are distinct clinical maneuvers, and all four ostia are not established here.',
 'melaa':'Multiple lateral-LA sections were examined. The original lateral atrial region is retained because no candidate established a more defensible LAA ostial/lobe section.',
 'tgbasalsax':'An independently oriented basal LA–LV interface section shows a broader mitral-region opening and removes the dominant arterial-root star of the earlier plane.',
 'tgpapillary':'The original plane is retained after broad exploration and 21 close neighbors: its two principal muscular profiles are clearer than the newly proposed level.',
 'tgapicalsax':'The original distal ventricular plane is retained after broad exploration and 21 close neighbors; it avoids the dominant papillary profile seen in more proximal candidates.',
 'tgrvbasal':'A plane based on the reviewed tricuspid hinge neighborhood replaces the duplicated LV/root-level cut; exact en-face tricuspid correspondence remains partial.',
 'tgrvinout':'The selected measured plane follows RV inflow and outflow regions around the aortic root, replacing a nonspecific transverse cut.',
 'deeptg5c':'The section brings both ventricular regions and LV outflow into one measured plane with a gastric-side presentation.',
 'tg2c':'The new measured plane excludes the long aortic pathway seen previously and isolates the LA–mitral-region–LV sequence; the apex is displayed to the left.',
 'tgrvin':'An independent TV–RV-body–apical-RV plane replaces the generic tilted starting frame, with RV/apical tissue to the left and the tricuspid/atrial side to the right.',
 'tglax':'The section follows the long LV into its outflow/root, with the ventricular/apical side to the left and basal outflow to the right.',
}
EXTRA_LIMITS={
 'me4c':['AV-junction and septal identities are approximate source landmarks, not an expert reference registration.'],
 'me2c':['Anterior/inferior wall identity is not independently registered to a living-patient TEE acquisition.'],
 'melax':['The collapsed LV and adjoining fibrous/valvar tissue do not reproduce a normal clinical echo cavity.'],
 'meavlax':['Valve annulus, sinotubular junction and cusp identities are not separate measured segmentations.'],
 'meaaolax':['The ascending vessel ends are specimen-truncated; no aortic arch is present.'],
 'meaaosax':['The nearby SVC and right pulmonary artery have not been individually verified.'],
 'meavsax':['The root/cusp level is source-reviewed; individual cusp labels and exact annular dimensions are unvalidated.'],
 'tgbasalsax':['This is a mitral-region correspondence; exact leaflet/annular boundaries and the clinical fishmouth appearance remain unvalidated.'],
 'tgrvbasal':['A flat cut cannot reproduce the curved TV hinge perfectly; a complete en-face three-leaflet view is not established.'],
 'tgrvin':['Tricuspid leaflet and subvalvular identities are not individually segmented.'],
}

def ndarray_frame(f):return {k:np.asarray(v,float) if isinstance(v,list) else v for k,v in f.items()}
def project_to_plane(point,f):
 point=np.array(point,float);return point-f['normal']*np.dot(point-f['center'],f['normal'])
def oriented_root(f,ascending_right=True):
 axis=unit(POINTS['AA']-POINTS['AV']);right=unit(axis-f['normal']*np.dot(axis,f['normal']))
 if not ascending_right and np.dot(right,f['right'])<0:right=-right
 near=POINTS['LA']-POINTS['AV'];up=unit(near-f['normal']*np.dot(near,f['normal'])-right*np.dot(near,right))
 return frame(f['center'],right,up,335,275)

selected={};decisions={};items=[];small=[];volume,meta=load_volume();labels=load_labels();checks=[]
for key,v in results['views'].items():
 id=CHOICE.get(key,v['selectedCandidateId']);pool=v['shortlist']+adaptive['views'].get(key,[]);chosen=next(x for x in pool if x['id']==id)
 physical=ndarray_frame(chosen['frame']);f={k:val.copy() if isinstance(val,np.ndarray) else val for k,val in physical.items()};presentation=[]
 if key in ['melax','mervinout']:
  f=frame(f['center'],-f['right'],f['up'],f['width'],f['height']);presentation.append('Horizontal display reflection; physical plane unchanged.')
 if key=='meavlax':
  f=oriented_root(f);f['center']=project_to_plane((POINTS['AVcusps']+POINTS['AAprox']+POINTS['MV'])/3,f);presentation.append('In-plane roll: aortic axis horizontal/rightward, LA side near field; physical plane unchanged.')
 if key=='meaaolax':
  f=oriented_root(f,False);f['center']=project_to_plane((POINTS['AAprox']+POINTS['AAtop'])/2,f);f['width']=320;f['height']=260;presentation.append('In-plane roll to horizontal retained aorta, with LA-side near field; physical plane unchanged.')
 if key in ['tg2c','tgrvin','tglax']:
  f=frame(f['center'],-f['up'],f['right'],f['height'],f['width']);presentation.append('Quarter-turn display roll: ventricular/apical side left, basal valve/atrial or outflow side right; physical plane unchanged.')
 # Avoid the oversized original atrial fields after target-centered source fitting.
 # This adjusts in-plane framing only, never plane normal or tissue values.
 if key in ['merpv','mepv']:
  f['center']=project_to_plane(np.array([310,270,220]),f);f['width']=300;f['height']=315
 if key=='bicaval':
  f['center']=project_to_plane(np.array([268,221,200]),f);f['width']=335;f['height']=330
 baseline=BASE[key];angle=float(np.rad2deg(np.arccos(np.clip(abs(np.dot(baseline['normal'],f['normal'])),-1,1))));shift=abs(float(np.dot(f['center']-baseline['center'],baseline['normal'])))*MM
 retained=(id==0);status='retained' if key in ['tgpapillary','tgapicalsax'] else 'limited' if key in LIMITED else 'refined'
 limits=list(dict.fromkeys([s.replace('Leaflet-level continuity is visually reviewed; individual pulmonary cusps are not segmented.','Regional inflow/outflow continuity is visually reviewed; individual valve leaflets/cusps are not segmented or verified.') for s in v['limits']]+EXTRA_LIMITS.get(key,[])))
 if not limits:limits=['Approximate source-landmark fit in a fixed specimen; not a validated clinical TEE registration.']
 count=v['candidatesEvaluated']+len(adaptive['views'].get(key,[]));rendered=v['measuredReformatsRendered']+len(adaptive['views'].get(key,[]))
 final=world_frame(f)
 # A presentation correction may reflect the signed normal but cannot change
 # the set of source points lying in the physical plane.
 normal_alignment=abs(np.dot(physical['normal'],f['normal']));offset=abs(np.dot(f['center']-physical['center'],physical['normal']))
 assert abs(normal_alignment-1)<1e-8 and offset<1e-7,(key,normal_alignment,offset)
 assert abs(np.linalg.det(np.array([final['right'],final['up'],final['normal']]))-1)<1e-8
 selected[key]=dict(frame=final,status=status,summary=SUMMARIES[key],remainingLimits=limits,search=dict(candidatesEvaluated=count,broadCandidates=v['broadCandidates'],fineCandidates=v['fineCandidates'],adaptiveMeasuredReformats=len(adaptive['views'].get(key,[])),measuredReformatsRendered=rendered,selectedCandidateId=id,selection='Visual source-anatomy adjudication after geometric inclusion/exclusion search; geometric rank is not clinical accuracy.'),source=dict(specimen='LADAF-2021-17',coordinates='Original s4 voxel-center XYZ, 317.6 µm',centerXYZ=np.round(f['center'],9).tolist(),rightXYZ=np.round(f['right'],12).tolist(),upXYZ=np.round(f['up'],12).tolist(),normalXYZ=np.round(f['normal'],12).tolist(),originalPhysicalPlaneRetained=retained,baselineNormalAngleDegrees=round(angle,3),baselineNormalDisplacementMm=round(shift,3)),presentation=presentation)
 decisions[key]=dict(candidate=id,status=status,physicalFrame=serialize(physical),presentedFrame=serialize(f),summary=SUMMARIES[key],remainingLimits=limits,originalCandidate=0,presentation=presentation,geometricEvidence={k:chosen.get(k) for k in ['gates','cost','distancesMm','exclusionDistancesMm','regionalTissueFractions'] if k in chosen})
 before=sample(volume,baseline,600);after=sample(volume,f,600);_,tint=sample(volume,f,600,labels)
 # Group before/after rows into independent manageable source-review sheets.
 items.extend([(image(before),f"{VIEWS[key]['aseNumber']:02d} {key} • original",'v44 measured source'),(image(after),f"{key} • selected #{id}",f'{status} · same unchanged source bank'),(image(after,tint),f"{key} • regional guide",'Approximate existing annotations; not ostial labels')])
 small.append((image(after,tint),f"{VIEWS[key]['aseNumber']:02d} {key} · {status}",SUMMARIES[key]))
 checks.append(dict(view=key,presentationPreservesPhysicalPlane=True,frameOrthonormal=True,normalCrossProduct=True,sourceToWorldRoundTripMaxError=float(np.max(np.abs(source_point(final['center'])-f['center'])))))

for i in range(0,len(items),18):contact_sheet(items[i:i+18],OUT/f'final-before-after-{i//18+1}.jpg','Original / selected measured source / approximate region guide',cols=3,cell=430,row=480)
contact_sheet(small,OUT/'final-selected-overview.jpg','Final source-anatomy adjudication • approximate donor-specific TEE correspondence',cols=4,cell=390,row=440)
provenance=read('docs/tee-plane-qc-v2/source-provenance.json')
data=dict(schemaVersion=1,id='tee-plane-fit-v2',datasetId='1659197537',specimen='LADAF-2021-17',reviewedDate='2026-11-07',sourceCommit='5761089d06cae66da76445565999307a0612d184',description='Separate, donor-specific, source-reviewed approximate TEE frames. Original frames, prepared textures and source voxels remain immutable.',clinicalRegistrationValidated=False,source=provenance,method='Broad-to-fine landmark/axis inclusion and defining-exclusion exploration, followed by measured-source visual adjudication. Wrong-family regional tissue excludes misleading left-only views. Actual papillary/mitral profiles override geometric ranking.',outsideScanViews=['daosax','daolax','uearchlax','uearchsax'],views=selected)
write('public/assets/tee-atlas/plane-fit-v2.json',data)
write('docs/tee-plane-qc-v2/selection-decisions.json',decisions)
write('docs/tee-plane-qc-v2/geometry-verification.json',dict(checks=checks,sourcePreserved=True,sourceDecodedSha256=meta['decodedSha256'],totalCandidatesEvaluated=sum(v['search']['candidatesEvaluated'] for v in selected.values()),totalCandidateReformats=sum(v['search']['measuredReformatsRendered'] for v in selected.values()),baselineSections=24,finalComparisonSections=48,validatedClinicalRegistration=False))
print('Wrote',len(selected),'derived frames; statuses', {s:sum(v['status']==s for v in selected.values()) for s in ['refined','retained','limited']})
print('Candidates',sum(v['search']['candidatesEvaluated'] for v in selected.values()),'candidate reformats',sum(v['search']['measuredReformatsRendered'] for v in selected.values()))
