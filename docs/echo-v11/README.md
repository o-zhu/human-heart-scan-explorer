# Echo correspondence review — v11

Reviewed 5 November 2026. This audit distinguishes the publisher’s **movie
label** from the actual **CT anatomy contained in a plane**. Checking the former
does not validate the latter. No patient-specific or expert-validated registration
exists between this fixed donor CT and any independent cine.

## Findings

All **12 reference recordings** have source labels consistent with their named
view family. The CT side has **13 prepared planes** (the PSAX button offers two
levels): **6 have partial anatomical correspondence and 7 remain unverified**.
Those individual findings now appear beside the view, with an expandable list
of target structures and the specific missing checks. “Same view family” is no
longer used as a proxy for verified alignment.

| CT preset | Review | Remaining anatomical issue |
|---|---|---|
| TTE A4C | Partial | Atrial / AV junctions and outflow exclusion |
| TTE A2C | Partial | Exact mitral section and atrial extent |
| TTE A3C | Unverified | Continuous aortic outflow through the valve |
| TTE PLAX | Unverified | Mitral–aortic continuity; parasternal entry |
| TTE PSAX papillary | Partial | Exact papillary level; collapsed LV lumen |
| TTE PSAX mitral | Unverified | Leaflet opening and exact basal level |
| TTE subcostal | Unverified | Inferior acquisition path; liver absent |
| TEE ME4C | Partial | Atrial / AV junctions and outflow exclusion |
| TEE ME2C | Partial | Mitral section and esophageal viewing direction |
| TEE ME long axis | Unverified | LVOT / aortic valve inclusion |
| TEE AV short axis | Unverified | Cusp identity and valve level; no matching cine |
| TEE bicaval | Unverified | Both caval junctions and septal continuity |
| TEE TG papillary | Partial | Exact level and gastric viewing direction |

These are review findings, not an accuracy score. The CT heart is fixed and its
LV lumen is collapsed. A healthy clinical movie therefore cannot be expected to
have the same cavity shape or dimensions, even when the view family is similar.

Two recording distinctions are now explicit:

- The POCUS Atlas mitral PSAX movie is a **sweep** from the mitral opening toward
  the papillary level. It cannot match a single fixed section throughout playback.
- The Nazerian transgastric movie is labeled **short axis**. Its exact papillary
  level is not asserted. It appears as a broader-view reference.

The library still has no selected reusable ME aortic-valve short-axis recording.
It shows an explicit missing-reference message rather than silently substituting
another TEE view. A manually chosen different recording is labeled as such.

## Exact presentation corrections

The native CT planes were inspected beside the native movie posters and the
publisher’s annotated TEE Figure 1. Four presentation corrections were supported:

| Preset | Correction | Evidence |
|---|---|---|
| ME4C | Reverse horizontal presentation | The previous CT placed LV left; the annotated source movie has LV right and RV left. |
| PSAX papillary | Rotate display 180° | Move the RV crescent toward the upper-left clinical presentation. |
| TG short axis | Rotate display 180° | Correct the shared short-axis display; gastric registration remains unverified. |
| Subcostal | Rotate display 180° | Correct the inverted ventricular/atrial presentation; the acquisition path remains unavailable. |

The uncertain basal/mitral candidate was deliberately not given an orientation
correction based on an unconfirmed cavity identity.

Raw calibration centers, normals, axes and prepared image files remain intact.
The frame manifest records explicit `displayMirrorX` / `displayRotate180` flags.
For prepared planes the viewer applies an **exact byte permutation**. Streamed
and loaded-volume sections sample the equivalently transformed in-plane basis.
The physical normal, signed section offset and the underlying source values do
not change. The camera and retained cutaway half follow the displayed basis so
that the 3D cut face and CT pane agree. There is no interpolation, synthesized
anatomy, deformation or re-encoding in these corrections.

New donor presets remain geometric and unregistered; they do not inherit these
LADAF-2021-17 presentation corrections or anatomical review findings.

## Verification and review artifacts

Run from the project root:

```sh
node --test tests/echo-correspondence-v11.test.mjs tests/echo-v6.test.mjs tests/echo-v6-media-cache.test.mjs
python3 scripts/review-echo-correspondence-v11.py
```

The targeted checks cover all 13 frame bases, exact prepared-vs-reformatted source
coordinates, cap texture indexing, camera/retained-half agreement, preservation
of signed offsets, distinct sweep/missing/different-reference statuses, and
rejection of late prepared images after the plane moves. The native data audit
verifies source-file hashes and exact inverse permutations. The existing cache
and stale-result tests also pass.

- `data-orientation-audit.json`: byte/hash and per-plane findings.
- `tte-correspondence-review.jpg`: original CT, corrected presentation, independent reference poster.
- `tee-correspondence-review.jpg`: the same comparison for TEE.

The report images use scaled native data for visual review. They are not
screenshots of the Site. No browser QA was performed.

## Primary sources

- [ASE comprehensive adult TTE guidance (2019)](https://www.asecho.org/wp-content/uploads/2025/04/2019_Comprehensive-TTE.pdf), imaging protocol and view illustrations.
- [ASE/SCA comprehensive TEE guidance (2013)](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf), Table 10 and view descriptions. The existing angle ranges were checked and retained: ME4C 10–20°, ME2C 80–100°, ME long axis 120–140°, AV short axis 25–45°, bicaval 90–110°, TG 0–20°. These describe typical clinical probe settings, not the CT plane rotation control.
- [Nazerian et al., The Ultrasound Journal (2020)](https://link.springer.com/article/10.1186/s13089-020-00189-0), [annotated Figure 1](https://link.springer.com/article/10.1186/s13089-020-00189-0/figures/1), and supplements 1–5; CC BY 4.0.
- [The POCUS Atlas normal anatomy library](https://www.thepocusatlas.com/normal-cardiac-anatomy), mitral-to-papillary sweep and its source description; CC BY-NC 4.0.
- CardioNetworks / ECHOpedia original media descriptions, retained with permission on Wikimedia Commons, CC BY-SA 3.0: [PLAX](https://commons.wikimedia.org/wiki/File:PLAXnormal_(CardioNetworks_ECHOpedia).webm), [papillary SAX](https://commons.wikimedia.org/wiki/File:SAXPAP_normal_(CardioNetworks_ECHOpedia).webm), [A4C](https://commons.wikimedia.org/wiki/File:A4C_normal_(CardioNetworks_ECHOpedia).webm), [A2C](https://commons.wikimedia.org/wiki/File:A2Cnormal_(CardioNetworks_ECGpedia).avi.webm), [A3C](https://commons.wikimedia.org/wiki/File:A3Cnormal_(CardioNetworks_ECGpedia).avi.webm), [subcostal](https://commons.wikimedia.org/wiki/File:Subcostal_normal_(CardioNetworks_ECHOpedia).webm).

Original movie bytes, frame rates, crops, authors, reuse licenses and source
links are unchanged. Per-recording audit evidence is stored in
`public/assets/echo-media-v6.json`; the historical filename is retained for
compatibility. Keep the source-media credits and license notices with exports.
