# Reversible cleanup of the 19.85 µm native surface

## Release decision

The selected method hides small, compact, fully interior foreground components while preserving the exact original triangles and visible normals of every retained surface. It runs when a native region is opened. **Cleaned surface** is the default; **Original reconstruction** and **Removed fragments only** make the decision reversible and inspectable with the same camera.

This is a display selection over the completed v21 native bank, not a new whole-organ reconstruction or an anatomical segmentation. The source bank, threshold, guide blend, TV parameters and scientific fingerprint remain unchanged:

`44a31c3adeb20e5a9a3d31f6868f9c92479920f533d2ea3c486e22b4aefa584a`

The baseline is site version 32, source commit `7c4bb1b9eb1ac6ff71bd491990edf5e4ca907a75`. The website publication version is separate from this method directory's v22 identifier. The final checkpoint's publication receipt records the deployed version and commit.

## Selected method

The worker labels the complete 129³ foreground mask with 26-neighbor connectivity before producing its eight render pieces. It suppresses a component only if all conditions hold:

- At most 512 foreground sample records.
- Inclusive support-box diagonal at most 0.4 mm at 19.85 µm spacing.
- No contact with any of the six outer sample planes of the native tile.
- Principal shape anisotropy below 3, using `sqrt((lambdaMax + 1/12) / (lambdaMin + 1/12))` on sample-center covariance. The minimum eigenvalue protects elongated and flat components; equality is retained with a conservative numerical tolerance.

The original mask identifies foreground tissue. A disconnected mesh shell can be a legitimate cavity wall, so a largest-mesh-component rule would be unsafe. All positive corners of a marching-cubes cell belong to the same 26-connected foreground component. The renderer can omit complete original triangle sets without changing retained positions or referenced normals.

Every component touching a tile face is retained, even if small. A path to neighboring tissue must cross one of those faces. This leaves some border clutter but avoids cutting a structure because its continuation was not downloaded. Classification precedes the eight display pieces, so their internal boundaries do not affect the decision.

The browser classifier allocates a byte state array and one reusable uint32 flood queue: approximately 10.24 MiB for a 129³ tile, with no object per voxel. Original verified byte caching retains its existing 12 MiB/six-entry bounds. Selection is recomputed when needed; this release adds no unbounded component-plan cache.

## Evidence and alternatives

The [bounded method comparison](METHOD-COMPARISON.md) contains the experiment, parameter sweep, same-camera figures and source identities. The [research review](METHODS.md) considers six broader families, including intensity hysteresis, connected attributes, seeded tissue/cavity segmentation, multiscale shape evidence and topology constraints.

In 13 selected, hash-verified production tiles, the rule suppressed **662 of 714 completely interior components**, kept **all 221 boundary components**, and removed **15,570 of 11,942,037 foreground sample records (0.130%)**. It hid **68,604 of 4,242,633 triangles (1.617%)**. These are sampled processing changes; tile samples overlap and are not a unique organ volume.

Block `[32,31,22]` changes from 715,478 to 687,402 triangles (221 fragments hidden). Block `[35,30,36]` changes from 367,839 to 357,643 (96 hidden). Original/cleaned/removed geometry is in [native-component-comparison.png](native-component-comparison.png).

On a separate saved 108³ scalar core, component filtering reduced 74 components to 17 without adding foreground samples. One-voxel morphological opening, intensity hysteresis, stronger TV and Gaussian filtering were also rendered and measured. They changed connected interfaces; the tested weak/strong hysteresis added 11,562 foreground samples, and Gaussian sigma 1.5 added 25,877. Lower triangle counts or smoother appearance alone do not establish better tissue recovery. This scalar core predates production guide blending.

The intensity values are stored dataset units. No verified air/water or rescale calibration establishing Hounsfield units was found in the supplied source provenance, so clinical HU tissue thresholds are not applied. Same-threshold intensity anchoring is a useful future confidence signal, but requires bounded original scalar data: NBE1 stores signs and edge crossings, not intensity amplitudes.

