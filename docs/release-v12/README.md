# Heart Explorer v12

## Delivered interface

The three active donors are LADAF-2021-17, S-20-29 and S-20-28. LADAF-2020-31 is
retired from the selector, public source files, active serving indexes and the
portable export. Its previous source provenance remains in historical records.

Reconstruction now places a tall 3D view beside a right-hand X/Y/Z section rail.
The prominent Fullscreen button targets their shared wrapper. Mobile layouts
stack the workspace; mobile fullscreen places the three sections beneath the
heart. CT browsing, crosshairs, sliders, step buttons and enlargement retain the
same measured coordinates. Optional settings remain collapsed below.

The former Chambers & valves module is consolidated into compact starting-view
buttons beneath the main title. Four RV/LV inflow/outflow entries are visible;
four RA/LA entries are under More views. Explore, Closer, Face slice and Flip use
the existing prepared planes and Ultra textures. Comparison donors have their
own neutral geometric names. Old Flow bookmarks migrate into reconstruction.

`QuickViews` is network-silent at construction and fetches metadata/textures on
selection. Superseded selections, section activation and module departure
invalidate pending results. Volume refinement and returning from a module
preserve the user's camera. The existing low-priority background download
scheduler is retained.

Probe Lab has a larger, dedicated chest-reference panel to the left of equal
heart/ultrasound comparison panes. The instrument is 40% of its prior linear
size around the same acoustic tip. One Escape disarms capture, including pending
requests and late grants, and returns the workspace to Orbit mode. The chest
remains an illustrative BodyParts3D reference, unregistered to the donor.

## Scan appearance

Slice brightness defaults to 1.15 for LADAF-2021-17 and 1.80 for the two comparison
donors. The display-only, monotone mapping preserves black and white endpoints;
anatomy cap highlights use a hue-preserving shoulder. Source values, thresholds,
geometry, lit-surface shading and the simulated ultrasound signal are unchanged.
The control is in Settings; Reset donor window restores the donor defaults.

The original donor's v12 segmentation adds bounded source-supported exterior
propagation and an RV-facing annotation layer. The compact septal core remains
LV-associated under the documented shared-wall convention. Forty-three prior
source control points remain unchanged. These are approximate annotations,
without expert ground truth or a global segmentation-accuracy claim.

Detailed source and method evidence:

- `../anatomy-v12/README.md`, native before/after views and source review records.
- `../brightness-v12/README.md`, measured fine-pixel statistics and exact-shader checks.
- `../probe-lab-v12/README.md`, capture lifecycle and geometry checks.
- `module-validation.json`, independent donor geometry and compact preset checks.

## Verification performed

Ninety-four Node tests passed across the selected suites:

| Suite | Tests |
|---|---:|
| Actual app boot, module transitions, CT rail, fullscreen and donor controls | 14 |
| Actual QuickViews controller, cancellation and bookmark restoration | 8 |
| Probe capture lifecycle and illustration geometry | 11 |
| Active comparison donors, fine plane identity and neutral names | 7 |
| Brightness, windows, browser receivers, download priority, Echo correspondence and display-store contracts | 54 |

The anatomy asset test verifies published compressed/decoded hashes, all 43
source controls, RV preservation and atrial/arterial identity preservation.
Native production shader tests checked 27,648 brightness cases with zero channel
difference from the shared JavaScript transfer on the current native driver.
Production probe shaders and reference framing were rendered independently.

These checks use controlled DOM fixtures, source data and native scientific
rendering. They do not claim an interactive browser test, device frame-rate
measurement or clinical validation. Website browser QA was not performed.

## Publication and local handoff

The hosting build retains the existing owner-private audience. Its build must
run `scripts/prepare-hosted-display-v10.py --stage` after the framework build.
The final comparison display index contains 106 immutable objects, totaling
147,264,680 encoded bytes. All upload gates remain closed.

After publication, `scripts/verify-production-v12.py` checks exact deployed
source, the three donors, six complete fine-bank inventories, representative
asset hashes, the comparison display inventory and read-only gates. Runtime
evidence is written outside authored source to avoid changing the published
commit during verification.

The complete portable archive includes all six active scan banks plus source,
prepared images, local clinical reference movies, provenance, checksums and the
Python launcher. See `../../LOCAL-DEVELOPMENT.md` for local Codex setup.
