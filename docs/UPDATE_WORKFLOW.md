# Heart Explorer — Update and Release Workflow

## Current delivery policy — November 13, 2026

The user has replaced the Box handoff with direct GitHub delivery. For new
updates, implement and verify the requested change, publish the corresponding
Site revision, and integrate the public source changes into the existing GitHub
repository. Box uploads, queue polling, delta archives and transport sidecars
are no longer required unless the user explicitly requests them.

Record the exact source baseline, affected files, checks, Site publication
result and GitHub commit. Keep the hosted and public distributions separate:
transplant only the intended source changes onto the current public branch,
preserving public configuration, licensing records and excluded assets. Never
copy a complete hosted checkout or its private AGENTS instructions into GitHub.
Use a normal fast-forward update or the repository's required pull-request
process; do not force-push or overwrite concurrent work.

The archive procedures below are retained only for recovery of historical
updates. They do not impose Box delivery or archive creation on new work.

**Status:** official project procedure, established November 9, 2026.

**Canonical repository path:** `docs/UPDATE_WORKFLOW.md`.

## 1. Purpose and authority

Continue developing Heart Explorer in context-rich project chats. After each completed update, preserve a small, dated, versioned update archive in the configured Box destination. The user decides when to batch those updates into the public GitHub repository through Codex.

The requested website change authorizes the normal implementation, verification, live publication, and Box delivery work. Do not introduce a separate approval gate for these routine steps. An ordinary chat update does **not** authorize an unsolicited public GitHub sync; perform that when the user requests integration or invokes the sync prompt.

Project locations:

- Website: <https://human-heart-scan-explorer.zhuou557737.chatgpt.site>
- Public source: <https://github.com/o-zhu/human-heart-scan-explorer>
- Personal projects: <https://oliver-zhu.zhuou557737.chatgpt.site/>
- Integration instructions: `docs/CODEX_SYNC_PROMPT.md`.

Keep Box read/upload endpoints in the private delivery configuration or archive-level `CODEX_PROMPT.md` handoff. That top-level prompt may contain real endpoints for standalone use. Its public counterpart, `payload/docs/CODEX_SYNC_PROMPT.md`, must remain generic. Never commit the whole ZIP, top-level transport documents, upload-request tokens, signed URLs, credentials, or private receipts.

## 2. Separate the three versions

Track these independently:

| Record | What it establishes |
| --- | --- |
| Working source and deployed Sites version | The code being edited and the version actually served |
| Queue sequence and unique update ID | A saved incremental update available for integration |
| GitHub commit and applied-update ledger | Changes actually integrated into the public repository |

At initialization, the observed live publication was Sites **v79**. Start the new queue at proposed sequence **80**, displayed as **v0080**, and increment from the latest verified queue state. This is an explicit migration convention; queue sequence and Sites publication number are separate counters and may diverge. Record actual values in every handoff.

The initial public import was observed at `a889432c664435f2e246a1c5b4c9e846517b287f` on November 9, 2026. This is historical baseline information, not an instruction to reset the repository. Always inspect its current HEAD.

Give every update a globally unique ID, such as UTC timestamp plus a random suffix. Sequence numbers and timestamps help people navigate; dependencies and hashes determine applicability. Parallel chats can choose the same next sequence, so a sequence collision must never cause an overwrite.

## 3. Establish the actual baseline before editing

1. Read `AGENTS.md`, this document, current source metadata, and `updates/applied.json` if present. For the first archive, use the bootstrap procedure in section 7 when these files are absent.
2. Inspect the current working revision, deployed revision, public repository HEAD, and Box queue manifests. Determine which pending updates are already present in the working source.
3. Capture the exact pre-change source revision. Use an isolated branch/worktree where practical and preserve unrelated dirty work.
4. Record parent update IDs. Retrieve missing predecessors before building on their results; do not infer inclusion from a filename or a higher version number.

Legacy initialization reference: `heart-explorer__20261109T151809Z__12d1f5` replaced the previous source package and reused four unchanged asset archives from `heart-explorer__20261109T051614Z__5b13c0`. Consult their manifests when reconstructing that baseline. Do not replay both legacy source packages as independent new-format patches.

### Public source differs from the deployed site

