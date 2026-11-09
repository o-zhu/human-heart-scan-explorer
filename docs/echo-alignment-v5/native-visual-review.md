# Native visual review: 56 Echo atlas views

The complete primary-donor atlas was rendered at both current camera anchors using production GLSL and the actual accepted acquisition planes. The output is in `native/`; reproduction instructions are in `scripts/echo-alignment-v5/README-native.md`.

## Coverage and provenance

| Check | Result |
| --- | --- |
| TTE views | 28, including separate 2.10a / 2.10b cards |
| TEE views | 28 |
| Camera renders | 112 at 800 × 700 pixels |
| Measured CT rasters | 49; actual production MPR worker on verified source bytes |
| Outside-acquisition views | 7; no fabricated CT raster or cap |
| Native GL errors | 0 across all 112 frames |
| Source spacing | 317.6 µm resident LADAF-2021-17 display volume |
| Shared depth | Production 0.01–10 projection with a common 24-bit depth attachment |
| Full-size reviewed pairs | PLAX, A3C, A4C, A5C, A4C posterior angulation, deep transgastric five-chamber, modified bicaval |
| Complete contact sheets inspected | TTE probe, TTE anatomy, TEE probe, TEE anatomy |

The source, shader, cap, fixed anatomy and harness fingerprints are retained in `native/review.json`, including the final `echo-tte-guidance.js` helper. All recorded source hashes matched the frozen working source immediately after the final render/review. Future changes require fresh export, cap sampling and rendering; the harness refuses a geometry export paired with stale caps.

After the final wording-only acquisition-method and fit-summary correction, the complete export, cap sampling and 112-frame render were repeated. All **221 JPG/PNG outputs are byte-for-byte identical** to the inspected gallery, all 56 plane/pose/camera records are unchanged, and the updated runtime fingerprints match. This final comparison is recorded in `wording-only-rerender.json`.

The same complete regeneration was subsequently repeated after the v63 renderer-scheduling integration at merge commit `f367c4997ffd74ebac1d4887255b6cf3ffa89e14` (remote commit `73e0af8b72d27a335e2bec00689916968845a5ac`). Again, all **221 images are byte-identical**, all **56 plane/pose/camera records are unchanged**, and all primary records match the final numerical audit. The production shader sources are unchanged and every current source fingerprint matches. The current receipt includes this integration provenance; the independent comparison is `v63-integration-rerender.json`. These image checks do not benchmark browser scheduling.

## Findings

The **probe anchor** puts the acoustic face above the displayed sector and keeps the measured CT section on the same physical plane. The actual source cut, the opaque probe and the reference anatomy share depth; surrounding anatomy behind the retained heart or measured cut does not behave as an independent x-ray layer. The sector remains a production-style vector overlay.

The **anatomy anchor** keeps one upright camera per atlas mode. Across the complete contact sheets, the ribs, sternum, vertebral column and body remain in the same frame while the retained cut and probe change with the selected view. A cap may appear edge-on or face away in this anchor because the camera is fixed; the retained tissue is not flipped to make every section face the viewer.

The first smoke images showed that the original reference-bone material competed with the CT. After the anatomy owner's targeted adjustment to bones 0.09, spine 0.075 and skin 0.025, the final context is quieter and the measured heart remains the brightest structure. The reference heart mesh is absent. The shared body geometry remains unchanged between TTE and TEE; TEE adds its existing gastrointestinal context.

The final apical A4C, A5C and posterior-angulation pairs share an apical contact in the fixed anatomy view while their sections tilt around that contact. The probe-view projection keeps the acoustic face above the section; the posterior-angulation source is explicitly named as that angulation rather than claiming that a coronary sinus has been confirmed from this render.

The revised **deep transgastric** view is visibly more longitudinal than the earlier smoke result. Its outflow/vessel channel is clearer, and the head/shaft relationship can be inspected inside the gastric context. This image alone does **not** confirm a complete clinical five-chamber view. Clinical correspondence and source landmark limitations remain separate from the successful plane, fan, cap and containment checks.

The **modified bicaval** pair now shows the probe in the esophageal segment. The numerical team separately checked actual head vertices and the shaft against the gastrointestinal mesh; those clearance findings should be cited from their own audit, rather than inferred solely from a translucent render.

All seven targets outside the acquisition retain a whole-heart reference and illustrative external target without a measured section cap. The descending-aorta probe close-ups crop part of the whole-heart reference while framing the external acoustic target. The corresponding anatomy anchor shows the complete thoracic relationship. Their contact-sheet cards are explicitly labeled **OUTSIDE SCAN**.

## Limits

These are native scientific images, not browser screenshots or browser interaction/performance evidence. The source is the measured **317.6 µm resident** volume; the images do not claim 79.4 µm Ultra surface detail or 19.85 µm native-region detail. Current reviewed lumen cleanup and baseline support cleanup are present. Fine local replacement meshes and their associated local exclusion fields are omitted together.

The body and probe are fixed illustrative references, not patient-registered anatomy. Neither coplanarity nor a visually plausible section independently validates clinical TTE/TEE correspondence. The comparison donors were not part of this native gallery.

## Review artifacts

- `native/tte-probe-gallery.jpg` and `native/tte-anatomy-gallery.jpg`: all 28 TTE views.
- `native/tee-probe-gallery.jpg` and `native/tee-anatomy-gallery.jpg`: all 28 TEE views.
- `native/{mode}-{id}-pair.jpg`: matching camera anchors for each view.
- `native/{mode}-{id}-ct-source.png`: the unmodified sampled resident raster for each acquired view.
- `native/review.json`: accepted plane/pose/camera values, actual source spacing, hashes, material provenance and native rendering receipt.

Measured source attribution: Brunet et al. / ESRF Human Organ Atlas, LADAF-2021-17, CC BY 4.0. Thoracic reference attribution: BodyParts3D, © The Database Center for Life Science, CC BY 4.0. The source URLs, license links and educational-display transformations are recorded in the native receipt and harness README.
