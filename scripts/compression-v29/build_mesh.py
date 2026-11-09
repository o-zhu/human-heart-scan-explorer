#!/usr/bin/env python3
"""Build a bounded-error normal transport without changing any mesh geometry.

Positions, vertex order, triangle order and each triangle's corner order survive
bit-for-bit. Only the supplied shading normals undergo octahedral quantization.
Independent transport blocks avoid retaining a whole packed mesh while decoding.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, struct, sys, time, zlib
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, os.environ.get('HEART_MESHOPT_PYTHON_PATH', '/tmp/heart-meshopt-v29'))
import meshoptimizer as mo

SOURCE_SHA = '175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae'
MAGIC = 0x31434648  # HFC1


def file_sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def array_sha(a):
    h = hashlib.sha256()
    for start in range(0, len(a), 262144):
        h.update(a[start:start + 262144].tobytes())
    return h.hexdigest()


def oct_encode(n, bits=12):
    f = n.astype(np.float64)
    zero = (f == 0).all(axis=1)
    f /= np.maximum(1e-20, np.abs(f).sum(axis=1))[:, None]
    xy = f[:, :2].copy()
    negative = f[:, 2] < 0
    xy[negative] = (1 - np.abs(xy[negative, ::-1])) * np.where(xy[negative] < 0, -1, 1)
    scale = 2 ** (bits - 1) - 1
    q = np.floor(xy * scale + 0.5).astype(np.int32) + scale
    code = q[:, 0].astype(np.uint32) | (q[:, 1].astype(np.uint32) << bits)
    code[zero] = (1 << (2 * bits)) - 1
    return code


def oct_decode(code, bits=12):
    scale = 2 ** (bits - 1) - 1
    mask = (1 << bits) - 1
    x = ((code & mask).astype(np.float64) - scale) / scale
    y = (((code >> bits) & mask).astype(np.float64) - scale) / scale
    z = 1 - np.abs(x) - np.abs(y)
    negative = z < 0
    tx = (1 - np.abs(y)) * np.where(x < 0, -1, 1)
    ty = (1 - np.abs(x)) * np.where(y < 0, -1, 1)
    x[negative] = tx[negative]
    y[negative] = ty[negative]
    length = np.sqrt(x * x + y * y + z * z)
    factor = 32767 / np.maximum(length, 1e-20)
    n = np.column_stack([np.floor(x * factor + 0.5), np.floor(y * factor + 0.5), np.floor(z * factor + 0.5)]).astype('<i2')
    n[code == (1 << (2 * bits)) - 1] = 0
    return n


def build(args):
    started = time.perf_counter()
    assert file_sha(args.source) == SOURCE_SHA, 'Source mesh provenance mismatch.'
    source = np.memmap(args.source, dtype=np.uint8, mode='r')
    header = struct.unpack('<8I', source[:32])
    magic, version, nv, ni, po, no, io, reserved = header
    assert magic == 0x314d4648 and version == 1 and ni % 3 == 0
    positions = np.ndarray((nv, 3), dtype='<u2', buffer=source, offset=po)
    original_normals = np.ndarray((nv, 3), dtype='<i2', buffer=source, offset=no)
    faces = np.ndarray((ni // 3, 3), dtype='<u4', buffer=source, offset=io)
    normals = np.load(args.normals, mmap_mode='r') if args.normals else original_normals
    assert normals.shape == (nv, 3) and normals.dtype == np.dtype('<i2')
    args.out.mkdir(parents=True, exist_ok=True)
    decoded_path = args.out.parent / (args.out.name + '-decoded.hfm')
    shutil.copyfile(args.source, decoded_path)
    decoded = np.memmap(decoded_path, dtype=np.uint8, mode='r+')
    decoded_normals = np.ndarray((nv, 3), dtype='<i2', buffer=decoded, offset=no)
    parts, angular_sum, angular_max, nonzero_count = [], 0.0, 0.0, 0
    shading_source_sha = array_sha(normals)
    def part(kind, start, count, body, auxiliary=0, bits=0):
        payload = struct.pack('<6I', MAGIC, kind, start, count, auxiliary, bits) + body
        compressor = zlib.compressobj(6, zlib.DEFLATED, 31)
        packed = compressor.compress(payload) + compressor.flush()
        name = f'{ {1:"positions", 2:"normals", 3:"indices"}[kind]}-{start:08d}.hfc.gz'
        (args.out / name).write_bytes(packed)
        row = dict(path=name, kind=kind, start=start, count=count, compressedBytes=len(packed),
                   payloadBytes=len(payload), sha256=hashlib.sha256(packed).hexdigest(),
                   payloadSha256=hashlib.sha256(payload).hexdigest())
        parts.append(row)
        print(json.dumps(row), flush=True)
    # Small independent blocks bound decoder working memory and cancellation latency.
    for start in range(0, nv, args.vertices_per_part):
        p = positions[start:start + args.vertices_per_part]
        delta = np.empty_like(p)
        delta[0] = p[0]
        delta[1:] = p[1:] - p[:-1]
        planes = delta.reshape(-1).view(np.uint8).reshape(-1, 2).T.copy()
        part(1, start, len(p), planes.tobytes())
    for start in range(0, nv, args.vertices_per_part):
        n = normals[start:start + args.vertices_per_part]
        code = oct_encode(n, args.normal_bits)
        restored = oct_decode(code, args.normal_bits)
        decoded_normals[start:start + len(n)] = restored
        a = n.astype(np.float64)
        b = restored.astype(np.float64)
        valid = np.any(a != 0, axis=1)
        a = a[valid]; b = b[valid]
        a /= np.linalg.norm(a, axis=1)[:, None]
        b /= np.linalg.norm(b, axis=1)[:, None]
        angles = np.rad2deg(np.arccos(np.clip((a * b).sum(axis=1), -1, 1)))
        angular_sum += float((angles * angles).sum())
        angular_max = max(angular_max, float(angles.max(initial=0)))
        nonzero_count += len(angles)
        planes = code.astype('<u4').view(np.uint8).reshape(-1, 4)[:, :3].T.copy()
        part(2, start, len(n), planes.tobytes(), bits=args.normal_bits)
    for start in range(0, len(faces), args.triangles_per_part):
        f = faces[start:start + args.triangles_per_part]
        encoded = mo.encode_index_buffer(f.reshape(-1), vertex_count=nv)
        restored = mo.decode_index_buffer(f.size, 4, encoded).reshape(-1, 3)
        rotate = np.zeros(len(f), dtype=np.uint8)
        for rotation in (1, 2):
            rotate[np.all(np.roll(restored, rotation, axis=1) == f, axis=1)] = rotation
        for rotation in (0, 1, 2):
            assert np.array_equal(np.roll(restored[rotate == rotation], rotation, axis=1), f[rotate == rotation]), 'Index codec changed topology.'
        padded = np.pad(rotate, (0, (-len(rotate)) % 4)).reshape(-1, 4)
        rotations = padded[:, 0] | (padded[:, 1] << 2) | (padded[:, 2] << 4) | (padded[:, 3] << 6)
        part(3, start, len(f), encoded + rotations.tobytes(), auxiliary=len(encoded))
    decoded.flush()
    assert np.array_equal(np.ndarray(positions.shape, dtype='<u2', buffer=decoded, offset=po), positions)
    assert np.array_equal(np.ndarray(faces.shape, dtype='<u4', buffer=decoded, offset=io), faces)
    original_lod = json.loads((ROOT / 'public/assets/fine-surface-v23/manifest.json').read_text())['lods'][0]
    report = dict(schema='heart-compact-surface-v29', codec='hfc1-meshopt-oct12-gzip', version=1,
                  assetBaseUrl='/api/display-compact-v29/mesh/',
                  header=list(header), vertexCount=nv, indexCount=ni, triangleCount=ni // 3,
                  decodedBytes=len(source), decodedSha256=file_sha(decoded_path),
                  sourceDecodedSha256=SOURCE_SHA, sourceCompressedBytes=original_lod['compressedBytes'],
                  positionSha256=array_sha(positions), indexSha256=array_sha(faces),
                  sourceNormalSha256=array_sha(original_normals), shadingInputSha256=shading_source_sha,
                  decodedNormalSha256=array_sha(decoded_normals),
                  shadingCorrection=args.shading_correction,
                  normalQuantization=dict(method='octahedral', bitsPerCoordinate=args.normal_bits,
                      maxAngularErrorDegrees=angular_max, rmsAngularErrorDegrees=(angular_sum / max(1, nonzero_count)) ** .5,
                      zeroVectorsPreserved=True, comparedAgainst='supplied corrected int16 shading normals'),
                  positionBytesExact=True, indexBytesExact=True, triangleCornerOrderExact=True,
                  spatialResampling=False, compressedBytes=sum(p['compressedBytes'] for p in parts),
                  largestPartBytes=max(p['compressedBytes'] for p in parts), parts=parts,
                  buildSeconds=time.perf_counter() - started)
    report['reductionPercent'] = 100 * (1 - report['compressedBytes'] / report['sourceCompressedBytes'])
    (args.out / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    (ROOT / 'docs/compression-v29/mesh-build.json').write_text(json.dumps({k:v for k,v in report.items() if k != 'parts'}, indent=2) + '\n')
    print(json.dumps({k:v for k,v in report.items() if k != 'parts'}, indent=2), flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--source', type=Path, default=Path('/workspace/data/heart-v29-compress/original.hfm'))
    p.add_argument('--normals', type=Path)
    p.add_argument('--shading-correction', default='original immutable HFM normals')
    p.add_argument('--out', type=Path, default=Path('/workspace/data/heart-v29-compress/mesh-compact'))
    p.add_argument('--normal-bits', type=int, choices=[12], default=12)
    p.add_argument('--vertices-per-part', type=int, default=1310720)
    p.add_argument('--triangles-per-part', type=int, default=2097152)
    build(p.parse_args())
