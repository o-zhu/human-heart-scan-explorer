#!/usr/bin/env python3
"""Clear a bounded, source-supported prior exclusion at the reported LA wall.

No geometry is generated or moved. This restores original mesh visibility where
the frozen v25/v26 mask clips the tip of a 3D-continuous source wall component.
The review selection deliberately stops before the later intraluminal material.
"""
from pathlib import Path
import gzip
import hashlib
import json
import sys
import numpy as np
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource

SELECTION_LO = np.array([1220,928,950])
SELECTION_HI = np.array([1315,949,1045])
SEED = np.array([1268,938,995])
HALO = 9
PADDING = 12

def digest(value):
    return hashlib.sha256(value).hexdigest()

def frozen_atrial_mask():
    manifest_path = ROOT/'public/assets/cleanup-v26/lumen-manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    item = next(m for m in manifest['masks'] if m['id']=='atrial')
    encoded = (ROOT/'public'/item['url'].removeprefix('./')).read_bytes()
    assert digest(encoded)==item['sha256']
    packed = gzip.decompress(encoded)
    assert digest(packed)==item['decodedSha256']
    packed = np.frombuffer(packed,np.uint8).reshape(item['storageDimensionsXYZ'][::-1])
    prior = np.unpackbits(packed,axis=2,bitorder='little')[:,:,:item['dimensionsXYZ'][0]].astype(bool)
    return prior,item,manifest_bytes

def restore_selection(reader=None):
    reader = reader or FineSource(cache_bricks=16)
    prior,item,manifest_bytes=frozen_atrial_mask()
    source_lo = SELECTION_LO-PADDING
    source_hi = SELECTION_HI+PADDING
    raw = reader.region(source_lo,source_hi)
    field = ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)
    core = tuple(slice(PADDING,int(n+PADDING)) for n in (SELECTION_HI-SELECTION_LO)[::-1])
    foreground = field[core]>=71.4
    labels, _ = ndi.label(foreground,structure=np.ones((3,3,3),bool))
    seed_local = SEED-SELECTION_LO
    label = int(labels[tuple(seed_local[::-1])])
    assert label!=0
    wall = labels==label
    # The selected source component ends before the review box's forward edge.
    # A future edit that joins the component to later material must be reviewed.
    assert not wall[:,-3:,:].any()
    mask_origin = np.array(item['lowerFullFineXYZ'])
    core_slice = tuple(slice(int(a),int(b)) for a,b in zip((SELECTION_LO-mask_origin)[::-1],(SELECTION_HI-mask_origin)[::-1]))
    lost = wall & prior[core_slice]
    assert lost.any()
    lost_coords = np.argwhere(lost)
    lost_lo = lost_coords.min(axis=0)[::-1]+SELECTION_LO
    lost_hi = lost_coords.max(axis=0)[::-1]+SELECTION_LO+1
    # Exactly the same conservative spatial allowance used by v26 for the
    # retained vertex-cluster surface. Here it restores measured-wall visibility.
    out_lo = lost_lo-HALO
    out_hi = lost_hi+HALO
    shape = tuple((out_hi-out_lo)[::-1])
    seed_volume = np.zeros(shape,bool)
    seed_global = lost_coords[:,::-1]+SELECTION_LO
    local = seed_global-out_lo
    seed_volume[tuple(local[:,::-1].T)] = True
    support = ndi.distance_transform_edt(~seed_volume)<=HALO
    old_slice = tuple(slice(int(a),int(b)) for a,b in zip((out_lo-mask_origin)[::-1],(out_hi-mask_origin)[::-1]))
    restore = support & prior[old_slice]
    records=[]
    for y in range(int(SELECTION_LO[1]),int(SELECTION_HI[1])):
        j=y-int(SELECTION_LO[1])
        if wall[:,j,:].any() or lost[:,j,:].any():
            records.append(dict(fullFineY=y,connectedForegroundSamples=int(wall[:,j,:].sum()),previouslyExcludedSamples=int(lost[:,j,:].sum())))
    report = dict(
        sourceManifestSha256=reader.manifest_sha256,
        priorMaskManifestSha256=digest(manifest_bytes),priorMaskId='atrial',
        priorDecodedMaskSha256=item['decodedSha256'],
        sourceSelectionLowerXYZ=SELECTION_LO.tolist(),sourceSelectionUpperExclusiveXYZ=SELECTION_HI.tolist(),
        sourceSeedXYZ=SEED.tolist(),sourceConnectedForegroundSamples=int(wall.sum()),
        sourceForegroundFilterSigmaFineSamples=.5,sourceForegroundThreshold=71.4,
        lostSourceSupportSamples=int(lost.sum()),lostSupportLowerXYZ=lost_lo.tolist(),lostSupportUpperExclusiveXYZ=lost_hi.tolist(),
        restoreLowerXYZ=out_lo.tolist(),restoreUpperExclusiveXYZ=out_hi.tolist(),
        restoreSamples=int(restore.sum()),meshSupportHaloFineSamples=HALO,
        restoreMaskSha256=digest(restore.tobytes()),serialSupport=records,
        mechanism='Subtract prior exclusion bits within nine fine samples of previously excluded source foreground connected in 3D to the reviewed wall seed. The source component tapers out before Y946, with no foreground in Y946–948 inside the bounded selection.',
        unchanged='Original scalar samples, original HFM positions/normals/indices, display thresholds and measured CT cards.',
        limit='A source-supported restoration of original visibility, not synthetic mesh filling or anatomical validation. The original gentle mesh remains decimated and locally irregular.',
        source=reader.receipt(),
    )
    return out_lo,out_hi,restore,report

