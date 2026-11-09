# v14 — stable Ultra interaction, donor probe entry and CT windowing

This release addresses the reported dark/low-resolution flash while scrolling
downloaded sections, the Probe Lab quality jump during movement, the S-donor
starting probe intersecting the heart, and the requested brighter cut faces.

## Orthogonal sections

The downloaded collection contains compressed, lossless source images. A local
file still has to be decoded and uploaded before it can be displayed. Previously,
selecting a section immediately cleared the fine face and moved the clipping
plane, exposing a differently sampled volume cap until the image was ready.
Input also paused speculative local decoding together with network downloads.

The viewer now publishes the exact new texture and its clipping plane together.
During preparation it retains the preceding sharp image at its original plane,
with a status that distinguishes the displayed and requested sections. It never
stretches an old slice onto the new geometry. If the fine request actually fails,
the hold is released and the selected available-detail or volume section is
shown, with Retry available.

Downloaded neighbors can decode during scrolling without making new network
requests. One local worker slot prepares the rolling neighborhood; the decoded
image cache remains bounded at 96 MiB, or 48 MiB on reported low-memory devices.
First-view priority, foreground request priority, automatic network yielding,
user pause and complete collection persistence remain in place. Same-size GPU
textures update their existing allocation, and moving an unchanged prepared
plane does not upload its pixels again.

Relevant implementation: `public/app.js`, `public/hosted-ultra.js`,
`public/ultra-prefetch.js`, `public/renderer.js`.

## Probe Lab

The former motion path explicitly switched to a smaller cap and ultrasound grid,
waited for an idle debounce before requesting fine data, and repeatedly canceled
fine work during sustained movement. A 96 MiB decoded-brick cache also could not
retain some of the measured planes; the assessed S-20-28 plane required about
227 MiB of decoded bricks.

Moving and settled measured caps now request the same native donor spacing.
The acoustic/output grid is stable and sized for the displayed pane. One active
fine computation completes while newer input coalesces to a single latest pose.
The cap, ultrasound and probe guide consume the same accepted snapshot. A stale
or lower-quality result cannot replace a newer accepted frame. Local processing
retains the preceding fine frame; missing cold detail can still use an explicitly
labeled preview. The Ultra badge validates actual cap spacing and source spacing.

Fine brick caches are lazy and bounded at 128/256/384 MiB according to reported
device memory, with 384 MiB used when the API is unavailable. Current-plane and
nearby-slab warming is interruptible and obeys network priority. Row intervals
avoid sampling pixels outside each brick, task-budget yielding avoids one timer
per brick, scan-conversion maps are reused, and image buffers/palette lookup
tables are reused. The scan data and interpolation remain measured-source based.

Native benchmarks and numerical validation are recorded in
`docs/probe-motion-v14/benchmark.json`. On the assessed S-20-28 native plane,
nearby local reformats changed from 1,108–1,133 ms to 127–139 ms; the repeated
resident plane changed from 1,167 ms to 104 ms. The 7,799,085 final cap pixels
match the previous sampler byte-for-byte. First local preparation still took
about 1.30 s. These are Node CPU measurements using local scan files on the
recorded test host, not browser FPS or user-device latency.
Cold data and arbitrary new planes can still take longer than already resident
planes. Downloading all orthogonal images does not download every independent
oblique-volume brick.

## S-donor entry and alignment

The original fixed entry offset was too short for the long-axis and opposite-side
starting views of both S donors. New metadata calibrates the entry from retained
tissue bounds and checks the whole compact probe mesh. The entry moves along the
existing beam, preserving the same measured CT plane. Imaging depth expands to
retain distal tissue coverage. Untouched old defaults migrate; custom positions
and depths remain user controlled.

| Donor | Starting view | Outward correction | Tip-to-tissue clearance | Default depth |
|---|---|---:|---:|---:|
| S-20-29 | Long axis | 18.5 mm | 7.4 mm | 163.6 mm |
| S-20-29 | Opposite side | 26.6 mm | 7.4 mm | 163.7 mm |
| S-20-28 | Long axis | 22.9 mm | 7.7 mm | 177.7 mm |
| S-20-28 | Opposite side | 31.2 mm | 7.7 mm | 177.9 mm |

Other safe starts and the original donor are unchanged. The v13 larger left
probe, raised indicator, compact middle probe and shared displayed-pose mapping
are preserved. This is entry calibration against the donor scan, not registration
of the separate illustrative torso or guaranteed collision avoidance for every
subsequent movement. See `docs/probe-entry-v14/` and `docs/probe-lab-v13/`.

## Brightness and shared Settings

| Donor | Previous cut-face gain | Current gain |
|---|---:|---:|
| LADAF-2021-17 | 1.15 | 1.35 |
| S-20-29 | 1.80 | 2.70 |
| S-20-28 | 1.80 | 2.70 |

The soft display transfer lifts tissue midtones without changing encoded source
values, geometry, thresholding or ultrasound gain. Native GLSL/JavaScript
agreement and 24 hash-verified texture comparisons are in
`docs/brightness-v14/`. No assessed tissue pixel became pure white.

The collapsed bottom Settings panel now follows all three workspaces. Its first
section exposes Slice brightness, Black point, White point, Midtone gamma and
Reset donor window. Editing a window slider enables the custom window. Only the
additional reconstruction controls hide in Echo and Probe. Adjustments survive
module switching. Older saved views retain their chosen settings; Reset donor
window adopts the new defaults without deleting scan downloads.

## Verification

The regression record is `verification.json`. Focused tests exercise the actual
application/module code with DOM and worker fixtures, source datasets, independent
interpolation calculations and native scientific rendering. The production
prepared S-donor plane assets were also fetched through the authenticated Site
origin and compared byte-for-byte with all eight local textures; hosting was not
the source of their earlier preview behavior.

No browser automation or browser frame-rate measurement is claimed. Native
scientific rendering and source-data checks are used for the anatomical and
brightness figures. The private Site audience is preserved.

To rerun the key interaction fixtures, supply an installed LinkeDOM entry point:

```sh
node --test tests/sections-v14.mjs tests/loading-priority-v8.mjs
node tests/app-boot-v8.mjs /path/to/linkedom/esm/index.js
node tests/probe-motion-v14.mjs --dom=/path/to/linkedom/esm/index.js
node --test tests/fine-volume-v14.mjs
node tests/probe-entry-v14.mjs
node tests/probe-alignment-v13.mjs
node tests/brightness-v14.mjs /path/to/linkedom/esm/index.js
node --test tests/brightness-v12.mjs tests/windowing-v10.mjs
```

Hosting still requires the standard build followed by
`python3 scripts/prepare-hosted-display-v10.py --stage` before packaging. All six
prepared scan banks and the local source copies of hosted assets remain intact.
