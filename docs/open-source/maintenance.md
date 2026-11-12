# Maintenance and release procedure

Keep public source, scientific asset identities, and the live website traceable without treating them as the same operation.

## Before changing a release

1. Inspect the actual branch, commit, uncommitted work, and live version. Record any difference; a commit SHA does not identify uncommitted edits.
2. Use an isolated checkout for export or publication. Preserve history, remotes, deployment identity, and other contributors’ work.
3. Identify owning modules, applicable method notes, and current asset manifests. Preserve immutable data unless producing a new versioned derivative.

## Prepare the change

Implement the requested behavior with a focused diff. Add citations and rights metadata for new material. For data changes, retain acquisition/source identity, processing configuration, expected paths, byte sizes, checksums, and fallback behavior. Record whether a step is measured, manually reviewed, estimated, or illustrative.

Update README and focused documentation when behavior/setup changes. Keep historical evidence labeled with its original snapshot; do not overwrite old verification records and imply they apply to new shaders, geometry, or sources.

## Validate and publish source

Run pertinent tests from [development](development.md), then follow setup from a clean extracted copy. Inspect archive paths before extraction. Verify required assets against their manifests, and exercise representative routes. Record missing inputs and checks not run.

Review public content for credentials, private configuration, personal communications, restricted data/media, and transfer-only receipts. Do not commit archives, installed dependencies, raw caches, or deployment output as ordinary source. Preserve third-party copyright and license notices.

Before creating a repository/release, verify the intended owner/name and existing history. Finalize real repository links in README/CITATION metadata after that destination is known. Preserve branch protections and use a pull request where appropriate. Do not force-push or replace a managed hosting remote. Tag/release only a reviewed revision; do not invent earlier releases.

After publication, independently retrieve the published commit and inspect its tree. Repeat packaging-sensitive setup/build checks and review CI. Report committed, pushed, deployed, and verified as separate states.

## Publish the website separately

For the existing site, preserve project identity and audience and use its supported source/build/staging/deployment workflow. Verify separately hosted asset availability before exposing a feature. A source commit or upload receipt is not proof of deployment.

For a fork, follow [deployment](deployment.md), choose a rights-cleared asset set, configure independently owned storage, and verify its browser path. Keep the original demo intact. Public-source release does not implicitly request a GitHub Pages or alternative hosting migration.

## Bringing changes back

Move fixes between site source and public repository as reviewed commits or patches. Reconcile concurrent work explicitly and retain authorship. Rebuild after resolving conflicts that affect shipped inputs. Update the release record with the exact resulting commit and assets so maintainers can distinguish the active website version from the latest public source.

## Chat update queue and batched GitHub integration

Follow the [official update workflow](../UPDATE_WORKFLOW.md) for each new website change. It defines immutable patch archives, dependency and file-hash checks, separate website/Box/GitHub status, and the user-controlled integration cadence. Use the [Codex sync prompt](../CODEX_SYNC_PROMPT.md) when the user requests a repository update. Install the [agent instruction section](../AGENTS_UPDATE_INSTRUCTIONS.md) in the public repository without copying private hosted-project notes.
