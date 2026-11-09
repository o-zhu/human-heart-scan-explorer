#!/usr/bin/env python3
"""Build a lossless sparse GPU atlas of the eight already-reviewed mask fields.

Requires NumPy. This changes transport/storage only: every original stored byte,
including bit padding, is reconstructed and checked before any output is saved.
The original source masks, scientific manifests and geometry remain untouched.
"""
from __future__ import annotations

if not __debug__:
    raise RuntimeError('Byte-identity verification requires assertions; run without Python optimization.')

import argparse
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import re
import struct

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
DEST = PUBLIC / 'assets/reviewed-mask-v32'
RECEIPT = ROOT / 'docs/verified-model-v32/mask-atlas.json'
SOURCES = {
    'lumen': {
        'url': './assets/cleanup-v30/lumen-manifest.json',
        'sha256': 'cdea0c182475a0daf3db7b8cf53ec99e3d9fc53bc5d61aaba33b2e359cbcd1a6',
    },
    'surface': {
        'url': './assets/cleanup-v30/surface-manifest.json',
        'sha256': 'f12cc01dc5151df447c8c4456b5309ace7be642906923a395100eaefa03ea43d',
    },
}
MAGIC = 0x31414D52  # ASCII RMA1, little endian
REFERENCE_MAGIC = 0x31524D52  # ASCII RMR1, little endian
VERSION = 1
BRICK_EDGE = 8
BRICK_BYTES = BRICK_EDGE ** 3
INDEX_WIDTH = 1024
PAYLOAD_WIDTH = 2048
MAX_TEXTURE_BYTES = 64 * 1024 * 1024
FULL = [1897, 1897, 2117]
FIELD_IDS = [
    'lumen:atrial', 'lumen:arterial', 'lumen:valve-region', 'lumen:rv',
    'local:lvot-perivalvular-refinement', 'local:pulmonary-regularized-v30',
    'local:tricuspid-rv-regularized-v30', 'local:right-perivascular-v29',
]
HASH = re.compile(r'[a-f0-9]{64}')
ASSET_PATH = re.compile(r'\./assets/cleanup-v(?:28|29|30)/[a-z0-9-]+\.bits\.gz')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def source_path(url):
    if not url.startswith('./assets/') or '..' in url.split('/'):
        raise ValueError('Invalid source path')
    path = PUBLIC / url.removeprefix('./')
    if path.is_symlink() or not path.is_file():
        raise ValueError('Source must be a regular local file: ' + url)
    return path


def verified_manifest(meta):
    data = source_path(meta['url']).read_bytes()
    assert digest(data) == meta['sha256'], 'The pinned source manifest changed.'
    manifest = json.loads(data)
    assert manifest['donorId'] == 'ladaf-2021-17'
    return manifest


def verified_mask(meta):
    assert ASSET_PATH.fullmatch(meta['url'])
    assert meta['format'] == 'gzip-bitset-x-zyx'
    assert HASH.fullmatch(meta['sha256']) and HASH.fullmatch(meta['decodedSha256'])
    packed = source_path(meta['url']).read_bytes()
    assert len(packed) == meta['compressedBytes'] and digest(packed) == meta['sha256']
    data = gzip.decompress(packed)
    dims, storage = meta['dimensionsXYZ'], meta['storageDimensionsXYZ']
    assert len(dims) == len(storage) == 3
    assert all(type(x) is int and x > 0 for x in dims + storage)
    assert storage == [math.ceil(dims[0] / 8), dims[1], dims[2]]
    assert len(data) == math.prod(storage) == meta['decodedBytes']
    assert digest(data) == meta['decodedSha256']
    x, y, z = storage
    array = np.frombuffer(data, dtype=np.uint8).reshape(z, y, x)
    if dims[0] & 7:
        unused = 255 ^ ((1 << (dims[0] & 7)) - 1)
        assert not np.any(array[:, :, -1] & unused), 'Source bit padding changed.'
    return data, array


def brick_rows(array, storage):
    gx, gy, gz = [math.ceil(n / BRICK_EDGE) for n in storage]
    x, y, z = storage
    padded = np.zeros((gz * 8, gy * 8, gx * 8), dtype=np.uint8)
    padded[:z, :y, :x] = array
    # Both the brick grid and each 512-byte brick use X-fast / Z,Y,X order.
    rows = padded.reshape(gz, 8, gy, 8, gx, 8).transpose(0, 2, 4, 1, 3, 5).reshape(-1, BRICK_BYTES)
    return [gx, gy, gz], rows


