#!/usr/bin/env python3
"""Export or verify a portable, credential-free Heart Explorer source archive.

Default export input is tracked working-tree source, all public assets, and the
six complete local scan banks, plus the complete v29 derived-display bank when
its index is present. A clean Git checkout is required unless
--allow-dirty is explicit; that mode also includes ordinary untracked source
and marks provenance as modified. No final archive is produced by --dry-run.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = 'EXPORT-MANIFEST.json'
CHECKSUMS = 'SHA256SUMS'
EXCLUDED_PARTS = {
    '.git', 'node_modules', '.next', '.vinext', '.wrangler', '.sites-runtime',
    '.agents', '.codex', '.cache', '__pycache__', '.pytest_cache', '.mypy_cache',
    '.ruff_cache', '.venv', 'venv', '.ssh', '.aws', '.azure', '.config',
    'dist', 'build', 'out', 'coverage', 'outputs', 'exports', 'work',
}
EXCLUDED_NAMES = {
    '.DS_Store', 'Thumbs.db', '.netrc', '.pypirc', 'credentials.json',
    'secrets.json', 'token.json', 'tokens.json', 'id_rsa', 'id_ed25519',
    'EXPORT-MANIFEST.json', 'SHA256SUMS',
}
TEXT_SUFFIXES = {'.py', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.txt', '.yaml', '.yml', '.toml', '.sh', '.ini', '.conf', '.html', '.css'}
SECRET_PATTERNS = [
    re.compile(rb'-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----'),
    re.compile(rb'\b(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{30,}\b'),
    re.compile(rb'\bAKIA[0-9A-Z]{16}\b'),
    re.compile(rb'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{35,}\b'),
    re.compile(rb'(?im)^\s*(?://[^\s]+:)?_authToken\s*=\s*(?!\$\{|\[|<)[A-Za-z0-9_-]{20,}\s*$'),
]
DATA_COLLECTIONS = (
    ('data/ultra-sections', 'server/ultra-upload-index.json', ('manifest.json', 'encoding-records.json')),
    ('data/ultra-volume-v7', 'server/ultra-volume-index-v7.json', ()),
    ('data/donors/s-20-29/ultra-sections', 'server/donors/s-20-29/ultra-index.json', ('manifest.json', 'encoding-records.json')),
    ('data/donors/s-20-29/ultra-volume', 'server/donors/s-20-29/volume-index.json', ()),
    ('data/donors/s-20-28/ultra-sections', 'server/donors/s-20-28/ultra-index.json', ('manifest.json', 'encoding-records.json')),
    ('data/donors/s-20-28/ultra-volume', 'server/donors/s-20-28/volume-index.json', ()),
)
COMPACT_INDEX = 'server/display-compact-index-v29.json'
COMPACT_METADATA = frozenset(('sections-manifest.json', 'mesh-manifest.json', 'surface-manifest.json'))
COMPACT_ROOTS = {
    'mesh': 'data/display-compact-v29/mesh',
    'sections': 'data/display-compact-v29/sections',
    'cleanup': 'public/assets/cleanup-v29',
    'metadata': 'public/assets/display-compact-v29',
}


def portable_relative(value):
    if (not value or value.startswith('/') or '\\' in value or
            any(part in ('', '.', '..') for part in value.split('/')) or
            any(char in value for char in '<>:"|?*') or
            any(ord(char) < 32 or ord(char) == 127 for char in value)):
        raise ValueError('Unsafe or nonportable export path')
    return value


def excluded(relative):
    parts = Path(relative).parts
    name = parts[-1]
    lower = name.lower()
    return (any(part in EXCLUDED_PARTS for part in parts) or name in EXCLUDED_NAMES or
            lower.startswith(('.env', '.dev.vars')) or lower.endswith('.env') or '.env.' in lower or
            lower.endswith(('.pem', '.key', '.p12', '.pfx', '.pyc', '.tsbuildinfo', '.zip', '.tar.gz', '.7z')) or
            lower.startswith(('npm-debug.log', 'yarn-debug.log', 'yarn-error.log', '.pnpm-debug.log')))


def checked_file(root, relative):
    portable_relative(relative)
    path = root.joinpath(*relative.split('/'))
    for ancestor in (path, *path.parents):
        if ancestor == root:
            break
        if ancestor.is_symlink():
            raise ValueError(f'Symlinks are not exported: {relative}')
    path.resolve().relative_to(root)
    if not path.is_file():
        raise FileNotFoundError(f'Missing export file: {relative}')
    return path


def git(root, *arguments):
    return subprocess.check_output(['git', '-C', str(root), *arguments])


def fingerprint(path, *, check_secrets=False):
    before = path.stat()
    digest = hashlib.sha256()
    tail = b''
    with path.open('rb') as stream:
        while True:
            chunk = stream.read(1024*1024)
            if not chunk:
                break
            digest.update(chunk)
            if check_secrets:
                sample = tail+chunk
                if any(pattern.search(sample) for pattern in SECRET_PATTERNS):
                    raise ValueError(f'A possible embedded credential was detected in {path.name}; no value is printed.')
                tail = sample[-512:]
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError(f'A file changed during export: {path.name}')
    return before.st_size, digest.hexdigest()


def collect_compact_data(root, selected, expected):
    """Add the exact optional bank, requiring every indexed file in an export.

    Cleanup and metadata already live under public/. Mesh and section transport
    files use their own data tree, so original source bank paths stay intact.
    """
    index_path = root/COMPACT_INDEX
    if not index_path.exists():
        if any((root/COMPACT_ROOTS['metadata']/name).exists()
               for name in COMPACT_METADATA):
            raise ValueError('Compact display metadata requires its complete index and local data bank for export.')
        return []
    index = json.loads(index_path.read_text(encoding='utf-8'))
    if not isinstance(index, dict) or not index:
        raise ValueError('Invalid compact display index.')
    selected.add(COMPACT_INDEX)
    groups = {}
    for name, record in index.items():
        portable_relative(name)
        if (not isinstance(record, dict) or type(record.get('bytes')) is not int or
                not 0 < record['bytes'] <= 8*1024*1024 or
                not re.fullmatch(r'[0-9a-f]{64}', record.get('sha256', ''))):
            raise ValueError(f'Invalid compact display record: {name}')
        if name in COMPACT_METADATA:
            group, relative_name, content_type = 'metadata', name, 'application/json'
        else:
            if not re.fullmatch(r'mesh/[a-z0-9_.-]+\.gz|sections/(?:[xyz]/[0-9]+|empty)\.webp|cleanup/[a-z0-9-]+\.(?:hfm|sfr|bits|raw)\.gz', name):
                raise ValueError(f'Unknown compact display record: {name}')
            group, relative_name = name.split('/', 1)
            content_type = 'image/webp' if group == 'sections' else 'application/octet-stream'
        if record.get('contentType') != content_type:
            raise ValueError(f'Invalid compact display content type: {name}')
        relative = COMPACT_ROOTS[group]+'/'+relative_name
        # Fail clearly before a purported complete export can omit a derivative.
        checked_file(root, relative)
        selected.add(relative)
        expected[relative] = record
        summary = groups.setdefault(group, {'path': COMPACT_ROOTS[group],
            'manifest': COMPACT_INDEX, 'indexKeyPrefix': '' if group == 'metadata' else group+'/',
            'kind': 'derived-display', 'servedObjects': 0, 'servedBytes': 0})
        summary['servedObjects'] += 1
        summary['servedBytes'] += record['bytes']
    return [groups[group] for group in COMPACT_ROOTS if group in groups]


def collect(root, *, allow_dirty=False):
    commit = git(root, 'rev-parse', 'HEAD').decode().strip()
    timestamp = int(git(root, 'show', '-s', '--format=%ct', 'HEAD').decode().strip())
    status = git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=normal')
    if status and not allow_dirty:
        raise ValueError('Commit the intended source first, or explicitly use --allow-dirty to record modified working-tree provenance.')
    selected = set()
    commands = [('ls-files', '-z', '--cached')]
    if allow_dirty:
        commands.append(('ls-files', '-z', '--others', '--exclude-standard'))
    for command in commands:
        for item in git(root, *command).split(b'\0'):
            if item:
                relative = item.decode('utf-8')
                if not excluded(relative):
                    # A tracked deletion is an intentional working-tree change.
                    if not (root/relative).exists() and allow_dirty:
                        continue
                    selected.add(relative)
    # Public assets and the portable entry points are explicit export inputs.
    for path in (root/'public').rglob('*'):
        if path.is_file():
            relative = path.relative_to(root).as_posix()
            if not excluded(relative):
                selected.add(relative)
    selected.update(('page.html', 'LOCAL-DEVELOPMENT.md', 'scripts/serve-local.py', 'scripts/export-local.py'))
    expected = {}
    collections = []
    for directory, index_path, extras in DATA_COLLECTIONS:
        index = json.loads((root/index_path).read_text(encoding='utf-8'))
        if not isinstance(index, dict) or not index:
            raise ValueError(f'Invalid scan index: {index_path}')
        selected.add(index_path)
        count, total = 0, 0
        for name, record in index.items():
            portable_relative(name)
            if (type(record.get('bytes')) is not int or record['bytes'] <= 0 or
                    not re.fullmatch(r'[0-9a-f]{64}', record.get('sha256', ''))):
                raise ValueError(f'Invalid scan record: {index_path}')
            relative = directory+'/'+name
            expected[relative] = record
            selected.add(relative)
            count += 1
            total += record['bytes']
        for name in extras:
            if (root/directory/name).is_file():
                selected.add(directory+'/'+name)
        collections.append({'path':directory, 'manifest':index_path, 'servedObjects':count, 'servedBytes':total})
    collections.extend(collect_compact_data(root, selected, expected))
    files = []
    for relative in sorted(selected):
        if excluded(relative):
            raise ValueError(f'A required path conflicts with export exclusions: {relative}')
        path = checked_file(root, relative)
        size, sha = fingerprint(path, check_secrets=path.suffix.lower() in TEXT_SUFFIXES or path.name == '.npmrc')
        if relative in expected and (size != expected[relative]['bytes'] or sha != expected[relative]['sha256']):
            raise ValueError(f'A scan file does not match its source manifest: {relative}')
        role = ('compact-display' if relative.startswith('data/display-compact-v29/') else
                'ultra-images' if relative.startswith('data/') and '/ultra-sections/' in relative else
                'fine-volume' if relative.startswith('data/') and ('/ultra-volume/' in relative or '/ultra-volume-v7/' in relative) else
                'public' if relative.startswith('public/') else 'source')
        files.append({'path':relative, 'bytes':size, 'sha256':sha, 'role':role})
    if git(root, 'rev-parse', 'HEAD').decode().strip() != commit or git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=normal') != status:
        raise RuntimeError('The source checkout changed during inventory; rerun after edits stop.')
    return {'schemaVersion':1, 'project':'HiP-CT Heart Explorer', 'sourceCommit':commit,
            'sourceCommitTimeUTC':datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace('+00:00','Z'),
            'workingTreeModified':bool(status),
            'selection':'Tracked working-tree source, public assets, portable entry points, and manifest-listed local scan data, including all indexed compact display derivatives when present.'+
                        (' Ordinary nonignored untracked source was also included.' if allow_dirty else ''),
            'exclusions':'Repository history, dependencies, environment and credential files, private keys, build/runtime caches, publication archives.',
            'collections':collections, 'fileCount':len(files), 'totalFileBytes':sum(item['bytes'] for item in files),
            'files':files}, timestamp


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True)+'\n').encode('utf-8')


def create_archive(root, output, manifest, timestamp, *, name='hi-p-ct-heart-atlas', force=False):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', name):
        raise ValueError('Choose a simple portable top-level folder name.')
    output = output.resolve()
    if output.exists() and not force:
        raise FileExistsError('Output already exists; choose another path or explicitly use --force.')
    output.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.fromtimestamp(max(timestamp, 315532800), timezone.utc)
    date_time = (min(stamp.year,2107), stamp.month, stamp.day, stamp.hour, stamp.minute, stamp.second)
    manifest_raw = json_bytes(manifest)
    checks = {item['path']:item['sha256'] for item in manifest['files']}
    checks[MANIFEST] = hashlib.sha256(manifest_raw).hexdigest()
    checks_raw = ''.join(f'{checks[path]}  {path}\n' for path in sorted(checks)).encode('utf-8')
    generated = {MANIFEST:manifest_raw, CHECKSUMS:checks_raw}
    originals = {item['path']:item for item in manifest['files']}
    descriptor, temporary = tempfile.mkstemp(prefix=output.name+'.', suffix='.partial', dir=output.parent)
    os.close(descriptor)
    try:
        with zipfile.ZipFile(temporary, 'w', allowZip64=True, compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for relative in sorted([*originals, *generated]):
                info = zipfile.ZipInfo(name+'/'+relative, date_time=date_time)
                info.create_system = 3
                executable = relative not in generated and bool(checked_file(root,relative).stat().st_mode & stat.S_IXUSR)
                info.external_attr = ((stat.S_IFREG | (0o755 if executable else 0o644)) << 16)
                info.compress_type = (zipfile.ZIP_STORED if Path(relative).suffix.lower() in {'.gz','.webp','.png','.jpg','.jpeg','.mp4','.woff','.woff2'} else zipfile.ZIP_DEFLATED)
                if relative in generated:
                    archive.writestr(info, generated[relative])
                    continue
                entry = originals[relative]
                info.file_size = entry['bytes']
                digest = hashlib.sha256()
                count = 0
                with checked_file(root,relative).open('rb') as source, archive.open(info,'w',force_zip64=entry['bytes']>=2**31) as target:
                    while True:
                        chunk = source.read(1024*1024)
                        if not chunk:
                            break
                        target.write(chunk);digest.update(chunk);count += len(chunk)
                if count != entry['bytes'] or digest.hexdigest() != entry['sha256']:
                    raise RuntimeError(f'A source file changed while archiving: {relative}')
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    size, sha = fingerprint(output)
    output.with_name(output.name+'.sha256').write_text(f'{sha}  {output.name}\n',encoding='utf-8')
    return {'archive':str(output), 'bytes':size, 'sha256':sha, 'files':manifest['fileCount']+2,
            'sourceCommit':manifest['sourceCommit'], 'workingTreeModified':manifest['workingTreeModified']}


def verify(directory):
    root = directory.resolve()
    manifest_path = checked_file(root,MANIFEST)
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('schemaVersion') != 1:
        raise ValueError('Unsupported export manifest.')
    lines = checked_file(root,CHECKSUMS).read_text(encoding='utf-8').splitlines()
    checks = {}
    for line in lines:
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)',line)
        if not match:
            raise ValueError('Invalid SHA256SUMS record.')
        relative = portable_relative(match[2])
        if relative in checks:
            raise ValueError('Duplicate checksum path.')
        checks[relative] = match[1]
    if checks.get(MANIFEST) != fingerprint(manifest_path)[1]:
        raise ValueError('Export manifest checksum mismatch.')
    expected = {item['path']:item for item in manifest['files']}
    if len(expected) != len(manifest['files']) or set(checks) != set(expected)|{MANIFEST}:
        raise ValueError('Export inventory and SHA256SUMS disagree.')
    for relative, item in expected.items():
        size, sha = fingerprint(checked_file(root,relative))
        if size != item['bytes'] or sha != item['sha256'] or sha != checks[relative]:
            raise ValueError(f'Export verification failed: {relative}')
    return {'verified':True, 'files':len(expected)+1, 'sourceCommit':manifest['sourceCommit'],
            'workingTreeModified':manifest['workingTreeModified'], 'totalFileBytes':sum(item['bytes'] for item in expected.values())}


def verify_zip(path):
    """Read every archived byte and checksum without making another scan copy."""
    with zipfile.ZipFile(path, 'r') as archive:
        entries = archive.infolist()
        names = [item.filename for item in entries]
        if len(names) != len(set(names)) or any(item.is_dir() for item in entries):
            raise ValueError('Duplicate paths or unexpected directory entries in export.')
        for name in names:
            portable_relative(name)
        roots = {name.split('/')[0] for name in names}
        if len(roots) != 1:
            raise ValueError('An export must have one top-level folder.')
        prefix = next(iter(roots))+'/'
        raw_manifest = archive.read(prefix+MANIFEST)
        manifest = json.loads(raw_manifest)
        if manifest.get('schemaVersion') != 1:
            raise ValueError('Unsupported export manifest.')
        checks = {}
        for line in archive.read(prefix+CHECKSUMS).decode('utf-8').splitlines():
            match = re.fullmatch(r'([0-9a-f]{64})  (.+)',line)
            if not match or match[2] in checks:
                raise ValueError('Invalid or duplicate archive checksum record.')
            checks[portable_relative(match[2])] = match[1]
        expected = {portable_relative(item['path']):item for item in manifest['files']}
        if len(expected) != len(manifest['files']) or set(checks) != set(expected)|{MANIFEST}:
            raise ValueError('Archive inventory and checksums disagree.')
        if set(names) != {prefix+name for name in [*expected,MANIFEST,CHECKSUMS]}:
            raise ValueError('Archive contains missing or unlisted files.')
        if hashlib.sha256(raw_manifest).hexdigest() != checks[MANIFEST]:
            raise ValueError('Archived manifest checksum mismatch.')
        for relative,item in expected.items():
            digest = hashlib.sha256();size = 0
            with archive.open(prefix+relative) as source:
                while chunk := source.read(1024*1024):
                    digest.update(chunk);size += len(chunk)
            if size != item['bytes'] or digest.hexdigest() != item['sha256'] or item['sha256'] != checks[relative]:
                raise ValueError(f'Archived file verification failed: {relative}')
        return {'verified':True,'mode':'streamed ZIP contents','files':len(expected)+2,
                'sourceCommit':manifest['sourceCommit'],'workingTreeModified':manifest['workingTreeModified'],
                'totalFileBytes':sum(item['bytes'] for item in expected.values()),'collections':manifest['collections']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--output', type=Path, help='Create the final .zip at this path.')
    mode.add_argument('--dry-run', action='store_true', help='Hash/validate the complete selection; create no archive.')
    mode.add_argument('--verify', type=Path, metavar='EXTRACTED_FOLDER', help='Verify an extracted export without Git or extra packages.')
    mode.add_argument('--verify-zip', type=Path, metavar='ARCHIVE', help='Verify every archived byte without extracting another copy.')
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--allow-dirty', action='store_true')
    parser.add_argument('--name', default='hi-p-ct-heart-atlas')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    try:
        if args.verify is not None:
            result = verify(args.verify)
        elif args.verify_zip is not None:
            result = verify_zip(args.verify_zip)
        else:
            root = args.root.resolve()
            manifest, timestamp = collect(root,allow_dirty=args.allow_dirty)
            if args.dry_run:
                result = {key:value for key,value in manifest.items() if key != 'files'}
                result.update(dryRun=True, inventorySha256=hashlib.sha256(json_bytes(manifest)).hexdigest())
            else:
                result = create_archive(root,args.output,manifest,timestamp,name=args.name,force=args.force)
        print(json.dumps(result,indent=2))
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError) as error:
        parser.exit(1,f'Export stopped: {error}\n')


if __name__ == '__main__':
    main()
