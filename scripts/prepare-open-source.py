#!/usr/bin/env python3
"""Stage a separate public source tree and permitted runtime asset tree.

This never changes the input checkout, publishes, or downloads. A reviewed
license audit is required; public availability is not treated as permission.
Run only after the intended source changes and tests have finished. The output
directories must not exist. Pack the two resulting trees separately.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import fnmatch
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('heart_inventory', Path(__file__).with_name('inventory-public-assets.py'))
INVENTORY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INVENTORY)
FETCH = INVENTORY.FETCH
ASSET_TEXT = {'.json', '.md', '.txt', '.svg'}
DOC_TEXT = {'.json', '.md', '.txt', '.py', '.mjs', '.js', '.sh', '.zarray', '.zattrs', '.zgroup'}
# Explicitly reviewed native renders of the three permitted HOA derivatives.
# This image does not contain publisher figures or external ultrasound frames.
APPROVED_DOC_IMAGE = 'docs/probe-heart-v44/whole-heart-model-review.jpg'
HOA_DIRECTORIES = {
    'anatomy', 'cleanup', 'cleanup-v25', 'cleanup-v26', 'cleanup-v27', 'cleanup-v28',
    'cleanup-v29', 'cleanup-v29-left', 'cleanup-v29-right', 'cleanup-v30',
    'cleanup-v30-left', 'cleanup-v30-right', 'coronary-v36', 'display-compact-v29',
    'donors', 'echo-textures', 'echo-ultra-v6', 'fine-surface-v19', 'fine-surface-v23',
    'flow-textures', 'guided-native-v21', 'lumen-cleanup-v23', 'native-surface-v20', 'noise-cleanup-v22',
    'probe-heart-v44', 'probe-ultra-v7', 'reviewed-mask-v32', 'ultra-sections', 'volume-v5',
}
PRIVATE_DOC = re.compile(r'(?:^|[-_/])(?:box|checkpoint|publication|published|prepublication|upload|recovery|handoff|backup-access|operational-memory-audit|release-status)(?:[-_.\/]|$)', re.I)
BOX_LINK = re.compile(r'https?://[^\s<>"\[\]]*\bbox\.com/[^\s<>"\[\]]*', re.I)
LOCAL_PREFIX = re.compile(r'/workspace/(?:scratch/[^/\s"\x27`<>]+|sites/[^/\s"\x27`<>]+(?:/\.sites-checkout)?|heart-explorer[^/\s"\x27`<>]*(?:/source)?)')
SOURCE_PREFIX = re.compile(r'/workspace/(?:data|heart-open-source-audit)(?=/|[\s"\x27`<>]|$)')
HOME_PREFIX = re.compile(r'/(?:root|home/[^/\s"\x27`<>]+)(?=/|[\s"\x27`<>]|$)')
TEMP_PREFIX = re.compile(r'/tmp/[^/\s"\x27`<>]+')
PROJECT_ID = re.compile(r'appgprj_[A-Za-z0-9]+')
UNAVAILABLE = 'This dataset is not included in the public distribution. See docs/open-source/assets.md for asset setup and the source permission requirements.'


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def json_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')


def source_file(root, relative):
    parts = Path(relative).parts
    if not parts or Path(relative).is_absolute() or any(p in ('.', '..', '') for p in parts):
        raise ValueError('Unsafe source path: '+relative)
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink():
            raise ValueError('Refusing source symlink: '+relative)
    if not path.is_file():
        raise ValueError('Missing/nonregular source file: '+relative)
    return path


def source_files(root):
    # Git's inventory includes intended uncommitted source and preserves dotfiles;
    # ignored dependencies, build products and downloaded data are not selected.
    result = subprocess.run(['git', '-C', str(root), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], check=True, capture_output=True)
    paths = sorted(set(name for name in result.stdout.decode('utf-8').split('\0') if name))
    for name in paths:
        parts = Path(name).parts
        if any(p in {'.git', 'node_modules', '__pycache__', '.wrangler', '.sites-runtime', '.next', 'dist', '.codex', '.agents'} for p in parts):
            continue
        if any(p.startswith(('.env', '.dev.vars')) or p.endswith(('.pem', '.pyc')) for p in parts):
            continue
        if parts[0] in {'data', 'exports', 'outputs', 'work'}:
            continue
        source_file(root, name)
        yield name


def read_audit(path):
    audit = json.loads(path.read_text(encoding='utf-8'))
    if audit.get('schema') != 'heart-explorer-license-audit/1':
        raise ValueError('A reviewed heart-explorer-license-audit/1 file is required')
    families = {item['id']: item for item in audit['families']}
    excluded = {item['path']: item for item in audit['excludedRuntimeFiles']}
    for name in excluded:
        FETCH.validate_destination(name)
    return audit, families, excluded


def reviewed_asset(name, families, excluded):
    if name in excluded:
        family = families[excluded[name]['family']]
        decision = 'excluded'
    else:
        matches = []
        for family in families.values():
            if (name in family.get('paths', []) or
                any(name.startswith(prefix) for prefix in family.get('pathPrefixes', [])) or
                any(fnmatch.fnmatchcase(name, pattern) for pattern in family.get('patterns', []))):
                matches.append(family)
        if len(matches) > 1:
            raise ValueError('Ambiguous reviewed asset family: '+name)
        family = matches[0] if matches else None
        if family is None:
            suffix = Path(name).suffix
            relative = name[len('public/assets/'):]
            directory = relative.split('/')[0]
            if suffix in ASSET_TEXT and (directory in {'echo-media-v6', 'echo-media-v7'} or relative == 'echo-media-v6.json'):
                family = {'id':'echo-media-metadata', 'decision':'include-factual-metadata',
                          'license':'Source catalog and notices; each referenced recording retains its stated license',
                          'notes':'Retain per-clip attribution. Public export removes noncommercial local playback entries.'}
            elif directory in HOA_DIRECTORIES or (directory == 'motion-lab-v24' and '/native-ct/' not in name) or ('/' not in relative and (suffix in ASSET_TEXT or relative.startswith('heart-'))):
                family = families['hoa']
            elif suffix in ASSET_TEXT and (directory in {'clinical-v19', 'motion-lab-v24'}):
                family = families['cmac' if '/cmac/' in name else 'slicerheart']
            elif suffix in ASSET_TEXT and directory in {'tte-atlas', 'tee-atlas'}:
                family = families['external-echo-references']
            else:
                raise ValueError('Unreviewed runtime asset family: '+name)
        decision = 'excluded' if family['decision'].startswith('exclude-') and Path(name).suffix not in ASSET_TEXT else 'permitted'
        if decision == 'excluded':
            raise ValueError('Excluded-family payload is absent from reviewed exclusion list: '+name)
    license_name = family['license']
    if family['id'] == 'original-art':
        license_name = 'MIT'
    entry = {'path': name, 'group': 'runtime', 'redistribution': decision,
             'family': family['id'], 'license': license_name,
             'sourceUrls': family.get('sourceUrls', []),
             'attribution': family.get('attribution', 'See THIRD_PARTY_NOTICES.md and adjacent source metadata.'),
             'modifications': family.get('notes', family.get('scope', ''))}
    if decision == 'excluded':
        entry.update({key: excluded[name][key] for key in ('bytes', 'sha256')})
        entry['reason'] = family['decision']
    elif family['id'] == 'hoa':
        donor = next((d for d in ('s-20-29', 's-20-28') if d in name), 'ladaf-2021-17')
        entry.update(sourceId=donor, sourceUrls=list(INVENTORY.SOURCES[donor]), derived=True)
    return entry


def sanitize_document(text):
    text = BOX_LINK.sub('[private transfer reference omitted]', text)
    text = LOCAL_PREFIX.sub('{local-workspace}', text)
    text = SOURCE_PREFIX.sub('{source-cache}', text)
    text = HOME_PREFIX.sub('{local-home}', text)
    text = TEMP_PREFIX.sub('{temporary-cache}', text)
    return PROJECT_ID.sub('{hosting-project}', text)


def document_omission(name):
    if name == 'AGENTS.md':
        return 'Private workspace operating instructions; public contributor guidance is in CONTRIBUTING.md.'
    if name.startswith('docs/'):
        if name == APPROVED_DOC_IMAGE:
            return None
        if Path(name).suffix.lower() not in DOC_TEXT:
            return 'Documentation binary gallery or research cache omitted; retain text methods and processing code.'
        # Scientific segmentation policies and intensity-recovery methods stay.
        if PRIVATE_DOC.search(name) and not name.lower().endswith('intensity-recovery-review.md'):
            return 'Private transfer/recovery/publication bookkeeping omitted.'
    return None


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise ValueError('Source changed; inspect export transform: '+label)
    return text.replace(old, new, 1)


def ignore_restored_assets(destination, assets):
    """Keep precisely the separate runtime payloads out of ordinary source Git."""
    paths = sorted(item['path'] for item in assets
                   if item['group']=='runtime' and item['redistribution']=='permitted')
    # Anchor exact paths; quote Git glob/comment syntax even though this release
    # uses simple names. Metadata, SVG source, and the reviewed README image stay
    # trackable because none is in the separate payload list.
    patterns = ['/'+re.sub(r'([\\*?\[\]#! ])',r'\\\1',path) for path in paths]
    ignore = destination/'.gitignore'
    original = ignore.read_text(encoding='utf-8') if ignore.exists() else ''
    ignore.write_text(original.rstrip()+'\n\n# Restored runtime payloads: distributed separately with asset-manifest.json.\n'+'\n'.join(patterns)+'\n',encoding='utf-8')
    return {'path':'.gitignore','change':'Ignore the exact '+str(len(paths))+' separately distributed runtime payload paths after restoration; preserve source metadata and the reviewed README visual.'}


def transform_runtime(destination, excluded):
    changes = []
    def edit(name, transform, label):
        path = destination / name
        before = path.read_text(encoding='utf-8')
        after = transform(before)
        if after == before:
            raise ValueError('Export transform made no change: '+label)
        path.write_text(after, encoding='utf-8')
        changes.append({'path': name, 'change': label})

    def tee_art(text):
        pattern = r'"illustration": "\./assets/tee-atlas/art-v2/([a-z0-9]+)\.webp"'
        names = re.findall(pattern, text)
        if len(names) != 28 or len(set(names)) != 28:
            raise ValueError('Expected 28 reviewed TEE illustrations')
        for name in names:
            if not (destination / ('public/assets/tee-atlas/diagrams/'+name+'.svg')).is_file():
                raise ValueError('Missing original TEE diagram: '+name)
        return re.sub(pattern, r'"illustration": "./assets/tee-atlas/diagrams/\1.svg"', text)
    edit('public/tee-atlas-data.js', tee_art, 'Replace excluded TEE art-v2 references with the 28 original SVG diagrams.')

    def clinical(text):
        if text.count('ready:true') != 2:
            raise ValueError('Expected two clinical pilot availability records')
        return text.replace('ready:true', 'ready:false,unavailableReason:'+json.dumps(UNAVAILABLE))
    edit('public/clinical-sources.js', clinical, 'Keep clinical identities and factual metadata; mark unavailable payloads explicitly.')
    edit('public/donors.js', lambda text: replace_once(text, 'donor.ready!==false && (donor.id===id || donor.datasetId===id)', '(donor.id===id || donor.datasetId===id)', 'direct clinical selection'), 'Preserve direct clinical URLs instead of silently substituting LADAF.')
    guard = """async function main(){
 if(donor.ready===false){
  document.body.dataset.donor=donor.id;
  setText('specimenLabel',donor.specimen);
  $('sourceDataset')?.setAttribute('href',donor.datasetUrl);
  $('aboutDatasetLink')?.setAttribute('href',donor.datasetUrl);
  loadingState('Dataset not included',donor.unavailableReason,0);
  $('loadProgress')?.setAttribute('hidden','');
  status('Dataset not included · see asset setup');
  return;
 }
"""
    edit('public/app.js', lambda text: replace_once(text, 'async function main(){\n', guard, 'unavailable dataset startup'), 'Stop excluded dataset startup before any clinical data request and show setup status.')
    edit('public/dataset-browser.js', lambda text: replace_once(text, '  attachDatasetCitation(document,link,source.id);', """  if(source.ready===false){
   link.dataset.availability='not-included';
   const subtitle=link.querySelector('span');if(subtitle)subtitle.textContent='Not included · source details';
   link.setAttribute('aria-label',source.label+' · dataset not included; open asset setup notice');
  }
  attachDatasetCitation(document,link,source.id);""", 'clinical selector labels'), 'Label unavailable dataset links while preserving their source-detail popups.')
    edit('public/dataset-citations.js', lambda text: replace_once(text, ' const {facts,note}=datasetDetails(sourceId);', " const details=datasetDetails(sourceId);const source=ALL_SOURCES.find(item=>item.id===sourceId);\n const facts=details.facts,note=source?.ready===false?source.unavailableReason+' '+details.note:details.note;", 'clinical popup notice'), 'Include the missing-asset notice in clinical hover/focus details.')

    catalog_path = destination / 'public/assets/echo-media-v6.json'
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    kept, removed = [], []
    for clip in catalog['clips']:
        paths = ['public/'+str(clip.get(key, '')).removeprefix('./').lstrip('/') for key in ('url', 'poster')]
        (removed if any(path in excluded for path in paths) else kept).append(clip)
    if not removed:
        raise ValueError('Expected the POCUS mitral clip in the input local media catalog')
    catalog['clips'] = kept
    for clip in removed:
        catalog.setdefault('unavailable', {})[clip['preset']] = 'This optional reference is not included in the public distribution because its source license is noncommercial. See docs/open-source/assets.md.'
    catalog['totalVideoBytes'] = sum(clip['bytes'] for clip in kept)
    catalog['totalPosterBytes'] = sum(clip['posterBytes'] for clip in kept)
    catalog['publicDistribution'] = {'excludedClipIds': [clip['id'] for clip in removed], 'localClipsIncluded': len(kept), 'notice': 'Original source links and rights are documented in THIRD_PARTY_NOTICES.md. Excluded media is never fetched as a substitute.'}
    json_write(catalog_path, catalog)
    changes.append({'path': 'public/assets/echo-media-v6.json', 'change': 'Remove noncommercial POCUS local playback entries and recalculate catalog sizes.'})

    edit('public/motion-lab-v24.js', lambda text: replace_once(text, '  async switchMode(mode) {\n', "  async switchMode(mode) {\n    if(mode==='ct'){this.setPlaying(false);this.setStatus('The SlicerHeart CT comparison is not included in the public distribution. See docs/open-source/assets.md.');return;}\n", 'optional CT motion entry'), 'Explain that the optional clinical CT comparison is excluded; do not request its payloads.')
    return changes


def prepare(root, destination, asset_directory, audit_path, *, plan=False):
    root = root.resolve(strict=True)
    audit, families, excluded = read_audit(audit_path)
    files = list(source_files(root))
    missing = set(excluded)-set(files)
    if missing:
        raise ValueError('Audited excluded files are absent from this source snapshot: '+', '.join(sorted(missing)[:5]))
    decisions, reviewed, metadata = [], [], []
    for name in files:
        reason = document_omission(name)
        entry = None
        if name.startswith('public/assets/'):
            entry = reviewed_asset(name, families, excluded)
            if entry['redistribution'] == 'excluded':
                source = source_file(root, name)
                if source.stat().st_size != entry['bytes'] or sha256(source) != entry['sha256']:
                    raise ValueError('Excluded payload changed since license review: '+name)
                reason = entry['reason']
                reviewed.append(entry)
            elif Path(name).suffix.lower() not in ASSET_TEXT:
                reviewed.append(entry)
            else:
                metadata.append(entry)
        action = 'omit' if reason else 'asset' if entry and Path(name).suffix.lower() not in ASSET_TEXT else 'source'
        decisions.append({'path': name, 'action': action, **({'reason': reason} if reason else {})})
    runtime = INVENTORY.runtime_entries(root, reviewed)
    fine = INVENTORY.fine_entries(root)
    # Source JSON/SVG metadata is already in the checkout. Never download it from
    # the live host over the export's edited catalogs and availability notices.
    embedded = {item['path'] for item in metadata}
    assets = INVENTORY.merge_entries(runtime+[item for item in fine if item['path'] not in embedded])
    counts = Counter(item['action'] for item in decisions)
    result = {'schemaVersion': 1, 'sourceCommit': subprocess.run(['git','-C',str(root),'rev-parse','HEAD'],check=True,capture_output=True,text=True).stdout.strip(),
              'createdAtUtc': datetime.now(timezone.utc).isoformat(),
              'counts': dict(counts), 'permittedRuntimeBytes': sum(x['bytes'] for x in runtime if x['redistribution']=='permitted'),
              'fineDataFiles': sum(x['group']=='fine-data' for x in assets),
              'fineDataBytes': sum(x['bytes'] for x in assets if x['group']=='fine-data'),
              'decisions': decisions}
    if plan:
        return result
    roots = [destination.absolute(), asset_directory.absolute()]
    for output in roots:
        if output.exists() or output.is_symlink() or output == root or root in output.parents:
            raise ValueError('Choose a new output directory outside the source checkout: '+str(output))
        for ancestor in output.parents:
            if ancestor.is_symlink():
                raise ValueError('Refusing output beneath a symlink: '+str(output))
    if roots[0] == roots[1] or roots[0] in roots[1].parents or roots[1] in roots[0].parents:
        raise ValueError('Source and asset output trees must be separate')
    destination.mkdir(parents=True)
    asset_directory.mkdir(parents=True)
    transformed = []
    for decision in decisions:
        name, action = decision['path'], decision['action']
        if action == 'omit':
            continue
        source = source_file(root, name)
        output = (asset_directory if action == 'asset' else destination) / name
        output.parent.mkdir(parents=True, exist_ok=True)
        before = source.stat()
        if name.startswith('docs/') and source.suffix.lower() in DOC_TEXT:
            text = source.read_text(encoding='utf-8')
            clean = sanitize_document(text)
            output.write_text(clean, encoding='utf-8')
            if clean != text:
                transformed.append({'path': name, 'change': 'Normalize historical local cache paths and omit private transfer links.'})
        else:
            shutil.copy2(source, output)
        after = source.stat()
        if (before.st_size,before.st_mtime_ns,before.st_ino) != (after.st_size,after.st_mtime_ns,after.st_ino):
            raise ValueError('Source changed during export; rerun after edits finish: '+name)
        output.chmod(stat.S_IMODE(before.st_mode))
    json_write(destination / '.openai/hosting.json', {key:value for key,value in json.loads((root/'.openai/hosting.json').read_text()).items() if key in {'r2','d1'}})
    transformed.append({'path': '.openai/hosting.json', 'change': 'Remove original hosting project identity; retain optional binding names.'})
    (destination/'LOCAL-DEVELOPMENT.md').write_text('# Local development\n\nStart with [README.md](README.md). The public distribution uses the portable viewer and separately restored, verified assets.\n\n- [Development and checks](docs/open-source/development.md)\n- [Asset setup and licenses](docs/open-source/assets.md)\n- [Scientific methods and limits](docs/open-source/methods.md)\n\nHistoric research reports in `docs/` describe prior runs; they do not certify that omitted native caches, hosted banks, external recordings, or clinical payloads are present in this distribution. Provision your own hosting project before using optional cloud deployment.\n', encoding='utf-8')
    transformed.append({'path': 'LOCAL-DEVELOPMENT.md', 'change': 'Replace historical workspace instructions with current public setup pointers.'})
    transformed.extend(transform_runtime(destination, excluded))
    transformed.append(ignore_restored_assets(destination, assets))
    for item in metadata:
        path = destination / item['path']
        item.update(bytes=path.stat().st_size, sha256=sha256(path), role='embedded-source-metadata')
        item.pop('redistribution', None)
    image = destination / APPROVED_DOC_IMAGE
    if image.is_file():
        metadata.append({'path':APPROVED_DOC_IMAGE, 'bytes':image.stat().st_size, 'sha256':sha256(image),
                         'role':'embedded-reviewed-visual', 'family':'hoa', 'license':'CC-BY-4.0',
                         'sourceIds':list(INVENTORY.SOURCES),
                         'sourceUrls':[url for urls in INVENTORY.SOURCES.values() for url in urls],
                         'attribution':families['hoa']['attribution'],
                         'modifications':'Nine native-rendered views of the project compact whole-heart models; see docs/probe-heart-v44 and the runtime model manifest. Not a browser screenshot or clinical validation.'})
    for entry in assets:
        if entry['redistribution']=='permitted' and entry['group']=='runtime':
            staged = asset_directory / entry['path']
            if not staged.is_file() or staged.stat().st_size != entry['bytes'] or sha256(staged) != entry['sha256']:
                raise ValueError('Staged runtime payload failed verification: '+entry['path'])
    manifest = {'schemaVersion':1, 'assetBaseUrl':FETCH.DEFAULT_BASE_URL,
                'sourceCommit':result['sourceCommit'],
                'licenseNotice':'Original code uses MIT. Datasets/media retain the licenses below and in THIRD_PARTY_NOTICES.md. A download URL is not license evidence.',
                'assets':assets, 'sourceMetadata':metadata,
                'fineDataScope':'Six original active HOA section/volume banks and the compact LADAF v29 display bank. Native quantitative research caches are separate and not claimed complete.'}
    json_write(destination / FETCH.DEFAULT_MANIFEST, manifest)
    FETCH.load_manifest(destination / FETCH.DEFAULT_MANIFEST)
    result['transformations'] = transformed
    result['files'] = []
    for tree, kind in ((destination, 'source'), (asset_directory, 'runtime-asset')):
        for path in sorted(tree.rglob('*')):
            if path.is_file():
                result['files'].append({'tree':kind,'path':path.relative_to(tree).as_posix(),'bytes':path.stat().st_size,'sha256':sha256(path)})
    public_report = {key:value for key,value in result.items() if key != 'files'}
    public_report['notice'] = 'This report lists export omissions and transformations; documentation galleries and private transfer records are intentionally absent except the explicitly cleared HOA whole-heart model render. Scientific segmentation policy JSON and processing scripts are retained.'
    json_write(destination/'docs/open-source/export-report.json', public_report)
    report_path = destination/'docs/open-source/export-report.json'
    result['files'].append({'tree':'source','path':'docs/open-source/export-report.json','bytes':report_path.stat().st_size,'sha256':sha256(report_path)})
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT)
    parser.add_argument('--destination', type=Path, help='New public source directory, outside the input checkout')
    parser.add_argument('--asset-directory', type=Path, help='New runtime payload directory, with public/assets layout')
    parser.add_argument('--audit', type=Path, required=True, help='Explicit reviewed license-audit JSON')
    parser.add_argument('--plan', action='store_true', help='Validate and report the inventory; do not create output trees')
    parser.add_argument('--report', type=Path, help='Optional full external export inventory/checksums JSON')
    args = parser.parse_args(argv)
    if not args.plan and (not args.destination or not args.asset_directory):
        parser.error('--destination and --asset-directory are required unless --plan is used')
    try:
        if args.report:
            report = args.report.absolute()
            protected = [args.source.resolve(), args.audit.resolve()]
            protected.extend(p.resolve() for p in (args.destination,args.asset_directory) if p)
            if any(report.resolve()==path or path in report.resolve().parents for path in protected):
                raise ValueError('Choose an external report path outside the source, audit and export trees')
            if report.is_symlink() or any(parent.is_symlink() for parent in report.parents):
                raise ValueError('Refusing a report path containing a symlink')
        result = prepare(args.source, args.destination, args.asset_directory, args.audit, plan=args.plan)
        if args.report:
            json_write(args.report, result)
        print(json.dumps({key:value for key,value in result.items() if key not in {'files','decisions','transformations'}},indent=2))
        return 0
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        parser.exit(2, 'Public export stopped: '+str(exc)+'\n')


if __name__ == '__main__':
    raise SystemExit(main())
