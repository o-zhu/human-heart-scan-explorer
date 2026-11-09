#!/usr/bin/env python3
"""Space scientific comparison panels without altering their rendered pixels."""
from pathlib import Path
import hashlib
import json
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/fine-detail-v23';path=OUT/'hosted-comparison.png'
source=Image.open(path).convert('RGB')
assert source.size==(1940,1950),'Run only on the original validator contact sheet.'
source_hash=hashlib.sha256(path.read_bytes()).hexdigest()
report=json.loads((OUT/'hosted-comparison.json').read_text())
assets={asset['id']:asset for asset in report['assets']}
sheet=Image.new('RGB',(1940,2030),'#081116');draw=ImageDraw.Draw(sheet)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
draw.text((20,20),'Source-supported detail comparison · same ROI/camera within each row · delivered quantized meshes',font=font,fill='#e2ecea')
for row,region in enumerate(report['regions']):
    name=region['id'];y=75+row*640;old_y=75+row*610
    for column,identity in enumerate(['source','detail','gentle']):
        x=20+column*640
        # Uniformly omit the bottom four pixels of all nine viewports, where
        # the original row labels overlapped. No tissue pixels are synthesized.
        frame=source.crop((x,old_y+54,x+620,old_y+54+556))
        sheet.paste(frame,(x,y+54))
        title={'source':'measured source','detail':'Previous polished detail','gentle':'Gentle detailed'}[identity]
        draw.text((x,y),f'{name} · {title}',font=font,fill='#e2ecea')
        if identity=='source':subtitle='No additional filtering/simplification'
        else:
            result=next(value for value in assets[identity]['regions'] if value['id']==name)
            subtitle=f'Raw-surface p95 {result["rawSourceSurfaceToMesh"]["p95Mm"]*1000:.0f} µm'
        draw.text((x,y+27),subtitle,font=font,fill='#aac0bc')
draw.text((20,1995),'Scientific EGL renderings; no anatomical truth labels. More measured fine geometry includes residual noise.',font=font,fill='#aac0bc')
temporary=path.with_suffix('.png.partial');sheet.save(temporary,format='PNG');temporary.replace(path)
receipt=dict(schema='fine-detail-v23-comparison-layout',renderedGeometryPixelsChanged=False,
             uniformViewportCrop='Bottom four pixels omitted from all panels to separate labels; same620×556 viewport crop in all panels.',
             originalContactSheetSha256=source_hash,formattedContactSheetSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
             sourceComparisonJsonSha256=hashlib.sha256((OUT/'hosted-comparison.json').read_bytes()).hexdigest())
(OUT/'comparison-layout.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
