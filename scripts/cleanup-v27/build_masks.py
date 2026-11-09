#!/usr/bin/env python3
"""Apply bounded, reversible v27 display edits to immutable v26 masks.

Source scalar values and original mesh payloads are never modified. Explicit
user-selected objects may contain bright material: their tissue identity is not
inferred from colour or intensity. Dense source outside the reviewed object is
protected by a 3D ten-sample collar. Chordal/arterial fringe operations instead
protect every dense source core, including ones inside the reviewed envelope.
"""
from pathlib import Path
import argparse,gc,gzip,hashlib,importlib.util,json,sys,time
import numpy as np
from scipy import ndimage as ndi
from matplotlib.path import Path as Polygon
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
from reviewed_selections import OPERATIONS,MASK_BOUNDS
PUBLIC=ROOT/'public/assets/cleanup-v27';DOCS=ROOT/'docs/cleanup-v27'
DATA=Path('/workspace/data/cleanup-v27');START=time.monotonic();MARGIN=9
BASE_PATH=ROOT/'public/assets/cleanup-v26/lumen-manifest.json'
BASE=json.loads(BASE_PATH.read_text())

def digest(data):return hashlib.sha256(data).hexdigest()
def log(**kwargs):print(json.dumps(dict(seconds=round(time.monotonic()-START,2),**kwargs)),flush=True)
def bbox_slice(lo,hi,origin):return tuple(slice(int(a),int(b)) for a,b in zip((lo-origin)[::-1],(hi-origin)[::-1]))
def load_prior(item,lo,hi):
    encoded=(ROOT/'public'/item['url'].removeprefix('./')).read_bytes();assert digest(encoded)==item['sha256']
    raw=gzip.decompress(encoded);assert digest(raw)==item['decodedSha256']
    packed=np.frombuffer(raw,np.uint8).reshape(item['storageDimensionsXYZ'][::-1])
    result=np.zeros(tuple((hi-lo)[::-1]),bool)
    oldlo=np.array(item['lowerFullFineXYZ']);oldhi=oldlo+item['dimensionsXYZ']
    assert np.all(oldlo>=lo) and np.all(oldhi<=hi)
    result[bbox_slice(oldlo,oldhi,lo)]=np.unpackbits(packed,axis=2,count=item['dimensionsXYZ'][0],bitorder='little').astype(bool)
    return result

def signed_fields(polygons,lo,hi):
    z,x=np.mgrid[lo[2]:hi[2],lo[0]:hi[0]];points=np.column_stack([x.ravel(),z.ravel()]);fields={}
    for y,vertices in polygons.items():
        inside=Polygon(vertices).contains_points(points).reshape(z.shape)
        fields[y]=(ndi.distance_transform_edt(~inside)-ndi.distance_transform_edt(inside)).astype(np.float32)
    return fields

def interpolate(fields,y):
    keys=sorted(fields)
    if y<keys[0] or y>keys[-1]:return None
    right=min(int(np.searchsorted(keys,y,side='right')),len(keys)-1);left=max(0,right-1)
    a,b=keys[left],keys[right];t=0 if a==b else (y-a)/(b-a)
    return fields[a]*(1-t)+fields[b]*t

def old_anchored(strong,envelope):
    labels,_=ndi.label(strong,np.ones((3,3),bool));anchors=np.unique(labels[~envelope]);anchors=anchors[anchors!=0]
    return np.isin(labels,anchors)

def object_core(field,foreground,op,y,source_lo):
    """Select only the source sheet component reached by a reviewed seed.

    An intersected field of view is not proof of a free object: components
    touching the padded source boundary are rejected, retaining attachment
    planes. Two source samples around the selected foreground include its own
    raw/smoothed edge in the explicit object definition, not surrounding wall.
    """
    if op.get('componentMode')!='isolated-sheet':
        core=np.zeros(foreground.shape,bool) if field is None else field<=0
        envelope=core if field is None else field<=op['expansion']
        return core,envelope
    core=np.zeros(foreground.shape,bool)
    if not op['componentRangeY'][0]<=y<=op['componentRangeY'][1]:return core,core
    seeds=op['componentSeeds'];keys=sorted(seeds);xx=np.interp(y,keys,[seeds[k][0] for k in keys]);zz=np.interp(y,keys,[seeds[k][1] for k in keys])
    labels,n=ndi.label(foreground,np.ones((3,3),bool))
    z,x=np.nonzero(foreground)
    if not len(x):return core,core
    distances=(x+source_lo[0]-xx)**2+(z+source_lo[2]-zz)**2;i=int(np.argmin(distances))
    if distances[i]>15**2:return core,core
    selected=int(labels[z[i],x[i]])
    if selected in np.unique(np.concatenate([labels[0],labels[-1],labels[:,0],labels[:,-1]])):return core,core
    component=labels==selected
    if component.sum()>5000:return core,core
    core=ndi.binary_dilation(component,iterations=op['componentCoreAllowance'])
    envelope=ndi.distance_transform_edt(~core)<=op['expansion']
    return core,envelope

