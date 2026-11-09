# v28 lossless static-mask deduplication

The final v28 application exceeded the existing conservative static-package allowance by **544,144 bytes** after the normal native/fine/motion/display staging steps. It did not require a new R2 collection or additional geometry reduction. Three historical v27 masks are byte-for-byte identical to the active v28 masks, so the hosted build can retain one copy of each payload while keeping both versions' resource URLs usable.

## Exact scope

| Historical path | Retained canonical path | Bytes saved |
|---|---|---:|
| `/assets/cleanup-v27/arterial.bits.gz` | `/assets/cleanup-v28/arterial.bits.gz` | 287,953 |
| `/assets/cleanup-v27/rv.bits.gz` | `/assets/cleanup-v28/rv.bits.gz` | 381,259 |
| `/assets/cleanup-v27/valve-region.bits.gz` | `/assets/cleanup-v28/valve-region.bits.gz` | 150,529 |
| **Total** | | **819,741** |

`server/cleanup-static-alias-index-v28.json` pins these exact paths, lengths and compressed SHA-256 values. The stage script verifies both original source copies, the retained built canonical copy and any built duplicate before removing anything. It deletes only the three duplicate files from `dist/client/`.

All files in `public/` remain unchanged. Both historical manifests remain unchanged. The v27 atrial mask differs from v28 and remains in the static build. The v26 debris manifest and flags remain active and untouched. No native data, current mesh, old comparison geometry, donor bank or unrelated TEE asset is removed.

## Historical URL behavior

`server/cleanup-static-alias-v28.mjs`, installed by the four-line addition to `worker/index.ts`, handles only GET and HEAD for the three exact historical paths. Once their duplicate static files are omitted, the Worker returns a **308 redirect** to the byte-identical canonical asset on the same origin. It changes only the URL pathname, preserving query strings. Standard `fetch` follows that redirect while retaining GET/HEAD and conditional/range request headers.

The final payload still uses the ordinary static asset delivery path, including its content type, cache behavior, ETag and conditional/range responses. A historical URL's first HTTP response is now a redirect rather than a direct 200; clients deliberately using `redirect: 'manual'` or `redirect: 'error'` would observe that distinction. Current runtime controllers request v28 directly. The unchanged historical v27 manifest is the only shipped text reference to these three old paths found by the staging audit.

There is no new storage binding, R2 route, upload token, open upload gate, cross-origin request, authentication-root rewrite or permission change. `vite.config.ts` and `cloudflare-env.d.ts` are unchanged. The simpler redirect avoids relying on an `ASSETS` binding that was absent from the existing generated Worker configuration.

## Budget

The preflight snapshot, before rebuilding the small Worker addition, measured:

| Measurement | Bytes |
|---|---:|
| Existing staged static files | 265,047,440 |
| Static budget | 264,503,296 |
| Duplicated payloads removed | 819,741 |
| Projected static files | 264,227,699 |
| Projected static headroom | 275,597 |
| Existing complete `dist/` files | 268,207,444 |
| Projected complete `dist/` files | 267,387,703 |

The complete-dist projection excludes the small additional compiled Worker code. The build's actual staging receipt and final compressed/uncompressed archive checks remain authoritative. Tar headers and padding are not included in simple file-byte totals.

## Build sequence

After a fresh framework build, run:

```sh
python3 scripts/prepare-native-hosting-v20.py --stage
python3 scripts/prepare-fine-hosting-v23.py --stage
python3 scripts/prepare-motion-hosting-v24.py --stage
python3 scripts/prepare-cleanup-hosting-v28.py --stage
python3 scripts/prepare-hosted-display-v10.py --stage
```

The new stage must precede the display staging budget gate. Its first size receipt can therefore still include comparison-display payloads that the final staging step will remove. After all staging steps, run `--check` again for the final static/dist totals. If any duplicate has already been omitted, even check mode requires the compiled alias handler.

The script checks that the compiled Worker contains the current alias handler, all three exact URL pairs and their pinned hashes. A stale Worker, changed duplicate, missing canonical file or unsafe path makes staging fail before any deletion. Repeated staging is safe and removes zero additional files. `indexedDuplicateBytes` remains 819,741 even on an idempotent repeat; `bytesSavedByDeduplication` records only savings in the current invocation.

`python3 scripts/prepare-cleanup-hosting-v28.py --check` performs a read-only preflight and reports projected savings. Both modes write `.sites-runtime/cleanup-static-alias-staging-v28.json`, including the reference audit and precise file-byte totals. Keep the final stage-mode receipt with release evidence.

## Verification

```sh
node --test tests/cleanup-static-alias-v28.mjs
python3 tests/cleanup-static-staging-v28.py
```

The tests verify exact identity against the real three mask pairs; same-origin redirects and the strict path/method allowlist; automatic fetch GET and HEAD delivery; unchanged final content-type/cache headers; 304 conditional and 206 range responses; and rejection of malformed external/authentication targets. Staging fixtures prove all-before-any verification, rejection of corrupt or stale builds, retention of source/canonical/active-debris files, and idempotence.

After publication, check all three historical URLs with redirect following and compare final response lengths and SHA-256 values to the index. Also confirm the normal v28 URLs and active v26 debris URLs remain available. No seeding or credential operation is part of this change.
