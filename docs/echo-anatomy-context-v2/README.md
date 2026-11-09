# Echo reference thorax v2

The TTE and TEE atlases can now share the existing **BodyParts3D skin, rib cage,
sternum, clavicles and thoracic spine** in the measured heart's world coordinates.
The reference asset's heart is excluded from every returned display model. The
donor reconstruction remains the only displayed heart.

The implementation is `public/echo-anatomy-context-v2.js`. It upgrades static
context geometry and supplies actual skin-surface queries. It does not choose
an acquisition, change a CT plane, move a probe, control a camera or draw an
independent overlay. Those operations remain with their existing controllers.

## Existing source, verified before use

The source is the already included `public/assets/probe-context-v11/torso.bin.gz`
and its manifest. There is no new anatomy download or additional asset bank.
The 495,691 compressed bytes decode to 2,166,912 bytes of little-endian float32
triangle-expanded XYZ positions and XYZ normals. Exact metadata, compressed and
decoded hashes are pinned in the module. Downloads and decompression use bounded
streams; all checks finish before a caller receives geometry.

| Source | SHA-256 |
|---|---|
| Manifest | `d8a7563803aac62012c4e78075024cbc35cd5ce53338b3797ca0068484b4408c` |
| Compressed mesh | `5e02de3b94c4a527d059bc6bb0c2d58ac995d699c940e9e5e68e997c11e37a28` |
| Decoded mesh | `49fba584164d5664b30b8fc662f3a516bfc09f36b4c99308968efd906cf89b4c` |

Mesh offsets/counts must match the pinned layout. Every source position must be
finite and within the reference coordinate bound, and every source normal must
have a finite length near one. The transform preserves orientation and uses
unit normals. The original public files are never rewritten.

BodyParts3D is credited to The Database Center for Life Science under CC BY 4.0.
The original preparation selected, clipped and decimated the official reference
meshes. This update clips the existing display triangles to a thoracic region,
transforms them once and changes their display material. It adds no anatomical
surface or mesh cap at the crop boundaries. Source and terms:

- [Official BodyParts3D downloads](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html)
- [Official license](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html)
- Existing preparation: `scripts/prepare-probe-context-v11.py`
- Existing attribution: `public/assets/probe-context-v11/LICENSES.md`

## One body frame for every view

The source preparation already maps coordinates to **patient left, superior,
anterior**, in reference millimetres:

```text
[raw X, raw Z − 1220, −raw Y − 115]
```

The new module retains `createTeeContextFrame`'s fixed orthonormal L/S/A frame.
The same similarity applies to both atlases, every body mesh, its normals,
labels, skin contact points and skin-plane intersections:

```text
world = frame.originMm
      + frame.scale × [frame.left frame.superior frame.anterior]
                    × (referencePoint − [20, 5, 8])
```

`[20,5,8]` is the existing manifest's cardiac reference center. It is used as an
illustrative placement anchor at the donor frame's AV-centered origin; the
manifest does **not** identify it as an annotated AV landmark. The uniform scale
is the existing donor physical-extent ratio, `referenceMm / 168.0104`. There is
no separate per-view body transform or fitted camera-dependent placement.

For LADAF-2021-17 the existing frame uses the approximate source-reviewed AV
midpoint, atrial orientation and fixed reviewed 4C normal. It keeps left and
right chambers on their respective sides, the LA posterior, the RV anterior,
and the apex left/inferior/anterior. It does not equate the cardiac long axis
with body vertical. Its local reference points include:

| Source landmark | Left (mm) | Superior (mm) | Anterior (mm) |
|---|---:|---:|---:|
| AV midpoint | 0 | 0 | 0 |
| LV reference | 26.20 | −9.23 | 10.14 |
| RV reference | −1.39 | −9.21 | 34.64 |
| LA reference | −1.19 | 12.48 | −24.99 |
| Apex | 37.75 | −32.81 | 43.29 |

A geometric support patch at the reference heart's left/inferior/anterior end
maps to approximately `[39.75,−36.69,37.15]` local millimetres, about 7.5 mm from
the source-reviewed donor apex. This is a placement consistency check, not a
clinical registration or an annotated reference-heart apex. The reproducible
patch-selection method and exact results are in `geometry-verification.json`.

The comparison donors retain their own baseline geometric frame and physical
scale. They do not inherit LADAF's cardiac landmarks or anatomical validation.
No specimen has an acquired surrounding body, so the displayed thorax, its
orientation and contact windows remain explicitly illustrative and unregistered.

The independent Probe Lab's `referenceTorsoPose` uses a separate basis for each
starting preset. That mapping is appropriate to its separate reference pane but
is deliberately not used for this shared atlas geometry.

## Context and rendering

TTE's schematic rib arcs, sternum and flat diaphragm are replaced with the real
reference thorax and the existing detailed TEE diaphragm: two domes, central
tendon, peripheral rim and a true esophageal-hiatus opening. The diaphragm is
built with the same fixed frame. TTE does not acquire a TEE routing interface.

TEE retains every existing esophagus, stomach and diaphragm mesh, as well as
the exact tract and gastric-interior arrays. Its body meshes have byte-identical
positions and normals to TTE's body meshes for the same donor/frame.

