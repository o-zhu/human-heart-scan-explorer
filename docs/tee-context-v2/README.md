# TEE spatial context: esophagus, diaphragm and stomach

**Presentation update:** the original geometry documented here remains in use.
The v4 spatial update supersedes this report's independent x-ray overlay and
unresolved-probe suppression: context now respects actual heart depth, and
unresolved targets receive explicitly independent probe estimates. See
`../tee-spatial-v4/README.md` for the current interface and verification.

This update adds a fixed, procedural anatomical context around the source heart.
It is **illustrative anatomy**, not a segmentation of the excised donor's missing
esophagus, diaphragm or stomach. Its placement is an authored approximation.
The measured heart, source pixels, source mesh and clipping coordinates are
unchanged.

## What the model contains

- A smooth, slightly flattened esophageal wall with a broad posterior course,
  a gradual lower turn, a diaphragmatic waist and a short abdominal segment.
- A continuous esophagogastric surface. The cardia joins the esophagus at a
  shared vertex ring with shared smooth normals; there are no overlapping
  terminal caps or disconnected primitive shapes.
- A recognizable gastric fundus, dependent body, lesser and greater curvatures,
  rightward antrum and small pyloric outlet. The fundus rises approximately
  20 mm above the cardia in this illustrative reference.
- An asymmetric, two-domed diaphragm with a real mesh opening for the
  esophageal hiatus. The central tendon has a smooth, restrained material
  patch; a 0.12 mm display lift prevents coplanar rendering artifacts.
- Fine, low-opacity contours at the hiatus, diaphragm margin, gastric
  curvatures and two open tubular ends. No fabricated mucosal texture or
  internal tissue segmentation is supplied.

The custom WebGL overlay shares the heart camera and physical scale. Because
the heart renderer and geometry overlay use separate depth buffers, this is
an intentional **transparent x-ray context**. Its opacity should remain low;
opaque contextual organs would imply occlusion information the renderer does
not possess.

## Fixed placement and anatomical assumptions

The source's `[X,Z,−Y]` viewer mapping is preserved exactly. It does not imply
patient superior, left or posterior. The donor was acquired as an excised
specimen, so the surrounding body's orientation cannot be recovered directly.

For LADAF-2021-17, the AV midpoint is taken from the previously reviewed mitral
region and tricuspid hinge region. The posterior reference points from the
aortic lumen toward the LA reference region. An illustrative superior direction
balances the longitudinal RA trend with the fixed, independently reviewed 4C
plane normal. This yields a 29.4° body-superior/4C-normal angle while retaining
the LV apex approximately 33 mm inferior and 38 mm left of the AV midpoint.
It avoids equating the cardiac long axis or the current scan plane with body
vertical.

These choices are fixed constants at this review revision. Selecting a view,
rotating the electronic plane, turning the shaft or flexing the tip cannot
move any organ. Future plane refinements also leave the context unchanged.

The ME esophageal course passes near source `[387,285,108]`, where the reviewed
4C, 2C and LAX sections nearly meet outside the preserved atrial envelope. A
previous attempt to visit separated plane-specific anchors created a horizontal
elbow. That attempt was rejected. The final broad curve keeps the local shaft
approximately 20–33° from the reviewed 4C normal over 31–35 **model** cm. The
lower turn lies farther posterior to protect the visible LV surface.

Source inputs are `docs/anatomy/cavity-tracks.json`,
`docs/anatomy/boundary-landmarks.json`, `docs/flow-views-landmarks-v5.json`, and
the independently selected source plane in
`public/assets/tee-atlas/plane-fit-v2.json`. Cavity-track points are recorded as
`[z,x,y,rx,ry]`; the generator's cardiac anchors explicitly convert them to
source XYZ. Regional annotations and source landmarks are approximate and are
not expert ground truth.

Comparison donors use their own measured physical extent and their own fixed
geometric reference frame. They receive the same authored reference-organ
shape, scaled geometrically; LADAF source landmarks are not transferred.
Their clinical correspondence remains unassigned.

## Integration API

