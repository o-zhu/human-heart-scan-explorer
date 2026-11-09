# Probe Lab v11: controls and physical context

## User-visible changes

The two primary actions, **Control the probe** and **Orbit the heart**, now sit
above the equally sized 3D and image panes. They expose one active mode. Clicking
the first action or the 3D view captures the cursor from the same user gesture;
Escape releases it. Orbit mode releases cursor control and hands the view back
to the existing camera. The locked state has a larger, high-contrast Escape cue.

Default horizontal cursor motion now rotates the probe about its beam axis.
Vertical motion tilts it. Alt+horizontal motion fans the beam within its starting
plane, and an explicit Fan + tilt option remains. The steering pad, Q/E keys,
angle sliders and surface-translation controls are retained. The on-screen mouse
instructions follow the selected mode.

Four dedicated starting-plane buttons replace the dropdown. The buttons retain
the existing IDs, source planes and physical values. Donors with unreviewed
clinical alignment get geometric labels on those buttons. No preset origins,
probePose calculations, contact coordinates, donor scales or probeCapPlane
calculations changed in this release. Existing prepared Ultra planes therefore
still match their exact physical default poses.

## Geometry and skin

The former block-shaped polygon instrument has been replaced by a shaded,
rounded cardiac phased-array illustration: a narrow rounded acoustic footprint,
contoured grip, side pads, orientation marker, case seam, cable boot and cable.
The atrial-side preset gets a distinct rounded TEE tip and flexible shaft. These
are original illustrative meshes, not a vendor-certified product model. A small
isolated WebGL overlay renders the instrument and the tessellated curved contact
surface, without modifying the donor volume renderer or its lighting. A software
triangle fallback retains the instrument when that overlay is unavailable.

The main skin patch remains the precise local movement constraint, with a more
continuous shaded surface instead of a wire grid. It is an educational contact
guide. The TEE preset retains its separate esophageal-wall constraint.

A separate **Chest orientation** view contains real BodyParts3D skin, ribs,
costal cartilage, sternum, clavicles, thoracic spine and reference-heart meshes.
The translucent skin and bones provide body orientation without obscuring the
measured donor heart. The probe illustration follows the selected preset and
relative movement/rotation; its external contact position is sampled from the
reference skin surface. Front and oblique buttons expose the context clearly. A Chest orientation button
below the 3D view opens and reveals the context when its controls are scrolled.
The view visibly identifies itself as a reference chest that is not registered
to this donor. The bone geometry is not used by the acoustic simulation.

The official 64,888,505-byte BodyParts3D archive was subsetted and simplified to
30,096 triangles: a **495,691-byte gzip** plus a **35,675-byte manifest**. It is
requested only when Probe Lab is entered, with low fetch priority. It never
blocks the heart, probe controls, or measured slices. The decoded geometry is
2,166,912 bytes. The original archive remains in an external preparation cache.

## Asset research and provenance

The selected torso is from the official [BodyParts3D archive](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html).
Its [official license](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html)
explicitly permits adaptation and redistribution under CC BY 4.0, with the
required DBCLS attribution. The derivative's element IDs and checksums are in
`public/assets/probe-context-v11/manifest.json`; license and modifications are in
the adjacent `LICENSES.md`.

The [PLUS Toolkit catalog](https://pluslib.readthedocs.io/projects/PlusModelCatalog/en/latest/catalog/tools.html)
provides actual Ultrasonix C5-2/60 curvilinear and several linear-probe meshes.
Those shapes were not substituted for a cardiac phased-array transducer. The
[3S Probe_C](https://sketchfab.com/3d-models/3s-probe-c-e88eb047f2334adf90d5f0b33383eff4)
by tjwhite13 is listed as CC Attribution but the source download was not accessible
without further service access. [Open Source Medicine](https://osmedicine.org/3d-scans)
publishes a real Butterfly iQ3 device scan, but its page did not expose a clear
redistribution license. No inaccessible or ambiguously licensed source was
silently copied or relabeled. The shipped instrument remains explicitly original
illustrative geometry.

## Verification

`node tests/probe-lab-v11.mjs` exercises the actual module DOM and event handlers:
four direct preset actions, unchanged default physical poses, horizontal roll,
vertical tilt, Alt fan, stationary contact during steering, mutually exclusive
camera/probe modes, immediate pointer capture, Escape release, unreviewed-donor
labels, mesh integrity and reference-skin contact. All six tests passed.

`python scripts/render-probe-context-v11.py` compiles and renders the exact
production geometry shaders in native surfaceless EGL. It checks the cardiac
instrument, TEE head, and two torso contact positions. This caught and corrected
a shader uniform-precision mismatch before delivery. The recorded output is
`geometry-review.png`, with shader evidence in `shader-verification.json`.
The final `tests/donor-comparison-v11.mjs --require-fine` integration gate also
passed all eight tests with the three replacement donors. All twelve prepared
probe planes match their runtime physical poses and fine source resolution;
all three donors pass their actual Echo/Probe/comparison DOM contracts. Evidence
is in `docs/donor-comparison-v11/module-validation.json`.

These are geometry/GLSL checks, not browser screenshots, device-speed measurements
or clinical validation. No browser automation was used.

Rebuild the reference asset with:

```sh
python scripts/prepare-probe-context-v11.py --cache /path/to/bodyparts3d-cache
```

The cache must contain the official archive as `bodyparts3d-thorax-source.zip`
and the official `partof_element_parts.txt`. Preparation needs NumPy and VTK.