def build_operation(reader,op):
    points=np.array([p for polygon in op['polygons'].values() for p in polygon]);ys=sorted(op['polygons'])
    lo=np.array([points[:,0].min()-MARGIN-2,ys[0],points[:,1].min()-MARGIN-2],int)
    hi=np.array([points[:,0].max()+MARGIN+3,ys[-1]+1,points[:,1].max()+MARGIN+3],int)
    result=np.zeros(tuple((hi-lo)[::-1]),bool);pad=13;fields=signed_fields(op['polygons'],lo-pad,hi+pad)
    totals=dict(selectedSamples=0,selectedDenseSourceSamples=0,comparableAnchoredGuardRuleOverlapSamples=0,protectedSourceSamples=0,protectedOverlapSamples=0)
    serial=[]
    for start in range(int(lo[1]),int(hi[1]),24):
        stop=min(start+24,int(hi[1]));a=lo-pad;b=hi+pad;a[1]=start-pad;b[1]=stop+pad
        raw=reader.region(a,b);f05=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3);f08=ndi.gaussian_filter(raw.astype(np.float32),.8,truncate=3)
        strong=(raw>=190)|(f05>=135)|(f08>=135);protected=np.zeros(raw.shape,bool);previous=np.zeros(raw.shape,bool)
        for j,y in enumerate(range(start-pad,stop+pad)):
            field=interpolate(fields,y)
            core,envelope=object_core(field,f05[:,j,:]>=71.4,op,y,a)
            protected[:,j,:]=strong[:,j,:] if op['guardMode']=='all-dense' else strong[:,j,:]&~core
            previous[:,j,:]=old_anchored(strong[:,j,:],envelope)
        guard=ndi.distance_transform_edt(~protected)<=op['guard']
        previous_guard=ndi.distance_transform_edt(~previous)<=10
        support=ndi.distance_transform_edt(~(f05>=71.4))<=MARGIN
        for j,y in enumerate(range(start,stop)):
            field=interpolate(fields,y)
            if field is None:continue
            jj=j+pad;core_mask,envelope=object_core(field,f05[:,jj,:]>=71.4,op,y,a);selected=envelope&support[:,jj,:]&~guard[:,jj,:]
            # Remain in the allowed local region connected to the traced object.
            labels,_=ndi.label(envelope&~guard[:,jj,:],np.ones((3,3),bool))
            seeds=np.unique(labels[core_mask&~guard[:,jj,:]]);seeds=seeds[seeds!=0]
            selected &= np.isin(labels,seeds)
            core=(slice(pad,-pad),slice(pad,-pad));q=selected[core]
            result[:,y-lo[1],:]=q
            record=dict(y=y,selectedSamples=int(q.sum()),selectedDenseSourceSamples=int(np.count_nonzero(q&strong[pad:-pad,jj,pad:-pad])),comparableAnchoredGuardRuleOverlapSamples=int(np.count_nonzero(q&previous_guard[pad:-pad,jj,pad:-pad])),protectedSourceSamples=int(np.count_nonzero(protected[pad:-pad,jj,pad:-pad])),protectedOverlapSamples=int(np.count_nonzero(q&guard[pad:-pad,jj,pad:-pad])))
            for k in totals:totals[k]+=record[k]
            if y in fields:serial.append(record)
        del raw,f05,f08,strong,protected,previous,guard,previous_guard,support;gc.collect()
        log(stage='operation-slab',operation=op['id'],yStart=start,yStop=stop)
    assert totals['protectedOverlapSamples']==0
    assert result.any(),op['id']
    policy=dict(**op,**totals,lowerFullFineXYZ=lo.tolist(),upperFullFineXYZ=hi.tolist(),meshSupportMarginFineSamples=MARGIN,denseGuardFineSamples=op['guard'],sourcePaddingFineSamples=pad,serialChecks=serial,
      method='Serial reviewed signed-distance outlines. Source sigma0.5 threshold71.4 support with a nine-sample 3D mesh allowance. Ten-sample 3D protection of '+('every raw190/sigma0.5/0.8>=135 dense source core.' if op['guardMode']=='all-dense' else 'dense source outside the explicitly selected object core; the object may contain bright material. The source-defined attachment collar is retained.'),
      explicitSelectedObjectException=op['guardMode']=='reviewed-object',
      comparableAnchoredGuardRuleDescription='Counterfactual diagnostic: the earlier anchored-dense rule evaluated on the current operation envelope. Not an archived v26 guard, nor the exact v26 bitset delta.',
      sourceIdentity='Unverified. A reversible visualization selection requested by the user, not a diagnosis of clot, artifact or tissue.')
    if op.get('componentMode')=='isolated-sheet':
        policy['method']='Serial seeded two-dimensional sigma0.5>=71.4 source foreground. Reject components touching the padded source boundary or exceeding5000samples; retain connected attachment planes. Two-sample allowance defines the selected object edge. Nine-sample mesh support and a ten-sample 3D collar protect every dense source core outside this explicitly selected sheet.'
    np.savez_compressed(DATA/(op['id']+'-selection.npz'),lowerXYZ=lo,upperXYZ=hi,mask=result)
    (DOCS/(op['id']+'-policy.json')).write_text(json.dumps(policy,indent=2)+'\n')
    return lo,hi,result,policy

