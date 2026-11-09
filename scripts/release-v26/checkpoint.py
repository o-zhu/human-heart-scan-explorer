#!/usr/bin/env python3
"""Hash-verified v26 cleanup, Probe and TEE source overlay checkpoint.

The baseline Git commit and unchanged scientific banks are explicit dependencies.
This does not claim to contain another copy of the original acquisition or banks.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--baseline', required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--supplement', type=Path)
    args = p.parse_args()
    assert len(args.baseline) == 40 and git('rev-parse', args.baseline).decode().strip() == args.baseline
    assert args.output.is_absolute() and not args.output.exists()
    names = set(git('diff', '--name-only', '--no-renames', '-z', args.baseline).decode().split('\0'))
    names.update(git('ls-files', '--others', '--exclude-standard', '-z').decode().split('\0'))
    names.discard('')
    records = []
    for name in sorted(names):
        rel = Path(name)
        assert not rel.is_absolute() and '..' not in rel.parts
        assert not any(part in {'.git', '.sites-runtime', 'node_modules', '.wrangler', '__pycache__', 'dist'}
                       or part.startswith(('.env', '.dev.vars')) for part in rel.parts)
        assert rel.suffix not in {'.key', '.pem', '.p12', '.pfx'}
        path = ROOT / rel
        assert not path.is_symlink()
        old = subprocess.run(['git', '-C', str(ROOT), 'show', args.baseline + ':' + name], capture_output=True)
        previous = sha(old.stdout) if old.returncode == 0 else None
        if not path.exists():
            records.append(dict(path=name, deleted=True, baselineSha256=previous))
            continue
        assert path.is_file() and path.stat().st_size <= 64 * 1024**2
        data = path.read_bytes()
        records.append(dict(path=name, bytes=len(data), sha256=sha(data), baselineSha256=previous))
    manifest = dict(project='Heart Explorer', createdAt=datetime.now(timezone.utc).isoformat(),
        kind='heart-explorer-v26-cleanup-probe-tee source overlay', baselineCommit=args.baseline,
        sourceHeadAtPackaging=git('rev-parse', 'HEAD').decode().strip(), sourcePaths=records,
        credentialsIncluded=False, sourceDataChanged=False,
        dependencies=['Baseline Git source commit', 'Unchanged 79.4 µm measured display banks',
          'Verified v23 Gentle bank and its prior complete Box checkpoint',
          'Unchanged guided-native-v21 index and immutable NBE1 bank'],
        scope='Changed app and scientific code, display masks, visibility flags, Probe performance and TEE evidence; not a complete raw-scan or native-bank backup.')
    if args.supplement:
        data = args.supplement.read_bytes()
        manifest['supplement'] = dict(path='supplement/' + args.supplement.name, bytes=len(data), sha256=sha(data))
    staging = Path('/workspace/data/release-v26'); staging.mkdir(parents=True, exist_ok=True)
    temporary = staging / (args.output.name + '.partial')
    assert not temporary.exists()
    with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
        for rec in records:
            if not rec.get('deleted'): archive.write(ROOT / rec['path'], 'overlay/' + rec['path'])
        if args.supplement: archive.write(args.supplement, manifest['supplement']['path'], compress_type=zipfile.ZIP_STORED)
        archive.writestr('CHECKPOINT-MANIFEST.json', json.dumps(manifest, indent=2) + '\n')
        archive.writestr('RESTORE.md', f'''# Restore this Heart Explorer update

Start with Git commit `{args.baseline}` and its unchanged source banks. For each
manifest record, require the stated baseline checksum (or absence for a new
path), then apply the matching `overlay/` file or deletion. Verify every resulting
file against its SHA-256 and byte count. The optional component ledger is
supplemental analysis and is not a hosted browser asset.

The original acquisition, Gentle transport bank and guided native bank remain
external dependencies. Keep their previously verified checkpoints. This archive
does not contain credentials or an independently complete copy of those banks.
''')
    with zipfile.ZipFile(temporary) as archive, tempfile.TemporaryDirectory(dir=staging) as tmp:
        restored = Path(tmp)
        assert archive.testzip() is None
        for rec in records:
            if rec.get('deleted'): continue
            data = archive.read('overlay/' + rec['path'])
            assert len(data) == rec['bytes'] and sha(data) == rec['sha256']
            target = restored / rec['path']; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            assert sha(target.read_bytes()) == rec['sha256']
        if args.supplement:
            data = archive.read(manifest['supplement']['path'])
            assert len(data) == manifest['supplement']['bytes'] and sha(data) == manifest['supplement']['sha256']
    args.output.parent.mkdir(parents=True, exist_ok=True); temporary.replace(args.output)
    receipt = dict(path=str(args.output), bytes=args.output.stat().st_size,
        sha256=sha(args.output.read_bytes()), sourceFiles=len(records), baselineCommit=args.baseline,
        archiveReadbackVerified=True, freshOverlayFilesVerified=True,
        boxUploadConfirmed=False, dependencies=manifest['dependencies'], scope=manifest['scope'])
    args.output.with_suffix('.receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    args.output.with_suffix('.sha256.txt').write_text(receipt['sha256'] + '  ' + args.output.name + '\n')
    print(json.dumps(receipt, indent=2))

if __name__ == '__main__': main()
