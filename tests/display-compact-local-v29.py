#!/usr/bin/env python3
"""Focused immutable v29 routes and complete portable-export regression checks."""
from pathlib import Path
from unittest.mock import patch
import gzip
import hashlib
import http.client
import importlib.util
import json
import shutil
import tempfile
import threading
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


serve = module('local_serve_v29', 'serve-local.py')
export = module('local_export_v29', 'export-local.py')


def put(root, relative, data):
    target = root/relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


class CompactLocalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='heart-compact-local-v29-')
        self.root = Path(self.temp.name)/'project'
        self.root.mkdir()
        self.portable = ['page.html', 'public/app.js', 'LOCAL-DEVELOPMENT.md',
                         'scripts/serve-local.py', 'scripts/export-local.py']
        for name in self.portable:
            put(self.root, name, b'portable fixture\n')
        self.original = b'original bank bytes\n'
        for _, directory, index_path, _ in serve.ROUTES:
            record = put(self.root, directory+'/sample.bin', self.original)
            put(self.root, index_path, json.dumps({'sample.bin': record}).encode())
        self.payloads = {
            'mesh/positions-000.gz': gzip.compress(b'exact compact positions', mtime=0),
            'sections/x/0190.webp': b'opaque separately indexed WebP fixture',
            'cleanup/pulmonary-lumen-v29.hfm.gz': gzip.compress(b'local patch fixture', mtime=0),
            'sections-manifest.json': b'{"schemaVersion":2,"version":"v29-fixture"}\n',
            'mesh-manifest.json': b'{"schemaVersion":1,"kind":"compact-mesh-fixture"}\n',
            'surface-manifest.json': b'{"schemaVersion":1,"kind":"compact-surface-fixture"}\n',
        }
        self.paths = {
            'mesh/positions-000.gz': 'data/display-compact-v29/mesh/positions-000.gz',
            'sections/x/0190.webp': 'data/display-compact-v29/sections/x/0190.webp',
            'cleanup/pulmonary-lumen-v29.hfm.gz': 'public/assets/cleanup-v29/pulmonary-lumen-v29.hfm.gz',
            'sections-manifest.json': 'public/assets/display-compact-v29/sections-manifest.json',
            'mesh-manifest.json': 'public/assets/display-compact-v29/mesh-manifest.json',
            'surface-manifest.json': 'public/assets/display-compact-v29/surface-manifest.json',
        }
        self.index = {}
        for key, data in self.payloads.items():
            content_type = ('application/json' if key.endswith('.json') else
                            'image/webp' if key.endswith('.webp') else 'application/octet-stream')
            self.index[key] = {**put(self.root, self.paths[key], data), 'contentType': content_type}
        self.save_index()
        self.server = serve.create_server(self.root, port=0, quiet=True)
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=.02), daemon=True)
        self.thread.start()

    def save_index(self):
        put(self.root, serve.COMPACT_INDEX, json.dumps(self.index).encode())

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, method='GET', headers=None, body=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def inventory(self):
        def fake_git(root, *arguments):
            if arguments[0] == 'rev-parse': return b'1'*40
            if arguments[0] == 'show': return b'1700000000'
            if arguments[0] == 'status': return b''
            if arguments[0] == 'ls-files': return ('\0'.join(self.portable)+'\0').encode()
            raise AssertionError(arguments)
        with patch.object(export, 'git', fake_git):
            return export.collect(self.root)

    def test_exact_routes_head_cache_metadata_and_original_bank(self):
        for key, expected in self.payloads.items():
            path = serve.COMPACT_API+key+'?v='+self.index[key]['sha256'][:16]
            status, headers, data = self.request(path)
            self.assertEqual(status, 200)
            self.assertEqual(data, expected)
            self.assertEqual(headers['X-Content-SHA256'], self.index[key]['sha256'])
            self.assertEqual(headers['Content-Type'], self.index[key]['contentType'])
            self.assertNotIn('Content-Encoding', headers)
            status, head_headers, data = self.request(path, 'HEAD')
            self.assertEqual((status, data), (200, b''))
            self.assertEqual(head_headers['Content-Length'], str(len(expected)))
            status, cached_headers, data = self.request(path, headers={'If-None-Match': headers['ETag']})
            self.assertEqual((status, data), (304, b''))
        status, _, data = self.request('/api/ultra/v4/sample.bin')
        self.assertEqual((status, data), (200, self.original))

    def test_missing_unknown_and_writes_do_not_alias_to_original_source(self):
        for path in [serve.COMPACT_API+'sections/x/9999.webp', serve.COMPACT_API+'unlisted.json']:
            self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request(serve.COMPACT_API+'mesh/positions-000.gz', 'PUT', body=b'bad')[0], 405)
        self.assertEqual(self.request(serve.COMPACT_API+'mesh/%2e%2e/positions-000.gz')[0], 400)
        (self.root/self.paths['sections/x/0190.webp']).unlink()
        self.assertEqual(self.request(serve.COMPACT_API+'sections/x/0190.webp')[0], 404)
        with self.assertRaisesRegex(FileNotFoundError, 'Missing export file'):
            self.inventory()

    def test_same_length_corruption_is_rejected_after_a_cached_success(self):
        key = 'mesh/positions-000.gz'
        self.assertEqual(self.request(serve.COMPACT_API+key)[0], 200)
        path = self.root/self.paths[key]
        changed = bytearray(self.payloads[key]); changed[-1] ^= 1
        path.write_bytes(changed)
        self.assertEqual(self.request(serve.COMPACT_API+key)[0], 503)
        with self.assertRaisesRegex(ValueError, 'does not match'):
            self.inventory()
        path.write_bytes(self.payloads[key])
        self.assertEqual(self.request(serve.COMPACT_API+key)[0], 200)

    def test_complete_export_includes_exact_bank_and_roundtrips(self):
        manifest, timestamp = self.inventory()
        files = {item['path']: item for item in manifest['files']}
        for key, relative in self.paths.items():
            self.assertEqual(files[relative]['sha256'], self.index[key]['sha256'])
        compact = [row for row in manifest['collections'] if row.get('kind') == 'derived-display']
        self.assertEqual(sum(row['servedObjects'] for row in compact), len(self.index))
        self.assertEqual(sum(row['servedBytes'] for row in compact), sum(row['bytes'] for row in self.index.values()))
        archive = Path(self.temp.name)/'complete.zip'
        export.create_archive(self.root, archive, manifest, timestamp)
        self.assertTrue(export.verify_zip(archive)['verified'])
        restored = Path(self.temp.name)/'restored'
        with zipfile.ZipFile(archive) as stream:
            stream.extractall(restored)
        self.assertTrue(export.verify(restored/'hi-p-ct-heart-atlas')['verified'])

    def test_optional_old_exports_and_strict_metadata_allowlist(self):
        self.index['unlisted.json'] = self.index['sections-manifest.json']
        self.save_index()
        with self.assertRaisesRegex(ValueError, 'Unknown compact display'):
            serve.load_routes(self.root)
        with self.assertRaisesRegex(ValueError, 'Unknown compact display'):
            self.inventory()
        (self.root/serve.COMPACT_INDEX).unlink()
        with self.assertRaisesRegex(ValueError, 'requires its complete index'):
            self.inventory()
        shutil.rmtree(self.root/'public/assets/display-compact-v29')
        manifest, _ = self.inventory()
        self.assertEqual(len(manifest['collections']), 6)
        self.assertEqual(len(serve.load_routes(self.root)), 6)


if __name__ == '__main__':
    unittest.main(verbosity=2)
