# v11 — donor comparison and a simpler workspace

Source revision notes, 5 November 2026. These notes describe the prepared changes;
publication and hosted-object availability are separate deployment steps.

## Workspace

The source selector is labeled **Donor**. Reconstruction uses a full-width viewer,
with View and Color disclosures beneath Whole organ, Cutaway and Translucent.
The remaining appearance, cleanup, brightness, cutaway and performance controls
are grouped in a collapsed Settings panel below the sections.

X/Y/Z images are larger, have a visible browsing cue, section indices, previous /
next buttons and an Enlarge action. Scrolling, touch swipes, arrow keys and sliders
advance the selected section and its linked 3D cut. The page uses document
scrolling instead of the previous fixed application shell.

## Active hearts

The catalog retains **LADAF-2021-17 (63, male)** and replaces the UCL comparison
entries with **LADAF-2020-31 (69, female), S-20-29 (80, male) and S-20-28 (84, male)**.
All are preserved adult hearts with catalog medical histories; none is promoted
to a healthy matched control. The complete entries, source DOIs, source shapes,
sampling and display windows are in [Data provenance](DATA_PROVENANCE.md).

Each replacement donor has independently prepared complete-organ display volumes,
cleanup support, lossless orthogonal images, fine oblique bricks and prepared
Echo / comparison / Probe planes. Ultra uses 79.56 µm source sampling for
LADAF-2020-31 and S-20-29, and 79.4 µm for S-20-28. Donor-specific brightness
profiles preserve readable wall detail. All clinical labels and chamber colors
remain unassigned for these new donors; their starting views have geometric names.

The reviewed S-20-29 and S-20-28 sections show more open cavities. LADAF-2020-31
retains narrower ventricular spaces in the reviewed sections. These are image
observations, not measurements of chamber volume or explanations of disease.

## Echo correspondence

The [v11 audit](echo-v11/README.md) checks all 12 movie labels and all 13 original
donor CT planes. It records **6 partial CT correspondences and 7 unverified
correspondences**. It does not establish clinical registration. Each view now
exposes its specific status and missing checks.

ME4C has a supported horizontal presentation correction. Papillary PSAX,
transgastric short axis and subcostal displays have supported 180° corrections.
Exact byte permutations and matching sampling bases preserve the measured
positions across the CT pane and 3D cap. Source images and physical clipping
normals are unchanged. New donors do not inherit these corrections.

Changing-plane and broader-view recordings are labeled explicitly; the unavailable
ME aortic-valve short-axis reference is not replaced by an unrelated movie.

## Probe Lab

Control the probe and Orbit the heart are prominent, mutually exclusive actions.
Four dedicated starting-view buttons replace the dropdown. Default horizontal
cursor movement rolls the probe; vertical movement tilts; Alt+horizontal movement
fans. Clicking the scene captures control, and the Escape release cue is prominent.

Rounded original phased-array and TEE instrument illustrations replace the simpler
probe geometry. The local skin/esophageal contact surfaces remain educational
constraints. A separate BodyParts3D Chest orientation view provides reference skin,
thoracic bones and a reference heart. It is explicitly unregistered to the selected
HiP-CT donor and does not feed the CT-derived ultrasound simulation. Required
BodyParts3D attribution and asset modifications ship with the reference meshes.
See [Probe Lab v11](probe-lab-v11/README.md).

## Evidence and limits

The donor source/data/geometry audit, actual module DOM contracts, Echo pixel and
coordinate checks, and Probe geometry/native EGL checks are recorded in the
corresponding v11 evidence directories. None establishes clinical segmentation
accuracy, clinical probe registration or device performance. No Site browser QA
was performed for this revision.

Historical source records remain available, including retired UCL acquisitions.
They are not active alternative data for the replacement donors. The historical
v2–v4 appendix in Data provenance is explicitly separated from current behavior.