The module is `public/tee-context-geometry.js` and has no external rendering or
mesh-library dependency.

```js
import {
  createTeeContextModel,
  sampleTeeContextTract,
  teeContextCamera,
} from './tee-context-geometry.js';

const model = createTeeContextModel({
  frames,                         // Baseline donor frames, not the active plane
  referenceMm,                    // Longest physical source centre extent
  donorId: 'ladaf-2021-17',
});

// Once per model: upload static geometry.
const uploaded = model.meshes.map(mesh => ({
  ...mesh,
  gpu: geometryCanvas.upload(
    mesh.vertices, mesh.color, mesh.alpha, mesh.gloss
  ),
}));

// For routing: distances are along the fixed authored centreline in world mm.
const pathFrame = sampleTeeContextTract(model, arcMm);

// For a wide context view: normalized eye + camera basis, world-mm target.
const camera = teeContextCamera(model, width / height);
```

Create and retain one model per donor/baseline physical geometry. Do not rebuild
it from a requested probe pose or transform it to follow electronic multiplane
rotation. Treat the typed geometry buffers as immutable after creation.

| Field | Meaning |
|---|---|
| `frame` | Fixed orthonormal left/superior/anterior reference, posterior inverse, origin in world mm, scale and placement provenance |
| `meshes` | Ten static surfaces/contours; triangle-expanded `Float32Array` vertices in `XYZ,NXYZ` order, color, alpha, gloss and bounds |
| `labels` | Text, priorities and world-mm anchors for esophagus, diaphragm, stomach and hiatus |
| `landmarksMm` | Cardia, hiatus, fundus, gastric body, antrum, pylorus and ME esophageal point |
| `tractSamples` | Continuous centreline samples with `pointMm`, `arcMm`, `insertionCm`, `tangent`, `shaft`, `right`, `beam`, minimum ring-radius hint, and region tag |
| `gastricInteriorSamples` | 1,551 fixed cardial/fundic/body candidates, with the same route fields plus `pathIndex` and a radial clearance hint |
| `bounds` / `camera` | Wide contextual bounds and preferred viewing direction; not a request to alter the measured clipping plane |
| `contours` | World-mm paths for software fallback or restrained outlines |
| `topology` | Indexed mesh data for numerical review of intended openings and shared GE junction |
| `provenance` | Explicit unregistered, illustrative-context and x-ray-presentation qualifications |

The centreline's canonical beam points toward a fixed cardiac target after
projection perpendicular to the local shaft. Its right/beam/shaft basis is
orthonormal. This is a neutral modeling reference, not a clinical acquisition
claim. Electronic angle and distal flexion belong to the probe controller.

The gastric interior candidates are useful for atlas views that originate in
the fundus or along its wall. A single gastric centreline cannot represent
every TG viewing location. Each interior sample retains a connected
`pathIndex`; a shaft can follow that route before bending inside the stomach.
The reported radial margin is geometric and is not a validated collision test.

The production atlas checks plane projection against the available radial
margin, allowing room for the displayed probe head. The acoustic face is 3 mm
anterior to the projected tract point along its in-plane beam, centering the
head's bulk around the tract without changing the physical scan plane. Either
equivalent plane-normal sign is allowed so an electronic 90° view does not
introduce a backwards mechanical head. These are explicit illustrative
placement checks, not contact-force or device-CAD validation.

Some independently optimized source planes remain incompatible with this
fixed authored tract or gastric lumen. The atlas must retain that limitation,
suppress an unresolved floating probe/sector, and continue showing the measured
heart and contextual organs. Do not move the organs per view to make a poor fit
appear registered. Current per-view distances and the actual production pose
decisions are recorded in `plane-residuals.json`.

At the final audit, 14 of the 24 source-supported atlas sections pass the
illustrative placement checks and 10 retain an unresolved probe placement.
The additional four aortic views are outside this excised-heart scan. Passing
these checks is not clinical validation. Deep transgastric placement also
requires an approach toward the apex: an incidental lateral intersection with
the same plane is insufficient, so that unresolved case keeps its probe hidden.

## Validation and its limits

