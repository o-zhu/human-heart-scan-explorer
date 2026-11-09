# Mobile startup and linked Lab anatomy — v43

## Implemented behavior

Mobile Detail is the default prepared reconstruction on mobile devices. A legacy
shared Interactive Volume preference no longer suppresses it, and returning from
an early Echo/Lab visit activates the untouched default correctly. New explicit
mobile choices remain persistent. The prepared mesh still waits for the original
reviewed cavity cleanup. Detailed diagnosis and lifecycle evidence are in
[`../mobile-default-v43/README.md`](../mobile-default-v43/README.md).

TTE Chest Orientation now uses the same fixed Echo anatomy context and donor
world-millimetre coordinates as the main scan. Its heart is a bounded measured
outline from the already resident donor volume, replacing the separate generic
heart. Both displays receive the same accepted probe origin, axes, sector width,
depth and instrument scale. The overview has an independent orbit/pan/zoom
camera; it cannot retarget the probe. Front and Oblique fit actual skeleton
vertices with modest padding. Details are in
[`../probe-overview-v43/README.md`](../probe-overview-v43/README.md).

TEE Lab shows the existing fitted Echo skeleton by default, with an independent
Skeleton toggle beneath the reconstruction. It does not alter the fixed GI
geometry, calibrated probe or scan plane. The context uses the existing
heart-priority depth pass and software mask; the probe retains physical depth.
See [`tee/README.md`](tee/README.md).

## Targeted verification

| Check | Result |
| --- | --- |
| Mobile/default surface lifecycle | 53 passed |
| Device budgets and mobile cavity cleanup | 18 passed |
| Linked overview geometry, lifecycle and interactions | 8 passed |
| Shared camera/touch controls | 14 passed |
| TTE pose and marker alignment | 9 passed |
| Existing TTE UI/capture/entry checks | 22 passed |
| New TEE skeleton controller/asset checks | 8 passed |
| Existing TEE keyboard/shaft checks | 21 passed |
| Existing TEE application transitions | 4 passed |
| Existing fixed TEE context checks | 9 passed |
| Echo complete-cut-face regressions | 23 passed |
| Lazy module loading | 3 passed |
| Moving-probe source and stale-frame handling | 19 passed |
| Workspace layout and shared viewport controls | 7 passed |
| Echo reference geometry, skeleton and context presentation | 16 passed |
| Native heart-priority production-shader fixtures | 6 passed |
| Native TTE overview cases | 48 passed |
| Native TEE skeleton on/off cases | 12 passed |

The moving-probe suite initially could not locate its historical default DOM
dependency path. It passed all 19 checks when run with its documented `--dom=`
argument pointing at the installed LinkeDOM entry. No runtime change was needed.

## Native TTE review

The export decodes and hash-checks the original resident source for LADAF,
S-20-29 and S-20-28, and invokes the real `ProbeLabModule` starting-pose methods
and `ReferenceTorsoView.render` path. It captures all four starts, a plane
deliberately displaced completely outside the measured-heart bounding box, and
both independent Front/Oblique cameras: **3 × 4 × 2 × 2 = 48 cases**.

The EGL renderer uses the exact production GeometryCanvas shaders, geometry,
matrices, alpha blending and depth ranges. All accepted source poses remain
unchanged; sector vertices remain on their exact acquisition plane. Every
heart pixel is unchanged when surrounding context is added, and all cases have
zero OpenGL errors. Each donor's contact sheet was visually inspected after
refining the camera fit. The original world-axis bounding box fit was rejected
because it left excessive space around the rotated chest.

Evidence: [`tte/verification.json`](tte/verification.json) and the three
`tte/*-overview-review.jpg` contact sheets. The complete paired TEE results are
under `tee/`; **0 of 814,380 visible-heart pixels** changed with the skeleton.

To reproduce the TTE captures from the repository root:

```sh
node scripts/lab-context-v43/export-tte-overview.mjs --out={temporary-cache}
python3 scripts/lab-context-v43/render-tte-overview.py --input {temporary-cache} --output docs/lab-context-v43/tte
```

Source hashes must match the current runtime. The renderer requires native
EGL/OpenGL, NumPy and Pillow. TEE reproduction is documented separately in
`tee/README.md`.

## Resource and evidence limits

The overview adds no second source download, full source copy or volume texture.
Its extraction is capped at a 40-axis grid (32 on constrained devices) and
48,000 triangles, yields during computation and cancels superseded work. Actual
mobile-grid donor outlines used approximately 1.4–2.1 MB of vertex data. Source
upgrades while the Lab is hidden release obsolete array references and defer
extraction until re-entry. The shared reference anatomy asset is approximately
496 KB compressed; it is reused rather than duplicated.

These are controller, geometry and native production-render checks. Native
source rendering uses the resident 317.6/318.24 µm data and does not establish
fresh 79.4 µm loading or physical iPhone/iPad frame rate and memory behavior.
The chest, skeleton and GI tract remain illustrative reference anatomy, not
patient-specific skeletal registration. Original CT arrays, prepared heart
meshes, cleanup masks and accepted acquisition planes are unchanged.

The managed preview address was not reachable from the cloud browser, and that
browser did not provide WebGL. Accordingly, native EGL supplies the rendering
evidence; browser checks cover the published controls and software fallback,
not an asserted physical-device GPU test.
