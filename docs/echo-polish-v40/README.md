# Echo presentation, touch navigation and section reuse

This update follows published site version 71 (source
`bd2b8b4261c288c7b9fef0d1970848b90c58e128`). It addresses the five requested
refinements without changing source intensities, the high-fidelity base mesh,
reviewed source masks, recording content, or the accepted acquisition planes.

## Surface regression

The completed local surface controller used `workspaceActive` for both unfinished
preparation and the visibility of already prepared geometry. Entering Echo set
that flag to false. The full base surface remained active while its four finished
reviewed replacements, original-geometry exclusions and cap/picking masks stopped
being used. This brought the original rougher geometry back in those regions.

Completed, compatible refinements now remain active across that workspace change.
The staging/download gate still pauses unfinished work outside Reconstruction.
No additional surface download or new geometry allocation is needed for the fix.
The regression uses the actual pinned reviewed masks and the real surface draw
submission path; its before/after receipts are alongside this document.

This identifies one concrete source of the reported artifacts. It does not imply
that every fine texture or pore in the source scan is a rendering error.

## Surrounding anatomy and labels

The former context renderer deliberately blended translucent foreground anatomy
over the heart. Context now uses the existing accepted heart/cap depth to leave
every tissue pixel untouched. The software path applies the same per-pixel rule.
True open rays retain visible reference context. Probe geometry keeps ordinary
perspective depth. The implementation adds no framebuffer or mask texture.

The LADAF GI path physically intersected the independent reference spine. A fixed
localized cutaway removes only intersecting reference-spine surface fragments
and a narrow margin. It moves no source heart, GI path, skin contact or probe;
adds no artificial cut caps; and retains the original source assets. The two
S-donor spines do not need this cutaway. Acquisition comparisons are recorded in
`acquisition-invariance.json`.

Labels now scale from 12 to 15 CSS pixels, with a 14-pixel minimum for coarse
touch pointers. Higher-contrast glyphs, collision-aware placement and small-pane
priority filtering improve readability without filling the heart with callouts.

## Touch navigation

One contact orbits. Two contacts pan by their midpoint, while changing their
separation pinches about that same anchor. Translation is calculated from the
camera basis and CSS pane size. The first movement works; adding/removing a finger
does not reuse an obsolete gesture baseline. Capture loss, cancellation, blur,
hidden pages and pointer-lock transitions release contacts. The software renderer
also now inherits the minimum-distance helper used by pinch, wheel and keyboard
zoom. Help text describes the controls.

## Exact section cache

The proposed optimization is implemented as a device-local cache of completed
standard-view fine sections. The first qualifying visit still computes the
section from verified source voxels. Later visits, including a new page session,
can load the exact scalar raster without brick transport or voxel decoding.
This is not a server-generated atlas or a new immutable hosting bank.

The cache identity includes the source manifest and block layout, raw block
hashes, source mask, spacing, interpolation version, exact plane axes and center,
crop, raster dimensions and pixel spacing. Pixel checksums and bounded encoded
and decoded lengths are verified on reuse. Storage denial, quota failure or a
corrupt entry falls back to the ordinary verified source path. Brightness,
contrast, color and reversible display cleanup remain separate from saved data.

Encoded storage is bounded to 32 MiB on constrained devices and 96 MiB on desktop.
An entry and queued immutable save copy are limited to 4 MiB / 12 MiB respectively;
those figures are not the whole pipeline's peak memory, because compression,
hashing and stream assembly can add transient bounded copies. Oversized sections
still display normally but are not saved. A shared Web Lock serializes writers
where supported; a post-write trim bounds fallback concurrent writes.

Unmodified atlas views opt in. Arbitrary moving probe planes do not populate disk
storage. A fine result already resident from a nonpersisting caller may return
from the Window RAM cache without initiating a new save; that affects cache
coverage only, not displayed pixels. Old prepared source rasters keep their own
existing provenance/geometry gates.

## Scanner-style reference dials

The two clips without embedded angle readouts use an unboxed violet semicircle,
white needle and white numbers in the upper-left of the actual ultrasound crop.
The dial follows source padding, player letterboxing, Full Frame / Fit Ultrasound
and pane resize. It keeps the guideline ranges (0–10° and 50–70°), a small REF
qualifier and the visible explanation below the player. No acquired angle is
invented. Source attribution and muted inline autoplay behavior are retained.

## Verification

The focused source cache / device policy / worker lifecycle / source-plane reuse
group passed **34/34** tests. The gesture / camera / angle placement / context
presentation group passed **47/47**. The real Echo controller source-player
regression also passed, including stale callbacks, playback watchdogs, reference
qualification and source links.

The completed-refinement transition regression passed **5/5**, and the surface
controller lifecycle group passed **41/41** with its LinkeDOM fixture. The actual
touch-selection controller passed **8/8**. The production acquisition audit
passed **9/9** assertions covering all **112** current/previous LADAF handoffs;
its source-stability guard passed after the production edits were complete.
The independent baseline comparison found zero changed physical planes.

Native production-shader checks passed six surface/cap/composite cases: foreground
and rear context, plus contours, left accepted tissue RGBA bytes unchanged, while
true open cavities and normal instrument depth remained visible. These use
synthetic fixtures and software EGL, not a physical mobile GPU. The real reference
geometry check reproduced 551 original LADAF spine/esophagus triangle crossings
and found zero after the cutaway, with at least 2.5 mm conservative clearance.
All other reference meshes, skin contacts and GI topology remain identical;
both S-donor spines also remain identical.

The touch tests exercise both WebGL and software camera classes, mixed pan/pinch,
different pane sizes and camera rolls, gesture interruption, desktop controls
and tissue-selection suppression. They are not a physical iPhone/iPad test.

Local browser checks showed muted direct-video playback and correct dial
placement in Full Frame and Fit Ultrasound. That preview's HTTP origin cannot
exercise secure fine-data storage; its browser uses the software renderer. Native
production-shader and real reference-geometry checks provide the corresponding
rendering evidence. Additional receipts in this folder record the completed
context and refinement checks.
