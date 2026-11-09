#!/usr/bin/env python3
"""Recover completed native checks and combine bounded continuation receipts."""
from pathlib import Path
import hashlib,json,subprocess,sys
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
DATA=Path('/workspace/data/cleanup-v27')
OUT=ROOT/'docs/cleanup-v27/render'
def digest(data):return hashlib.sha256(data).hexdigest()
log=DATA/'render-final.log'
recovered=[]
for line in log.read_text().splitlines():
    if line.startswith('{"case":'):
        recovered.append(json.loads(line))
assert len(recovered)==11
continuation=json.loads((ROOT/'docs/cleanup-v27/render-remainder/validation.json').read_text())
posterior=json.loads((ROOT/'docs/cleanup-v27/render-posterior/validation.json').read_text())
shader_reference=json.loads((ROOT/'docs/cleanup-v27/second-render/validation.json').read_text())
for key,file in [('rendererShaderSha256','public/renderer.js'),('fineSurfaceShaderSha256','public/fine-surface.js')]:
    actual=digest((ROOT/file).read_bytes())
    assert actual==continuation[key]==posterior[key]==shader_reference[key]
manifest_sha=digest((ROOT/'public/assets/cleanup-v27/lumen-manifest.json').read_bytes())
assert continuation['maskManifestSha256']['v27']==posterior['maskManifestSha256']['v27']==manifest_sha

records={r['case']['id']:(r,DATA/'render') for r in recovered}
records.update({r['case']['id']:(r,DATA/'render-remainder') for r in continuation['checks']})
records.update({r['case']['id']:(r,DATA/'render-posterior') for r in posterior['checks']})
cameras=json.loads((ROOT/'docs/cleanup-v27/review-cameras.json').read_text())['cameras']
checks=[]
for case in cameras:
    record,directory=records[case['id']]
    assert record['case']==case
    verified={}
    for mode,suffix in [('v26','v26'),('v27','v27'),('originalOff','cleanup-off')]:
        path=directory/(case['id']+'-'+suffix+'.png')
        a=np.asarray(Image.open(path));assert list(a.shape)==record['rawImageArrayShape']
        assert digest(a.tobytes())==record['rawImageSha256'][mode]
        verified[mode]=dict(path=str(path),fileSha256=digest(path.read_bytes()),rawArraySha256=record['rawImageSha256'][mode])
    record['losslessReadbacksVerified']=verified
    checks.append(record)
assert len(checks)==14

report={**continuation,'checks':checks}
report['source']={k:v for k,v in continuation['source'].items() if k not in ['verifiedUniqueBricks','decodedBrickReads','cacheMaximumBricks','cacheMaximumBytes']}
report['boundedRunSourceReceipts']={'lastThreeTrialViews':continuation['source'],'correctedOppositeHalf':posterior['source']}
report['recovery']={
    'initialBatchCompletedViews':11,'initialBatchExitCode':137,
    'initialBatchLogSha256':digest(log.read_bytes()),
    'initialBatchSourceReadCountsUnavailable':True,
    'retainedCompletedReadbacksVerifiedWithoutRerender':True,
    'continuationCompletedViews':3,
    'cameraCorrection':'The fixture side argument moves the camera without reversing the clip plane. The initial retained-side exterior trial was replaced by one separately verified opposite-half view using normal[0,0,1].',
    'correctedCamera':'survey-posterior-y284',
    'sourceAndShaderInputsFrozenBetweenRuns':True,
    'scope':'An offline native resource limit; not a browser performance result. The final14 checks reuse the11 completed records and two continuation views plus the corrected opposite-half record.'
}
palette_path=DATA/'render/overview-284-v27-palette6.png'
report['palette6Overview']=dict(path=str(palette_path),fileSha256=digest(palette_path.read_bytes()),rawArraySha256=digest(np.asarray(Image.open(palette_path)).tobytes()),sameFinalMaskManifestSha256=manifest_sha)
report['scope']='Fourteen nearby reproducible production-GLSL cameras on unchanged source geometry. Matched v26/v27 and cleanup-disabled readbacks, exact display reversibility, unchanged cap hashes, and verified lossless image arrays. Bounded review, not anatomical identity, exhaustive segmentation or browser performance validation.'
(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
subprocess.run([sys.executable,str(ROOT/'scripts/cleanup-v27/compose_review.py'),'--readbacks',str(DATA/'render'),'--readbacks',str(DATA/'render-remainder'),'--readbacks',str(DATA/'render-posterior'),'--output',str(OUT)],check=True)
print(json.dumps(dict(completedViews=len(checks),manifestSha256=manifest_sha,changedPixels={r['case']['id']:r['changedPixels'] for r in checks}),indent=2))
