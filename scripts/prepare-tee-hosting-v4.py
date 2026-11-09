#!/usr/bin/env python3
"""Remove insignificant whitespace from six built Echo/volume JSON catalogs.

Source catalogs, image/volume data, key order and literal spellings remain
unchanged. Run after the framework build and before the final static budget
check. This is deliberately a small allowlist, not a general asset rewrite.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOGS = (
    'assets/tee-atlas/plane-fit-v2.json',
    'assets/tee-atlas/media.json',
    'assets/echo-planes.json',
    'assets/echo-media-v6.json',
    'assets/donors/s-20-28/ultra-volume.json',
    'assets/donors/s-20-29/ultra-volume.json',
)


def compact(data):
    output, quoted, escaped = bytearray(), False, False
    for byte in data:
        if quoted:
            output.append(byte)
            if escaped:
                escaped = False
            elif byte == 92:
                escaped = True
            elif byte == 34:
                quoted = False
        elif byte == 34:
            quoted = True
            output.append(byte)
        elif byte not in (9, 10, 13, 32):
            output.append(byte)
    assert not quoted, 'Unclosed JSON string.'
    result = bytes(output)
    assert json.loads(result) == json.loads(data), 'Compaction changed JSON values.'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', action='store_true', required=True)
    parser.parse_args()
    plans, reports = [], []
    for relative in CATALOGS:
        source, target = ROOT/'public'/relative, ROOT/'dist/client'/relative
        assert source.is_file() and target.is_file()
        assert not source.is_symlink() and not target.is_symlink()
        original, built = source.read_bytes(), target.read_bytes()
        result = compact(original)
        assert compact(built) == result, f'Built catalog differs from source: {relative}'
        plans.append((source, target, original, result))
        reports.append(dict(path=relative, originalBytes=len(built), compactedBytes=len(result),
                            savedBytes=len(built)-len(result),
                            sourceSha256=hashlib.sha256(original).hexdigest(),
                            compactedSha256=hashlib.sha256(result).hexdigest()))
    # Verify every catalog before changing any build copy.
    for source, target, original, result in plans:
        pending = target.with_name(target.name+'.pending')
        pending.write_bytes(result)
        pending.replace(target)
        assert source.read_bytes() == original, 'Source catalog changed during staging.'
    report = dict(verified=True, whitespaceOnly=True, sourceFilesUnchanged=True,
                  keyOrderAndLiteralsUnchanged=True, catalogs=reports,
                  savedBytes=sum(item['savedBytes'] for item in reports))
    receipt = ROOT/'.sites-runtime/tee-catalog-staging-v4.json'
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
