# v17: camera detail and independent regional anatomy

This release responds to the recurring orbit/zoom blur, missing left-atrial
exterior color, and the two comparison donors' previously unavailable regional
overlays. It also records a source review of candidate in-vivo CT/MRI and paired
ultrasound data; those clinical candidates are not imported in this release.

## Rendering

Camera gestures retain the selected full scene ray grid throughout movement and
release. The earlier scene target was enlarged during movement, blurring the
surfaces around an already sharp cut face. Camera work is now separate from
section work. X/Y/Z scrolling and startup retain the bounded v16 path, immediate
current-plane resident rendering and exact-current Ultra refinement. One GPU
frame remains in flight; pending input is coalesced to the latest state.

Late fine textures, progressive volume upgrades and release callbacks do not
restore the small camera target. Camera GPU timings cannot distort the separate
slice-work budget. Camera tracking during a locked Echo section edit remains
section work, while explicit Face plane commands stay sharp. Automatic rotation
yields to active section edits before resuming native camera rendering.

Nine native offscreen shader comparisons—three camera operations for each
donor—are byte-identical to settled full-quality images at the same pose. This
verifies image quality, not real-device frame rate. Native camera rendering does
more GPU work than the old adaptive preview; slower devices can use the existing
Render quality setting for a lower, stable grid. No scan download or decoded
volume copy was added. See `../renderer-camera-v17/README.md`.

## Anatomy

LADAF-2021-17 gains 3,096 previously neutral cells of source-connected thin
left-atrial exterior tissue. All original nonzero v12 label identities are
unchanged. The candidate was selected after comparing nearest extension,
closing and source-connected propagation against measured sections and native
surface projections. See `../anatomy-v17-la/README.md`.

S-20-29 and S-20-28 each receive an independently registered label volume with
LV, RV, LA, RA, aortic-root and pulmonary-root regions. Source cavity distance,
tissue geodesics and a source-constrained hybrid were compared. Ventricular and
arterial identities were checked in orthogonal and oblique source sections,
including direct continuity between each outflow tract and its ventricle.
Uncertain transitions remain neutral; labels are approximate regional tissue
ownership, not expert-validated measurements or individual valve masks.

| Label file | Compressed bytes |
| --- | ---: |
| LADAF-2021-17 LA revision | 330,535 |
| S-20-29 new regions | 328,222 |
| S-20-28 new regions | 402,888 |

The maps load only when the anatomy palette is requested. The controller checks
dataset and donor identity before installing them. Existing scan caches, source
values, geometry, default tissue/space style and brightness profiles remain
unchanged. S-donor clinical-window correspondence remains unassigned even though
regional colors are now available. See `../anatomy-donors-v17/README.md`.

## Verification scope

The focused checks cover camera resolution and release, GPU-fence coalescing,
scene refinement cancellation, lazy startup/module loading, section input and
current-plane acceptance, unchanged brightness controls, all three actual Color
control paths, wrong-donor rejection, annotation identity preservation, source
registration, label hashes and immutable legacy assets. Source figures were
reviewed alongside the candidate overlays. No browser automation or live
user-device performance measurement was performed.

The hosted build must use the existing verified display-asset staging step.
The new versioned label assets are small static files and remain in the staged
build. The v10 immutable comparison-display index and its existing label objects
are unchanged; all upload gates remain closed for publication.

## Clinical data research

`../clinical-datasets-v17.md` documents the primary sources, access status,
acquired versus reconstructed spacing, and pairing limits. cMAC is the strongest
same-person MRI/3D-ultrasound lead found; HVSMR-2.0 offers existing whole-heart
regions; the SlicerHeart sample offers a small 4D-CT starting point. None of the
verified in-vivo sources matches the original HiP-CT microscopic sampling.
