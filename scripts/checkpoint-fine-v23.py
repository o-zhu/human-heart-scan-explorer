#!/usr/bin/env python3
"""Build a verified source/results overlay checkpoint, then atomically expose it for Box.

The archive explicitly depends on the named Git baseline; it is not a copy of
the raw scan or the large hosted native bank. No runtime credentials are read.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE = 'e7e9f35ea838d950acc9db6e47ab2325961cc905'


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', required=True)
    parser.add_argument('--phase', required=True)
    parser.add_argument('--include-work', type=Path, help='Also retain verified completed slab checkpoints for direct resume.')
    parser.add_argument('--destination', type=Path, default=Path('/workspace/scratch/556c0933fbc6'))
    args = parser.parse_args()
    assert args.name.startswith('heart-detail-v23-') and args.name.endswith('.zip') and '/' not in args.name
    names = set(git('diff', BASE, '--name-only', '-z').decode().split('\0'))
    names.update(git('ls-files', '--others', '--exclude-standard', '-z').decode().split('\0'))
    names.discard('')
    records = []
    work_records = []
    staging = Path('/workspace/data/exports')
    staging.mkdir(parents=True, exist_ok=True)
    temp_path = staging / (args.name + '.partial')
    assert not temp_path.exists()
    output = args.destination / args.name
    assert not output.exists(), 'Never replace an earlier checkpoint.'
    try:
        with zipfile.ZipFile(temp_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=4) as z:
            for name in sorted(names):
                assert not name.startswith(('.env', '.sites-runtime/', 'node_modules/', '.git/'))
                path = ROOT / name
                if not path.exists():
                    records.append(dict(path=name, deleted=True))
                    continue
                assert path.is_file() and not path.is_symlink(), name
                before = path.stat()
                data = path.read_bytes()
                after = path.stat()
                assert before.st_mtime_ns == after.st_mtime_ns and before.st_size == after.st_size == len(data), f'Changing checkpoint file: {name}'
                digest = hashlib.sha256(data).hexdigest()
                z.writestr('overlay/' + name, data)
                records.append(dict(path=name, bytes=len(data), sha256=digest))
            if args.include_work:
                work=args.include_work.resolve()
                config=json.loads((work/'configuration.json').read_text())
                selected=['configuration.json','source-ready.json','extraction.json','environment.json']
                for receipt_path in sorted((work/'slabs').glob('*.json')):
                    receipt=json.loads(receipt_path.read_text())
                    assert receipt['fingerprint']==config['fingerprint'], 'Slab fingerprint differs from checkpoint configuration.'
                    slab=receipt_path.with_suffix('.npz')
                    assert slab.is_file() and slab.stat().st_size==receipt['bytes']
                    with slab.open('rb') as stream:
                        actual=hashlib.file_digest(stream,'sha256').hexdigest()
                    assert actual==receipt['sha256'], 'Slab checkpoint checksum differs.'
                    selected.extend([slab.relative_to(work).as_posix(),receipt_path.relative_to(work).as_posix()])
                for name in selected:
                    path=work/name
                    data=path.read_bytes()
                    record=dict(path=name,bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
                    if name.startswith('slabs/') and name.endswith('.npz'):
                        receipt=json.loads(path.with_suffix('.json').read_text())
                        assert record['sha256']==receipt['sha256']
                    z.writestr('reconstruction-work/'+name,data)
                    work_records.append(record)
            manifest = dict(project='Heart Explorer', phase=args.phase,
                            createdAt=datetime.now(timezone.utc).isoformat(),
                            baselineCommit=BASE, baselineSiteVersion=33,
                            currentHead=git('rev-parse', 'HEAD').decode().strip(),
                            siteUrl='https://human-heart-scan-explorer.zhuou557737.chatgpt.site',
                            sourcePaths=records,
                            reconstructionWork=work_records,
                            scope='Changed source, scripts, derived assets and review evidence since v33; incomplete work is explicitly retained.',
                            excluded='Original raw scan, unchanged baseline files, unlisted local decoded caches, the full v21 R2 payload bank, runtime credentials.')
            z.writestr('CHECKPOINT-MANIFEST.json', json.dumps(manifest, indent=2) + '\n')
            z.writestr('RESTORE.md', '# Restore Heart Explorer v23 work\n\n'
                        f'1. Restore the source checkout at `{BASE}` (published version33).\n'
                        '2. Verify this ZIP using the neighboring SHA-256 file.\n'
                        '3. Copy every `overlay/` file over that checkout; apply only deletions listed in the manifest.\n'
                        '4. Verify all copied file hashes against CHECKPOINT-MANIFEST.json.\n'
                        '5. Read the v23 docs and progress state before restarting a reconstruction; do not run duplicate jobs.\n'
                        '6. Reinstall documented dependencies and recover measured source banks only if needed.\n\n'
                        'If reconstruction-work/ is present, restore it to a chosen work directory. Its completed slabs have matching SHA-256 receipts, the exact immutable configuration fingerprint, and an environment receipt. After restoring the documented numerical dependencies, resume with `python scripts/fine-detail-v23/resume.py --work PATH --workers 1`. This checks dependency/helper/compiler versions and scientific source hashes before resuming. The source bricks are a separate dependency. The binary is rebuilt from the preserved C++ source. A partial extraction.json may list fewer slabs than the verified receipts; extraction rechecks and reuses every valid completed slab.\n\n'
                        f'Checkpoint phase: {args.phase}\n\n'
                        'This is an overlay recovery checkpoint, not a complete raw-data backup. '
                        'It contains no upload or source-repository credentials. Publication and R2 seed verification are separate steps.\n')
        with zipfile.ZipFile(temp_path) as z, tempfile.TemporaryDirectory(prefix='heart-v23-restore-', dir=staging) as temp:
            assert z.testzip() is None
            restored = Path(temp)
            for record in records:
                if record.get('deleted'):
                    continue
                data = z.read('overlay/' + record['path'])
                assert len(data) == record['bytes'] and hashlib.sha256(data).hexdigest() == record['sha256']
                target = restored / record['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                assert hashlib.sha256(target.read_bytes()).hexdigest() == record['sha256']
            for record in work_records:
                data=z.read('reconstruction-work/'+record['path'])
                assert len(data)==record['bytes'] and hashlib.sha256(data).hexdigest()==record['sha256']
                target=restored/'reconstruction-work'/record['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
                assert hashlib.sha256(target.read_bytes()).hexdigest()==record['sha256']
        digest = hashlib.sha256(temp_path.read_bytes()).hexdigest()
        size = temp_path.stat().st_size
        args.destination.mkdir(parents=True, exist_ok=True)
        temp_path.replace(output)
        output.with_suffix('.zip.sha256').write_text(digest + '  ' + output.name + '\n')
        receipt = dict(path=str(output), bytes=size, sha256=digest, files=len(records),
                       workFiles=len(work_records),
                       archiveReadbackVerified=True, freshOverlayRestoreVerified=True,
                       boxUploadConfirmed=False, phase=args.phase)
        (staging / (args.name.removesuffix('.zip') + '-receipt.json')).write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt))
    finally:
        if temp_path.exists():
            temp_path.unlink()


if __name__ == '__main__':
    main()
