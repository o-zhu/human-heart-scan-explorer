#!/usr/bin/env python3
"""Prepare reversible, source-supported display fields for coronary exposure.

Original measured scalar banks and 2-D sections are immutable. This is a
regional visualization rule, not a coronary/fat segmentation or a HU map.
"""
from pathlib import Path
import gc, gzip, hashlib, json, subprocess, time
import numpy as np
from scipy import ndimage as ndi

ROOT=Path(__file__).resolve().parents[2]
PUBLIC=ROOT/'public/assets/coronary-v36'
DOCS=ROOT/'docs/coronary-v36/methods'
SOURCE_LEVELS={'ladaf-2021-17':.42,'s-20-29':.22,'s-20-28':.42}
MAX_PART=4*1024*1024
ISO=.5

def sha(a):return hashlib.sha256(a).hexdigest()
def read_json(path):return json.loads(path.read_text())
def public_path(url):return ROOT/'public'/url.removeprefix('./').split('?')[0]
def donors():
    text=subprocess.check_output(['node','--input-type=module','-e','import {DONORS} from "./public/donors.js";console.log(JSON.stringify(DONORS));'],cwd=ROOT,text=True)
    return [d for d in json.loads(text) if d['id'] in SOURCE_LEVELS]

def load_source(level):
    nx,ny,nz=level['dimensions'];volume=np.empty((nz,ny,nx),np.uint8)
    ranges=[]
    for part in level['parts']:
        encoded=public_path(part['url']).read_bytes()
        assert sha(encoded)==part['sha256']
        lo,hi=part['zRange'];ranges.append((lo,hi))
        raw=np.frombuffer(gzip.decompress(encoded),np.uint8).reshape(hi-lo,ny,nx).copy()
        axis={'delta-z':0,'delta-x':2}.get(part.get('predictor'))
        if axis is not None:np.cumsum(raw,axis=axis,dtype=np.uint8,out=raw)
        assert sha(raw)==part['rawSha256']
        volume[lo:hi]=raw
    assert sorted(ranges)[0][0]==0 and sorted(ranges)[-1][1]==nz
    assert all(a[1]==b[0] for a,b in zip(sorted(ranges),sorted(ranges)[1:]))
    return volume

def guide(source):
    """3-D self-guided local linear filter, radius1, range regularizer12²."""
    field=source.astype(np.float32)
    mean=ndi.uniform_filter(field,size=3,mode='nearest')
    variance=ndi.uniform_filter(field*field,size=3,mode='nearest')-mean*mean
    np.maximum(variance,0,out=variance)
    weight=variance/(variance+144.)
    bias=(1-weight)*mean
    result=ndi.uniform_filter(weight,size=3,mode='nearest')*field+ndi.uniform_filter(bias,size=3,mode='nearest')
    np.clip(result,field-6,field+6,out=result)
    return result

def protection(donor,shape):
    """Protect source-supported lower-threshold wall in approximate LA/RA regions."""
    path=public_path(donor['anatomyManifestUrl']);meta=read_json(path)
    encoded=public_path(meta['volumeUrl']).read_bytes()
    assert sha(encoded)==meta['compressedSha256']
    raw=gzip.decompress(encoded);assert sha(raw)==meta['sha256']
    labels=np.frombuffer(raw,np.uint8).reshape(meta['dimensions'][::-1])
    atrial=np.isin(labels,[3,4])
    distance=ndi.distance_transform_edt(~atrial,sampling=np.asarray(meta['labelGridSpacingUmXYZ'])[::-1]/1000)
    t=np.clip((distance-.5)/2.5,0,1)
    coarse=(1-t*t*(3-2*t)).astype(np.float32)
    result=ndi.zoom(coarse,np.asarray(shape)/np.asarray(coarse.shape),order=1,mode='nearest',prefilter=False)
    assert result.shape==shape
    return result,dict(manifestUrl=donor['anatomyManifestUrl'],manifestSha256=sha(path.read_bytes()),
                      labelsSha256=meta['sha256'],labelIds=[3,4],labelIdentity='Approximate source-guided LA/RA territories, not expert ground truth.',
                      fullProtectionDistanceMm=.5,zeroProtectionDistanceMm=3.,distance='Euclidean physical distance from existing atrial label cells.',
                      interpolation='Trilinear endpoint-registered label-to-scalar grid, without moving the source.')

