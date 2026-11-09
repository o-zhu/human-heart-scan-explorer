# Compact display data in local runs and portable exports

The v29 compact display collection has its own local namespace and immutable
index. The local server and exporter retain all six existing source-bank paths
and bytes. They do not substitute original source bytes for a missing compact
object, because that would violate the new object's checksum and identity.

## Exact routes

`server/display-compact-index-v29.json` is the allowlist for the following routes.
Every record supplies its exact byte count, SHA-256 and content type.

| Browser route | Local file |
|---|---|
| `/api/display-compact-v29/mesh/<name>.gz` | `data/display-compact-v29/mesh/<name>.gz` |
| `/api/display-compact-v29/sections/<axis>/<number>.webp` | `data/display-compact-v29/sections/<axis>/<number>.webp` |
| `/api/display-compact-v29/sections/empty.webp` | `data/display-compact-v29/sections/empty.webp` |
| `/api/display-compact-v29/cleanup/<name>.gz` | `public/assets/cleanup-v29/<name>.gz` |
| `/api/display-compact-v29/sections-manifest.json` | `public/assets/display-compact-v29/sections-manifest.json` |
| `/api/display-compact-v29/mesh-manifest.json` | `public/assets/display-compact-v29/mesh-manifest.json` |
| `/api/display-compact-v29/surface-manifest.json` | `public/assets/display-compact-v29/surface-manifest.json` |

Only the three literal metadata names in this table are accepted. An unlisted
object receives HTTP 404. A listed file whose size or checksum differs receives
HTTP 503. The server caches successful checksum checks by the actual file state
(including inode, size, modification and change times), and checks again when
that state changes. It supports GET, HEAD and conditional responses; writes
receive HTTP 405. Compressed payloads have no HTTP `Content-Encoding` and reach
the browser as their exact indexed bytes.

The existing public metadata and cleanup URLs are also available from their
retained `public/` source files during local runs. The hosted build may remove
verified redundant build copies and route those same URLs through the separate
immutable collection; it does not remove the local source files.

## Complete exports

The exporter includes the compact index and every indexed derivative whenever
that index is present. Mesh and section files come from the separate data tree;
metadata and cleanup files come from their retained public source paths. It
verifies every selected file against the index before creating an archive.
The export manifest records the four derived-display groups independently of
the six original scan collections.

A v29 complete export requires all listed compact data files. Missing or
corrupted files stop creation with an explicit error. Metadata without its
index also stops creation. Older exports that have neither v29 metadata nor the
new index continue to use the original six collections.

The normal commands remain:

```sh
python3 scripts/serve-local.py
python3 scripts/export-local.py --dry-run
python3 scripts/export-local.py --output /path/outside/project/heart-explorer-local.zip
python3 scripts/export-local.py --verify-zip /path/outside/project/heart-explorer-local.zip
```

Creation requires the six original local scan banks as before, plus the indexed
v29 derivatives. No hosted credentials are required to run or verify an already
complete export. Recover missing derivatives from a verified prepared copy into
their exact paths; do not rename original source-bank files into this namespace.

## Verification in this checkout

`local-bank-verification.json` records installation and verification of **1,139
objects, 587,787,154 bytes**: 32 mesh parts, 1,097 sections, seven cleanup binaries
and three metadata files. The 1,129 new mesh/section files were hardlinked from
the prepared compact data, with both source and target checked against every
indexed byte count and SHA-256. The ten retained public files were checked in
place. No source-bank file was changed.

The five focused tests in `tests/display-compact-local-v29.py` pass. They exercise
the actual loopback HTTP server, all three literal JSON names, HEAD/304, original
bank preservation, missing objects, traversal rejection, read-only responses,
same-length corruption after a cached successful check, and complete fixture
ZIP creation/extraction/verification. They also verify backward compatibility
for an export without the optional bank. The fixture uses small opaque payloads
to test serving and export integrity; it is not an image or geometry quality
assessment.

The four targeted hosted-store tests for cleanup aliases and JSON metadata pass
as well. The JSON tests verify scoped uploads and public/API reads for all three
literal names, reject unlisted JSON, and confirm that the older comparison-store
helper still rejects JSON without an explicit opt-in. The release upload-gate
test must run after the temporary seed gate is closed.

A new full three-donor portable archive was not produced as part of these
focused checks. The actual new bank was verified in full; archive round trips
were tested with the disposable complete fixture.
