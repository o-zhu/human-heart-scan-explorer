#!/usr/bin/env python3
"""Same-camera v29 to v30-left review using exact production mesh shaders.

The verified existing v28 renderer is reused with both sides' local patches
active. Overrides replace matching patch IDs; all unaffected patches persist.
"""
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28'))
code=(ROOT/'scripts/cleanup-v28/render_review.py').read_text()
code=code.replace("options=parser.parse_args();saved_options=options", "parser.add_argument('--baseline-no-local',action='store_true',help='Diagnostic only: before uses original Gentle plus current object masks, without local replacement surfaces.');options=parser.parse_args();saved_options=options")
code=code.replace("ROOT/'scripts/cleanup-v28/review-cameras.json'","ROOT/'scripts/cleanup-v30-left/review-cameras.json'")
code=code.replace("Path('/workspace/data/cleanup-v28/camera-geometry')","Path('/workspace/data/cleanup-v30-left/camera-geometry')")
code=code.replace("ROOT/'docs/cleanup-v28/render'","ROOT/'docs/cleanup-v30-left/render'")
code=code.replace("Path('/workspace/data/cleanup-v28/render')","Path('/workspace/data/cleanup-v30-left/render')")
code=code.replace("assert review_receipt['camera']==selected[0] and review_receipt['sourceDecodedSha256']==lod['decodedSha256']", "assert review_receipt['camera']==selected[0] and review_receipt['sourceDecodedSha256']==lod['decodedSha256']\ncurrent_shading=json.loads((ROOT/'public/assets/display-compact-v29/mesh-manifest.json').read_text())\nassert review_receipt.get('currentShadingDecodedSha256')==current_shading['decodedSha256']\nassert review_receipt.get('currentShadingNormalSha256')==current_shading['decodedNormalSha256']")
needle="patches=[patch_install(p,r,i) for i,(p,r) in enumerate(patches)];gc.collect()"
assert needle in code
code=code.replace(needle,needle+'''
override_patches={p['policy']['id']:p for p in patches} if options.patch_policy else {}
baseline_manifest=json.loads((ROOT/'public/assets/cleanup-v29/surface-manifest.json').read_text())
baseline_patches=[patch_install(p,ROOT/'public',i) for i,p in enumerate(baseline_manifest['patches'])]
patches_by_version={'v27':[] if options.baseline_no_local else baseline_patches,'v28':[override_patches.get(p['policy']['id'],p) for p in baseline_patches]}
collections['v27']=dict(collections['v28'])
baseline_masks=json.loads((ROOT/'public/assets/cleanup-v29/lumen-manifest.json').read_text())
for version in ['v27','v28']:
 baseline_texture_list=[]
 for index,item in enumerate(baseline_masks['masks']):
  encoded=public_path(item['url']).read_bytes();assert hashlib.sha256(encoded).hexdigest()==item['sha256']
  raw=gzip.decompress(encoded);assert hashlib.sha256(raw).hexdigest()==item['decodedSha256']
  dims=item.get('storageDimensionsXYZ',item['dimensionsXYZ']);a=np.frombuffer(raw,np.uint8).reshape(dims[::-1]);tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));active(0x84C0+6+index);bind(0x806F,tex)
  t3(0x806F,0,0x8229,*dims,0,0x1903,0x1401,a.ctypes.data)
  for k,v in [(0x2801,0x2600),(0x2800,0x2600),(0x2802,0x812F),(0x2803,0x812F),(0x8072,0x812F)]:param(0x806F,k,v)
  baseline_texture_list.append(tex)
 collections[version]=dict(collections[version],manifest=baseline_masks,textures=baseline_texture_list)
candidate_masks=ROOT/'public/assets/cleanup-v30-left/lumen-manifest.json'
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
code=code.replace("old_configure(program,*args,**kwargs)","old_configure(program,*args,**kwargs);ui(program,'sceneDepthTexture',5);ui(program,'sceneDepthReady',0)")
code=code.replace("active_version=='v28' and cleanup_on and patches", "cleanup_on and patches")
helper=(ROOT/'scripts/cleanup-v29-left/locate.py').read_text().split('section_manifest=',1)[1].split('\nfor case in selected:',1)[0]
code=code.replace('\nchecks=[]','\nsection_manifest='+helper+'\nchecks=[]')
code=code.replace("cap=np.take(fine.region(lo,hi),0,axis=2-axis).copy();cap_hash=", "cap,cap_entry=exact_section(axis,coordinate);cap_hash=")
code=code.replace("+'-v27.png'", "+'-v29-before.png'").replace("+'-v28.png'", "+'-v30-after.png'")
code=code.replace("'v27 · Before'","'v29 · Before'").replace("'v28 · Source-guided refinement'","'v30 · Source-guided refinement'")
code=code.replace("'v29 · Before',font=", "('Whole-heart only · Diagnostic' if options.baseline_no_local else 'v29 · Before'),font=")
code=code.replace("checks=checks,scope=", "baselineLocalRefinementsEnabled=not options.baseline_no_local,checks=checks,scope=")
code=code.replace("maskManifestSha256={v:hashlib.sha256((ROOT/f'public/assets/cleanup-{v}/lumen-manifest.json').read_bytes()).hexdigest() for v in collections}","maskManifestSha256={'before':hashlib.sha256((ROOT/'public/assets/cleanup-v29/lumen-manifest.json').read_bytes()).hexdigest(),'after':hashlib.sha256((candidate_masks if candidate_masks.is_file() else ROOT/'public/assets/cleanup-v29/lumen-manifest.json').read_bytes()).hexdigest()}")
code=code.replace("Nearby reproducible views, not exact screenshot registration.","Both before and after retain their current local patches. Before is published v29; after has only explicit matching-ID candidate overrides and optional candidate masks. All retained depth behind the section is visible; there is no rear slab. Nearby reproducible views, not exact screenshot registration.")
code=code.replace("productionShaders=True,rendererSha256=", "currentShading=dict(decodedSha256=review_receipt['currentShadingDecodedSha256'],normalSha256=review_receipt['currentShadingNormalSha256'],manifestSha256=review_receipt['currentShadingManifestSha256'],attributePolicy=review_receipt['attributePolicy']),productionShaders=True,rendererSha256=")
code=code.replace("imageHashes=dict(v27=", "imageHashes=dict(before=").replace(",v28=hashlib.sha256(after", ",after=hashlib.sha256(after")
code=code.replace("(OUT/'validation.json').write_text", "if options.baseline_no_local:report['scope']='Diagnostic activation comparison: BEFORE uses original whole-heart Gentle geometry with current corrected normals, debris flags and hard object masks, but NO local refinement meshes or local low-band masks. AFTER enables the guarded candidate and the three retained local refinements. This is not the fully active published v29 baseline. Exact production GLSL and unchanged measured source caps; full retained depth, no rear slab. This can illustrate an incompletely loaded refinement state but does not establish what ran in the user browser.'\n(OUT/'validation.json').write_text")
code=code.replace("(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\\n')","(OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\\n')\nif len(selected)==1:(OUT/(selected[0]['id']+'-validation.json')).write_text(json.dumps(report,indent=2)+'\\n')")
code=code.replace("draw_elements(4,patch['indexCount'],0x1405,None)","\n            for patch_start in range(0,patch['indexCount'],300000):\n                draw_elements(4,min(300000,patch['indexCount']-patch_start),0x1405,C.c_void_p(patch_start*4));fn('glFinish',None,[])()")
if __name__ == '__main__':
 exec(compile(code,str(ROOT/'scripts/cleanup-v28/render_review.py'),'exec'))
