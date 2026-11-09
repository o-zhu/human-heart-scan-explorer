#!/usr/bin/env python3
"""Correct inconsistent intermediate contours of an already selected PV sheet.

The v28 selection inherited older Y1212/Y1220 anchors between newly traced
neighbors. Those anchors falsely protect pieces of the selected object in 3D.
Only the new difference is added to the frozen atrial bitmask. This does not
reinterpret source-supported atrial/vein wall as debris.
"""
from copy import deepcopy
from pathlib import Path
import gzip, hashlib, importlib.util, json, sys
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource

def module(name,path):
    s=importlib.util.spec_from_file_location(name,path)
    m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

legacy=module('reviewed_left_v28',ROOT/'scripts/cleanup-v28-left/build.py')
masks=module('mask_io_v28',ROOT/'scripts/cleanup-v28/build_masks.py')
digest=lambda b:hashlib.sha256(b).hexdigest()

def main():
    docs=ROOT/'docs/cleanup-v29-left/atrial';docs.mkdir(parents=True,exist_ok=True)
    public=ROOT/'public/assets/cleanup-v29-left';public.mkdir(parents=True,exist_ok=True)
    base_path=ROOT/'public/assets/cleanup-v28/lumen-manifest.json'
    manifest=json.loads(base_path.read_text())
    reader=FineSource(cache_bricks=16);repair=legacy.restoration_footprint(reader)
    op=deepcopy(legacy.OPERATIONS[0])
    op.update(id='pulmonary-vein-residual-contour-correction',
      scope='Correct two stale intermediate anchors within the already reviewed free PV sheet, plus one source-traced edge at Y1256. Preserve source-supported atrial/PV wall around Y1120–1184.',
      evidence='docs/cleanup-v29-left/la-depth/pv-residual-late.jpg; docs/cleanup-v29-left/locate/la-y316-v28.jpg; Float32 production fine-coordinate readback')
    for y in (1212,1220):op['polygons'].pop(y)
    op['polygons'][1256]=[[1279,684],[1294,687],[1318,700],[1342,716],[1361,735],[1378,755],[1391,777],[1387,790],[1370,802],[1350,802],[1347,793],[1372,783],[1371,774],[1355,754],[1335,735],[1310,716],[1287,700]]
    lo,hi,selection,policy=legacy.build_operation(reader,op,repair)
    bound_lo=np.array([1203,1204,671]);bound_hi=np.array([1410,1264,838])
    bounded=np.zeros_like(selection)
    a=np.maximum(lo,bound_lo);b=np.minimum(hi,bound_hi)
    sl=masks.region(a,b,lo);bounded[sl]=selection[sl]
    selection=bounded
    policy.update(logicalSelectionSha256=digest(selection.tobytes()),
      deliveredSelectionSamples=int(selection.sum()),
      strictChangeLowerFullFineXYZ=bound_lo.tolist(),strictChangeUpperFullFineXYZ=bound_hi.tolist(),
      contourFix={'removedStaleInheritedAnchorsY':[1212,1220],'newSourceTracedAnchorY':1256},
      note='Selection counts from the reused builder precede the strict delivery bounds; deliveredSelectionSamples is the bounded selection. Only the difference against the frozen v28 mask is added.')
    policy_path=docs/(op['id']+'-policy.json')
    old=next(x for x in manifest['masks'] if x['id']=='atrial')
    old_lo=np.array(old['lowerFullFineXYZ']);old_hi=np.array(old['upperFullFineXYZ'])
    assert np.all(lo>=old_lo) and np.all(hi<=old_hi)
    bits=masks.read_mask(old);prior=int(bits.sum())
    target=bits[masks.region(lo,hi,old_lo)]
    difference=selection&~target
    unique=int(difference.sum());assert unique>0
    policy['uniqueNewExclusionSamples']=unique
    policy['logicalDifferenceSha256']=digest(difference.tobytes())
    np.savez_compressed(docs/(op['id']+'-selection.npz'),lowerXYZ=lo,upperXYZ=hi,mask=difference)
    target|=difference
    ra,rb,restored,_=repair
    aa=np.maximum(ra,old_lo);bb=np.minimum(rb,old_hi)
    assert not np.any(bits[masks.region(aa,bb,old_lo)]&restored[masks.region(aa,bb,ra)])
    policy_path.write_text(json.dumps(policy,indent=2)+'\n')
    packed=np.packbits(bits,axis=2,bitorder='little');raw=packed.tobytes();encoded=gzip.compress(raw,9,mtime=0)
    (public/'atrial.bits.gz').write_bytes(encoded)
    count=int(bits.sum())
    item={**old,'url':'./assets/cleanup-v29-left/atrial.bits.gz',
      'compressedBytes':len(encoded),'decodedBytes':len(raw),'sha256':digest(encoded),'decodedSha256':digest(raw),
      'logicalMaskSha256':digest(bits.tobytes()),'maskedVoxels':count,'maskedVolumeMm3':count*.0794**3,
      'policy':{'predecessorMaskSha256':old['sha256'],'inheritedV28MaskedSamples':prior,
        'addedDisplayExclusionSamples':unique,'restoredWallFootprintOverlapSamples':0,
        'restoredWallFootprintSha256':repair[3]['restoreMaskSha256'],
        'operations':[{'id':op['id'],'policy':str(policy_path.relative_to(ROOT)),
          'policySha256':digest(policy_path.read_bytes()),'uniqueNewExclusionSamples':unique,
          'protectedDenseOutsideObjectOverlapSamples':policy['protectedDenseOutsideObjectOverlapSamples'],
          'restoredWallFootprintOverlapSamples':0}],
        'materialIdentity':'Unverified; reversible user-requested display selection.'}}
    manifest['masks']=[item if x['id']=='atrial' else x for x in manifest['masks']]
    manifest.update(id='ladaf-reviewed-lumen-display-v29-left-candidate',predecessorManifestSha256=digest(base_path.read_bytes()),
      buildProvenance={'scope':'Single atrial-mask difference; three other v28 masks reused byte-for-byte.',
        'inputSha256':{str(p.relative_to(ROOT)):digest(p.read_bytes()) for p in [Path(__file__),ROOT/'scripts/cleanup-v28-left/build.py',ROOT/'scripts/cleanup-v28-left/selections.py',policy_path]},
        'sourceManifestSha256':reader.receipt()['sourceManifestSha256']})
    output=public/'lumen-manifest.json';output.write_text(json.dumps(manifest,indent=2)+'\n')
    receipt={'source':reader.receipt(),'manifestSha256':digest(output.read_bytes()),
      'uniqueNewExclusionSamples':unique,'unchangedOtherMaskSha256':{x['id']:x['sha256'] for x in manifest['masks'] if x['id']!='atrial'},
      'restoredWallSamples':int(restored.sum()),'restoredWallFootprintSha256':repair[3]['restoreMaskSha256'],
      'restoredWallOverlapSamples':0,'boundLowerXYZ':bound_lo.tolist(),'boundUpperXYZ':bound_hi.tolist(),
      'selectionLogicalSha256':digest(difference.tobytes())}
    (docs/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))

if __name__=='__main__':main()
