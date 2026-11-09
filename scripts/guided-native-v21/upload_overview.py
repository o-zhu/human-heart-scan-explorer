#!/usr/bin/env python3
"""Upload the completed whole-plan display parts serially, with full GET checks.

This does not deploy the website or change its upload gate. The existing bounded
uploader reads its secret from hidden stdin and writes no credential files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from upload import UploadClient, read_access, write_receipt

FINGERPRINT = '44a31c3adeb20e5a9a3d31f6868f9c92479920f533d2ea3c486e22b4aefa584a'
PLAN_SHA256 = '3be68c22b4f7a000b6e17b4c159f4d9a630b52884ea434624fc70c25999c6e94'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def prepare(directory):
    directory = directory.resolve()
    manifest = json.loads((directory / 'manifest.json').read_text())
    if (manifest.get('complete') is not True or manifest.get('pilot') is not False
            or manifest.get('completeInputCorePlan') is not True
            or manifest.get('nativeBankModified') is not False
            or manifest.get('inputOverviewBlocks') != 37612):
        raise ValueError('Only the completed whole-plan overview may be uploaded')
    source_path = directory / 'input-manifest.json'
    if digest(source_path) != manifest['inputManifestFileSha256']:
        raise ValueError('Overview input-manifest checksum differs')
    source = json.loads(source_path.read_text())
    if source.get('runFingerprint') != FINGERPRINT or source.get('corePlanSha256') != PLAN_SHA256:
        raise ValueError('Overview does not belong to the pinned native plan')
    if {lod['id'] for lod in manifest['lods']} != {'overview', 'detail'}:
        raise ValueError('Both overview and detail display levels are required')
    jobs = []
    for lod in manifest['lods']:
        if lod.get('fingerprint') != manifest['fingerprint']:
            raise ValueError('Display-level fingerprint differs')
        for i, part in enumerate(lod['parts']):
            path = (directory / part['path']).resolve()
            if directory / 'assets' not in path.parents:
                raise ValueError('Display artifact is outside the overview assets directory')
            if (not 0 < part['compressedBytes'] <= 32 * 1024**2
                    or path.stat().st_size != part['compressedBytes']
                    or digest(path) != part['sha256']):
                raise ValueError('Display artifact size or SHA differs')
            jobs.append(dict(lod=lod['id'], part=i, file=path, sha256=part['sha256'],
                bytes=part['compressedBytes'],
                remote=f"overview/whole-{lod['id']}-{i}-{part['sha256']}.hfm.gz"))
    return jobs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--overview', type=Path, required=True)
    parser.add_argument('--receipts', type=Path, required=True)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    jobs = prepare(args.overview)
    if args.dry_run:
        print(json.dumps(dict(ready=True, parts=len(jobs), bytes=sum(j['bytes'] for j in jobs))))
        return
    receipts = []
    with UploadClient.from_access(read_access(), workers=1) as client:
        for job in jobs:
            receipt = client.upload(job['file'], job['remote'], job['sha256'])
            path = args.receipts.parent / f"{job['lod']}-{job['part']}-receipt.json"
            write_receipt(path, receipt)
            receipts.append(receipt)
            print(json.dumps(dict(lod=job['lod'], part=job['part'], verified=True,
                bytes=receipt['bytes'], receipt=str(path))), flush=True)
    write_receipt(args.receipts, dict(receipts=receipts))
    print(json.dumps(dict(complete=True, parts=len(receipts), receipts=str(args.receipts))))


if __name__ == '__main__':
    main()
