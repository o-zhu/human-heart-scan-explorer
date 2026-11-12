# Mobile surface shader compatibility — v48

## A redundant shader feature exposed a known Safari failure path

The prepared-heart shader declared the detached-component flag as a `flat`
vertex-to-fragment varying. WebKit's report
[289601, comments 12–15](https://bugs.webkit.org/show_bug.cgi?id=289601)
documents iPad/iPhone context loss with a flat varying and indexed geometry.
A WebKit maintainer identifies provoking-vertex emulation and recommends
`WEBGL_provoking_vertex` when the choice of provoking vertex is immaterial.
The [Khronos extension specification](https://registry.khronos.org/webgl/extensions/WEBGL_provoking_vertex/)
and [MDN WebGL guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#use_webgl_provoking_vertex_when_its_available)
describe the extra cost of emulating the default vertex convention on some
graphics backends.

This is a relevant, source-confirmed shader risk. It does not establish the
user's exact Safari version, GPU failure or process-kill cause.

The flag does not need flat interpolation. The production debris loader
rejects nonbinary flags and triangles whose three corners disagree. Every
accepted triangle therefore carries either `(0,0,0)` or `(1,1,1)` after the
existing normalized-byte conversion. Perspective-correct interpolation of a
constant is the same constant, including any vertices introduced by clipping.
The fragment shader's existing `> .5` discard decision is unchanged.

The two `flat` qualifiers are removed. This avoids the provoking-vertex path
without requiring an extension to exist or changing global context state.
Local and native replacement surfaces already disable this flag attribute and
provide constant zero with cleanup disabled for their pass. Retained geometry,
all source indices, all normals and mask decisions remain unchanged.

## Independent proof over the full preserved Ultra model

`tests/mobile-surface-shader-v48.mjs` decompresses the preserved original HFM
as a bounded stream. It verifies each compressed part, the whole compressed
and decoded hashes, every index range, every triangle's three vertex flags,
and every triangle's decision against the independently pinned face keep mask.
It never allocates a complete decoded HFM. The compact transport separately
requires the same pinned position/index identities and triangle corner order.

| Verified property | Result |
| --- | ---: |
| Source HFM bytes | 437,470,524 |
| Triangles checked | 23,618,685 |
| Triangles with mixed corner flags | 0 |
| Decisions differing from the pinned face keep mask | 0 |
| Excluded triangles | 5,832,864 |
| Retained triangles | 17,785,821 |

The checked source hash and attribute/mask hashes are in
`component-interpolation-proof.json`. The shader regression also evaluates
constant visibility at vertices, edges and interior samples with differing
perspective depths.

```sh
HEART_SHADER_EVIDENCE=docs/mobile-loading-v48/component-interpolation-proof.json \
  node --test tests/mobile-surface-shader-v48.mjs
node --test tests/mesh-debris-cleanup-v25.mjs
```

## Streamed cleanup attribute contract

`loadVerifiedDebrisFlags(lod, geometry, options)` verifies metadata, source
identity/counts, compressed and decoded lengths/hashes, and the binary flag
domain without requiring a whole geometry buffer. It returns `{flags, report}`
and does not mutate geometry or claim that triangle validation has happened.
The streaming consumer must verify index ranges and all three flags for every
decoded triangle before publishing geometry or applying that report.

`loadDebrisAttribute` remains the whole-buffer compatibility wrapper: it calls
the helper, checks every triangle, then assigns the verified report. Existing
corruption, mixed-face, source mismatch and cancellation rejection behavior is
retained. A focused test uses a geometry object whose `buffer` accessor throws
to confirm attribute preparation does not reach for a full model allocation.

These asset and controller tests do not establish Safari GPU memory use,
physical-device performance or successful installation on a particular iPad.
