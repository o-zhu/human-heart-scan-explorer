#!/usr/bin/env python3
"""Matched scientific cutaways of original, retained, and removed HFM faces.

Uses the actual whole-native viewer shader literals, its CheckGL helper, and
the saved v21 camera/cut plane for each LOD. Original coordinates, stored
normals, face order, lighting and clipping are preserved. No scalar processing,
surface reconstruction, smoothing, normal recomputation, or caps are added.
"""
from __future__ import annotations
import os
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['LP_NUM_THREADS'] = '1'
os.environ.setdefault('LIBGL_ALWAYS_SOFTWARE', '1')
import argparse
import ctypes as C
from datetime import datetime, timezone
import gc
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import resource
import struct
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
BACKGROUND = np.array([7, 12, 15], np.uint8)
WORLD_MM = 8479 * 19.85 / 1000


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_module(path, name):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def font(size, bold=False):
    path = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans' + ('-Bold' if bold else '') + '.ttf')
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


class BatchedView:
    def __init__(self, helper, code, size, batch):
        self.gl = helper.CheckGL(code, width=1, height=1)
        self.target = self.gl.framebuffer(size, size)
        self.size, self.batch = size, batch
        gl = self.gl
        U, I, P, f = gl.U, gl.I, gl.P, gl.f
        self.vao = U()
        f('glGenVertexArrays', None, [I, C.POINTER(U)])(1, C.byref(self.vao))
        f('glBindVertexArray', None, [U])(self.vao)
        self.buffers = []
        for slot, width, kind in ((0, 12, 0x1406), (1, 6, 0x1402)):
            buffer = U()
            self.buffers.append(buffer)
            f('glGenBuffers', None, [I, C.POINTER(U)])(1, C.byref(buffer))
            f('glBindBuffer', None, [U, U])(0x8892, buffer)
            f('glBufferData', None, [U, C.c_ssize_t, P, U])(0x8892, batch * 3 * width, None, 0x88E8)
            f('glEnableVertexAttribArray', None, [U])(slot)
            f('glVertexAttribPointer', None, [U, I, U, U, I, P])(slot, 3, kind, int(slot == 1), 0, None)

    def draw(self, points, normals, faces, selected, camera, cut):
        gl = self.gl
        U, I, F, P, f = gl.U, gl.I, gl.F, gl.P, gl.f
        f('glBindFramebuffer', None, [U, U])(0x8D40, self.target['frame'])
        f('glViewport', None, [I, I, I, I])(0, 0, self.size, self.size)
        f('glEnable', None, [U])(0x0B71)
        f('glDepthFunc', None, [U])(0x0201)
        for flag in (0x0B44, 0x0BE2):
            f('glDisable', None, [U])(flag)
        f('glClearDepthf', None, [F])(1.)
        f('glClearColor', None, [F, F, F, F])(.027, .047, .060, 1.)
        f('glClear', None, [U])(0x4000 | 0x0100)
        gl.uniforms(gl.programs['fragment'], dict(float=True, bounds=([0, 0, 0], [1, 1, 1])), camera, 1, cut)
        f('glBindVertexArray', None, [U])(self.vao)
        count = len(faces) if selected is None else len(selected)
        submitted = 0
        for start in range(0, count, self.batch):
            batch_faces = faces[start:start + self.batch] if selected is None else faces[selected[start:start + self.batch]]
            indices = batch_faces.reshape(-1)
            position = np.ascontiguousarray(points[indices], np.float32)
            normal = np.ascontiguousarray(normals[indices], np.int16)
            for buffer, data in zip(self.buffers, (position, normal)):
                f('glBindBuffer', None, [U, U])(0x8892, buffer)
                f('glBufferSubData', None, [U, C.c_ssize_t, C.c_ssize_t, P])(0x8892, 0, data.nbytes, data.ctypes.data)
            f('glDrawArrays', None, [U, I, I])(4, 0, len(indices))
            f('glFinish', None, [])()
            submitted += len(indices) // 3
        if submitted != count:
            raise AssertionError('Not all selected triangles were submitted.')
        pixels = np.empty((self.size, self.size, 4), np.uint8)
        f('glReadPixels', None, [I, I, I, I, U, U, P])(0, 0, self.size, self.size, 0x1908, 0x1401, pixels.ctypes.data)
        gl.error('matched cutaway readback')
        return pixels[::-1].copy()

    def close(self):
        gl = self.gl
        U, I, f = gl.U, gl.I, gl.f
        f('glBindVertexArray', None, [U])(0)
        for buffer in self.buffers:
            f('glDeleteBuffers', None, [I, C.POINTER(U)])(1, C.byref(buffer))
        f('glDeleteVertexArrays', None, [I, C.POINTER(U)])(1, C.byref(self.vao))
        gl.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=Path('/workspace/data/guided-native-v21/whole/overview/assets'))
    parser.add_argument('--manifest', type=Path, default=ROOT / 'public/assets/noise-cleanup-v22/manifest.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/noise-cleanup-v22')
    parser.add_argument('--batch-triangles', type=int, default=30000)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    manifest_bytes = args.manifest.read_bytes()
    manifest = json.loads(manifest_bytes)
    helper_path = ROOT / 'docs/guided-native-v21/whole-viewer-gl-check.py'
    helper = load_module(helper_path, 'overview_filter_check_gl')
    shader_path = ROOT / 'public/whole-native.js'
    code, source_hash = helper.shaders(shader_path)
    report = {'schema': 'heart-overview-filter-render-v22.1', 'createdAtUtc': datetime.now(timezone.utc).isoformat(),
        'notBrowserScreenshot': True, 'displayLodNotNativeGrid': True, 'maskManifestSha256': sha(manifest_bytes),
        'shaderSource': 'public/whole-native.js', 'shaderSourceSha256': source_hash,
        'shaderSha256': {k: sha(v.encode()) for k, v in code.items()}, 'helperSha256': sha(helper_path.read_bytes()),
        'scriptSha256': sha(Path(__file__).read_bytes()), 'triangleBatchSize': args.batch_triangles,
        'networkRequests': 0, 'sourceIntensityBytesRead': 0, 'nativeGridPayloadBytesRead': 0,
        'positionsModified': False, 'normalsRecomputed': False, 'retainedFacesReordered': False,
        'extraSmoothing': False, 'extraSimplification': False, 'capsAdded': False, 'lods': []}
    size = 960
    renderer = BatchedView(helper, code, size, args.batch_triangles)
    report['driver'] = renderer.gl.driver
    try:
        for record in manifest['records']:
            name = record['id']
            encoded = (args.source_dir / (name + '.hfm.gz')).read_bytes()
            if sha(encoded) != record['sourceSha256']:
                raise ValueError('Original HFM hash does not match mask association.')
            decoded = gzip.decompress(encoded)
            if sha(decoded) != record['sourceDecodedSha256']:
                raise ValueError('Original HFM decoded checksum mismatch.')
            magic, version, nv, count, po, no, io, flags = struct.unpack('<8I', decoded[:32])
            assert magic == 0x314d4648 and version == 1 and flags == 1 and count // 3 == record['originalTriangles']
            points = np.ndarray((nv, 3), dtype='<f4', buffer=decoded, offset=po)
            normals = np.ndarray((nv, 3), dtype='<i2', buffer=decoded, offset=no)
            faces = np.ndarray((count // 3, 3), dtype='<u4', buffer=decoded, offset=io)
            mask_file = ROOT / 'public' / record['mask']['url'].lstrip('/')
            compressed_mask = mask_file.read_bytes()
            assert len(compressed_mask) == record['mask']['bytes'] and sha(compressed_mask) == record['mask']['sha256']
            raw_mask = gzip.decompress(compressed_mask)
            assert len(raw_mask) == record['mask']['decodedBytes'] and sha(raw_mask) == record['mask']['decodedSha256']
            unpacked = np.unpackbits(np.frombuffer(raw_mask, np.uint8), bitorder='little')
            assert not np.any(unpacked[len(faces):])
            keep = unpacked[:len(faces)].astype(np.bool_)
            retained = np.flatnonzero(keep).astype('<u4')
            removed = np.flatnonzero(~keep).astype('<u4')
            assert len(retained) == record['retainedTriangles'] and len(removed) == record['removedTriangles']
            assert sha(retained.tobytes()) == record['retainedTriangleIndexSha256']
            saved_path = ROOT / 'docs/guided-native-v21' / ('whole-overview-render' if name == 'overview' else 'whole-detail-render') / 'render-record.json'
            saved_bytes = saved_path.read_bytes()
            saved = json.loads(saved_bytes)
            assert saved['frameSizePixels'] == [size, size]
            camera = saved['camera']
            cut = dict(enabled=True, axis=saved['cutaway']['normalWorld'], value=saved['cutaway']['offsetWorld'], sign=1)
            row = {'id': name, 'sourceSha256': record['sourceSha256'], 'maskSha256': record['mask']['sha256'],
                'savedRenderRecord': str(saved_path.relative_to(ROOT)), 'savedRenderRecordSha256': sha(saved_bytes),
                'camera': camera, 'cutaway': saved['cutaway'], 'originalTriangles': len(faces),
                'retainedTriangles': len(retained), 'removedTriangles': len(removed), 'outputs': {}}
            original = None
            for label, selected in [('original', None), ('retained', retained), ('removed', removed)]:
                pixels = renderer.draw(points, normals, faces, selected, camera, cut)
                foreground = np.any(pixels[:, :, :3] != BACKGROUND, axis=2)
                path = args.output / f'overview-filter-{name}-{label}-cutaway.png'
                Image.fromarray(pixels[:, :, :3]).save(path, optimize=True)
                result = {'path': path.name, 'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size,
                    'rgbaPixelSha256': sha(pixels.tobytes()), 'submittedTriangles': len(faces) if selected is None else len(selected),
                    'foregroundPixels': int(foreground.sum()), 'width': size, 'height': size}
                if label == 'original':
                    original = pixels.copy()
                    result['matchesSavedReferenceRGBA'] = result['rgbaPixelSha256'] == saved['outputs']['cutaway']['rgbaPixelSha256']
                    result['shaderHashesMatchSavedReference'] = report['shaderSha256'] == saved['renderer']['shaderSha256']
                else:
                    old_foreground = np.any(original[:, :, :3] != BACKGROUND, axis=2)
                    result['changedPixelsVersusOriginal'] = int(np.any(pixels != original, axis=2).sum())
                    result['originalForegroundNowBackgroundPixels'] = int((old_foreground & ~foreground).sum())
                    result['foregroundOutsideOriginalPixels'] = int((foreground & ~old_foreground).sum())
                row['outputs'][label] = result
                print(json.dumps({'lod': name, 'variant': label, 'path': str(path), 'triangles': result['submittedTriangles']}), flush=True)
            report['lods'].append(row)
            del original, pixels, foreground, points, normals, faces, decoded, encoded, retained, removed, keep
            gc.collect()
    finally:
        renderer.close()
    gap, margin, top, row_header, footer = 24, 28, 150, 58, 138
    width = 3 * size + 2 * gap + 2 * margin
    height = top + 2 * (row_header + size) + gap + footer
    sheet = Image.new('RGB', (width, height), '#071016')
    draw = ImageDraw.Draw(sheet)
    draw.text((margin, 24), 'Whole-heart display: paired-face cancellation', font=font(35, True), fill='#ecf2f3')
    draw.text((margin, 76), 'Actual archived HFM geometry · existing viewer shaders · exact saved cutaway cameras · no added caps', font=font(22), fill='#b1c4cd')
    titles = [('original', 'Original published display'), ('retained', 'Retained faces · experimental'), ('removed', 'Removed faces only')]
    for col, (_, title) in enumerate(titles):
        draw.text((margin + col * (size + gap), 116), title, font=font(24, True), fill='#d4e2e8')
    for row_index, row in enumerate(report['lods']):
        y = top + row_index * (row_header + size + gap)
        text = f"{row['id'].capitalize()}: {row['originalTriangles']:,} original → {row['retainedTriangles']:,} retained; {row['removedTriangles']:,} removed"
        draw.text((margin, y + 13), text, font=font(24, True), fill='#e4c698')
        for col, (label, _) in enumerate(titles):
            x = margin + col * (size + gap)
            with Image.open(args.output / row['outputs'][label]['path']) as panel:
                sheet.paste(panel, (x, y + row_header))
            length = 20 / (row['camera']['span'] * WORLD_MM) * size
            bar_y = y + row_header + size - 26
            draw.line((x + 22, bar_y, x + 22 + length, bar_y), fill='#dce6eb', width=4)
            draw.text((x + 22, bar_y - 31), '20 mm', font=font(18), fill='#dce6eb')
    fy = height - footer + 20
    for line in [
        'Surviving coordinates, original face order and stored normals are unchanged. The removed panel is not an artifact ground-truth mask.',
        'Cancellation can expose holes or remove thin structures collapsed into coincident display sheets. These are lossy 79.4 µm display LODs.',
        'The original 19.85 µm native bank is unchanged. Scientific Mesa EGL renders; not browser screenshots or anatomical validation.',
    ]:
        draw.text((margin, fy), line, font=font(20), fill='#b1c4cd')
        fy += 31
    comparison = args.output / 'overview-comparison.png'
    sheet.save(comparison, optimize=True)
    report['comparison'] = {'path': comparison.name, 'width': width, 'height': height,
        'bytes': comparison.stat().st_size, 'sha256': sha(comparison.read_bytes())}
    report['limitations'] = ['Removing coincident display sheets can expose holes and can remove a collapsed representation of genuine thin tissue.',
        'This comparison does not show a change to native-grid reconstruction or establish anatomical truth.',
        'Each row reuses its own exact archived LOD camera/cut; all three variants within a row have identical projection and lighting.']
    report['seconds'] = round(time.monotonic() - started, 3)
    report['peakRssMiB'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    out = args.output / 'overview-comparison.json'
    out.write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + '\n')
    print(json.dumps({'comparison': str(comparison), 'report': str(out), 'seconds': report['seconds'], 'peakRssMiB': report['peakRssMiB']}), flush=True)


if __name__ == '__main__':
    main()