## Separate experimental overview repair

The left pane is an already simplified, coarser whole-heart display; the native right pane has the 19.85 µm source grid. These are distinct representations.

The overview contains exact repeated triangle index triples, often with opposite winding. A source-hash-pinned sidecar cancels opposite pairs and then retains only the earliest remaining same-orientation face. Unique faces, positions, stored normals and retained face order stay unchanged. It removes 508,614 of 1,499,999 overview faces, or 442,866 of 2,500,000 detail faces.

**Reduce overlapping overview faces · experimental** remains **off by default**. Coincident opposing faces may represent thin features collapsed during earlier simplification. Cancellation can expose gaps: overview boundary edges increase from 9,333 to 50,941. This is not a closed-solid repair or proof of anatomy. Original overview access remains available at both quality levels. The repair does not drive native component selection.

Evidence: [overview-audit.json](overview-audit.json), [overview-decoder-verification.json](overview-decoder-verification.json), and the pinned mask manifest under `public/assets/noise-cleanup-v22/`.

## Verification and limits

- Independent Python and actual browser-decoder JavaScript agree on all 13 production tiles. Tests verify the exact ordered partition of original faces into cleaned and removed selections, original position bytes, every normal referenced by a visible face, all protected outer planes and unchanged source bytes. See [browser-decoder-verification.json](browser-decoder-verification.json).
- Synthetic tests cover enclosed cavities, diagonal connectivity, rods, sheets, translation, size/extent boundaries, threshold equality and eight-piece seams. See [code-review.json](code-review.json).
- Both real HFM levels pass source/decoded SHA checks, exact retained-face identities, position/normal preservation and corrupt-mask rejection. See [overview-decoder-verification.json](overview-decoder-verification.json).
- UI and real-worker tests cover mode changes, transactional labels, stale work, failures, source-versus-filtered counts and verified caching. See [ui-worker-verification.json](ui-worker-verification.json) in the final checkpoint.

The scientific figures are EGL renderings of measured geometry, not generated imagery or browser screenshots. The managed preview returned `ERR_CONNECTION_REFUSED` in the connected browser; the available production browser previously lacked WebGL 2. DOM/worker tests and scientific rendering are separate from an interactive browser GPU check. Do not represent an unavailable check as passed.

Attached artifact and tile-boundary components remain. Curved, branching or detached real tissue can satisfy the compactness rule; the shape guard is not an anatomical label. The selected examples are not anatomy-balanced and have no expert tissue/noise ground truth.

The strongest extension is a streamed global foreground-component graph with original intensity evidence for uncertain fragments. It can resolve islands straddling tile faces while retaining uncertainty where coverage ends. Use separate configuration, immutable sidecars, bounded memory and checkpointed frontier state. Seeded tissue/cavity separation is more appropriate for connected clutter, with review around valves, trabeculae and chordae.

## Recovery and checkpoints

The first implementation checkpoint is verified in Box; see [box-checkpoints.json](box-checkpoints.json). Save another checkpoint before handoff and after publication. Include changed source, masks, comparison scripts/results, exact publication identity, per-file SHA-256 manifest and recovery instructions. Keep the last confirmed archive until the next is visible. Build ZIPs outside synchronized scratch, read every entry back, then move the completed ZIP for upload.

These incremental checkpoints depend on the baseline Git commit and existing immutable hosted data. They do not contain the entire raw scan or the approximately 5.81 GB compressed native bank. Include the two unchanged source HFM files in the final cleanup checkpoint when space allows, so optional overview masks can be applied independently. Interactive Box checkpoints occur during active work; no unattended uploader is claimed after the session.

The native reconstruction's recovery policy remains in `AGENTS.md`. For this smaller task, checkpoint major verified stages and approximately every 15–30 minutes of substantial active work, then verify the destination receipt before relying on it.
