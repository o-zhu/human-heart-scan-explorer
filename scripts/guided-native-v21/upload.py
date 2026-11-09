#!/usr/bin/env python3
"""Upload exact content-addressed native artifacts and verify their public bytes.

Credentials stay in memory. The CLI reads {site_url, upload_token} from hidden
stdin; callers can construct UploadClient from an in-memory access object.
Only the exact existing Heart Explorer Site is accepted. No redirects are
followed. upload() never removes a local file. The explicit CLI --evict option
requires a durable receipt written after a complete public GET checksum match.
"""
from __future__ import annotations

import argparse
from collections.abc import Mapping
from datetime import datetime, timezone
import getpass
import hashlib
import json
from pathlib import Path
import re
import sys
import threading
import time

import httpx

SITE_URL = 'https://human-heart-scan-explorer.zhuou557737.chatgpt.site'
API = '/api/guided-native-v21/'
TILE_MAX_BYTES = 4 * 1024**2
OTHER_MAX_BYTES = 32 * 1024**2
RETRY_STATUS = {408, 429, 500, 502, 503, 504}
ATTEMPTS = 4
_SHA = r'[a-f0-9]{64}'
_TILE = re.compile(rf'tiles/(0|[1-9]\d?)_(0|[1-9]\d?)_(0|[1-9]\d?)-({_SHA})\.nbe\.gz', re.ASCII)
_OVERVIEW = re.compile(rf'overview/[A-Za-z0-9][A-Za-z0-9_-]{{0,79}}-({_SHA})\.hfm\.gz', re.ASCII)
_MANIFEST = re.compile(rf'manifest-({_SHA})\.json\.gz', re.ASCII)


class UploadError(RuntimeError):
    """Public, credential-free failure description suitable for runner logs."""


def validate_access(site_url, upload_token):
    if not isinstance(site_url, str) or site_url not in (SITE_URL, SITE_URL+'/'):
        raise UploadError('Upload destination must be the exact current Heart Explorer Site.')
    if (not isinstance(upload_token, str) or not 32 <= len(upload_token) <= 4096
            or any(not 33 <= ord(c) <= 126 for c in upload_token)):
        raise UploadError('The collection upload credential is missing or invalid.')
    return SITE_URL, upload_token


def validate_remote_path(remote_path, sha256):
    if (not isinstance(remote_path, str) or not isinstance(sha256, str)
            or re.fullmatch(_SHA, sha256, re.ASCII) is None):
        raise UploadError('Invalid content-addressed object name or checksum.')
    match = _TILE.fullmatch(remote_path)
    if match:
        coordinates = tuple(map(int, match.group(1, 2, 3)))
        if any(c >= n for c, n in zip(coordinates, (60, 60, 67))):
            raise UploadError('Native tile coordinates are outside the source grid.')
        expected, maximum = match.group(4), TILE_MAX_BYTES
    else:
        match = _OVERVIEW.fullmatch(remote_path) or _MANIFEST.fullmatch(remote_path)
        if not match:
            raise UploadError('Invalid content-addressed object name.')
        expected, maximum = match.group(1), OTHER_MAX_BYTES
    if expected != sha256:
        raise UploadError('The object name does not contain the supplied checksum.')
    return maximum


def read_access():
    """Read one JSON object without echoing or retaining a credential file."""
    try:
        if sys.stdin.isatty():
            text = getpass.getpass('Site access JSON (hidden): ')
        else:
            text = sys.stdin.readline(32769)
        if len(text) > 32768:
            raise ValueError('oversized input')
        access = json.loads(text)
        if not isinstance(access, dict):
            raise ValueError('not an object')
        site_url, upload_token = validate_access(access.get('site_url'), access.get('upload_token'))
        return dict(site_url=site_url, upload_token=upload_token)
    except (ValueError, TypeError, UploadError):
        raise UploadError('Invalid hidden Site access JSON; credentials were not printed.') from None


def _local_bytes(path, maximum, expected_sha256):
    try:
        with Path(path).open('rb') as stream:
            data = stream.read(maximum+1)
    except OSError:
        raise UploadError('The local upload artifact could not be read.') from None
    if not 0 < len(data) <= maximum:
        raise UploadError('The local upload artifact exceeds its allowed size or is empty.')
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise UploadError('The local artifact checksum differs from its content-addressed name.')
    return data


