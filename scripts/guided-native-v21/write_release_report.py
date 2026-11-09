#!/usr/bin/env python3
"""Write the evidence-derived release README after a complete, publishable bank.

Normal use needs no arguments after finalization at the standard whole-run paths.
No network request, processing, upload, source decoding, or publication is done.
An explicit --allow-pilot permits a completed pilot (including clearly marked
local receipt fixtures), but requires --output to be a separate file under /tmp.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
import tempfile


REPO = Path(__file__).resolve().parents[2]
DOCS = REPO / 'docs/guided-native-v21'
WHOLE = Path('/workspace/data/guided-native-v21/whole')
# Independent identity of the selected complete census plan and its scientific
# processing run. A small completed alternate plan must never acquire whole-plan
# wording merely because a caller omitted --allow-pilot. These pins do not imply
# completion; all subsequent completed-record and receipt checks remain required.
WHOLE_PLAN_SHA256 = '3be68c22b4f7a000b6e17b4c159f4d9a630b52884ea434624fc70c25999c6e94'
WHOLE_RUN_FINGERPRINT = '44a31c3adeb20e5a9a3d31f6868f9c92479920f533d2ea3c486e22b4aefa584a'
MIB = 1024 ** 2
CONTRIBUTIONS = ('nativeOnlyEdgeVertices', 'blendedEdgeVertices', 'priorOnlyEdgeVertices')
EXPECTED_CONFIG = {
    'halo': 16, 'thresholdRaw': 17133.4, 'tvWeightRaw': 800,
    'tvIterations': 16, 'tvStoppingEpsilon': 0, 'priorGaussianSigmaVoxels': .8,
    'thinGuard': True, 'nativeBandInnerVoxels': 8, 'nativeBandOuterVoxels': 12,
    'nativeSourceSpacingUm': 19.85, 'edgeCrossingBits': 5,
    'overviewSamplingStepNative': 4,
}


class ReportError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ReportError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path, maximum=None):
    require(path.is_file() and not path.is_symlink(), f'Missing or symbolic-link evidence file: {path}')
    digest = hashlib.sha256()
    size = 0
    with path.open('rb') as stream:
        while block := stream.read(MIB):
            size += len(block)
            require(maximum is None or size <= maximum, f'Evidence file exceeds its bound: {path}')
            digest.update(block)
    return digest.hexdigest(), size


def strict_json(raw, label):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f'Duplicate JSON key in {label}: {key}')
            result[key] = value
        return result

    def invalid(value):
        raise ReportError(f'Non-finite JSON value in {label}: {value}')

    value = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)
    require(isinstance(value, dict), f'Expected a JSON object: {label}')
    return value


def read_json(path, maximum=32*MIB):
    require(path.is_file() and not path.is_symlink(), f'Missing or symbolic-link JSON evidence: {path}')
    with path.open('rb') as stream:
        raw = stream.read(maximum+1)
    require(len(raw) <= maximum, f'JSON evidence exceeds its bound: {path}')
    return strict_json(raw, path.name), raw


def count(value, label):
    require(type(value) is int and value >= 0, f'Invalid nonnegative count: {label}')
    return value


def verify_gzip(path, descriptor, *, decoded_limit):
    expected = descriptor.get('bytes', descriptor.get('compressedBytes'))
    actual_sha, size = file_digest(path, 32*MIB)
    require(actual_sha == descriptor['sha256'] and size == expected,
            f'Compressed checksum/size mismatch: {path.name}')
    require(0 < descriptor['decodedBytes'] <= decoded_limit, f'Invalid decoded size: {path.name}')
    decoded_hash = hashlib.sha256()
    decoded_size = 0
    with gzip.open(path, 'rb') as stream:
        while block := stream.read(MIB):
            decoded_size += len(block)
            require(decoded_size <= descriptor['decodedBytes'], f'Gzip exceeded its decoded size: {path.name}')
            decoded_hash.update(block)
    require(decoded_size == descriptor['decodedBytes'] and decoded_hash.hexdigest() == descriptor['decodedSha256'],
            f'Decoded checksum/size mismatch: {path.name}')


def child(root, name):
    require(isinstance(name, str) and name and not Path(name).is_absolute(), 'Expected a relative evidence path')
    require('\\' not in name and all(p not in ('.', '..') for p in name.split('/')), 'Unsafe relative evidence path')
    path = root / name
    require(path.resolve().is_relative_to(root.resolve()), 'Evidence path escapes its directory')
    return path


def coordinate_tuple(value, label):
    require(isinstance(value, (list, tuple)) and len(value) == 3
            and all(type(n) is int and 0 <= n for n in value), f'Invalid coordinates: {label}')
    return tuple(value)


def overview_sampling_summary(native_tiles, overview_records, nonempty_record_coordinates):
    """Join the complete native index to its original step-4 display inputs.

    A zero-triangle display checkpoint cannot remove a nonempty native entry.
    The native record statuses are checked independently of the display input.
    This measures omission at step-4 sampling, before later LOD simplification.
    """
    native = {}
    for tile in native_tiles:
        coord = coordinate_tuple(tile['xyz'], 'native index')
        require(coord not in native, 'Duplicate native index coordinate in sampling join')
        require(count(tile['triangles'], 'native triangles') > 0, 'Native index contains an empty artifact')
        native[coord] = tile
    require(set(native) == set(nonempty_record_coordinates),
            'Native index omits or adds a nonempty completed record; display sampling cannot filter the native index')
    observed, omitted = set(), []
    overview_nonempty = 0
    for record in overview_records:
        coord = coordinate_tuple(record['coordinatesXYZ'], 'overview input')
        require(coord not in observed, 'Duplicate overview input coordinate in sampling join')
        observed.add(coord)
        triangles = count(record['triangles'], 'overview input triangles')
        overview_nonempty += int(triangles > 0)
        require(coord in native or triangles == 0, 'Empty native field has a nonempty overview input')
        if coord in native and triangles == 0:
            omitted.append(coord)
    require(set(native) <= observed, 'Native index has no matching overview input record')
    return dict(samplingStepNative=4, meshSampleSpacingUm=79.4,
        inputOverviewBlocks=len(observed), inputOverviewNonemptyBlocks=overview_nonempty,
        inputOverviewEmptyBlocks=len(observed)-overview_nonempty,
        nonemptyNativeBlocksWithoutOverviewCrossings=len(omitted),
        nativeTrianglesInThoseBlocks=sum(native[c]['triangles'] for c in omitted),
        nativeIndexEntriesRetained=len(native), nativeIndexIncludesEveryNonemptyRecord=True,
        scope='Display omission at step-4 sampling before simplification; all nonempty native artifacts remain in the complete native index.')


def source_generation_summary(path, expected_log_sha, source):
    """Count generation availability from the hashed original-object ledger.

    Stream observations and retain only one compact identity per coordinate.
    Reproduce the finalizer's canonical deduplicated identity hash without
    loading the comprehensive evidence JSON into memory.
    """
    objects, observations = {}, 0
    raw_hash = hashlib.sha256()
    with path.open('rb') as stream:
        for line in stream:
            raw_hash.update(line)
            row = strict_json(line, 'source-object ledger')
            coord = coordinate_tuple(row['coordinatesXYZ'], 'source object')
            size = count(row['bytes'], 'source-object bytes')
            require(0 < size <= 5*MIB and re.fullmatch(r'[a-f0-9]{64}', row['sha256']) is not None,
                    'Invalid source-object byte identity')
            generation = row.get('generation')
            require(generation is None or isinstance(generation, str), 'Invalid source generation')
            require(type(row.get('cached')) is bool, 'Missing source cache flag')
            if coord not in objects:
                objects[coord] = dict(xyz=list(coord), bytes=size, sha256=row['sha256'],
                    generations=set(), allObservationsCached=True)
            obj = objects[coord]
            require(obj['bytes'] == size and obj['sha256'] == row['sha256'],
                    'Conflicting original-source byte identities')
            if generation is not None:
                obj['generations'].add(generation)
            obj['allObservationsCached'] &= row['cached']
            observations += 1
    require(raw_hash.hexdigest() == expected_log_sha, 'Source-object ledger changed during generation audit')
    canonical_hash = hashlib.sha256(b'[')
    unknown, unknown_bytes, unknown_cached, multiple = 0, 0, 0, 0
    for index, coord in enumerate(sorted(objects)):
        obj = objects[coord]
        missing = not obj['generations']
        unknown += int(missing)
        unknown_bytes += obj['bytes'] if missing else 0
        unknown_cached += int(missing and obj['allObservationsCached'])
        multiple += int(len(obj['generations']) > 1)
        row = {key:obj[key] for key in ('xyz','bytes','sha256')}
        row['generations'] = sorted(obj['generations'])
        if index:
            canonical_hash.update(b',')
        canonical_hash.update(json.dumps(row,sort_keys=True,separators=(',', ':'),allow_nan=False).encode())
    canonical_hash.update(b']')
    require(len(objects) == source['uniqueObjectsRead']
            and sum(v['bytes'] for v in objects.values()) == source['uniqueObjectEncodedBytes']
            and canonical_hash.hexdigest() == source['deduplicatedObjectsCanonicalSha256'],
            'Generation audit does not reproduce the finalized source ledger')
    return dict(uniqueObjects=len(objects), observations=observations,
        generationRecordedObjects=len(objects)-unknown, generationUnavailableObjects=unknown,
        generationUnavailableEncodedBytes=unknown_bytes,
        generationUnavailableObjectsObservedOnlyFromCache=unknown_cached,
        multipleGenerationsWithIdenticalBytesObjects=multiple,
        allObjectsRetainExactSha256AndBytes=True, logSha256=expected_log_sha,
        deduplicatedObjectsCanonicalSha256=canonical_hash.hexdigest(),
        scope='Missing GCS generation metadata does not remove the recorded original-object SHA-256, byte count or source coordinate.')


def verify_whole_figure(overview, overview_sha, source_inputs, render_path=None):
    """Bind the production whole-heart figure to the exact completed detail LOD."""
    render_path = render_path or DOCS/'whole-detail-render/render-record.json'
    render, raw = read_json(render_path, MIB)
    require(render.get('schema') == 'guided-native-whole-scientific-render-v21.1'
            and render.get('scope') == 'whole-plan' and render.get('lod') == 'detail'
            and render.get('manifestSha256') == overview_sha
            and render.get('overviewFingerprint') == overview['fingerprint'],
            'Whole-detail figure belongs to a different overview manifest or scope')
    require(overview.get('complete') is True and overview.get('pilot') is False
            and source_inputs.get('runFingerprint') == WHOLE_RUN_FINGERPRINT
            and source_inputs.get('corePlanSha256') == WHOLE_PLAN_SHA256,
            'Whole-detail figure requires the completed independently pinned whole plan')
    identity = render['sourceIdentity']
    for key in ('runFingerprint','runManifestSha256','corePlanSha256',
                'sourceObjectLedgerSha256','plannedCoreBlocks','completedOverviewBlocks','sourceConfiguration'):
        require(identity.get(key) == source_inputs.get(key), 'Whole-detail render source provenance differs')
    matches = [lod for lod in overview['lods'] if lod['id'] == 'detail']
    require(len(matches) == 1, 'Completed overview lacks its unique detail LOD')
    lod = matches[0]
    require(render.get('lodTriangles') == lod['triangles']
            and render.get('lodVertices') == lod['vertices']
            and len(render['parts']) == len(lod['parts']), 'Whole-detail render LOD counts differ')
    for part, recorded in zip(lod['parts'],render['parts']):
        require(all(part[key] == recorded.get(key) for key in
                ('path','sha256','decodedSha256','compressedBytes','decodedBytes','vertices','triangles')),
                'Whole-detail render artifact differs from the completed detail LOD')
    require(render.get('nativeSourceSpacingUm') == 19.85 and render.get('inputOverviewSamplingUm') == 79.4
            and render.get('notBrowserScreenshot') is True and render.get('displayLodNotNativeGrid') is True
            and render.get('displayLodIsLossy') is True and render.get('coverageCompleteForRecordedPlan') is True
            and render.get('wholeAnatomicalCoverageEstablished') is False,
            'Whole-detail figure lacks its scientific-render/display-only qualifications')
    require(render.get('coordinateTransform') == overview['coordinateTransform']
            and render.get('geometryModification') is False and render.get('extraSmoothing') is False
            and render.get('extraSimplification') is False and render['cutaway'].get('caps') is False
            and render['scaleBar'].get('lengthMm') == 20, 'Whole-detail render policy differs from its caption')
    for key in ('exterior','cutaway'):
        item = render['outputs'][key]
        require(item['submittedTriangles'] == lod['triangles'], 'Whole-detail render skipped geometry')
        require(file_digest(child(render_path.parent,item['path'])) == (item['sha256'],item['bytes']),
                'Whole-detail view image differs from its render record')
    figure = render['figure']
    figure_path = child(render_path.parent,figure['path'])
    require(file_digest(figure_path) == (figure['sha256'],figure['bytes']), 'Whole-detail figure checksum differs')
    with figure_path.open('rb') as stream:
        header = stream.read(24)
    require(header[:8] == b'\x89PNG\r\n\x1a\n' and header[12:16] == b'IHDR'
            and struct.unpack('>II',header[16:24]) == (figure['width'],figure['height']),
            'Whole-detail figure PNG dimensions differ')
    return figure_path, dict(renderRecord=render_path.relative_to(REPO).as_posix(),
        renderRecordSha256=sha(raw), figure=figure_path.relative_to(REPO).as_posix(),
        figureSha256=figure['sha256'], figureBytes=figure['bytes'],
        lod='detail', triangles=lod['triangles'], inputOverviewSamplingUm=79.4,
        displayLodNotNativeGrid=True, notBrowserScreenshot=True,
        overviewManifestSha256=overview_sha, overviewFingerprint=overview['fingerprint'],
        parts=[{key:part[key] for key in ('sha256','decodedSha256','compressedBytes','decodedBytes')}
               for part in lod['parts']])


def link(output, path, label):
    # The production README uses repository-relative links. Pilot previews use
    # absolute local links so their evidence remains identifiable outside the repo.
    target = os.path.relpath(path, output.parent) if output.is_relative_to(REPO) else str(path)
    return f'[{label}]({target})'


def read_inputs(args):
    output = args.output.resolve()
    if args.allow_pilot:
        require(output.is_relative_to(Path('/tmp')) and output.name != 'README.md',
                '--allow-pilot requires a separate, explicitly named output under /tmp, not README.md')
    else:
        require(not args.output.is_symlink(), 'Report output cannot be a symbolic link')

    run, run_raw = read_json(args.run/'run.json', MIB)
    progress, progress_raw = read_json(args.run/'progress.json', MIB)
    # This gate deliberately precedes reading final files, so an active run never
    # produces a partial report or needs its not-yet-created final assets.
    require(progress.get('complete') is True and progress.get('phase') == 'complete'
            and progress.get('error') is None,
            'Run is unfinished or failed; no release report was written')
    require(progress.get('completedCoreBlocks') == run.get('coreBlocks')
            == progress.get('plannedCoreBlocks'), 'Run/progress completion counts disagree')
    if not args.allow_pilot:
        require(run.get('fingerprint') == WHOLE_RUN_FINGERPRINT,
                'Run is not the independently pinned whole-plan processing run; an alternate plan requires --allow-pilot')
        for field in ('inputPlan','corePlan'):
            plan_path = Path(run[field])
            if not plan_path.is_absolute():
                plan_path = args.run/plan_path
            require(file_digest(plan_path,8*MIB)[0] == WHOLE_PLAN_SHA256,
                    f'{field} is not the independently pinned whole-heart census plan')

    manifest, manifest_raw = read_json(args.final_manifest/'manifest.json')
    report, report_raw = read_json(args.final_manifest/'report.json', MIB)
    artifact, _ = read_json(args.final_manifest/'artifact.json', MIB)
    evidence_artifact, _ = read_json(args.final_manifest/'evidence-artifact.json', MIB)
    overview, overview_raw = read_json(args.overview, 8*MIB)
    require(manifest.get('schema') == 'guided-native-manifest-v21.1', 'Unsupported final-manifest schema')
    scope = 'pilot-only' if args.allow_pilot else 'whole-plan'
    require(manifest.get('complete') is True and manifest.get('completeScope') == scope,
            f'Final manifest must be complete with completeScope={scope!r}')
    require(report.get('complete') is True and report.get('completeScope') == scope
            and report.get('dryRun') is False, 'Finalization report is incomplete or has another scope')
    require(artifact.get('completeScope') == scope, 'Artifact scope differs from the final manifest')
    fixture = bool(manifest.get('fixtureOnly'))
    if not args.allow_pilot:
        require(not fixture and not report.get('fixtureReceipts') and not artifact.get('fixtureOnly'),
                'Fixture receipts cannot produce a release report')
        require(manifest.get('publishable') is True and report.get('publishable') is True
                and artifact.get('publishable') is True,
                'Final manifest is not publishable; verified overview/evidence receipts are required')
        ledger = manifest.get('evidenceLedger', {})
        require(ledger.get('verified') is True and isinstance(ledger.get('url'), str)
                and ledger['url'].startswith('https://') and 'example.invalid' not in ledger['url'],
                'The production evidence ledger lacks its verified remote receipt')
    elif fixture:
        require(manifest.get('publishable') is False, 'A fixture cannot be publishable')

    require(overview.get('complete') is True and overview.get('completeInputCorePlan') is True
            and overview.get('pilot') is args.allow_pilot, 'Overview is incomplete or has another scope')
    require(overview.get('nativeBankModified') is False and overview.get('displayLodIsLossy') is True,
            'Overview must explicitly preserve the native archive and declare display loss')
    require(overview.get('hierarchy',{}).get('frozenGroupBoundariesVerified') is True,
            'Overview hierarchy lacks its frozen-boundary verification')
    require(manifest.get('dimensionsXYZ') == [7614,7614,8480]
            and manifest.get('sourceSpacingUm') == 19.85, 'Report is specific to this native source')
    fingerprint = run.get('fingerprint')
    proof = manifest['provenance']
    require(proof.get('runFingerprint') == proof.get('reproducedFingerprint')
            == report.get('runFingerprint') == fingerprint
            and report.get('processingFingerprintReproduced') is True, 'Processing fingerprints disagree')
    require(proof.get('overviewBuildManifestSha256') == sha(overview_raw), 'Overview manifest has changed since finalization')
    config = manifest['processing']
    require(config == run['config'], 'Final processing configuration differs from its run')
    require(all(config.get(k) == v for k,v in EXPECTED_CONFIG.items()),
            'Processing parameters differ from the method described by this report generator')
    require(manifest['coordinateTransform'] == overview['coordinateTransform'], 'Coordinate transforms disagree')
    require(manifest['encoding'].get('format') == 'NBE1'
            and manifest['encoding'].get('crossingBits') == 5
            and manifest['encoding'].get('crossingPositionBoundNativeVoxels') == 1/64
            and manifest['encoding'].get('crossingPositionBoundUm') == 19.85/64,
            'Native encoding differs from the described five-bit crossing bound')
    require(sha(manifest_raw) == artifact['decodedSha256'] and len(manifest_raw) == artifact['decodedBytes'],
            'Plain final manifest differs from its content-addressed artifact')
    require(report.get('artifact') == artifact and report.get('evidenceArtifact') == evidence_artifact,
            'Final report artifact descriptors disagree')
    verify_gzip(child(args.final_manifest, artifact['path']), artifact, decoded_limit=32*MIB)
    verify_gzip(child(args.final_manifest, evidence_artifact['path']), evidence_artifact, decoded_limit=512*MIB)
    require(all(manifest['evidenceLedger'].get(k) == evidence_artifact[k]
                for k in ('sha256','bytes','decodedSha256','decodedBytes')), 'Evidence ledger descriptors disagree')

    coverage, totals, source = manifest['coverage'], manifest['totals'], manifest['source']
    planned = count(coverage['plannedBlocks'], 'planned blocks')
    completed = count(coverage['completedBlocks'], 'completed blocks')
    empty = count(coverage['emptyBlocks'], 'empty blocks')
    tiles = manifest['tiles']
    require(planned == completed == run['coreBlocks'] == overview['inputOverviewBlocks']
            == report['plannedCoreBlocks'] == report['completedCoreBlocks'], 'Final coverage counts disagree')
    require(coverage['plannedInputBlocks'] == run['inputBlocks'] == progress['plannedInputBlocks'], 'Input-plan counts disagree')
    require(len(tiles) + empty == completed and len(tiles) == coverage['availableSurfaceBlocks']
            == progress['nonemptyTiles'] == report['nativeObjects'] == report['verifiedNativeReceipts']
            == progress['verifiedHostedNativeObjects'], 'Empty/nonempty or verified-object counts disagree')
    require(report['localOverviewCheckpointsVerified'] == completed, 'Not every local overview was verified')
    unique = set()
    for tile in tiles:
        xyz = tile['xyz']
        require(len(xyz) == 3 and all(type(n) is int and 0 <= n for n in xyz), 'Invalid native tile coordinate')
        require(tuple(xyz) not in unique, 'Duplicate native tile coordinate in final index')
        unique.add(tuple(xyz))
    for tile_key, total_key in [('triangles','nativeTriangles'), ('vertices','nativeVertices'),
                                ('bytes','nativeCompressedBytes'), ('decodedBytes','nativeDecodedBytes')]:
        require(sum(count(t[tile_key],tile_key) for t in tiles) == totals[total_key], f'Tile sum differs: {total_key}')
    require(totals == report['totals'], 'Final manifest/report totals disagree')
    require(sum(count(coverage[k],k) for k in CONTRIBUTIONS) == totals['nativeVertices'], 'Stored-crossing categories do not sum to all crossings')
    require(all(coverage[k] == progress['surfaceContribution'][k] == report['surfaceContribution'][k]
                for k in CONTRIBUTIONS), 'Surface-contribution counts disagree')
    require(source['uniqueObjectsRead'] == report['sourceUniqueObjects']
            and source['uniqueObjectEncodedBytes'] == report['sourceUniqueEncodedBytes'], 'Source-ledger totals disagree')
    require(coverage.get('wholeAnatomicalCoverageEstablished') is False
            and coverage.get('nativeOnlyStructureSearchOutsidePrior') is False
            and coverage.get('storedCrossingsIncludeSharedBoundaryDuplicates') is True,
            'Required anatomical-coverage and crossing-count qualifications are missing')

    overview_input_path = child(args.overview.parent, overview['inputManifest'])
    overview_inputs, overview_input_raw = read_json(overview_input_path, 64*MIB)
    require(sha(overview_input_raw) == overview['inputManifestFileSha256']
            and overview_inputs['runFingerprint'] == fingerprint
            and overview_inputs['runManifestSha256'] == sha(run_raw), 'Overview input identity has changed')
    require(overview_inputs['sourceObjectLedgerSha256'] == file_digest(args.run/'source-objects.jsonl')[0],
            'Source-object log changed after overview construction')
    records = overview_inputs['records']
    require(len(records) == completed, 'Overview input record count differs from the complete plan')
    worker_peak = 0.0
    nonempty_record_coordinates = set()
    for item in records:
        # Input records identify the overview by canonical XYZ filename.
        basename = Path(item['path']).name.removesuffix('.lod.nbe.gz')
        require(re.fullmatch(r'\d+_\d+_\d+', basename) is not None, 'Noncanonical overview input filename')
        record_path = args.run/'records'/f'{basename}.json'
        record, raw = read_json(record_path, MIB)
        require(sha(raw) == item['recordSha256'] and record.get('fingerprint') == fingerprint,
                'A completed record changed after overview construction')
        coord = coordinate_tuple(item['coordinatesXYZ'], 'overview input record')
        require(coordinate_tuple(record['coordinatesXYZ'], 'completed record') == coord
                and basename == '_'.join(map(str, coord)), 'Overview/native record coordinates disagree')
        require(type(record.get('empty')) is bool, 'Completed record lacks an explicit empty status')
        if not record['empty']:
            nonempty_record_coordinates.add(coord)
        local_overview = [a for a in record['artifacts'] if a.get('role') == 'overview']
        require(len(local_overview) == 1 and all(local_overview[0][key] == item[key]
                for key in ('path','sha256','bytes','vertices','triangles')),
                'Overview input differs from its hashed completed record')
        peak = record.get('peakWorkerRssMiB', 0)
        require(isinstance(peak,(int,float)) and math.isfinite(peak) and peak >= 0, 'Invalid recorded worker RSS')
        worker_peak = max(worker_peak, peak)
    require(worker_peak > 0, 'Completed records lack a measured worker RSS')
    sampling = overview_sampling_summary(tiles, records, nonempty_record_coordinates)
    generations = source_generation_summary(args.run/'source-objects.jsonl',
        overview_inputs['sourceObjectLedgerSha256'], source)

    final_lods = {v['id']:v for v in manifest['overviewLods']}
    require(len(final_lods) == len(overview['lods']), 'Display LOD sets disagree')
    part_count = sum(len(lod['parts']) for lod in overview['lods'])
    require(report['overviewParts'] == report['verifiedOverviewReceipts'] == part_count
            and report['missingOverviewReceipts'] == [], 'Display-part receipt counts disagree')
    for lod in overview['lods']:
        final_lod = final_lods[lod['id']]
        require(lod['triangles'] == final_lod['triangles']
                and lod['sampledDistances'] == final_lod['sampledDistances'], 'Display LOD measurements disagree')
        require(len(lod['parts']) == len(final_lod['parts']), 'Display LOD part counts disagree')
        for part, remote in zip(lod['parts'], final_lod['parts']):
            require(all(part[k] == remote[k] for k in ('sha256','decodedSha256','decodedBytes','compressedBytes','triangles','vertices')),
                    'Display LOD part metadata disagree')
            verify_gzip(child(args.overview.parent,part['path']), part, decoded_limit=128*MIB)

    whole_figure, whole_figure_provenance = None, None
    if not args.allow_pilot:
        whole_figure, whole_figure_provenance = verify_whole_figure(overview,sha(overview_raw),overview_inputs)

    evidence_names = ('pyramid-alignment.json', 'tv-kernel-verification.json',
        'browser-edge-decoder.json', 'whole-viewer-gl-check.json', 'denoising/measurements.json',
        'denoising/surface-render-record.json', 'denoising/seam-validation.json',
        'production-recovery-verification.json')
    local_evidence = {name:read_json(DOCS/name)[0] for name in evidence_names}
    render = local_evidence['denoising/surface-render-record.json']
    figure_path = child(DOCS/'denoising', render['figure']['path'])
    figure_sha, figure_bytes = file_digest(figure_path)
    require(figure_sha == render['figure']['sha256'] and figure_bytes == render['figure']['bytes'],
            'The measured 3D figure differs from its render record')
    require(render.get('notBrowserScreenshot') is True and render.get('allMethodsShareCameraLightingCropNormalPolicy') is True,
            'Figure provenance does not support the described scientific comparison')
    require(local_evidence['tv-kernel-verification.json']['allChecksPassed'] is True
            and local_evidence['whole-viewer-gl-check.json']['passed'] is True
            and local_evidence['denoising/seam-validation.json']['fixedTV16Halo16']['sharedPlaneExact'] is True,
            'A required numerical or graphics evidence check is not passing')
    recovery = local_evidence['production-recovery-verification.json']
    restored, compatibility = recovery['restore'], recovery['runnerCompatibility']
    require(restored['fingerprint'] == compatibility['fingerprint'] == WHOLE_RUN_FINGERPRINT
            and restored['restoredRecords'] == compatibility['restoredRecords']
            and compatibility['recordsByteIdentical'] is True
            and compatibility['currentRunnerRecognizesAllRecords'] is True
            and compatibility['sourceLedgerIsExactOriginalPrefix'] is True
            and restored['sourceIntensityBytesDownloaded'] == restored['nativeSurfacePayloadBytesDownloaded']
            == compatibility['sourceRequests'] == 0, 'Production recovery evidence is inconsistent')
    return dict(output=output, run=run, progress=progress, manifest=manifest, report=report,
        artifact=artifact, evidenceArtifact=evidence_artifact, overview=overview,
        fixture=fixture, pilot=args.allow_pilot, evidence=local_evidence, figure=figure_path,
        wholeFigure=whole_figure, wholeFigureProvenance=whole_figure_provenance,
        overviewSampling=sampling, sourceGenerationMetadata=generations,
        maximumRecordedWorkerRssMiB=worker_peak,
        inputHashes=dict(run=sha(run_raw),progress=sha(progress_raw),manifest=sha(manifest_raw),
            finalizationReport=sha(report_raw),overview=sha(overview_raw),
            localEvidence={name:file_digest(DOCS/name)[0] for name in evidence_names}))


def byte_label(value):
    return f'{value:,} bytes ({value/1024**3:.3f} GiB)' if value >= 1024**3 else f'{value:,} bytes ({value/MIB:.2f} MiB)'


def render_report(data):
    m, o, p = data['manifest'], data['overview'], data['progress']
    c, t, source = m['coverage'], m['totals'], m['source']
    output = data['output']
    ref = lambda name,label: link(output,DOCS/name,label)
    repo_ref = lambda name,label: link(output,REPO/name,label)
    ev = data['evidence']
    measures = ev['denoising/measurements.json']
    selected = measures['selectedRegion']['methods']
    regional = measures['regionalAggregate']
    alignment = ev['pyramid-alignment.json']
    decoder = ev['browser-edge-decoder.json']
    kernel = ev['tv-kernel-verification.json']
    recovery = ev['production-recovery-verification.json']['restore']
    title = 'Whole-heart native refinement: LADAF-2021-17'
    if data['pilot']:
        title = 'PILOT REPORT VALIDATION — not a whole-heart release'
        status = ('**Pilot-only scope.** The counts below cover the completed bounded pilot, '
                  'not the whole-heart plan. This temporary report tests report generation. '
                  + ('Its display/evidence receipt fixtures are local test data; this manifest is **not publishable**.'
                     if data['fixture'] else 'It does not authorize or certify a whole-heart release.'))
        scope_description = 'the recorded bounded pilot'
        closing_scope = 'This pilot validates the report workflow; it does not fulfill the requested whole-organ scope.'
    else:
        status = (f'**The entire recorded whole-heart boundary plan is complete:** {c["completedBlocks"]:,} '
                  f'of {c["plannedBlocks"]:,} planned blocks. The final manifest is publishable, with verified '
                  'native, display and evidence receipts. Completion refers to this coarse-guided plan; '
                  'it does not establish that every anatomical structure in the organ was found.')
        scope_description = 'the recorded organ-wide search plan'
        closing_scope = 'The whole-plan result addresses the requested spatial scope within its recorded guide.'
    overview_rows = []
    for lod in o['lods']:
        d = lod['sampledDistances']
        forward = d['originalOverviewToStoredDisplay']
        reverse = d['storedDisplayToOriginalOverview']
        overview_rows.append(f'| {lod["id"]} | {lod["triangles"]:,} | {len(lod["parts"])} | '
            f'{sum(v["compressedBytes"] for v in lod["parts"])/MIB:.2f} | '
            f'{forward["p95Um"]:.2f} / {forward["maximumSampledUm"]:.2f} | '
            f'{reverse["p95Um"]:.2f} / {reverse["maximumSampledUm"]:.2f} |')
    # progress.decodedSourceCacheBlocks is occupancy, not capacity; final cleanup
    # can correctly reduce it to zero before the complete snapshot is written.
    cache_text = 'Decoded current-source blocks use a bounded LRU cache. '
    ledger = m['evidenceLedger']
    ledger_link = (f'[complete evidence ledger]({ledger["url"]})' if ledger.get('verified') is True
                   else ('**local fixture evidence ledger (not a verified production object)**' if data['fixture']
                         else '**local evidence ledger (awaiting a verified remote receipt)**'))
    receipt_scope = ('real native receipts and explicitly marked display/evidence receipt fixtures'
                     if data['fixture'] else 'verified remote receipts')
    summary_path = output.with_suffix('.json') if data['pilot'] else output.with_name('release-report.json')
    figure_target = os.path.relpath(data['figure'],output.parent) if output.is_relative_to(REPO) else str(data['figure'])
    raw_threshold = struct.unpack('<f',struct.pack('<f',m['processing']['thresholdRaw']))[0]
    hierarchy = o['hierarchy']
    sampling, generations = data['overviewSampling'], data['sourceGenerationMetadata']
    whole_figure_section = ''
    if data['wholeFigure'] is not None:
        image_target = os.path.relpath(data['wholeFigure'],output.parent) if output.is_relative_to(REPO) else str(data['wholeFigure'])
        whole_figure_section = f'''## Whole-heart display figure

![Completed whole-heart display detail: exterior and open oblique section, with 20 mm scale bars.]({image_target})

This figure renders the completed **{data['wholeFigureProvenance']['triangles']:,}-triangle display detail**, derived from the **79.4 µm step-4** surface and simplified for navigation. It is a lossy display, not the 19.85 µm native surface bank. Exterior and cutaway use matched camera and lighting, stored normals, acquisition axes and 20 mm scale bars; the open oblique section has no inferred anatomical orientation or added caps. No further smoothing or simplification was applied for the image. This is a scientific EGL rendering, not a browser screenshot. {ref('whole-detail-render/render-record.json','The checked render record')} binds the figure to the exact final manifest and compressed/decoded HFM hashes.

'''
    if 'primaryClusteringCellLimitNativeVoxels' in hierarchy:
        hierarchy_method = (
            'Nearby groups are welded at exact 1/16-native-voxel positions. Intermediate reduction '
            'freezes group-plane vertices and their incident-face ring, then verifies exact boundary '
            'coordinates and one-face seam edges. Free-vertex clustering uses bounded global cells; '
            f'the recorded maximum used is {hierarchy["maximumClusterCellNativeVoxels"]} native voxels. '
            'Constrained QEM accepts current free/free edges within one global cell and preserves the '
            'frozen ring. A bounded parent clustering fallback can merge additional components only '
            'when the immutable ring fits the target. '
            f'This build records {hierarchy["vertexClusteringNodes"]:,} clustering nodes and '
            f'{hierarchy["parentClusteringFallbackNodes"]:,} parent fallbacks. '
            'All original leaf samples remain available for the final error comparisons. '
            f'{ref("overview-fallback-verification.json","The bounded fallback QA")} records '
            'the dense-leaf seam checks and directional sampled errors. These display operations '
            'can remove components, alter topology or introduce intersections.')
    else:
        hierarchy_method = ('Nearby groups are welded at exact 1/16-native-voxel positions, '
            'simplified with verified frozen group boundaries, and checkpointed through bounded '
            'hierarchical merges. This earlier pilot used the original intermediate decimator.')
    text = f'''# {title}

{status}

The recorded result uses the original **19.85 µm** LADAF-2021-17 samples to refine the surface throughout {scope_description}. The earlier 128³-region experiment established feasibility and exposed raw threshold noise; its small extent was not the whole-organ deliverable. This report is generated from completed run records and finalized manifests, without projected counts. The {ledger_link} carries the full source-object and artifact provenance.

## Recorded coverage and storage

| Quantity | Completed result |
|---|---:|
| Planned / completed core blocks | {c['plannedBlocks']:,} / {c['completedBlocks']:,} |
| Planned input blocks | {c['plannedInputBlocks']:,} |
| Nonempty native surface blocks | {c['availableSurfaceBlocks']:,} |
| Empty processed blocks | {c['emptyBlocks']:,} |
| Native-grid triangles across stored tiles | {t['nativeTriangles']:,} |
| Stored native-grid edge crossings | {t['nativeVertices']:,} |
| Compressed native surface bank | {byte_label(t['nativeCompressedBytes'])} |
| Distinct original N5 source objects read | {source['uniqueObjectsRead']:,} |
| Distinct original encoded source bytes | {byte_label(source['uniqueObjectEncodedBytes'])} |
| Native-only / blended / prior-only stored crossings | {c['nativeOnlyEdgeVertices']:,} / {c['blendedEdgeVertices']:,} / {c['priorOnlyEdgeVertices']:,} |

Empty means the processed scalar tile contains no threshold crossing; it does not mean the raw scan contains no tissue. Crossing counts include shared-boundary duplicates. The three contribution categories classify endpoint blend weights at stored edges, not disjoint surface area or anatomical completeness. Distinct source bytes are deduplicated original-object sizes, not total network traffic: resumes, cache hits and retries make those quantities different. The source remains the original **7614 × 7614 × 8480**, big-endian uint16 N5 volume.

GCS generation metadata is absent for **{generations['generationUnavailableObjects']:,}** distinct source objects. Every object still has its exact SHA-256, byte count and coordinate in the evidence ledger; the generation count is recomputed from that ledger's hashed observation log.

## Opening the result

Choose LADAF-2021-17 in Heart Explorer, open **Settings**, and follow **Explore the whole-heart native refinement →**, or open {repo_ref('public/whole-native.html','whole-native.html')}. The left pane provides a separately simplified whole-heart display; selecting tissue opens a 128-cell native-grid region in the right pane. Each region spans **2.5408 mm**. Cameras, sections and their controls remain independent; crop and section boundaries are open, without invented caps. Coordinate selection uses the original scan axes. If the exact block has no available surface, the UI identifies its available-region selection rather than implying that an unprocessed block was reconstructed.

The existing coarse volume and 79.4 µm fine display remain useful context. Their spacing must not be confused with the 19.85 µm samples underlying the native bank. The separate cMAC/SlicerHeart source-selector repair changed the HOA page's validation guard from the HOA-only `DONORS` collection to `ALL_SOURCES`. The actual-DOM regression covers both clinical transitions and return to HOA, cancellation and URL state; see {repo_ref('docs/native-surface-v20/README.md','the earlier source-selector report')} and {repo_ref('tests/clinical-ui-v19.mjs','its regression test')}.

{whole_figure_section}## Source alignment, guidance and filtering

The prior is the existing cleaned, windowed 79.4 µm s2 bank, whose full source dimensions are **1903 × 1903 × 2120**. Each axis uses center-resize registration:

`native_index = (prior_index + 0.5) × (native_dimension / prior_dimension) − 0.5`.

This matters because X and Y are not exactly four times their s2 dimensions. The recorded comparison tested {len(alignment['blocks'])} separated source locations; its largest fitted residual shift was {alignment['maximumAbsoluteFittedShiftNative']:.4f} native voxels under an approximate pyramid operator. It tests registration consistency, not biological accuracy. Details and source hashes are in {ref('pyramid-alignment.json','the alignment record')}.

The guide includes mixed cells at the smoothed 0.28 threshold, plus raw 0.28 and smoothed 0.20 guards for thin structures. Prior Gaussian σ is 0.8 prior voxels. Native contribution is full within the configured 8-voxel distance band (158.8 µm), then falls smoothly to zero at 12 voxels (238.2 µm); the distant field comes from the prior. The distance is the implementation's interpolated coarse-grid guide distance. There is no hard band-edge mesh cut. This strategy can miss structures absent from the cleaned prior outside the search band.

Original intensities are cast to float32 and processed with **Chambolle total variation, weight 800, exactly 16 iterations, eps=0**, without a native Gaussian prefilter. Each 129³ core-sample grid has a **16-voxel halo**, giving a 161³ input. Missing original samples required by any contributing filter neighborhood are acquired before processing. The threshold is requested as 17133.4 and represented as **{raw_threshold}** in float32. Fixed iterations make the dependency radius finite; tested shared planes and monolithic comparisons are bit-identical. The compiled kernel preserves the installed scikit-image arithmetic order, omits unused convergence-energy work, and disables fast-math/FMA reassociation. See {ref('tv-kernel-verification.json','kernel verification')} and {ref('denoising/seam-validation.json','halo checks')}.

## What the measured denoising changes

Across {len(measures['regional'])} spatially spread 48³ test cores, TV16 reduced extracted Lewiner triangles from **{regional['raw']['triangles']:,} to {regional['tv800_16']['triangles']:,}**, and changed the above/below-threshold classification of {100*regional['tv800_16']['meanRawDisagreement']:.2f}% of sampled voxels. {regional['tv800_16']['emptyCores']} sampled cores became empty after filtering. In the separate 108³ cleft-rich region, triangle counts changed from {selected['raw']['triangles']:,} to {selected['tv800_16']['triangles']:,}. These are measured filter effects in selected crops, not an organ-wide accuracy sample; comparison meshes use Lewiner extraction and may differ from the native bank's classic cases.

![Actual 3D surfaces of the same native crop, with matched camera, lighting and open section.]({figure_target})

The figure shows actual raw, Gaussian and fixed-iteration TV surfaces from the same 108³ source crop. Camera, lighting, normal construction and crop are matched; the second row uses a common open section. These are scientific EGL renderings, not browser captures or a rendering of the entire completed bank. The meshes receive no extra smoothing, decimation or component deletion. {ref('denoising/surface-render-record.json','The render record')} records source, scalar, geometry, camera and image hashes; {ref('denoising/README.md','the comparison report')} explains the local outcomes. Filtering can erase real weak tissue, narrow clefts, small cavities or connections even when the image looks cleaner.

## Native archive, bounded processing and display LODs

Native NBE1 stores the processed grid's signs and five-bit edge-crossing positions; triangle connectivity follows standard marching-cubes cases. Its maximum numerical crossing displacement is **{m['encoding']['crossingPositionBoundUm']:.8f} µm** (1/64 native voxel). This is a bound relative to the processed scalar isosurface; it excludes filtering, guide, alignment, topology and anatomical error. The native bank is not replaced by either overview LOD.

Processing streams original 128³ source blocks, retains compressed bodies on disk, and reuses neighboring-Z halo strips. {cache_text}Completed native derivatives are evicted only after full public-GET byte-count/SHA verification and atomic record storage; local overview edges and provenance remain for assembly. The largest recorded individual worker high-water RSS was **{data['maximumRecordedWorkerRssMiB']:.2f} MiB**. This is not simultaneous whole-job peak memory. {ref('operational-memory-audit.md','The memory audit')} separates strip banks, workers, transport and cache; the final progress snapshot's elapsed time and network counters cover its latest invocation, not every resumed invocation.

Overview construction first samples the processed field every four native samples (**79.4 µm**). **{sampling['nonemptyNativeBlocksWithoutOverviewCrossings']:,} nonempty native tiles have no crossing in that step-4 overview.** This is a display omission before simplification; all **{sampling['nativeIndexEntriesRetained']:,}** nonempty native artifacts remain in the complete native index and available for regional inspection. The count comes from an exact coordinate join of completed native records, index entries and original overview inputs. {hierarchy_method} Final whole-mesh simplification is also explicitly lossy. The HFM1 meshes use float32 positions, packed int16 normals and uint32 indices. Their full-source world transform is `((x−3806.5),(z−4239.5),−(y−3806.5))/8479`.

| Display LOD | Triangles | Parts | Gzip MiB | Step-4→display p95 / sampled max µm | Display→step-4 p95 / sampled max µm |
|---|---:|---:|---:|---:|---:|
{chr(10).join(overview_rows)}

Distances compare the stored display meshes with the encoded step-4 processed overview. Forward sampling covers original leaf groups and uses surface-area weighting; reverse sampling measures closest triangles across original groups. These finite samples are **not a Hausdorff bound** and do not compare against anatomy or the full native mesh. Each gzip part is at most 32 MiB. See {ref('overview-builder.md','the builder method')} and the finalized evidence ledger for exact LOD hashes, samples and simplification settings.

## Verification and interpretation

The final compiler checked the complete plan, unique coordinates, processing fingerprint, every local overview hash, original-object ledger consistency and {receipt_scope}. It emits a compact browser index of **{data['artifact']['decodedBytes']:,} decoded bytes**, below 32 MiB, and a separate comprehensive evidence ledger. The browser does not load that ledger automatically. Real receipts establish historical complete public-GET verification; they are not a fresh availability check at every later visit. {ref('manifest-finalization.md','Finalization details')} describe these gates.

An independent {ref('production-recovery-verification.json','recovery test')} restored **{recovery['restoredRecords']:,}** already completed records from {recovery['checkpointObjectsDownloaded']} hosted checkpoint objects ({recovery['checkpointBytesDownloaded']/MIB:.2f} MiB). Records were byte-identical, the source ledger was an exact prefix, and the runner recognized every restored record with zero source requests. No original intensities or native surface payloads were downloaded for this recovery test.

Recorded decoder tests match Python geometry in {decoder['subregions']} pilot subregions and confirm exact shared positions. Internal subdivision normals match; independent outer-tile normals can differ, so geometric continuity does not guarantee invisible shading seams. {ref('browser-edge-decoder.json','Decoder evidence')} and {ref('whole-viewer-gl-check.json','actual shader compile, clipping and integer-pick checks')} document the tested implementations. Those checks do not establish mobile-browser interaction quality or FPS. The {kernel['medianSpeedup']:.2f}× isolated TV-kernel timing improvement is likewise not an end-to-end reconstruction or browser speed claim.

{closing_scope} The method remains a deliberately lossy, threshold-derived reconstruction of one preserved specimen. Coarse-guide blind spots, filtering and simplification can alter topology; source sampling and tiny encoding error do not prove anatomical accuracy. Exact counts, configuration and source identities are preserved in the linked evidence and {link(output,summary_path,'the companion release summary')}.
'''
    return text


def atomic_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    require(not path.is_symlink(), f'Output cannot be a symbolic link: {path}')
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent,
                                     prefix=path.name+'.', suffix='.tmp', delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
            os.replace(temporary,path)
        finally:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--run',type=Path,default=WHOLE/'run')
    parser.add_argument('--final-manifest',type=Path,default=WHOLE/'final-manifest',help='Directory containing final compiler outputs')
    parser.add_argument('--overview',type=Path,default=WHOLE/'overview/manifest.json')
    parser.add_argument('--output',type=Path,default=DOCS/'README.md')
    parser.add_argument('--allow-pilot',action='store_true',help='Validate a complete pilot only; requires a separately named /tmp output')
    args = parser.parse_args()
    try:
        data = read_inputs(args)
        markdown = render_report(data)
        m = data['manifest']
        summary = dict(schema='guided-native-release-report-v21.1',complete=True,
            completeScope=m['completeScope'],publishable=m['publishable'],fixtureOnly=data['fixture'],
            coverage=m['coverage'],totals=m['totals'],source=m['source'],processing=m['processing'],
            encoding=m['encoding'],coordinateTransform=m['coordinateTransform'],
            overviewLods=m['overviewLods'],evidenceLedger=m['evidenceLedger'],
            overviewSampling=data['overviewSampling'], sourceGenerationMetadata=data['sourceGenerationMetadata'],
            wholeFigureProvenance=data['wholeFigureProvenance'],
            manifestArtifact=data['artifact'],inputHashes=data['inputHashes'],
            maximumRecordedWorkerRssMiB=data['maximumRecordedWorkerRssMiB'],
            generatorSha256=file_digest(Path(__file__))[0],
            requiredWholeScopeIdentity=dict(planSha256=WHOLE_PLAN_SHA256,runFingerprint=WHOLE_RUN_FINGERPRINT),
            reportSha256=sha(markdown.encode()),wordCount=len(markdown.split()),
            generatorDoesNotPublish=True,remoteVerificationScope='Historical full public GET receipts; no new network requests')
        summary_path = data['output'].with_name('release-report.json') if not args.allow_pilot else data['output'].with_suffix('.json')
        atomic_text(summary_path,json.dumps(summary,indent=2,sort_keys=True,allow_nan=False)+'\n')
        atomic_text(data['output'],markdown)
        print(json.dumps(dict(output=str(data['output']),summary=str(summary_path),completeScope=m['completeScope'],
            publishable=m['publishable'],fixtureOnly=data['fixture'],wordCount=summary['wordCount'],
            completedBlocks=m['coverage']['completedBlocks'],reportSha256=summary['reportSha256']),sort_keys=True))
    except (ReportError,OSError,ValueError,TypeError,KeyError) as error:
        print(f'Release report stopped: {error}',file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
