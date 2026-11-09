# Heart Explorer v30: interior refinement and section feedback

## Release status

**Published and verified: Site version 57.** The new interior reconstruction
and section feedback are active at
[Heart Explorer](https://human-heart-scan-explorer.zhuou557737.chatgpt.site/).
Complete public asset readback and the closed upload gate passed; the
publication details and receipt are recorded below.

The [assembly receipt](../cleanup-v30/assembly.json) pins the selected source
policies, canonical outputs and preserved inputs. The
[canonical asset and lifecycle suite](../local-refinement-v30/validation.json)
passed **16/16 cases** against the actually active module and real four-region
v30 manifest, without a preactivation override. The final readback receipt
confirms that the public viewer serves the selected files and closed policy.

## Reconstruction changes

This pass reconstructs three bounded interior regions from the verified
79.4 µm source and retains the exact existing exterior refinement as the fourth
region. The regions are disjoint. Source-space readback of the rendered
surfaces helped locate material behind the reported cut plane that the earlier
crops did not cover.

The source is a windowed phase-contrast display volume, **not calibrated
Hounsfield units**. Original source bricks, original CT section pixels, native
scientific reconstructions and the original whole-heart geometry remain
unchanged. The new surfaces and masks are reversible display derivatives.

| Region | Selected treatment | Delivered triangles |
| --- | --- | ---: |
| LVOT, aortic root and mitral/chordal region | Expanded compound crop; 3D median regularization and local contrast with a narrow coherent-source support guard | 963,173 |
| Pulmonary root and upper RV | Expanded crop; grayscale opening, median regularization and local directional/coherence support | 846,757 |
| Tricuspid network and deeper RV | Extended depth and lower chordal coverage; regularization and reviewed coherence-guided contrast zones | 714,790 |
| Exterior perivascular region | Exact v29 surface and mask reused | 682,317 |

The [left-side report](../cleanup-v30-left/README.md) compares median and
total-variation candidates. An unprotected stronger threshold was rejected
because it visibly chipped coherent low-contrast contours. The selected
guarded candidate substantially reduces the dark matrix while retaining the
reviewed broad contours and thin strands. Its independent source audit found
zero newly excluded coherent-marker samples; inherited exclusions are counted
separately.

The [right-side report](../cleanup-v30-right/README.md) records the expanded
pulmonary and RV coverage and compares median, total variation, grayscale
opening and stronger local contrast methods. An excessively strong PA gate
and unprotected opening were rejected after they damaged retained thin
surfaces. The selected method substantially reduces the formerly missed RV
chain and irregular material in the pulmonary region while retaining supported
continuous structures.

**The selected PA/RV views are not artifact-free.** A branching reticular band
remains in the PA close view, and some fine material remains among RV chords.
After-render coordinate checks place the inspected PA residual inside the
reviewed crop; several retained strands have sustained neighboring source
contrast. Their appearance and intensity alone do not establish anatomical or
histological identity. The release does not classify every remaining strand as
an artifact, or claim that an empty-looking lumen would be more accurate.

Final review uses production GLSL, current corrected whole-heart normals,
source-registered cut faces and the full retained depth. There is no rear slab
that hides residual geometry. The [left evidence index](../cleanup-v30-left/selected-review-index.json)
includes the requested sagittal section 293, neighboring sections 291 and 295,
and opposite oblique directions. The right report links coronal section 190,
neighbors 188 and 192, close/oblique views, and sagittal section 293 with
neighboring sections. Critical views pass exact reversal and cleanup-off
comparisons. These rendering and source checks are not clinical validation.

## Two distinct causes of the proximal dark appearance

The [interior-refinement diagnostic](../interior-refinement-v30/README.md)
separates two effects that should not be conflated.

First, the original whole-heart mesh with current hard masks but **without
local replacement surfaces** reproduces a prominent thick proximal dark strip
much more closely than the fully active v29 baseline. The selected local
surface removes that conspicuous strip. The
[paired diagnostic](../cleanup-v30-left/activation-diagnostic/aortic-y293-comparison.jpg)
is explicitly labeled “Whole-heart only · Diagnostic.” **Its BEFORE image is
not the fully active v29 baseline.** It establishes a plausible incomplete
activation state, not which resources actually loaded in the user's browser.

Second, a smaller dark stipple cluster remains even with the local geometry
active because it comes from the original measured cut-face texture. Holding
the geometry fixed and temporarily hiding only that texture identified 284
dark pixels in a fixed review ROI. Nearest prepared-cap values matched the
verified source exactly; 246 corresponding samples were below the original
mesh extraction threshold. They were never removed foreground samples, so the
local low-band mask does not mark them. The
[cap comparison and receipt](../interior-refinement-v30/aortic-y293-cap-roi-comparison.png)
document this separately. Original cap data were retained, rather than broadly
suppressing genuine fine source texture.

## Section interaction and refinement readiness

The active section has a subtle coordinated highlight across its card,
section label and slider; inactive sections use neutral styling. The current
section is labeled **Active cutaway**, and the main instructions now state
**“Scroll over any section to move the 3D cutaway.”** Each section repeats the
cue, with swipe wording on touch devices. Enlarging another section also
activates that section. Approximate Coronal/Sagittal/Axial naming and the
specimen-orientation qualification remain intact.

Interior readiness is now reported separately from the high-resolution
whole-heart badge. The visible status distinguishes **Refining interior
surfaces…**, **Interior surfaces refined**, and **Interior refinement
incomplete**. A failure exposes Retry while retaining the current complete
reconstruction. The refined claim appears only when the complete local set and
its required masks are actually active; incompatible views do not retain that
claim. The diagnostic report records the delayed-dependency, failure/retry and
workspace cancellation/resume integration checks.

## Canonical preservation and budgets

The canonical assembler verifies the exact reviewed asset identities, source
policies, disjoint bounds, masks and memory limits. It independently rebuilds
the frozen atrial repair and checks the actual packed exclusions.

| Assembly property | Verified value |
| --- | ---: |
| Local replacement regions | 4 |
| Combined decoded surface and mask bytes | **79,356,884** |
| Surface decoded bytes | 56,753,124 |
| Packed mask decoded bytes | 22,603,760 |
| Combined decoded limit | 134,217,728 |
| Packed mask limit | 25,165,824 |
| New hosted bank objects | **10** |
| New hosted bank bytes | **28,024,416** |
| Total compressed local set, including reused exterior | 35,389,896 |
| Frozen repaired atrial-wall samples | **109,928** |
| Exclusions overlapping frozen repair | **0** |

All four previous chamber/lumen masks are reused exactly. The v29 exterior
surface and its matching mask are also reused exactly. Every previously
excluded local mask sample remains excluded in the three replacement regions.
The assembly receipt contains the frozen repair hash, unchanged input hashes
and individual preservation results. These counts describe display processing;
they are not measurements of pathological tissue or a claim of clinical
accuracy.

## Exact multipart delivery

The larger left and pulmonary surfaces use ordered opaque gzip parts, each at
most **4 MiB**. Their full parent gzip files remain available in the source
checkout but are not indexed or shipped as oversized hosted fallback objects.
The [new bank index](../../server/cleanup-index-v30.json) lists only the ten
bounded hosted objects.

Multipart assembly reproduces the reviewed gzip bytes exactly. The client
verifies every part, then the complete gzip and decoded payload, before atomic
activation. This transport change introduces **no further geometry or intensity
loss**. Failed, missing, reordered, truncated or cancelled work cannot expose
a partially replaced heart. The canonical preactivation suite covers these
cases and verifies that multipart transport uploads identical GPU bytes.

Hosting uses a separate v30 collection. Historical source and display banks
remain immutable. The intended sequence is verified seeding with v29 still
active, then final activation with the new upload gate closed, followed by
complete public readback and a retained-token PUT rejection check. The
[development instructions](../../LOCAL-DEVELOPMENT.md) describe the ordered
build/staging workflow.

## Publication verification

The seed release is Site version 56, from source commit
`ef303c3acaa53b88bcf02babf6cec46df80ffebe`. Its new collection passed complete
inventory verification and **10/10 byte-exact GET readbacks**; see
[seed receipt](cleanup-seed-readback.json). The runtime continued to select v29
during seeding. No previous collection was reopened or overwritten.

The final module now selects v30 and its actual canonical activation suite
passes **16/16** without a preactivation override. Storage boundary and closed
gate checks pass **4/4**; readiness/retry passes **3/3**; cap picking passes
**3/3**; the retained TEE depth checks pass **6/6**. The final source uses the
read-only release policy and its temporary upload key has been removed. A
deliberately stale seed build was rejected before any final staging deletions,
so the final Worker must be freshly rebuilt with the closed release policy.

The final publication is **Site version 57**, from source commit
`02df56ba26c158a3c1fd6673638066e5bed6e615`. Deployment
`appgdep_6aef546ffa0c8191a8114c2bf8ceb5a7` succeeded at
2026-11-07 16:40:26 UTC. The [final public readback](cleanup-final-readback.json)
verified **10/10 hosted object checksums**, all **11 selected static files**, and
HTTP **405** for an attempted write using the retained temporary token. The
runtime uses `cleanup-v30:read-only`; the temporary upload secret is absent.
The original source banks remain unchanged.

Live browser interaction verified highlight transfer after scrolling each of
Coronal, Sagittal and Axial; inactive labels and slider thumbs became neutral.
Enlarging Sagittal from Axial activated Sagittal, and closing the expanded view
preserved that selection. The persistent scrolling instruction was visible.
These interactions were checked in the seed deployment; final public readback
verified identical UI code and styles in version 57. Browser screenshot export
failed because the browser export filesystem was full; the reconstruction
comparison images linked above are independently saved native renders.

This post-publication record does not change the deployed application.
Browser section feedback is checked separately from native
scientific rendering: the available cloud browser uses the software volume
fallback because WebGL 2 is unavailable. It cannot validate the high-detail
GPU reconstruction visually. Neither local rendering nor these delivery
checks establish clinical completeness or frame rate on slower hardware.
