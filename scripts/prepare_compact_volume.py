"""Lossless display-volume compression using the existing reversible cleanup support.

Preserve all original display bytes within a conservative three-voxel halo of the
nearest-sampled cleanup support. Original parts remain available for Clean Scan off.
No tissue threshold, smoothing, quantization or resampling is added here.
"""
from pathlib import Path
import argparse, gzip, hashlib, json, time
import numpy as np
from scipy import ndimage as ndi

PROJECT=Path(__file__).resolve().parents[1]

def sha(data): return hashlib.sha256(data).hexdigest()
def predictor(data,kind):
    if kind=='none':return data
    out=data.copy()
    if kind=='delta-x':out[:,:,1:]=data[:,:,1:]-data[:,:,:-1]
    elif kind=='delta-z':out[1:]=data[1:]-data[:-1]
    else:raise ValueError(kind)
    return out

def prepare(project,write):
    assets=project/'public/assets';manifest=json.loads((assets/'manifest.json').read_text())
    cm=json.loads((assets/'cleanup/manifest.json').read_text())
    mask=np.frombuffer(gzip.decompress((project/'public'/cm['volumeUrl']).read_bytes()),np.uint8).reshape(cm['dimensions'][::-1])>0
    results={};changes={}
    for key,level in manifest['levels'].items():
        parts=level.get('originalParts',level['parts'])
        start=time.perf_counter()
        source=np.frombuffer(b''.join(gzip.decompress((project/'public'/p['url']).read_bytes()) for p in parts),np.uint8).reshape(level['dimensions'][::-1])
        indices=[np.floor(np.linspace(0,mask.shape[i]-1,source.shape[i])+.5).astype(int) for i in range(3)]
        support=mask[np.ix_(*indices)]
        # A mask cell extends halfway to its neighbors: dilation includes all
        # floor/ceil samples and the optional cubic-normal reconstruction halo.
        guard=ndi.binary_dilation(support,structure=np.ones((3,3,3),bool),iterations=3)
        compact=np.where(guard,source,0).astype(np.uint8)
        assert np.array_equal(compact[guard],source[guard])
        # Exact low/high byte preservation also holds around the mask boundary.
        variants={};encoded={}
        for kind in ['none','delta-x','delta-z']:
            t=time.perf_counter();payload=predictor(compact,kind);packed=gzip.compress(payload.tobytes(),compresslevel=6,mtime=0)
            restored=np.frombuffer(gzip.decompress(packed),np.uint8).reshape(compact.shape)
            if kind=='delta-x':restored=np.cumsum(restored,axis=2,dtype=np.uint8)
            elif kind=='delta-z':restored=np.cumsum(restored,axis=0,dtype=np.uint8)
            assert np.array_equal(restored,compact)
            variants[kind]={'bytes':len(packed),'encodeAndVerifySeconds':round(time.perf_counter()-t,3),'exactRoundTrip':True}
            encoded[kind]=packed
        chosen=min(variants,key=lambda k:variants[k]['bytes'])
        nonzero=np.nonzero(guard);bounds=[[int(axis.min()),int(axis.max())] for axis in nonzero][::-1]
        original_bytes=sum(p['bytes'] for p in parts)
        result={'dimensions':level['dimensions'],'originalCompressedBytes':original_bytes,'compactBytes':len(encoded[chosen]),'ratio':original_bytes/len(encoded[chosen]),'retainedVoxels':int(guard.sum()),'totalVoxels':int(source.size),'excludedFraction':float((~guard).mean()),'guardVoxels':3,'boundsXYZ':bounds,'variants':variants,'chosenPredictor':chosen,'maximumRetainedByteError':0,'elapsedSeconds':round(time.perf_counter()-start,2)}
        results[key]=result
        if write:
            output=assets/'volume-v5';output.mkdir(exist_ok=True)
            target=output/f'heart-{key}-clean.raw.gz';target.write_bytes(encoded[chosen])
            compact_part={'url':str(target.relative_to(project/'public')),'bytes':target.stat().st_size,'uncompressedBytes':int(compact.size),'zRange':[0,source.shape[0]],'sha256':sha(encoded[chosen]),'rawSha256':sha(compact.tobytes()),'predictor':chosen}
            level['originalParts']=parts;level['originalCompressedBytes']=original_bytes
            level['parts']=[compact_part];level['compressedBytes']=target.stat().st_size
            level['supportCompressed']=True
            level['supportCompression']={'method':'Existing cleanup support with conservative3-voxel interpolation halo; exterior values zeroed; reversible byte predictor plus gzip','guardVoxels':3,'maximumRetainedByteError':0,'originalRestoration':'Load originalParts when cleanup is disabled','boundsXYZ':bounds}
        print(json.dumps({'level':key,**result}),flush=True)
    report={'schemaVersion':1,'specimen':manifest['specimen'],'levels':results,'losslessClaim':'The encoded cleaned display derivative round-trips exactly; original bytes are preserved throughout the existing support plus interpolation halo. Values outside that support are omitted. Original uncleaned parts remain separately available.','sourceVoxelSamplingUnchanged':True,'originalDisplayWindowUnchanged':True,'additionalTissueQuantization':False}
    (project/'docs/volume-compression-v5.json').write_text(json.dumps(report,indent=2)+'\n')
    if write:
        manifest['previewLevel']='low';manifest['defaultLevel']='high'
        manifest['processingSummary']='Authentic whole-organ HiP-CT voxels from LADAF-2021-17, displayed at 317.6 µm or approximately 635 µm. Lossless compression preserves all display values inside the existing clean-scan support and its interpolation halo. Original uncleaned display data load on demand. Orthogonal Ultra cut faces use hosted lossless 79.4 µm textures. Regional anatomy colors are approximate annotations; scan axes are acquisition coordinates.'
        (assets/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--write',action='store_true');args=parser.parse_args();prepare(PROJECT,args.write)
