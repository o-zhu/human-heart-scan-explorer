#!/usr/bin/env python3
"""Compare source-grid image transports; never resample a cut-face pixel."""
from pathlib import Path
from io import BytesIO
import argparse, hashlib, json, math, time
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, sobel

ROOT=Path(__file__).resolve().parents[2]
CASES=[('x',190),('x',237),('x',312),('y',293),('y',315),('z',209),('z',265)]


def quality(original,decoded):
    a=original.astype(np.float32);b=decoded.astype(np.float32)
    diff=b-a; tissue=a>=72; edge=np.hypot(sobel(a,axis=0),sobel(a,axis=1))>180
    err2=diff*diff
    mu1=gaussian_filter(a,1.5);mu2=gaussian_filter(b,1.5)
    var1=gaussian_filter(a*a,1.5)-mu1*mu1;var2=gaussian_filter(b*b,1.5)-mu2*mu2
    cov=gaussian_filter(a*b,1.5)-mu1*mu2
    ssim=((2*mu1*mu2+6.5025)*(2*cov+58.5225))/((mu1*mu1+mu2*mu2+6.5025)*(var1+var2+58.5225))
    mse=float(err2.mean())
    return dict(maxAbsoluteError=int(np.abs(diff).max()),meanError=float(diff.mean()),rms=float(np.sqrt(mse)),
                psnrDb=float(10*math.log10(255**2/mse)) if mse else None,
                tissueRms=float(np.sqrt(err2[tissue].mean())),edgeRms=float(np.sqrt(err2[edge].mean())),
                structuralSimilarity=float(ssim.mean()),tissueStructuralSimilarity=float(ssim[tissue].mean()),
                sourceThreshold72ClassificationChanges=int(((a>=72)!=(b>=72)).sum()),
                zeroBackgroundChanged=int(((a==0)&(b!=0)).sum()),
                clippedWhiteChanged=int(((a==255)&(b!=255)).sum()))


def evaluate(out):
    out.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((ROOT/'public/assets/ultra-sections/manifest.json').read_text())
    results=[]
    candidates=[('webp-exact','WEBP',dict(lossless=True,quality=100,method=6),1),
                ('webp-quant2','WEBP',dict(lossless=True,quality=100,method=6),2),
                ('webp-quant4','WEBP',dict(lossless=True,quality=100,method=6),4),
                ('webp-q100','WEBP',dict(lossless=False,quality=100,method=6),1),
                ('webp-q95','WEBP',dict(lossless=False,quality=95,method=6),1),
                ('webp-q90','WEBP',dict(lossless=False,quality=90,method=6),1),
                ('avif-q95','AVIF',dict(quality=95,speed=6,max_threads=1,subsampling='4:0:0',range='full'),1),
                ('avif-q90','AVIF',dict(quality=90,speed=6,max_threads=1,subsampling='4:0:0',range='full'),1),
                ('avif-q85','AVIF',dict(quality=85,speed=6,max_threads=1,subsampling='4:0:0',range='full'),1)]
    for axis,index in CASES:
        record=manifest['slices'][axis][index];path=ROOT/'data/ultra-sections'/record['path']
        raw=path.read_bytes();assert len(raw)==record['bytes'];assert hashlib.sha256(raw).hexdigest()==record['sha256']
        a=np.array(Image.open(BytesIO(raw)).convert('L'))
        assert hashlib.sha256(a.tobytes()).hexdigest()==record['sourceDisplaySha256']
        assert list(a.shape[::-1])==record['crop'][2:]
        for name,fmt,opts,q in candidates:
            data=a if q==1 else np.where(a==255,255,(a//q)*q).astype(np.uint8)
            stream=BytesIO();start=time.perf_counter();Image.fromarray(data).save(stream,format=fmt,**opts);encode=time.perf_counter()-start
            encoded=stream.getvalue();start=time.perf_counter();b=np.array(Image.open(BytesIO(encoded)).convert('L'));decode=time.perf_counter()-start
            result=dict(axis=axis,index=index,candidate=name,originalBytes=len(raw),bytes=len(encoded),reductionPercent=100*(1-len(encoded)/len(raw)),
                        encodeSeconds=encode,decodeSeconds=decode,sourceSha256=record['sha256'],encodedSha256=hashlib.sha256(encoded).hexdigest(),metrics=quality(a,b))
            results.append(result)
            (out/f'{axis}-{index:04d}-{name}.{fmt.lower()}').write_bytes(encoded)
            print(json.dumps(result),flush=True)
    summaries=[]
    for name,*_ in candidates:
        subset=[r for r in results if r['candidate']==name]
        summaries.append(dict(candidate=name,bytes=sum(r['bytes'] for r in subset),originalBytes=sum(r['originalBytes'] for r in subset),
            reductionPercent=100*(1-sum(r['bytes'] for r in subset)/sum(r['originalBytes'] for r in subset)),
            maximumAbsoluteError=max(r['metrics']['maxAbsoluteError'] for r in subset),
            minimumSSIM=min(r['metrics']['structuralSimilarity'] for r in subset),
            meanDecodeMilliseconds=1000*sum(r['decodeSeconds'] for r in subset)/len(subset),
            sourceThresholdChanges=sum(r['metrics']['sourceThreshold72ClassificationChanges'] for r in subset),
            zeroBackgroundChanged=sum(r['metrics']['zeroBackgroundChanged'] for r in subset)))
    report=dict(schema='heart-cut-face-compression-pilot-v29',cases=results,summary=summaries,
                measured='Pillow/libavif/libwebp CPU codec timings only; not browser timings or clinical accuracy.',
                spatialResampling=False,sourceBytesModified=False)
    (ROOT/'docs/compression-v29/section-pilot.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(summaries,indent=2),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,default=Path('/workspace/data/heart-v29-compress/section-candidates'));a=p.parse_args();evaluate(a.out)
