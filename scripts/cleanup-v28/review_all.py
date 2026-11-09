#!/usr/bin/env python3
"""Review one full-heart camera per process to bound native GL allocations."""
from pathlib import Path
import argparse,json,os,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/cleanup-v28/final-review'
LOSSLESS=Path('/workspace/data/cleanup-v28/final-review')
CASES=['lvot-y262','la-y316','tricuspid-y263','pulmonary-x194','inlet-x313',
 'wall-y284','wall-y284-oblique','survey-y249','survey-y361','survey-apex-y253','survey-exterior']
def aggregate(allow_incomplete=False):
    reports=[];missing=[]
    for case in CASES:
        path=OUT/case/'validation.json'
        if not path.exists():
            missing.append(dict(case=case,status='Incomplete',reason='Native GL run did not complete. No image-validation claim for this camera.',log=str((OUT/case/'run.log').relative_to(ROOT))))
            continue
        report=json.loads(path.read_text());assert len(report['checks'])==1
        check=report['checks'][0];assert check['case']['id']==case and check['reversible'] and check['originalOffExact']
        reports.append(report)
    assert reports,'No completed camera receipts.'
    assert allow_incomplete or not missing, f'Missing completed cameras: {[x["case"] for x in missing]}'
    baseline=reports[0]
    for report in reports[1:]:
        for key in ['patches','maskManifestSha256','rendererSha256','fineSurfaceSha256']:
            assert report[key]==baseline[key],key
    by_case={r['checks'][0]['case']['id']:r for r in reports}
    final={**baseline,'checks':[r['checks'][0] for r in reports],
      'completedViews':len(reports),'requestedViews':len(CASES),'complete':not missing,'incompleteViews':missing,
      'reviewCullingByCamera':{case:r.get('reviewCulling') for case,r in by_case.items()},
      'reviewStreamingByCamera':{case:r['reviewStreaming'] for case,r in by_case.items() if r.get('reviewStreaming')},
      'cameraReceipts':{case:str((OUT/case/'validation.json').relative_to(ROOT)) for case in by_case},
      'reviewMethod':'Source-pinned cameras in isolated native GL processes using unchanged production GLSL and depth compositing. Each checks v27→v28→v27 restoration and both cleanup-off outputs byte-exact. Conservative camera culling omits only wholly offscreen or clipped triangles. Where recorded, consecutive exact triangle batches bound GPU storage; source attributes, face order, camera, shaders and persistent framebuffer/depth are unchanged.'}
    final.pop('reviewCulling',None);final.pop('reviewStreaming',None)
    parity=ROOT/'docs/cleanup-v28/stream-parity/validation.json'
    if parity.exists():
        evidence=json.loads(parity.read_text())
        final['streamingParity']={'receipt':str(parity.relative_to(ROOT)),**evidence.get('streamingParity',{})}
    (OUT/'validation.json').write_text(json.dumps(final,indent=2)+'\n')
    (OUT/'progress.json').write_text(json.dumps(dict(completed=list(by_case),remaining=[x['case'] for x in missing]),indent=2)+'\n')
    print(json.dumps(dict(passed=True,complete=not missing,views=len(reports),incomplete=[x['case'] for x in missing],allReversible=True,allOriginalOffExact=True)),flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--aggregate-only',action='store_true');parser.add_argument('--allow-incomplete',action='store_true');parser.add_argument('--resume',action='store_true');options=parser.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    if options.aggregate_only:aggregate(options.allow_incomplete);return
    env={**os.environ,'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1','LP_NUM_THREADS':'1','MESA_GLTHREAD':'false'}
    reports=[]
    for case in CASES:
        directory=OUT/case;directory.mkdir(exist_ok=True)
        if options.resume and (directory/'validation.json').exists():
            report=json.loads((directory/'validation.json').read_text());assert len(report['checks'])==1
            check=report['checks'][0];assert check['case']['id']==case and check['reversible'] and check['originalOffExact']
            reports.append(report);continue
        subprocess.run([sys.executable,str(ROOT/'scripts/cleanup-v28/cache_review_geometry.py'),case],cwd=ROOT,env=env,check=True,stdout=subprocess.DEVNULL)
        command=[sys.executable,str(ROOT/'scripts/cleanup-v28/render_review.py'),'--case',case,'--output',str(directory),'--lossless-output',str(LOSSLESS/case)]
        if case=='survey-exterior':command+=['--stream-triangles','100000']
        with (directory/'run.log').open('w') as log:
            run=subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
        if run.returncode:
            if options.allow_incomplete:continue
            raise RuntimeError(f'{case}: native renderer returned {run.returncode}; see {directory}/run.log')
        report=json.loads((directory/'validation.json').read_text());assert len(report['checks'])==1
        check=report['checks'][0];assert check['reversible'] and check['originalOffExact']
        reports.append(report)
        (OUT/'progress.json').write_text(json.dumps(dict(completed=[r['checks'][0]['case']['id'] for r in reports],remaining=CASES[len(reports):]),indent=2)+'\n')
        print(json.dumps(dict(case=case,changedPixels=check['changedPixels'],originalOffExact=True,reversible=True)),flush=True)
    aggregate(options.allow_incomplete)
if __name__=='__main__':main()
