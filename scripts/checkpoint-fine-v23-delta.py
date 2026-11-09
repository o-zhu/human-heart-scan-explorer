#!/usr/bin/env python3
"""Create a verified publication delta to the complete, confirmed v23 Box checkpoint.

Large scientific payloads already in the base checkpoint must remain unchanged.
Only changed source and publication evidence are repeated. No credentials are read.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

MAX_DELTA_FILE_BYTES = 10 * 1024**2


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe(root, name):
    relative=Path(name)
    assert not relative.is_absolute() and '..' not in relative.parts
    assert relative.parts and not any(part in {
        '.git', '.sites-runtime', 'node_modules', '.wrangler', '.codex',
        '.agents', '__pycache__',
    } for part in relative.parts), 'Runtime or dependency path is excluded: '+name
    assert not any(part.startswith(('.env', '.dev.vars')) for part in relative.parts)
    assert relative.suffix not in {'.pem', '.key', '.p12', '.pfx'}
    assert relative.parts[0] not in {'dist', '.next', '.vinext', 'out', 'coverage', 'outputs', 'work', 'exports'}
    target=root/relative
    assert root.resolve() in target.resolve().parents and not target.is_symlink()
    return target


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--base-manifest',type=Path,required=True)
    parser.add_argument('--base-receipt',type=Path,required=True)
    parser.add_argument('--base-small-overlay',type=Path,required=True)
    parser.add_argument('--version',type=int,required=True)
    parser.add_argument('--deployment',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    root=args.root.resolve();base=json.loads(args.base_manifest.read_text());receipt=json.loads(args.base_receipt.read_text())
    assert receipt['boxUploadConfirmed'] and receipt['boxFolderReadbackVerified']
    assert receipt['archiveReadbackVerified'] and receipt['freshOverlayRestoreVerified']
    previous={item['path']:item for item in base['sourcePaths']}
    def git(*items):return subprocess.check_output(['git','-C',str(root),*items])
    names=set(git('diff','--no-renames',base['baselineCommit'],'--name-only','-z').decode().split('\0'))
    names.update(git('ls-files','--others','--exclude-standard','-z').decode().split('\0'));names.update(previous);names.discard('')
    baseline={}
    for entry in git('ls-tree','-r','-z',base['baselineCommit']).split(b'\0'):
        if not entry:continue
        header,name=entry.split(b'\t',1);mode,kind,oid=header.decode().split()
        baseline[name.decode()]=(mode,kind,oid)
    prior_records=dict(previous)
    def prior_record(name):
        if name in prior_records:return prior_records[name]
        entry=baseline.get(name)
        if entry is None:return None
        mode,kind,oid=entry
        assert kind=='blob' and mode in {'100644','100755'}, 'Unsupported baseline file: '+name
        size=int(git('cat-file','-s',oid))
        assert size<=MAX_DELTA_FILE_BYTES, 'Changed/deleted large baseline file requires a new full checkpoint: '+name
        data=git('cat-file','blob',oid)
        assert len(data)==size
        record=dict(path=name,bytes=size,sha256=hashlib.sha256(data).hexdigest(),baselineBlob=oid)
        prior_records[name]=record
        return record
    def prior_bytes(record):
        assert record['bytes']<=MAX_DELTA_FILE_BYTES, 'Changed/deleted large scientific file requires a new full checkpoint: '+record['path']
        if 'baselineBlob' in record:
            data=git('cat-file','blob',record['baselineBlob'])
        else:
            cached=safe(args.base_small_overlay,record['path'])
            assert cached.is_file(), 'Missing verified base overlay file: '+record['path']
            data=cached.read_bytes()
        assert len(data)==record['bytes'] and hashlib.sha256(data).hexdigest()==record['sha256']
        return data
    records=[];unchanged=0
    for name in sorted(names):
        path=safe(root,name);old=prior_record(name)
        if not path.exists():
            if old and not old.get('deleted'):
                prior_bytes(old)
                records.append(dict(path=name,deleted=True,baseSha256=old['sha256']))
            continue
        assert path.is_file()
        size=path.stat().st_size;sha=digest(path)
        if old and not old.get('deleted') and old['sha256']==sha and old['bytes']==size:
            unchanged+=1;continue
        assert size<=MAX_DELTA_FILE_BYTES, 'Large new/changed file requires a new full checkpoint: '+name
        if old and not old.get('deleted'):
            prior_bytes(old)
        records.append(dict(path=name,bytes=size,sha256=sha,baseSha256=old.get('sha256') if old else None))
    assert records and not args.output.exists()
    parent=dict(name=Path(receipt['path']).name,bytes=receipt['bytes'],sha256=receipt['sha256'],boxUrl=receipt['boxFileUrl'])
    manifest=dict(project='Heart Explorer',kind='published-state delta',createdAt=datetime.now(timezone.utc).isoformat(),
                  baseCheckpoint=parent,baselineCommit=base['baselineCommit'],publishedSourceCommit=git('rev-parse','HEAD').decode().strip(),
                  siteVersion=args.version,deploymentId=args.deployment,sourcePaths=records,unchangedBaseSourceFiles=unchanged,
                  scope='Changed source and publication evidence only. The complete base checkpoint retains all 31 slabs and model payloads.',
                  credentialsIncluded=False)
    staging=Path('/workspace/data/exports');staging.mkdir(exist_ok=True)
    temporary=staging/(args.output.name+'.partial');assert not temporary.exists()
    try:
        with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=5) as z:
            for record in records:
                if record.get('deleted'):continue
                path=safe(root,record['path']);data=path.read_bytes()
                assert len(data)==record['bytes'] and hashlib.sha256(data).hexdigest()==record['sha256']
                z.writestr('overlay/'+record['path'],data)
            z.writestr('CHECKPOINT-MANIFEST.json',json.dumps(manifest,indent=2)+'\n')
            z.writestr('RESTORE.md',f'''# Restore the published Heart Explorer release

This small archive updates the complete **{parent['name']}** checkpoint.

1. Obtain the complete checkpoint at {parent['boxUrl']} and verify SHA-256 `{parent['sha256']}`.
2. Follow that checkpoint's RESTORE.md. It contains the measured reconstruction, all 31 section checkpoints, scientific code and source changes over baseline `{base['baselineCommit']}`. Its documented source-bank dependencies still apply.
3. Verify this delta using its neighboring SHA-256 file. For each existing file replaced or deleted here, verify its `baseSha256` against the restored baseline-plus-checkpoint tree before applying the update.
4. Overlay this archive's `overlay/` files. Apply only deletions explicitly listed in CHECKPOINT-MANIFEST.json, then verify every resulting file hash.
5. Read the publication receipt and RELEASE-STATUS.md. Published website version {args.version} uses source `{manifest['publishedSourceCommit']}`. The final fine collection is read-only and the Gentle detail choice is enabled.

A fresh Git checkout of the published source is also a direct code-recovery route. The base Box checkpoint independently retains the derived mesh and completed reconstruction sections. Runtime credentials and unchanged original raw/source banks are not included. This archive does not repeat the large model payloads.
''')
        with zipfile.ZipFile(temporary) as z,tempfile.TemporaryDirectory(prefix='fine-v23-delta-restore-',dir=staging) as tmp:
            assert z.testzip() is None
            assert json.loads(z.read('CHECKPOINT-MANIFEST.json'))==manifest
            restored=Path(tmp)
            for record in records:
                target=safe(restored,record['path']);target.parent.mkdir(parents=True,exist_ok=True)
                old=prior_records.get(record['path'])
                if old and not old.get('deleted'):
                    target.write_bytes(prior_bytes(old))
                    assert digest(target)==old['sha256']
                if record.get('deleted'):
                    target.unlink();assert not target.exists()
                else:
                    target.write_bytes(z.read('overlay/'+record['path']))
                    assert target.stat().st_size==record['bytes'] and digest(target)==record['sha256']
        result=dict(path=str(args.output),bytes=temporary.stat().st_size,sha256=digest(temporary),files=len(records),
                    baseCheckpoint=parent,archiveReadbackVerified=True,changedFileRestoreVerified=True,boxUploadConfirmed=False,
                    siteVersion=args.version,publishedSourceCommit=manifest['publishedSourceCommit'])
        args.output.parent.mkdir(parents=True,exist_ok=True);temporary.replace(args.output)
        args.output.with_suffix(args.output.suffix+'.sha256').write_text(result['sha256']+'  '+args.output.name+'\n')
        (staging/(args.output.stem+'-receipt.json')).write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result))
    finally:
        if temporary.exists():temporary.unlink()


if __name__=='__main__':main()
