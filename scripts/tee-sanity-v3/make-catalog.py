"""Create conservative, reviewable per-view CT support statements and tissue anchors.

This file never edits acquisition pixels, segmentation, runtime, or prior planes.
The support labels describe source-region correspondence, not expert validation.
"""
from audit import *
from common import grid, world_point
from scipy.ndimage import distance_transform_edt, label as components
from collections import Counter

# summary is intended to remain visible next to the active CT view.
D = {
'me5c': ('supported',
 'The section includes both atrial and ventricular regions and opens the LV outflow into the aortic root. The fixed LV cavity is narrower than the live ultrasound example.',
 ['LV','RV','LA','RA','aortic root'], ['LV','RV','LA','RA','LVOT','AV'],
 ['Regional continuity is supported; individual valve leaflet identity and clinical beam alignment are not validated.']),
'me4c': ('supported',
 'Both atrial and ventricular regions cross the section, with the aortic outflow excluded. The large open cavity is RV; the thick, collapsed cavity beside it is LV.',
 ['LV','RV','LA','RA'], ['LV','RV','LA','RA','AV junctions'],
 ['Fixed-specimen cavity collapse prevents the chamber proportions of a living four-chamber view.','Individual mitral and tricuspid leaflets are not separately segmented.']),
'mecommissural': ('partial',
 'The section follows the LA–mitral–LV region, with little right-ventricular tissue. The defining mitral commissures and leaflet scallops cannot be confirmed in this CT section.',
 ['LV','LA','mitral region'], ['LV','LA','mitral commissures'],
 ['Do not identify P3, A2 or P1 from these regional labels.','Some pulmonary-root tissue lies outside the intended left-heart focus.']),
'me2c': ('supported',
 'A longitudinal LV–LA section is present, with the right ventricle and aortic root largely excluded. The narrow LV lumen reflects the preserved specimen.',
 ['LV','LA','mitral region'], ['LV','LA','MV'],
 ['Individual leaflet and LV wall-segment identities are not independently validated.']),
'melax': ('supported',
 'The LV, LA and aortic-root pathway are present in a longitudinal section. The LV cavity is collapsed, so its outline differs from the ultrasound reference.',
 ['LV','LA','aortic root','adjacent RV'], ['LV','LA','MV','LVOT','AV'],
 ['The coarse regions establish the ventricular–aortic relationship, not individual aortic cusps or mitral scallops.']),
'meavlax': ('supported',
 'The aortic root is cut lengthwise where it joins the LV outflow. Adjacent LV, LA and RV tissue is retained as context.',
 ['LV outflow region','aortic root','LA','adjacent RV'], ['LVOT','AV','proximal aorta'],
 ['Individual aortic cusp identity and a clinical LVOT measurement axis are not established.']),
'meaaolax': ('supported',
 'The acquired ascending-aortic segment is cut lengthwise. The neighboring pulmonary root and left atrial region are also visible; the scan does not contain the full arch.',
 ['ascending aorta','pulmonary root','LA'], ['ascending aorta'],
 ['The available ascending vessel ends within the isolated-heart acquisition.','This section cannot establish the aortic arch branches or complete pulmonary-artery branching.']),
'meaaosax': ('partial',
 'An ascending-aortic cross-section is present beside the larger pulmonary-root section. A separate superior vena cava is not confirmed.',
 ['ascending aorta','pulmonary root','LA','RA'], ['ascending aorta','SVC','pulmonary artery'],
 ['Aortic versus pulmonary tissue ownership supports the main vessel distinction.','SVC and individual pulmonary-artery branch identities remain unconfirmed.']),
'merpv': ('unsupported',
 'This is a left-atrial neighborhood section. The named right pulmonary-vein ostia are not identified, so the CT is not a confirmed right pulmonary-vein view.',
 ['LA','adjacent RA','adjacent LV'], ['LA','right pulmonary-vein ostia'],
 ['No separate pulmonary-vein segmentation or reliable vein-to-atrium ostial continuity is available.','Use the real ultrasound example to learn the named vein view; this CT supplies only nearby anatomy.']),
'meavsax': ('supported',
 'The section crosses the aortic root at a cusp-like short-axis profile, surrounded by atrial and right-ventricular regions.',
 ['aortic root','LA','RA','RV'], ['AV','aortic root'],
 ['Cusp-like morphology is visible, but right, left and noncoronary cusp identities are not validated by these labels.']),
'mervinout': ('supported',
 'The RA and RV inflow region connect to an RV outflow and pulmonary-root region in this section. The aortic root is a central landmark; very little LV-labelled tissue is included.',
 ['RA','RV','RV outflow region','pulmonary root','aortic root'], ['RA','TV','RV','RVOT','PV','PA'],
 ['The regional right-heart pathway is supported; individual tricuspid and pulmonary leaflets are not separately labelled.','A region-matched CT section does not validate the modeled probe depth or flexion in this donor.']),
'memodbicaval': ('partial',
 'RA, tricuspid-region and RV tissue are present. The superior and inferior caval entries are not both confirmed, so this is a partial comparison to the modified bicaval view.',
 ['RA','RV','tricuspid region','adjacent LA'], ['RA','TV','RV','caval entries'],
 ['Do not infer named caval ostia or tricuspid leaflet identity from the broad regional labels.']),
'bicaval': ('unsupported',
 'Both atrial regions are present, but the SVC and IVC openings are not identified together. This CT section is not a confirmed bicaval view.',
 ['RA','LA','adjacent LV','pulmonary-root fragment'], ['RA','LA','IAS','SVC','IVC'],
 ['The broad atrial correspondence does not prove the named caval entries or fossa ovalis.','The clinical ultrasound example remains the source for the complete bicaval target.']),
'mepv': ('unsupported',
 'The section samples the left atrial neighborhood. Right and left pulmonary-vein ostia cannot be distinguished reliably, so the named pulmonary-vein view is unconfirmed in CT.',
 ['LA','adjacent RA','adjacent LV'], ['LA','right and left pulmonary-vein ostia'],
 ['No separate pulmonary-vein labels or confirmed bilateral ostial continuity are available.']),
'melaa': ('unsupported',
 'Left atrial tissue is visible, but an appendage with confirmed ostial continuity is not established. This CT section is not a verified LAA view.',
 ['LA','adjacent RA','adjacent LV'], ['LA','LAA','LAA ostium'],
 ['A left-atrial region label alone cannot identify the appendage or its pectinate muscles.']),
 'tgbasalsax': ('partial',
 'The section crosses the basal LV and mitral region, with the RV beside it. A basal opening is visible, but a complete mitral fish-mouth profile is not confirmed.',
 ['basal LV','mitral region','RV','adjacent LA'], ['basal LV','MV short axis'],
 ['Mitral leaflet boundaries are not separately segmented.','Nearby source sections either enter the aortic root or pass below the intended basal level; this plane is retained as the most defensible regional comparison.']),
 'tgpapillary': ('partial',
 'The LV cavity is narrow and collapsed. The larger open cavity and prominent separated muscular profiles belong to RV; paired LV papillary muscles are not confirmed in this fixed specimen.',
 ['midventricular LV','midventricular RV'], ['mid-LV short axis','paired LV papillary muscles'],
 ['This is a midventricular regional comparison, not a verified paired-LV-papillary view.','The source LV is collapsed. Regional ownership cannot label individual papillary muscles or convert RV profiles into LV anatomy.']),
 'tgapicalsax': ('supported',
 'This more distal section crosses the LV apex region with an adjacent RV crescent. The LV cavity is almost closed in the preserved specimen.',
 ['apical LV','apical RV'], ['apical LV short axis'],
 ['The source level is apical relative to the basal and midventricular sections.','Exact clinical wall segments and the beating-heart cavity contour are not independently validated.']),
 'tgrvbasal': ('partial',
 'The basal RV and tricuspid region are present beside the shared septal/LV tissue. Aortic and pulmonary-root tissue is also visible, but the complete tricuspid short-axis and RVOT combination is not confirmed.',
 ['basal RV','tricuspid region','RA','shared septal/LV tissue','aortic root','pulmonary root'], ['basal RV','TV short axis','RVOT'],
 ['A higher RV colour fraction in neighboring sections does not prove the correct tricuspid or RVOT level.','Individual tricuspid leaflets and a continuous RVOT-to-pulmonary-valve axis remain unverified.']),
 'tgrvinout': ('supported',
 'The section contains the RA–RV inflow and the RV outflow/pulmonary-root pathway. It does not substitute an LV-dominant section for the right-heart target.',
 ['RA','RV','RV outflow region','pulmonary root','aortic root'], ['TV','RV','RVOT','PV','PA'],
 ['The inflow–outflow regional relationship is supported; valve leaflet identities are not separately segmented.','The modeled transgastric probe approach is illustrative, not measured in this donor.']),
 'deeptg5c': ('partial',
 'The LV outflow and aortic-root pathway are present with four-chamber context. This CT section does not confirm that the modeled deep-transgastric probe can acquire the ideal Doppler-aligned view.',
 ['LV','RV','LA','RA','aortic root'], ['LVOT','AV','proximal aorta','MV'],
 ['The physical section has useful anatomy, but the gastric probe route and beam alignment are schematic.','This is not evidence of a patient-specific acoustic window or Doppler alignment.']),
 'tg2c': ('supported',
 'A longitudinal LV–LA section is present with little right-ventricular tissue and no aortic-root section. The collapsed LV lumen is retained as acquired.',
 ['LV','LA','mitral region'], ['LV','LA','MV'],
 ['Individual papillary, chordal and leaflet identities are not independently established.','The modeled transgastric approach is illustrative.']),
 'tgrvin': ('supported',
 'RA and RV tissue surround the inflow pathway. The thick adjacent tissue belongs to the shared septal/LV region, not a second RV cavity.',
 ['RA','RV','tricuspid region','shared septal/LV tissue'], ['RA','TV','RV inflow'],
 ['The compact septal core is assigned to LV by the regional-label convention; its area is not proof of a wrong right-heart view.','Individual tricuspid leaflets, chordae and papillary muscles are not independently identified.']),
 'tglax': ('supported',
 'The LV, mitral/LA region and aortic outflow are present in a longitudinal section. The gastric presentation is a modeled orientation of the measured anatomy.',
 ['LV','LA','aortic root','adjacent RV'], ['LV','MV','LVOT','AV'],
 ['The regional long-axis relationship is supported; clinical beam alignment and leaflet identity are not validated.']),
 'daosax': ('outside',
 'The descending thoracic aorta is outside this isolated-heart CT acquisition. Learn the target from the clinical ultrasound example and schematic probe context.',
 [], ['descending aorta short axis'], ['No acquired CT plane can verify this target.']),
 'daolax': ('outside',
 'The descending thoracic aorta is outside this isolated-heart CT acquisition. The heart reconstruction cannot supply a measured long-axis section of that vessel.',
 [], ['descending aorta long axis'], ['No acquired CT plane can verify this target.']),
 'uearchlax': ('outside',
 'The complete aortic arch and its branches are outside this isolated-heart acquisition. The spatial guide is schematic; the ultrasound example supplies the real target view.',
 [], ['aortic arch long axis'], ['No acquired CT plane can verify this target.']),
 'uearchsax': ('outside',
 'The aortic arch target is outside this isolated-heart acquisition. A nearby ascending-aortic section must not be presented as the arch short-axis view.',
 [], ['aortic arch short axis'], ['No acquired CT plane can verify this target.']),
}

