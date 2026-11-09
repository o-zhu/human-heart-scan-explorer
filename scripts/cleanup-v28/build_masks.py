#!/usr/bin/env python3
"""Build the four v28 object masks from the frozen v27 display and traced sheets.

Adaptive surface low-band masks are separate assets: they must not clip their
own reconstructed surfaces. Original source scalars and source meshes stay exact.
"""
from pathlib import Path
import gc,gzip,hashlib,importlib.util,json,sys
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
PUBLIC=ROOT/'public/assets/cleanup-v28';DOCS=ROOT/'docs/cleanup-v28'
BASE_PATH=ROOT/'public/assets/cleanup-v27/lumen-manifest.json'
BASE=json.loads(BASE_PATH.read_text())
SOURCE='e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c'
RESTORE='ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea'
digest=lambda data:hashlib.sha256(data).hexdigest()
def region(lo,hi,origin):return tuple(slice(int(a),int(b)) for a,b in zip((lo-origin)[::-1],(hi-origin)[::-1]))
def read_mask(item):
    packed=(ROOT/'public'/item['url'].removeprefix('./')).read_bytes();assert digest(packed)==item['sha256']
    raw=gzip.decompress(packed);assert digest(raw)==item['decodedSha256']
    field=np.frombuffer(raw,np.uint8).reshape(item['storageDimensionsXYZ'][::-1])
    return np.unpackbits(field,axis=2,count=item['dimensionsXYZ'][0],bitorder='little').astype(bool)
