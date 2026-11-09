#!/usr/bin/env python3
"""Index and stage large comparison display files for immutable R2 delivery.

Source files and public URLs remain unchanged. Only verified copies in the
build output are omitted from the small deployment archive; the Worker serves
those URLs from the manifest-bound display collection. Local exports retain
all original public files and therefore need no cloud service.
"""
from pathlib import Path
import argparse,hashlib,json,re
ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/'public/assets/donors'
INDEX=ROOT/'server/comparison-display-index-v10.json'
SLUGS=('s-20-29','s-20-28')

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()

def safe_path(key,root):
 assert re.fullmatch(r'(?:s-20-29|s-20-28)/(?:[a-z0-9_-]+/)+[a-z0-9_.-]+\.(?:gz|webp)',key),key
 p=root/key
 assert not p.is_symlink() and root.resolve() in p.resolve().parents
 return p

def write_index():
 index={}
 for slug in SLUGS:
  for p in sorted((PUBLIC/slug).rglob('*')):
   if not p.is_file() or p.suffix not in ('.gz','.webp'):continue
   key=p.relative_to(PUBLIC).as_posix();safe_path(key,PUBLIC)
   size=p.stat().st_size;assert 0<size<=16*1024*1024
   index[key]={'bytes':size,'sha256':sha(p),'contentType':'image/webp' if p.suffix=='.webp' else 'application/octet-stream'}
 assert len(index)>75
 INDEX.write_text(json.dumps(index,separators=(',',':'),sort_keys=True)+'\n')
 print(json.dumps({'indexedObjects':len(index),'encodedBytes':sum(x['bytes'] for x in index.values()),'largestObjectBytes':max(x['bytes'] for x in index.values())}))

def stage():
 index=json.loads(INDEX.read_text());build=ROOT/'dist/client/assets/donors';removed=0
 assert build.is_dir(),'Build the Site before staging streamed display files.'
 for key,meta in index.items():
  source=safe_path(key,PUBLIC);target=safe_path(key,build)
  assert source.is_file() and source.stat().st_size==meta['bytes'] and sha(source)==meta['sha256'],key
  if target.exists():
   assert target.is_file() and target.stat().st_size==meta['bytes'] and sha(target)==meta['sha256'],key
   target.unlink();removed+=1
 remaining=sum(p.stat().st_size for p in (ROOT/'dist/client').rglob('*') if p.is_file())
 # v19 includes two compact clinical pilots plus an optional fine mesh. The
 # former 220 MiB allowance reserved much more than the Worker requires.
 # Retain 3.75 MiB of the actual 256 MiB hosting limit for the Worker/tar metadata.
 # v23's seed keeps both v19 originals static until their R2 readback is verified;
 # its additional controls/masks need 30 KiB beyond the previous allowance.
 # The observed Worker is 3.01 MiB, leaving headroom for tar entry padding;
 # release packaging additionally checks the final compressed archive itself.
 static_limit=252*1024*1024+256*1024
 assert remaining<static_limit,'Static output exceeds the bounded deployment budget.'
 report={'verified':True,'indexedObjects':len(index),'removedBuildCopies':removed,'streamedBytes':sum(x['bytes'] for x in index.values()),'remainingStaticBytes':remaining,'staticBudgetBytes':static_limit,'sourceFilesUnchanged':True,'publicUrlsUnchanged':True}
 target=ROOT/'.sites-runtime/comparison-display-staging-v10.json';target.parent.mkdir(exist_ok=True);target.write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report))

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--write-index',action='store_true');p.add_argument('--stage',action='store_true');a=p.parse_args()
 assert a.write_index!=a.stage,'Choose exactly one operation.'
 write_index() if a.write_index else stage()
