#!/usr/bin/env python3
"""Measured-source coronary reveal experiments; no original source edits.

Uses the production GLSL and hash-verified source loader from the existing
native EGL harness. Images show intensity isosurfaces, not artery labels.
"""
from pathlib import Path
import argparse, gc, hashlib, json, sys, time
import numpy as np
from scipy import ndimage as ndi
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--donor', default='ladaf-2021-17')
parser.add_argument('--thresholds', default='.28,.32,.36,.40,.44,.48')
parser.add_argument('--methods', default='raw')
parser.add_argument('--protect-labels', default='3,4')
parser.add_argument('--collar-mm', type=float, default=3)
parser.add_argument('--size', type=int, default=960)
parser.add_argument('--output', type=Path, default=ROOT/'docs/coronary-v36/methods')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

fixture = ROOT/'tests/reconstruction-detail-v35-native.py'
setup = fixture.read_text().split('\nchecks=[];source_checks=[]')[0]
setup = setup.replace('2400, 1600, 1500, 1000', f'{args.size}, {args.size}, 300, 300')
namespace = dict(__file__=str(fixture), __name__='__experiment__')
sys.argv = [str(fixture), '--output', str(args.output)]
exec(compile(setup, str(fixture), 'exec'), namespace)
donor = next(d for d in namespace['donors'] if d['id']==args.donor)
read_json, public_path = namespace['read_json'], namespace['public_path']
manifest = read_json(public_path(donor['manifestUrl']))
level = manifest['levels']['high']
original = namespace['load_volume'](level)
source_hash = hashlib.sha256(original).hexdigest()
cleanup = read_json(public_path(donor['cleanupManifestUrl']))
packed_mask = public_path(cleanup['volumeUrl']).read_bytes()
mask = np.frombuffer(namespace['gzip'].decompress(packed_mask),np.uint8).reshape(*cleanup['dimensions'][::-1]).copy()
namespace['texture'](2,mask)
namespace['current_donor'] = donor['id']
world = dict(normal=[0,0,1],right=[1,0,0],up=[0,1,0],center=[0,0,0],width=1,height=1)
thresholds = [float(t) for t in args.thresholds.split(',')]
methods = args.methods.split(',')
images = []
checks = []
protection = None

def protection_weight():
    global protection
    if protection is not None:return protection
    meta=read_json(public_path(donor['anatomyManifestUrl']))
    packed=public_path(meta['volumeUrl']).read_bytes()
    assert hashlib.sha256(packed).hexdigest()==meta['compressedSha256']
    raw=namespace['gzip'].decompress(packed)
    assert hashlib.sha256(raw).hexdigest()==meta['sha256']
    labels=np.frombuffer(raw,np.uint8).reshape(meta['dimensions'][::-1])
    chosen=np.isin(labels,[int(i) for i in args.protect_labels.split(',')])
    distance=ndi.distance_transform_edt(~chosen,sampling=np.asarray(meta['labelGridSpacingUmXYZ'])[::-1]/1000)
    t=np.clip((distance-.5)/(args.collar_mm-.5),0,1)
    coarse=(1-t*t*(3-2*t)).astype(np.float32)
    protection=ndi.zoom(coarse,np.asarray(original.shape)/np.asarray(coarse.shape),order=1,mode='nearest',prefilter=False)
    assert protection.shape==original.shape
    return protection

def filtered(method):
    if method.startswith('protect-'):return filtered(method.removeprefix('protect-'))
    if method=='raw': return original
    if method.startswith('gauss'):
        sigma=float(method.removeprefix('gauss'))
        return np.clip(np.rint(ndi.gaussian_filter(original.astype(np.float32),sigma,mode='nearest')),0,255).astype(np.uint8)
    if method.startswith('tv'):
        sys.path.insert(0,str(ROOT/'scripts/guided-native-v21'))
        from tv_kernel import denoise_tv_chambolle
        result=denoise_tv_chambolle(original.astype(np.float32),weight=float(method[2:]),max_num_iter=12)
        return np.clip(np.rint(result),0,255).astype(np.uint8)
    if method.startswith('guided'):
        epsilon=float(method.removeprefix('guided'))**2
        field=original.astype(np.float32)
        mean=ndi.uniform_filter(field,size=3,mode='nearest')
        variance=ndi.uniform_filter(field*field,size=3,mode='nearest')-mean*mean
        np.maximum(variance,0,out=variance)
        weight=variance/(variance+epsilon)
        bias=(1-weight)*mean
        result=ndi.uniform_filter(weight,size=3,mode='nearest')*field+ndi.uniform_filter(bias,size=3,mode='nearest')
        return np.clip(np.rint(result),0,255).astype(np.uint8)
    raise ValueError(method)

font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
for method in methods:
    began=time.monotonic();field=filtered(method)
    method_seconds=time.monotonic()-began
    for threshold in thresholds:
        rendering_field=field
        if method.startswith('protect-'):
            # Integer level difference preserves all original sample decisions
            # at fully protected labels; the transition is physical and soft.
            delta=np.ceil(threshold*255)-np.ceil(manifest['defaultThreshold']*255)
            rendering_field=np.clip(np.rint(field.astype(np.float32)+protection_weight()*delta),0,255).astype(np.uint8)
        namespace['texture'](0,rendering_field,True)
        common=[level,cleanup,world,donor['displayWindow'],threshold,(1,1)]
        began=time.monotonic()
        image=namespace['draw'](namespace['programs']['volume'],namespace['full'],*common,clipped=False,ready=0)
        elapsed=time.monotonic()-began
        name=f'{donor["id"]}-{method}-{threshold:.3f}'
        Image.fromarray(image[:,:,:3]).save(args.output/(name+'.png'))
        thumb=Image.fromarray(image[:,:,:3]).resize((360,360))
        card=Image.new('RGB',(360,394),'#0b1317');card.paste(thumb,(0,34))
        ImageDraw.Draw(card).text((10,9),f'{method} · Threshold {threshold:.3f}',font=font,fill='#eeeede')
        images.append(card)
        selected=rendering_field>=threshold*255
        item=dict(donor=donor['id'],method=method,threshold=threshold,grid=level['dimensions'],spacingUm=level['spacingUm'],
                  foregroundSamples=int(selected.sum()),fieldSha256=hashlib.sha256(rendering_field).hexdigest(),
                  sourceSha256=source_hash,sourceUnchanged=hashlib.sha256(original).hexdigest()==source_hash,
                  scalarProcessingSeconds=method_seconds,nativeRenderSeconds=elapsed,file=name+'.png')
        checks.append(item);print(json.dumps(item),flush=True)
        del selected,image,rendering_field
    if field is not original:del field
    gc.collect()

cols=min(3,len(images));rows=(len(images)+cols-1)//cols
sheet=Image.new('RGB',(cols*360,rows*394),'#0b1317')
for index,image in enumerate(images):sheet.paste(image,((index%cols)*360,(index//cols)*394))
sheet.save(args.output/(donor['id']+'-'+ '-'.join(methods)+'-comparison.jpg'),quality=95)
report=dict(donor=donor['id'],sourceWindow=manifest.get('sourceWindow'),camera=namespace['camera'],
            sourceHash=source_hash,sourceCalibration='Windowed uint8 HiP-CT display intensities; not calibrated HU.',
            checks=checks,scope='Native EGL production GLSL. Image comparison is not anatomical segmentation accuracy or clinical validation. Original sources remain immutable.')
(args.output/(donor['id']+'-'+ '-'.join(methods)+'-report.json')).write_text(json.dumps(report,indent=2)+'\n')
