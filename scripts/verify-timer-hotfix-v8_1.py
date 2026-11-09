"""Check the two corrected runtime modules on the published owner-private Site.

Reuses the existing hidden-stdin, same-origin, no-redirect service client.
This is an HTTP byte-integrity check; strict host-receiver behavior is covered
separately by tests/browser-receivers-v8_1.mjs.
"""
import concurrent.futures
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('heart_production_checks', Path(__file__).with_name('verify-production-v8.py'))
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


def main():
    access = checks.access_from_stdin()
    client = checks.Client(access)
    try:
        def verify(path):
            headers, data = client.exact_local(path)
            return {'path': path, 'bytes': len(data), 'sha256': checks.SHA(data),
                    'exactSourceMatch': True, 'cacheControl': headers.get('cache-control')}
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            modules = list(pool.map(verify, ['download-priority.js', 'echo.js']))
        _, page = client.get('/')
        checks.require(b'donorSelect' in page and b'ucl-zcr-2629' in page, 'The expected two-donor page was not served.')
        report = {'verified': True, 'modules': modules, 'twoDonorPageServed': True,
                  'scope': 'Exact published hotfix bytes and page availability; no browser execution claim.'}
    except checks.VerificationError as error:
        report = {'verified': False, 'error': str(error)}
    except Exception as error:
        report = {'verified': False, 'error': type(error).__name__}
    Path(access['reportPath']).write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report), flush=True)
    if not report['verified']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
