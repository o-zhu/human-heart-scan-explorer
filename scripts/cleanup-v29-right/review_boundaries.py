#!/usr/bin/env python3
"""Audit reviewed source levels and overlay exact removal masks on serial data."""
from pathlib import Path
import argparse,gzip,hashlib,json,sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy import ndimage as ndi
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource

def main():
    p=argparse.ArgumentParser();p.add_argument('policy',type=Path);p.add_argument('--indices',required=True);p.add_argument('--name',required=True);a=p.parse_args()
    policy=json.loads(a.policy.read_text());cfg=policy['config'];axis=cfg['sliceAxis'];indices=list(map(int,a.indices.split(',')))
    lo=np.array(cfg['lowerXYZ']);hi=np.array(cfg['upperXYZ']);dims=hi-lo;mask=policy['lowBandMask'];packed=(a.policy.parent/mask['file']).read_bytes();assert hashlib.sha256(packed).hexdigest()==mask['sha256'];raw_mask=gzip.decompress(packed);assert hashlib.sha256(raw_mask).hexdigest()==mask['decodedSha256']
    packed_array=np.frombuffer(raw_mask,np.uint8).reshape(mask['storageDimensionsXYZ'][::-1]);removed=np.unpackbits(packed_array,axis=2,count=int(dims[0]),bitorder='little').astype(bool)
    fine=FineSource(12);other=[i for i in range(3) if i!=axis];extent=[lo[other[0]],hi[other[0]],hi[other[1]],lo[other[1]]]
    fig,axs=plt.subplots(len(indices),2,figsize=(12,len(indices)*4.0),squeeze=False);checks=[]
    for row,coordinate in enumerate(indices):
        a_lo=lo.copy();a_hi=hi.copy();a_lo[axis]=coordinate;a_hi[axis]=coordinate+1
        padded=fine.region(a_lo-3,a_hi+3);smooth=ndi.gaussian_filter(padded.astype(np.float32),.5,truncate=3)[3:-3,3:-3,3:-3]
        source=np.take(padded[3:-3,3:-3,3:-3],0,axis=2-axis);filtered=np.take(smooth,0,axis=2-axis)
        exclude=np.take(removed,coordinate-lo[axis],axis=2-axis)
        # Record what was actually excluded, including the display-core guards.
        checks.append(dict(axis=axis,coordinate=coordinate,removedSamples=int(exclude.sum()),removedAtOrAbove155=int(np.count_nonzero(exclude&(filtered>=155))),removedOriginal190=int(np.count_nonzero(exclude&(source>=190))),maximumRemovedFilteredValue=float(filtered[exclude].max(initial=0))))
        assert checks[-1]['removedAtOrAbove155']==checks[-1]['removedOriginal190']==0
        for ax in axs[row]:ax.imshow(source,cmap='gray',vmin=0,vmax=255,extent=extent,interpolation='nearest');ax.set_xlabel('XYZ'[other[0]]+' fine index');ax.set_ylabel('XYZ'[other[1]]+' fine index')
        axs[row,0].set_title('Measured original · '+'XYZ'[axis]+'='+str(coordinate))
        overlay=np.zeros((*exclude.shape,4),np.float32);overlay[exclude]=[1,.23,.08,.75];axs[row,1].imshow(overlay,extent=extent,interpolation='nearest');axs[row,1].set_title('Orange = exact removed weak band; source unchanged')
    fig.suptitle('Source-guided display cleanup · original measured 79.4 µm samples',fontsize=14);fig.tight_layout();out=ROOT/'docs/cleanup-v29-right/source';out.mkdir(parents=True,exist_ok=True);fig.savefig(out/(a.name+'.png'),dpi=115);plt.close(fig)
    wall=json.loads((ROOT/'docs/cleanup-v27-wall/restoration-all-selections.json').read_text());wl=np.array(wall['restoreLowerXYZ']);wh=np.array(wall['restoreUpperExclusiveXYZ']);disjoint=bool(np.any(hi<=wl)|np.any(wh<=lo));assert disjoint
    record=dict(policySha256=hashlib.sha256(a.policy.read_bytes()).hexdigest(),lowBandMaskSha256=mask['sha256'],checks=checks,source=fine.receipt(),priorAtrialWallRestorationDisjoint=disjoint,restorationSamples=wall['restoreSamples'],restorationMaskSha256=wall['restoreMaskSha256'],sourceDataUnmodified=True,sourceNotCalibratedHU=True,scope='Serial source display intensities and exact mask verification. Bright-core counts precede the separately documented inherited compact-component display filter. Not an anatomical identity or accuracy validation.')
    (out/(a.name+'.json')).write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record['checks']),flush=True)
if __name__=='__main__':main()