def encode_field(source,base,high,weight):
    regular=guide(source)
    # Preserve the measured protected atrial samples exactly. The same smooth
    # weight fades regularization back in through the collar.
    regular=regular*(1-weight)+source*weight
    np.clip(regular,np.subtract(source,6,dtype=np.float32),np.add(source,6,dtype=np.float32),out=regular)
    threshold=(high-(high-base)*weight)*255
    # Encoded127.5 is the zero level. At sample centers, rounded encoded
    # values >=128 are exactly the nonnegative derived decisions.
    signed=regular-threshold
    field=np.clip(np.rint(signed+127.5),0,255).astype(np.uint8)
    selected=field>=128
    source_supported=source.astype(np.float32)>=threshold-6
    strong=source.astype(np.float32)>=threshold+6
    full_protection=weight>=1-1e-6
    atrial_baseline=(source>=base*255)&full_protection
    report=dict(maximumScalarChangeDisplayLevels=float(np.max(np.abs(regular-source))),
                selectedSamples=int(selected.sum()),sourceWeakSupportSamples=int(source_supported.sum()),
                selectedWithoutWeakSourceSupport=int(np.count_nonzero(selected&~source_supported)),
                strongSourceSamples=int(strong.sum()),lostStrongSourceSamples=int(np.count_nonzero(strong&~selected)),
                fullyProtectedBaselineAtrialSamples=int(atrial_baseline.sum()),
                fullyProtectedBaselineAtrialSamplesRetained=int(np.count_nonzero(atrial_baseline&selected)),
                currentOriginalBaselineForegroundSamples=int(np.count_nonzero(source>=base*255)),
                sourceIntensityFieldModified=False,derivedGridEqualsOriginal=True,
                encodingZeroLevel=127.5,renderThreshold=.5,quantizationMaximumErrorDisplayLevels=.5,
                selectedMeans='Derived isosurface foreground, not an anatomical label.')
    assert report['selectedWithoutWeakSourceSupport']==0
    assert report['lostStrongSourceSamples']==0
    assert report['fullyProtectedBaselineAtrialSamplesRetained']==report['fullyProtectedBaselineAtrialSamples']
    return field,report

def write_parts(donor_id,field):
    parts=[]
    def write(lo,hi):
        raw=np.ascontiguousarray(field[lo:hi]);pred=raw.copy()
        pred[1:]=np.diff(raw,axis=0)
        encoded=gzip.compress(pred,compresslevel=6,mtime=0)
        if len(encoded)>MAX_PART:
            assert hi-lo>1
            mid=(lo+hi)//2;write(lo,mid);write(mid,hi);return
        decoded=np.frombuffer(gzip.decompress(encoded),np.uint8).reshape(raw.shape).copy()
        np.cumsum(decoded,axis=0,dtype=np.uint8,out=decoded)
        assert np.array_equal(decoded,raw)
        name=f'{donor_id}-derived.raw.part-{len(parts):03d}.gz'
        (PUBLIC/name).write_bytes(encoded)
        parts.append(dict(url='./assets/coronary-v36/'+name,zRange=[lo,hi],compressedBytes=len(encoded),
                          uncompressedBytes=raw.nbytes,sha256=sha(encoded),rawSha256=sha(raw),predictor='delta-z'))
    for lo in range(0,len(field),64):write(lo,min(lo+64,len(field)))
    assert sum(p['uncompressedBytes'] for p in parts)==field.nbytes
    assert all(p['compressedBytes']<=MAX_PART for p in parts)
    return parts

