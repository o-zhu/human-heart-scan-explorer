# Contributing to Heart Explorer

Small, well-explained changes are easiest to review. For a substantial change in reconstruction, anatomy, dataset support, or interaction behavior, discuss the intended result before doing expensive preprocessing.

## Start from a reproducible checkout

Read the [README](README.md), [development guide](docs/open-source/development.md), and applicable source-specific method notes. Restore only assets you have permission to use. The source repository is not a promise that every dataset or optional study is bundled or freely redistributable.

Use Python’s local server for viewer changes. The framework layer has a separate Node/pnpm workflow. Keep dependencies, private configuration, research caches, raw acquisition archives, and generated deployment output out of a pull request.

## Make a focused change

- Explain the user-visible problem and intended behavior.
- Preserve source identities, voxel values, physical coordinates, and retained-side semantics unless explicitly producing a new scientific derivative.
- Keep probe pose, sector, sampled section, and accepted image synchronized. Camera adjustments must not change acquisition geometry.
- Keep memory and concurrency bounded. Compressed download size is not a decoded-memory budget.
- Preserve keyboard/touch access, cancellation, stale-result guards, and a usable fallback when an optional fine asset fails.
- Avoid broad dependency upgrades and unrelated formatting changes in a bug fix.

New scientific derivatives require their source/version identifiers, processing command and configuration, units, checksums, license/attribution, and limitations. Use new immutable filenames or versions. Do not overwrite source material or a released derivative under the same identity.

## Validate the behavior you changed

Run relevant existing tests from [development](docs/open-source/development.md), plus a focused regression when it addresses a real failure. Unit/controller tests, asset integrity checks, native shader renders, and actual browser/device checks answer different questions; report them separately.

For a visual change, review representative desktop and narrow layouts and report the actual browser engine tested. For a probe change, inspect correspondence when the plane intersects and misses the heart. For a data change, verify source, geometry, and hash identities. Do not claim clinical accuracy from mathematical alignment or a plausible image.

## Submit a reviewable pull request

Describe:

1. The problem and why it matters.
2. The behavior changed, with a small permitted screenshot when useful.
3. Commands/checks run and their results.
4. Missing assets, untested browsers/devices, or remaining limitations.
5. Any added dependency, dataset, license obligation, or processing cost.

Contributions to original project code/documentation are expected to be offered under the project’s MIT license. Identify third-party material explicitly and retain its license. Public availability or an attribution is not permission to redistribute it. Never submit credentials, private communications, patient identifiers, or data you are not authorized to share.

## Maintenance

The live demonstration and public source may have separate release schedules. Follow the [maintenance procedure](docs/open-source/maintenance.md) to record exact snapshots, preserve unrelated work, and validate publication. A pull request must not silently replace the hosted site identity or enable historical upload routes.
