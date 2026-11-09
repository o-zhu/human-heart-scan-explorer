"""Fetch the authentic full-organ HOA N5 s3 pyramid, resumably."""
import argparse, concurrent.futures, hashlib, json, math, pathlib, time, urllib.request
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data-root',type=pathlib.Path,default=pathlib.Path.cwd()/'heart-data')
parser.add_argument('--workers',type=int,default=20)
args=parser.parse_args()
ROOT=args.data_root.resolve(); ROOT.mkdir(parents=True,exist_ok=True)
BASE='https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/LADAF-2021-17/heart/19.85um_complete-organ_bm18/'
DEST=ROOT/'chunks-s3'; DEST.mkdir(exist_ok=True)
ATTR={'blockSize':[128,128,128],'compression':{'blocksize':0,'clevel':9,'cname':'zstd','shuffle':2,'type':'blosc'},'dataType':'uint16','dimensions':[951,951,1060]}
(ROOT/'s3-attributes.json').write_text(json.dumps(ATTR,indent=2))
counts=[math.ceil(n/b) for n,b in zip(ATTR['dimensions'],ATTR['blockSize'])]
coords=[(x,y,z) for z in range(counts[2]) for y in range(counts[1]) for x in range(counts[0])]
def fetch(c):
 x,y,z=c; p=DEST/f'{x}_{y}_{z}.bin'
 if p.exists() and p.stat().st_size>16:return {'coord':c,'bytes':p.stat().st_size,'state':'cached'}
 for attempt in range(4):
  try:
   with urllib.request.urlopen(BASE+f's3/{x}/{y}/{z}',timeout=60) as response:payload=response.read()
   temp=p.with_suffix('.tmp');temp.write_bytes(payload);temp.replace(p)
   return {'coord':c,'bytes':len(payload),'state':'downloaded','sha256':hashlib.sha256(payload).hexdigest()}
  except Exception as e:
   if attempt==3:return {'coord':c,'bytes':0,'state':'failed','error':str(e)}
   time.sleep(min(2**attempt,4))
started=time.monotonic();results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
 for future in concurrent.futures.as_completed([pool.submit(fetch,c) for c in coords]):
  r=future.result();results.append(r)
  if len(results)%24==0 or not r['bytes']:print(f'{len(results)}/{len(coords)}; {sum(v["bytes"] for v in results)/1e6:.1f} MB; {time.monotonic()-started:.1f}s; {r}',flush=True)
(ROOT/'s3-download-results.json').write_text(json.dumps(results,indent=2))
errors=[v for v in results if not v['bytes']]
print(f'COMPLETE {len(results)-len(errors)}/{len(coords)}; {sum(v["bytes"] for v in results)/1e6:.1f} MB; {time.monotonic()-started:.1f}s',flush=True)
if errors:raise SystemExit(1)