def restore_irregular_selection(reader=None):
    """Restore the separate larger wall patch while protecting the lumen object.

    The component separation is explicitly local to the reviewed source window;
    neither the source object nor the whole mesh is claimed to be detached.
    """
    reader=reader or FineSource(cache_bricks=16)
    prior,item,manifest_bytes=frozen_atrial_mask()
    selection_lo=np.array([1060,930,900]);selection_hi=np.array([1220,1080,1100])
    review_lo=np.array([1085,975,930]);review_hi=np.array([1180,1060,1080])
    wall_seed=np.array([1125,990,990]);clump_seed=np.array([1180,1020,1025])
    raw=reader.region(selection_lo-PADDING,selection_hi+PADDING)
    field=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)[PADDING:-PADDING,PADDING:-PADDING,PADDING:-PADDING]
    labels,_=ndi.label(field>=71.4,structure=np.ones((3,3,3),bool))
    wall_id=int(labels[tuple((wall_seed-selection_lo)[::-1])])
    clump_id=int(labels[tuple((clump_seed-selection_lo)[::-1])])
    assert wall_id and clump_id and wall_id!=clump_id
    wall=labels==wall_id;clump=labels==clump_id
    origin=np.array(item['lowerFullFineXYZ'])
    source_prior=np.zeros(wall.shape,bool)
    a=np.maximum(selection_lo,origin);b=np.minimum(selection_hi,origin+item['dimensionsXYZ'])
    src=tuple(slice(int(x),int(y)) for x,y in zip((a-origin)[::-1],(b-origin)[::-1]))
    dst=tuple(slice(int(x),int(y)) for x,y in zip((a-selection_lo)[::-1],(b-selection_lo)[::-1]))
    source_prior[dst]=prior[src]
    review=np.zeros(wall.shape,bool)
    bounds=tuple(slice(int(x),int(y)) for x,y in zip((review_lo-selection_lo)[::-1],(review_hi-selection_lo)[::-1]))
    review[bounds]=True
    lost=wall&source_prior&review
    lost_points=np.argwhere(lost)
    assert len(lost_points)>0
    lost_lo=lost_points.min(0)[::-1]+selection_lo
    lost_hi=lost_points.max(0)[::-1]+selection_lo+1
    out_lo=lost_lo-HALO;out_hi=lost_hi+HALO
    assert np.all(out_lo>=selection_lo) and np.all(out_hi<=selection_hi)
    output=tuple(slice(int(x),int(y)) for x,y in zip((out_lo-selection_lo)[::-1],(out_hi-selection_lo)[::-1]))
    halo=ndi.distance_transform_edt(~lost)<=HALO
    clump_distance=ndi.distance_transform_edt(~clump)
    restore=(halo&source_prior&(clump_distance>HALO))[output].copy()
    assert not np.any(restore&clump[output])
    report=dict(
        sourceManifestSha256=reader.manifest_sha256,priorMaskManifestSha256=digest(manifest_bytes),
        priorMaskId='atrial',priorDecodedMaskSha256=item['decodedSha256'],
        sourceSelectionLowerXYZ=selection_lo.tolist(),sourceSelectionUpperExclusiveXYZ=selection_hi.tolist(),
        sourceReviewLowerXYZ=review_lo.tolist(),sourceReviewUpperExclusiveXYZ=review_hi.tolist(),
        sourceSeedXYZ=wall_seed.tolist(),protectedClumpSeedXYZ=clump_seed.tolist(),
        sourceConnectedForegroundSamples=int(wall.sum()),protectedClumpForegroundSamples=int(clump.sum()),
        sourceForegroundFilterSigmaFineSamples=.5,sourceForegroundThreshold=71.4,
        lostSourceSupportSamples=int(lost.sum()),lostSupportLowerXYZ=lost_lo.tolist(),lostSupportUpperExclusiveXYZ=lost_hi.tolist(),
        restoreLowerXYZ=out_lo.tolist(),restoreUpperExclusiveXYZ=out_hi.tolist(),restoreSamples=int(restore.sum()),
        meshSupportHaloFineSamples=HALO,protectedClumpHaloFineSamples=HALO,
        protectedClumpSourceOverlap=int(np.count_nonzero(restore&clump[output])),
        protectedClumpHaloOverlap=int(np.count_nonzero(restore&(clump_distance[output]<=HALO))),
        unrecoveredWallSupportAtClumpGuard=int(np.count_nonzero(lost&(clump_distance<=HALO))),
        restoreMaskSha256=digest(restore.tobytes()),
        mechanism='Within the reviewed source window, identify the distinct wall and retained-cleanup lumen-object foreground components from explicit seeds. Restore only the prior-masked wall support plus its nine-sample mesh halo, while retaining all exclusion bits within nine samples of the lumen-object component.',
        unchanged='Original scalar samples, original HFM positions/normals/indices, display thresholds and measured CT cards.',
        limit='The component separation is local to the reviewed bounded window. This does not establish that the lumen object is globally disconnected or that it is a clot/artifact. Guard-adjacent wall samples are deliberately left excluded.',
        source=reader.receipt(),
    )
    return out_lo,out_hi,restore,report

