#!/usr/bin/env python3
"""Same-camera v28 to v29-left review using exact production mesh shaders.

The verified existing v28 renderer is reused with both sides' local patches
active. Overrides replace matching patch IDs; all unaffected patches persist.
"""
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28'))
code=(ROOT/'scripts/cleanup-v28/render_review.py').read_text()
code=code.replace("ROOT/'scripts/cleanup-v28/review-cameras.json'","ROOT/'scripts/cleanup-v29-left/review-cameras.json'")
code=code.replace("Path('/workspace/data/cleanup-v28/camera-geometry')","Path('/workspace/data/cleanup-v29-left/camera-geometry')")
code=code.replace("ROOT/'docs/cleanup-v28/render'","ROOT/'docs/cleanup-v29-left/render'")
code=code.replace("Path('/workspace/data/cleanup-v28/render')","Path('/workspace/data/cleanup-v29-left/render')")
needle="patches=[patch_install(p,r,i) for i,(p,r) in enumerate(patches)];gc.collect()"
assert needle in code
code=code.replace(needle,needle+'''
override_patches={p['policy']['id']:p for p in patches}
baseline_manifest=json.loads((ROOT/'public/assets/cleanup-v28/surface-manifest.json').read_text())
baseline_patches=[patch_install(p,ROOT/'public',i) for i,p in enumerate(baseline_manifest['patches'])]
patches_by_version={'v27':baseline_patches,'v28':[override_patches.get(p['policy']['id'],p) for p in baseline_patches]}
collections['v27']=dict(collections['v28'])
candidate_masks=ROOT/'public/assets/cleanup-v29-left/lumen-manifest.json'
if candidate_masks.is_file():
 lm=json.loads(candidate_masks.read_text());candidate_mask_textures=[]
 for index,item in enumerate(lm['masks']):
  encoded=public_path(item['url']).read_bytes();assert hashlib.sha256(encoded).hexdigest()==item['sha256']
  raw=gzip.decompress(encoded);assert hashlib.sha256(raw).hexdigest()==item['decodedSha256']
  dims=item.get('storageDimensionsXYZ',item['dimensionsXYZ']);a=np.frombuffer(raw,np.uint8).reshape(dims[::-1]);tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));active(0x84C0+6+index);bind(0x806F,tex)
  t3(0x806F,0,0x8229,*dims,0,0x1903,0x1401,a.ctypes.data)
  for k,v in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812F),(0x2803,0x812F),(0x8072,0x812F)]:param(0x806F,k,v)
  candidate_mask_textures.append(tex)
 collections['v28']=dict(collections['v28'],manifest=lm,textures=candidate_mask_textures)
old_set_version=set_version
def set_version(name):
 global patches
 old_set_version(name);patches=patches_by_version[name]
set_version('v27')
''')
code=code.replace("active_version=='v28' and cleanup_on and bool(patches)","cleanup_on and bool(patches)")
code=code.replace("active_version=='v28' and cleanup_on and patches", "cleanup_on and patches")
helper=(ROOT/'scripts/cleanup-v29-left/locate.py').read_text().split('section_manifest=',1)[1].split('\nfor case in selected:',1)[0]
code=code.replace('\nchecks=[]','\nsection_manifest='+helper+'\nchecks=[]')
code=code.replace("cap=np.take(fine.region(lo,hi),0,axis=2-axis).copy();cap_hash=", "cap,cap_entry=exact_section(axis,coordinate);cap_hash=")
code=code.replace("+'-v27.png'", "+'-v28-before.png'").replace("+'-v28.png'", "+'-v29-after.png'")
code=code.replace("'v27 · Before'","'v28 · Before'").replace("'v28 · Source-guided refinement'","'v29 · Source-guided refinement'")
code=code.replace("maskManifestSha256={v:hashlib.sha256((ROOT/f'public/assets/cleanup-{v}/lumen-manifest.json').read_bytes()).hexdigest() for v in collections}","maskManifestSha256={'before':hashlib.sha256((ROOT/'public/assets/cleanup-v28/lumen-manifest.json').read_bytes()).hexdigest(),'after':hashlib.sha256((candidate_masks if candidate_masks.is_file() else ROOT/'public/assets/cleanup-v28/lumen-manifest.json').read_bytes()).hexdigest()}")
code=code.replace("Nearby reproducible views, not exact screenshot registration.","Both before and after retain their current local patches. Before is published v28; after has only explicit matching-ID candidate overrides and optional candidate masks. Nearby reproducible views, not exact screenshot registration.")
code=code.replace("(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\\n')","(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\\n')\nif len(selected)==1:(OUT/(selected[0]['id']+'-validation.json')).write_text(json.dumps(report,indent=2)+'\\n')")
exec(compile(code,str(ROOT/'scripts/cleanup-v28/render_review.py'),'exec'))
