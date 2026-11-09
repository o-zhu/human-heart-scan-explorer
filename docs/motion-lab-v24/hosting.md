# Native CT pilot hosting

The motion pilot has a separate immutable mesh collection. Its public URLs are
`/assets/motion-lab-v24/native-ct/`, its API is `/api/motion-ct-v24/`, and its R2
prefix is `hoa-heart/motion-ct-v24/`. Only the current `.hfm.gz` meshes appear in
`server/motion-ct-index-v24.json`; `manifest.json` remains a static site asset.
No existing collection index or upload gate is changed by these scripts.

## Preparation and build staging

Wait for all phase pairs and the final manifest before pinning the index:

```bash
python scripts/prepare-motion-hosting-v24.py --write-index
```

This verifies each local mesh against the finished manifest's size and SHA-256.
The eight-file pilot has matched native and overview meshes for acquired phases
00, 05, 10 and 15. A populated index cannot be silently replaced with different
content; a changed collection requires a new version.

After the regular site build, retain the native v20 staging step and run the CT
staging step **before the existing v10 static-budget check**:

```bash
python scripts/prepare-native-hosting-v20.py --stage
python scripts/prepare-motion-hosting-v24.py --stage
python scripts/prepare-hosted-display-v10.py --stage
```

The CT stage checks all source and built mesh hashes before removing redundant
CT mesh copies from `dist/client`. It retains the CT manifest and all source
files. It also compacts only the built
`dist/client/assets/ultra-sections/manifest.json`: the parsed values must first
match the source, then a scanner removes whitespace outside JSON strings.
Object order, string escapes, numeric literals and all source bytes stay
unchanged. The current manifest shrinks from 543,910 to 355,663 bytes, saving
188,247 bytes. The stage writes its verification record to
`.sites-runtime/motion-ct-staging-v24.json`.

## Seeding and closing the new collection

The temporary seed release has `motionCTUploadsEnabled = true` and additionally
requires a dedicated runtime `HEART_MOTION_CT_UPLOAD_TOKEN` of at least 32
characters. The write header is `X-Heart-Motion-CT-Upload`. Existing collection
secrets cannot authorize a write to this bank. The storage handler accepts only
exact indexed sizes and SHA-256 values, treats identical repeated uploads as
idempotent, and rejects a conflicting stored object instead of overwriting it.

The uploader uses ordinary HTTPS via `httpx` and accepts one JSON line containing
`siteUrl` and `uploadToken` on hidden standard input. Do not put credentials in
command arguments or files. No service bearer is used for this public site.

```bash
python scripts/upload-motion-ct-v24.py
```

The uploader never follows redirects, retries at most four times, checkpoints
only file names and a nonsecret index fingerprint, and checks both public and
API GET bytes against the pinned checksums. The `--probe` option reads only the
static pilot manifest.

For the final release, set the new `motionCTUploadsEnabled` constant to `false`,
publish that reviewed build, then run:

```bash
python scripts/upload-motion-ct-v24.py --verify-read-only
```

This verifies every public/API GET checksum, the complete inventory with
`uploadsEnabled: false`, and HTTP 405 for a PUT even when the retained temporary
secret is supplied. Credential setup, publication and actual uploads are
separate authorized release operations; preparation does not perform them.

## Local verification

```bash
node --test tests/motion-ct-store-v24.mjs tests/comparison-display-store-v10.mjs
```

These checks cover route isolation, missing/wrong/foreign upload credentials,
explicit gate closure, exact size/SHA pins, immutable conflicts, opaque reads,
conditional responses, and bounded streaming requests.
