#!/usr/bin/env python3
"""Offline HTTP transport tests: no actual credentials or network are used."""
from concurrent.futures import ThreadPoolExecutor
import contextlib
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts/guided-native-v21'))
import upload

TOKEN = 'guided-native-unit-test-secret-'*3
PAYLOAD = gzip.compress(b'original measured native surface checkpoint', mtime=0)
SHA = hashlib.sha256(PAYLOAD).hexdigest()
REMOTE = f'tiles/35_30_36-{SHA}.nbe.gz'
ACCESS = dict(site_url=upload.SITE_URL, upload_token=TOKEN)


class Service:
    def __init__(self):
        self.calls = []
        self.put_statuses = []
        self.get_statuses = []
        self.reply_bytes = PAYLOAD
        self.encoding = None
        self.redirect = None
        self.get_hook = None
        self.active = 0
        self.maximum_active = 0
        self.lock = threading.Lock()
        self.pause = 0

    def handle(self, request):
        with self.lock:
            self.calls.append(request)
            self.active += 1
            self.maximum_active = max(self.maximum_active, self.active)
        try:
            if self.pause:
                time.sleep(self.pause)
            assert str(request.url) == upload.SITE_URL+upload.API+REMOTE
            assert request.headers['accept-encoding'] == 'identity'
            if request.method == 'PUT':
                assert request.headers['X-Heart-Guided-Upload'] == TOKEN
                assert request.read() == PAYLOAD
                status = self.put_statuses.pop(0) if self.put_statuses else 201
                headers = {'x-content-sha256': SHA}
                if self.redirect:
                    headers['location'] = self.redirect
                return httpx.Response(status, headers=headers, stream=httpx.ByteStream(b''))
            assert request.method == 'GET'
            assert 'X-Heart-Guided-Upload' not in request.headers
            status = self.get_statuses.pop(0) if self.get_statuses else 200
            headers = {'x-content-sha256': SHA, 'content-length': str(len(PAYLOAD))}
            if self.encoding:
                headers['content-encoding'] = self.encoding
            if self.redirect:
                headers['location'] = self.redirect
            if self.get_hook:
                self.get_hook()
            return httpx.Response(status, headers=headers, stream=httpx.ByteStream(self.reply_bytes))
        finally:
            with self.lock:
                self.active -= 1


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.path = self.directory/'35_30_36.nbe.gz'
        self.path.write_bytes(PAYLOAD)
        self.service = Service()

    def tearDown(self):
        self.temp.cleanup()

    def client(self, workers=2):
        return upload.UploadClient.from_access(ACCESS, workers=workers,
                                              transport=httpx.MockTransport(self.service.handle))

    def test_upload_requires_public_get_hash_before_verification_and_never_evicts(self):
        with self.client() as client:
            result = client.upload(self.path, REMOTE, SHA)
        self.assertTrue(result['verified'])
        self.assertEqual(result['sha256'], SHA)
        self.assertEqual(result['bytes'], len(PAYLOAD))
        self.assertEqual(result['url'], upload.SITE_URL+upload.API+REMOTE)
        self.assertEqual([r.method for r in self.service.calls], ['PUT', 'GET'])
        self.assertEqual(self.path.read_bytes(), PAYLOAD)
        self.assertNotIn(TOKEN, json.dumps(result))

    def test_idempotent_acknowledgement_still_requires_independent_get(self):
        self.service.put_statuses = [204]
        with self.client() as client:
            result = client.upload(self.path, REMOTE, SHA)
        self.assertEqual(result['uploadStatus'], 204)
        self.assertEqual([r.method for r in self.service.calls], ['PUT', 'GET'])

    def test_only_the_exact_current_site_and_safe_names_are_accepted(self):
        for origin in ['http://human-heart-scan-explorer.zhuou557737.chatgpt.site',
                       'https://other.chatgpt.site', upload.SITE_URL+'.evil.test',
                       upload.SITE_URL+'/?x=1', upload.SITE_URL+':443',
                       upload.SITE_URL+'/another', 'https://user:secret@'+upload.SITE_URL[8:]]:
            with self.assertRaises(upload.UploadError):
                upload.UploadClient(origin, TOKEN)
        for token in ['', 'short', ' '*32, 'x'*31+'\n', 'é'*40]:
            with self.assertRaises(upload.UploadError):
                upload.UploadClient(upload.SITE_URL, token)
        for path in [f'tiles/60_0_0-{SHA}.nbe.gz', f'tiles/0_0_67-{SHA}.nbe.gz',
                     f'tiles/01_0_0-{SHA}.nbe.gz', f'tiles/0_0_0-{SHA.upper()}.nbe.gz',
                     f'overview/a.b-{SHA}.hfm.gz', REMOTE+'?x=1', '../'+REMOTE]:
            with self.assertRaises(upload.UploadError):
                upload.validate_remote_path(path, SHA)
        self.assertEqual(upload.validate_remote_path(REMOTE, SHA), 4*1024**2)
        self.assertEqual(upload.validate_remote_path(f'overview/whole-0-{SHA}.hfm.gz', SHA), 32*1024**2)
        self.assertEqual(upload.validate_remote_path(f'manifest-{SHA}.json.gz', SHA), 32*1024**2)

    def test_bad_local_bytes_are_rejected_before_any_request(self):
        self.path.write_bytes(b'changed')
        with self.client() as client, self.assertRaises(upload.UploadError):
            client.upload(self.path, REMOTE, SHA)
        self.assertEqual(self.service.calls, [])
        self.path.write_bytes(b'x'*(upload.TILE_MAX_BYTES+1))
        with self.client() as client, self.assertRaises(upload.UploadError):
            client.upload(self.path, REMOTE, SHA)
        self.assertEqual(self.service.calls, [])

    def test_bad_truncated_oversized_or_transformed_get_never_verifies(self):
        for body, encoding in [(b'X'+PAYLOAD[1:], None), (PAYLOAD[:-1], None),
                               (PAYLOAD+b'x', None), (PAYLOAD, 'gzip')]:
            self.service.reply_bytes = body
            self.service.encoding = encoding
            with self.client() as client, self.assertRaises(upload.UploadError) as raised:
                client.upload(self.path, REMOTE, SHA)
            self.assertNotIn(TOKEN, str(raised.exception))
            self.assertTrue(self.path.is_file())

    def test_redirects_are_not_followed_and_the_secret_is_never_sent_to_another_origin(self):
        self.service.put_statuses = [307]
        self.service.redirect = 'https://unrelated.test/collect'
        with self.client() as client, self.assertRaises(upload.UploadError):
            client.upload(self.path, REMOTE, SHA)
        self.assertEqual(len(self.service.calls), 1)
        self.service.calls.clear()
        self.service.get_statuses = [302]
        with self.client() as client, self.assertRaises(upload.UploadError):
            client.upload(self.path, REMOTE, SHA)
        self.assertEqual([r.method for r in self.service.calls], ['PUT', 'GET'])
        self.assertTrue(self.path.exists())

    def test_transient_retries_are_bounded_and_safe(self):
        self.service.put_statuses = [503, 201]
        self.service.get_statuses = [429, 200]
        with mock.patch.object(upload.time, 'sleep'), self.client() as client:
            self.assertTrue(client.upload(self.path, REMOTE, SHA)['verified'])
        self.assertEqual([r.method for r in self.service.calls], ['PUT', 'PUT', 'GET', 'GET'])
        self.service.calls.clear()
        self.service.put_statuses = [503]*10
        with mock.patch.object(upload.time, 'sleep'), self.client() as client, self.assertRaises(upload.UploadError):
            client.upload(self.path, REMOTE, SHA)
        self.assertEqual(len(self.service.calls), 4)
        self.assertTrue(self.path.exists())

    def test_network_exception_text_cannot_leak_credentials(self):
        calls = []
        def broken(request):
            calls.append(request)
            raise httpx.ConnectError('internal credential '+TOKEN, request=request)
        with mock.patch.object(upload.time, 'sleep'), upload.UploadClient(
                upload.SITE_URL, TOKEN, transport=httpx.MockTransport(broken)) as client:
            with self.assertRaises(upload.UploadError) as raised:
                client.upload(self.path, REMOTE, SHA)
        self.assertEqual(len(calls), 4)
        self.assertNotIn(TOKEN, str(raised.exception))
        self.assertTrue(raised.exception.__suppress_context__)

    def test_workers_bound_inflight_uploads_and_memory_ownership(self):
        self.service.pause = .01
        with self.client(workers=2) as client, ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: client.upload(self.path, REMOTE, SHA), range(6)))
        self.assertTrue(all(r['verified'] for r in results))
        self.assertLessEqual(self.service.maximum_active, 2)

    def run_cli(self, receipt, client):
        argv = ['upload.py', '--file', str(self.path), '--remote-path', REMOTE,
                '--sha256', SHA, '--receipt', str(receipt), '--evict']
        output = io.StringIO()
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(upload, 'read_access', return_value=ACCESS), \
                mock.patch.object(upload.UploadClient, 'from_access', return_value=client), contextlib.redirect_stdout(output):
            result = upload.main()
        self.assertNotIn(TOKEN, output.getvalue())
        return result

    def test_explicit_cli_eviction_follows_verified_receipt(self):
        receipt = self.directory/'verified.json'
        self.assertEqual(self.run_cli(receipt, self.client()), 0)
        self.assertFalse(self.path.exists())
        record = json.loads(receipt.read_text())
        self.assertTrue(record['verified'])
        self.assertTrue(record['evicted'])
        self.assertEqual(record['sha256'], SHA)
        self.assertNotIn(TOKEN, receipt.read_text())

    def test_failed_get_or_changed_local_file_prevents_cli_eviction(self):
        receipt = self.directory/'verified.json'
        self.service.reply_bytes = b'X'+PAYLOAD[1:]
        with self.assertRaises(upload.UploadError):
            self.run_cli(receipt, self.client())
        self.assertTrue(self.path.exists())
        self.assertFalse(receipt.exists())
        self.service.reply_bytes = PAYLOAD
        self.service.get_hook = lambda: self.path.write_bytes(b'new local artifact')
        with self.assertRaises(upload.UploadError):
            self.run_cli(receipt, self.client())
        self.assertEqual(self.path.read_bytes(), b'new local artifact')
        self.assertFalse(json.loads(receipt.read_text())['evicted'])

    def test_read_access_does_not_echo_or_persist_input(self):
        text = json.dumps(ACCESS)+'\n'
        output = io.StringIO()
        with mock.patch.object(sys, 'stdin', io.StringIO(text)), contextlib.redirect_stdout(output):
            self.assertEqual(upload.read_access(), ACCESS)
        self.assertEqual(output.getvalue(), '')
        with mock.patch.object(sys, 'stdin', io.StringIO('invalid '+TOKEN)):
            with self.assertRaises(upload.UploadError) as raised:
                upload.read_access()
        self.assertNotIn(TOKEN, str(raised.exception))


if __name__ == '__main__':
    unittest.main()
