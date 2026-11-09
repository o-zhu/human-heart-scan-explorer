#!/usr/bin/env python3
"""Exercise the actual v23 encoder on one small measured-slab fixture.

Readiness/provenance preflight is replaced only inside this isolated unit-test
fixture, because a single slab is intentionally not a whole-heart release.
Every emitted byte is independently checked; no fixture enters public assets.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import shutil
import struct
import sys
import tempfile
from unittest.mock import patch

import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
import finish


def oriented_keys(quantized,faces):
    keys=quantized[:,0].astype(np.uint64)|(quantized[:,1].astype(np.uint64)<<16)|(quantized[:,2].astype(np.uint64)<<32)
    face_keys=keys[faces]
    start=face_keys.argmin(axis=1)
    canonical=np.take_along_axis(face_keys,(start[:,None]+np.arange(3))%3,axis=1)
    return np.sort(np.ascontiguousarray(canonical).view([('a','<u8'),('b','<u8'),('c','<u8')]).ravel())


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--work',type=Path,required=True);args=parser.parse_args()
    measured=args.work/'slabs/0000-0064.npz';source=np.load(measured);points=source['points'];faces=source['faces'];source.close()
    meta=json.loads((args.work/'source-ready.json').read_text());config=json.loads((args.work/'configuration.json').read_text())
    source_receipt=json.loads(measured.with_suffix('.json').read_text())
    # Include a collinear float triangle that rounds into a noncollinear integer
    # triangle. It must not become an invented visible face or zero-normal fan.
    grid=np.asarray(meta['extent'])*meta['longestMm']/65535
    midpoint=np.array([.6*grid[0],0,1.4*grid[1]],np.float32)
    extra=np.array([np.zeros(3,np.float32),midpoint,2*midpoint],np.float32)
    faces=np.concatenate([faces,np.array([[len(points),len(points)+1,len(points)+2]],np.uint32)])
    points=np.concatenate([points,extra])
    with tempfile.TemporaryDirectory(prefix='fine23-encoding-check-') as directory:
        testroot=Path(directory);work=testroot/'work';work.mkdir();assets=testroot/'public/assets/fine-surface-v23';assets.mkdir(parents=True)
        np.savez(work/'welded-reference.npz',points=points,faces=faces)
        (work/'source-ready.json').write_text(json.dumps(meta));(work/'configuration.json').write_text(json.dumps(config))
        (work/'extraction.json').write_text(json.dumps(dict(referenceTriangles=source_receipt['referenceTriangles'])))
        (work/'weld.json').write_text(json.dumps(dict(triangles=len(faces),weldToleranceMm=.0001,maximumWeldDisplacementMm=0.)))
        shutil.copyfile(ROOT/'public/assets/manifest.json',testroot/'public/assets/manifest.json')
        with patch.object(finish,'ROOT',testroot),patch.object(finish,'PART_BYTES',16*1024),patch.object(finish,'preflight',return_value={'fullProcessingFingerprint':'isolated-encoder-fixture'}):
            manifest=finish.encode(work,assets)
        lod=manifest['lods'][0];encoded=(work/'gentle.hfm.gz').read_bytes()
        parts=[]
        for part in lod['parts']:
            data=(testroot/'public'/part['url'].removeprefix('./')).read_bytes()
            assert len(data)==part['compressedBytes'] and hashlib.sha256(data).hexdigest()==part['sha256']
            parts.append(data)
        assert b''.join(parts)==encoded and hashlib.sha256(encoded).hexdigest()==lod['sha256']
        assert len(parts)>1,'Fixture should exercise multiple transport boundaries.'
        raw=gzip.decompress(encoded);assert len(raw)==lod['decodedBytes'] and hashlib.sha256(raw).hexdigest()==lod['decodedSha256']
        magic,version,nv,ni,po,no,io,res=struct.unpack_from('<8I',raw)
        assert (magic,version,po,res)==(0x314d4648,1,32,0) and ni%3==0
        assert no%4==io%4==0 and no>=po+nv*6 and io>=no+nv*6 and io+ni*4==len(raw)
        q=np.frombuffer(raw,'<u2',nv*3,po).reshape(nv,3)
        n=np.frombuffer(raw,'<i2',nv*3,no).reshape(nv,3).astype(np.float64)/32767
        f=np.frombuffer(raw,'<u4',ni,io).reshape(-1,3)
        assert f.max()<nv and np.isfinite(n).all() and np.max(np.abs(np.linalg.norm(n,axis=1)-1))<.00008
        extent=np.asarray(meta['extent']);world=points[:,[0,2,1]].astype(np.float64)*np.array([1,1,-1])/meta['longestMm']
        original_q=np.rint((world+extent/2)/extent*65535).astype('<u2')
        cross=np.cross(original_q[faces[:,1]].astype(np.int64)-original_q[faces[:,0]],original_q[faces[:,2]].astype(np.int64)-original_q[faces[:,0]])
        real_nonzero=np.linalg.norm(np.cross(points[faces[:,1]]-points[faces[:,0]],points[faces[:,2]]-points[faces[:,0]]),axis=1)>1e-12
        quant_nonzero=np.any(cross!=0,axis=1);nonzero=real_nonzero&quant_nonzero
        assert not real_nonzero[-1] and quant_nonzero[-1],'Pathological fixture did not exercise float-only degeneracy.'
        assert np.array_equal(oriented_keys(original_q,faces[nonzero]),oriented_keys(q,f)),'Encoding changed oriented quantized triangles.'
        assert int((~real_nonzero).sum())==lod['removedZeroAreaTriangles']
        assert int((real_nonzero&~quant_nonzero).sum())==lod['quantizationCollapsedTriangles']
        result=dict(schema='fine-detail-v23-encoding-check',passed=True,input='Measured initial64-cell slab; isolated fixture, not release.',
                    inputSha256=hashlib.sha256(measured.read_bytes()).hexdigest(),triangles=len(f),vertices=len(q),
                    multipartPieces=len(parts),fixturePartLimitBytes=16*1024,compressedBytes=len(encoded),decodedBytes=len(raw),
                    orientedQuantizedTriangleMultisetPreserved=True,normalLengthsVerified=True,allHashesVerified=True,
                    collinearFloatTriangleThatQuantizesNoncollinearlyRejected=True)
    out=ROOT/'docs/fine-detail-v23/encoding-check.json';out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))

if __name__=='__main__':main()
