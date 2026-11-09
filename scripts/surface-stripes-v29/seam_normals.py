#!/usr/bin/env python3
"""Compare seam-local normal diffusion on unchanged indexed source geometry."""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
from pathlib import Path
import argparse, hashlib, json, time
import numpy as np

ROOT = Path(__file__).resolve().parents[2]

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4*1024**2), b''): h.update(block)
    return h.hexdigest()

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', type=Path, default=Path('/workspace/data/heart-v29-compress/original.hfm'))
    p.add_argument('--out', type=Path, default=Path('/workspace/data/heart-v29-stripes'))
    p.add_argument('--iterations', type=int, default=6)
    args = p.parse_args()
    manifest = json.loads((ROOT/'public/assets/fine-surface-v23/manifest.json').read_text())
    assert digest(args.input) == manifest['lods'][0]['decodedSha256']
    raw = np.memmap(args.input, dtype='u1', mode='r')
    h = np.frombuffer(raw, '<u4', 8); nv, ni = map(int, h[2:4])
    q = np.ndarray((nv,3), '<u2', buffer=raw, offset=int(h[4]))
    old = np.ndarray((nv,3), '<i2', buffer=raw, offset=int(h[5]))
    faces = np.ndarray((ni//3,3), '<u4', buffer=raw, offset=int(h[6]))
    scale = np.asarray(manifest['extent'], np.float32)/65535
    angle = np.load(args.out/'angle-normals.npy', mmap_mode='r')
    fine_z = q[:,1].astype(np.float32)/65535*2116
    distance = np.abs((fine_z-59+32)%64-32)
    # Every slab seam receives the same bounded treatment. The raised cosine
    # avoids a new hard shading transition. Points and triangle connectivity
    # remain byte-identical; the CT-derived section textures are not involved.
    blend = (0.5+0.5*np.cos(np.pi*np.minimum(distance/8,1))).astype(np.float32)
    active = distance < 16
    field = angle.astype(np.float32)/32767
    field /= np.maximum(np.linalg.norm(field,axis=1)[:,None],1e-12)
    original = old.astype(np.float32)/32767
    total = np.zeros((nv,3),np.float32); mass = np.zeros(nv,np.float32)
    start = time.monotonic(); reports = []
    for iteration in range(1,args.iterations+1):
        total.fill(0); mass.fill(0)
        for first in range(0,len(faces),100_000):
            f = faces[first:first+100_000]
            f = f[np.any(active[f],axis=1)]
            if not len(f): continue
            v = q[f].astype(np.float32)*scale
            area = np.linalg.norm(np.cross(v[:,1]-v[:,0],v[:,2]-v[:,0]),axis=1)
            n = field[f]
            for a,b in [(0,1),(1,2),(2,0)]:
                agreement = np.einsum('ij,ij->i',n[:,a],n[:,b])
                # Avoid mixing the opposing sides of folds and thin leaflets.
                w = area*np.clip((agreement+0.05)/0.75,0,1)
                np.add.at(total,f[:,a],n[:,b]*w[:,None]); np.add.at(mass,f[:,a],w)
                np.add.at(total,f[:,b],n[:,a]*w[:,None]); np.add.at(mass,f[:,b],w)
        for first in range(0,nv,200_000):
            sl = slice(first,min(first+200_000,nv))
            mean = total[sl]/np.maximum(mass[sl,None],1e-25)
            normal = field[sl]*0.25+mean*0.75
            norm = np.linalg.norm(normal,axis=1)
            good = active[sl] & (mass[sl]>0) & (norm>1e-8)
            field[sl][good] = normal[good]/norm[good,None]
        if iteration in [2,4,6]:
            name = f'seam{iteration}'
            out = np.lib.format.open_memmap(args.out/(name+'-normals.npy'),mode='w+',dtype='<i2',shape=(nv,3))
            changed=0
            for first in range(0,nv,200_000):
                sl = slice(first,min(first+200_000,nv))
                n = original[sl]*(1-blend[sl,None])+field[sl]*blend[sl,None]
                n /= np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-20)
                quant = np.rint(np.clip(n,-1,1)*32767).astype('<i2')
                quant[blend[sl]==0] = old[sl][blend[sl]==0]
                out[sl] = quant
                changed += int(np.any(quant != old[sl],axis=1).sum())
            out.flush()
            reports.append({'name':name,'sha256':digest(args.out/(name+'-normals.npy')),'changedNormals':changed,'outside8SamplesUnchanged':True})
        print(json.dumps({'iteration':iteration,'seconds':round(time.monotonic()-start,2)}),flush=True)
    report = {'sourceGeometrySha256':manifest['lods'][0]['decodedSha256'],'positionsExact':True,'triangleOrderExact':True,'sourceScalarDataExact':True,'seamPlanes':'fine Z=59+64*k','shadingBlendHalfWidthMm':8*0.0794,'method':'Area-weighted bilateral adjacency diffusion on source topology with angle-weighted initial normals and raised-cosine seam-only blend. No point movement.','candidates':reports}
    (args.out/'seam-normal-candidates.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)

if __name__=='__main__': main()