def main():
    PUBLIC.mkdir(parents=True,exist_ok=True);DOCS.mkdir(parents=True,exist_ok=True)
    assert digest((ROOT/'public/assets/ultra-volume-v7.json').read_bytes())==SOURCE
    receipt=json.loads((ROOT/'docs/cleanup-v28-left/candidates/receipt.json').read_text())
    assert receipt['source']['sourceManifestSha256']==SOURCE and receipt['wallRestorationSha256']==RESTORE
    sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'));from source import FineSource
    spec=importlib.util.spec_from_file_location('frozen_wall_restore',ROOT/'scripts/cleanup-v27-wall/restore_wall.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    reader=FineSource(cache_bricks=16);ra,rb,restoration,repair=module.restore_all_selections(reader);assert repair['restoreMaskSha256']==RESTORE
    outputs=[]
    for old in BASE['masks']:
        old_lo=np.array(old['lowerFullFineXYZ']);old_hi=np.array(old['upperFullFineXYZ'])
        selections=[record for record in receipt['operations'] if record['maskId']==old['id']]
        lo=old_lo.copy();hi=old_hi.copy()
        for record in selections:
            file=ROOT/record['file'];assert digest(file.read_bytes())==record['sha256']
            with np.load(file) as data:
                lo=np.minimum(lo,data['lowerXYZ']);hi=np.maximum(hi,data['upperXYZ'])
        assert np.all(lo>=0) and np.all(hi<=[1897,1897,2117])
        previous=read_mask(old);prior=int(previous.sum());operations=[]
        if np.array_equal(lo,old_lo) and np.array_equal(hi,old_hi):bits=previous
        else:
            bits=np.zeros(tuple((hi-lo)[::-1]),bool);bits[region(old_lo,old_hi,lo)]=previous
        del previous
        for record in receipt['operations']:
            if record['maskId']!=old['id']:continue
            file=ROOT/record['file'];assert digest(file.read_bytes())==record['sha256']
            with np.load(file) as data:a=data['lowerXYZ'];b=data['upperXYZ'];add=data['mask']
            assert add.dtype==bool and list(add.shape)==list((b-a)[::-1]);assert digest(add.tobytes())==record['logicalSelectionSha256'];assert np.all(a>=lo) and np.all(b<=hi)
            aa=np.maximum(a,ra);bb=np.minimum(b,rb)
            overlap=0 if np.any(bb<=aa) else int(np.count_nonzero(add[region(aa,bb,a)]&restoration[region(aa,bb,ra)]))
            assert overlap==0,(record['operation'],'crosses a repaired wall')
            target=bits[region(a,b,lo)];unique=int(np.count_nonzero(add&~target));target|=add
            policy_path=file.with_name(record['operation']+'-policy.json');policy=json.loads(policy_path.read_text())
            operations.append(dict(id=record['operation'],policy=str(policy_path.relative_to(ROOT)),policySha256=digest(policy_path.read_bytes()),selectionSha256=record['logicalSelectionSha256'],selectedSamples=int(add.sum()),uniqueNewExclusionSamples=unique,protectedSourceOutsideObjectOverlapSamples=policy['protectedDenseOutsideObjectOverlapSamples'],restoredWallFootprintOverlapSamples=overlap))
            del add;gc.collect()
        aa=np.maximum(lo,ra);bb=np.minimum(hi,rb)
        if np.all(bb>aa):assert not np.any(bits[region(aa,bb,lo)]&restoration[region(aa,bb,ra)])
        packed=np.packbits(bits,axis=2,bitorder='little');dims=(hi-lo).tolist()
        for z in range(0,dims[2],32):
            check=np.unpackbits(packed[z:z+32],axis=2,bitorder='little');assert np.array_equal(check[:,:,:dims[0]],bits[z:z+32]);assert not check[:,:,dims[0]:].any()
        raw=memoryview(np.ascontiguousarray(packed));encoded=gzip.compress(raw,9,mtime=0);path=PUBLIC/(old['id']+'.bits.gz');path.write_bytes(encoded)
        nonzero=[np.flatnonzero(np.any(bits,axis=tuple(i for i in range(3) if i!=a))) for a in range(3)]
        minimum=np.array([q[0] for q in nonzero][::-1]);maximum=np.array([q[-1]+1 for q in nonzero][::-1]);count=int(bits.sum())
        item={**old,'url':'./assets/cleanup-v28/'+path.name,'dimensionsXYZ':dims,'storageDimensionsXYZ':list(packed.shape[::-1]),'lowerFullFineXYZ':lo.tolist(),'upperFullFineXYZ':hi.tolist(),'compressedBytes':len(encoded),'decodedBytes':packed.nbytes,'sha256':digest(encoded),'decodedSha256':digest(raw),'logicalMaskSha256':digest(memoryview(bits)),'maskedVoxels':count,'maskedVolumeMm3':count*.0794**3,'nonzeroBoundsFullFineXYZ':[(lo+minimum).tolist(),(lo+maximum).tolist()],
          'policy':dict(predecessorMaskSha256=old['sha256'],inheritedV27MaskedSamples=prior,addedDisplayExclusionSamples=count-prior,operations=operations,restoredWallFootprintSha256=RESTORE,restoredWallFootprintOverlapSamples=0,originalSourceAndGeometryUnchanged=True,materialIdentity='Unverified; reversible user-requested display selection.')}
        outputs.append(item);print(json.dumps(dict(mask=old['id'],added=count-prior,decoded=packed.nbytes)),flush=True);del bits,packed;gc.collect()
    assert len(outputs)==4 and sum(i['decodedBytes'] for i in outputs)<128*1024**2
    manifest={**BASE,'id':'ladaf-reviewed-lumen-display-v28','title':'Reviewed lumen cleanup','description':'Source-traced atrial and pulmonary-vein sheets with protected repaired wall footprints. Local intensity-boundary surfaces are loaded separately and switch with this cleanup.','masks':outputs,'predecessorManifestSha256':digest(BASE_PATH.read_bytes()),'surfaceRefinementManifestUrl':'./assets/cleanup-v28/surface-manifest.json',
      'buildProvenance':dict(completeFourMaskRebuild=True,inputSha256={p:digest((ROOT/p).read_bytes()) for p in ['scripts/cleanup-v28/build_masks.py','scripts/cleanup-v28-left/build.py','scripts/cleanup-v28-left/selections.py','docs/cleanup-v28-left/candidates/receipt.json','scripts/cleanup-v27-wall/restore_wall.py']}),
      'limitations':['Original scalar data, source CT section cards and original mesh payloads remain unchanged.','Selected material identity and anatomical completeness are not clinically validated.','Approximate intensity thresholds use windowed HiP-CT display values, not Hounsfield units.','Connected structures near the source-supported wall can remain.']}
    output=PUBLIC/'lumen-manifest.json';output.write_text(json.dumps(manifest,indent=2)+'\n')
    report=dict(manifestSha256=digest(output.read_bytes()),source=reader.receipt(),predecessorManifestSha256=digest(BASE_PATH.read_bytes()),repairedWallFootprintSha256=RESTORE,totalNewExclusionSamples=sum(i['policy']['addedDisplayExclusionSamples'] for i in outputs),totalDecodedBytes=sum(i['decodedBytes'] for i in outputs),totalCompressedBytes=sum(i['compressedBytes'] for i in outputs),items=outputs)
    (DOCS/'lumen-build.json').write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':main()
