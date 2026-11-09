# Intact reference-skeleton fit

The user rejected the v40 vertebral cutaway and requested a fit of the skeleton around the existing heart and esophagus. The v41 implementation restores the complete original cropped spine and fits every skeletal mesh with the same fixed smooth field. No bone triangle is removed, added or capped. The original BodyParts3D assets are unchanged.

Only LADAF needs this correction. The S-20-29 and S-20-28 skeletal meshes remain byte-identical. The skin, GI tract, stomach, diaphragm, source heart, body transform and contact-window queries remain unchanged for all three donors. Bone labels follow the same skeleton fit. The fit has no view, camera, slice or probe input.

## Fixed field and normals

Coordinates below are reference millimeters relative to the existing body reference origin `[20, 5, 8]`, with x left, y superior and z anterior. The field preserves x and y and changes depth by:

```text
z' = z - 14 exp(-((x+20)/60)² - ((z+60)/30)²)
       - 3 exp(-((x+20)/60)² - ((z-90)/35)²)
```

The first term moves the anterior vertebral surface away from the fixed esophagus, while tapering before the posterior spinous processes and lateral ribs. The smaller anterior term improves the existing sternum/skin fit. Both terms apply to every bone through one shared function, so coincident source positions remain coincident. The unchanged body transform then supplies world coordinates.

This is a smooth fitting deformation, not one rigid translation or a uniform scale. Normals use the exact inverse transpose of its local Jacobian. The analytic global lower bound on its determinant is **0.5261875683**, proving a positive depth derivative throughout the field. The minimum over the actual source vertices is **0.5997301199**. Observed maximum displacement is **13.9981 mm**; the conservative global displacement bound is 17 mm. Every fitted triangle retains its winding, nonzero area and finite unit normals.

The runtime files are `public/echo-skeleton-fit.js` and `public/echo-anatomy-context-v2.js`. The unused `public/echo-context-cutaway.js` is removed. The historical v40 clearance test explicitly loads its pinned v40 Git snapshot, preserving the earlier evidence without shipping or executing the old cutaway in the website.

## Actual geometry checks

The continuous intersection tests use the original and current reference triangles. The heart separation check uses the immutable acquired-heart support mask, its convex envelope and half a support-cell diagonal as a conservative guard. These checks concern illustrative geometry; they do not establish patient registration.

| Check | Spine | Ribs/sternum/clavicles |
| --- | ---: | ---: |
| Original cropped triangles retained | 3,469 of 3,469 | 14,349 of 14,349 |
| Esophagus intersection pairs before | 551 | 0 |
| Esophagus intersection pairs after | **0** | **0** |
| Conservative esophagus clearance | **4.3137 mm** | **7.5739 mm** |
| Stomach intersection pairs after | 0 | 0 |
| Continuous acquired-heart support clearance | **22.3879 mm** | **1.9526 mm** |
| Vertices outside the outer anterior/posterior skin envelope | 0 | 0 |
| Minimum vertex margin within that skin envelope | 8.4442 mm | 1.9415 mm |
| Skin triangle intersection pairs before → after | 0 → 0 | 263 → 61 |

### Residual coarse skin contacts

The reference skeleton and skin are not asserted watertight. The 61 residual rib/sternum–skin pairs involve 39 bone faces: 37 already intersected the original skin, and two adjacent faces now contact neighboring skin triangles. Twenty-six are existing superior/lateral faces. The original 263 pairs involved 161 bone faces.

Sampling the residual faces at no more than 0.5 mm triangle-edge spacing produced 7,029 samples and **no excursion beyond the outer anterior/posterior skin envelope**. The original contact faces had 2,225 outside samples and a maximum sampled excursion of 1.2152 mm. This sampled result is reported separately from the continuous triangle intersections; it is not a claim of zero remaining contacts. The requested spine/esophagus intersection is removed with the complete spine retained.

## Validation and reproduction

- **21/21 focused tests pass**, covering all donor source/skin/GI/contact invariants, exact TTE/TEE agreement, preserved topology, Jacobian normals, winding, original source hashes and existing context geometry.
- The accepted-plane comparison covers **112 current/previous TTE/TEE states** against the source opened at `b1e5eb16954839923d0e37841079008c99730daf`. Plane, instrument, skin-contact and window geometry are compared by exact per-case digests. See `skeleton-plane-invariance.json`.
- `skeleton-fit-verification.json` records the continuous geometry and source-support measurements, contact classification, deformation bounds and runtime hashes.
- `native-skeleton/verification.json` and `native-skeleton/skeleton-fit-before-after.jpg` show current production GLSL on the actual original and fitted reference meshes. Both identical-camera views passed with GL error zero; the image was visually inspected. Diagnostic opacity is raised to expose intersections. Native EGL/llvmpipe rendering is not a website screenshot or physical-device test.

```sh
node --test tests/echo-skeleton-fit-v41.mjs tests/echo-anatomy-context-v2.mjs tests/tee-context-v2.mjs
OPENBLAS_NUM_THREADS=1 python3 tests/echo-skeleton-fit-v41.py --export /dev/shm/context-fit-v41/final
OPENBLAS_NUM_THREADS=1 python3 tests/echo-skeleton-fit-v41-native.py
```

The JavaScript comparison uses the frozen v40 Git snapshot to prove the unchanged source and organ paths. The final runtime SHA-256 values are:

- `echo-skeleton-fit.js`: `23506c0127fcccd95d23d15070e02349c18bc40846d1a39fcbef215efc69133e`
- `echo-anatomy-context-v2.js`: `a1998f8207408a64be6fcad39884ec1adad1ca035a1c645c30ba45f868c75868`
