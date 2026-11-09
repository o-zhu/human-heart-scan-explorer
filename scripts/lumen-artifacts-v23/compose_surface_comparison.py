#!/usr/bin/env python3
"""Compose existing matched-camera originals; no rendering or mesh loading.

--prepare records the old image/camera provenance and the audited unchanged
shader off-path before the final asset exists. The default composition later
requires the gentle render report to match those settings and both cut faces.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/lumen-artifacts-v23'
RECEIPT=BASE/'surface-comparison-baseline.json'


def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024**2),b''):h.update(chunk)
    return h.hexdigest()


def hashed_json(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def read(path):return json.loads(path.read_text())


def prepare():
    legacy=read(BASE/'production-mask-render-validation.json')
    # Exact reverse of the later CPU-picker retention change reconstructs the
    # module hash recorded at the original render. Thus its GLSL is unchanged.
    renderer=(ROOT/'public/renderer.js').read_text()
    later='  // Keep the small masks for matching CPU anatomy picking; source arrays remain untouched.\n  this.lumenCleanup=collection;'
    earlier='  // Retain only geometry metadata after transfer; the source/mask arrays are untouched.\n  this.lumenCleanup={...collection,masks:collection.masks.map(({data,...metadata})=>metadata)};'
    reconstructed=renderer.replace(later,earlier)
    renderer_exact=hashlib.sha256(reconstructed.encode()).hexdigest()==legacy['rendererShaderSha256']
    assert renderer_exact,'Review source changes before reusing existing originals.'
    fine=(ROOT/'public/fine-surface.js').read_text().split('/** A compact static isosurface;')[0]
    prior=subprocess.check_output(['git','show','e7e9f35ea838d950acc9db6e47ab2325961cc905:public/fine-surface.js'],cwd=ROOT,text=True).split('/** A compact static isosurface;')[0]
    # Only an inactive cleanup branch differs in the original-view shaders;
    # the changing version-selector/transport UI is outside these declarations.
    normalized=fine.replace("import {LumenCleanupController} from './lumen-cleanup-v23.js';\n",'').replace(' if(lumenExcluded(meshPosition)>.5)discard;\n','')
    assert normalized==prior
    script='import {volumeShaderSources as volume} from "./public/renderer.js";import {fineSurfaceShaderSources as fine} from "./public/fine-surface.js";import {DONORS} from "./public/donors.js";console.log(JSON.stringify({volume,fine,displayWindow:DONORS.find(d=>d.id==="ladaf-2021-17").displayWindow}));'
    shaders=json.loads(subprocess.check_output(['node','--input-type=module','-e',script],cwd=ROOT,text=True))
    images=[]
    for case in ['atrial','outflow']:
        path=BASE/(case+'-detail-review.png');geometry=read(BASE/(case+'-geometry-review.json'))
        check=next(c for c in legacy['checks'] if c['case']==case and c['lod']=='detail')
        with Image.open(path) as im:size=list(im.size)
        assert size==[720,840]
        images.append(dict(case=case,path=str(path.relative_to(ROOT)),sha256=sha(path),size=size,world=geometry['world'],plane=geometry['case'],sourceCapSha256=check['sourceCapSha256']))
    receipt=dict(status='prepared; final gentle images awaited',legacyReportSha256=sha(BASE/'production-mask-render-validation.json'),
                 shaderAudit=dict(legacyRendererModuleRecoveredExactly=True,fineOriginalViewDeclarationsMatchV19ExceptDisabledCleanupBranch=True,review='Subsequent CPU-picker retention and surface-controller/transport changes do not alter the image shaders.'),
                 exportedGlslSha256=dict(volume=hashed_json(shaders['volume']),fine=hashed_json(shaders['fine'])),
                 renderParameters=dict(outputPixels=[720,840],fov=.32,palette=4,surfaceSmoothing=1,threshold=.28,displayWindow=shaders['displayWindow']),
                 sourceManifestSha256=legacy['source']['sourceManifestSha256'],images=images,
                 caption='Nearby reproducible screenshot-plane camera; no anatomical ground-truth claim. Both original views have candidate exclusion OFF.')
    RECEIPT.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(dict(prepared=True,images=len(images),rendered=False,meshLoaded=False,receipt=str(RECEIPT.relative_to(ROOT)))),flush=True)


def compose(gentle):
    baseline=read(RECEIPT);report=read(gentle/'production-mask-render-validation.json')
    assert report['passed'] and report['exportedGlslSha256']==baseline['exportedGlslSha256']
    assert report['renderParameters']==baseline['renderParameters']
    assert report['source']['sourceManifestSha256']==baseline['sourceManifestSha256']
    width,height=baseline['renderParameters']['outputPixels'];header,row_label,footer=96,38,64
    sheet=Image.new('RGB',(width*2,header+2*(height+row_label)+footer),'#0b1317')
    draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',24)
    small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
    draw.text((16,12),'Surface detail comparison · candidate exclusion OFF',font=font,fill='#f0ece1')
    draw.text((16,54),'Earlier polished detail · 79.4 µm source',font=small,fill='#adbbb8')
    draw.text((width+16,54),'New gentle detail · 79.4 µm source',font=small,fill='#adbbb8')
    checks=[]
    for row,old in enumerate(baseline['images']):
        case=old['case'];old_path=ROOT/old['path'];new_path=gentle/(case+'-gentle-review.png')
        assert sha(old_path)==old['sha256']
        geometry=read(gentle/(case+'-geometry-review.json'))
        assert geometry['world']==old['world'] and geometry['case']==old['plane']
        check=next(c for c in report['checks'] if c['case']==case and c['lod']=='gentle')
        assert check['sourceCapSha256']==old['sourceCapSha256'] and check['offOnOffRestoresExactly']
        y=header+row*(height+row_label)
        title='Atrial screenshot plane · Y297/475' if case=='atrial' else 'Outflow screenshot plane · X246/475'
        draw.text((16,y+7),title,font=small,fill='#f0ece1')
        for column,path in enumerate([old_path,new_path]):
            with Image.open(path) as im:
                assert list(im.size)==old['size'];sheet.paste(im.convert('RGB'),(column*width,y+row_label))
        checks.append(dict(case=case,oldImageSha256=old['sha256'],gentleImageSha256=sha(new_path),cameraExactlyMatched=True,sourceCapExactlyMatched=True,settingsAndGlslMatched=True,cleanupOffBoth=True))
    y=sheet.height-footer
    draw.text((16,y+9),'Nearby reproducible screenshot-plane camera; no anatomical ground-truth claim.',font=small,fill='#adbbb8')
    draw.text((16,y+33),'Same camera, measured cut face, threshold and shading. Only the reconstructed surface differs.',font=small,fill='#adbbb8')
    output=gentle/'polished-vs-gentle-matched-camera.jpg';sheet.save(output,quality=95)
    record=dict(passed=True,figure=str(output.relative_to(ROOT)),sha256=sha(output),checks=checks,extraRenderPerformed=False,
                caption=baseline['caption'],note='Existing originals were pasted without resizing, recoloring, or retouching; comparison presents reconstructed surfaces, not validated anatomical truth.')
    (gentle/'polished-vs-gentle-matched-camera.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps(record),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--prepare',action='store_true')
    p.add_argument('--gentle',type=Path,default=BASE/'gentle')
    args=p.parse_args()
    if args.prepare:prepare()
    else:compose(args.gentle)