The initial GitHub import intentionally omitted restricted clinical/echo assets. A full Sites checkout is not interchangeable with the public repository. Preserve those exclusions, public-only documentation, licensing records, and repository/build configuration.

For a GitHub-targeted archive, use `distribution_scope: "public-source-payload"` and `transport_private: true`: only the mapped source payload is intended for public integration, while top-level handoff documents may remain private. Keep endpoint tokens out of the manifest. If a change also affects private deployment assets, preserve those in a separate private deployment package. Do not integrate that package publicly. Preserve citations and attribution.

The original public repository had neither `AGENTS.md` nor the bundle helper. The deployed Sites `AGENTS.md` contains extensive private/staging context and must **never** be copied to public GitHub. Ship `docs/AGENTS_UPDATE_INSTRUCTIONS.md` as a public payload file; create public root `AGENTS.md` from its instruction section, or append that section while preserving an existing public file.

## 4. Implement and verify the change

Make the requested change against the captured baseline. Validate the affected behavior with the project's existing checks and focused visual or interaction checks. For a footer change, verify destinations, responsive layout, keyboard focus, and accessible labels. Broaden checks only when shared rendering, loading, assets, or controls are affected.

Record checks actually performed, results, and remaining limitations. Do not describe an untested browser or device as tested. A successful build does not prove visual correctness.

## 5. Create an immutable delta archive

Use a readable name such as:

```text
heart-explorer_v0080_20261109T173000Z_a81f2c_footer-links.zip
```

Treat the timestamp and suffix above as examples. Use the actual sequence, time, ID, and concise change name. Never replace a previously delivered archive with different bytes; publish a new update and declare any superseded IDs.

Each archive contains the following entries; only manifest-mapped source files are applied to the repository:

| Entry | Purpose |
| --- | --- |
| `manifest.json` | Identity, dependencies, revisions, file operations, hashes, and delivery scope |
| `changes.patch` | Reviewable unified source diff |
| `DIFF.md` | Human-readable changes, rationale, affected areas, and rollback notes |
| `CODEX_PROMPT.md` | Instructions for integrating this update with the queue |
| `VALIDATION.md` | Actual checks and limitations |
| `base/<path>` | Exact previous bytes for changed/deleted files |
| `payload/<path>` | Exact new bytes for added/changed files |

The schema-version-1 manifest records `project`, `update_id`, `sequence`, UTC `created_at`, `parent_update_ids`, base/target website versions, source commits, public repository/base information, asset dependencies, `distribution_scope`, and `transport_private`. The helper fills actual `base_source_commit` and `target_source_commit`. The integration agent checks dependency and distribution metadata; the helper does not enforce those policies or scan file contents for secrets.

Each `files` entry records the repository-relative path, operation, before/after SHA-256, sizes, modes, and available base/payload member paths. Missing prior/new files use the helper's null representation. Represent renames as deletion plus addition unless the schema explicitly supports a rename operation. `archive_members` hashes every other ZIP member; the manifest does not attempt to hash itself.

Use the included helper:

```bash
python3 scripts/update_bundle.py create \
  --repo /absolute/source/path \
  --base-ref VERIFIED_BASE_COMMIT \
  --target-ref VERIFIED_TARGET_COMMIT \
  --metadata /absolute/update-metadata.json \
  --output /absolute/output/update.zip \
  --paths path/to/changed-file path/to/another-file \
  --diff-log /absolute/DIFF.md \
  --prompt /absolute/CODEX_PROMPT.md \
  --validation /absolute/VALIDATION.md
```

Replace placeholders with verified values. Every explicit path must differ between committed refs; do not sweep unrelated files into the package. The helper refuses existing output files, defaults to 20 MiB per changed file, and has no cross-process lock. Use an isolated checkout. It creates an external `.zip.sha256` sidecar because a ZIP cannot contain its own final hash. Run `verify` and, where useful, a baseline dry run before delivery.

### Large assets

Do not re-upload unchanged volumes, meshes, slices, or textures for a UI edit. Record their canonical manifest or durable location, size, hash, and attribution. Include changed assets once or reference an immutable asset package. Expiring signed URLs are not durable asset identifiers. Keep existing hosting and redistribution decisions unless the user requests a change.

## 6. Deliver to Box and publish

