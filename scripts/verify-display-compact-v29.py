#!/usr/bin/env python3
"""Verify final public routing and a closed upload gate after full seed readback.

The seed uploader verifies every object's bytes. This final check targets the
changed public routes and activation code without repeating that full download.
Access JSON arrives through the existing hidden-stdin transport.
"""
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import httpx

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('transport', ROOT / 'scripts/upload-native-v20.py')
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


def main():
    index = json.loads((ROOT / 'server/display-compact-index-v29.json').read_text())
    origin, headers = transport.read_access()
    retained_token = headers.pop('X-Heart-Native-Upload')
    selected = [name for name in index if name.endswith('.json') or name.startswith('cleanup/')]
    for prefix in ['mesh/positions-', 'mesh/normals-', 'mesh/indices-', 'sections/x/', 'sections/y/', 'sections/z/']:
        selected.append(next(name for name in index if name.startswith(prefix)))
    checks = []
    with httpx.Client(headers=headers, follow_redirects=False, timeout=90,
                      limits=httpx.Limits(max_connections=4, max_keepalive_connections=4)) as client:
        status = transport.json_response(transport.send(client, origin, 'GET', '/api/display-compact-v29/status'), 'Final display inventory')
        assert status['complete'] and status['expected'] == len(index) and status['verified'] == len(index)
        assert status['bytes'] == sum(item['bytes'] for item in index.values())
        assert status['uploadsEnabled'] is False

        def verify(name):
            item = index[name]
            route = '/assets/cleanup-v29/' + name.split('/', 1)[1] if name.startswith('cleanup/') else '/assets/display-compact-v29/' + name
            reply = transport.send(client, origin, 'GET', route, limit=8 * 1024**2)
            assert reply.status_code == 200, (route, reply.status_code)
            assert len(reply.content) == item['bytes'] and hashlib.sha256(reply.content).hexdigest() == item['sha256'], route
            assert reply.headers.get('x-content-sha256') == item['sha256'], route
            if name.endswith('.gz'):
                assert reply.headers.get('content-encoding') is None, route
            return {'path': route, 'bytes': len(reply.content), 'sha256': item['sha256']}

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            checks = list(pool.map(verify, selected))
        static = ['fine-surface.js', 'donors.js', 'local-surface-refinement.js', 'lumen-cleanup-v23.js',
                  'assets/cleanup-v29/surface-manifest.json', 'assets/cleanup-v29/lumen-manifest.json']
        for name in static:
            expected = (ROOT / 'public' / name).read_bytes()
            reply = transport.send(client, origin, 'GET', '/' + name, limit=2 * 1024**2)
            assert reply.status_code == 200 and reply.content == expected, name
        reply = client.put(origin + '/api/display-compact-v29/' + selected[0], content=b'',
                           headers={'X-Heart-Compact-Upload': retained_token})
        assert reply.status_code == 405, 'Final upload gate is not closed.'
    print(json.dumps({'verified': True, 'objectsInCompleteInventory': len(index),
        'publicObjectsChecked': len(checks), 'publicChecks': checks, 'activeStaticFilesChecked': static,
        'uploadsEnabled': False, 'retainedTokenWriteStatus': 405,
        'scope': 'All seed objects previously verified; this check validates final public routes and activation.'}, indent=2), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Final public delivery check failed; credentials were not printed.', file=sys.stderr)
        sys.exit(1)
