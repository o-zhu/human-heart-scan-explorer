#!/usr/bin/env python3
"""Run the exported Heart Explorer with Python's standard library only.

The server is deliberately read-only and loopback-only. It serves page.html,
public files, and exact manifest-listed local scan objects. Gzip data is sent
as stored bytes, without Content-Encoding: the browser decodes it explicitly.
"""
from __future__ import annotations

import argparse
from email.utils import formatdate
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import shutil
import socket
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
ROUTES = (
    ('/api/ultra/v4/', 'data/ultra-sections', 'server/ultra-upload-index.json', 'image/webp'),
    ('/api/ultra-volume/v7/', 'data/ultra-volume-v7', 'server/ultra-volume-index-v7.json', 'application/octet-stream'),
    ('/api/donors/s-20-29/ultra/', 'data/donors/s-20-29/ultra-sections', 'server/donors/s-20-29/ultra-index.json', 'image/webp'),
    ('/api/donors/s-20-29/volume/', 'data/donors/s-20-29/ultra-volume', 'server/donors/s-20-29/volume-index.json', 'application/octet-stream'),
    ('/api/donors/s-20-28/ultra/', 'data/donors/s-20-28/ultra-sections', 'server/donors/s-20-28/ultra-index.json', 'image/webp'),
    ('/api/donors/s-20-28/volume/', 'data/donors/s-20-28/ultra-volume', 'server/donors/s-20-28/volume-index.json', 'application/octet-stream'),
)
SHA256 = re.compile(r'^[0-9a-f]{64}$')
COMPACT_INDEX = 'server/display-compact-index-v29.json'
COMPACT_API = '/api/display-compact-v29/'
COMPACT_METADATA = frozenset(('sections-manifest.json', 'mesh-manifest.json', 'surface-manifest.json'))
COMPACT_ROOTS = {
    'mesh': 'data/display-compact-v29/mesh',
    'sections': 'data/display-compact-v29/sections',
    'cleanup': 'public/assets/cleanup-v29',
}


def clean_relative(value: str) -> str:
    """Do not normalize traversal away, especially on Windows."""
    if not value or value.startswith('/') or '\\' in value or ':' in value:
        raise ValueError('Invalid path')
    parts = value.split('/')
    if any(not part or part in ('.', '..') or part.startswith('.') or
           any(ord(char) < 32 or ord(char) == 127 for char in part) for part in parts):
        raise ValueError('Invalid path')
    return value


def contained_file(directory: Path, relative: str) -> Path:
    base = directory.resolve()
    candidate = base.joinpath(*clean_relative(relative).split('/')).resolve()
    candidate.relative_to(base)
    if not candidate.is_file():
        raise FileNotFoundError(relative)
    return candidate


def load_routes(root: Path):
    routes = []
    for prefix, directory, manifest, content_type in ROUTES:
        index = json.loads((root/manifest).read_text(encoding='utf-8'))
        if not isinstance(index, dict) or not index:
            raise ValueError(f'Invalid scan index: {manifest}')
        for name, record in index.items():
            clean_relative(name)
            if (not isinstance(record, dict) or type(record.get('bytes')) is not int or
                    record['bytes'] <= 0 or not SHA256.fullmatch(record.get('sha256', ''))):
                raise ValueError(f'Invalid scan entry in {manifest}: {name}')
        routes.append((prefix, root/directory, index, content_type))
    # This optional derived-display bank has a separate identity and on-disk
    # namespace. Never serve original source bytes under a compact asset URL.
    # Old portable exports without its index keep the six original routes.
    compact_path = root/COMPACT_INDEX
    if compact_path.exists():
        compact = json.loads(compact_path.read_text(encoding='utf-8'))
        if not isinstance(compact, dict) or not compact:
            raise ValueError('Invalid compact display index')
        groups = {name: {} for name in COMPACT_ROOTS}
        metadata = {}
        for name, record in compact.items():
            clean_relative(name)
            if (not isinstance(record, dict) or type(record.get('bytes')) is not int or
                    not 0 < record['bytes'] <= 8*1024*1024 or
                    not SHA256.fullmatch(record.get('sha256', ''))):
                raise ValueError(f'Invalid compact display entry: {name}')
            if name in COMPACT_METADATA:
                valid = record.get('contentType') == 'application/json'
                metadata[name] = record
            else:
                match = re.fullmatch(r'(mesh)/([a-z0-9_.-]+\.gz)|(sections)/((?:[xyz]/[0-9]+|empty)\.webp)|(cleanup)/([a-z0-9-]+\.(?:hfm|sfr|bits|raw)\.gz)', name)
                if not match:
                    raise ValueError(f'Unknown compact display entry: {name}')
                group, relative = name.split('/', 1)
                expected_type = 'image/webp' if group == 'sections' else 'application/octet-stream'
                valid = record.get('contentType') == expected_type
                groups[group][relative] = record
            if not valid:
                raise ValueError(f'Invalid compact display content type: {name}')
        # Narrow group routes precede the exact top-level metadata route.
        for group, records in groups.items():
            if records:
                routes.append((COMPACT_API+group+'/', root/COMPACT_ROOTS[group], records, None, True))
        if metadata:
            routes.append((COMPACT_API, root/'public/assets/display-compact-v29', metadata, None, True))
    return routes