ANCHORS = {
 'me4c': [1,2], 'mervinout':[2,4,6], 'tgbasalsax':[1,2],
 'tgpapillary':[1,2], 'tgapicalsax':[1,2], 'tgrvbasal':[1,2,4],
 'tgrvinout':[2,4,6], 'tgrvin':[1,2,4],
}
TEXT = {1:'LV tissue',2:'RV tissue',3:'LA tissue',4:'RA tissue',5:'Aortic wall',6:'Pulmonary wall'}

def tissue_anchor(a,b,f,q,region):
    # Find an interior point in the largest connected labelled, measured-tissue
    # component. Mask holes remain holes; blood pools are never filled or tinted.
    mask=(b==region)&(a>65)
    cc,n=components(mask)
    sizes=np.bincount(cc.ravel());sizes[0]=0
    assert n and sizes.max()>30,(region,int(sizes.max()))
    owned=cc==sizes.argmax()
    distance=distance_transform_edt(np.pad(owned,1))[1:-1,1:-1]
    row,col=np.unravel_index(distance.argmax(),a.shape)
    p=q[row,col]
    spacing=f['width']/(a.shape[1]-1)*MM
    assert b[row,col]==region and a[row,col]>65
    return dict(text=TEXT[region],regionId=region,normalizedXY=[round(col/(a.shape[1]-1),6),round(row/(a.shape[0]-1),6)],world=[round(float(x),9) for x in world_point(p)],sourceXYZ=[round(float(x),6) for x in p],sourceValue=int(a[row,col]),interiorDistanceMm=round(float(distance[row,col]*spacing),4),kind='regional tissue ownership; not a blood pool or valve label')

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    prior=read('docs/tee-plane-qc-v2/baselines.json')['views']
    existing=read('public/assets/tee-atlas/plane-fit-v2.json')
    audit=read('docs/tee-sanity-v3/all-view-audit.json')
    volume,source=load_volume();labels=load_labels()
    assert len(D)==28 and set(D)==set(prior)
    records={};visual=[]
    for key,v in prior.items():
        status,summary,visible,target,limits=D[key]
        r=dict(aseNumber=v['aseNumber'],name=v['name'],status=status,summary=summary,visibleRegions=visible,targetRegions=target,remainingLimits=limits,physicalPlaneAction='none: outside acquired volume' if status=='outside' else 'retain reviewed v2 physical plane',sourceReviewPlate=None if status=='outside' else f"current-source-labels-{(v['aseNumber']-1)//6+1}.jpg")
        if key in ANCHORS:
            f=source_frame(existing['views'][key]['frame']);a,b=sample(volume,f,900,labels);q=grid(f,900)
            r['regionAnchors']=[tissue_anchor(a,b,f,q,k) for k in ANCHORS[key]]
            im=image(a,b,.62);d=ImageDraw.Draw(im)
            for anchor in r['regionAnchors']:
                x=anchor['normalizedXY'][0]*(im.width-1);y=anchor['normalizedXY'][1]*(im.height-1)
                text=anchor['text'];color=COLORS[anchor['regionId']]
                d.ellipse((x-5,y-5,x+5,y+5),fill=color,outline='white',width=2)
                bbox=d.textbbox((x+10,y-11),text,font=font(17));d.rectangle((bbox[0]-4,bbox[1]-4,bbox[2]+4,bbox[3]+4),fill=(5,10,14));d.text((x+10,y-11),text,font=font(17),fill=color)
            im.save(OUT/f'anchors-{key}.jpg',quality=93)
        records[key]=r
    report=dict(schemaVersion=1,id='tee-regional-sanity-v3',datasetId=existing['datasetId'],reviewedDate='2026-11-07',clinicalRegistrationValidated=False,expertValidated=False,source=source,labelRevision=audit['labelRevision'],labelDecodedSha256=audit['labelDecodedSha256'],basis='All 24 current acquired CT sections compared with the same endpoint-registered v17 regional labels; 135 bounded TG candidate entries reviewed, including repeated current frames. Four extra-thoracic vessel targets are outside the acquired heart volume.',clinicalReference=dict(url='https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf',section='ASE/SCA 2013 comprehensive TEE, Table 10 and corresponding view descriptions'),statusDefinitions=dict(supported='The intended broad regional anatomy and relation are supported by source inspection; not clinical or leaflet validation.',partial='Some defining anatomy or the modeled acquisition approach remains unconfirmed.',unsupported='The defining named target is not identified in the available CT; use only as a regional comparison.',outside='The target is not included in this isolated-heart acquisition.'),globalLimits=['Regional labels are approximate tissue ownership, not blood-pool volumes, valve identities or expert ground truth.','The compact shared septum is assigned to LV; only the thin RV-facing layer is assigned to RV. Do not score view identity by the LV/RV tissue ratio.','The 317.6 µm display bank is windowed uint8 source data, not calibrated HU. No source pixels or masks were changed.','The ultrasound examples come from different subjects; CT-versus-cine alignment and probe/esophagus/stomach placement are educational approximations.'],views=records)
    (OUT/'review-catalog.json').write_text(json.dumps(report,indent=2)+'\n')
    print('All 28 reviewed:',dict(Counter(r['status'] for r in records.values())))
    print('Anchors:',sum(len(r.get('regionAnchors',[])) for r in records.values()),'across',len(ANCHORS),'views')

if __name__=='__main__':main()