def encode_gzip(data):
    # GzipFile emits no filename, a fixed timestamp and a portable OS byte.
    output = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=output, compresslevel=9, mtime=0) as stream:
        stream.write(data)
    return output.getvalue()


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def reconstruct_reference_plan(reference, index_bytes, fields, inputs, brick_count, payload_size, index_entries):
    """Decode the offline reference plan by copying exact original stored bytes."""
    header = (REFERENCE_MAGIC, 1, 8, len(index_bytes), brick_count,
              32, 32 + len(index_bytes), brick_count * 8)
    assert len(reference) == header[6] + header[7]
    assert struct.unpack('<8I', reference[:32]) == header
    assert reference[32:header[6]] == index_bytes
    indices = np.frombuffer(index_bytes, dtype='<u4')
    assert not np.any(indices[index_entries:]) and int(indices.max()) <= brick_count
    records = np.frombuffer(reference, dtype='<u4', offset=header[6]).reshape(brick_count, 2)
    assert not np.any(records[:, 0] >= 8), 'Reference field is outside the eight source masks.'
    # A deterministic plan names the first field/grid occurrence of each ID.
    first = np.full((brick_count, 2), 0xffffffff, dtype='<u4')
    for field_index, field in enumerate(fields):
        count = math.prod(field['brickGridXYZ'])
        selected = indices[field['indexOffset']:field['indexOffset'] + count]
        for ordinal in np.flatnonzero(selected):
            identity = int(selected[ordinal]) - 1
            if first[identity, 0] == 0xffffffff:
                first[identity] = [field_index, ordinal]
    assert np.array_equal(records, first), 'Reference plan does not use the first canonical occurrence.'
    payload = np.zeros(payload_size, dtype=np.uint8)
    for field_index, (field, (_, _, meta)) in enumerate(zip(fields, inputs)):
        _, source = verified_mask(meta)
        gx, gy, gz = field['brickGridXYZ']
        sx, sy, sz = field['storageDimensionsXYZ']
        for identity in np.flatnonzero(records[:, 0] == field_index):
            ordinal = int(records[identity, 1])
            assert ordinal < gx * gy * gz, 'Reference ordinal is outside its source grid.'
            bx, by, bz = ordinal % gx, (ordinal // gx) % gy, ordinal // (gx * gy)
            x, y, z = bx * 8, by * 8, bz * 8
            dx, dy, dz = min(8, sx - x), min(8, sy - y), min(8, sz - z)
            assert min(dx, dy, dz) > 0
            block = payload[identity * 512:(identity + 1) * 512].reshape(8, 8, 8)
            block[:dz, :dy, :dx] = source[z:z + dz, y:y + dy, x:x + dx]
            assert np.any(block), 'A nonzero atlas ID cannot reference an empty brick.'
    rma_header = struct.pack('<8I', MAGIC, VERSION, 8, index_entries,
                             32, len(index_bytes), 32 + len(index_bytes), payload_size)
    return rma_header + index_bytes + payload.tobytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true',
                        help='Rebuild in memory and require exact existing outputs; do not write.')
    args = parser.parse_args()
    lumen = verified_manifest(SOURCES['lumen'])
    surface = verified_manifest(SOURCES['surface'])
    assert len(lumen['masks']) == len(surface['patches']) == 4
    assert lumen['sourceFullDimensionsXYZ'] == FULL
    assert lumen['extent'] == surface['extent']
    assert lumen['sourceManifestSha256'] == surface['sourceManifestSha256']
    inputs = [('lumen', item['id'], item) for item in lumen['masks']]
    for patch in surface['patches']:
        item = patch['lowBandMask']
        assert item['lowerFullFineXYZ'] == patch['lowerFullFineXYZ']
        assert item['upperFullFineXYZ'] == patch['upperFullFineXYZ']
        inputs.append(('local', patch['id'], item))
    assert [kind + ':' + name for kind, name, _ in inputs] == FIELD_IDS

    lookup = np.array([n.bit_count() for n in range(256)], dtype=np.uint8)
    identities, unique_bricks, field_indices, fields, measurements = {}, [], [], [], []
    reference_records = []
    index_cursor = 0
    dense_bytes = 0
    for field_index, (kind, name, meta) in enumerate(inputs):
        raw, array = verified_mask(meta)
        grid, rows = brick_rows(array, meta['storageDimensionsXYZ'])
        indices = np.zeros(len(rows), dtype='<u4')
        nonzero = np.flatnonzero(np.any(rows, axis=1))
        unique_before = len(unique_bricks)
        field_bricks = set()
        for number in nonzero:
            block = rows[number].tobytes()
            identity = identities.get(block)
            if identity is None:
                identity = len(unique_bricks) + 1
                identities[block] = identity
                unique_bricks.append(block)
                reference_records.append((field_index, int(number)))
            indices[number] = identity
            field_bricks.add(identity)
        lo, hi = meta['lowerFullFineXYZ'], meta['upperFullFineXYZ']
        assert len(lo) == len(hi) == 3
        assert all(type(a) is int and type(b) is int and 0 <= a < b <= FULL[i]
                   for i, (a, b) in enumerate(zip(lo, hi)))
        assert [b - a for a, b in zip(lo, hi)] == meta['dimensionsXYZ']
        field = {
            'id': kind + ':' + name, 'kind': kind, 'sourceId': name,
            'sourceUrl': meta['url'], 'sourceCompressedBytes': meta['compressedBytes'],
            'sourceCompressedSha256': meta['sha256'],
            'sourceDecodedBytes': len(raw), 'sourceDecodedSha256': digest(raw),
            'lowerFullFineXYZ': lo, 'upperFullFineXYZ': hi,
            'dimensionsXYZ': meta['dimensionsXYZ'], 'storageDimensionsXYZ': meta['storageDimensionsXYZ'],
            'indexOffset': index_cursor, 'brickGridXYZ': grid,
        }
        fields.append(field)
        field_indices.append(indices)
        index_cursor += len(indices)
        dense_bytes += len(raw)
        measurements.append({
            'id': field['id'], 'sourceBytes': len(raw),
            'logicalVoxels': math.prod(meta['dimensionsXYZ']),
            'maskedVoxels': int(lookup[array].sum()),
            'nonzeroStoredBytes': int(np.count_nonzero(array)),
            'brickGridXYZ': grid, 'bricks': len(rows), 'nonzeroBricks': len(nonzero),
            'uniqueBricksReferenced': len(field_bricks),
            'newGlobalBricks': len(unique_bricks) - unique_before,
        })
    del identities

    indices = np.concatenate(field_indices)
    assert len(indices) == index_cursor and int(indices.max()) == len(unique_bricks)
    index_height = math.ceil(index_cursor / INDEX_WIDTH)
    index_size = INDEX_WIDTH * index_height * 4
    index_bytes = indices.tobytes() + bytes(index_size - indices.nbytes)
    payload_logical = b''.join(unique_bricks)
    payload_height = math.ceil(len(payload_logical) / (PAYLOAD_WIDTH * 4))
    payload_size = PAYLOAD_WIDTH * payload_height * 4
    payload_bytes = payload_logical + bytes(payload_size - len(payload_logical))
    texture_bytes = index_size + payload_size
    assert texture_bytes <= MAX_TEXTURE_BYTES, 'Atlas exceeds the fixed 64 MiB GPU texture budget.'
    assert max(INDEX_WIDTH, index_height, PAYLOAD_WIDTH, payload_height) <= 4096
    index_offset = 32
    payload_offset = index_offset + index_size
    header = struct.pack('<8I', MAGIC, VERSION, len(fields), index_cursor,
                         index_offset, index_size, payload_offset, payload_size)
    binary = header + index_bytes + payload_bytes
    assert len(binary) == 32 + texture_bytes

    # Verify from the final serialized binary, including every source byte.
    parsed = struct.unpack('<8I', binary[:32])
    assert parsed == (MAGIC, VERSION, 8, index_cursor, 32, index_size, payload_offset, payload_size)
    encoded_index = np.frombuffer(binary, dtype='<u4', count=index_size // 4, offset=index_offset)
    assert not np.any(encoded_index[index_cursor:]), 'Index row padding is not zero.'
    assert int(encoded_index.max()) <= len(unique_bricks)
    encoded_payload = np.frombuffer(binary, dtype=np.uint8, count=payload_size, offset=payload_offset)
    assert not np.any(encoded_payload[len(payload_logical):]), 'Payload row padding is not zero.'
    palette = np.zeros((len(unique_bricks) + 1, BRICK_BYTES), dtype=np.uint8)
    palette[1:] = encoded_payload[:len(payload_logical)].reshape(-1, BRICK_BYTES)
    for field, measurement, (_, _, meta) in zip(fields, measurements, inputs):
        gx, gy, gz = field['brickGridXYZ']
        count = gx * gy * gz
        selection = encoded_index[field['indexOffset']:field['indexOffset'] + count]
        expanded = palette[selection].reshape(gz, gy, gx, 8, 8, 8)
        expanded = expanded.transpose(0, 3, 1, 4, 2, 5).reshape(gz * 8, gy * 8, gx * 8)
        x, y, z = field['storageDimensionsXYZ']
        recovered = expanded[:z, :y, :x].tobytes()
        original, _ = verified_mask(meta)
        assert recovered == original, 'Atlas reconstruction changed a source mask byte.'
        assert digest(recovered) == field['sourceDecodedSha256']
        # These out-of-domain brick cells must also stay zero for safe sampling.
        assert not np.any(expanded[z:])
        assert not np.any(expanded[:z, y:])
        assert not np.any(expanded[:z, :y, x:])
        measurement.update({'sourceBytesCompared': len(recovered), 'mismatchedBytes': 0,
                            'reconstructedSha256': digest(recovered), 'exact': True})
    packed = encode_gzip(binary)
    assert gzip.decompress(packed) == binary
    # Preserve the existing full artifact exactly. The smaller transport is a
    # compiled copy plan for these same bytes, not a newly processed mask.
    original_full = DEST / 'atlas.bin.gz'
    if original_full.exists():
        assert original_full.read_bytes() == packed, 'The existing full atlas artifact changed.'
    reference_array = np.array(reference_records, dtype='<u4')
    reference_header = struct.pack('<8I', REFERENCE_MAGIC, 1, 8, index_size,
                                   len(unique_bricks), 32, 32 + index_size, len(unique_bricks) * 8)
    reference_binary = reference_header + index_bytes + reference_array.tobytes()
    rebuilt = reconstruct_reference_plan(reference_binary, index_bytes, fields, inputs,
                                         len(unique_bricks), payload_size, index_cursor)
    assert rebuilt == binary and digest(rebuilt) == digest(binary), 'Reference plan changed the full RMA1 atlas.'
    reference_packed = encode_gzip(reference_binary)
    assert gzip.decompress(reference_packed) == reference_binary
    # Recheck both scientific manifest pins before writing the new derivative.
    for meta in SOURCES.values():
        verified_manifest(meta)

    manifest = {
        'schema': 'heart-reviewed-mask-atlas-v32', 'version': VERSION,
        'id': 'ladaf-reviewed-mask-atlas-v32', 'donorId': 'ladaf-2021-17',
        'sourceFullDimensionsXYZ': FULL, 'extent': lumen['extent'],
        'sourceManifests': SOURCES,
        'brickSizeXYZ': [8, 8, 8], 'brickBytes': BRICK_BYTES,
        'zeroBrickIndex': 0,
        'indexConvention': 'X-fast brick grid; indexOffset counts uint32 entries. Index 0 is all zero; index N>0 starts at payload byte (N-1)*512.',
        'payloadConvention': 'Each brick stores 8x8x8 original packed-mask bytes in X-fast order. RGBA channels and 2D rows are consecutive bytes; padding is zero.',
        'header': {'bytes': 32, 'endian': 'little', 'magic': 'RMA1',
                   'uint32Fields': ['magic', 'version', 'fieldCount', 'indexEntryCount',
                                    'indexOffsetBytes', 'indexByteLength', 'payloadOffsetBytes', 'payloadByteLength']},
        'indexTexture': {'format': 'R32UI', 'width': INDEX_WIDTH, 'height': index_height,
                         'entryCount': index_cursor, 'offset': index_offset,
                         'byteLength': index_size, 'logicalBytes': index_cursor * 4},
        'payloadTexture': {'format': 'RGBA8', 'width': PAYLOAD_WIDTH, 'height': payload_height,
                           'brickCount': len(unique_bricks), 'offset': payload_offset,
                           'byteLength': payload_size, 'logicalBytes': len(payload_logical)},
        'asset': {'url': './assets/reviewed-mask-v32/atlas.bin.gz', 'format': 'RMA1-gzip',
                  'compressedBytes': len(packed), 'decodedBytes': len(binary),
                  'sha256': digest(packed), 'decodedSha256': digest(binary)},
        'transport': {'url': './assets/reviewed-mask-v32/atlas.refs.gz', 'format': 'RMR1-gzip',
                      'compressedBytes': len(reference_packed), 'decodedBytes': len(reference_binary),
                      'sha256': digest(reference_packed), 'decodedSha256': digest(reference_binary)},
        'fields': fields,
        'budget': {'sourceMaskBytes': dense_bytes, 'atlasTextureBytes': texture_bytes,
                   'savedTextureBytes': dense_bytes - texture_bytes,
                   'maximumTextureBytes': MAX_TEXTURE_BYTES, 'maximumTextureDimension': 4096},
        'scope': 'Lossless storage derivative of the eight existing reviewed masks. Source values, masks, coordinates, surface meshes and anatomical interpretations are unchanged.',
    }
    manifest_data = json_bytes(manifest)
    receipt = {
        'schema': 'heart-reviewed-mask-atlas-verification-v32', 'version': 1,
        'builder': 'scripts/prepare-reviewed-mask-atlas-v32.py',
        'builderSha256': digest(Path(__file__).read_bytes()),
        'sourceManifests': SOURCES, 'sourceFilesChanged': False,
        'sourceBytesCompared': dense_bytes, 'mismatchedBytes': 0,
        'verification': 'Every source byte reconstructed from the final serialized index/payload and compared with its verified original; exact gzip round trip; all padding zero.',
        'fields': measurements, 'fieldOrder': FIELD_IDS,
        'globalUniqueBricks': len(unique_bricks), 'indexEntries': index_cursor,
        'indexTexture': manifest['indexTexture'], 'payloadTexture': manifest['payloadTexture'],
        'budget': {**manifest['budget'],
                   'reductionPercent': 100 * (dense_bytes - texture_bytes) / dense_bytes},
        'asset': manifest['asset'],
        'transport': manifest['transport'],
        'referencePlan': {
            'headerUint32LE': list(struct.unpack('<8I', reference_header)),
            'recordCount': len(reference_records),
            'recordLayout': 'uint32 sourceFieldIndex, uint32 sourceLocalBrickOrdinal; record 0 supplies atlas brick ID 1.',
            'ordinalConvention': 'X-fast within source storageDimensionsXYZ rounded up to 8-byte bricks.',
            'selection': 'First field/grid occurrence of each nonzero brick ID in manifest order.',
            'reconstructedFullAtlasSha256': digest(rebuilt),
            'fullAtlasBytesCompared': len(binary), 'mismatchedBytes': 0,
            'sourceBytesChanged': False, 'edgePaddingZero': True,
        },
        'manifest': {'path': 'public/assets/reviewed-mask-v32/manifest.json',
                     'bytes': len(manifest_data), 'sha256': digest(manifest_data)},
        'passed': True,
        'limits': 'Byte equivalence and storage-budget verification; not browser/GPU performance or new anatomical validation.',
    }
    outputs = [(DEST / 'manifest.json', manifest_data), (DEST / 'atlas.bin.gz', packed),
               (DEST / 'atlas.refs.gz', reference_packed),
               (RECEIPT, json_bytes(receipt))]
    for path, data in outputs:
        if args.check:
            assert path.read_bytes() == data, 'Existing output differs from deterministic rebuild: ' + str(path)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_name(path.name + '.tmp')
            temporary.write_bytes(data)
            temporary.replace(path)
    print(json.dumps({'verified': True, 'checkOnly': args.check, 'fields': len(fields),
                      'sourceBytesCompared': dense_bytes, 'mismatchedBytes': 0,
                      'uniqueBricks': len(unique_bricks), 'indexSize': [INDEX_WIDTH, index_height],
                      'payloadSize': [PAYLOAD_WIDTH, payload_height],
                      'textureBytes': texture_bytes, 'compressedBytes': len(packed),
                      'decodedBytes': len(binary), 'manifestSha256': digest(manifest_data),
                      'referenceCompressedBytes': len(reference_packed),
                      'referenceDecodedBytes': len(reference_binary),
                      'referenceReconstructedFullAtlasSha256': digest(rebuilt),
                      'sourceFilesChanged': False}))


if __name__ == '__main__':
    main()