class UploadClient:
    """Thread-safe bounded uploader; the caller controls checkpoint/eviction order.

    upload(path, remote_path, sha256) returns verified=True only after a public
    GET matches both the exact local byte count and the supplied SHA-256.
    The optional transport argument is for isolated tests, never an origin
    override. No request except PUT receives the collection credential.
    """
    def __init__(self, site_url, upload_token, workers=16, *, transport=None):
        self.site_url, self._upload_token = validate_access(site_url, upload_token)
        if type(workers) is not int or not 1 <= workers <= 64:
            raise UploadError('Use between one and 64 concurrent uploads.')
        self._slots = threading.BoundedSemaphore(workers)
        self._closed = False
        self._client = httpx.Client(
            follow_redirects=False, http2=False, transport=transport,
            timeout=httpx.Timeout(90, connect=20),
            limits=httpx.Limits(max_connections=workers, max_keepalive_connections=workers,
                               keepalive_expiry=60),
            headers={'Accept-Encoding': 'identity'},
        )

    @classmethod
    def from_access(cls, access, workers=16, **kwargs):
        if not isinstance(access, Mapping):
            raise UploadError('Site access must be supplied as an in-memory object.')
        return cls(access.get('site_url'), access.get('upload_token'), workers, **kwargs)

    def close(self):
        self._closed = True
        self._client.close()
        self._upload_token = ''

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    @staticmethod
    def _backoff(attempt):
        time.sleep(min(2**attempt, 4))

    def _put(self, url, data, expected_sha256):
        for attempt in range(ATTEMPTS):
            try:
                with self._client.stream('PUT', url, content=data, headers={
                    'X-Heart-Guided-Upload': self._upload_token,
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': str(len(data)),
                }) as reply:
                    status = reply.status_code
                    if status in (201, 204):
                        if reply.headers.get('x-content-sha256') != expected_sha256:
                            raise UploadError('The upload acknowledgement did not identify the expected checksum.')
                        return status
                    if status not in RETRY_STATUS or attempt == ATTEMPTS-1:
                        raise UploadError(f'Guided native upload was not accepted (HTTP {status}).')
            except httpx.RequestError:
                if attempt == ATTEMPTS-1:
                    raise UploadError('Guided native upload failed after four bounded network attempts.') from None
            self._backoff(attempt)
        raise UploadError('Guided native upload did not complete.')

    def _verify(self, url, expected_sha256, expected_bytes):
        for attempt in range(ATTEMPTS):
            try:
                with self._client.stream('GET', url, headers={'Cache-Control': 'no-cache'}) as reply:
                    status = reply.status_code
                    if status == 200:
                        if reply.headers.get('content-encoding') is not None:
                            raise UploadError('The public object was transformed with Content-Encoding.')
                        if reply.headers.get('x-content-sha256') != expected_sha256:
                            raise UploadError('The public object metadata does not match the requested checksum.')
                        declared = reply.headers.get('content-length')
                        if declared is not None and declared != str(expected_bytes):
                            raise UploadError('The public object has a different declared byte count.')
                        digest = hashlib.sha256()
                        received = 0
                        for piece in reply.iter_raw(chunk_size=64*1024):
                            received += len(piece)
                            if received > expected_bytes:
                                raise UploadError('The public object exceeded its exact expected byte count.')
                            digest.update(piece)
                        if received != expected_bytes or digest.hexdigest() != expected_sha256:
                            raise UploadError('Public GET checksum verification failed; retain the local artifact.')
                        return
                    if status not in RETRY_STATUS or attempt == ATTEMPTS-1:
                        raise UploadError(f'The public verification GET failed (HTTP {status}); retain the local artifact.')
            except httpx.RequestError:
                if attempt == ATTEMPTS-1:
                    raise UploadError('Public GET verification failed after four bounded network attempts; retain the local artifact.') from None
            self._backoff(attempt)
        raise UploadError('Public GET verification did not complete; retain the local artifact.')

    def verify(self, remote_path, sha256, expected_bytes):
        maximum = validate_remote_path(remote_path, sha256)
        if type(expected_bytes) is not int or not 0 < expected_bytes <= maximum:
            raise UploadError('Invalid verification byte count.')
        with self._slots:
            if self._closed:
                raise UploadError('The upload client is closed.')
            url = self.site_url+API+remote_path
            self._verify(url, sha256, expected_bytes)
            return self._receipt(remote_path, sha256, expected_bytes)

    def _receipt(self, remote_path, sha256, size):
        return dict(verified=True, url=self.site_url+API+remote_path, path=remote_path,
                    bytes=size, sha256=sha256, verifiedAt=datetime.now(timezone.utc).isoformat())

    def upload(self, path, remote_path, sha256):
        maximum = validate_remote_path(remote_path, sha256)
        with self._slots:
            if self._closed:
                raise UploadError('The upload client is closed.')
            data = _local_bytes(path, maximum, sha256)
            url = self.site_url+API+remote_path
            status = self._put(url, data, sha256)
            self._verify(url, sha256, len(data))
            return dict(self._receipt(remote_path, sha256, len(data)), uploadStatus=status)


def write_receipt(path, result):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix+'.partial')
    temporary.write_text(json.dumps(result, indent=2)+'\n')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file', type=Path, required=True)
    parser.add_argument('--remote-path', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--workers', type=int, default=16)
    parser.add_argument('--receipt', type=Path)
    parser.add_argument('--evict', action='store_true')
    args = parser.parse_args()
    if args.evict and args.receipt is None:
        parser.error('--evict requires --receipt so verified retrieval information is saved first')
    if args.receipt is not None and args.file.resolve() in (
            args.receipt.resolve(), args.receipt.with_suffix(args.receipt.suffix+'.partial').resolve()):
        parser.error('The receipt and its temporary path must differ from the upload artifact')
    maximum = validate_remote_path(args.remote_path, args.sha256)
    # Reject an invalid or changed local artifact before asking for credentials.
    _local_bytes(args.file, maximum, args.sha256)
    with UploadClient.from_access(read_access(), workers=args.workers) as client:
        result = client.upload(args.file, args.remote_path, args.sha256)
    result['evicted'] = False
    if args.receipt is not None:
        write_receipt(args.receipt, result)
    if args.evict:
        # A local rewrite after the GET must never be mistaken for the verified
        # artifact. The runner's own checkpoint-first policy remains independent.
        _local_bytes(args.file, maximum, args.sha256)
        args.file.unlink()
        result['evicted'] = True
        write_receipt(args.receipt, result)
    print(json.dumps(result, separators=(',', ':')), flush=True)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (UploadError, OSError):
        error = sys.exception()
        print(str(error) if isinstance(error, UploadError) else 'A local upload artifact operation failed.', file=sys.stderr)
        sys.exit(1)