`tests/tee-context-v2.mjs` passes nine focused checks:

1. Correct fixed handedness, metric scaling and source-frame immutability.
2. One orientable esophagogastric surface with exactly two intended end openings
   and a shared, connected GE junction.
3. A diaphragm annulus with a true hiatus, no non-manifold edges and no hidden
   hole-filling triangles.
4. Finite positions, unit smooth normals, nonzero triangles and consistent
   face orientation for every surface and contour.
5. Anatomical ordering, an inferior apex, smooth path tangents and continuous
   distance-based mechanical reference frames.
6. Connected gastric candidates, a fundus below the diaphragm and no horizontal
   ME elbow introduced to satisfy image-plane constraints.
7. Byte-identical organ meshes across 60 probe steering combinations and after
   replacing the selected source-frame basis.
8. Independent geometric scaling for both comparison donors.
9. Camera fit containing all contextual bounds across five aspect ratios.

The native EGL render review uses the **actual procedural buffers and production
geometry shader**, with anterior, posterior, left and oblique views. Surface
renders make shape defects easier to detect; transparent renders show the
intended presentation. The gray heart in these review figures is a coarse,
thresholded source silhouette used only for placement inspection. These figures
are not browser screenshots or browser performance measurements.

`production-probes-triptych.png` additionally captures the actual
`atlasContextProbePose`, `TeeSceneOverlay` draw commands and culling order, and
`TeeAtlasOverlay` guide commands for ME 4C, ME 2C and TG papillary views in one
unchanged global camera. This review includes the acoustic-face offset and
equivalent-normal mechanical orientation. The shaft follows the esophagus,
passes the hiatus for the TG example, and turns within the gastric region.
The source-code hashes and per-view placement residuals are retained in
`render-verification.json`.

The final coarse source-envelope check found:

- Minimum sampled esophageal centreline clearance: **8.92 mm**.
- Minimum sampled esophageal wall clearance: **3.70 mm**.
- **Zero** of 25,344 expanded esophageal vertices within 0.3 mm of the coarse
  tissue mask.
- Minimum vertical clearance between the authored diaphragm and coarse source
  heart envelope: **4.38 mm**.
- The authored gastric fundus remains below the authored diaphragm; the exact
  minimum gap is recorded in `verification.json`.

These are computed distances between an authored model and a coarse source
envelope. They are **not measurements of this donor's diaphragm or esophagus**,
do not validate a living patient's spatial relationships, and do not establish
clearance against every fine tissue fold or arbitrarily steered probe.
`source-clearance.json` records the verified compressed source hash, threshold,
sampling grid and envelope method. No source file is modified.

### Reproduce

From the repository root:

```sh
node tests/tee-context-v2.mjs --report=docs/tee-context-v2/verification.json --render-data={temporary-cache}
node docs/tee-context-v2/audit.mjs
node docs/tee-context-v2/export_probes.mjs
python3 docs/tee-context-v2/render_review.py --heart
python3 docs/tee-context-v2/source_clearance.py
```

The scripts write only geometry review artifacts and reports. The render and
clearance scripts require NumPy, SciPy, Pillow, scikit-image and ModernGL/EGL;
the production model and Node geometry tests do not.

## Anatomical references

- [ASE/SCA comprehensive TEE guideline, 2013](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf): local probe/transducer orientation, ME and TG acquisition principles, and variable esophageal relationships.
- [Sánchez-Quintana et al., Circulation 2005, PMID 16129790](https://pubmed.ncbi.nlm.nih.gov/16129790/): variability of the esophageal course behind the LA and the importance of avoiding a universal fixed relationship.
- [Surgical gastroesophageal-junction anatomy review](https://pmc.ncbi.nlm.nih.gov/articles/PMC7263794/): esophageal hiatus, short abdominal esophagus, cardia and fundic relationships.
- The project-specific clinical interpretation and source limits are documented
  in `docs/tee-plane-qc-v2/clinical-review.md` and `clinical-targets.json`.

These sources support the illustrated relationships. They do not supply a
patient registration, donor organ dimensions or measured probe insertion depth.
