#!/usr/bin/env python3
"""Index/stage new display derivatives without removing any source-bank files."""
import argparse, hashlib, json, re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
INDEX=ROOT/'server/display-compact-index-v29.json'
ASSETS=ROOT/'public/assets/cleanup-v29'
COMPACT_MANIFESTS=('sections-manifest.json','mesh-manifest.json','surface-manifest.json')

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024**2),b''):h.update(block)
    return h.hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--write-index',action='store_true')
    mode.add_argument('--stage',action='store_true')
    p.add_argument('--seed',action='store_true')
    args=p.parse_args()
    index=json.loads(INDEX.read_text())
    assert any(k.startswith('mesh/') for k in index) and any(k.startswith('sections/') for k in index)
    if args.write_index:
        index={k:v for k,v in index.items() if not k.startswith('cleanup/')}
        # Keep the new 640 KiB section manifest out of the tightly bounded
        # static archive. Its public URL and source copy remain unchanged.
        for name in COMPACT_MANIFESTS:
            manifest=ROOT/'public/assets/display-compact-v29'/name
            assert manifest.is_file() and not manifest.is_symlink()
            index[name]={'bytes':manifest.stat().st_size,'sha256':sha(manifest),'contentType':'application/json'}
        for path in sorted(ASSETS.glob('*.gz')):
            assert re.fullmatch(r'[a-z0-9-]+\.(?:hfm|sfr|bits|raw)\.gz',path.name)
            assert not path.is_symlink() and 0<path.stat().st_size<=8*1024**2
            index['cleanup/'+path.name]={'bytes':path.stat().st_size,'sha256':sha(path),'contentType':'application/octet-stream'}
        assert any(k.startswith('cleanup/') for k in index)
        INDEX.write_text(json.dumps(index,sort_keys=True,indent=2)+'\n')
        print(json.dumps({'objects':len(index),'bytes':sum(v['bytes'] for v in index.values()),'sourceBanksChanged':False}))
        return
    code=(ROOT/'server/display-compact-store-v29.mjs').read_text()
    serves=re.search(r'export const displayCompactPublicServingEnabled = (true|false);',code).group(1)=='true'
    if args.seed:
        assert not serves,'Seed must not activate unverified compact public data.'
        assert 'export const compactSurfaceEnabled=false;' in (ROOT/'public/fine-surface.js').read_text(),'Seed must retain original live surface profile.'
        assert "ultraManifestUrl:'./assets/ultra-sections/manifest.json'" in (ROOT/'public/donors.js').read_text(),'Seed must retain original section profile.'
    else:assert serves,'Rebuild with compact bank public serving enabled after verification.'
    compiled='\n'.join(p.read_text() for p in (ROOT/'dist/server').rglob('*.js'))
    assert 'Compact display upload is not authorized.' in compiled
    assert all(v['sha256'] in compiled for v in index.values()),'Built Worker must include current index.'
    plans=[]
    for key,item in index.items():
        if key in COMPACT_MANIFESTS:
            source=ROOT/'public/assets/display-compact-v29'/key
            target=ROOT/'dist/client/assets/display-compact-v29'/key
            assert source.stat().st_size==item['bytes'] and sha(source)==item['sha256'],key
            if target.exists():
                assert not target.is_symlink() and target.stat().st_size==item['bytes'] and sha(target)==item['sha256'],key
                plans.append((target,item['bytes']))
            continue
        if not key.startswith('cleanup/'):continue
        name=key.split('/',1)[1];source=ASSETS/name;target=ROOT/'dist/client/assets/cleanup-v29'/name
        assert source.stat().st_size==item['bytes'] and sha(source)==item['sha256'],name
        if target.exists():
            assert not target.is_symlink() and target.stat().st_size==item['bytes'] and sha(target)==item['sha256'],name
            plans.append((target,item['bytes']))
    # The current turn's experimental locations have never been live profiles.
    # Keep their source copies for reproducibility, ship only the selected v29
    # derivatives. No historical collection or URL is part of this allowlist.
    for directory in ['cleanup-v29-left','cleanup-v29-right']:
        for source in (ROOT/'public/assets'/directory).iterdir():
            if not source.is_file() or source.suffix not in ('.gz','.json'):continue
            target=ROOT/'dist/client/assets'/directory/source.name
            if target.exists():
                assert not target.is_symlink() and target.stat().st_size==source.stat().st_size and sha(target)==sha(source)
                plans.append((target,target.stat().st_size))
    for path,size in plans:path.unlink()
    report={'verified':True,'seed':args.seed,'publicServingEnabled':serves,'objects':len(index),'collectionBytes':sum(v['bytes'] for v in index.values()),'removedNewBuildCopies':len(plans),'bytesMovedOutOfStaticArchive':sum(size for _,size in plans),'sourceFilesUnchanged':True,'historicalBanksUnchanged':True,'remainingExpandedBuildBytes':sum(p.stat().st_size for p in (ROOT/'dist').rglob('*') if p.is_file())}
    out=ROOT/'.sites-runtime/compact-display-staging-v29.json';out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))

if __name__=='__main__':main()
