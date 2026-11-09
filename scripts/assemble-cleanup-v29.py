#!/usr/bin/env python3
"""Assemble verified v29 display assets without activating or publishing them.

The source geometry/scalars, historical manifests and reusable v28 objects are
immutable inputs. New runtime files have canonical v29 URLs; matched local
surfaces and their low-band masks are copied only after hash verification.
"""
from copy import deepcopy
from pathlib import Path
import argparse, gzip, hashlib, importlib.util, json, sys
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/'public/assets/cleanup-v29'
DOCS=ROOT/'docs/cleanup-v29'
FINE='e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c'
GENTLE='175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae'
WALL='ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea'
LIMIT=8*1024*1024; GPU_LIMIT=128*1024*1024; MASK_LIMIT=16*1024*1024
digest=lambda b:hashlib.sha256(b).hexdigest()
encode=lambda x:(json.dumps(x,indent=2)+'\n').encode()
POP=np.array([int(i).bit_count() for i in range(256)],np.uint8)

def read_json(path):return json.loads(path.read_text())

def public_path(url):
    assert url.startswith('./assets/') and '..' not in url.split('/')
    return ROOT/'public'/url[2:]

def checked(path,item):
    encoded=path.read_bytes();assert len(encoded)==item['compressedBytes'],path
    assert digest(encoded)==item['sha256'],path
    raw=gzip.decompress(encoded);assert len(raw)==item['decodedBytes'],path
    assert digest(raw)==item['decodedSha256'],path
    return encoded,raw

