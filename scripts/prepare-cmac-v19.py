#!/usr/bin/env python3
"""Prepare the actual cMAC volunteer v1 for a browser comparison.

No spatial resampling, segmentation, synthetic motion, or cross-modal alignment
is performed. MRI is a fixed, linearly windowed 8-bit display derivative; the
already-uint8 ultrasound samples are copied exactly and gzip-compressed.

Input: the official v1.zip extracted beneath SOURCE/v1 (or SOURCE itself=v1).
Dependencies: numpy, pydicom, vtk, pillow. See docs/clinical-v19/cmac/README.md.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
import pydicom
import vtk
from vtk.util.numpy_support import vtk_to_numpy


SOURCE_PAGE = 'https://www.cardiacatlas.org/motion-tracking-2011-challenge/'
PAPER = 'https://doi.org/10.1016/j.media.2013.03.008'
ARCHIVE_SHA256 = '20043e37665c5d70fadddf4bbfd8a6368ddabf87ddffd9624d4dda100d833ade'
GT_ARCHIVE_SHA256 = 'a97279bbf0025994a906c0f7fcd5f97d166484f2132539cbe008c0ec179e3dd1'
BASE_URL = '/assets/clinical-v19/cmac'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_file(path: Path, root: Path) -> dict:
    data = path.read_bytes()
    return {'path': str(path.relative_to(root)), 'bytes': len(data), 'sha256': sha(data)}


def dicom_stack(folder: Path):
    paths = sorted(folder.glob('IM*'))
    pairs = [(path, pydicom.dcmread(path)) for path in paths]
    if not pairs:
        raise ValueError(f'No DICOM slices: {folder}')
    d0 = pairs[0][1]
    orient = np.asarray(d0.ImageOrientationPatient, dtype=float)
    normal = np.cross(orient[:3], orient[3:])
    normal /= np.linalg.norm(normal)
    pairs.sort(key=lambda pair: np.dot(np.asarray(pair[1].ImagePositionPatient, float), normal))
    d0 = pairs[0][1]
    positions = np.asarray([d.ImagePositionPatient for _, d in pairs], float)
    z = positions @ normal
    dz = float(np.median(np.diff(z))) if len(z) > 1 else float(d0.SliceThickness)
    if len(z) > 1:
        assert np.allclose(np.diff(z), dz, atol=2e-4), 'Nonuniform source slice spacing'
    for _, d in pairs:
        assert np.allclose(d.ImageOrientationPatient, orient, atol=1e-5)
        assert int(d.Rows) == int(d0.Rows) and int(d.Columns) == int(d0.Columns)
    spacing = [float(d0.PixelSpacing[1]), float(d0.PixelSpacing[0]), dz]
    direction = np.column_stack((orient[:3], orient[3:], normal))
    affine = np.eye(4)
    affine[:3, :3] = direction @ np.diag(spacing)
    affine[:3, 3] = positions[0]
    stack = np.stack([
        d.pixel_array.astype(np.float32) * float(d.get('RescaleSlope', 1))
        + float(d.get('RescaleIntercept', 0)) for _, d in pairs
    ])
    times = [float(d.get('TriggerTime', 0)) for _, d in pairs]
    meta = {
        'dimensions': [int(d0.Columns), int(d0.Rows), len(pairs)],
        'spacingMm': spacing,
        'originMm': positions[0].tolist(),
        'direction': direction.tolist(),
        'indexToPhysicalMm': affine.tolist(),
        'coordinateSystem': 'DICOM LPS',
        'sliceThicknessMm': float(d0.SliceThickness),
        'frameOfReferenceHash': sha(str(d0.get('FrameOfReferenceUID', '')).encode()),
        'seriesDescription': str(d0.get('SeriesDescription', '')),
        'bitsStored': int(d0.BitsStored),
        'intensityUnits': 'arbitrary MR signal after per-image DICOM rescale',
        'perSliceTriggerTimesMs': times,
        'triggerTimeRangeMs': [min(times), max(times)],
        'nominalTimeMs': float(np.median(times)),
    }
    return stack, meta, [path for path, _ in pairs]


def display_settings(high=.8, gamma=.9):
    return {'windowEnabled': True, 'windowLow': 0, 'windowHigh': high,
            'windowGamma': gamma, 'capContrast': 1, 'cutFaceExposure': 1.15}


def encode_frame(data, series_id, index, source_window, output, extra=None, exact=False):
    low, high = source_window
    if exact:
        assert data.dtype == np.uint8
        packed = np.ascontiguousarray(data)
    else:
        packed = np.rint(np.clip((data.astype(np.float32) - low) / (high - low), 0, 1) * 255).astype(np.uint8)
    raw = packed.tobytes(order='C')  # NumPy Z,Y,X -> X is the fastest axis.
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    assert gzip.decompress(compressed) == raw
    target = output / series_id / f'frame-{index:03d}.u8.gz'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(compressed)
    result = {'index': index, 'url': f'{BASE_URL}/{series_id}/{target.name}',
              'compressedBytes': len(compressed), 'decodedBytes': len(raw),
              'sha256': sha(compressed), 'decodedSha256': sha(raw),
              'sourceMinimum': float(data.min()), 'sourceMaximum': float(data.max()),
              'displayLowClippedFraction': float(np.mean(data < low)),
              'displayHighClippedFraction': float(np.mean(data > high)),
              'storedNonzeroBoundsXYZ': []}
    nonzero = np.argwhere(packed > 0)
    if nonzero.size:
        result['storedNonzeroBoundsXYZ'] = [nonzero.min(0)[::-1].tolist(), nonzero.max(0)[::-1].tolist()]
    if extra:
        result.update(extra)
    return result, packed


def spatial_header(meta):
    return {key: meta[key] for key in ['dimensions', 'spacingMm', 'originMm', 'direction',
                                     'indexToPhysicalMm', 'coordinateSystem']}


def crop_native(data, meta, lower_xyz, upper_xyz):
    """Restrict field of view without resampling, retaining the physical frame."""
    lower, upper = np.asarray(lower_xyz, int), np.asarray(upper_xyz, int)
    original = spatial_header(meta)
    affine = np.asarray(meta['indexToPhysicalMm'], float).copy()
    affine[:3, 3] = (affine @ np.append(lower, 1))[:3]
    cropped = data[lower[2]:upper[2], lower[1]:upper[1], lower[0]:upper[0]].copy()
    updated = dict(meta, dimensions=(upper - lower).tolist(), originMm=affine[:3, 3].tolist(),
                   indexToPhysicalMm=affine.tolist())
    crop = {'lowerInclusiveXYZ': lower.tolist(), 'upperExclusiveXYZ': upper.tolist(),
            'sourceSpatialHeader': original, 'resampled': False,
            'description': 'Conservative rectangular field of view around the heart and proximal vessels; includes adjacent tissues, not an anatomical segmentation. All original left-right slices are retained.'}
    return cropped, updated, crop


def make_inspection(series, output):
    from PIL import Image, ImageDraw
    cell_w, cell_h = 420, 360
    sheet = Image.new('RGB', (3 * cell_w, len(series) * (cell_h + 52)), '#091215')
    draw = ImageDraw.Draw(sheet)
    for row, (label, arr, spacing) in enumerate(series):
        # Native center planes, scaled with actual stored pixel spacings.
        planes = [(arr[arr.shape[0] // 2], spacing[0], spacing[1], 'Z'),
                  (arr[:, arr.shape[1] // 2], spacing[0], spacing[2], 'Y'),
                  (arr[:, :, arr.shape[2] // 2], spacing[1], spacing[2], 'X')]
        for col, (plane, sx, sy, axis) in enumerate(planes):
            if label.startswith('Ultrasound') and axis != 'Z':
                plane = plane[::-1]  # Apical footprint at the top in this QA sheet only.
            img = Image.fromarray(plane)
            scale = min((cell_w - 16) / (img.width * sx), (cell_h - 16) / (img.height * sy))
            img = img.resize((max(1, round(img.width * sx * scale)), max(1, round(img.height * sy * scale))), Image.Resampling.BILINEAR)
            x, y = col * cell_w, row * (cell_h + 52)
            sheet.paste(img, (x + (cell_w - img.width) // 2, y + 52 + (cell_h - img.height) // 2))
            draw.text((x + 12, y + 10), f'{label} / {axis}', fill='#d9e4de')
            draw.text((x + 12, y + 28), 'Measured samples; display window only', fill='#91a8a2')
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, quality=92)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/assets/clinical-v19/cmac'))
    parser.add_argument('--docs', type=Path, default=Path('docs/clinical-v19/cmac'))
    args = parser.parse_args()
    source = args.source / 'v1' if (args.source / 'v1').is_dir() else args.source
    out, docs = args.output, args.docs
    out.mkdir(parents=True, exist_ok=True)
    docs.mkdir(parents=True, exist_ok=True)
    source_records, inspections = [], []
    manifest = {
        'schemaVersion': 1, 'id': 'cmac-v1', 'label': 'cMAC · Volunteer 1',
        'description': 'Measured MRI and 4D apical ultrasound from the same healthy-volunteer case.',
        'subject': {'id': 'v1', 'cohort': 'Healthy volunteers', 'ageYears': None, 'sex': None,
                    'note': 'Cohort description from the challenge; no inferred subject-specific age or sex.'},
        'source': {'name': 'Cardiac Atlas Project / STACOM 2011 cMAC', 'url': SOURCE_PAGE,
                   'citation': 'Tobon-Gomez et al. Benchmarking framework for myocardial tracking and deformation algorithms: An open access database. Medical Image Analysis 17(6), 632–648 (2013).',
                   'doiUrl': PAPER, 'license': 'Open access by attribution, as stated on the official challenge page; no Creative Commons license assumed.',
                   'caseArchive': {'filename': 'v1.zip', 'bytes': 396553334, 'sha256': ARCHIVE_SHA256},
                   'readmeUrl': 'https://www.cardiacatlas.org/wp-content/uploads/2024/03/readme.pdf'},
        'pairing': {'sameVolunteer': True, 'sameAcquisition': False,
                    'spatiallyRegisteredInViewer': False, 'temporallySynchronizedInViewer': False,
                    'label': 'Same volunteer · separate acquisitions',
                    'note': 'Whole-heart MRI and ultrasound are not co-registered here. Cine slots are separate measured phases, not simultaneous MRI/ultrasound observations.',
                    'documentedReferenceFrames': {'indexBase': 0, 'ultrasound': {'endSystole': 6, 'finalFrame': 13},
                                                  'cineSax': {'endSystole': 10, 'finalFrame': 29},
                                                  'source': 'Official readme.pdf, final-frame/end-systolic table, v1 column'}},
        'format': {'scalarType': 'uint8', 'order': 'X fastest, then Y, then Z', 'compression': 'gzip',
                   'spatialResampling': False, 'frameInterpolation': False,
                   'sourceTransforms': 'MRI: per-slice DICOM rescale followed by a fixed linear display window and 8-bit rounding. Ultrasound: exact source VTK uint8 samples.'},
        'series': []
    }

    whole, whmeta, paths = dicom_stack(source / 'WH_TX_TFE/time_1')
    assert whole.shape == (95, 400, 400)
    source_records.extend(source_file(path, source) for path in paths)
    whole, whmeta, crop = crop_native(whole, whmeta, [75, 40, 0], [280, 285, 95])
    window = [0, 2250]
    frame, packed = encode_frame(whole, 'whole-heart-mri', 0, window, out,
                                {'timeMs': whmeta['nominalTimeMs'], 'phase': None,
                                 'phaseLabel': 'Gated static volume'})
    manifest['series'].append({
        'id': 'whole-heart-mri', 'label': 'Whole-heart MRI · cardiac region', 'modality': 'MRI',
        **spatial_header(whmeta), 'frames': [frame], 'sourceWindow': window,
        'defaultThreshold': .12, 'displayWindow': display_settings(.8, .85),
        'defaultSlice': {'axis': 2, 'position': .5, 'flipVertical': False},
        'defaultCameraDistance': 2.0,
        'crop': crop,
        'focusNormalizedXYZ': [(170 - 75) / 204, (185 - 40) / 244, 47 / 94],
        'sourceHeader': {key: value for key, value in whmeta.items() if key not in spatial_header(whmeta)},
        'samplingDescription': '0.75 × 0.75 × 1.5 mm stored grid; 3 mm source slice thickness',
        'phaseDescription': 'One whole-heart SSFP volume; source protocol gated at end-diastole and end-expiration. DICOM trigger time 740 ms.',
        'notes': ['A conservative rectangular cardiac field of view preserves the native grid; adjacent tissues remain and intensity surfaces are not anatomical segmentation.',
                  'The 1.5 mm slice interval is overlapping reconstruction spacing, not proof of 1.5 mm acquired through-plane resolution.',
                  'The whole-heart MRI has a different DICOM frame of reference from the cine/tagged MRI.']
    })
    inspections.append(('Whole-heart MRI', packed, whmeta['spacingMm']))
    del whole, packed
    print('Prepared whole-heart MRI', frame['compressedBytes'], flush=True)

    us_dicom = source / '3DUS/IM_0001'
    usmeta = pydicom.dcmread(us_dicom, stop_before_pixels=True)
    interval = float(usmeta.FrameTime)
    source_records.append(source_file(us_dicom, source))
    frames, usspatial = [], None
    for index, path in enumerate(sorted((source / '3DUS/VTK').glob('VTK*.vtk'))):
        reader = vtk.vtkDataSetReader()
        reader.SetFileName(str(path))
        reader.Update()
        image = reader.GetOutput()
        dims, spacing, origin = list(image.GetDimensions()), list(image.GetSpacing()), list(image.GetOrigin())
        scalar = vtk_to_numpy(image.GetPointData().GetScalars())
        assert scalar.dtype == np.uint8
        data = scalar.reshape(tuple(reversed(dims)))
        assert dims == [208, 224, 208]
        affine = np.eye(4)
        affine[:3, :3] = np.diag(spacing)
        affine[:3, 3] = origin
        spatial = {'dimensions': dims, 'spacingMm': spacing, 'originMm': origin,
                   'direction': np.eye(3).tolist(), 'indexToPhysicalMm': affine.tolist(),
                   'coordinateSystem': 'Source VTK ultrasound-local coordinates; not DICOM LPS'}
        if usspatial is not None:
            assert spatial == usspatial
        usspatial = spatial
        source_records.append(source_file(path, source))
        frame, packed = encode_frame(data, 'ultrasound', index, [0, 255], out,
                                    {'timeMs': index * interval, 'phase': index / 13,
                                     'sourceFrameIndex': index}, exact=True)
        frames.append(frame)
        if index in [0, 6]:
            inspections.append((f'Ultrasound frame {index}', packed.copy(), spacing))
        print('Prepared ultrasound frame', index, frame['compressedBytes'], flush=True)
    assert len(frames) == 14
    manifest['series'].append({
        'id': 'ultrasound', 'label': '4D apical ultrasound', 'modality': 'US',
        **usspatial, 'frames': frames, 'sourceWindow': [0, 255], 'defaultThreshold': .17,
        'displayWindow': display_settings(1, 1),
        'defaultSlice': {'axis': 1, 'position': .5, 'flipVertical': True},
        'sourceHeader': {'numberOfFrames': int(usmeta.NumberOfFrames), 'frameTimeMs': interval,
                         'manufacturer': str(usmeta.Manufacturer), 'sourceScalarType': 'uint8',
                         'dicomPhysicalDeltaXcm': float(usmeta.PhysicalDeltaX),
                         'dicomPhysicalDeltaYcm': float(usmeta.PhysicalDeltaY),
                         'dicomPrivateDepth': int(usmeta[(0x3001,0x1001)].value),
                         'dicomPrivateDepthSpacingCm': float(usmeta[(0x3001,0x1003)].value)},
        'frameIntervalMs': interval,
        'samplingDescription': '0.658 × 0.668 × 0.580 mm stored grid; 14 measured volumes',
        'phaseDescription': 'Recorded 4D apical ultrasound, 47.2885 ms per volume. Separate acquisition from MRI.',
        'notes': ['All source VTK ultrasound intensities are retained exactly, with lossless gzip compression.',
                  'Grid spacing is not the ultrasound system’s spatial resolving power.',
                  'The volume contains an apical acoustic sector, not complete whole-heart coverage.']
    })

    cineframes, cine_spatial, cinemeta = [], None, None
    cine_window = [0, 2600]
    for index, folder in enumerate(sorted((source / 'cSAX').glob('time_*'), key=lambda path: int(path.name.split('_')[-1]))):
        data, meta, paths = dicom_stack(folder)
        spatial = spatial_header(meta)
        if cine_spatial is not None:
            for key in ['dimensions', 'spacingMm', 'originMm', 'direction', 'indexToPhysicalMm']:
                assert np.allclose(spatial[key], cine_spatial[key], atol=1e-5), f'Cine geometry changed: {key}'
        cine_spatial, cinemeta = spatial, meta
        source_records.extend(source_file(path, source) for path in paths)
        frame, packed = encode_frame(data, 'cine-sax', index, cine_window, out,
                                    {'timeMs': meta['nominalTimeMs'], 'phase': index / 29,
                                     'triggerTimeRangeMs': meta['triggerTimeRangeMs'],
                                     'perSliceTriggerTimesMs': meta['perSliceTriggerTimesMs'],
                                     'sourceDirectory': folder.name})
        cineframes.append(frame)
        if index in [0, 10]:
            inspections.append((f'Cine SAX frame {index}', packed.copy(), meta['spacingMm']))
        print('Prepared cine SAX frame', index, frame['compressedBytes'], flush=True)
    assert len(cineframes) == 30
    manifest['series'].append({
        'id': 'cine-sax', 'label': 'Cine short-axis MRI', 'modality': 'MRI',
        **cine_spatial, 'frames': cineframes, 'sourceWindow': cine_window,
        'defaultThreshold': .1, 'displayWindow': display_settings(.72, .85),
        'defaultSlice': {'axis': 2, 'position': .5, 'flipVertical': False},
        'sourceHeader': {'sliceThicknessMm': cinemeta['sliceThicknessMm'], 'bitsStored': cinemeta['bitsStored'],
                         'frameOfReferenceHash': cinemeta['frameOfReferenceHash'],
                         'seriesDescription': cinemeta['seriesDescription'], 'intensityUnits': cinemeta['intensityUnits']},
        'samplingDescription': '1.25 × 1.25 × 8 mm stored grid; 30 measured phase slots',
        'phaseDescription': 'Each phase slot combines 14 separately acquired SAX slices. Trigger times vary by slice; displayed time is their median, not a simultaneous 3D timestamp.',
        'notes': ['Preserves the native 8 mm slice separation. Interpolated display does not create fine through-plane anatomy.',
                  'All phases share one fixed display encoding window of 0–2600 arbitrary rescaled MR units.',
                  'This cine MRI and the ultrasound were acquired separately and are not synchronized in the viewer.']
    })
    manifest['compressedBytes'] = sum(frame['compressedBytes'] for series in manifest['series'] for frame in series['frames'])
    manifest['decodedBytesAllFrames'] = sum(frame['decodedBytes'] for series in manifest['series'] for frame in series['frames'])
    manifest['validation'] = {'preparedFrameCount': 45, 'nativeSpatialSamplesPreserved': True,
                              'ultrasoundSourceU8Exact': True, 'allGzipRoundTripsExact': True,
                              'sourceFileCount': len(source_records),
                              'sourceHeaderContainsPersonalDemographics': False}
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (docs / 'source-files.json').write_text(json.dumps({'caseArchiveSha256': ARCHIVE_SHA256, 'files': source_records}, indent=2) + '\n')
    (docs / 'validation.json').write_text(json.dumps({'totalCompressedBytes': manifest['compressedBytes'],
        'totalDecodedBytes': manifest['decodedBytesAllFrames'], 'frames': 45,
        'series': [{'id': series['id'], 'dimensions': series['dimensions'], 'spacingMm': series['spacingMm'],
                    'frameCount': len(series['frames']), 'compressedBytes': sum(f['compressedBytes'] for f in series['frames']),
                    'maximumHighClippedFraction': max(f['displayHighClippedFraction'] for f in series['frames'])}
                   for series in manifest['series']]}, indent=2) + '\n')
    make_inspection(inspections, docs / 'native-planes.jpg')
    print(json.dumps({'manifest': str(out / 'manifest.json'), 'compressedMB': manifest['compressedBytes'] / 1e6,
                      'frames': 45, 'sourceFiles': len(source_records)}), flush=True)


if __name__ == '__main__':
    main()