The source thorax is clipped to reference bounds `[-160,−120,−165]` through
`[160,160,115]` mm. This excludes the upper-arm edges and abdominal continuation.
The cropped model contains 4,038 skin, 14,349 bone and 3,469 spine triangles.
Bone opacity is 0.19, spine 0.14 and skin 0.035; these materials keep contextual
anatomy secondary to the acquired heart and its section.

Meshes use the existing `XYZ,NXYZ` contract. They belong in the existing
accepted-heart-depth renderer, where the heart and cut face occlude reference
geometry behind them. This module creates no canvas or independent depth buffer.
The same arrays can be consumed by the existing software depth path.

`focusPointsMm` provides transformed cardiac/window-region corners plus donor
landmarks. Use these points when fitting a context camera. They avoid fitting
the full body or an unnecessarily inflated world-axis-aligned bounding box.
`bounds` still reports the actual mesh extent for geometry/culling consumers;
`focusBounds` is available for callers that require an AABB.

## Integration API

```js
import {
  loadEchoAnatomyContext,
  loadEchoReferenceAnatomy,
  createEchoAnatomyContext,
  bodyReferenceToWorld,
  worldToBodyReference,
  sampleEchoBodySkin,
  intersectEchoBodySkinPlane,
} from './echo-anatomy-context-v2.js';

const model = await loadEchoAnatomyContext({
  baseModel,        // Existing fixed TTE or TEE context model
  frames,          // Baseline donor frames; never the active view
  donorId,
  referenceMm,
  signal,
});

// Or reuse one verified reference for both atlases / donor models:
const referenceAnatomy = await loadEchoReferenceAnatomy({ signal });
const model2 = createEchoAnatomyContext({
  baseModel, referenceAnatomy, frames, donorId, referenceMm,
});
```

The source download is shared and failures are retryable. Cancelling one consumer
does not cancel a second atlas's shared bounded download. The controller must
still ignore a completed result if its donor/base model was superseded. Models
and geometry buffers should be treated as immutable after creation.

| Field/helper | Contract |
|---|---|
| `bodyTransform` | Fixed right-handed similarity and registration qualification |
| `bodyReferenceToWorld(point, model)` | Reference L/S/A millimetres → donor world millimetres |
| `worldToBodyReference(point, model)` | Inverse transform |
| `bodyReferenceDirectionToWorld(direction, model)` | Reference direction → normalized world direction |
| `skinSurface.vertices` | Actual cropped skin triangles in world millimetres, interleaved XYZ/NXYZ |
| `skinSurface.referenceVertices` | The corresponding triangles in reference coordinates |
| `skinSurface.vertexStride` / `triangleStride` | 6 / 18 float32 elements |
| `bodyWindows[id]` | Fixed reference bounds, source/window label and actual skin anchor |
| `focusPointsMm` | Preferred source-consistent camera-fit points |
| `referenceAnatomy` | Shared, verified geometry source; no displayable reference heart |

### Skin contacts and plane intersections

`sampleEchoBodySkin(model, leftMm, superiorMm)` intersects a ray with the actual
anterior skin triangles. It returns `pointMm` in world millimetres,
`bodyPointMm` in reference millimetres, outward `normal` and `bodyNormal`,
`triangleIndex`, and barycentric weights. It returns `null` if the source skin
does not cover that coordinate. It does not invent a flat fallback contact.

The initial illustrative anchors are:

| Window ID | Reference left | Reference superior | Actual reference anterior |
|---|---:|---:|---:|
| `parasternal-long`, `parasternal-short` | 26 | 25 | 95.27 |
| `apical` | 76 | −48 | 104.42 |
| `subcostal` | 0 | −72 | 99.93 |
| `suprasternal` | 0 | 92 | 49.35 |

These bounded windows are positioning guides, not a segmentation of individual
intercostal spaces. The source-space bounds are exported as `ECHO_BODY_WINDOWS`.

```js
const segments = intersectEchoBodySkinPlane(
  model,
  { centerMm, normal },       // centerMm is WORLD MM, not normalized CT units
  { windowId: view.group, frontOnly: true },
);
```

Each returned segment contains world endpoints `aMm` / `bMm`, reference
endpoints `bodyA` / `bodyB`, its skin `triangleIndex`, and the triangle's outward
normal in both spaces. The endpoints remain in the supplied plane and the
bounded reference window. The function never alters the supplied plane.
An empty result is a real geometric incompatibility for that window; the
acquisition controller must resolve it explicitly, rather than show a sector
that silently diverges from the measured CT section.

## Verification

```sh
node --test tests/echo-anatomy-context-v2.mjs
node scripts/echo-anatomy-context-v2/export-models.mjs
```

Nine focused tests cover corrupted/truncated/oversized inputs, pinned source
checksums, cropped geometry bounds, normals, identical fixed body transforms in
both atlases, unchanged TEE tract/GI identity, the reused TTE diaphragm,
triangle-derived skin contacts, exact plane/window intersections, separate
comparison-donor frames, explicit donor/scale mismatch guards, bounded loading,
and camera-focus extent. Every test uses the real local reference asset.

`geometry-verification.json` records each donor's fixed frame, transform, mesh
hashes/counts, normalized-normal error, window contacts and placement evidence.
An optional native-render export writes only the verified production geometry:

```sh
node scripts/echo-anatomy-context-v2/export-models.mjs --mesh-out={temporary-cache}
```

Complete native acquisition/cutaway/sector review belongs to the integration
review. These numerical checks do not claim browser rendering, patient
registration, clinical acquisition validation or measured acoustic propagation.
