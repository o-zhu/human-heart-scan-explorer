# Data provenance and display processing

## Current scope — v11

The active comparison catalog contains **LADAF-2021-17, LADAF-2020-31,
S-20-29 and S-20-28**. Each displayed heart comes from that donor's own complete
HiP-CT acquisition, with its own source dimensions, physical scale, intensity
window, cleanup support, fine textures and cache namespace. The four previously
integrated **UCL-ZCR-2629, UCL-ZCR-2627, UCL-ZCR-2628 and UCL-ZCR-2337** comparisons
are retired from the active selector. Their acquisition records remain under
`docs/donors/` as historical evidence; they are not alternate source data for any
current donor.

This current section, reviewed **5 November 2026**, supersedes the delivery and
Echo-alignment descriptions in the historical v2–v4 appendix below. In particular,
Ultra is now available for orthogonal sections, prepared oblique views and streamed
oblique reformats; it is not restricted to the older orthogonal-only path.
Checking a reference movie's label does not establish clinical registration of a
CT plane.

### Exact official donor records

Age, sex and medical history below are catalog metadata. They are not inferred
from the rendered heart or replaced by a healthy/control classification. The
latest requested comparison hearts are older adult donors. The complete clinical
entries are preserved verbatim immediately below the table.

| Donor | Official age / sex | Atlas record / DOI | Acquisition | Native sampling | Ultra source sampling |
|---|---|---|---|---|---|
| LADAF-2021-17 | 63 years / male | [1659197537](https://human-organ-atlas.esrf.fr/datasets/1659197537) · [DOI](https://doi.org/10.15151/ESRF-DC-1634390196) | BM18, 2022-04-04 | 19.85 µm | 79.4 µm |
| LADAF-2020-31 | 69 years / female | [1966161627](https://human-organ-atlas.esrf.fr/datasets/1966161627) · [DOI](https://doi.org/10.15151/ESRF-DC-1965462390) | BM18, 2022-04-10 | 19.89 µm | 79.56 µm |
| S-20-29 | 80 years / male | [1773963465](https://human-organ-atlas.esrf.fr/datasets/1773963465) · [DOI](https://doi.org/10.15151/ESRF-DC-1773964017) | BM18, 2022-04-07 | 19.89 µm | 79.56 µm |
| S-20-28 | 84 years / male | [1966162746](https://human-organ-atlas.esrf.fr/datasets/1966162746) · [DOI](https://doi.org/10.15151/ESRF-DC-1966163810) | BM18, 2022-04-04 | 19.85 µm | 79.4 µm |

**LADAF-2021-17 — official `SamplePatient_info`** ([preserved metadata](source-metadata.json)):

> Died from pancreatic cancer | Stomach hypertrophy noticed during autopsy, stomach liquid into the lungs

**LADAF-2020-31 — official `SamplePatient_info`** ([preserved metadata](donors/ladaf-2020-31/source-metadata.json)):

> Type 2 diabetes, pelvic radiation to treat cancer of the uterus, right colectomy (benign lesion on histopathology), bilateral nephrostomy for acute obstructive renal failure, cystectomy, omentectomy and peritoneal carcinoma with occlusive syndrome

**S-20-29 — official `SamplePatient_info`** ([preserved metadata](donors/s-20-29/source-metadata.json)):

> died from Acute right heart failure with extensive Pulmonary artery thrombembolism, diffuse alveolar damage, shock kidneys bilateral with acute kidney failure, and acute liver failure COVID-19 disease | Kidney failure, arterial hypertension, Z.n. Spondylodesis LWK 2 and sacral vertebra 2, SARS-CoV2 infection, symptoms of memory loss and predementia, Dandy-Walker syndrome variant, post-mortem diagnostic.

**S-20-28 — official `SamplePatient_info`** ([preserved metadata](donors/s-20-28/source-metadata.json)):

> died from COVID-19

All four catalogs describe formalin fixation, progressive transfer to 70% ethanol,
vacuum degassing and mounting in crushed agar gel. The shapes are those of preserved,
isolated hearts. Open or narrow cavities in these scans do not establish a living
cardiac phase, a measured chamber volume, or normality. The reviewed S-20-29 and
S-20-28 sections have more open cavities; LADAF-2020-31 has narrower ventricular
spaces relative to its wall in the reviewed sections. Those observations are
qualified in each donor's `morphology-review-v11.json` and do not explain their
cause. See the [LADAF-2020-31](donors/ladaf-2020-31/README.md),
[S-20-29](donors/s-20-29/README.md) and [S-20-28](donors/s-20-28/README.md) records.

The new donor metadata were retrieved from the exact objects in the official
Atlas public catalog on 2026-11-05. Each `source-metadata-provenance.json` records
the catalog bundle digest, official Neuroglancer resource identifier and public
source URL. Full contributor lists remain in the linked source metadata.
The heart data attribution is **Human Organ Atlas Collaboration / ESRF** under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Keep the individual DOI,
contributor records and processing notices with redistributed derivatives.

### Actual source geometry and brightness

Native dimensions describe the source array, not the displayed chamber volume.
The three new sources are N5 pyramids with downsampling factors 1, 2, 4, 8 and 16.
The pipeline uses each pyramid's own resolution and declared array shapes.

| Donor | Actual native source XYZ | Official detailed s4 XYZ | Fine s2 XYZ | Detailed source spacing |
|---|---|---|---|---|
| LADAF-2021-17 | 7,614 × 7,614 × 8,480 | 475 × 475 × 530 | 1,903 × 1,903 × 2,120 | 317.6 µm |
| LADAF-2020-31 | 6,840 × 6,840 × 8,228 | 428 × 428 × 515 | 1,710 × 1,710 × 2,057 | 318.24 µm |
| S-20-29 | 7,639 × 7,639 × 7,771 | 477 × 477 × 486 | 1,909 × 1,909 × 1,943 | 318.24 µm |
| S-20-28 | 7,613 × 7,613 × 8,128 | 476 × 476 × 508 | 1,904 × 1,904 × 2,032 | 317.6 µm |

**LADAF-2020-31 has a catalog discrepancy:** the catalog reports 8,231 native Z
samples, whereas the served N5 s0 array declares 8,228. The pipeline follows the
actual N5 array and records both values. See its
[source metadata provenance](donors/ladaf-2020-31/source-metadata-provenance.json).

Source s4 shapes and final browser grids need not be identical. The new donor
pipeline aligns coarse samples to the fine source's physical voxel centers and
pads up to three empty terminal samples per axis to preserve every acquired fine
sample. It does not stretch the new donor into the original donor's dimensions.
Exact origins, center conventions, output dimensions, padding and source-to-world
mapping are in each `browser-geometry.json`. X/Y/Z remain acquisition axes. The
world mapping is centered physical `[X,Z,-Y]`, normalized by the donor's own longest
center-to-center extent. The original donor retains its historical, recorded
coordinate convention and cropped fine extent.

Browser volumes and textures are **windowed uint8 display derivatives** of the
measured uint16 intensities. Compression is lossless relative to the retained
display bytes; neither the 8-bit window nor an oblique interpolation preserves the
original quantitative uint16 volume. Ultra spacing is four times the native voxel
spacing, not native full resolution. Each orthogonal Ultra image uses fine
in-plane samples; neighboring served sections advance four fine samples.

| Donor | Encoding range, raw uint16 | Default display window, raw-equivalent | Midtone gamma | Cut-face contrast |
|---|---|---|---|---|
| LADAF-2021-17 | 14,640–23,545 | Full encoded range; additional window disabled | 1.0 | 1.8× |
| LADAF-2020-31 | 10,005–22,000 | 12,500–20,500 | 0.9 | 1.0× |
| S-20-29 | 19,300–23,000 | 19,800–21,600 | 0.9 | 1.0× |
| S-20-28 | 14,938–22,708 | 17,100–21,500 | 0.9 | 1.0× |

The three new profiles were compared on their own measured orthogonal sections;
`window-review-v11.json` and `window-comparison-v11.jpg` record that review. These
are display choices. They do not alter the tissue threshold, cleanup support,
physical geometry or acoustic simulation inputs. Their integral encoding windows
use exact linear scaling with nearest-integer, ties-to-even rounding; the
`uint8-quantization-v11.json` records check all 65,536 possible uint16 input values.
Per-asset checksums and sizes in the generated manifests are the authority for a
particular served build.

### Current loading, cleanup and annotation behavior

The small manifest and preview volume form the initial usable path. Whole-volume
refinement follows; optional anatomy, detailed sections and module data do not
need to finish before the first heart can be used. Current requests take priority.
Background preparation yields to user interaction and foreground work, and the
collection bar allows explicit pause/resume. Donor selection loads only the chosen
donor. It does not prefetch the retired donors or all other active hearts.

Cropped **lossless WebP** orthogonal images omit empty surrounding pixels and
restore their source crop offsets when drawn. Whole display volumes use lossless
compressed derivatives with reversible predictors where recorded. Fine arbitrary
Echo/Probe planes use sparse **gzip uint8 bricks**, with 64³ core samples plus a
positive one-voxel interpolation halo. Prepared Echo, comparison and Probe planes
use that donor's fine source data. Adjusting a plane invalidates its exact preset
image; the current plane is reformatted from the fine volume as its bricks become
available. A coarse fallback remains labeled at its actual resolution. The old
s3 JPEG packs and raw-source block downloads in the appendix are historical paths.

Cleanup is a reversible display support mask that hides disconnected mounting
material and debris. For the new donors, the reviewed largest 18-connected tissue
component, a conservative margin and an interpolation guard define support. It is
not chamber segmentation. Original display volumes remain available when cleanup
is disabled. The original donor retains its existing, separately documented mask.

Only LADAF-2021-17 has the earlier **approximate** chamber/vessel region overlay.
Those labels are manually guided annotations, with unresolved boundaries and
unclassified structures. The three replacement donors have **unassigned anatomy**;
no original-donor label grid or anatomical landmark identity is transplanted into
them. Their eight comparison routes and thirteen Echo routes have independent
geometric planes. Surface finish smooths shading normals while preserving the
measured cut-face values; it is not a new anatomical reconstruction or a correction
of unmeasured valve geometry.

### Echo correspondence: reviewed outcomes

The v11 review separates **publisher-verified movie labels** from **CT anatomical
correspondence**. All **12 reference recordings** were checked against their
publisher descriptions. The original donor's **13 prepared CT planes** have
**6 partial correspondence findings and 7 unverified findings**. No frame is
presented as clinically registered or expert-validated. The per-view status,
required structures and remaining checks are visible in Echo windows and recorded
in [the full Echo audit](echo-v11/README.md).

| CT starting planes | v11 finding |
|---|---|
| TTE A4C, A2C, PSAX papillary; TEE ME4C, ME2C, TG papillary | Partial anatomical correspondence; exact valve level, atrial extent, exclusion/inclusion of outflow, or acquisition direction still requires checking |
| TTE PLAX, A3C, PSAX mitral, subcostal; TEE ME long axis, ME AV short axis, bicaval | Clinical correspondence unverified |

The POCUS Atlas mitral PSAX recording is a changing-plane sweep. The Nazerian
transgastric movie is a broader short-axis reference; its exact papillary level is
not asserted. No reusable ME aortic-valve short-axis clip is currently selected,
so that view shows an explicit missing-reference state. Choosing a different
reference movie does not relabel it as a matching view. The CT and movies come
from different people and are not spatially or temporally registered.

Four supported presentation corrections apply to the original donor only: ME4C
is mirrored horizontally; papillary PSAX, transgastric short axis and subcostal
presentation are rotated 180°. Exact pixel permutations and equivalent in-plane
sampling changes keep prepared images, streamed reformats and the 3D cap aligned.
They preserve source image files, pixel values, physical clipping normals and
signed offsets. They do not move a CT section through an unconfirmed valve or
establish a clinical probe position. New donor planes do not inherit these flags,
review findings or clinical structure chips.

The audit uses the [ASE adult TTE guidance](https://www.asecho.org/wp-content/uploads/2025/04/2019_Comprehensive-TTE.pdf),
[ASE/SCA TEE guidance](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf),
the original movie publishers and the annotated figure in
[Nazerian et al. (2020)](https://link.springer.com/article/10.1186/s13089-020-00189-0).
Movie-specific authors, source links and reuse licenses remain in
`public/assets/echo-media-v6.json` and the media credit notices. Those licenses
include CC BY, CC BY-SA and CC BY-NC; the ultrasound collection must not be
assumed to share one blanket data license.

### Probe, skin and chest: three distinct sources of information

The **heart and CT sections** use the selected donor's measured HiP-CT intensities.
The **predicted ultrasound** is a CT-derived, static educational simulation. Its
speckle, attenuation and acoustic appearance are modeled; the source does not
supply measured cardiac motion or validated acoustic parameters.

The **main probe and contact surface** are illustrative. The phased-array probe
and TEE head are original geometric models made for this viewer, with a rounded
acoustic footprint, grip, marker, cable and separate TEE shaft. They are not vendor
CAD or calibrated transducers. The curved skin patch and esophageal-wall guide
constrain interaction locally; neither is the donor's measured skin or esophagus.

The separate **Chest orientation** view uses the official **BodyParts3D** reference
skin, ribs, costal cartilage, sternum, clavicles, thoracic spine and reference heart.
This is adult male reference anatomy, not a reconstruction of any selected donor's
chest. Selected meshes were cropped, simplified, re-normalized and transformed for
display. The reference probe contact is sampled from that reference skin surface.
The chest remains explicitly unregistered to the HiP-CT donor; its bones do not
enter the CT-derived acoustic simulation or create measured bone shadows.

Required attribution: **BodyParts3D, © The Database Center for Life Science licensed
under CC Attribution 4.0 International.** The [official source](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html)
and [official license](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html)
were checked for the v11 asset. Element identifiers, source and derivative hashes,
coordinate transforms and modifications are in
`public/assets/probe-context-v11/manifest.json`; retain the adjacent `LICENSES.md`.
See [Probe Lab v11](probe-lab-v11/README.md) for control semantics and verification.

### Current reproducibility and evidence

The new donor pipeline uses `configs/donors/{slug}.json`,
`scripts/prepare-donor-v10.py` and `scripts/prepare-donor-views-v10.py`; the historical
script suffix does not change the selected v11 source. Each donor README gives its
exact regeneration commands. Keep the fine array immutable while creating the
prepared images and completing source audits. Publish serving objects and their
matching manifests together; a frontend build alone does not populate image or
brick storage.

The evidence is deliberately separated:

- `docs/donors/{slug}/`: official source metadata and pyramid attributes; source
  block hashes; geometry, encoding, cleanup, window and morphology records;
  prepared-plane validation and review images.
- `docs/donor-comparison-v11/`: independent source decoding, physical coordinates,
  window quantization, compression/crop/halo validation and module contracts.
- `docs/echo-v11/`: per-plane clinical correspondence findings, native-data review
  sheets, immutable image hashes and exact presentation-transform checks.
- `docs/probe-lab-v11/`: actual control/DOM checks, unchanged prepared-pose geometry,
  reference asset integrity and native EGL compilation/rendering of its shaders.

These checks establish implementation and data-contract properties within their
recorded scope. They are not clinical validation, population segmentation scores,
measured device performance or browser screenshots. No Site browser QA was
performed for v11. Historical browser checks in the appendix belong to the
versions in which they were recorded.

## Historical v2–v4 processing snapshot

The remainder preserves the original donor's earlier acquisition and processing
record. Its references to “current” mean the v4 implementation at that time.
Older transfer sizes, JPEG presets, orthogonal-only Ultra limits, browser checks
and orientation-confidence statements do **not** describe v11. Use the current
sections above and their linked manifests/audits for the active donor set and
Echo correspondence. These retained records remain useful for reconstructing
older derivatives and explaining the original source geometry.

### Original donor and scan

This viewer uses actual voxels from **LADAF-2021-17, heart**, the **19.85 µm complete-organ scan** acquired at ESRF BM18 on **2022-04-04**. It does not use a generic heart model, a simulated shape, or AI-generated anatomy.

- Dataset: <https://human-organ-atlas.esrf.fr/datasets/1659197537>
- DOI: <https://doi.org/10.15151/ESRF-DC-1634390196>
- Dataset title: *Complete scan at 19.85 um of the heart of the body donor LADAF-2021-17*
- Attribution: Joseph Brunet and colleagues / ESRF Human Organ Atlas. The full author list is retained in `source-metadata.json`.
- Data license: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
- Native catalog dimensions, XYZ: **7,614 × 7,614 × 8,480**, uint16, **19.85 µm** isotropic.

Metadata and volume chunks were retrieved on 2026-11-04. The catalog record and exact official Neuroglancer configuration are preserved in `source-metadata.json` and `source-neuroglancer.json`.

### Public volume source

The exact dataset's official Neuroglancer state points to:

```text
n5://gs://ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/LADAF-2021-17/heart/19.85um_complete-organ_bm18/
```

The publicly readable HTTPS equivalent is:

```text
https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/LADAF-2021-17/heart/19.85um_complete-organ_bm18/
```

The source multiscale group declares five levels, with downsampling factors 1, 2, 4, 8 and 16. The interactive 3D volume uses **s4**, the official factor-16 level, containing the complete scan field at **317.6 µm** spacing. Its declared dimensions are **475 × 475 × 530**. No region of interest was substituted for the complete-organ scan.

The s4 dataset consists of **80** N5 chunks, with a nominal block size of **128 × 128 × 128**. All 80 chunks were successfully retrieved, totaling **128,310,150 compressed bytes**. Each chunk contains a big-endian N5 header followed by a Blosc payload, using Zstandard and bit shuffle. Decompressed uint16 values are big-endian with X as the fastest-changing index. Boundary blocks are padded; padding beyond the source's declared dimensions is removed during assembly. Chunk sizes, dimensions and SHA-256 checksums are retained in `source-chunk-checksums.json`.

### What the browser displays

The full source s4 coordinate extent is retained. Data are never flipped or anatomically rearranged during preprocessing. X, Y and Z refer to **acquisition axes**, not verified anatomical directions.

1. **Intensity mapping.** The official Neuroglancer state uses the window **14,640–23,545**. We linearly map that range to uint8 0–255, clipping values outside it. This is a display derivative; the original uint16 values remain available through the source, and the reproducible processing cache preserves them.
2. **Mounting-container exclusion.** The scan includes a bright circular mounting container. A cylindrical display mask retains every voxel whose XY distance from **(237, 237)** is at most **210 s4 voxels (66.696 mm)**, at all Z positions; other display voxels are zeroed. This geometric exclusion is not an anatomical segmentation. Orthogonal slices were inspected before selecting it. The principal connected tissue component above intensity 18,000 had a maximum XY radius of approximately **175.3 voxels**, giving approximately **34.7 voxels / 11 mm** of extra radius around that component. Thin or disconnected central structures are retained by this geometric exclusion. Anatomical identity is independent of this cylinder; the later optional regional overlay identifies approximate aortic and pulmonary outflow territories.
3. **Detailed level.** The 475 × 475 × 530 display array is stored in nine gzip parts. It totals **41,426,965 compressed bytes**, each part below 5.6 MB. Gzip parts concatenate in the listed order to a uint8 array with X fastest, then Y, then Z.
4. **Fast level.** The display array is Gaussian filtered with sigma **0.5 s4 voxel**, then linearly resampled with `scipy.ndimage.zoom`, preserving first and last voxel centers. Output dimensions are **238 × 238 × 265**; actual XYZ spacing is **[635.2, 635.2, 636.4030303030304] µm**. The small Z difference follows from preserving the source's exact center-to-center extent. This level totals **5,849,116 gzip bytes**. It is labeled approximately 635 µm, not native scan resolution.
5. **Visibility threshold.** The initial interactive display threshold is **0.32** of the mapped range, approximately source intensity **17,490**. The mounting medium is predominantly around 16,500. Threshold and opacity controls affect appearance; they do not establish a validated biological tissue classification.

The s4 full voxel extent is **[150,860, 150,860, 168,328] µm**; its first-to-last-voxel-center extent is **[150,542.4, 150,542.4, 168,010.4] µm**. Both browser levels preserve that center extent. The official N5 pyramid itself has rounded-down XY dimensions relative to the catalog native dimensions; the application does not recover the boundary subvoxels absent from that source pyramid level.

The base intensity volumes are not anatomically segmented. Version 3 introduced separate reversible cleanup and approximate regional anatomy maps. Version 4 refines the regional boundaries, as described below; individual valves and small vessels remain unsegmented. No unobserved structure is reconstructed. The native source remains the route to finer detail and original uint16 intensities. The viewer is an exploratory visualization, not a clinically validated diagnostic product.

### Historical v2/v3: s3 orthogonal JPEG textures

This orthogonal image pack was replaced by the hosted s2-derived pack in v4. The source s3 volume remains in use for the unchanged echo preset textures and anatomical review. The following sizes and compression errors describe the historical JPEG pack.

The additional source is official **N5 s3**, factor 8, uint16, **951 × 951 × 1060 XYZ**, at **158.8 µm** isotropic spacing. All **576 chunks (8 × 8 × 9)** were downloaded and decoded, totaling approximately **1.012 GB compressed**. The unwindowed assembled array is stored as ZYX uint16. `s3-attributes.json`, `s3-volume-summary.json`, and `s3-chunk-provenance.json` record source shape, decoding, and chunk hashes.

The source is cropped to **949 × 949 × 1059 XYZ**, starting at source index zero. This aligns the first/last voxel centers with the existing s4 display coordinate convention: **[150542.4,150542.4,168010.4] µm**. Orthogonal output index `i` samples s3 index `2*i`, producing **475 X, 475 Y, and 530 Z images**. Sampling within each image remains 158.8 µm; adjacent section positions are 317.6 µm apart. X and Y images are 949 × 1059 pixels; Z images are 949 × 949. X images have increasing Y columns and Z rows; Y images have increasing X columns and Z rows; Z images have increasing X columns and Y rows. No flips are introduced during encoding.

Normalization uses the same source window **[14640,23545]**, rounding to uint8. The equivalent mounting-container mask has XY center **[474,474]**, radius **420 s3 voxels**, and all cropped Z positions. Images are **single-channel grayscale JPEG quality 92**, with no sharpening or synthesized texture. The **1,480 images total 197,508,157 bytes**. They were fetched as needed rather than as one volume at startup.

JPEG makes these display derivatives lossy. Representative nonempty orthogonal images showed mean absolute compression errors of approximately **0.85–1.36 display levels out of 255**, with maximum errors up to 20 in the checked images. Three representative ventricular-region intensity masks showed MAE **2.33–2.37/255** and a 95th-percentile absolute error of **6/255**; the ROI definition and per-image results are in `section-quality-validation.json`. The central X image was visually reviewed after encoding. This is compression validation, not a biological accuracy measure. Neither the 8-bit window nor JPEG preserves the original quantitative uint16 data. The browser maps each section texture onto its clipping plane independently of surface lighting, retaining measured myocardial intensity variation. The historical manifest is `dist/assets/sections/manifest.json` in the v2/v3 source revisions; image hashes are retained in `section-assets-checksums.json`.

For exact mapping of image endpoints to physical voxel centers, normalized physical coordinate `p` becomes texture coordinate `(p*(imageSize-1)+0.5)/imageSize`. The linked X/Y/Z controls use one selected slice position for both the section and its 3D clipping plane; clicking a section aligns the camera with that plane, and scrolling advances both.

### Echo reference planes: introduced in v2, retained in v4

The module offers **12 views, with 13 stored frames** because PSAX has mitral and papillary levels. Frames are manually calibrated educational starting planes in this fixed specimen. The s4 source-to-world convention is `[(x-237)/529,(z-264.5)/529,(237-y)/529]`; world extent is `[474/529,1,474/529]`, and one world unit is **168.0104 mm**. Each orthonormal frame contains center, right, up, and normal vectors, with `normal=cross(right,up)`.

For the **13 unmodified presets**, the s3 display volume is trilinearly sampled into static JPEG quality-95 textures, totaling **2,410,077 bytes**. Pixel centers span both physical endpoints of the plane: columns from `-width/2` to `+width/2`, rows from `+height/2` to `-height/2`. Long-axis images are **763 × 1006** or **1006 × 763**; square images are **763 × 763**. Integer image dimensions produce actual spacings of approximately **158.750 and 158.816 µm**; each image's exact values appear in `public/assets/echo-textures/manifest.json`. `provenance.json` records the geometry-file hash, source mapping, compression, and checks.

After offset, rotation, or tilt changes, live MPR samples the currently loaded 3D volume: **317.6 µm in Detailed mode**, or approximately **635 µm in Fast mode**. The browser labels the source resolution. Resetting restores the high-detail static plane. Output pixel count does not imply finer measured resolution than that source. Contrast and retained-side changes do not create new anatomical information.

The LV axis, regional apex/base, and ventricular relationship were visually reviewed; they are not clinical measurements or segmented landmarks. Apical TTE frames place the apex upward; midesophageal frames place the base/atria upward. The preserved LV lumen is slit-like/collapsed. The source study and later regional review now support an **approximate aortic-root identity and location**. This does not validate or change the existing aortic-valve/outflow preset geometry. Those frames and the bicaval frame still require manual refinement; caval continuity has not been verified. Reference structure names describe the expected clinical view, not automatically verified anatomy in every preset. The regional color overlay does not establish precise chamber or valve boundaries.

There is no patient/probe coordinate registration, ultrasound echo synthesis, acoustic propagation model, Doppler, probe-motion simulation, or cardiac-cycle simulation. Probe angle ranges are reference labels, independent of CT-plane rotation. These planes are exploratory educational aids and have not undergone clinical validation.

Primary view references, also linked by `public/echo.js`:

- [American Society of Echocardiography: comprehensive adult TTE guidance, 2019](https://www.asecho.org/wp-content/uploads/2019/01/2019_Comprehensive-TTE.pdf).
- [American Society of Echocardiography / Society of Cardiovascular Anesthesiologists: comprehensive TEE guidance, 2013](https://www.asecho.org/wp-content/uploads/2025/04/2013_Performing-Comprehensive-TEE.pdf).

### Display cleanup and material styles: introduced in v3, retained in v4

The **Clean scan** option applies a separate spatial support mask at rendering time. It does not overwrite or smooth the packaged 3D density volumes. In v4, hosted orthogonal texture preparation also applies this existing support offline, as documented below; that exterior exclusion is permanent in those image files. The mask is derived from the original s4 uint16 values, thresholded at **17,490**, inside the existing mounting-container cylinder. The largest **18-connected component** is retained, then expanded by **three s4 Manhattan voxels**. A one-voxel maximum-filter guard protects that support during nearest-neighbor resampling to **238 × 238 × 265 XYZ**, with the same physical endpoints as s4.

The compact mask retains **all 8,228,877 voxels** of the selected source-connected core. There are 4,757 other component candidates at the core threshold, but nearby candidates can remain inside the support margin; this must not be reported as 4,757 objects removed. At a 28% display threshold the mask excludes **118,353 visible source voxels (1.275%)**; at 32% it excludes **7,389 (0.0896%)**. These are display-exclusion counts, not a validated debris-classification accuracy. `public/assets/cleanup/manifest.json` contains the registration, all checked thresholds, and compressed checksum. The uint8 mask has **15,010,660 decoded bytes** and **129,177 gzip bytes**.

Clean scan is enabled by default. Both renderers apply it to surfaces, volumetric samples, and cut-face texture samples. Disabling it restores the original packaged 3D-volume visibility, including retained detached fragments; the original geometric mounting-container exclusion remains. Attached debris, nearby debris inside the margin, and artifacts within retained tissue can remain. The mask does not fill cavities or reconstruct tissue. Hosted Ultra and its derived Detail textures retain their offline exterior-support restriction, which is not reversed by this toggle. The source atlas provides the unfiltered scan.

**Porcelain** uses warm ivory tissue and cool shading; **Tissue / space** uses a darker background, stronger cut-face contrast and dimmer recessed surfaces; **Anatomy colors** tints observed tissue using the separate regional labels. Unclassified tissue remains neutral. Selecting a label dims other tissue without deleting it. These colors describe display choices, not measured tissue color or a histologic stain.

For the new styles, stable Surface renders use an isotropic edge-averaged gradient to reduce voxel-related normal banding. This changes lighting normals, not density values, silhouettes, surface-intersection locations or the higher-resolution cut-face samples. Interactive frames retain the faster normal estimator. The GPU also uses a consistent background transfer for rays outside the scan box and empty rays inside it. See [RENDERING_V3.md](RENDERING_V3.md) for renderer contracts, review images and verification.

### Version 4: source-guided anatomical tissue territories

The optional color layer labels **LV, RV, LA, RA, aortic outflow and pulmonary outflow**, with ID 0 reserved for unclassified tissue. It is a manually guided regional segmentation of the actual source scan. The endpoint-aligned grid is **317 × 317 × 354 XYZ**, uint8 with X fastest, at approximately **476 µm** label spacing. The map has **35,573,106 decoded bytes**, **334,512 gzip bytes**, and decoded SHA-256 `da36ab4d08bf0c114d4e5b44dfaaa4e4abad7a48680b863bd455b45a5b57d64d`.

The working source is interpolated onto the label grid and Gaussian filtered with sigma **0.35 label voxel for labeling only**. A 17,500 intensity threshold and the principal connected component establish measured tissue support. The final colors do not alter the density volume or its high-resolution intensity textures. Observed low-density cavity components and manually reviewed paths identify basal atrial and outflow regions.

The two conspicuous v3 boundary failures are replaced by source-guided surfaces:

1. **LV myocardial envelope.** Twenty-two manually reviewed contours follow the compact myocardial body in original 158.8 µm source sections. Periodic cubic curves describe each section, and shape-preserving interpolation of signed distances connects them along the heart. The LV envelope takes priority over nearest-cavity propagation, preserving continuous compact septal myocardium and the reviewed outer free wall. The compact interventricular septum is shared anatomy and is colored with the LV under an explicit display convention; this is not an expert separation of LV and RV myocardial layers.
2. **RA–RV junction.** Seven free-wall hinges, seven septal hinges, and seven outer-groove observations define a curved tricuspid transition. Shape-preserving tracks across source X and a bounded smooth surface across source Y follow the observed junction. For example, at source X=237 the approximate free-wall attachment is near Y=140, Z=324, while the septal attachment is near Y=237, Z=268. Off-axis end caps constrain extrapolation. These are reviewed regional landmarks, not clinical annular measurements.
3. **Bounded regional propagation.** Remaining identities use actual cavity observations and reviewed anatomical tracks. Fixed axial chamber cutoffs are removed. Right-heart propagation is limited to 9.528 mm to avoid coloring distant apical vascular/pericardial tissue as RV; small disconnected assignments remain neutral.

The label grid is finer than v3's approximately 635 µm grid, reducing categorical stair steps without claiming finer source intensity resolution. Categorical IDs are sampled with nearest-neighbor lookup; their numeric values are not linearly interpolated. The method does not compute fiber tractography, train a segmentation model, or synthesize tissue geometry.

For historical comparison, v3 used nearest-cavity assignment with fixed per-region bounds on a **238 × 238 × 265** grid. Its map had **15,010,660 decoded bytes**, **164,935 gzip bytes**, and decoded SHA-256 `b30acbf76f76387761c69e1ac4f90e2650305b0aa4e0117503d338394adb7efe`. Those values identify the superseded map, not the current labels.

The [original study's labeled control-heart Figure 3](https://pmc.ncbi.nlm.nih.gov/articles/PMC10592740/) provides source support for the basal identities. Exchanging displayed X/Y axes in source Z≈220 produces closely matching RA, LA, aortic-sinus and pulmonary-trunk morphology. Figure 5 supports the LV–aortic outflow relationship. The final study is [Brunet et al., Radiology 2024;312(1):e232731](https://doi.org/10.1148/radiol.232731). Matching these structures is qualitative anatomical evidence, not a validated spatial registration or measured segmentation accuracy.

The color layer is applied **only where the independent density renderer observes tissue**. It must not be displayed as solid blood-pool contents. Mitral, outflow, atrial-appendage, septal-layer, and distal vascular boundaries remain approximate; LA transitions are especially provisional. Coronary arteries, cardiac veins, individual pulmonary veins and caval veins are not individually segmented. Nearby tissue can inherit a regional color without becoming an individually annotated vessel. These labels must not be used for chamber-volume, wall-thickness, procedural or diagnostic measurements.

`public/assets/anatomy/manifest.json` records the contour and hinge inputs, cavity tracks, physical registration, method parameters, palette, review anchors, and limitations. [anatomy/README.md](anatomy/README.md) provides the source comparison and axial/long-axis review figures. The cropped published figure within `anatomy-reference-comparison.jpg` is attributed to Brunet et al., 2023 preprint, **CC BY-NC 4.0**; the scan-derived review images and labels follow the source dataset's **CC BY 4.0** license.

### Version 4: hosted lossless 79.4 µm orthogonal sections

Current Ultra images use official **N5 s2**, factor 4, **1903 × 1903 × 2120 XYZ**, uint16 big endian, at **79.4 µm** source sampling. Source chunks are 128³ voxels with Blosc/Zstandard/bitshuffle compression. Offline preparation downloaded **832 supported source chunks**, totaling **2,539,278,542 compressed bytes**, and losslessly decoded them with Python `blosc2`. The original source blocks are no longer fetched by ordinary browser section viewing.

Viewer section `i` selects exact s2 source plane **`4*i`**. The full pixel-center extent is **1897 × 1897 × 2117 XYZ**, preserving the s4 first and last physical centers. Before per-image cropping, X and Y planes are 1897 × 2117 pixels and Z planes are 1897 × 1897. X uses Y columns/Z rows, Y uses X columns/Z rows, and Z uses X columns/Y rows. Plane steps remain **317.6 µm**; in-plane sampling is 79.4 µm. No image flips, in-plane upsampling, or sharpening are applied.

#### Exterior support and exact compression

The source-brick inventory is the union of the established conservative support plan in `public/assets/ultra-support.json`. That plan was generated from the source-connected component plus **five s4 Manhattan voxels**, including adjacent ±1 s4 planes when constructing each request list. Unfetched exterior bricks remain zero in the preprocessing array.

Within the fetched source, the established endpoint-aligned cleanup support is sampled at each original s2 coordinate. Values outside it are zeroed. Values inside it use exactly the existing linear source window **[14640,23545]**, rounded and clipped to uint8. No rendering-threshold cutoff is applied during encoding; all retained low-intensity values remain available when the interactive threshold changes. This is a retained-heart display, not an unfiltered full-scanner slice. Turning off Clean scan does not restore exterior pixels omitted by preprocessing in either Ultra or its derived Detail image; the independent packaged 3D volume still supports that visibility toggle.

Empty margins are cropped while retaining each crop's original image-coordinate origin. Origins are even, dimensions are odd, and a small zero-valued guard protects the retained edge. Cropping removes **78.56%** of the full-frame pixel inventory across all positions. Crops are mapped to their original physical coordinates in both the 2D cards and 3D cut face; they are never stretched across the scan extent.

Images are encoded with **lossless WebP**, with no additional intensity quantization, spatial filtering, or synthesized detail. Encoder `lossless=True`, `quality=75`, and `method=4` are explicit. In lossless mode, the quality argument controls compression effort, not lossy image fidelity. Every nonempty image was decoded and compared byte-for-byte against its pre-compression source-display pixels: **maximum compression error is zero**. This equality applies to the windowed 8-bit display, not to a quantitative uint16 export.

The optional 158.8 µm Detail view reads exact alternate rows and columns from the same image. It has the same physical endpoints and through-plane positions and does not need a second fetch. It is an s2-derived display rather than the historically independent, averaged s3 JPEG pack.

#### Inventory, delivery, and cache

All **1,480 positions** are covered: **1,096 nonempty images** and **384 empty positions**. Empty positions use a shared one-pixel zero representation and generate no image request. The unique compressed asset pack totals **507,669,076 bytes**. Nonempty image sizes are:

| Statistic | Exact encoded bytes |
| --- | ---: |
| Median | 470,913 |
| 95th percentile | 886,844.5 |
| Maximum | 956,458 |

Every nonempty image is smaller than 1,000,000 bytes. The complete pack is tracked as source under `data/ultra-sections/` and stored in R2 for delivery through the existing Site origin at `/api/ultra/v4/`. The frontend deployment contains its manifest at `public/assets/ultra-sections/manifest.json`, including crop coordinates, encoded sizes, encoded SHA-256, and decoded-pixel SHA-256. The whole pack is not downloaded at startup and is excluded from the generated deployment bundle.

| Plane | Historical v3 raw-N5 transfer estimate | Current exact image size | Reduction |
| --- | ---: | ---: | ---: |
| X237 | 332.35 MB | 842,946 B | 99.75% |
| Y237 | 337.45 MB | 908,334 B | 99.73% |
| Z363 | 52.70 MB | 513,858 B | 99.02% |
| Z400 | 38.25 MB | 394,014 B | 98.97% |

The historical numbers are planner estimates, not connection-speed measurements. The new values are measured encoded bytes. The reduced transfer comes from serving the requested 2D plane rather than its surrounding 3D bricks, cropping empty margins, and losslessly compressing the retained image.

Ultra is the default cut-face detail and loads automatically after section scrolling settles. `public/hosted-ultra.js` and `public/section-detail.js` share each image fetch and decode. Full-resolution grayscale caching is bounded to **48 MiB**; derived Detail caching is bounded to **12 MiB / 18 images**. Transient decoding bitmaps are closed. These limits do not include the loaded 3D volume, renderer textures, or canvases. Stale requests cannot overwrite a newly selected plane; a small shared image transfer may finish for a card/cache after its cap request is cancelled. Failures preserve the currently available display and expose Retry. No raw-N5 fallback starts automatically.

Ultra remains **orthogonal only**. Whole-organ reconstruction stays at 317.6/~635 µm, echo presets retain 158.8 µm textures, and freely adjusted echo planes sample the currently loaded volume. Native 19.85 µm detail remains available through the source atlas.

#### Historical v3 browser decoding evidence

Version 3 loaded Ultra explicitly using **Load this cut** and decoded public N5 source blocks in a Web Worker using the vendored MIT-licensed `numcodecs@0.3.2` Blosc codec. It used HTTP ranges to fetch the needed subsets of ordinary bricks, each containing four independently compressed 1 MiB blocks spanning 32 source Z planes. Its fallback handled nonstandard layouts and servers returning complete chunks. These mechanisms and their substantial per-plane transfers describe the superseded implementation, not the current hosted-image path.

Historical worker limits were 64 MiB decoded blocks, 12 MiB recent compressed bytes, 128 MiB reusable compressed browser storage, and six completed sections. `ultra-decoder-validation.json` preserves the independent checks: two actual source bricks and all eight separately ranged blocks matched Python `blosc2` bytes exactly. Asymmetric numeric-volume checks verified plane indexing, byte order, orientation, source windowing, and physical endpoints. The recorded cache/range harness verified neighboring-plane and cross-axis reuse. These records remain useful source-decoder evidence, but their loading controls, public-source connectivity requirement, cache sizes, and transfer estimates are not current viewer behavior.

[ULTRA_DETAIL.md](ULTRA_DETAIL.md), `hosted-ultra-validation.json`, and `hosted-ultra-compression.png` document the current delivery and exact-pixel checks. `hosted-ultra-codec-benchmark.json` records evaluated alternatives; production uses lossless encoding. The earlier `ultra-detail-comparison.png` compares measured s3 and s2 myocardial detail with the same window and no sharpening.

### Echo metadata history

Version 3 revised only explanatory anatomy/confidence strings in `echo-planes.json` and `echo-textures.json`: aortic-root identity is now supported approximately by the source comparison, while existing AV/outflow preset geometry remains unvalidated. **All 597 numeric/null leaves in the frame file and all 260 numeric/null leaves in the texture-index file were preserved.** No frame coordinates or echo texture pixels were regenerated. The original texture-generation provenance hash records the frame file used when those textures were produced; later explanatory-string changes do not change the sampled plane geometry.

### Reproduce the assets

From the project root, using Python 3.10 or newer, prepare the base source volumes and existing support:

```bash
python -m pip install -r scripts/requirements-volume.txt
python scripts/download-n5.py --cache .cache/hoa-heart
python scripts/prepare-volume.py --cache .cache/hoa-heart --output public/assets
python scripts/prepare_cleanup.py --volume .cache/hoa-heart/s4-volume-u16.npy --output public/assets/cleanup --support-output public/assets/ultra-support.json
python scripts/download_s3.py --data-root .cache/hoa-heart
python scripts/assemble_s3.py --data-root .cache/hoa-heart
python scripts/prepare_anatomy.py --volume .cache/hoa-heart/s4-volume-u16.npy --review-volume .cache/hoa-heart/s3-volume-u16.npy --work-dir .cache/anatomy-work --output public/assets/anatomy --review-output docs/anatomy
```

Prepare the current hosted orthogonal images and copy their small manifest into the public assets:

```bash
python scripts/download_s2.py --data-root .cache/hoa-heart --support public/assets/ultra-support.json --workers 16
python scripts/prepare_hosted_sections.py --data-root .cache/hoa-heart --support public/assets/cleanup/heart-support.raw.gz --output data/ultra-sections --codec webp --lossless --quant-step 1 --quality 75 --method 4 --asset-base /api/ultra/v4/ --workers 4
mkdir -p public/assets/ultra-sections
cp data/ultra-sections/manifest.json public/assets/ultra-sections/manifest.json
python scripts/verify-hosted-sections.py --assets data/ultra-sections --manifest public/assets/ultra-sections/manifest.json --data-root .cache/hoa-heart --support public/assets/cleanup/heart-support.raw.gz
```

The verified objects must be available to the Site's R2 image-serving route before publishing the corresponding interface. The local source pack is a reproducible cache under `data/`; the durable image objects are stored in R2, and both the cache and image bodies are excluded from the deployment bundle. The checked-in manifests record every encoded and decoded checksum. Building the frontend alone does not populate object storage. Use the existing Sites dependency/build wrappers and the established source-helper/publication workflow, preserving Site identity, storage binding, and audience. `public/` and `page.html` are source; `dist/` is generated Vinext output.

To reproduce the separately retained echo textures:

```bash
python scripts/calibrate_echo_planes.py --volume .cache/hoa-heart/s4-volume-u16.npy --output .cache/echo-geometry
python scripts/prepare_echo_textures.py --data-root .cache/hoa-heart --frames .cache/echo-geometry/echo-planes.json --output public/assets/echo-textures
```

The geometry generator writes `echo-planes.json` and a review contact sheet in its `--output` directory. The application consumes the reviewed frame JSON at `public/assets/echo-planes.json`; replace a reviewed frame file only together with its matching regenerated echo textures. Calibration reproduces recorded manually selected landmarks and numerical frames; it does not automatically identify anatomy. Preserve the later v3 explanatory-note revisions when replacing application metadata. The echo generator is not a recalibration against the newer regional labels. It rebuilds its s3 display cache when needed, without requiring the historical orthogonal JPEG pack.

The s3 tools accept `--data-root`. The original s4 tools use `--cache`. Current s2 tools also accept `--data-root`; the downloader is resumable and keeps source-brick checksums. The s2 preprocessing volume has a 15.35 GB apparent uint16 file length, with unfetched background represented sparsely when supported by the filesystem; source-chunk, display-cache, and generated-image files add further disk use. Allow several GB of working memory and approximately 30 GB of working disk when regenerating all source levels. No volume reconstruction or N5 decoding is performed by the image-serving route at runtime.

`requirements-volume.txt` includes NumPy, SciPy, Blosc2, and Pillow. Production encoding requires Pillow's WebP support. Reproduction writes display derivatives; retain attribution and processing records when redistributing them under CC BY 4.0. Application code licensing is separate from the data license. Preserve third-party notices for any historical codec implementation retained in the source.

### Validation evidence and limits

Source and display-array counts/checksums were checked. First/middle/last orthogonal sections were decoded; their dimensions and first/last physical center alignment passed. The oblique generator checked every frame's orthonormal basis and mapped center against the s4 landmark coordinates, then decoded the JPEGs to measure display error. Visual review confirmed the intended apical and midesophageal orientation.

Updated shaders compiled and linked in EGL/OpenGL ES 3, and actual source-data cutaways with detailed cap textures were rendered there. The browser's software fallback was tested, including linked section and echo interactions. The QA browser does not expose WebGL 2, so direct hardware-accelerated browser behavior remains device-dependent.

`node scripts/verify-geometry.mjs` exercises source/world transformations, X/Y/Z camera alignment and clipping orientation, all 13 plane bases, physical offsets, and asymmetric-phantom MPR pixel orientation. Python script portability changes were checked with `py_compile`; they did not trigger another source download or asset regeneration.


Version-3 cleanup checks confirmed preservation of the entire selected source core after compact-grid resampling. The historical v3 anatomy map reproduced its recorded checksum and correctly mapped six reviewed tissue anchors; those checks did not establish its boundary accuracy. Version 4 adds same-source central X237, off-axis X/Y, and multi-level axial review. Twenty independently selected tissue-point regressions improved from 5/20 matches in the prior map to 20/20 in the revision; six additional outer-wall refinement checks also pass. These are targeted checks of the reported failures, not a Dice score or population segmentation accuracy. `anatomy/boundary-validation.json` records their selection and qualifications.

Current hosted-image verification checks all 1,097 unique assets: exact encoded byte length and SHA-256, decoded-pixel SHA-256, crop bounds, and alternate-pixel physical-coordinate agreement. Every nonempty image is below 1,000,000 bytes and every compression round trip has zero pixel error. Thirteen additional comparisons span the original prepared X/Y/Z source arrays. `hosted-ultra-validation.json` records the results and transfer-size comparisons; `hosted-ultra-compression.png` displays an unchanged myocardial patch and its zero difference image.

Updated style/cleanup/anatomy shaders rendered actual source data in EGL/OpenGL ES 3 with no GL error, and software-worker checks preserved the source-array checksum and verified first-surface/cut-face picking. Historical v3 source-worker decoding and cache/range evidence remain in `ultra-decoder-validation.json` and are distinguished above from the current hosted loading path. Relevant evidence is in RENDERING_V3.md, ULTRA_DETAIL.md, and the anatomy review directory. Browser/device performance and clinical segmentation accuracy are not established by these checks.
