# TEE Lab fitted skeleton

TEE Lab now reuses the fixed, donor-specific reference skeleton already shown in
Echo Windows. A **Skeleton** button beneath the main reconstruction toggles the
bones independently of the esophagus, diaphragm, and stomach. It defaults to on;
an explicit hidden choice remains in saved Lab state. The reference asset is
shared, checksum verified, and 495,691 compressed bytes. No new binary asset was
added.

The Lab retains the original GI model for probe kinematics and starting-pose
calibration. Skeleton display selects the exact existing Echo bone vertex arrays;
it does not move or rescale the source heart, esophagus, skin contact, probe, or
imaging plane. The generic reference heart and skin are not added to TEE Lab.
**Frame Anatomy** includes the skeleton when visible.

## Heart visibility

The skeleton follows the existing `TeeSceneOverlay` shared-depth context pass.
`withHeartPriority` places contextual anatomy only in pixels without the accepted
heart or CT cap; the actual probe retains ordinary physical depth. The software
fallback uses the corresponding `backgroundOnly` accepted-heart depth mask.
No extra runtime framebuffer or special spine cutout is introduced.

## Targeted verification

- `tests/tee-skeleton-v43.mjs`: 8 passing controller/asset checks. All three
  donors use byte-identical fixed Echo bones, preserve their GI arrays, and leave
  all four Lab starting poses unchanged when skeleton visibility changes. The
  real button is beneath the main viewport, changes no source sampling, preserves
  its saved state, and respects independent organ visibility. Late asset
  completion after leaving the workspace cannot reattach context.
- Existing TEE keyboard and shaft regressions: 21 passing checks.
- Existing TEE application transition regressions: 4 passing checks.
- Existing fixed TEE context geometry regressions: 9 passing checks.
- Native spatial review: 4 Lab starts × 3 donors, with a same-camera skeleton
  on/off comparison for every case. The export calls the production Lab camera,
  probe/cap geometry, guide rendering, and `TeeSceneOverlay` draw paths. Caps come
  from the production MPR worker and each donor's hash-verified resident source.

The three donor folders contain source fingerprints, numerical checks, full-size
paired images, and a compact gallery. Every pair requires the same camera and
scan-sector commands, no bone draws in the off state, and exactly the two existing
bone meshes in both cull passes in the on state. The review compares heart pixels
before adding guide strokes; skeleton addition must leave every such pixel
byte-identical. Zero OpenGL errors are permitted.

All 12 cases passed: 814,380 visible-heart pixels were unchanged across the
skeleton on/off pairs, with zero OpenGL errors. The three compact galleries were
visually inspected for skeleton fit, heart clarity, and the independent hidden
state. All 21 source fingerprints matched the final runtime after the shared TTE
controller work was complete.

## Reproduce

Set `HEART_DOM_MODULE` to an installed LinkeDOM ESM entry. From the repository
root, repeat these commands for `ladaf-2021-17`, `s-20-29`, and `s-20-28`:

```sh
node scripts/lab-context-v43/tee/export.mjs --donor=ladaf-2021-17 --out={temporary-cache}/ladaf-2021-17
node scripts/echo-face-v42/sample-caps.mjs {temporary-cache}/ladaf-2021-17
python3 scripts/lab-context-v43/tee/render.py --input {temporary-cache}/ladaf-2021-17 --output docs/lab-context-v43/tee/ladaf-2021-17
```

Rendering requires NumPy, Pillow, and native EGL/OpenGL. Source fingerprints must
match the current runtime; a changed runtime requires a new export and cap sample.
The renderer is a native scientific graphics check, not browser automation.

## Limits

The native review uses measured resident display sources at 317.6 µm for LADAF
and S-20-28, and 318.24 µm for S-20-29. It does not establish fresh 79.4 µm source
loading, high-fidelity local replacement behavior, browser frame rate, or physical
iPhone/iPad performance. The skeleton and other surrounding anatomy remain
illustrative references, not patient-registered anatomy or clinical validation.
Source CT arrays, prepared heart meshes, masks, and accepted scan poses are unchanged.
