#!/usr/bin/env python3
"""Re-read source, masks and delivered mesh for the selected left refinement.

This independently checks source-support preservation in named screenshot ROIs
and all six field-box faces. ROI names describe reviewed spatial windows, not
expert-validated tissue segmentations. It does not assert anatomical correctness.
"""
from pathlib import Path
import argparse, gzip, hashlib, importlib.util, json, sys
import numpy as np
from scipy import ndimage as ndi
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts/cleanup-v30-left'))
import build_patch as B

def sha(data): return hashlib.sha256(data).hexdigest()
def box_slice(a,b,origin):
    return tuple(slice(int(x),int(y)) for x,y in zip((np.asarray(a)-origin)[::-1],(np.asarray(b)-origin)[::-1]))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('policy',type=Path);ap.add_argument('--output',type=Path,required=True);args=ap.parse_args()
    p=json.loads(args.policy.read_text());lo=np.array(p['lowerFullFineXYZ']);hi=np.array(p['upperFullFineXYZ']);dims=hi-lo
    reader=B.FineSource(16);padded=reader.region(lo-4,hi+4);raw=padded[4:-4,4:-4,4:-4]
    assert sha(np.ascontiguousarray(raw))==p['sourceRoiSha256'];assert sha(padded)==p['sourcePaddedRoiSha256']
    baseline=ndi.gaussian_filter(padded.astype(np.float32),.5,truncate=3)[4:-4,4:-4,4:-4].copy()
    regular=ndi.gaussian_filter(ndi.median_filter(padded,size=3).astype(np.float32),.5,truncate=3)[4:-4,4:-4,4:-4].copy()
    q=baseline>=150;coherent=np.zeros(q.shape,bool)
    directions=[(0,0,1),(0,1,0),(1,0,0),(0,1,1),(0,1,-1),(1,0,1),(1,0,-1),(1,1,0),(1,-1,0),(1,1,1),(1,1,-1),(1,-1,1),(1,-1,-1)]
    for direction in directions:
        support=q.copy()
        for step in [-2,-1,1,2]:support &= np.roll(q,tuple(step*v for v in direction),axis=(0,1,2))
        coherent |= support
    coherent &= raw>=170;coherent |= regular>=155
    for axis in range(3):
        s=[slice(None)]*3;s[axis]=slice(0,2);coherent[tuple(s)]=False;s[axis]=slice(-2,None);coherent[tuple(s)]=False
    del support,q,regular,padded
    removed=B.read_mask(p['lowBandMask'],args.policy.parent)
    oldmanifest=json.loads((ROOT/'public/assets/cleanup-v29/surface-manifest.json').read_text())
    old=next(x for x in oldmanifest['patches'] if x['id']==p['id'])
    prior=np.zeros(removed.shape,bool);prior[box_slice(old['lowerFullFineXYZ'],old['upperFullFineXYZ'],lo)]=B.read_mask(old['lowBandMask'],ROOT/'public')
    new=removed&~prior
    assert int((prior&~removed).sum())==0
    marker=dict(total=int(coherent.sum()),retained=int((coherent&~removed).sum()),excludedByPrior=int((coherent&prior).sum()),newlyExcluded=int((coherent&new).sum()))
    assert marker['newlyExcluded']==0
    named=[]
    for name,a,b in [('Aortic root and LVOT rim',[1035,968,930],[1195,1208,1090]),('Mitral leaflet window',[1140,1080,1060],[1300,1220,1200]),('Mitral chordal window',[1070,1040,1170],[1260,1220,1380])]:
        s=box_slice(a,b,lo);c=coherent[s];r=removed[s];oldr=prior[s];newr=new[s]
        named.append(dict(name=name,lowerFullFineXYZ=a,upperFullFineXYZ=b,originalForegroundSamples=int((baseline[s]>=B.A.BASE).sum()),removedForegroundSamples=int(r.sum()),newlyRemovedForegroundSamples=int(newr.sum()),sourceCoherentMarkers=int(c.sum()),retainedCoherentMarkers=int((c&~r).sum()),priorExcludedCoherentMarkers=int((c&oldr).sum()),newlyExcludedCoherentMarkers=int((c&newr).sum())))
        assert named[-1]['newlyExcludedCoherentMarkers']==0
    # Recompute exact threshold fields on every box face. The regularization
    # multiplier is already zero on each face, independently of support EDT.
    config=p['config'];ff=B.fields(config)
    legacy=[json.loads((ROOT/'scripts/cleanup-v28-left/lvot-patch-t120-config.json').read_text()),json.loads((ROOT/'scripts/cleanup-v29-left/lvot-proximal-region.json').read_text())]
    lf=[(r,B.A.fields_for(r)) for r in legacy]
    faces={name:dict(samples=0,nonBaselineSamples=0,maximumAbsoluteDifference=0.) for name in ['xLower','xUpper','yLower','yUpper','zLower','zUpper']}
    for j,y in enumerate(range(int(lo[1]),int(hi[1]))):
        b=baseline[:,j,:];t=np.full(b.shape,B.A.BASE,np.float32);w=B.plane(config,ff,y)
        for r,f in lf:
            a=np.array(r['lowerXYZ']);z=np.array(r['upperXYZ'])
            if a[1]<=y<z[1]:
                s=(slice(int(a[2]-lo[2]),int(z[2]-lo[2])),slice(int(a[0]-lo[0]),int(z[0]-lo[0])))
                t[s]=np.maximum(t[s],B.A.threshold_plane(r,f,y))
        pieces=[('xLower',w[:,0],t[:,0]),('xUpper',w[:,-1],t[:,-1]),('zLower',w[0],t[0]),('zUpper',w[-1],t[-1])]
        if j==0:pieces.append(('yLower',w,t))
        if j==dims[1]-1:pieces.append(('yUpper',w,t))
        for name,weight,threshold in pieces:
            assert not np.any(weight!=0), (name,'nonzero regularizer weight')
            delta=np.abs(threshold-B.A.BASE);f=faces[name];f['samples']+=int(delta.size);f['nonBaselineSamples']+=int((delta>1e-5).sum());f['maximumAbsoluteDifference']=max(f['maximumAbsoluteDifference'],float(delta.max()))
    assert all(f['nonBaselineSamples']==0 for f in faces.values())
    spec=importlib.util.spec_from_file_location('frozen_wall',ROOT/'scripts/cleanup-v27-wall/restore_wall.py');wall=importlib.util.module_from_spec(spec);spec.loader.exec_module(wall)
    wa,wb,protected,wr=wall.restore_all_selections(reader);assert int(protected.sum())==109928 and wr['restoreMaskSha256']=='ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea'
    aa=np.maximum(lo,wa);bb=np.minimum(hi,wb);overlap=0
    if np.all(bb>aa):overlap=int((removed[box_slice(aa,bb,lo)]&protected[box_slice(aa,bb,wa)]).sum())
    assert overlap==0
    enc=(args.policy.parent/p['surface']['file']).read_bytes();assert sha(enc)==p['surface']['sha256'];data=gzip.decompress(enc);assert sha(data)==p['surface']['decodedSha256']
    h=np.frombuffer(data,'<u4',8);assert h[0]==0x314d4648;nv,ni,po,no,io=map(int,h[2:7]);indices=np.frombuffer(data,'<u4',ni,io);assert int(indices.max())<nv and len(data)==io+ni*4
    report=dict(sourceRoiSha256=p['sourceRoiSha256'],sourcePaddedRoiSha256=p['sourcePaddedRoiSha256'],source=reader.receipt(),policySha256=sha(args.policy.read_bytes()),markerSupport=marker,namedReviewWindows=named,allSixBoxFaces=faces,newlyRemovedForegroundSamples=int(new.sum()),allRemovedForegroundSamples=int(removed.sum()),priorRemovedForegroundSamples=int(prior.sum()),priorExcludedSamplesReintroduced=0,restoredWall=dict(samples=109928,maskSha256=wr['restoreMaskSha256'],lowBandOverlap=overlap),deliveredMesh=dict(vertices=nv,triangles=ni//3,indexBoundsVerified=True,sha256=sha(enc),decodedSha256=sha(data)),interpretation='New support-guarded refinement removes zero coherent marker samples. Previously excluded marker samples are counted separately and retained as previous exclusions. Markers and named spatial review windows are technical evidence, not tissue classification or clinical validation.')
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(markerSupport=marker,namedReviewWindows=named,allSixBoxFaces=faces,newlyRemovedForegroundSamples=int(new.sum()))),flush=True)
if __name__=='__main__':main()