def save(item,lo,hi,mask,policies,restorations,prior_count,added_count,restored_count):
    dims=(hi-lo).tolist();packed=np.packbits(mask,axis=2,bitorder='little');assert packed.shape==tuple([dims[2],dims[1],(dims[0]+7)//8])
    # Full exact logical round-trip with bounded peak memory, including zero padding.
    for z in range(0,dims[2],32):
        decoded=np.unpackbits(packed[z:z+32],axis=2,bitorder='little');assert np.array_equal(decoded[:,:,:dims[0]],mask[z:z+32]);assert not decoded[:,:,dims[0]:].any()
    raw=memoryview(np.ascontiguousarray(packed));encoded=gzip.compress(raw,9,mtime=0);name=item['id'];file=PUBLIC/(name+'.bits.gz');file.write_bytes(encoded)
    coords=np.nonzero(mask);mn=np.array([q.min() for q in coords][::-1]);mx=np.array([q.max()+1 for q in coords][::-1]);del coords
    policy=dict(inheritedV26MaskedSamples=prior_count,addedDisplayExclusionSamples=added_count,restoredPriorExclusionSamples=restored_count,meshSupportMarginFineSamples=MARGIN,denseGuardFineSamples=10,
      newProtectedSourceGuardOverlapSamples=sum(p['protectedOverlapSamples'] for p in policies),
      explicitSelectedObjectExceptions=[p['id'] for p in policies if p['explicitSelectedObjectException']],
      selectedObjectDenseSourceSamples=sum(p['selectedDenseSourceSamples'] for p in policies),
      selectedObjectComparableAnchoredGuardOverlapSamples=sum(p['comparableAnchoredGuardRuleOverlapSamples'] for p in policies),
      sourceIdentity='Material identity remains unverified; original scalar data and mesh preserved.',
      operations=[{k:v for k,v in p.items() if k not in ['polygons','serialChecks']} for p in policies],restorations=restorations,
      fullPolicySha256=digest(json.dumps(dict(operations=policies,restorations=restorations),sort_keys=True,separators=(',',':')).encode()))
    result={**item,'url':'./assets/cleanup-v27/'+file.name,'dimensionsXYZ':dims,'storageDimensionsXYZ':list(packed.shape[::-1]),'lowerFullFineXYZ':lo.tolist(),'upperFullFineXYZ':hi.tolist(),'nonzeroBoundsFullFineXYZ':[(lo+mn).tolist(),(lo+mx).tolist()],'compressedBytes':len(encoded),'decodedBytes':packed.nbytes,'sha256':digest(encoded),'decodedSha256':digest(raw),'logicalMaskSha256':digest(memoryview(mask)),'maskedVoxels':int(mask.sum()),'maskedVolumeMm3':float(mask.sum()*.0794**3),'policy':policy}
    (DOCS/(name+'-mask-build.json')).write_text(json.dumps(result,indent=2)+'\n')
    log(stage='mask-complete',id=name,selected=result['maskedVoxels'],added=added_count,restored=restored_count,decoded=packed.nbytes)
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply-wall-repair',action='store_true');args=parser.parse_args()
    PUBLIC.mkdir(parents=True,exist_ok=True);DOCS.mkdir(parents=True,exist_ok=True);DATA.mkdir(parents=True,exist_ok=True)
    reader=FineSource(cache_bricks=32);items=[];repair=None
    if args.apply_wall_repair:
        spec=importlib.util.spec_from_file_location('wall_repair',ROOT/'scripts/cleanup-v27-wall/restore_wall.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        repair=module.restore_all_selections(reader)
    for olditem in BASE['masks']:
        name=olditem['id']
        lo,hi=[np.array(x) for x in MASK_BOUNDS[name]];mask=load_prior(olditem,lo,hi);prior_count=int(mask.sum());policies=[];restorations=[]
        for op in [o for o in OPERATIONS if o['mask']==name]:
            a,b,addition,policy=build_operation(reader,op);assert np.all(a>=lo) and np.all(b<=hi),(name,a,b)
            if repair:
                ra,rb,restore,_=repair;aa=np.maximum(a,ra);bb=np.minimum(b,rb)
                overlap=0 if np.any(bb<=aa) else int(np.count_nonzero(addition[bbox_slice(aa,bb,a)]&restore[bbox_slice(aa,bb,ra)]))
                assert overlap==0,(op['id'],'new exclusion crosses source-supported wall repair')
                policy['newExclusionsIntersectingRestorationFootprintSamples']=overlap
            target=mask[bbox_slice(a,b,lo)];policy['uniqueNewExclusionSamples']=int(np.count_nonzero(addition&~target));target|=addition;policies.append(policy)
            del addition;gc.collect()
        added_count=int(mask.sum())-prior_count;restored_count=0
        if repair:
            a,b,restore,r=repair;aa=np.maximum(a,lo);bb=np.minimum(b,hi)
            if np.all(bb>aa):
                restore_local=restore[bbox_slice(aa,bb,a)];target=mask[bbox_slice(aa,bb,lo)];restored_count=int(np.count_nonzero(target&restore_local));target[restore_local]=False
                assert not (target&restore_local).any();restorations.append(dict(**r,appliedMaskId=name,clearedBits=restored_count))
        items.append(save(olditem,lo,hi,mask,policies,restorations,prior_count,added_count,restored_count));del mask;gc.collect()
    if len(items)==4:
        assert sum(i['decodedBytes'] for i in items)<128*1024**2
        manifest={**BASE,'id':'ladaf-reviewed-lumen-display-v27','title':'Reviewed lumen cleanup','description':'Targeted source-supported wall restoration and explicitly selected nodule/sheets plus guarded perivalvular fragments. Reversible 3D display edits; tissue identity is not classified.','masks':items,
          'predecessorManifestSha256':digest(BASE_PATH.read_bytes()),'originalDebrisManifestUrl':'./assets/cleanup-v26/debris-manifest.json',
          'limitations':['Material identity and anatomical completeness are not validated.','Explicit user-selected bright objects can be hidden; their source-defined attachment collars and surrounding dense anatomy remain protected.','Connected ambiguous structures and very near-wall roughness can remain.','Original CT cards, scalar arrays and mesh payloads are unchanged.']}
        provenance_files=['scripts/cleanup-v27/build_masks.py','scripts/cleanup-v27/reviewed_selections.py','scripts/fine-detail-v23/source.py']
        if repair:provenance_files.append('scripts/cleanup-v27-wall/restore_wall.py')
        manifest['buildProvenance']={'completeFourMaskRebuild':True,'inputSha256':{name:digest((ROOT/name).read_bytes()) for name in provenance_files}}
        p=PUBLIC/'lumen-manifest.json';p.write_text(json.dumps(manifest,indent=2)+'\n')
        (DOCS/'lumen-build.json').write_text(json.dumps(dict(source=reader.receipt(),manifestSha256=digest(p.read_bytes()),predecessorManifestSha256=digest(BASE_PATH.read_bytes()),wallRepairApplied=bool(repair),totalDecodedBytes=sum(i['decodedBytes'] for i in items),totalCompressedBytes=sum(i['compressedBytes'] for i in items),sourceMeshAndFlagsUnchanged=True,losslessPacking=True,items=items),indent=2)+'\n')
if __name__=='__main__':main()
