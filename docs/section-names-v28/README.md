# Section names follow the active source

The section rail now uses anatomical or acquisition-plane names in headings,
image markers, linkage status, clipping choices, accessibility descriptions,
sliders, step buttons and enlargement controls. The main LADAF specimen uses
the requested **coronal, sagittal and axial** names, with a brief visible note
that these are approximate specimen planes without patient-position
registration.

This is a display-label change. Source-axis indices, voxel order, displayed
image orientation, crosshairs, retained cut side, source coordinates, slice
positions and saved-view identifiers remain unchanged. Selecting Coronal on
LADAF still activates the original source-X plane. The code does not resample,
rotate or mirror images to make them fit the labels.

## Mapping and evidence

| Source | Source X | Source Y | Source Z | Basis |
|---|---|---|---|---|
| LADAF-2021-17 | Coronal | Sagittal | Axial | Approximate specimen anatomy |
| S-20-28 and S-20-29 | Longitudinal 1 | Longitudinal 2 | Transverse | Neutral specimen planes; orientation not reviewed |
| cMAC whole-heart MRI | Coronal | Axial | Sagittal | DICOM LPS direction matrix |
| cMAC cine SAX MRI | Longitudinal 1 | Longitudinal 2 | Short-axis | Acquired cardiac SAX stack |
| cMAC ultrasound, including paired echo | Probe plane 1 | Probe plane 2 | Probe plane 3 | Explicit ultrasound-local coordinates |
| SlicerHeart overview, native detail and native reference | Sagittal | Coronal | Axial | Per-series NRRD RAS directions |
| Other unregistered clinical series | Source plane 1 | Source plane 2 | Source plane 3 | Neutral fallback |

### LADAF specimen

The source-guided landmarks in
`docs/anatomy/independent-flow-landmarks-v5.json` place the pulmonary root at
source XYZ **[170,322,200]** and an aortic landmark at **[220,226,180]**. The
pulmonary root is toward smaller X and larger Y. The chamber landmarks in
`public/assets/echo-planes.json` provide a consistent comparison: RV
**[180,190,350]** versus LV **[250.127,270.193,350]**, and provisional RA
**[230,175,210]** versus LA **[315,285,215]**. Together these support source X as
approximately the anterior/posterior direction, source Y as approximately
left/right, and source Z as the superior/inferior direction.

Those landmarks are regional approximations; some atrial points are explicitly
provisional. They support useful nearest-plane names for this isolated,
preserved specimen, not a registered patient coordinate system or expert
validation. The other HOA donors do not inherit this donor's mapping.

### Clinical metadata

`public/assets/clinical-v19/cmac/manifest.json` records DICOM patient directions
for the MRI series. Its whole-heart direction matrix is
`[[0,0,-1],[1,0,0],[0,-1,0]]`. The preparation script
`scripts/prepare-cmac-v19.py` constructs this matrix with physical basis vectors
in **columns**. Thus source X has an anterior/posterior normal, source Y a
superior/inferior normal and source Z a left/right normal, producing the
coronal/axial/sagittal mapping.

The cine's directions are strongly oblique to body planes. Its source header
explicitly identifies a **cSAX** acquisition, so the acquired source-Z stack is
called Short-axis and the perpendicular views remain Longitudinal 1 and 2.
The ultrasound manifest explicitly says its identity matrix represents
ultrasound-local coordinates, **not DICOM LPS**. The main ultrasound series and
paired echo therefore retain probe-plane names.

`public/assets/clinical-v19/slicerheart/manifest.json` stores a
`geometry.space` of `right-anterior-superior` and `geometry.directionsRAS` for
each of its three series. These are NRRD lists of source-axis vectors; all
three are diagonal, with the appropriate physical spacing. They support the
sagittal/coronal/axial mapping independently of the cMAC mapping.

The shared naming module normalizes physical vectors and accepts unqualified
body-plane names only for finite, nondegenerate, mutually orthogonal grids
whose three axes lie within five degrees of distinct cardinal directions.
Unknown, malformed or oblique directions fall back to neutral source-plane
names unless an acquired cardiac SAX designation is available. Direction sign
does not change the name of a plane. No left/right image-side annotations are
inferred from these labels.

### Auxiliary native and motion pages

The native study and whole-native inspector map their selector values through
the original source axes. Their `x`, `y`, `z` choices therefore use Coronal,
Sagittal and Axial, respectively. The actual native-study manifest records the
source-to-world transform `(x,z,-y)`, which is also implemented by
`nativeToWorld` and both viewers' clipping normals.

The motion lab instead clips directly against **world** XYZ after deformation.
Its unchanged `x`, `y`, `z` option values must be labeled **Coronal, Axial,
Sagittal**. Its note explains that the cut planes retain their reference
orientation during modeled motion. The note and choices are inside the
specimen controls, which are hidden during the independent clinical CT mode.

All three pages associate their selectors with the approximate-specimen
qualification. Native sample-coordinate inputs retain their original scan
coordinate identifiers; they are numerical source indices, not plane labels.
The Ultra invalid-input message now requests a valid source section.

## Runtime behavior

`public/section-names.js` contains the source-specific resolution and a shared
DOM updater. HOA names are applied when configuring the donor. Clinical names
change only when the replacement series has acquired its first frame and
becomes current, so a slow or failed request cannot label the still-visible
old series with the new series' orientation. Paired ultrasound keeps its own
probe-plane naming independently of the MRI section rail.

Internal X/Y/Z IDs, selectors and numeric axis indices remain intact. Their
visible descriptions change together, including collapse/re-expand and
assistive-technology text. Existing bookmarked planes require no migration.

## Verification

`tests/section-names-v28.mjs` passes **ten focused tests** against actual local
metadata, page controls and source functions. Its receipt is `validation.json`.
The tests cover metadata conventions, neutral fallbacks, oblique and invalid
direction rejection, every visible/accessibility control, original cut
geometry and saved numeric-axis restoration. The auxiliary-page case evaluates
their real clipping methods and compares the selected label with the physical
normal obtained from `nativeToWorld`, catching the different world-axis order
in the motion lab. It also checks unchanged option values and cut positions.
The cache-status case verifies donor-neutral completion wording and the active
donor's orientation note in the general reconstruction details.

The existing import-stripping Node fixtures now inject the real section-name
module. Regression results:

| Test file | Passing tests |
|---|---:|
| `tests/clinical-ui-v19.mjs` | 12 |
| `tests/clinical-v19.mjs` | 11 |
| `tests/app-boot-v8.mjs` | 16 |
| `tests/tee-app-v26.mjs` | 4 |
| `tests/sections-v14.mjs` | 14 |
| `tests/native-ui-v20.mjs` | 1 |
| `tests/whole-native-ui-v21.mjs` | 11 |

The added clinical UI case verifies names through a delayed and failed source
replacement, successful MRI-to-SAX-to-ultrasound changes, and reopening paired
MRI/echo. It confirms that the ultrasound menu and canvas stay probe-local.
Existing byte, phase, geometry, acquisition and source-transition checks pass.

These are actual source-function and DOM checks in Node/LinkeDOM, not browser
interaction or clinical registration validation.
