# TEE lab

The separate **TEE lab** adds a controllable catheter to the existing measured
heart and matched CT / ultrasound display. It shares the optimized fine-plane
pipeline with Probe lab, while keeping its own pose, bookmarks and controls.

## Interaction

| Control | Model behavior |
| --- | --- |
| Insertion | Advances or withdraws the tip along a continuous reference tract. The 35 cm marker identifies the model's ME reference; it is not a measurement from a donor's incisors. |
| Turn the shaft | Rotates the physical transducer around the local shaft axis. |
| Tip flexion | Bends a 20 mm reference segment anteriorly or posteriorly; both the tip position and its facing direction change. |
| Side flexion | Bends the distal segment toward either side, independently of shaft turning. |
| Multiplane | Rotates the electronic image basis through 0–180°. The catheter, central beam and sampling origin remain fixed. |
| Lock steering | Disables manual pose changes. Selecting a starting view or Reset establishes that starting pose and unlocks steering. Imaging depth, gain, camera orbit and pending fine refinement remain available. |

All pose controls are visible beside the images. Sliders, step buttons and angle
stops work without cursor capture. Focusing the heart or steering pad enables
W/S insertion, A/D turning, Q/E multiplane, arrow-key flexion and Shift precision.
Blur, Escape, locking and leaving the module clear held movement keys. Native
fullscreen Escape is left to the browser.

## Scientific reference and kinematics

The published ASE/SCA terminology distinguishes advancing/withdrawing, shaft
turning, two-axis tip flexion and electronic multiplane rotation. Its angle
ranges include approximately 80–100° for the ME two-chamber view and 120–140°
for ME long axis. Anatomy can require additional adjustment. These conventions
inform the controls; they do not register this specimen to a patient.

Source: Hahn et al., *Guidelines for Performing a Comprehensive Transesophageal
Echocardiographic Examination*, JASE 2013, sections “Instrument Manipulation”
and “Comprehensive Imaging Examination,”
[ASE/SCA full guideline](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf).

The default long-axis entry uses the existing `me4c` source frame and its
source-specific entry calibration. Rotating this image basis by 90° and 120°
reproduces the retained LADAF `me2c` and `melax` physical sections. A cubic path
joins that entry to the existing `tgpapillary` distal section, with source-frame
endpoint directions and a 256-segment arc-length table. The path is authored,
not segmented anatomy. A compatible in-plane sign is selected for comparison
donor distal frames to avoid an artificial 180° tract twist.

Reference distances scale with each donor's physical field extent. The model's
centimetre display therefore describes this illustrative tract, not a clinically
measured insertion depth. A constant-curvature distal segment models the two
flexion wheels. Its rotation is applied to the transducer's physical frame;
multiplane rotation is applied afterward to the image basis only. The visible
catheter uses the physical frame, with a separate amber ray marking image-left.

The four references are adjustable starting sections. Existing donor metadata
continues to control whether the interface shows clinical-style or geometric
labels. Chamber, valve, esophageal and gastric alignment remain unvalidated.
The specimen contains no beating-heart motion, and CT intensity is not acoustic
impedance. Ultrasound appearance retains the existing interface, speckle and
attenuation proxy model. There is no contact-force or collision solver.

## Shared data and rendering

`TeeLabModule` inherits Probe lab's worker, fine-source scheduler, image transfer
and accepted-frame logic. A request includes the complete TEE state and pose.
The worker returns that state unchanged with its CT raster, ultrasound raster
and measured cap. The catheter and sector follow the **accepted frame**, not
new slider values awaiting source data. Previous data cannot be relabeled as a
new plane. Preset changes and module exit cancel obsolete work.

The resident-volume preview remains available while uncached fine data load.
An Ultra label still requires the actual source spacing and cap spacing to meet
the existing criterion. The new lab does not change source arrays, thresholds,
source calibration, smoothing or cleanup banks. It gains the Probe lab fine
cache, verified-brick and sampling optimizations through the shared classes.

The independent `tee` bookmark state includes insertion, both flexions, shaft
turn, multiplane angle, probe lock, imaging parameters and display controls.
The main application owns viewport movement and Reconstruction restoration.
Shared brightness/window settings retain their existing behavior.

## Verification

`verification.json` records nine focused production-code checks. They verify:

- All four LADAF starting sections preserve their retained physical source
  planes within numerical tolerance.
- Electronic angle changes preserve the mechanical catheter exactly, including
  a 180° image-side reversal on the same physical plane.
- Insertion, turning and flexion have distinct effects; poses remain finite,
  orthonormal and continuous across the three donor tracts.
- The actual TEE and Probe DOM controls can coexist with unique IDs and isolated
  keyboard state. Locking blocks manual steering while allowing gain changes;
  starting views and Reset explicitly unlock and establish their reference pose.
- Production acoustic computation retains all TEE state and returns one
  consistent cap / CT / ultrasound / pose. Late cancelled frames are rejected.
- The production geometry overlay retains the same physical head matrix and
  shaft mesh when only the electronic angle changes.

`render/validation.json` and the five matched-view images use hash-verified
317.6 µm display data, the actual production acoustic model, and actual volume
and instrument GLSL in native EGL. These are explicitly **source previews**.
They establish source and geometry consistency, not browser frame rate or
clinical accuracy. The separate shared-pipeline performance work verifies the
79.4 µm sampling and cache path.

Reproduce from the project root:

```bash
node tests/tee-lab-v26.mjs --report=docs/tee-lab-v26/verification.json
node scripts/tee-lab-v26/export_review.mjs {source-cache}/tee-lab-v26/render
python3 scripts/tee-lab-v26/render_review.py {source-cache}/tee-lab-v26/render
```

The DOM test uses the existing Linkedom installation or `--dom=<module path>`.
Native rendering needs the existing NumPy, Pillow and Mesa/EGL environment and
the manifest-listed local display assets. Intermediate rasters are outside the
Git checkout; runtime source, tests, render receipts and review JPEGs are inside.
