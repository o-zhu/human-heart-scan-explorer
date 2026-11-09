# v28 release evidence index

Published as **Site version 47** on 2026-11-07 at https://human-heart-scan-explorer.zhuou557737.chatgpt.site/. The deployed source is `537c7e1046f34a1166d8ba440a27933cf17e6f16`; later documentation receipts may be committed separately without changing that published runtime. See [publication.json](publication.json), [live asset verification](live-asset-verification.json), and [live UI verification](live-browser-validation.json). All 24 checked live scripts/assets and three historical aliases match the tested bytes.

The release combines source-guided reconstruction cleanup, a lighter Atlas cinematic palette, and source-appropriate section names. The canonical cleanup methods and current final-review status are in [cleanup-v28/README.md](../cleanup-v28/README.md); this index does not replace its evidence or the completed release gates.

| Change | Method and evidence |
| --- | --- |
| Three local source surfaces and three atrial object selections | [Cleanup methods](../cleanup-v28/README.md), [surface build](../cleanup-v28/surface-build.json), [lumen build](../cleanup-v28/lumen-build.json), and [combined camera receipt](../cleanup-v28/final-review/validation.json) |
| Exact prior masks, repaired walls, and unchanged source/original geometry | [Independent mask-region validation](mask-region-validation.json) |
| Atomic, reversible local surface activation | [Runtime verification](../local-refinement-v28/README.md) and [receipt](../local-refinement-v28/validation.json) |
| Lighter rose/ivory Atlas style with neutral fill and softer recesses | [Palette methods and matched comparisons](../atlas-cinematic-v28/README.md), [shader receipt](../atlas-cinematic-v28/validation.json), and [UI receipt](../atlas-cinematic-v28/ui-validation.json) |
| Anatomical/acquisition labels without changing geometry | [Section-name mapping](../section-names-v28/README.md) and [tests](../section-names-v28/validation.json) |

For LADAF-2021-17, original source X/Y/Z are labeled **Coronal / Sagittal / Axial**, qualified as approximate specimen planes. Other sources use their own metadata or neutral acquisition labels. Numeric axes, orientation, cut side and saved coordinates are unchanged.

Atlas remains optional and illustrative; the revised color does not establish true tissue color. The cleanup uses 79.4 µm mapped source contrast, not calibrated HU, and adds no native 19.85 µm acquisition resolution. Connected source texture remains, and neither visual comparison nor source-core retention establishes clinical anatomical validity.

All 11 production cleanup views completed exact v27→v28→v27 restoration and cleanup-off equality checks. The exterior review completed using bounded exact triangle batches after its initial full-allocation attempt exceeded the shared native-GL memory budget. [LA pixel-parity verification](../cleanup-v28/stream-parity/validation.json) confirms byte-identical standard and streamed images for both versions; the camera, shaders, source attributes, face order, and persistent depth buffer were unchanged. The [final aggregate receipt](../cleanup-v28/final-review/validation.json) reports 11 completed views and no incomplete views. Final publication and live checks are recorded above. The cloud browser verified names, controls, cache wording and the Atlas selection using its correctly labeled software fallback; it has no WebGL2, so fine geometry was verified with the native production renderer. Screenshot export from that browser failed with a shared-storage ENOSPC error; the saved native before/after evidence remains available.