Upload the ZIP, checksum, and small manifest sidecar to the verified project destination. A small readable diff/prompt sidecar also makes queue inspection easier. Keep old archives intact; record status through receipts rather than changing their contents.

Confirm each required upload succeeded and record returned file identifiers, filenames, sizes, and hashes in a private delivery receipt. A file-request upload endpoint is not proof that an agent can list the read folder. Verify read and upload access separately. The observed shared-folder link had an expiry of February 16, 2027; if it expires, obtain a refreshed link without expanding sharing permissions automatically.

Prefer preserving the archive before publishing the corresponding live update. Record the actual deployment result and revision separately. If an upload or deployment fails, provide the completed local deliverables and state precisely what remains incomplete. Never describe a local ZIP as uploaded or a saved source commit as deployed.

A mutable `latest.json` may assist navigation but is not authoritative; concurrent writers can race. Immutable manifests and integration receipts establish history.

## 7. Integrate with Codex when requested

Follow `docs/CODEX_SYNC_PROMPT.md`. Discover all project manifests and select unapplied update IDs with their dependency closure. Do not simply select every filename with a larger version. Reject missing dependencies, duplicate IDs with different bytes, and deployment-only packages. A private transport archive with `distribution_scope: "public-source-payload"` is valid; keep its top-level private documents outside GitHub.

### First-archive bootstrap

When the public repository lacks `scripts/update_bundle.py`, inspect the ZIP with an inert standard-library reader. Check its outer checksum, member listing, and bounded manifest/helper sizes before reading exact named members; reject duplicate/non-regular entries and do not use `extractall`. Read `CODEX_PROMPT.md`, `payload/docs/UPDATE_WORKFLOW.md`, and `payload/scripts/update_bundle.py` as text. Review the helper's code and compare its size/hash with the manifest. A checksum establishes integrity, not trust. Extract only that reviewed helper to a temporary directory, then use it to verify and apply the complete archive. Do not execute unreviewed archive code. The mapped payload installs the helper in the repository. Create/append public `AGENTS.md` from the public snippet as described above.

Use a separate integration branch/worktree. During bootstrap, substitute the reviewed temporary helper's absolute path in the commands below until it is installed. Verify each archive, then preflight with:

```bash
python3 scripts/update_bundle.py verify /absolute/update.zip \
  --expected-sha256 VERIFIED_ARCHIVE_SHA256
python3 scripts/update_bundle.py apply /absolute/update.zip \
  --repo /absolute/public-repo --dry-run
```

For compatible files, run `apply` without `--dry-run`. It accepts exact prior bytes or already-present final bytes and stops on conflicts. It does not resolve dependencies, merge semantics, commit, push, or write the ledger.

On a conflict, compare `base/`, `payload/`, and the current public file. Transplant the intended change or perform a reviewed three-way merge, preserving public sanitization and unrelated work. Never copy a full Sites file over a divergent public file merely because it is newer. A staging commit may not exist in GitHub; included base bytes make that limitation explicit. Apply each dependent patch to the exact logical state produced by its predecessors, not independently to the original repository baseline.

After integrated validation, update public `updates/applied.json` with IDs and hashes only, update the changelog/version, and create the finalized source package with its asset manifest. Keep private transport documents/configuration and delivery receipts out of commits. A recorded update remains applied when a later valid update changes its files: do not require every historical after-hash to match the current tree. Verify newly applied intermediate states at application time and validate the final combined state. Push using existing branch/PR policy; never force-push or bypass protections. The authorized sync request is sufficient permission for its specified work.

Write an external private integration receipt with the resulting GitHub commit, included update IDs, final version/package hash, checks, and deployment status. The commit cannot contain its own eventual SHA. Recheck the queue once and report any arrivals after the integration cutoff as pending.

## 8. Recovery and completion report

Re-running integration with no new update IDs should produce no duplicate release. Preserve archives and base bytes for recovery. Discard a failed isolated integration; after publishing, revert through normal repository history instead of rewriting it. Keep the previous deployment and its immutable asset references available where hosting supports rollback.

Every completion report states: what changed, queue/update identity, actual validation, live deployment status, Box delivery status, and whether GitHub was updated. Include the archive and official guide links. Do not promise that an unseen future chat automatically loaded these instructions; point new chats to this document through the project's instructions or handoff.
