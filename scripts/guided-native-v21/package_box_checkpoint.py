#!/usr/bin/env python3
"""Package an independently forked Heart Explorer checkpoint for Box.

This never changes the active reconstruction, never uploads files, and never
claims a local archive is already backed up. Invoke checkpoint_bank.py first
with a separate ledger/output directory. Existing compressed parts can be
provided by --historical-parts without copying them twice.
"""
from __future__ import annotations
import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

EXTENSIONS = {'.py','.c','.h','.js','.mjs','.cjs','.ts','.tsx','.css','.html',
              '.md','.json','.toml','.yaml','.yml','.txt','.csv','.glsl',
              '.vert','.frag','.sh','.bat','.ps1','.lock','.svg'}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def stable_read(path):
    if path.is_symlink():
        raise ValueError(f'Refusing a symbolic link: {path}')
    first=path.stat()
    if first.st_size > 64*1024**2:
        raise ValueError(f'Unexpected large source/checkpoint file: {path}')
    data=path.read_bytes()
    last=path.stat()
    if (first.st_size,first.st_mtime_ns,first.st_ino)!=(last.st_size,last.st_mtime_ns,last.st_ino):
        raise RuntimeError(f'File changed while being captured; retry: {path}')
    return data

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True)
    p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--historical-parts',type=Path,action='append',default=[])
    p.add_argument('--ledger',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--notes',type=Path,required=True)
    p.add_argument('--verification',type=Path)
    p.add_argument('--staging-dir',type=Path,required=True,
                   help='Nonsynchronized staging directory on the same filesystem as the output.')
    args=p.parse_args()
    root=args.source.resolve(); cp=args.checkpoint.resolve()
    if args.output.exists():
        raise ValueError('An existing archive must never be silently replaced.')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    reference_bytes=stable_read(cp/'control-latest.json')
    reference=json.loads(reference_bytes)
    control_bytes=stable_read(cp/reference['file'])
    if sha(control_bytes)!=reference['sha256'] or len(control_bytes)!=reference['bytes']:
        raise ValueError('The checkpoint control does not match its reference.')
    control=json.loads(gzip.decompress(control_bytes))
    ledger_bytes=stable_read(args.ledger)
    ledger=json.loads(ledger_bytes)
    if ledger['latestControl']['sha256'] != reference['sha256']:
        raise ValueError('The independent ledger advanced; package a stable checkpoint.')
    source_paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).split(b'\0')
    sources=[]
    for raw in source_paths:
        if not raw: continue
        rel=Path(raw.decode())
        if any(c in {'node_modules','dist','data','.cache','.git'} for c in rel.parts): continue
        if any(c.startswith('.') for c in rel.parts) and rel.as_posix() not in {'.openai/hosting.json','.gitignore'}: continue
        if rel.suffix not in EXTENSIONS and rel.name not in {'LICENSE','Dockerfile','.gitignore'}: continue
        if rel.name.lower() in {'access.json','credentials.json','secrets.json'}: continue
        if (root/rel).is_file() and not (root/rel).is_symlink(): sources.append(rel)
    # Preserve the two inspected scientific comparison figures with the textual
    # measurements, without accidentally packaging large hosted asset banks.
    for name in ('surface-comparison.png','regional-comparison.png'):
        rel=Path('docs/guided-native-v21/denoising')/name
        if (root/rel).is_file(): sources.append(rel)
    sources=sorted(set(sources))
    parts=[]
    for item in control['parts']:
        paths=[cp/item['file'],*[d/item['file'] for d in args.historical_parts]]
        path=next((q for q in paths if q.is_file()),None)
        if path is None: raise ValueError(f'Missing immutable part {item["file"]}')
        data=stable_read(path)
        if len(data)!=item['bytes'] or sha(data)!=item['sha256']:
            raise ValueError(f'Part checksum mismatch: {path}')
        parts.append((item,path))
    expected=sum(item['bytes'] for item,_ in parts)+len(control_bytes)+40*1024**2
    if shutil.disk_usage(args.output.parent).free < expected+384*1024**2:
        raise RuntimeError('Insufficient reserve for a bounded archive; active run is unchanged.')
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    dirty=subprocess.check_output(['git','status','--short'],cwd=root,text=True)
    capture={'schema':'heart-box-checkpoint-v1','createdAtUtc':dt.datetime.now(dt.timezone.utc).isoformat(),
             'completedRecords':control['completedRecords'],'plannedRecords':control['plannedRecords'],
             'coverageComplete':control['coverageComplete'],'fingerprint':control['fingerprint'],
             'sourceCommit':head,'sourceIncludesWorkingTree':True,'sourceStatusAtCapture':dirty,
             'nativeSurfacePayloadsIncluded':False,'sourceIntensitiesIncluded':False,
             'coarsePriorBricksIncluded':False,'baseline':'heart-explorer-v12-local.zip',
             'sourceSnapshotNotes':'Exact source bytes are inventoried. The active job was not paused or modified.',
             'backupStatus':'prepared locally; Box submission and readback must be recorded separately'}
    checks={}
    args.staging_dir.mkdir(parents=True,exist_ok=True)
    if args.staging_dir.resolve().is_relative_to(Path('/workspace/scratch')):
        raise ValueError('Build large archives outside the browser-synchronized scratch tree.')
    if args.staging_dir.stat().st_dev != args.output.parent.stat().st_dev:
        raise ValueError('Staging and output must share a filesystem for an atomic final move.')
    temporary=args.staging_dir/(args.output.name+f'.{os.getpid()}.partial')
    if temporary.exists(): raise ValueError('An earlier partial archive exists; inspect it first.')
    try:
        with zipfile.ZipFile(temporary,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=2,allowZip64=True) as z:
            def put(name,data,stored=False):
                z.writestr(name,data,compress_type=zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED)
                checks[name]={'bytes':len(data),'sha256':sha(data)}
            for rel in sources:
                put('source/'+rel.as_posix(),stable_read(root/rel))
            identity=control['processingIdentity']
            for name,value in identity['processingCode'].items():
                if checks['source/scripts/guided-native-v21/'+name]['sha256']!=value:
                    raise ValueError('Scientific source changed from the checkpoint fingerprint.')
            if checks['source/public/assets/ultra-volume-v7.json']['sha256']!=identity['priorManifest']:
                raise ValueError('Coarse guide manifest changed from the checkpoint fingerprint.')
            put('checkpoints/control-latest.json',reference_bytes)
            put('checkpoints/'+reference['file'],control_bytes,True)
            for item,path in parts:
                data=stable_read(path)
                if sha(data)!=item['sha256']: raise ValueError('An immutable part changed during packaging.')
                put('checkpoints/'+item['file'],data,True)
            put('checkpoint-ledger.json',ledger_bytes)
            put('RECOVERY.md',stable_read(args.notes))
            put('package_checkpoint.py',Path(__file__).read_bytes())
            if args.verification: put('restore-verification.json',stable_read(args.verification))
            put('CAPTURE.json',(json.dumps(capture,indent=2)+'\n').encode())
            put('FILES.json',(json.dumps(checks,indent=2,sort_keys=True)+'\n').encode())
        with zipfile.ZipFile(temporary) as z:
            for name,item in checks.items():
                data=z.read(name)
                if len(data)!=item['bytes'] or sha(data)!=item['sha256']:
                    raise ValueError('Archive readback mismatch: '+name)
        os.replace(temporary,args.output)
        h=hashlib.sha256()
        with args.output.open('rb') as f:
            for chunk in iter(lambda:f.read(1024**2),b''): h.update(chunk)
        checksum=h.hexdigest()
        args.output.with_suffix(args.output.suffix+'.sha256').write_text(f'{checksum}  {args.output.name}\n')
        result={**capture,'archive':str(args.output),'bytes':args.output.stat().st_size,
                'sha256':checksum,'files':len(checks),'archiveReadbackVerified':True}
        args.output.with_suffix('.capture.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({k:result[k] for k in ['archive','bytes','sha256','completedRecords','plannedRecords','files','archiveReadbackVerified']},indent=2))
    except Exception:
        # Only our incomplete output is removed; active work is never touched.
        if temporary.exists(): temporary.unlink()
        raise

if __name__=='__main__': main()
