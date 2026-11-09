#!/usr/bin/env python3
"""Add one independently collared source refinement to the existing LVOT patch.

The maximum of the two fields preserves the previous field exactly, including
its collars. The enlarged crop is extracted at baseline everywhere else.
"""
from pathlib import Path
import argparse,gzip,hashlib,importlib.util,json,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28-right'))
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
import adaptive_patch as A
from source import FineSource

original_fields=A.fields_for
original_threshold=A.threshold_plane
def fields_for(config):
    result={'regions':[(region,original_fields(region)) for region in config['regions']]}
    for region in config['regions']:
        for y in region['polygons']:result[int(y)]=True
    return result

def threshold_plane(config,fields,y):
    lo=np.array(config['lowerXYZ']);hi=np.array(config['upperXYZ'])
    out=np.full((hi[2]-lo[2],hi[0]-lo[0]),A.BASE,np.float32)
    for region,field in fields['regions']:
        a=np.array(region['lowerXYZ']);b=np.array(region['upperXYZ'])
        if not a[1]<=y<b[1]:continue
        p=original_threshold(region,field,y)
        sl=(slice(a[2]-lo[2],b[2]-lo[2]),slice(a[0]-lo[0],b[0]-lo[0]))
        out[sl]=np.maximum(out[sl],p)
    return out

def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=ROOT/'docs/cleanup-v29-left/patch');args=p.parse_args()
    old_path=ROOT/'scripts/cleanup-v28-left/lvot-patch-t120-config.json'
    new_path=ROOT/'scripts/cleanup-v29-left/lvot-proximal-region.json'
    old=json.loads(old_path.read_text());new=json.loads(new_path.read_text())
    lo=np.minimum(old['lowerXYZ'],new['lowerXYZ']);hi=np.maximum(old['upperXYZ'],new['upperXYZ'])
    config=dict(id='lvot-perivalvular-refinement',lowerXYZ=lo.tolist(),upperXYZ=hi.tolist(),interiorThreshold=120,regions=[old,new],scope='Two separately reviewed, independently collared low-contrast envelopes. Existing v28 threshold field is copied exactly; no global threshold change.')
    field=fields_for(config);old_field=original_fields(old);old_lo=np.array(old['lowerXYZ']);old_hi=np.array(old['upperXYZ'])
    sl=(slice(old_lo[2]-lo[2],old_hi[2]-lo[2]),slice(old_lo[0]-lo[0],old_hi[0]-lo[0]))
    differing=0
    for y in range(old_lo[1],old_hi[1]):differing+=int(np.count_nonzero(threshold_plane(config,field,y)[sl]!=original_threshold(old,old_field,y)))
    assert differing==0,'Prior field must remain exact.'
    A.fields_for=fields_for;A.threshold_plane=threshold_plane
    reader=FineSource(cache_bricks=16);report=A.build_patch(reader,config,args.output)
    report['compoundThresholdPolicy']=dict(method='Maximum of independent bounded smoothstep fields; baseline71.4 elsewhere.',priorConfigSha256=hashlib.sha256(old_path.read_bytes()).hexdigest(),additionalConfigSha256=hashlib.sha256(new_path.read_bytes()).hexdigest(),priorThresholdDifferingSamples=differing)
    mask=report['lowBandMask'];raw=gzip.decompress((args.output/mask['file']).read_bytes())
    bits=np.unpackbits(np.frombuffer(raw,np.uint8).reshape(mask['storageDimensionsXYZ'][::-1]),axis=2,count=mask['dimensionsXYZ'][0],bitorder='little').astype(bool)
    old_policy=json.loads((ROOT/'docs/cleanup-v28-left/patch/lvot-perivalvular-refinement-policy.json').read_text())
    old_mask=old_policy['lowBandMask'];old_file=ROOT/'public/assets/cleanup-v28'/old_mask['file']
    old_raw=gzip.decompress(old_file.read_bytes())
    prior_bits=np.unpackbits(np.frombuffer(old_raw,np.uint8).reshape(old_mask['storageDimensionsXYZ'][::-1]),axis=2,count=old_mask['dimensionsXYZ'][0],bitorder='little').astype(bool)
    region=tuple(slice(int(a),int(b)) for a,b in zip((old_lo-lo)[::-1],(old_hi-lo)[::-1]))
    assert np.array_equal(bits[region],prior_bits)
    spec=importlib.util.spec_from_file_location('frozen_wall_v27',ROOT/'scripts/cleanup-v27-wall/restore_wall.py');wall=importlib.util.module_from_spec(spec);spec.loader.exec_module(wall)
    wa,wb,protected,wr=wall.restore_all_selections(reader)
    assert wr['restoreMaskSha256']=='ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea'
    aa=np.maximum(lo,wa);bb=np.minimum(hi,wb);overlap=0
    if np.all(bb>aa):
        part=tuple(slice(int(a),int(b)) for a,b in zip((aa-lo)[::-1],(bb-lo)[::-1]));wpart=tuple(slice(int(a),int(b)) for a,b in zip((aa-wa)[::-1],(bb-wa)[::-1]))
        overlap=int(np.count_nonzero(bits[part]&protected[wpart]))
    assert overlap==0
    report['preservationChecks']=dict(priorLowBandExactlyPreserved=True,restoredWallMaskSha256=wr['restoreMaskSha256'],restoredWallMaskSamples=int(protected.sum()),restoredWallLowBandOverlap=overlap)
    report['source']=reader.receipt()
    (args.output/(config['id']+'-policy.json')).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report['preservationChecks']),flush=True)

if __name__=='__main__':main()
