#!/usr/bin/env python3
"""Measure topology-preserving transport candidates against the frozen HFM."""
from pathlib import Path
import argparse, hashlib, json, struct, time, zlib
import numpy as np

ROOT = Path(__file__).resolve().parents[2]


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def decode_original(target):
    m = json.loads((ROOT / 'public/assets/fine-surface-v23/manifest.json').read_text())
    lod = m['lods'][0]
    if target.is_file() and target.stat().st_size == lod['decodedBytes'] and sha(target) == lod['decodedSha256']:
        return m, lod
    target.parent.mkdir(parents=True, exist_ok=True)
    d = zlib.decompressobj(31)
    compressed_hash = hashlib.sha256()
    with target.with_suffix('.partial').open('wb') as out:
        for p in lod['parts']:
            path = ROOT / 'public' / p['url'].removeprefix('./')
            assert path.stat().st_size == p['compressedBytes']
            assert sha(path) == p['sha256'], path
            with path.open('rb') as f:
                for b in iter(lambda: f.read(1024 * 1024), b''):
                    compressed_hash.update(b)
                    out.write(d.decompress(b))
        out.write(d.flush())
    assert d.eof and not d.unused_data
    assert compressed_hash.hexdigest() == lod['sha256']
    assert target.with_suffix('.partial').stat().st_size == lod['decodedBytes']
    assert sha(target.with_suffix('.partial')) == lod['decodedSha256']
    target.with_suffix('.partial').replace(target)
    return m, lod


def gzip_size(array):
    c = zlib.compressobj(6, zlib.DEFLATED, 31)
    b = array.tobytes()
    start = time.perf_counter()
    enc = c.compress(b) + c.flush()
    elapsed = time.perf_counter() - start
    return dict(bytes=len(enc), ratio=len(enc) / len(b), encodeSeconds=elapsed)


def shuffle(a):
    return a.reshape(-1).view(np.uint8).reshape(-1, a.dtype.itemsize).T.copy()


def pilot(target, full=False):
    m, lod = decode_original(target)
    a = np.memmap(target, dtype=np.uint8, mode='r')
    magic, version, nv, ni, po, no, io, reserved = struct.unpack('<8I', a[:32])
    assert magic == 0x314d4648 and version == 1
    positions = np.ndarray((nv, 3), dtype='<u2', buffer=a, offset=po)
    normals = np.ndarray((nv, 3), dtype='<i2', buffer=a, offset=no)
    faces = np.ndarray((ni // 3, 3), dtype='<u4', buffer=a, offset=io)
    def sample(x):
        if full:
            return x
        n = min(len(x), 150000)
        starts = [0, (len(x)-n)//2, len(x)-n]
        return np.concatenate([x[s:s+n] for s in starts])
    p, n, f = sample(positions), sample(normals), sample(faces)
    methods = {}
    methods['positions_raw'] = gzip_size(p)
    methods['positions_shuffle'] = gzip_size(shuffle(p))
    pd = np.empty_like(p); pd[0] = p[0]; pd[1:] = p[1:] - p[:-1]
    methods['positions_delta_shuffle'] = gzip_size(shuffle(pd))
    methods['positions_delta_component_shuffle'] = gzip_size(shuffle(pd.T.copy()))
    methods['normals_raw'] = gzip_size(n)
    for bits in [16, 12, 11, 10, 9, 8]:
        scale = (2**(bits-1)-1) / 32767
        nq = np.rint(n.astype(np.float32)*scale).astype('<i2')
        nd = np.empty_like(nq); nd[0] = nq[0]; nd[1:] = nq[1:] - nq[:-1]
        methods[f'normals_q{bits}_delta_shuffle'] = gzip_size(shuffle(nd))
        methods[f'normals_q{bits}_shuffle'] = gzip_size(shuffle(nq))
        if bits != 16:
            orig = n.astype(np.float64); restored = nq.astype(np.float64)
            orig /= np.maximum(1e-20, np.linalg.norm(orig, axis=1))[:, None]
            restored /= np.maximum(1e-20, np.linalg.norm(restored, axis=1))[:, None]
            angle = np.rad2deg(np.arccos(np.clip(np.sum(orig * restored, axis=1), -1, 1)))
            methods[f'normals_q{bits}_shuffle']['angularErrorDegrees'] = dict(max=float(angle.max()), rms=float(np.sqrt(np.mean(angle**2))), p99=float(np.quantile(angle, .99)))
    methods['indices_raw'] = gzip_size(f)
    methods['indices_shuffle'] = gzip_size(shuffle(f))
    fd = np.empty_like(f); fd[0,0] = f[0,0]; fd[1:,0] = f[1:,0] - f[:-1,0]
    fd[:,1] = f[:,1] - f[:,0]; fd[:,2] = f[:,2] - f[:,0]
    methods['indices_face_delta_shuffle'] = gzip_size(shuffle(fd))
    methods['indices_face_delta_component_shuffle'] = gzip_size(shuffle(fd.T.copy()))
    diff = fd.view(np.int32)
    for pct in [0,.5,.9,.95,.99,.999,1]:
        methods.setdefault('index_delta_quantiles',{})[str(pct)] = float(np.quantile(np.abs(diff.astype(np.int64)),pct))
    report = dict(schema='heart-mesh-transport-pilot-v29', full=full, original=lod,
                  sampleVertices=len(p),sampleTriangles=len(f),methods=methods,
                  note='No index, triangle, vertex order or geometry is changed by predictive transport. Normal quantization candidates are measurements only.')
    out = ROOT/'docs/compression-v29/mesh-pilot.json'
    out.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2),flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--decoded',type=Path,default=Path('/workspace/data/heart-v29-compress/original.hfm')); parser.add_argument('--full',action='store_true')
    args=parser.parse_args(); pilot(args.decoded,args.full)
