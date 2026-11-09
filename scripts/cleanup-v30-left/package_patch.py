#!/usr/bin/env python3
"""Package the selected, validated local patch without touching canonical manifests."""
from pathlib import Path
import argparse, gzip, hashlib, importlib.metadata, json, platform, shutil
ROOT=Path(__file__).resolve().parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    ap=argparse.ArgumentParser();ap.add_argument('policy',type=Path);args=ap.parse_args()
    policy=json.loads(args.policy.read_text());audit=ROOT/'docs/cleanup-v30-left/guarded-review/source-validation.json';v=json.loads(audit.read_text())
    assert v['policySha256']==sha(args.policy) and v['markerSupport']['newlyExcluded']==0
    assert all(f['nonBaselineSamples']==0 for f in v['allSixBoxFaces'].values())
    assert v['restoredWall']['lowBandOverlap']==0 and v['priorExcludedSamplesReintroduced']==0
    out=ROOT/'public/assets/cleanup-v30-left';docs=ROOT/'docs/cleanup-v30-left/patch';out.mkdir(parents=True,exist_ok=True);docs.mkdir(parents=True,exist_ok=True)
    entry={k:policy[k] for k in ['id','lowerFullFineXYZ','upperFullFineXYZ']}
    for key in ['surface','lowBandMask']:
        item=policy[key].copy();src=args.policy.parent/item['file'];assert sha(src)==item['sha256'];assert hashlib.sha256(gzip.decompress(src.read_bytes())).hexdigest()==item['decodedSha256']
        dst=out/item['file'];shutil.copyfile(src,dst);assert sha(dst)==item['sha256'];item['url']='./assets/cleanup-v30-left/'+item.pop('file');entry[key]=item
    dst=docs/args.policy.name;shutil.copyfile(args.policy,dst)
    entry.update(reviewPolicy=dict(path=str(dst.relative_to(ROOT)),sha256=sha(dst)),sourceSigmaFineSamples=policy['sourceSigmaFineSamples'],baselineDisplayIntensity=policy['baselineThreshold'],maximumReviewedDisplayIntensity=policy['maximumReviewedDisplayIntensity'],sourceCalibratedHU=False)
    (out/'manifest-entry.json').write_text(json.dumps(entry,indent=2)+'\n')
    inputs=[*sorted((ROOT/'scripts/cleanup-v30-left').glob('*.py')),*sorted((ROOT/'scripts/cleanup-v30-left').glob('*.json')),ROOT/'scripts/cleanup-v28-right/compact_patch.py',ROOT/'scripts/cleanup-v28-right/adaptive_patch.py',ROOT/'scripts/cleanup-v27-wall/restore_wall.py']
    record=dict(selectedCandidate='median145-guarded',policySha256=sha(dst),sourceValidation=dict(path=str(audit.relative_to(ROOT)),sha256=sha(audit)),codeAndConfiguration={str(p.relative_to(ROOT)):sha(p) for p in inputs},environment=dict(python=platform.python_version(),numpy=importlib.metadata.version('numpy'),scipy=importlib.metadata.version('scipy'),scikit_image=importlib.metadata.version('scikit-image'),vtk=importlib.metadata.version('vtk')),artifactEntrySha256=sha(out/'manifest-entry.json'),surfaceReferenceLocalPath=str(args.policy.parent/policy['surfaceReference']['file']),surfaceReferenceSha256=policy['surfaceReference']['sha256'],purpose='One compound LVOT/mitral replacement slot for canonical v30 assembly; original source and current hard object masks remain immutable. The root assembly can split the verified full gzip into ordered transport parts without changing decoded geometry.')
    (docs/'package-receipt.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(entry,indent=2))
if __name__=='__main__':main()