def main():
    PUBLIC.mkdir(parents=True,exist_ok=True);DOCS.mkdir(parents=True,exist_ok=True)
    manifest=dict(schemaVersion=1,kind='coronary-reveal',title='Coronary Exposure Display Fields',donors={})
    reports=[]
    for donor in donors():
        started=time.monotonic();source_meta=read_json(public_path(donor['manifestUrl']));level=source_meta['levels']['high']
        source=load_source(level);source_hash=sha(source)
        weight,annotation=protection(donor,source.shape)
        base=source_meta['defaultThreshold'];high=SOURCE_LEVELS[donor['id']]
        field,report=encode_field(source,base,high,weight)
        del weight;gc.collect()
        parts=write_parts(donor['id'],field)
        size=(np.asarray(level['dimensions'])-1)*np.asarray(level['spacingUm'])
        processing=dict(method='3-D guided scalar regularization with bounded source changes and soft regional threshold protection.',
                        scalarFilter=dict(type='Self-guided local linear',boxRadiusSamples=1,epsilonDisplayLevelsSquared=144.,border='Nearest',
                                          maximumAbsoluteChangeDisplayLevels=6.,passes='Local statistics followed by local coefficient averaging.'),
                        sourceThresholdBaseline=base,sourceThresholdReveal=high,atrialProtection=annotation,
                        protectedAtrialSamples='Regularization blends to exact original intensity where the atrial protection weight equals1; source foreground at the original baseline threshold is retained exactly.',
                        scalarEncoding='round(clamp(guidedSource - 255*(revealThreshold-(revealThreshold-baselineThreshold)*atrialWeight) + 127.5,0,255))',
                        threshold=.5,originalScalarSourcesChanged=False,ctSectionsChanged=False,
                        strongSourceGuarantee='No sample >=6 display levels above its local threshold is removed.',
                        weakSourceGuarantee='No displayed foreground sample is more than6 display levels below its local source threshold.',
                        materialIdentity='Intensity exposure only. Fat and coronary arteries are not separately segmented; values are not calibrated HU.',
                        limitations=['Regional annotations are approximate and preserve measured low-intensity atrial covering as well as wall.',
                                     'Conservative regularization reduces display roughness but cannot guarantee every branch or eliminate acquisition artifacts.',
                                     'These fields retain the resident source sampling grid; they do not add acquired spatial resolution.',
                                     'No free-space gap bridging, convex filling, synthetic artery generation, or topology completion.'])
        entry=dict(donorId=donor['id'],dimensions=level['dimensions'],spacingUm=level['spacingUm'],sourceSpacingUm=level['spacingUm'],
                   extent=(size[[0,2,1]]/max(size)).tolist(),threshold=.5,sourceWindow=source_meta.get('sourceWindow'),
                   sourceManifestUrl=donor['manifestUrl'],sourceManifestSha256=sha(public_path(donor['manifestUrl']).read_bytes()),
                   sourceRawSha256=source_hash,processing=processing,parts=parts,
                   compressedBytes=sum(p['compressedBytes'] for p in parts),uncompressedBytes=field.nbytes,rawSha256=sha(field))
        manifest['donors'][donor['id']]=entry
        report.update(donorId=donor['id'],sourceRawSha256=source_hash,sourceUnchanged=sha(source)==source_hash,
                      derivedRawSha256=sha(field),sourceThresholdBaseline=base,sourceThresholdReveal=high,
                      grid=level['dimensions'],sourceSpacingUm=level['spacingUm'],buildSeconds=time.monotonic()-started,
                      gzipParts=len(parts),compressedBytes=entry['compressedBytes'],allPartsRoundTripExact=True)
        reports.append(report);print(json.dumps(report),flush=True)
        del source,field;gc.collect()
    (PUBLIC/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (DOCS/'prepared-field-validation.json').write_text(json.dumps(dict(passed=True,donors=reports),indent=2)+'\n')

if __name__=='__main__':main()