def compact_file_matches(server, filename: Path, record, file_stat):
    """Check new immutable derivatives once per actual file state, not per view."""
    signature = (file_stat.st_dev, file_stat.st_ino, file_stat.st_size,
                 file_stat.st_mtime_ns, file_stat.st_ctime_ns, record['sha256'])
    key = str(filename)
    if server.compact_verified.get(key) == signature:
        return True
    digest = hashlib.sha256()
    with filename.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            digest.update(chunk)
    after = filename.stat()
    if ((after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
            != signature[:5] or digest.hexdigest() != record['sha256']):
        return False
    server.compact_verified[key] = signature
    return True


class HeartHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'HeartExplorerLocal/1.0'
    sys_version = ''

    def do_GET(self):
        self.serve_file(head=False)

    def do_HEAD(self):
        self.serve_file(head=True)

    def do_POST(self):
        self.reject_write()

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST

    def reject_write(self):
        # Do not leave an unread request body on a persistent connection.
        self.close_connection = True
        self.send_response(405)
        self.send_header('Allow', 'GET, HEAD')
        self.send_header('Content-Length', '0')
        self.send_header('Connection', 'close')
        self.end_headers()

    def serve_file(self, *, head: bool):
        try:
            parsed = urlsplit(self.path)
            if parsed.scheme or parsed.netloc:
                raise ValueError('Absolute request target')
            path = unquote(parsed.path, errors='strict')
            if path == '/':
                relative = ''
            elif path.startswith('/'):
                relative = clean_relative(path[1:])
            else:
                raise ValueError('Invalid request target')
        except (ValueError, UnicodeError):
            self.send_error(400, 'Invalid request path')
            return

        record = None
        content_type = None
        verify_compact_hash = False
        try:
            if path in ('/', '/page.html', '/index.html'):
                filename = contained_file(self.server.root, 'page.html')
                content_type = 'text/html; charset=utf-8'
            elif path.startswith('/api/'):
                match = next((route for route in self.server.scan_routes if path.startswith(route[0])), None)
                if match is None:
                    raise FileNotFoundError(path)
                prefix, directory, index, content_type = match[:4]
                verify_compact_hash = len(match) == 5 and match[4]
                name = path[len(prefix):]
                record = index.get(name)
                if record is None:
                    raise FileNotFoundError(path)
                if content_type is None:
                    content_type = record['contentType']
                filename = contained_file(directory, name)
            else:
                filename = contained_file(self.server.root/'public', relative)
            stat = filename.stat()
        except (FileNotFoundError, ValueError, OSError):
            self.send_error(404, 'Not found in this local export')
            return

        if record is not None and stat.st_size != record['bytes']:
            self.send_error(503, 'Local scan size does not match its manifest; verify the export')
            return
        if verify_compact_hash:
            try:
                valid = compact_file_matches(self.server, filename, record, stat)
            except OSError:
                valid = False
            if not valid:
                self.send_error(503, 'Local compact display checksum does not match; verify the export')
                return
        etag = f'"sha256-{record["sha256"]}"' if record else f'"local-{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        if self.headers.get('If-None-Match') == etag:
            self.send_response(304)
            self.send_header('ETag', etag)
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            return
        if content_type is None:
            if filename.suffix.lower() in ('.js', '.mjs'):
                content_type = 'text/javascript; charset=utf-8'
            elif filename.suffix.lower() == '.gz':
                content_type = 'application/octet-stream'
            else:
                content_type = mimetypes.guess_type(filename.name)[0] or 'application/octet-stream'
                if content_type.startswith('text/') or content_type == 'application/json':
                    content_type += '; charset=utf-8'
        try:
            with filename.open('rb') as stream:
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(stat.st_size))
                self.send_header('Last-Modified', formatdate(stat.st_mtime, usegmt=True))
                self.send_header('ETag', etag)
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
                if record:
                    self.send_header('X-Content-SHA256', record['sha256'])
                # No Content-Encoding, including for public/*.raw.gz and bricks.
                self.end_headers()
                if not head:
                    shutil.copyfileobj(stream, self.wfile, length=128*1024)
        except (BrokenPipeError, ConnectionResetError):
            # Normal when scrolling cancels an obsolete image/brick request.
            self.close_connection = True
        except OSError:
            self.close_connection = True

    def log_message(self, format, *args):
        if not self.server.quiet:
            # Version query parameters add noise but are not needed in local logs.
            route = urlsplit(self.path).path
            print(f'{self.command} {route} - {args[1] if len(args)>1 else "request"}', flush=True)


class HeartServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def create_server(root=ROOT, host='127.0.0.1', port=8000, *, quiet=False):
    if host not in ('127.0.0.1', 'localhost', '::1'):
        raise ValueError('The local development server only binds to loopback.')
    root = Path(root).resolve()
    if not (root/'page.html').is_file() or not (root/'public/app.js').is_file():
        raise ValueError('Choose the extracted project directory containing page.html and public/.')
    server_type = HeartServer
    if host == '::1':
        class IPv6HeartServer(HeartServer):
            address_family = socket.AF_INET6
        server_type = IPv6HeartServer
    server = server_type((host, port), HeartHandler)
    server.root = root
    server.quiet = quiet
    server.compact_verified = {}
    try:
        server.scan_routes = load_routes(root)
    except Exception:
        server.server_close()
        raise
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', choices=('127.0.0.1', 'localhost', '::1'), default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--quiet', action='store_true')
    args = parser.parse_args()
    server = create_server(args.root, args.host, args.port, quiet=args.quiet)
    host = f'[{args.host}]' if args.host == '::1' else args.host
    print(f'Heart Explorer: http://{host}:{server.server_port}/', flush=True)
    print('Edit page.html or public/ files, save, then reload the browser. Ctrl+C stops the server.', flush=True)
    try:
        server.serve_forever(poll_interval=.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
