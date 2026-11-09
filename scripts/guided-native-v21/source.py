#!/usr/bin/env python3
"""Bounded reads of the original heart scan, including Blosc byte ranges.

One source N5 object contains four independently compressed 32-plane streams.
This reader validates the public object's range and generation before decoding;
it never substitutes an overview sample for missing native data.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path
import struct
import threading
import time

import blosc2
import httpx
import numpy as np

SOURCE = ('https://storage.googleapis.com/'
          'ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/'
          'LADAF-2021-17/heart/19.85um_complete-organ_bm18/s0/')
DIMENSIONS_XYZ = (7614, 7614, 8480)
SPACING_UM = 19.85


def decode_n5(payload: bytes) -> np.ndarray:
    if len(payload) < 32 or struct.unpack('>HH', payload[:4]) != (0, 3):
        raise ValueError('Invalid N5 volume block')
    dimensions = struct.unpack('>III', payload[4:16])
    if not all(0 < d <= 128 for d in dimensions):
        raise ValueError('Unexpected N5 dimensions')
    raw = blosc2.decompress(payload[16:])
    if len(raw) != math.prod(dimensions) * 2:
        raise ValueError('N5 decoded byte count differs from geometry')
    return np.frombuffer(raw, '>u2').reshape(dimensions[::-1]).astype(np.uint16)


def parse_header(header: bytes) -> dict:
    if len(header) != 48 or struct.unpack('>HH', header[:4]) != (0, 3):
        raise ValueError('Expected a complete 48-byte N5/Blosc header')
    dimensions = struct.unpack('>III', header[4:16])
    version, codec_version, flags, typesize, nbytes, blocksize, cbytes = struct.unpack('<BBBBIII', header[16:32])
    # Range assembly is deliberately restricted to the observed Blosc1 format.
    # Boundary N5 objects and future codecs use the validated whole-block path.
    if (dimensions, version, codec_version, flags, typesize, nbytes, blocksize) != ((128, 128, 128), 2, 1, 148, 2, 4194304, 1048576):
        raise ValueError('Source block is not the verified four-stream layout')
    starts = struct.unpack('<4I', header[32:48])
    if len(set(starts)) != 4 or min(starts) < 32 or max(starts) >= cbytes:
        raise ValueError('Invalid compressed stream offsets')
    ends = [min([v for v in starts if v > start] + [cbytes]) for start in starts]
    return dict(header=header[16:32], starts=starts, ends=ends, nbytes=nbytes,
                blocksize=blocksize, cbytes=cbytes, dimensionsXYZ=dimensions)


def decode_stream(metadata: dict, quarter: int, encoded: bytes) -> np.ndarray:
    if quarter not in range(4) or len(encoded) != metadata['ends'][quarter] - metadata['starts'][quarter]:
        raise ValueError('Incomplete compressed quarter')
    header = bytearray(metadata['header'])
    struct.pack_into('<III', header, 4, 1048576, 1048576, len(encoded) + 20)
    raw = blosc2.decompress(bytes(header) + struct.pack('<I', 20) + encoded)
    if len(raw) != 1048576:
        raise ValueError('Quarter decoded byte count differs from geometry')
    return np.frombuffer(raw, '>u2').reshape(32, 128, 128).astype(np.uint16)


class NativeSource:
    """Thread-safe pooled network reader; callers own bounded decoded caches."""
    def __init__(self, workers=32, cached_directories=()):
        self.client = httpx.Client(timeout=httpx.Timeout(60, connect=20),
            limits=httpx.Limits(max_connections=workers, max_keepalive_connections=workers))
        self.cache_dirs = tuple(Path(p) for p in cached_directories)
        self.lock = threading.Lock()
        self.network_bytes = 0
        self.requests = 0
        self.retries = 0

    def close(self):
        self.client.close()

    @staticmethod
    def url(coordinates):
        if len(coordinates) != 3 or any(int(c) != c or c < 0 or c >= math.ceil(n / 128) for c, n in zip(coordinates, DIMENSIONS_XYZ)):
            raise ValueError('N5 coordinates outside source geometry')
        return SOURCE + '/'.join(str(int(c)) for c in coordinates)

    def request(self, coordinates, byte_range=None, generation=None):
        headers = {}
        if byte_range is not None:
            headers['Range'] = f'bytes={byte_range[0]}-{byte_range[1]}'
        # A generation-specific GCS URL prevents mixing streams if an object changes.
        params = {'generation': generation} if generation else None
        for attempt in range(5):
            try:
                response = self.client.get(self.url(coordinates), headers=headers, params=params)
                response.raise_for_status()
                content = response.content
                if byte_range is not None:
                    start, end = byte_range
                    if response.status_code != 206 or len(content) != end - start + 1 or not response.headers.get('content-range', '').startswith(f'bytes {start}-{end}/'):
                        raise ValueError('Source did not honor the exact byte range')
                elif len(content) > 5 * 1024**2:
                    raise ValueError('Source block exceeds the bounded read size')
                with self.lock:
                    self.requests += 1
                    self.network_bytes += len(content)
                return content, response.headers.get('x-goog-generation')
            except (httpx.HTTPError, ValueError):
                if attempt == 4:
                    raise
                with self.lock:
                    self.retries += 1
                time.sleep(min(2**attempt, 8))

    def whole(self, coordinates):
        name = '_'.join(str(int(c)) for c in coordinates) + '.n5'
        for directory in self.cache_dirs:
            path = directory / name
            if path.exists():
                payload = path.read_bytes()
                return decode_n5(payload), dict(coordinatesXYZ=list(map(int, coordinates)),
                    bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest(), cached=True)
        payload, generation = self.request(coordinates)
        return decode_n5(payload), dict(coordinatesXYZ=list(map(int, coordinates)),
            bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest(), cached=False,
            generation=generation)

    def header(self, coordinates):
        payload, generation = self.request(coordinates, (0, 47))
        metadata = parse_header(payload)
        metadata['generation'] = generation
        metadata['headerSha256'] = hashlib.sha256(payload).hexdigest()
        return metadata

    def quarter(self, coordinates, quarter, metadata):
        start, end = metadata['starts'][quarter], metadata['ends'][quarter]
        encoded, generation = self.request(coordinates, (start + 16, end + 15), metadata['generation'])
        if generation != metadata['generation']:
            raise ValueError('Source generation changed during range acquisition')
        values = decode_stream(metadata, quarter, encoded)
        return values, dict(coordinatesXYZ=list(map(int, coordinates)), quarter=quarter,
            byteRangeInclusive=[start + 16, end + 15], bytes=len(encoded),
            sha256=hashlib.sha256(encoded).hexdigest(), generation=generation)