def restore_all_selections(reader=None):
    reader=reader or FineSource(cache_bricks=16)
    patches=[('oval-wall',restore_selection(reader)),('irregular-wall',restore_irregular_selection(reader))]
    lo=np.min([p[1][0] for p in patches],axis=0);hi=np.max([p[1][1] for p in patches],axis=0)
    union=np.zeros(tuple((hi-lo)[::-1]),bool);records=[]
    for name,(a,b,mask,report) in patches:
        slices=tuple(slice(int(x),int(y)) for x,y in zip((a-lo)[::-1],(b-lo)[::-1]))
        union[slices]|=mask
        records.append(dict(patch=name,**report))
    report=dict(
        sourceManifestSha256=reader.manifest_sha256,
        priorMaskManifestSha256=records[0]['priorMaskManifestSha256'],
        restoreLowerXYZ=lo.tolist(),restoreUpperExclusiveXYZ=hi.tolist(),
        restoreSamples=int(union.sum()),restoreMaskSha256=digest(union.tobytes()),
        patches=records,
        scope='Only prior atrial exclusion bits inside the declared source-supported patch footprints may be cleared. No source image, source mesh vertex, source normal, source triangle or CT card is modified.',
        source=reader.receipt(),
    )
    assert int(union.sum())==sum(p['restoreSamples'] for p in records)
    return lo,hi,union,report

if __name__=='__main__':
    lo,hi,restore,report=restore_all_selections() if '--all' in sys.argv else restore_selection()
    data=Path('/workspace/data/cleanup-v27-wall');data.mkdir(parents=True,exist_ok=True)
    docs=ROOT/'docs/cleanup-v27-wall';docs.mkdir(parents=True,exist_ok=True)
    name='restoration-all-selections' if '--all' in sys.argv else 'restoration-selection'
    np.savez_compressed(data/(name+'.npz'),lowerXYZ=lo,upperXYZ=hi,restore=restore)
    (docs/(name+'.json')).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['restoreSamples','restoreLowerXYZ','restoreUpperExclusiveXYZ','restoreMaskSha256']}))
