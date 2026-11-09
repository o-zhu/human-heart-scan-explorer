"""Read back the published v28 files and lossless historical aliases."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import sys
import termios
import httpx

ROOT = Path(__file__).resolve().parents[2]
old = termios.tcgetattr(sys.stdin.fileno())
hidden = termios.tcgetattr(sys.stdin.fileno())
hidden[3] &= ~termios.ECHO
termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, hidden)
print('Ready for Site verification access (hidden stdin).', flush=True)
try:
    access = json.loads(sys.stdin.readline(32769))
finally:
    termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, old)
base = access['siteUrl'].rstrip('/')
assert base == 'https://human-heart-scan-explorer.zhuou557737.chatgpt.site'
headers = {'Accept-Encoding': 'identity'}
if access.get('bearer'):
    headers['OAI-Sites-Authorization'] = 'Bearer ' + access['bearer']

def file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()

paths = ['app.js', 'appearance.js', 'render-styles.js', 'renderer.js',
         'fine-surface.js', 'local-surface-refinement.js', 'section-names.js',
         'cpu-worker.js', 'clinical-app.js', 'refinement.css',
         'lumen-cleanup-v23.js', 'volume-picking.js']
paths += [p.relative_to(ROOT / 'public').as_posix()
          for p in sorted((ROOT / 'public/assets/cleanup-v28').iterdir()) if p.is_file()]
aliases = json.loads((ROOT / 'server/cleanup-static-alias-index-v28.json').read_text())

with httpx.Client(headers=headers, follow_redirects=False, timeout=45) as client:
    def check(path):
        local = ROOT / 'public' / path
        expected_size = local.stat().st_size
        expected_hash = file_hash(local)
        digest = hashlib.sha256()
        count = 0
        with client.stream('GET', base + '/' + path) as response:
            if response.status_code != 200:
                raise RuntimeError(f'Live asset {path}: HTTP {response.status_code}')
            for block in response.iter_bytes(1 << 20):
                count += len(block)
                if count > expected_size:
                    raise RuntimeError('Live asset exceeds verified size: ' + path)
                digest.update(block)
        actual = digest.hexdigest()
        assert count == expected_size and actual == expected_hash, path
        return dict(path=path, status=200, bytes=count, sha256=actual,
                    matchesTestedSource=True)

    with ThreadPoolExecutor(max_workers=3) as pool:
        checks = list(pool.map(check, paths))
    alias_checks = []
    for path, item in aliases.items():
        result = client.get(base + path)
        assert result.status_code == 308 and result.headers['location'] == base + item['target'], path
        canonical = check(item['target'].lstrip('/'))
        assert canonical['sha256'] == item['sha256'] and canonical['bytes'] == item['bytes']
        head = client.head(base + path)
        assert head.status_code == 308 and head.headers['location'] == base + item['target']
        alias_checks.append(dict(path=path, target=item['target'], getStatus=308,
                                 headStatus=308, bytes=canonical['bytes'],
                                 sha256=canonical['sha256'], identicalPayload=True))
    response = client.get(base + '/api/fine-detail-v23/status')
    assert response.status_code == 200
    inventory = response.json()
    assert inventory['complete'] and inventory['uploadsEnabled'] is False
    report = dict(verifiedAt=datetime.now(timezone.utc).isoformat(), baseUrl=base,
                  checks=checks, aliases=alias_checks, allMatch=True,
                  fineBankComplete=True, fineUploadsEnabled=False,
                  siteServiceAuthorizationUsed=bool(access.get('bearer')),
                  credentialsRecorded=False, readOnly=True)
    (ROOT / 'docs/release-v28/live-asset-verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)
