"""Seed this owner-private Site's immutable image collection using supported service access.

An existing Sites service bearer is read from hidden stdin and never written.
The application manifest and SHA-256 checks bound every uploaded image.
Requires httpx; install httpx[socks] when the environment uses a SOCKS proxy
(socksio). The local website viewer does not use this helper.
"""
import argparse,atexit,concurrent.futures,hashlib,json,pathlib,re,sys,termios,time
import httpx
from types import SimpleNamespace

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--index',type=pathlib.Path)
p.add_argument('--asset-root',type=pathlib.Path)
p.add_argument('--state',type=pathlib.Path)
p.add_argument('--workers',type=int,default=16)
p.add_argument('--kind',choices=['slices','volume','display'],default='slices')
p.add_argument('--route',help='Exact manifest-bound collection API prefix on this Site.')
p.add_argument('--probe',action='store_true')
p.add_argument('--verify-read-only',action='store_true')
a=p.parse_args()
assert 1<=a.workers<=64
fd=sys.stdin.fileno();old=termios.tcgetattr(fd);hidden=termios.tcgetattr(fd);hidden[3]&=~termios.ECHO
termios.tcsetattr(fd,termios.TCSANOW,hidden)
print('Ready for Site service access JSON on stdin (input is hidden).',flush=True)
try:access=json.loads(sys.stdin.readline())
finally:termios.tcsetattr(fd,termios.TCSANOW,old)
origin=access['siteUrl'].rstrip('/');bearer=access['bearer']
assert origin.startswith('https://') and origin.endswith('.chatgpt.site')
assert '\n' not in bearer and '\r' not in bearer
headers={'OAI-Sites-Authorization':'Bearer '+bearer}

def pooled_client(request_headers,workers):
 # One thread-safe pool avoids a new TCP/TLS connection for every object.
 # Use HTTP/1.1 keep-alive: concurrent HTTP/2 streams were unstable in this host.
 return httpx.Client(headers=request_headers,follow_redirects=False,
  http2=False,
  limits=httpx.Limits(max_connections=workers,max_keepalive_connections=workers,keepalive_expiry=60),
  timeout=httpx.Timeout(90))

client=pooled_client(headers,a.workers)
atexit.register(client.close)

def send(method,path,**kwargs):
 for attempt in range(4):
  try:
   with client.stream(method,origin+path,content=kwargs.get('data')) as reply:
    content=reply.read();r=SimpleNamespace(status_code=reply.status_code,headers=reply.headers,content=content,json=lambda:json.loads(content))
   if r.status_code not in (408,429,500,502,503,504):return r
  except (httpx.RequestError,TimeoutError,OSError):
   if attempt==3:raise RuntimeError('The Site API could not be reached.') from None
  if attempt<3:time.sleep(min(2**attempt,4))
 return r

if a.probe:
 r=send('GET','/assets/manifest.json')
 print(json.dumps({'status':r.status_code,'contentType':r.headers.get('content-type'),'bytes':len(r.content),'json':bool(r.status_code==200 and 'json' in r.headers.get('content-type',''))}),flush=True)
 sys.exit(0 if r.status_code==200 else 1)

index=json.loads(a.index.read_text());root=a.asset_root.resolve()
for path,meta in index.items():
 pattern=(r'(?:[xyz]/\d{4}|empty)\.webp' if a.kind=='slices' else r'\d{2}/\d{2}/\d{2}\.gz' if a.kind=='volume' else r'(?:s-20-29|s-20-28)/(?:[a-z0-9_-]+/)+[a-z0-9_.-]+\.(?:gz|webp)')
 assert re.fullmatch(pattern,path)
 source=(root/path).resolve();assert root in source.parents
 assert source.stat().st_size==meta['bytes'] and hashlib.sha256(source.read_bytes()).hexdigest()==meta['sha256']
api=a.route or ('/api/ultra/v4/' if a.kind=='slices' else '/api/ultra-volume/v7/' if a.kind=='volume' else '/api/comparison-display-v10/')
if a.kind=='display':assert api=='/api/comparison-display-v10/'
else:assert re.fullmatch(r'/api/(?:ultra/v4|ultra-volume/v7|donors/(?:s-20-29|s-20-28)/(?:ultra|volume))/',api)
state={'uploaded':[]}
if a.state and a.state.exists():state=json.loads(a.state.read_text())
done=set(state['uploaded'])
def checkpoint():
 if a.state:
  target=a.state.with_suffix('.tmp');target.write_text(json.dumps({'uploaded':sorted(done)}));target.replace(a.state)
def upload(path):
 data=(root/path).read_bytes();r=send('PUT',api+path,data=data)
 if r.status_code not in (201,204):raise RuntimeError(f'Image {path} was not accepted (HTTP {r.status_code}).')
 return path

if not a.verify_read_only:
 todo=[path for path in index if path not in done];started=time.monotonic()
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
  for future in concurrent.futures.as_completed([pool.submit(upload,path) for path in todo]):
   done.add(future.result())
   if len(done)%50==0 or len(done)==len(index):
    checkpoint();print(json.dumps({'uploaded':len(done),'of':len(index),'elapsedSeconds':round(time.monotonic()-started,1)}),flush=True)
 checkpoint()
r=send('GET',api+'status')
if r.status_code!=200:raise RuntimeError(f'Storage inventory unavailable (HTTP {r.status_code}).')
inventory=r.json()
if not inventory.get('complete') or inventory.get('expected')!=len(index):
 raise RuntimeError('Storage inventory does not match the generated manifest: '+json.dumps(inventory))
sample_paths=[list(index)[round((len(index)-1)*fraction)] for fraction in [0,.33,.67,1]]
for path in sample_paths:
 r=send('GET',api+path)
 assert r.status_code==200 and hashlib.sha256(r.content).hexdigest()==index[path]['sha256'],path
if a.verify_read_only:
 first=next(iter(index));r=send('PUT',api+first,data=(root/first).read_bytes())
 assert r.status_code==405,'Final application must reject uploads.'
 assert inventory['uploadsEnabled'] is False
print(json.dumps({'verified':True,'inventory':inventory,'representativeGETChecksums':'4/4 matched','readOnlyVerified':a.verify_read_only}),flush=True)
