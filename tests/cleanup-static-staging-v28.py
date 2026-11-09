"""Staging cannot remove originals, canonical assets, or unchecked duplicates."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cleanup_staging', ROOT / 'scripts/prepare-cleanup-hosting-v28.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix='cleanup-static-staging-') as temp:
    root = Path(temp)
    (root / 'server').mkdir(); (root / 'worker').mkdir(); (root / 'dist/server').mkdir(parents=True)
    (root / 'worker/index.ts').write_text('server/cleanup-static-alias-index-v28.json\ncleanupStaticAliasRequest(request, cleanupStaticAliasIndex)\n')
    index = {}
    for name in module.NAMES:
        payload = (name + ' exact frozen fixture\n').encode()
        old = f'/assets/cleanup-v27/{name}.bits.gz'
        new = old.replace('/cleanup-v27/', '/cleanup-v28/')
        index[old] = dict(target=new, bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
        for base in [root / 'public', root / 'dist/client']:
            for path in [old, new]:
                target = base / path.removeprefix('/')
                target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(payload)
    (root / module.INDEX_NAME).write_text(json.dumps(index))
    bundle = root / 'dist/server/index.js'
    bundle.write_text('Invalid cleanup static alias.\n' + json.dumps(index))
    retained = root / 'dist/client/assets/cleanup-v26/debris-gentle-vertices.raw.gz'
    retained.parent.mkdir(parents=True); retained.write_bytes(b'active unrelated fixture')
    sources = {path: path.read_bytes() for path in (root / 'public').rglob('*') if path.is_file()}
    duplicates = [root / 'dist/client' / url.removeprefix('/') for url in index]
    canonical = root / 'dist/client' / next(iter(index.values()))['target'].removeprefix('/')
    original = canonical.read_bytes()

    # All candidates are verified before the first deletion. A late corruption,
    # missing canonical or stale Worker must leave every duplicate untouched.
    for kind in ['badCanonical', 'missingCanonical', 'badLastDuplicate', 'staleWorker']:
        last = duplicates[-1]; old_last = last.read_bytes(); old_bundle = bundle.read_text()
        if kind == 'badCanonical': canonical.write_bytes(b'corrupt')
        if kind == 'missingCanonical': canonical.unlink()
        if kind == 'badLastDuplicate': last.write_bytes(b'corrupt')
        if kind == 'staleWorker': bundle.write_text('previous worker')
        try:
            with contextlib.redirect_stdout(io.StringIO()): module.run(root, stage=True)
        except RuntimeError:
            pass
        else:
            raise AssertionError('Unsafe staging accepted: ' + kind)
        assert all(path.exists() for path in duplicates)
        canonical.write_bytes(original); last.write_bytes(old_last); bundle.write_text(old_bundle)

    with contextlib.redirect_stdout(io.StringIO()): report = module.run(root, stage=True)
    assert report['removedBuildCopies'] == 3
    assert not any(path.exists() for path in duplicates)
    assert retained.read_bytes() == b'active unrelated fixture'
    assert canonical.read_bytes() == original
    assert all(path.read_bytes() == expected for path, expected in sources.items())
    with contextlib.redirect_stdout(io.StringIO()): repeat = module.run(root, stage=True)
    assert repeat['removedBuildCopies'] == 0 and repeat['bytesSavedByDeduplication'] == 0

print('PASS: staging verifies all inputs first, preserves originals/canonical/debris, rejects stale or corrupt builds, and is idempotent')
