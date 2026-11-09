# Echo anatomy context verification

## Presentation changes

The former foreground-transparency pass could tint accepted heart and section pixels with illustrative ribs, spine, diaphragm or esophagus. Both Echo renderers now limit anatomy context and context labels to pixels with no accepted heart/cap depth. The WebGL path uses a scoped far-depth range and the existing shared depth buffer; it allocates no additional mask, texture or framebuffer. The CPU path applies the equivalent accepted-depth test. Instruments retain their ordinary perspective depth behavior.

Context labels scale from 12 to 15 CSS pixels with viewport dimensions, with a 14-pixel minimum for coarse-pointer touch input. The glyph atlas remains at twice the displayed resolution. Collision-aware placement and priority filtering in small panes limit label crowding.

## Reference-spine intersection

Independent triangle tests reproduced a physical intersection between the existing LADAF illustrative esophagus and reference spine: 551 triangle-intersection pairs, involving 59 spine faces and 344 esophageal faces. The two S-donor contexts had no baseline intersection.

The correction is one fixed, narrow display cutaway in the LADAF reference spine, using complete esophageal ring bounds padded by 2.5 model millimeters. It clips intersecting reference-spine fragments without moving the esophagus, skin, body transform, probe, source plane or donor anatomy. It adds no caps or anatomical surfaces. The visible label, context caption and provenance identify this as a reference-spine cutaway; it is not patient registration.

The output contains 3,741 triangles (269,352 bytes). Of the 3,469 original spine triangles, 3,301 remain byte-identical; 168 are clipped into 440 retained fragments. Every retained fragment lies on an original reference-spine face. TTE and TEE produce the same output hash. Bounding-box candidate filtering avoids clipping work for untouched source triangles.

## Evidence

| Verification | Result | Receipt |
| --- | --- | --- |
| Original versus final accepted physical planes | All 112 unchanged; no failed handoffs; all TTE skin checks pass | `acquisition-invariance.json` |
| All three donor contexts | Body transforms, skin, GI tract and non-spine meshes unchanged; both S-donor spines byte-identical | `spine-cutaway-verification.json` |
| LADAF esophagus/spine intersections | 551 pairs before; zero after; conservative continuous triangle-bound clearance 2.5 mm | `spine-cutaway-verification.json` |
| S-20-29 and S-20-28 intersections | Zero before and after; conservative clearance 25.97 mm and 4.14 mm respectively | `spine-cutaway-verification.json` |
| Native current GLSL compositing | Six source/mesh/cap cases pass; accepted heart/cap RGBA unchanged by front/rear context or contour; instrument depth preserved; GL error zero | `native-context/verification.json` |
| Native actual reference geometry | Three identical-camera before/after views pass; GL error zero; rendered image visually inspected | `native-context/spine-render-verification.json` |

The six compositing cases use synthetic fixtures with current production GLSL. They verify the rendering rule, including open cavities, and do not measure clinical anatomy or device performance. The actual reference-geometry comparison separately uses the verified old/new LADAF meshes. Its diagnostic opacity is raised to expose intersections; it is not a website screenshot. Native rendering used EGL/llvmpipe and does not substitute for physical iPhone/iPad validation.

Images: `native-context/heart-priority-context.jpg` and `native-context/spine-cutaway-before-after.jpg`.

## Regression checks

- Existing depth, CPU fallback and color-invariance checks: 13/13 pass.
- Context geometry, source invariants and presentation checks: 22/22 pass.
- Production acquisition, donor planes and TTE guidance checks: 35/35 pass. The release workflow reruns its source-stability guard after production edits are frozen.
- The intentional clipped derivative is explicitly tested; original source hashes, fixed transforms and unchanged non-spine geometry remain enforced. Historical verification reports were preserved.

Reproduce the focused checks from the repository root:

```sh
node --test tests/echo-anatomy-context-v2.mjs tests/tee-context-v2.mjs tests/echo-context-presentation-v40.mjs
python3 tests/echo-context-clearance-v40.py --export /dev/shm/context-polish-v40/verified
python3 tests/echo-context-priority-v40-native.py
python3 tests/echo-context-cutaway-v40-native.py
```
