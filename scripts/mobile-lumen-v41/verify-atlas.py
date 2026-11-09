#!/usr/bin/env python3
"""Independently prove the bounded mobile atlas preserves four original masks.

Reads immutable source assets. It never writes public assets or opens a bank.
The canonical result is reconstructed from the original RMR reference records,
checked against the original RMA payload, then expanded byte-for-byte back to
all four original packed masks. --runtime additionally checks a browser-loader
export, including its source-space metadata.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import math
import struct
import numpy as np

if not __debug__:
    raise RuntimeError('Run without Python optimization; assertions verify source identity.')

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public'
EXPECTED_MANIFEST = 'heart-reviewed-mask-atlas-v32'
EXPECTED_SOURCE = '96cf62fdf734050d125bb851e63027ca11aec9c217f7cecdfb69de3202d380ca'
EXPECTED_FIELDS = ['lumen:atrial', 'lumen:arterial', 'lumen:valve-region', 'lumen:rv']
sha = lambda value: hashlib.sha256(value).hexdigest()


def asset(meta):
    path = PUBLIC / meta['url'].removeprefix('./')
    packed = path.read_bytes()
    assert len(packed) == meta['compressedBytes'] and sha(packed) == meta['sha256'], path
    raw = gzip.decompress(packed)
    assert len(raw) == meta['decodedBytes'] and sha(raw) == meta['decodedSha256'], path
    return raw


def original_mask(field):
    raw = asset(dict(url=field['sourceUrl'], compressedBytes=field['sourceCompressedBytes'],
                     sha256=field['sourceCompressedSha256'], decodedBytes=field['sourceDecodedBytes'],
                     decodedSha256=field['sourceDecodedSha256']))
    return raw, np.frombuffer(raw, np.uint8).reshape(field['storageDimensionsXYZ'][::-1])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path)
    parser.add_argument('--reference', type=Path,
                        help='Optional scratch directory for canonical index/payload exports')
    parser.add_argument('--output', type=Path,
                        default=ROOT / 'docs/echo-mobile-v41/mobile-atlas-proof.json')
    options = parser.parse_args()
    manifest_path = PUBLIC / 'assets/reviewed-mask-v32/manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    m = json.loads(manifest_bytes)
    assert m['schema'] == EXPECTED_MANIFEST and m['asset']['decodedSha256'] == EXPECTED_SOURCE
    assert [f['id'] for f in m['fields'][:4]] == EXPECTED_FIELDS
    for source in m['sourceManifests'].values():
        assert sha((PUBLIC / source['url'].removeprefix('./')).read_bytes()) == source['sha256']
    full = asset(m['asset'])
    references = asset(m['transport'])
    i, p = m['indexTexture'], m['payloadTexture']
    assert struct.unpack_from('<8I', references) == (
        0x31524D52, 1, 8, i['byteLength'], p['brickCount'], 32,
        32 + i['byteLength'], p['brickCount'] * 8)
    old_index = np.frombuffer(references, '<u4', count=i['byteLength'] // 4, offset=32)
    full_index = np.frombuffer(full, '<u4', count=i['byteLength'] // 4, offset=i['offset'])
    assert np.array_equal(old_index, full_index)
    records = np.frombuffer(references, '<u4', offset=32+i['byteLength']).reshape(-1, 2)
    full_payload = np.frombuffer(full, np.uint8, count=p['byteLength'], offset=p['offset'])
    fields = m['fields'][:4]
    entries = sum(math.prod(f['brickGridXYZ']) for f in fields)
    index_height = math.ceil(entries / 1024)
    index = np.zeros(1024 * index_height, dtype='<u4')
    remap, old_ids, first_occurrences = {}, [], {}
    cursor = 0
    for field_number, f in enumerate(fields):
        count = math.prod(f['brickGridXYZ'])
        assert cursor == f['indexOffset']
        for ordinal, identity_ in enumerate(old_index[cursor:cursor+count]):
            identity = int(identity_)
            if not identity:
                continue
            assert identity <= p['brickCount']
            if identity not in remap:
                remap[identity] = len(old_ids) + 1
                old_ids.append(identity)
                first_occurrences[identity] = [field_number, ordinal]
            index[cursor + ordinal] = remap[identity]
        cursor += count
    for identity in old_ids:
        assert records[identity - 1].tolist() == first_occurrences[identity]
    logical_payload = len(old_ids) * 512
    payload_height = math.ceil(logical_payload / (2048 * 4))
    payload = np.zeros(2048 * payload_height * 4, np.uint8)
    measurements = []
    for field_number, f in enumerate(fields):
        original_bytes, source = original_mask(f)
        gx, gy, gz = f['brickGridXYZ']
        sx, sy, sz = f['storageDimensionsXYZ']
        for identity in old_ids:
            reference_field, ordinal = records[identity - 1]
            if reference_field != field_number:
                continue
            assert ordinal < gx * gy * gz
            ordinal = int(ordinal)
            x, y, z = ordinal % gx * 8, ordinal // gx % gy * 8, ordinal // (gx * gy) * 8
            dx, dy, dz = min(8, sx-x), min(8, sy-y), min(8, sz-z)
            start = (remap[identity] - 1) * 512
            brick = payload[start:start+512].reshape(8, 8, 8)
            brick[:dz, :dy, :dx] = source[z:z+dz, y:y+dy, x:x+dx]
            assert np.any(brick)
            assert np.array_equal(brick.ravel(), full_payload[(identity-1)*512:identity*512])
        measurements.append(dict(id=f['id'], sourceDecodedBytes=len(original_bytes),
                                 sourceDecodedSha256=sha(original_bytes)))
        del original_bytes, source
    # Independently re-expand the serialized sparse result into every source byte.
    palette = np.zeros((len(old_ids) + 1, 512), np.uint8)
    palette[1:] = payload[:logical_payload].reshape(-1, 512)
    for f, measurement in zip(fields, measurements):
        gx, gy, gz = f['brickGridXYZ']
        count = gx * gy * gz
        selected = index[f['indexOffset']:f['indexOffset']+count]
        expanded = palette[selected].reshape(gz, gy, gx, 8, 8, 8)
        expanded = expanded.transpose(0, 3, 1, 4, 2, 5).reshape(gz*8, gy*8, gx*8)
        x, y, z = f['storageDimensionsXYZ']
        recovered = expanded[:z, :y, :x].tobytes()
        original_bytes, _ = original_mask(f)
        assert recovered == original_bytes
        assert not np.any(expanded[z:]) and not np.any(expanded[:z, y:])
        assert not np.any(expanded[:z, :y, x:])
        measurement.update(sourceBytesCompared=len(recovered), mismatchedBytes=0,
                           reconstructedSha256=sha(recovered))
    assert not np.any(index[entries:]) and not np.any(payload[logical_payload:])
    index_layout = dict(format='R32UI', width=1024, height=index_height,
                        entryCount=entries, byteLength=index.nbytes,
                        logicalBytes=entries*4, sha256=sha(index.tobytes()))
    payload_layout = dict(format='RGBA8', width=2048, height=payload_height,
                          brickCount=len(old_ids), byteLength=payload.nbytes,
                          logicalBytes=logical_payload, sha256=sha(payload.tobytes()))
    runtime_check = None
    if options.runtime:
        runtime = json.loads((options.runtime / 'manifest.json').read_text())
        assert runtime['donorId'] == m['donorId']
        assert runtime['sourceFullDimensionsXYZ'] == m['sourceFullDimensionsXYZ']
        assert runtime['extent'] == m['extent']
        assert runtime['fields'] == fields
        for kind, expected in [('indexTexture', index_layout), ('payloadTexture', payload_layout)]:
            for name in ['format', 'width', 'height', 'byteLength']:
                assert runtime[kind][name] == expected[name], (kind, name)
        assert (options.runtime / 'index.raw').read_bytes() == index.tobytes()
        assert (options.runtime / 'payload.raw').read_bytes() == payload.tobytes()
        runtime_check = dict(passed=True, manifestSha256=sha((options.runtime / 'manifest.json').read_bytes()),
                             indexBytesEqual=True, payloadBytesEqual=True, sourceMetadataEqual=True)
    if options.reference:
        options.reference.mkdir(parents=True, exist_ok=True)
        (options.reference / 'index.raw').write_bytes(index.tobytes())
        (options.reference / 'payload.raw').write_bytes(payload.tobytes())
    report = dict(passed=True, sourceManifestSha256=sha(manifest_bytes),
                  originalFullAtlasSha256=sha(full), originalReferenceProgramSha256=sha(references),
                  fields=measurements, sourceBytesCompared=sum(f['sourceBytesCompared'] for f in measurements),
                  mismatchedBytes=0, retainedDenseSourceBytes=0,
                  indexTexture=index_layout, payloadTexture=payload_layout,
                  cpuAtlasBytes=index.nbytes+payload.nbytes,
                  gpuAtlasBytes=index.nbytes+payload.nbytes,
                  largestTemporaryDecodedSourceBytes=max(f['sourceDecodedBytes'] for f in fields),
                  referenceProgramDecodedBytes=len(references),
                  binaryAssetsChanged=False, runtime=runtime_check,
                  scope='Exact storage/lookup representation of the four immutable reviewed lumen masks. '
                        'Declared buffer sizes exclude browser overhead and are not a whole-tab peak-memory measurement.')
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
