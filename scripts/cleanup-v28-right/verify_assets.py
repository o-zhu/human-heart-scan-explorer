#!/usr/bin/env python3
"""Independent packed-asset and spatial-scope checks for the selected patches."""
from pathlib import Path
import gzip, hashlib, json, struct
import numpy as np
from exact_transport import read_encoded, read_surface

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/cleanup-v28-right'
PATCH = OUT / 'patch'
names = ['tricuspid-core-surface', 'pulmonary-valve-lumen-surface']
repairs = [([1224, 930, 943], [1304, 955, 1040]), ([1098, 976, 921], [1177, 1063, 1085])]
boxes = []
checks = []

def sha(value):
    return hashlib.sha256(value).hexdigest()

def disjoint(a, b):
    return bool(np.any(np.asarray(a[1]) <= b[0]) or np.any(np.asarray(b[1]) <= a[0]))

for name in names:
    policy = json.loads((PATCH / f'{name}-policy.json').read_text())
    box = (policy['lowerFullFineXYZ'], policy['upperFullFineXYZ'])
    assert all(disjoint(box, repair) for repair in repairs)
    assert all(disjoint(box, other) for other in boxes)
    boxes.append(box)
    surface = policy['surface']
    packed = read_encoded(PATCH / surface['file'], surface)
    assert len(packed) == surface['compressedBytes'] and sha(packed) == surface['sha256']
    raw = gzip.decompress(packed)
    assert len(raw) == surface['decodedBytes'] and sha(raw) == surface['decodedSha256']
    reference = policy['surfaceReference']
    reference_raw = read_surface(PATCH / reference['file'], reference)
    assert struct.unpack_from('<I', reference_raw)[0] == 0x31524653
    del reference_raw
    magic, version, nv, ni, po, no, io, reserved = struct.unpack_from('<8I', raw)
    assert magic == 0x314d4648 and version == 1 and reserved == 0
    assert nv == surface['vertexCount'] and ni == surface['indexCount']
    assert po % 4 == no % 4 == io % 4 == 0 and ni % 3 == 0
    normals = np.frombuffer(raw, '<i2', nv * 3, no).reshape(-1, 3).astype(np.float32) / 32767
    indices = np.frombuffer(raw, '<u4', ni, io)
    assert indices.max() < nv and indices.min() >= 0
    norm = np.linalg.norm(normals, axis=1)
    assert np.all(np.isfinite(norm)) and np.max(abs(norm - 1)) < .0001
    mask = policy['lowBandMask']
    packed = read_encoded(PATCH / mask['file'], mask)
    assert len(packed) == mask['compressedBytes'] and sha(packed) == mask['sha256']
    raw = gzip.decompress(packed)
    assert len(raw) == mask['decodedBytes'] and sha(raw) == mask['decodedSha256']
    dims = mask['dimensionsXYZ']
    storage = np.frombuffer(raw, np.uint8).reshape(mask['storageDimensionsXYZ'][::-1])
    unpacked = np.unpackbits(storage, axis=2, bitorder='little')
    assert not unpacked[:, :, dims[0]:].any()
    logical = unpacked[:, :, :dims[0]]
    assert int(logical.sum()) == mask['maskedVoxels'] == policy['counts']['removedForeground']
    assert not any(face.any() for face in [logical[0], logical[-1], logical[:, 0], logical[:, -1], logical[:, :, 0], logical[:, :, -1]])
    assert policy['counts']['lostProtected135Samples'] == policy['counts']['lostRaw190Samples'] == 0
    checks.append(dict(id=name, transportAndDecodedHashes=True, validIndices=True,
                       unitNormals=True, logicalMaskedSamples=int(logical.sum()),
                       zeroPackedTailBits=True, zeroExclusionOnBoxFaces=True,
                       disjointFromAtrialRepairs=True, disjointFromOtherRightPatch=True,
                       sourceToSurfaceP95Mm=policy['meshReduction']['deliveredSourceToSurface']['p95Mm'],
                       surfaceToSourceP95Mm=policy['meshReduction']['deliveredSurfaceToSource']['p95Mm'],
                       scope='Asset integrity and declared display-selection scope; no anatomical or clinical validation.'))

(OUT / 'asset-validation.json').write_text(json.dumps(checks, indent=2) + '\n')
print(json.dumps(checks, indent=2))
