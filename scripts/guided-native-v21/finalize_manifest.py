#!/usr/bin/env python3
"""Compile a compact browser index and separate complete evidence ledger.

This tool performs local validation only: no uploads, network GETs, or bulk
native downloads. Native receipts attest to the uploader's earlier full public
GET byte-count/SHA verification. Overview HFM receipts must be supplied after
upload. --dry-run validates available evidence and reports missing overview
receipts without emitting a publishable manifest.

The first pass writes both deterministic gzip artifacts. Upload the evidence
ledger first; a second pass with --evidence-receipt validates that upload and
makes the compact viewer index publishable. The evidence bytes do not change.
The browser index stays within its existing 32 MiB decoded budget; the separate
ledger is never parsed by the browser. Each gzip object is at most 32 MiB.

--allow-pilot changes the completion scope, never the exact-plan completeness
checks. --fixture-receipts additionally permits explicitly unverified local
test fixtures at example.invalid; such output is marked non-publishable.
Normal mode is independently pinned to the selected whole-heart census plan
and its processing fingerprint; an alternate completed small plan is not whole.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys

import numpy as np

from upload import API, SITE_URL, UploadError, validate_remote_path

SCHEMA = 'guided-native-manifest-v21.1'
DIMENSIONS = (7614, 7614, 8480)
SPACING = 19.85
WHOLE_PLAN_SHA256 = '3be68c22b4f7a000b6e17b4c159f4d9a630b52884ea434624fc70c25999c6e94'
WHOLE_RUN_FINGERPRINT = '44a31c3adeb20e5a9a3d31f6868f9c92479920f533d2ea3c486e22b4aefa584a'
MAX_COMPRESSED = 32 * 1024**2
MAX_DECODED = 128 * 1024**2
MAX_VIEWER_DECODED = 32 * 1024**2
SOURCE_URL = ('https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/'
              'LADAF-2021-17/heart/19.85um_complete-organ_bm18/s0/')
PROCESSING_FILES = ('source.py', 'prior.py', 'edge_codec.py', 'refine.py', 'tv_kernel.py', 'tv_kernel.c')
CONTRIBUTION = ('nativeOnlyEdgeVertices', 'blendedEdgeVertices', 'priorOnlyEdgeVertices')
SHA = re.compile(r'^[a-f0-9]{64}$')
COVERAGE_CAVEAT = (
    'Completion means that every block in the recorded coarse-guided core plan was processed, '
    'and every nonempty native-grid NBE1 artifact has a recorded full public-GET checksum verification. '
    'The guide derives from the cleaned 79.4 micrometre prior. The reconstructed scalar field combines '
    'denoised 19.85 micrometre native samples near the guide with a smooth transition to that prior '
    'farther away. Native-only, blended and prior-only counts describe stored edge crossings, '
    'including duplicates on shared tile boundaries; they are not disjoint surface-area fractions '
    'or a measure of complete anatomical coverage. Native-only structures absent from the prior '
    'outside the searched band may be missing. The overview is a separately sampled and simplified '
    'display LOD. The 0.31015625 micrometre native crossing-encoding bound is relative to the processed '
    'scalar isosurface; it does not bound denoising, registration, prior-guidance or anatomical error.'
)


class ManifestError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ManifestError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha_bytes(value):
    return hashlib.sha256(value).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for piece in iter(lambda: stream.read(4 * 1024**2), b''):
            h.update(piece)
    return h.hexdigest()


def read_json(path):
    raw = Path(path).read_bytes()
    return json.loads(raw), sha_bytes(raw)


def atomic_bytes(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix(path.suffix + '.part')
    pending.write_bytes(value)
    pending.replace(path)


def integer(value, label, minimum=0, maximum=None):
    require(type(value) is int and value >= minimum and (maximum is None or value <= maximum),
            f'Invalid integer {label}')
    return value


def checksum(value, label):
    require(isinstance(value, str) and SHA.fullmatch(value) is not None, f'Invalid SHA-256 {label}')
    return value


def coordinates(value, label, core=False):
    require(isinstance(value, (list, tuple)) and len(value) == 3, f'Invalid {label} coordinate shape')
    xyz = tuple(integer(n, label, 0) for n in value)
    if core:
        require(all(n * 128 + 128 < d for n, d in zip(xyz, DIMENSIONS)), f'{label} is not a complete 128-cell source tile')
    else:
        require(all(n < math.ceil(d / 128) for n, d in zip(xyz, DIMENSIONS)), f'{label} lies outside the native N5 grid')
    return xyz


def relative_path(root, value, label):
    require(isinstance(value, str), f'Missing relative path for {label}')
    p = Path(value)
    require(not p.is_absolute() and '..' not in p.parts, f'Unsafe relative path for {label}')
    path = root / p
    require(root.resolve() in path.resolve().parents, f'{label} escapes its source directory')
    return path


def plan(path, label, core=False):
    array = np.load(path, allow_pickle=False)
    require(array.ndim == 2 and array.shape[1] == 3 and array.dtype.kind in 'iu', f'{label} is not an integer XYZ plan')
    rows = [coordinates(list(map(int, row)), label, core) for row in array]
    require(len(rows) > 0 and len(rows) == len(set(rows)), f'{label} is empty or contains duplicate tiles')
    return set(rows), file_hash(path)


def verify_local(path, item, kind):
    size = item.get('compressedBytes', item.get('bytes'))
    integer(size, f'{kind} compressed bytes', 1, MAX_COMPRESSED)
    require(path.is_file() and path.stat().st_size == size, f'Missing or wrong-sized local {kind}: {path.name}')
    require(file_hash(path) == checksum(item.get('sha256'), kind), f'Local {kind} SHA mismatch: {path.name}')
    expected_size = integer(item.get('decodedBytes'), f'{kind} decoded bytes', 32, MAX_DECODED)
    expected_hash = checksum(item.get('decodedSha256'), kind + ' decoded')
    h, total, header = hashlib.sha256(), 0, b''
    with gzip.open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024**2), b''):
            total += len(chunk)
            require(total <= expected_size, f'Local {kind} exceeds its declared decoded size')
            if len(header) < 64:
                header += chunk[:64 - len(header)]
            h.update(chunk)
    require(total == expected_size and h.hexdigest() == expected_hash, f'Local {kind} decoded hash/size mismatch')
    return header


def nbe_metadata(item, xyz, step):
    label = 'native' if step == 1 else 'overview checkpoint'
    require(item.get('format') == 'NBE1' and item.get('samplingStepNative') == step, f'Foreign {label} artifact format')
    n = 128 // step + 1
    require(item.get('sampleShapeZYX') == [n] * 3 and item.get('originXYZ') == [x * 128 for x in xyz], f'{label} origin or shape differs from its tile')
    require(item.get('sourceSpacingUm') == SPACING and item.get('meshSampleSpacingUm') == SPACING * step and item.get('crossingBits') == 5,
            f'{label} spacing or crossing precision differs')
    edges = item.get('edgeCountsXYZ')
    require(isinstance(edges, list) and len(edges) == 3, f'{label} edge counts are missing')
    for value in edges:
        integer(value, label + ' edge count', 0, (n - 1) * n * n)
    vertices = integer(item.get('vertices'), label + ' vertices', 0)
    triangles = integer(item.get('triangles'), label + ' triangles', 0, 5 * (n - 1)**3)
    require(vertices == sum(edges), f'{label} vertices differ from its encoded edge counts')
    integer(item.get('activeCells'), label + ' active cells', 0, (n - 1)**3)
    integer(item.get('bytes'), label + ' bytes', 1, 4 * 1024**2)
    expected_decoded = 64 + (n**3 + 7) // 8 + sum((e * 5 + 7) // 8 for e in edges)
    require(item.get('decodedBytes') == expected_decoded, f'{label} decoded size differs from NBE1 layout')
    checksum(item.get('sha256'), label)
    checksum(item.get('decodedSha256'), label + ' decoded')
    bound = SPACING * step / 64
    require(item.get('encodingMovementBoundUm') == bound, f'{label} encoding bound differs')
    for key in ('maximumEncodingMovementUm', 'rmsEncodingMovementUm'):
        value = item.get(key)
        require(isinstance(value, (int, float)) and math.isfinite(value) and 0 <= value <= bound + 1e-9, f'Invalid {label} {key}')
    return vertices, triangles


def check_nbe_header(header, item, threshold):
    h = struct.unpack('<16I', header)
    step = item['samplingStepNative']
    require(h[:2] == (0x3145424e, 1) and list(h[2:5]) == item['sampleShapeZYX'][::-1] and h[5] == 5,
            'Local NBE1 header differs from artifact metadata')
    require(list(h[7:10]) == item['edgeCountsXYZ'] and list(h[10:13]) == item['originXYZ'] and (h[15] or 1) == step,
            'Local NBE1 origin, step or crossing count differs')
    require(h[13] == struct.unpack('<I', struct.pack('<f', threshold))[0], 'Local NBE1 threshold differs from run configuration')


def receipt(value, item, kind, xyz=None, fixtures=False):
    require(isinstance(value, dict), f'Missing verified {kind} remote receipt')
    expected_hash = item['sha256']
    expected_size = item.get('compressedBytes', item.get('bytes'))
    require(value.get('sha256') == expected_hash and value.get('bytes') == expected_size, f'{kind} receipt SHA or byte count differs')
    remote = value.get('path')
    maximum = validate_remote_path(remote, expected_hash)
    require(expected_size <= maximum, f'{kind} receipt object exceeds the collection byte cap')
    if kind == 'native':
        require(remote == 'tiles/' + '_'.join(map(str, xyz)) + '-' + expected_hash + '.nbe.gz', 'Native receipt filename belongs to a different tile')
    elif kind == 'overview':
        require(remote.startswith('overview/') and remote.endswith('.hfm.gz'), 'Overview receipt has the wrong object role')
    else:
        require(kind == 'evidence' and remote == 'manifest-' + expected_hash + '.json.gz', 'Evidence receipt has the wrong content-addressed object path')
    is_fixture = value.get('fixture') is True
    if is_fixture:
        require(fixtures and value.get('verified') is False and value.get('verification') == 'local-fixture-only', 'Fixture receipts are forbidden in production')
        require(value.get('url') == 'https://example.invalid' + API + remote, 'A fixture must use the reserved example.invalid origin')
        return dict(fixture=True, verified=False, verification='local-fixture-only', path=remote,
                    url=value['url'], bytes=expected_size, sha256=expected_hash)
    require(value.get('verified') is True and value.get('url') == SITE_URL + API + remote, f'{kind} receipt is unverified or has a foreign URL')
    try:
        moment = datetime.fromisoformat(value['verifiedAt'].replace('Z', '+00:00'))
        require(moment.tzinfo is not None, 'Receipt time lacks a timezone')
    except (KeyError, TypeError, ValueError):
        raise ManifestError(f'{kind} receipt lacks a valid verification time') from None
    return dict(verified=True, url=value['url'], path=remote, bytes=expected_size,
                sha256=expected_hash, verifiedAt=value['verifiedAt'])


def load_receipts(paths):
    by_sha, files = {}, []
    for path in paths:
        value, sha = read_json(path)
        files.append(dict(name=path.name, sha256=sha))
        require(isinstance(value, (dict, list)), 'Overview receipt file must contain an object or array')
        rows = value if isinstance(value, list) else value.get('receipts', [value])
        require(isinstance(rows, list), 'Overview receipt file has an unsupported layout')
        for row in rows:
            require(isinstance(row, dict), 'Invalid overview receipt row')
            key = checksum(row.get('sha256'), 'overview receipt')
            if key in by_sha:
                fields = ('url', 'path', 'sha256', 'bytes', 'verified', 'fixture', 'verification')
                require(all(by_sha[key].get(k) == row.get(k) for k in fields), 'Conflicting overview receipts for one checksum')
                if row.get('verifiedAt', '') > by_sha[key].get('verifiedAt', ''):
                    by_sha[key] = row
            else:
                by_sha[key] = row
    return by_sha, sorted(files, key=lambda r: (r['name'], r['sha256']))


def source_ledger(path, input_plan):
    objects, observations, cached_observations = {}, 0, 0
    observation_bytes, network_tagged_bytes = 0, 0
    raw_hash = hashlib.sha256()
    with path.open('rb') as stream:
        for line in stream:
            raw_hash.update(line)
            require(bool(line.strip()), 'The source-object ledger contains an empty record')
            item = json.loads(line)
            xyz = coordinates(item.get('coordinatesXYZ'), 'source object')
            size = integer(item.get('bytes'), 'source object bytes', 32, 5 * 1024**2)
            sha = checksum(item.get('sha256'), 'source object')
            generation = item.get('generation')
            require(generation is None or isinstance(generation, str), 'Invalid source object generation')
            require(type(item.get('cached')) is bool, 'Missing source cache-observation flag')
            observations += 1
            cached_observations += int(item['cached'])
            observation_bytes += size
            network_tagged_bytes += 0 if item['cached'] else size
            if xyz in objects:
                require(objects[xyz]['sha256'] == sha and objects[xyz]['bytes'] == size, f'Conflicting source hashes or sizes at {xyz}')
            else:
                objects[xyz] = dict(xyz=list(xyz), sha256=sha, bytes=size, generations=set())
            if generation is not None:
                objects[xyz]['generations'].add(generation)
    require(input_plan <= set(objects), 'The source-object ledger does not cover every planned input block')
    rows = []
    for xyz in sorted(objects):
        r = objects[xyz]
        r['generations'] = sorted(r['generations'])
        rows.append(r)
    return dict(logSha256=raw_hash.hexdigest(), observations=observations,
        duplicateCoordinateObservations=observations - len(objects), uniqueObjects=len(objects),
        uniqueObjectEncodedBytes=sum(r['bytes'] for r in rows), observedReadBytes=observation_bytes,
        cachedObservations=cached_observations, networkTaggedObservationBytes=network_tagged_bytes,
        plannedInputObjects=len(input_plan), additionalContextObjects=len(set(objects) - input_plan),
        networkAccountingCaveat='Ledger observations are not network transfer totals; retries and unsuccessful requests are not represented.',
        deduplicatedObjectsCanonicalSha256=sha_bytes(canonical(rows)), objects=rows)


def compile_manifest(args):
    run = args.run.resolve()
    run_meta, run_hash = read_json(run / 'run.json')
    progress, progress_hash = read_json(run / 'progress.json')
    require(progress.get('complete') is True and progress.get('phase') == 'complete' and progress.get('error') is None,
            'Native run is incomplete; --allow-pilot does not waive exact-plan completion')
    require(run_meta.get('nativeDimensionsXYZ') == list(DIMENSIONS) and run_meta.get('sourceSpacingUm') == SPACING, 'Foreign source geometry')
    fingerprint = checksum(run_meta.get('fingerprint'), 'run fingerprint')
    core_path = args.plan or Path(run_meta['corePlan'])
    input_path = args.input_plan or Path(run_meta['inputPlan'])
    core, core_sha = plan(core_path, 'core plan', core=True)
    inputs, input_sha = plan(input_path, 'input plan')
    if not args.allow_pilot:
        require(core_sha == input_sha == WHOLE_PLAN_SHA256
                and fingerprint == WHOLE_RUN_FINGERPRINT,
                'Whole-plan publication requires the independently pinned whole-heart census plan and processing fingerprint; use --allow-pilot for an alternate plan')
    require(core <= inputs and len(core) == run_meta.get('coreBlocks') and len(inputs) == run_meta.get('inputBlocks'), 'Plan counts or input/core containment differ from run metadata')
    require(progress.get('plannedCoreBlocks') == len(core) and progress.get('completedCoreBlocks') == len(core), 'Progress and exact core plan disagree')
    config = run_meta['config']
    require(isinstance(config, dict) and config.get('nativeSourceSpacingUm') == SPACING and config.get('overviewSamplingStepNative') == 4,
            'Run configuration lacks the audited source/overview spacings')
    provenance = dict(inputPlan=input_sha, corePlan=core_sha, configuration=config,
        processingCode={name: file_hash(args.processing_source / name) for name in PROCESSING_FILES},
        priorManifest=file_hash(args.prior_manifest))
    reproduced = sha_bytes(json.dumps(provenance, sort_keys=True).encode())
    require(reproduced == fingerprint, 'Processing code/configuration/plan provenance does not reproduce the run fingerprint')
    records, native_tiles, plan_entries, local_overviews = {}, [], [], {}
    empty_tiles, native_receipts, record_inventory = [], [], []
    totals = dict(nativeTriangles=0, nativeVertices=0, nativeCompressedBytes=0, nativeDecodedBytes=0,
        overviewCheckpointTriangles=0, overviewCheckpointBytes=0, coreSampleRecords=0,
        nativeWeightNonzeroPointRecords=0, nativeWeightFullPointRecords=0)
    contribution = dict.fromkeys(CONTRIBUTION, 0)
    maximum_error, weighted_squared_error, fixtures_used = 0.0, 0.0, False
    for path in sorted((run / 'records').glob('*.json')):
        r, record_hash = read_json(path)
        xyz = coordinates(r.get('coordinatesXYZ'), 'completed core', core=True)
        require(xyz not in records and xyz in core, 'Duplicate or unplanned completed tile')
        require(r.get('fingerprint') == fingerprint, 'A completed tile has a foreign fingerprint')
        require(type(r.get('empty')) is bool and r.get('nativeSourceSamplingPreserved') is True, 'Tile completion/source-sampling evidence is missing')
        records[xyz] = r
        artifacts = r.get('artifacts')
        require(isinstance(artifacts, list) and all(isinstance(a, dict) and a.get('role') in ('native', 'overview') for a in artifacts), 'Tile contains unsupported artifact roles')
        native = [a for a in artifacts if a['role'] == 'native']
        overview = [a for a in artifacts if a['role'] == 'overview']
        require(len(overview) == 1 and len(native) == (0 if r['empty'] else 1), 'Tile empty state and artifact count disagree')
        ov = overview[0]
        nbe_metadata(ov, xyz, 4)
        local_path = relative_path(run, ov.get('path'), 'local overview checkpoint')
        header = verify_local(local_path, ov, 'overview checkpoint')
        check_nbe_header(header, ov, config['thresholdRaw'])
        local_overviews[xyz] = dict(path=ov['path'], sha256=ov['sha256'], bytes=ov['bytes'],
            decodedSha256=ov['decodedSha256'], decodedBytes=ov['decodedBytes'], vertices=ov['vertices'], triangles=ov['triangles'], recordSha256=record_hash)
        totals['overviewCheckpointTriangles'] += ov['triangles']
        totals['overviewCheckpointBytes'] += ov['bytes']
        c = r.get('surfaceContribution')
        require(isinstance(c, dict), 'Stored crossing contribution counts are missing')
        for key in CONTRIBUTION:
            contribution[key] += integer(c.get(key), key)
        core_samples = integer(r.get('coreSamples'), 'core samples')
        full = integer(r.get('nativeWeightFullPoints'), 'full native-weight samples')
        nonzero = integer(r.get('nativeWeightNonzeroPoints'), 'nonzero native-weight samples')
        require(core_samples == 129**3 and full <= nonzero <= core_samples, 'Invalid core native-weight point accounting')
        totals['coreSampleRecords'] += core_samples
        totals['nativeWeightFullPointRecords'] += full
        totals['nativeWeightNonzeroPointRecords'] += nonzero
        if r['empty']:
            require(r.get('nativeVertices') == 0 and r.get('nativeTriangles') == 0 and sum(c.values()) == 0, 'An empty tile has native surface counts')
            require(ov['triangles'] == 0, 'An empty native field has a nonempty sampled overview')
            empty_tiles.append(list(xyz))
        else:
            item = native[0]
            vertices, triangles = nbe_metadata(item, xyz, 1)
            require(vertices > 0 and triangles > 0 and r.get('nativeVertices') == vertices and r.get('nativeTriangles') == triangles and sum(c[k] for k in CONTRIBUTION) == vertices,
                    'Native tile counts or crossing contribution accounting disagree')
            remote = receipt(item.get('remote'), item, 'native', xyz, args.fixture_receipts)
            fixtures_used |= remote.get('fixture', False)
            native_receipts.append(dict(xyz=list(xyz), **remote))
            row = dict(xyz=list(xyz), url=remote['url'], sha256=item['sha256'], bytes=item['bytes'],
                decodedBytes=item['decodedBytes'], decodedSha256=item['decodedSha256'],
                vertices=vertices, triangles=triangles, surfaceContribution={k: c[k] for k in CONTRIBUTION},
                maximumEncodingMovementUm=item['maximumEncodingMovementUm'],
                rmsEncodingMovementUm=item['rmsEncodingMovementUm'])
            native_tiles.append(row)
            totals['nativeTriangles'] += triangles
            totals['nativeVertices'] += vertices
            totals['nativeCompressedBytes'] += item['bytes']
            totals['nativeDecodedBytes'] += item['decodedBytes']
            maximum_error = max(maximum_error, item['maximumEncodingMovementUm'])
            weighted_squared_error += item['rmsEncodingMovementUm']**2 * vertices
        plan_entries.append(dict(xyz=list(xyz), empty=r['empty'], recordSha256=record_hash,
            overview=local_overviews[xyz]))
        record_inventory.append(dict(xyz=list(xyz), sha256=record_hash))
    require(set(records) == core, 'Completed tile records do not exactly cover the core plan')
    require(native_tiles, 'The completed plan contains no native-grid surface objects')
    if 'surfaceContribution' in progress:
        require(progress['surfaceContribution'] == contribution, 'Progress contribution counts differ from completed records')
    if 'verifiedHostedNativeObjects' in progress:
        require(progress['verifiedHostedNativeObjects'] == len(native_tiles), 'Progress hosted-object count differs from verified receipts')
    ledger = source_ledger(run / 'source-objects.jsonl', inputs)
    overview, overview_hash = read_json(args.overview)
    overview_root = args.overview.resolve().parent
    require(overview.get('complete') is True and overview.get('completeInputCorePlan') is True, 'Overview build is incomplete')
    require(args.allow_pilot or overview.get('pilot') is False, 'A pilot overview requires --allow-pilot')
    input_manifest_path = relative_path(overview_root, overview.get('inputManifest'), 'overview input manifest')
    overview_inputs, overview_inputs_hash = read_json(input_manifest_path)
    require(overview_inputs_hash == overview.get('inputManifestFileSha256') and sha_bytes(canonical(overview_inputs)) == overview.get('inputManifestCanonicalSha256'), 'Overview input-manifest hash differs')
    require(overview_inputs.get('runFingerprint') == fingerprint and overview_inputs.get('runManifestSha256') == run_hash and overview_inputs.get('corePlanSha256') == core_sha,
            'Overview belongs to a different native run or core plan')
    require(overview_inputs.get('sourceObjectLedgerSha256') == ledger['logSha256'], 'Overview source ledger differs from the completed run')
    overview_coords = set()
    for record in overview_inputs.get('records', []):
        xyz = coordinates(record.get('coordinatesXYZ'), 'overview input core', core=True)
        require(xyz not in overview_coords and xyz in local_overviews, 'Duplicate or foreign overview input tile')
        overview_coords.add(xyz)
        expected = local_overviews[xyz]
        require(all(record.get(k) == expected[k] for k in ('path', 'sha256', 'bytes', 'vertices', 'triangles', 'recordSha256')), 'Overview input artifact differs from the completed native run')
    require(overview_coords == core, 'Overview inputs do not cover the complete core plan')
    require(overview.get('nativeBankModified') is False and overview.get('displayLodIsLossy') is True and overview.get('inputOverviewBlocks') == len(core)
            and overview.get('inputOverviewTriangles') == totals['overviewCheckpointTriangles'], 'Overview totals or source-role declarations differ')
    transform = overview.get('coordinateTransform', {})
    require(transform.get('nativeDimensionsXYZ') == list(DIMENSIONS) and transform.get('nativeXYZCenter') == [3806.5, 3806.5, 4239.5]
            and transform.get('scaleNativeVoxels') == 8479 and transform.get('hfmPositionFlag') == 1, 'Overview world-coordinate transform is incompatible')
    receipts, receipt_files = load_receipts(args.overview_receipts)
    lods, missing, overview_receipts = [], [], []
    ids = set()
    for lod in overview.get('lods', []):
        require(lod.get('id') not in ids and isinstance(lod.get('id'), str), 'Duplicate or invalid overview LOD id')
        ids.add(lod['id'])
        parts = lod.get('parts')
        require(isinstance(parts, list) and 1 <= len(parts) <= 16 and lod.get('fingerprint') == overview.get('fingerprint'), 'Invalid multipart overview checkpoint')
        result_parts, triangle_sum, decoded_sum = [], 0, 0
        for part in parts:
            require(part.get('format') == 'HFM1' and part.get('positionFormat') == 'float32' and part.get('positionFlag') == 1, 'Overview part has a foreign mesh format')
            path = relative_path(overview_root, part.get('path'), 'HFM overview')
            header = verify_local(path, part, 'HFM overview')
            h = struct.unpack('<8I', header[:32])
            require(h[:2] == (0x314d4648, 1) and h[2] == part.get('vertices') and h[3] == part.get('triangles', -1) * 3 and h[7] == 1,
                    'HFM header differs from overview counts/format')
            require(h[4] == 32 and h[5] % 4 == 0 and h[6] % 4 == 0 and h[5] >= h[4] + h[2] * 12 and h[6] >= h[5] + h[2] * 6
                    and h[6] + h[3] * 4 == part['decodedBytes'], 'HFM layout is invalid')
            r = receipts.get(part['sha256'])
            if r is None:
                require(args.dry_run, 'Missing overview upload receipt for ' + part['path'])
                missing.append(dict(path=part['path'], sha256=part['sha256'], bytes=part['compressedBytes']))
                remote = None
            else:
                remote = receipt(r, part, 'overview', fixtures=args.fixture_receipts)
                fixtures_used |= remote.get('fixture', False)
                overview_receipts.append(dict(lod=lod['id'], artifact=part['path'], **remote))
            out = {k: part[k] for k in ('sha256', 'decodedSha256', 'compressedBytes', 'decodedBytes', 'vertices', 'triangles', 'format', 'positionFormat', 'positionFlag')}
            out['bytes'] = part['compressedBytes']
            if remote:
                out['url'] = remote['url']
            result_parts.append(out)
            triangle_sum += part['triangles']
            decoded_sum += part['decodedBytes']
        require(triangle_sum == lod.get('triangles') and decoded_sum <= MAX_DECODED, 'Overview part totals exceed the LOD counts or browser budget')
        lods.append(dict(id=lod['id'], label='Whole-heart display overview' if lod['id'] == 'overview' else 'Whole-heart display detail',
            vertices=lod['vertices'], triangles=triangle_sum, bounds=overview['bounds'], parts=result_parts,
            decodedBytes=decoded_sum, compressedBytes=sum(p['compressedBytes'] for p in result_parts),
            sampledDistances=lod['sampledDistances'], simplification=lod['simplification'], lossy=True))
    chosen = next((lod for lod in lods if lod['id'] == args.overview_lod), None)
    require(chosen is not None, 'Selected overview LOD is absent')
    native_tiles.sort(key=lambda r: tuple(r['xyz']))
    plan_entries.sort(key=lambda r: tuple(r['xyz']))
    record_inventory.sort(key=lambda r: tuple(r['xyz']))
    native_receipts.sort(key=lambda r: tuple(r['xyz']))
    default = min(native_tiles, key=lambda r: sum((x * 128 + 64 - (d - 1) / 2)**2 for x, d in zip(r['xyz'], DIMENSIONS)))
    default_xyz = [n * 128 + 64 for n in default['xyz']]
    scope = 'pilot-only' if args.allow_pilot else 'whole-plan'
    if args.allow_pilot:
        for lod in lods:
            lod['label'] = lod['label'].replace('Whole-heart', 'Pilot')
    report = dict(schema=SCHEMA + '-report', complete=True, completeScope=scope,
        dryRun=args.dry_run, publishable=not args.dry_run and not fixtures_used,
        fixtureReceipts=fixtures_used, plannedCoreBlocks=len(core), completedCoreBlocks=len(records),
        emptyBlocks=len(empty_tiles), nativeObjects=len(native_tiles), verifiedNativeReceipts=len(native_receipts),
        localOverviewCheckpointsVerified=len(local_overviews), overviewParts=sum(len(l['parts']) for l in lods),
        verifiedOverviewReceipts=len(overview_receipts), missingOverviewReceipts=missing,
        totals=totals, surfaceContribution=contribution, sourceUniqueObjects=ledger['uniqueObjects'],
        sourceDuplicateObservations=ledger['duplicateCoordinateObservations'],
        sourceUniqueEncodedBytes=ledger['uniqueObjectEncodedBytes'], runFingerprint=fingerprint,
        processingFingerprintReproduced=True, coverageCaveat=COVERAGE_CAVEAT)
    manifest = dict(schema=SCHEMA, complete=True, completeScope=scope, publishable=report['publishable'],
        fixtureOnly=fixtures_used, donorId='ladaf-2021-17', sourceSpacingUm=SPACING,
        dimensionsXYZ=list(DIMENSIONS), tiles=native_tiles, overview=chosen, overviewLods=lods,
        defaultRegionXYZ=default_xyz, bounds=overview['bounds'], processing=config,
        coverage=dict(plannedBlocks=len(core), completedBlocks=len(records), emptyBlocks=len(empty_tiles),
            plannedInputBlocks=len(inputs), availableSurfaceBlocks=len(native_tiles),
            **contribution, storedCrossingsIncludeSharedBoundaryDuplicates=True,
            wholeAnatomicalCoverageEstablished=False, nativeOnlyStructureSearchOutsidePrior=False,
            caveat=COVERAGE_CAVEAT),
        totals=totals,
        encoding=dict(format='NBE1', sourceGridPreserved=True, connectivity='Standard marching-cubes cases',
            crossingBits=5, crossingPositionBoundNativeVoxels=1 / 64,
            crossingPositionBoundUm=SPACING / 64, maximumMeasuredCrossingMovementUm=maximum_error,
            rmsStoredCrossingMovementUm=math.sqrt(weighted_squared_error / totals['nativeVertices']),
            boundReference='Processed scalar isosurface; not denoising, prior-guidance, registration or anatomical error'),
        coordinateTransform=transform,
        source=dict(url=SOURCE_URL, n5BlockShapeXYZ=[128, 128, 128], dtype='uint16 big-endian',
            dimensionsXYZ=list(DIMENSIONS), spacingUm=SPACING, objectLedger=ledger),
        provenance=dict(runFingerprint=fingerprint, reproducedFingerprint=reproduced,
            runManifestSha256=run_hash, progressSha256=progress_hash, processingFingerprintInputs=provenance,
            completedRecordsCanonicalSha256=sha_bytes(canonical(record_inventory)),
            overviewBuildManifestSha256=overview_hash,
            overviewInputManifestSha256=overview_inputs_hash,
            overviewInputCanonicalSha256=overview['inputManifestCanonicalSha256'],
            compilerSha256=file_hash(__file__), receiptFiles=receipt_files),
        completedPlan=plan_entries, emptyTiles=sorted(empty_tiles),
        verification=dict(method='Historical uploader receipts of full public GET byte count and SHA-256; no network requests during finalization',
            nativeReceipts=native_receipts, overviewReceipts=overview_receipts,
            localOverviewHashesVerified=True, processingFingerprintReproduced=True,
            fixtureOnly=fixtures_used, manifestUploadVerified=False))
    if args.evidence_url:
        require(args.evidence_url.startswith(('https://', 'http://')), 'Evidence URL must be HTTP(S)')
        manifest['evidenceUrl'] = args.evidence_url
    require(file_hash(run / 'run.json') == run_hash and file_hash(run / 'progress.json') == progress_hash
            and file_hash(run / 'source-objects.jsonl') == ledger['logSha256'], 'Run evidence changed while finalization was in progress')
    return manifest, report


def compressed_artifact(name, value, scope, fixture):
    decoded = canonical(value) + b'\n'
    encoded = gzip.compress(decoded, compresslevel=9, mtime=0)
    require(len(encoded) <= MAX_COMPRESSED, f'Compressed {name} exceeds the 32 MiB object limit')
    require(gzip.decompress(encoded) == decoded, f'{name} gzip round trip failed')
    info = dict(path=name + '.json.gz', sha256=sha_bytes(encoded), bytes=len(encoded),
        decodedSha256=sha_bytes(decoded), decodedBytes=len(decoded), completeScope=scope,
        fixtureOnly=fixture, uploadPerformed=False)
    info['suggestedRemotePath'] = 'manifest-' + info['sha256'] + '.json.gz'
    if not fixture:
        info['suggestedManifestUrl'] = SITE_URL + API + info['suggestedRemotePath']
    return decoded, encoded, info


def viewer_index(evidence, ledger, publishable):
    tile_keys = ('xyz', 'url', 'sha256', 'decodedSha256', 'bytes', 'decodedBytes', 'vertices', 'triangles')
    keep = ('schema', 'complete', 'completeScope', 'fixtureOnly', 'donorId', 'sourceSpacingUm',
        'dimensionsXYZ', 'overview', 'overviewLods', 'defaultRegionXYZ', 'bounds', 'processing',
        'coverage', 'totals', 'encoding', 'coordinateTransform')
    result = {key: evidence[key] for key in keep}
    result['publishable'] = publishable
    result['tiles'] = [{key: row[key] for key in tile_keys} for row in evidence['tiles']]
    objects = evidence['source']['objectLedger']
    result['source'] = {key: evidence['source'][key] for key in ('url', 'n5BlockShapeXYZ', 'dtype', 'dimensionsXYZ', 'spacingUm')}
    result['source'].update(uniqueObjectsRead=objects['uniqueObjects'],
        uniqueObjectEncodedBytes=objects['uniqueObjectEncodedBytes'],
        deduplicatedObjectsCanonicalSha256=objects['deduplicatedObjectsCanonicalSha256'])
    proof = evidence['provenance']
    result['provenance'] = {key: proof[key] for key in ('runFingerprint', 'reproducedFingerprint',
        'completedRecordsCanonicalSha256', 'overviewBuildManifestSha256', 'compilerSha256')}
    result['evidenceLedger'] = ledger
    if 'evidenceUrl' in evidence:
        result['evidenceUrl'] = evidence['evidenceUrl']
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run', type=Path, required=True)
    p.add_argument('--overview', type=Path, required=True, help='Completed overview-builder manifest.json')
    p.add_argument('--overview-receipts', type=Path, nargs='*', default=[])
    p.add_argument('--evidence-receipt', type=Path, help='Verified upload receipt for the evidence gzip from the first pass')
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--plan', '--core-plan', type=Path)
    p.add_argument('--input-plan', type=Path)
    p.add_argument('--processing-source', type=Path, default=Path(__file__).resolve().parent)
    p.add_argument('--prior-manifest', type=Path, default=Path(__file__).resolve().parents[2] / 'public/assets/ultra-volume-v7.json')
    p.add_argument('--overview-lod', default='overview')
    p.add_argument('--evidence-url')
    p.add_argument('--allow-pilot', action='store_true')
    p.add_argument('--fixture-receipts', action='store_true')
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()
    require(not args.fixture_receipts or args.allow_pilot, 'Fixture receipts require --allow-pilot')
    evidence, report = compile_manifest(args)
    args.out.mkdir(parents=True, exist_ok=True)
    if args.dry_run:
        atomic_bytes(args.out / 'dry-run-report.json', json.dumps(report, indent=2, allow_nan=False).encode() + b'\n')
    else:
        # This evidence object does not contain its own receipt or the viewer
        # index hash, so uploading it and rerunning cannot create a hash cycle.
        full_decoded, full_encoded, evidence_artifact = compressed_artifact('evidence', evidence,
            evidence['completeScope'], evidence['fixtureOnly'])
        ledger = {key: evidence_artifact[key] for key in ('sha256', 'bytes', 'decodedSha256', 'decodedBytes')}
        ledger.update(format='gzip JSON evidence ledger', browserLoadRequired=False, verified=False)
        publication_ready = False
        if args.evidence_receipt:
            evidence_receipt, _ = read_json(args.evidence_receipt)
            verified = receipt(evidence_receipt, evidence_artifact, 'evidence', fixtures=args.fixture_receipts)
            ledger.update(url=verified['url'], verified=verified['verified'])
            if 'verifiedAt' in verified:
                ledger['verifiedAt'] = verified['verifiedAt']
            publication_ready = evidence['publishable'] and not verified.get('fixture', False)
        report['publishable'] = publication_ready
        report['evidenceUploadReceiptPresent'] = args.evidence_receipt is not None
        report['nextStep'] = 'Upload the compact viewer index and verify its receipt before publishing the pointer.' if publication_ready else 'Upload evidence.json.gz, then rerun with its verified --evidence-receipt; do not publish this preliminary index.'
        manifest = viewer_index(evidence, ledger, publication_ready)
        decoded, encoded, artifact = compressed_artifact('manifest', manifest,
            manifest['completeScope'], manifest['fixtureOnly'])
        require(len(decoded) <= MAX_VIEWER_DECODED, 'Compact viewer index exceeds the existing 32 MiB decoded browser budget')
        artifact['publishable'] = publication_ready
        evidence_artifact['readyForUpload'] = not evidence['fixtureOnly']
        report['artifact'] = artifact
        report['evidenceArtifact'] = evidence_artifact
        atomic_bytes(args.out / 'evidence.json', full_decoded)
        atomic_bytes(args.out / 'evidence.json.gz', full_encoded)
        atomic_bytes(args.out / 'evidence-artifact.json', json.dumps(evidence_artifact, indent=2).encode() + b'\n')
        atomic_bytes(args.out / 'manifest.json', decoded)
        atomic_bytes(args.out / 'manifest.json.gz', encoded)
        atomic_bytes(args.out / 'artifact.json', json.dumps(artifact, indent=2).encode() + b'\n')
        atomic_bytes(args.out / 'report.json', json.dumps(report, indent=2, allow_nan=False).encode() + b'\n')
    print(json.dumps(report, separators=(',', ':'), allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except (ManifestError, UploadError, OSError, ValueError, KeyError, TypeError) as error:
        print('Manifest finalization refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
