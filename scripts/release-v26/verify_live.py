from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
import sys,termios,json,hashlib,httpx
old=termios.tcgetattr(sys.stdin.fileno());hidden=termios.tcgetattr(sys.stdin.fileno());hidden[3]&=~termios.ECHO;termios.tcsetattr(sys.stdin.fileno(),termios.TCSANOW,hidden)
print('Ready for Site verification access (hidden stdin).',flush=True)
try:a=json.loads(sys.stdin.readline(32769))
finally:termios.tcsetattr(sys.stdin.fileno(),termios.TCSANOW,old)
base=a['siteUrl'].rstrip('/')
assert base=='https://human-heart-scan-explorer.zhuou557737.chatgpt.site'
paths=['tee-lab.js','tee-lab.css','tee-geometry.js','tee-scene.js','probe-lab.js','probe-acoustics.js','ultra-volume-core.js','ultra-volume-backend.js','ultra-volume-worker.js','ultra-volume.js','fine-surface-worker.js','app.js','renderer.js','fine-surface.js','native-main-detail.js','mesh-debris-cleanup-v25.js','lumen-cleanup-v23.js','assets/cleanup-v26/lumen-manifest.json','assets/cleanup-v26/debris-manifest.json','assets/cleanup-v26/atrial.bits.gz','assets/cleanup-v26/arterial.bits.gz','assets/cleanup-v26/valve-region.bits.gz','assets/cleanup-v26/rv.bits.gz','assets/cleanup-v26/debris-gentle-vertices.raw.gz']
with httpx.Client(headers={'OAI-Sites-Authorization':'Bearer '+a['bearer'],'Accept-Encoding':'identity'},follow_redirects=False,timeout=30) as client:
 def check(path):
  r=client.get(base+'/'+path);data=r.content;expected=hashlib.sha256((Path('public')/path).read_bytes()).hexdigest();actual=hashlib.sha256(data).hexdigest()
  if r.status_code!=200 or actual!=expected:raise RuntimeError('Live asset verification failed: '+path+' HTTP '+str(r.status_code))
  return {'path':path,'status':r.status_code,'bytes':len(data),'sha256':actual,'matchesTestedSource':True}
 with ThreadPoolExecutor(max_workers=3) as pool:checks=list(pool.map(check,paths))
 inv=client.get(base+'/api/fine-detail-v23/status');assert inv.status_code==200
 inventory=inv.json();assert inventory['complete'] and inventory['uploadsEnabled'] is False
 index=json.loads(Path('server/fine-detail-index-v23.json').read_text());first=next(iter(index))
 closed=client.put(base+'/api/fine-detail-v23/'+first,content=b'');assert closed.status_code==405
 report={'verifiedAt':datetime.now(timezone.utc).isoformat(),'baseUrl':base,'checks':checks,'allMatch':True,'fineBankComplete':inventory['complete'],'fineUploadsEnabled':inventory['uploadsEnabled'],'emptyPutStatus':closed.status_code,'siteServiceAuthorizationUsed':True,'credentialsRecorded':False}
 Path('docs/release-v26/live-asset-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
