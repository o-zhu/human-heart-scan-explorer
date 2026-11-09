"""Transport/integrity tests on a loopback fixture; no live dataset download."""
import contextlib
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('fetch_assets', Path(__file__).resolve().parents[1] / 'scripts/fetch-assets.py')
FETCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FETCH)
PAYLOAD = b'Heart Explorer fixture\x00\x01\xff' * 35


def entry(path='public/assets/test.gz', url='/good', group='runtime'):
    return {'path': path, 'url': url, 'group': group, 'redistribution': 'permitted',
            'license': 'CC-BY-4.0', 'bytes': len(PAYLOAD), 'sha256': hashlib.sha256(PAYLOAD).hexdigest()}


class FixtureHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.server.calls.append(self.path)
        if self.path == '/redirect':
            self.send_response(302)
            self.send_header('Location', '/good')
            self.end_headers()
            return
        if self.path == '/cross':
            self.send_response(302)
            self.send_header('Location', 'https://example.invalid/asset')
            self.end_headers()
            return
        if self.path == '/retry' and self.server.calls.count('/retry') == 1:
            self.send_response(503)
            self.end_headers()
            return
        if self.path == '/missing':
            self.send_response(404)
            self.end_headers()
            return
        if self.path == '/failure':
            self.send_response(503)
            self.end_headers()
            return
        data = PAYLOAD
        if self.path == '/bad-hash':
            data = b'x' * len(PAYLOAD)
        if self.path == '/short':
            data = PAYLOAD[:40]
        if self.path == '/long':
            data = PAYLOAD + b'long'
        self.send_response(200)
        if self.path not in ('/short', '/long'):
            self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class AssetFetchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
        cls.server.calls = []
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.server.calls.clear()

    def tearDown(self):
        self.temp.cleanup()

    def manifest(self, assets):
        target = self.root / 'manifest.json'
        target.write_text(json.dumps({'schemaVersion': 1, 'assetBaseUrl': self.base, 'assets': assets}))
        return target

    def test_download_verified_reuse_and_exact_bytes(self):
        record = entry()
        first = FETCH.restore_asset(self.root, record, self.base, attempts=1)
        self.assertEqual(first['status'], 'downloaded')
        self.assertEqual((self.root / record['path']).read_bytes(), PAYLOAD)
        second = FETCH.restore_asset(self.root, record, self.base, attempts=1)
        self.assertEqual(second['status'], 'verified')
        self.assertEqual(self.server.calls, ['/good'])
        self.assertFalse(list(self.root.rglob('*.part-*')))

    def test_bad_hash_short_long_preserve_existing_file(self):
        for endpoint in ('/bad-hash', '/short', '/long'):
            with self.subTest(endpoint=endpoint):
                record = entry(url=endpoint)
                target = FETCH.checked_path(self.root, record['path'], create_parents=True)
                target.write_bytes(b'keep existing file')
                result = FETCH.restore_asset(self.root, record, self.base, attempts=1)
                self.assertEqual(result['status'], 'failed')
                self.assertEqual(target.read_bytes(), b'keep existing file')
                self.assertFalse(list(target.parent.glob('.*.part-*')))

    def test_valid_download_atomically_replaces_corrupt_existing_file(self):
        record = entry()
        target = FETCH.checked_path(self.root, record['path'], create_parents=True)
        target.write_bytes(b'outdated')
        result = FETCH.restore_asset(self.root, record, self.base, attempts=1)
        self.assertEqual(result['status'], 'downloaded')
        self.assertEqual(target.read_bytes(), PAYLOAD)

    def test_dry_run_never_downloads_or_creates_directories(self):
        record = entry()
        result = FETCH.restore_asset(self.root, record, self.base, dry_run=True)
        self.assertEqual(result['status'], 'missing')
        self.assertEqual(self.server.calls, [])
        self.assertFalse((self.root / 'public').exists())

    def test_retry_is_bounded_and_nontransient_404_is_not_retried(self):
        with patch.object(FETCH.time, 'sleep', return_value=None):
            result = FETCH.restore_asset(self.root, entry(url='/retry'), self.base, attempts=3)
            self.assertEqual(result['status'], 'downloaded')
            self.assertEqual(self.server.calls.count('/retry'), 2)
            (self.root / 'public/assets/test.gz').unlink()
            result = FETCH.restore_asset(self.root, entry(url='/failure'), self.base, attempts=3)
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(self.server.calls.count('/failure'), 3)
            result = FETCH.restore_asset(self.root, entry(url='/missing'), self.base, attempts=3)
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(self.server.calls.count('/missing'), 1)

    def test_same_origin_redirect_allowed_cross_origin_blocked(self):
        result = FETCH.restore_asset(self.root, entry(url='/redirect'), self.base, attempts=1)
        self.assertEqual(result['status'], 'downloaded')
        (self.root / 'public/assets/test.gz').unlink()
        result = FETCH.restore_asset(self.root, entry(url='/cross'), self.base, attempts=3)
        self.assertEqual(result['status'], 'failed')
        self.assertIn('redirect', result['error'])
        self.assertEqual(self.server.calls.count('/cross'), 1)

    def test_manifest_rejects_missing_rights_hashes_paths_and_case_collisions(self):
        cases = [dict(entry(), redistribution=None), dict(entry(), sha256='bad'),
                 dict(entry(), bytes=True), dict(entry(), license=''),
                 dict(entry(), path='public/assets/../../app.js'),
                 dict(entry(), path='/tmp/test.gz'), dict(entry(), path='scripts/runner.py'),
                 dict(entry(), path='data/C:drive.gz'), dict(entry(), path='data/NUL'),
                 dict(entry(), path='data/bad\\file'), dict(entry(), path='data/%2e%2e/test'),
                 dict(entry(), url='https://example.invalid/file'),
                 dict(entry(), url='//example.invalid/file'), dict(entry(), url='/good?token=value')]
        for record in cases:
            with self.subTest(record=record), self.assertRaises(FETCH.AssetError):
                FETCH.load_manifest(self.manifest([record]))
        with self.assertRaises(FETCH.AssetError):
            FETCH.load_manifest(self.manifest([entry(), dict(entry(), path='public/assets/TEST.gz')]))

    def test_symlink_target_and_parent_are_rejected_without_request(self):
        record = entry()
        outside = self.root / 'outside'
        outside.mkdir()
        (self.root / 'public').mkdir()
        (self.root / 'public/assets').symlink_to(outside, target_is_directory=True)
        result = FETCH.restore_asset(self.root, record, self.base, attempts=1)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(self.server.calls, [])
        (self.root / 'public/assets').unlink()
        (self.root / 'public/assets').mkdir()
        target = self.root / record['path']
        real = outside / 'real.gz'
        real.write_bytes(PAYLOAD)
        target.symlink_to(real)
        result = FETCH.restore_asset(self.root, record, self.base, attempts=1)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(real.read_bytes(), PAYLOAD)
        self.assertEqual(self.server.calls, [])

    def test_base_url_rejects_credentials_and_nonsecure_remote_sources(self):
        for value in ['http://example.com', 'file:///tmp/x', 'https://user:pass@example.com',
                      'https://example.com?token=private', 'https://example.com/#fragment']:
            with self.subTest(value=value), self.assertRaises(FETCH.AssetError):
                FETCH.base_url(value)
        self.assertEqual(FETCH.base_url('https://example.com/assets/'), 'https://example.com/assets')
        self.assertEqual(FETCH.base_url(self.base), self.base)

    def test_cli_filters_groups_excludes_restricted_assets_and_emits_report(self):
        runtime = entry()
        fine = entry(path='data/ultra-volume-v7/00/00/00.gz', group='fine-data')
        restricted = dict(entry(path='public/assets/clinical-v19/cmac/phase.gz'), redistribution='excluded')
        manifest = self.manifest([runtime, fine, restricted])
        report_path = self.root / 'report.json'
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = FETCH.main(['--manifest', str(manifest), '--root', str(self.root), '--attempts', '1', '--report', str(report_path)])
        self.assertEqual(result, 0)
        report = json.loads(report_path.read_text())
        self.assertEqual(report['counts']['downloaded'], 1)
        self.assertEqual(report['excludedCount'], 1)
        self.assertFalse((self.root / fine['path']).exists())
        self.assertFalse((self.root / restricted['path']).exists())
        self.assertEqual(self.server.calls, ['/good'])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(FETCH.main(['--manifest', str(manifest), '--root', str(self.root), '--list', '--report', str(report_path)]), 0)
        report = json.loads(report_path.read_text())
        self.assertEqual(report['group'], 'all')
        self.assertEqual(report['permittedCount'], 2)
        self.assertEqual(self.server.calls, ['/good'])

    def test_fine_bank_builder_matches_the_portable_server_routes_and_frozen_hashes(self):
        repository = Path(__file__).resolve().parents[1]
        def load(name, path):
            spec = importlib.util.spec_from_file_location(name, path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
        inventory = load('heart_asset_inventory_test', repository / 'scripts/inventory-public-assets.py')
        server = load('heart_local_routes_test', repository / 'scripts/serve-local.py')
        rows = inventory.fine_entries(repository)
        by_path = {item['path']: item for item in rows}
        self.assertEqual(len(by_path), len(rows))
        self.assertEqual(len(server.ROUTES), 6)
        for prefix, destination, index_path, content_type in server.ROUTES:
            index = json.loads((repository / index_path).read_text())
            for name, identity in index.items():
                record = by_path[destination+'/'+name]
                self.assertEqual(record['url'], prefix+name)
                self.assertEqual(record['bytes'], identity['bytes'])
                self.assertEqual(record['sha256'], identity['sha256'])
                self.assertEqual(record['redistribution'], 'permitted')
                self.assertEqual(record['group'], 'fine-data')
                self.assertEqual(record['license'], 'CC-BY-4.0')
        compact = json.loads((repository / server.COMPACT_INDEX).read_text())
        for name, identity in compact.items():
            if name in server.COMPACT_METADATA:
                path = 'public/assets/display-compact-v29/'+name
            else:
                group, suffix = name.split('/', 1)
                path = server.COMPACT_ROOTS[group]+'/'+suffix
            record = by_path[path]
            self.assertEqual(record['url'], server.COMPACT_API+name)
            self.assertEqual(record['bytes'], identity['bytes'])
            self.assertEqual(record['sha256'], identity['sha256'])
        self.assertFalse(any('/clinical-v19/' in item['path'] or '/ucl-' in item['path'] or '/tee-atlas/art-v2/' in item['path'] for item in rows))


if __name__ == '__main__':
    unittest.main()
