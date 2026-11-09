"""The seed/final staging mode must agree with the public storage gate."""
import importlib.util
import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fine_hosting', ROOT / 'scripts/prepare-fine-hosting-v23.py')
hosting = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosting)

with tempfile.TemporaryDirectory(prefix='fine-detail-staging-check-') as tmp:
    hosting.ROOT = Path(tmp)
    source = hosting.ROOT / 'server/fine-detail-store-v23.mjs'
    source.parent.mkdir()
    for serves_public in (False, True):
        source.write_text('export const fineDetailPublicServingEnabled = ' + str(serves_public).lower() + ';\n')
        for seed in (False, True):
            if seed == serves_public:
                try:
                    hosting.validate_stage_configuration(seed)
                except RuntimeError:
                    pass
                else:
                    raise AssertionError('Incompatible stage mode was accepted')
            else:
                assert hosting.validate_stage_configuration(seed) == serves_public
    source.write_text('export const fineDetailPublicServingEnabled = undecided;\n')
    try:
        hosting.validate_stage_configuration(False)
    except RuntimeError:
        pass
    else:
        raise AssertionError('An unreadable deployment gate was accepted')

    # A seed must retain the actual static build copy, not just the source file.
    source.write_text('export const fineDetailPublicServingEnabled = false;\n')
    hosting.ASSETS = hosting.ROOT / 'public/assets'
    hosting.INDEX = hosting.ROOT / 'server/fine-detail-index-v23.json'
    name = 'fine-surface-v19/detail.hfm.gz'
    original = hosting.ASSETS / name
    original.parent.mkdir(parents=True)
    original.write_bytes(b'verified fixture')
    entry = dict(bytes=original.stat().st_size, sha256=hashlib.sha256(original.read_bytes()).hexdigest())
    hosting.INDEX.write_text(json.dumps({name: entry}))
    build_copy = hosting.ROOT / 'dist/client/assets' / name
    build_copy.parent.mkdir(parents=True)
    with patch.object(sys, 'argv', ['prepare-fine-hosting-v23.py', '--stage', '--seed']):
        for invalid in (None, b'changed fixture'):
            if invalid is not None:
                build_copy.write_bytes(invalid)
            try:
                hosting.main()
            except RuntimeError as error:
                assert 'matching static build copy' in str(error)
            else:
                raise AssertionError('A missing or mismatched seed build copy was accepted')
        build_copy.write_bytes(original.read_bytes())
        with contextlib.redirect_stdout(io.StringIO()):
            hosting.main()
        assert build_copy.read_bytes() == original.read_bytes()

print('PASS: stage modes reject mismatched gates; seed requires and preserves verified static copies')