def check_mask(raw,item):
    dims=item['dimensionsXYZ'];stored=item['storageDimensionsXYZ']
    assert item['format']=='gzip-bitset-x-zyx'
    assert stored==[(dims[0]+7)//8,dims[1],dims[2]]
    a=np.frombuffer(raw,np.uint8).reshape(stored[::-1])
    remain=dims[0]&7
    if remain:assert not np.any(a[:,:,-1]&(~((1<<remain)-1)&255))
    count=int(POP[a].sum(dtype=np.uint64))
    assert count==item['maskedVoxels']
    return count

def check_mesh(raw,item):
    h=np.frombuffer(raw,'<u4',8);assert item['format']=='HFM1-gzip'
    assert list(h[:2])==[0x314d4648,1] and int(h[7])==0
    n=int(h[2]);count=int(h[3]);assert n==item['vertices'] and count==item['triangles']*3
    po,no,io=map(int,h[4:7]);assert po==32 and no%4==io%4==0
    assert po+n*6<=no and no+n*6<=io and io+count*4==len(raw)
    idx=np.frombuffer(raw,'<u4',count,io);assert int(idx.max())<n
    normals=np.frombuffer(raw,'<i2',n*3,no).reshape(-1,3).astype(np.float32)
    length=np.linalg.norm(normals,axis=1);assert np.all((length>=32000)&(length<=33500))

def part(lo,hi,origin):return tuple(slice(int(a),int(b)) for a,b in zip((lo-origin)[::-1],(hi-origin)[::-1]))

def wall_overlap(item,raw,wa,wb,wall):
    lo=np.array(item['lowerFullFineXYZ']);hi=np.array(item['upperFullFineXYZ'])
    a=np.maximum(lo,wa);b=np.minimum(hi,wb)
    if np.any(b<=a):return 0
    packed=np.frombuffer(raw,np.uint8).reshape(item['storageDimensionsXYZ'][::-1])
    subset=packed[a[2]-lo[2]:b[2]-lo[2],a[1]-lo[1]:b[1]-lo[1],:]
    mask=np.unpackbits(subset,axis=2,count=item['dimensionsXYZ'][0],bitorder='little')[:,:,a[0]-lo[0]:b[0]-lo[0]]
    return int(np.count_nonzero(mask&wall[part(a,b,wa)]))

def canonicalize(entry,source_dir=None):
    entry=deepcopy(entry);files={}
    for key in ('surface','lowBandMask'):
        meta=entry[key]
        source=source_dir/meta['file'] if source_dir else public_path(meta['url'])
        data,raw=checked(source,meta);assert len(data)<LIMIT
        if key=='surface':check_mesh(raw,meta)
        else:check_mask(raw,meta)
        name=source.name;meta.pop('file',None);meta['url']='./assets/cleanup-v29/'+name
        files[name]=data
    return entry,files

def main():
    p=argparse.ArgumentParser();p.add_argument('--verify-only',action='store_true');args=p.parse_args()
    previous_surface_path=ROOT/'public/assets/cleanup-v28/surface-manifest.json'
    previous_lumen_path=ROOT/'public/assets/cleanup-v28/lumen-manifest.json'
    previous_surface=read_json(previous_surface_path);previous_lumen=read_json(previous_lumen_path)
    fine_path=ROOT/'public/assets/ultra-volume-v7.json';assert digest(fine_path.read_bytes())==FINE
    assert previous_surface['sourceMeshDecodedSha256']==GENTLE
    left_policy_path=ROOT/'docs/cleanup-v29-left/patch/lvot-perivalvular-refinement-policy.json'
    left=read_json(left_policy_path)
    entry={key:deepcopy(left[key]) for key in ('id','lowerFullFineXYZ','upperFullFineXYZ','surface','lowBandMask')}
    entry.update(reviewPolicy={'path':str(left_policy_path.relative_to(ROOT)),'sha256':digest(left_policy_path.read_bytes())},
      sourceSigmaFineSamples=left['sourceSigmaFineSamples'],baselineDisplayIntensity=left['baselineThreshold'],
      maximumReviewedDisplayIntensity=left['counts']['maximumLocalThreshold'],sourceCalibratedHU=False)
    lvot,files=canonicalize(entry,left_policy_path.parent)
    right_path=ROOT/'public/assets/cleanup-v29-right/manifest-entries.json';right=read_json(right_path)
    assert right['sourceHfmDecodedSha256']==GENTLE and right['replaceId']=='pulmonary-valve-lumen-surface'
    pulmonary,pfiles=canonicalize(right['replacement']);exterior,efiles=canonicalize(right['append'])
    files.update(pfiles);files.update(efiles)
    tricuspid=deepcopy(next(x for x in previous_surface['patches'] if x['id']=='tricuspid-core-surface'))
    patches=[lvot,tricuspid,pulmonary,exterior]
    assert len({x['id'] for x in patches})==4
    for i,a in enumerate(patches):
        for b in patches[i+1:]:
            assert any(a['upperFullFineXYZ'][k]<=b['lowerFullFineXYZ'][k] or b['upperFullFineXYZ'][k]<=a['lowerFullFineXYZ'][k] for k in range(3)),(a['id'],b['id'],'overlap')
    budget=dict(patches=4,surfaceDecodedBytes=sum(x['surface']['decodedBytes'] for x in patches),
      maskDecodedBytes=sum(x['lowBandMask']['decodedBytes'] for x in patches),
      compressedBytes=sum(x[k]['compressedBytes'] for x in patches for k in ('surface','lowBandMask')),
      triangles=sum(x['surface']['triangles'] for x in patches),vertices=sum(x['surface']['vertices'] for x in patches))
    budget['combinedDecodedBytes']=budget['surfaceDecodedBytes']+budget['maskDecodedBytes']
    assert budget['combinedDecodedBytes']<=GPU_LIMIT and budget['maskDecodedBytes']<=MASK_LIMIT
    surface={**previous_surface,'id':'ladaf-reviewed-source-surfaces-v29','patches':patches,
      'predecessorManifestSha256':digest(previous_surface_path.read_bytes()),
      'processing':'Bounded, source-guided LVOT and PA refinement and an exterior perivascular region, retaining the exact v28 tricuspid patch. Independently collared local fields retain the original source isovalue at crop boundaries.',
      'sourceGeometryIdentity':'Original position/index geometry, either original transport or verified compact transport with geometrySourceSha256 matching sourceMeshDecodedSha256.',
      'replaces':{'lvot-perivalvular-refinement':'lvot-perivalvular-refinement','pulmonary-valve-lumen-surface':'pulmonary-lumen-v29'},
      'sourceCalibratedHU':False,'budget':budget}
    left_lumen_path=ROOT/'public/assets/cleanup-v29-left/lumen-manifest.json';lumen=deepcopy(read_json(left_lumen_path))
    assert lumen['sourceManifestSha256']==FINE
    atrial=next(x for x in lumen['masks'] if x['id']=='atrial')
    atrial_data,atrial_raw=checked(public_path(atrial['url']),atrial);check_mask(atrial_raw,atrial)
    assert len(atrial_data)<LIMIT;files['atrial.bits.gz']=atrial_data;atrial['url']='./assets/cleanup-v29/atrial.bits.gz'
    for item in lumen['masks']:
        if item['id']!='atrial':assert item==next(x for x in previous_lumen['masks'] if x['id']==item['id'])
    lumen.update(id='ladaf-reviewed-lumen-display-v29',predecessorManifestSha256=digest(previous_lumen_path.read_bytes()),
      surfaceRefinementManifestUrl='./assets/cleanup-v29/surface-manifest.json',
      description='Reviewed atrial/PV material with exact restored-wall protection, plus four matching local source-boundary surfaces. Original source data remains available.',
      buildProvenance={'scope':'Canonical v29 assembly of verified selected assets; three lumen masks and the tricuspid patch reuse exact v28 URLs.',
        'assembler':'scripts/assemble-cleanup-v29.py','selectedAtrialManifestSha256':digest(left_lumen_path.read_bytes()),
        'selectedRightEntriesSha256':digest(right_path.read_bytes())})
    # Independently reconstruct the frozen repair mask and compare actual packed
    # payloads. Bounding-box disjointness alone is insufficient for the LVOT box.
    sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'));from source import FineSource
    spec=importlib.util.spec_from_file_location('frozen_v27_wall',ROOT/'scripts/cleanup-v27-wall/restore_wall.py')
    wall_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(wall_module)
    reader=FineSource(cache_bricks=8);wa,wb,wall,wall_report=wall_module.restore_all_selections(reader)
    assert wall_report['restoreMaskSha256']==WALL and int(wall.sum())==109928
    patch_checks=[]
    for patch in patches:
        review=patch['reviewPolicy'];path=ROOT/review['path'];assert digest(path.read_bytes())==review['sha256']
        policy=read_json(path);assert policy['originalSourceModified'] is False and policy['sourceCalibratedHU'] is False
        assert policy['source']['sourceManifestSha256']==FINE
        counts=policy['counts'];core_key='lostProtected135Samples' if 'lostProtected135Samples' in counts else 'lostProtected155Samples'
        assert counts[core_key]==counts['lostRaw190Samples']==counts['boxBoundaryNonBaselineSamples']==0
        mask=patch['lowBandMask'];name=Path(mask['url']).name
        encoded=files.get(name)
        if encoded is None:encoded,_=checked(public_path(mask['url']),mask)
        raw=gzip.decompress(encoded);check_mask(raw,mask)
        assert digest(raw)==mask['decodedSha256'];overlap=wall_overlap(mask,raw,wa,wb,wall);assert overlap==0
        patch_checks.append({'id':patch['id'],'sourcePolicySha256':review['sha256'],
          'sourceCoreLossField':core_key,'sourceCoreLostSamples':counts[core_key],'raw190LostSamples':counts['lostRaw190Samples'],
          'restoredWallOverlapSamples':overlap,'boxBoundaryNonBaselineSamples':0,
          'sourceCoreCheckStage':'Before inherited compact-component display filtering and mesh reduction.'})
    lumen_checks=[]
    for item in lumen['masks']:
        raw=atrial_raw if item['id']=='atrial' else checked(public_path(item['url']),item)[1]
        check_mask(raw,item);overlap=wall_overlap(item,raw,wa,wb,wall);assert overlap==0
        lumen_checks.append({'id':item['id'],'sha256':item['sha256'],'decodedSha256':item['decodedSha256'],'restoredWallOverlapSamples':overlap})
    # Prior atrial exclusions are a subset of the new mask; no undocumented
    # restoration or removal may enter the canonical merge.
    old_atrial=next(x for x in previous_lumen['masks'] if x['id']=='atrial')
    old_raw=checked(public_path(old_atrial['url']),old_atrial)[1]
    assert old_atrial['dimensionsXYZ']==atrial['dimensionsXYZ'] and old_atrial['lowerFullFineXYZ']==atrial['lowerFullFineXYZ']
    aa=np.frombuffer(old_raw,np.uint8);bb=np.frombuffer(atrial_raw,np.uint8)
    assert not np.any(aa&~bb)
    added=int(POP[bb&~aa].sum(dtype=np.uint64));assert added==16979
    # The prior LVOT scalar field/low band is preserved exactly inside its box.
    prior_lvot=previous_surface['patches'][0];assert prior_lvot['id']==lvot['id']
    old_mask=prior_lvot['lowBandMask'];old_mask_raw=checked(public_path(old_mask['url']),old_mask)[1]
    old_bits=np.unpackbits(np.frombuffer(old_mask_raw,np.uint8).reshape(old_mask['storageDimensionsXYZ'][::-1]),axis=2,count=old_mask['dimensionsXYZ'][0],bitorder='little')
    new_mask=lvot['lowBandMask'];new_raw=gzip.decompress(files[Path(new_mask['url']).name])
    new_bits=np.unpackbits(np.frombuffer(new_raw,np.uint8).reshape(new_mask['storageDimensionsXYZ'][::-1]),axis=2,count=new_mask['dimensionsXYZ'][0],bitorder='little')
    assert np.array_equal(old_bits,new_bits[part(np.array(prior_lvot['lowerFullFineXYZ']),np.array(prior_lvot['upperFullFineXYZ']),np.array(lvot['lowerFullFineXYZ']))])
    files['surface-manifest.json']=encode(surface);files['lumen-manifest.json']=encode(lumen)
    inputs=[Path(__file__),previous_surface_path,previous_lumen_path,left_policy_path,left_lumen_path,right_path,fine_path]
    receipt={'sourceManifestSha256':FINE,'sourceGeometrySha256':GENTLE,'source':reader.receipt(),
      'inputSha256':{str(p.relative_to(ROOT)):digest(p.read_bytes()) for p in inputs},
      'outputs':[{'path':'public/assets/cleanup-v29/'+name,'bytes':len(data),'sha256':digest(data)} for name,data in sorted(files.items())],
      'fourRegionsDisjoint':True,'budget':{**budget,'maximumCombinedDecodedBytes':GPU_LIMIT,'maximumMaskDecodedBytes':MASK_LIMIT},
      'eachNewGzipBelowBytes':LIMIT,'exactV28TricuspidReused':True,'exactOtherThreeV28LumenMasksReused':True,
      'atrialAdditionalSamples':added,'priorAtrialMaskSubsetExact':True,'priorLvotLowBandExactlyPreserved':True,
      'restoredWallSamples':109928,'restoredWallMaskSha256':WALL,'restoredWallOverlapSamples':0,
      'patchChecks':patch_checks,'lumenChecks':lumen_checks,'runtimeActivationChanged':False,'sourceCalibratedHU':False,
      'limitations':['Pre-component-filter source-core preservation does not establish anatomical identity or final clinical completeness.','Local display surfaces remain reversible and are not welded to the original decimated surface.','No browser performance claim follows from source or instrumented lifecycle checks.']}
    if args.verify_only:
        for name,data in files.items():assert (PUBLIC/name).read_bytes()==data,name
        assert (DOCS/'assembly.json').read_bytes()==encode(receipt)
    else:
        PUBLIC.mkdir(parents=True,exist_ok=True);DOCS.mkdir(parents=True,exist_ok=True)
        for name,data in files.items():(PUBLIC/name).write_bytes(data)
        (DOCS/'assembly.json').write_bytes(encode(receipt))
    print(json.dumps({'verifyOnly':args.verify_only,'newFiles':len(files),'newGzipBytes':sum(len(v) for k,v in files.items() if k.endswith('.gz')),'budget':budget,'allFourDisjoint':True,'restoredWallSamples':109928},indent=2))

if __name__=='__main__':main()
