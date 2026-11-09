# Atlas cinematic · optional Figure 6A-inspired display

## Paper review

The supplied **Walsh et al., The Human Organ Atlas**, *Science Advances* 12,
eadz2240 (2026), DOI [10.1126/sciadv.adz2240](https://doi.org/10.1126/sciadv.adz2240),
shows Figure 6 on **article page 8**. Its full-heart longitudinal section (6A)
uses a 19.85 µm voxel scan, with anatomical landmarks added as text. The visible
palette combines dark burgundy/brown surfaces, gold/ochre transitions and
ivory/cream cut tissue and rims. Cavities are dark and the illumination is soft.
These observations are from the rendered figure, not inferred from its caption.

The article does **not** publish the heart figure's material classification,
color/opacity transfer-function control points, lighting preset or segmentation
mask. The caption explicitly describes segmentation for the **kidney arterial
tree in Figure 6D**; that sentence is not evidence that the heart colors are
validated chamber labels. Page 6 discusses Gaussian splatting as an advanced
visualization method, but does not identify Figure 6A as a Gaussian-splat scene.
Page 9 describes manual and automated segmentations as a direction for derived
datasets. The data availability statement on page 11 lists the underlying scan
DOIs, including the whole-heart
[10.15151/ESRF-DC-1634390196](https://doi.org/10.15151/ESRF-DC-1634390196).

The directly relevant original heart study provides more implementation detail:
**Brunet et al., Multidimensional Analysis of the Adult Human Heart in Health
and Disease Using Hierarchical Phase-Contrast Tomography**, *Radiology* 312,
e232731 (2024), DOI [10.1148/radiol.232731](https://doi.org/10.1148/radiol.232731).
Its **Data Processing and Analysis** section says the volumes were manually
registered, semiautomatically segmented with bounded region growing in
**VGSTUDIO MAX 3.5.1**, and anatomically rendered in **Cinematic Anatomy VB11A
(Siemens Healthineers)**. Figure 2A further specifies that epicardial fat was
digitally removed by thresholding. This explains the same-heart cinematic
workflow; it does not establish the precise later Figure 6A preset.

The HOA paper's reference 49, **Niedermayr et al., Application of 3D Gaussian
splatting for cinematic anatomy on consumer class devices**,
[arXiv:2404.11285v2](https://arxiv.org/html/2404.11285v2), describes the rendering
family in Sections 3 and 3.2: selected transfer functions, material classes and
clip planes are rendered using Monte Carlo volume path tracing; scattering,
reflection, HDR environmental light and tone mapping produce the source views.
Gaussian splats are then optimized to those rendered views for compact viewing.
That work includes brain, kidney and whole-body examples, not a demonstrated
recipe for the specific heart figure. Its baked appearance also limits subsequent
lighting/transfer-function changes, unlike this viewer's freely adjustable caps.

Primary full texts:

- [HOA paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC12978218/)
- [Original heart study](https://pmc.ncbi.nlm.nih.gov/articles/PMC11303834/)
- [Cinematic anatomy method](https://arxiv.org/html/2404.11285v2)
- [Authors' interactive method demonstration](https://niedermayr.dev/cinematic-gaussians/)

## Implemented interpretation

**Color → Atlas cinematic** is an additional optional choice, appended as palette
ID **6**, key **atlas**. Existing IDs 0–5, Tissue / space's default ID 4, source
windows, thresholds, cleanup and saved settings retain their meanings. Main,
Echo, Probe and TEE color menus offer the choice; shared views restore it.

The new style is a warm, illustrative intensity tint, with independent surface
and cut-face transfers. It does not classify myocardium, collagen, vessels,
valves, fat, clot or chambers. It does not reproduce the authors' unavailable
transfer function or perform cinematic path tracing.

- **Cut faces and CT images:** a continuous monotone-luminance transfer through
  neutral darkness, burgundy, ochre and ivory, after the existing window,
  contrast and soft exposure curve. The same JavaScript transfer drives the
  2D CT views; its GLSL counterpart drives the 3D cap. Original measured pixels
  and ultrasound intensities are unchanged.
- **Surfaces:** local intensity variation is sampled from the already resident
  measured display volume, along the actual surface normal. Two symmetric
  samples at 1.25 resident voxels prevent normal sign or camera orientation
  from changing hue. The maximum of those values and the current surface
  value controls the tint; it is a display convention, not tissue segmentation.
  The geometry, indices, normals and isovalue are unchanged. The 79.4 µm mesh
  and the selected native patch share the same shading function.
- **Lighting:** a warm key, restrained specular highlight and the existing
  bounded local occlusion give depth. The background remains neutral and dark.
  No new texture bank, label file, download, mesh asset or path tracer is loaded.
  Only the selected Atlas surface branch adds two resident GPU texture reads;
  the other palettes retain their old branches.
- **Resolution:** color variation comes from the resident display volume, which
  can be coarser than the active fine/native geometry. This option increases
  tonal separation; it does not increase acquired spatial resolution.

The software fallback implements the same tint and lighting equations. This is
an appearance option, and all existing anatomical-accuracy and source-resolution
qualifications continue to apply.

## Verification

`scripts/atlas-cinematic-v27/render_review.py` compiles the actual production
volume, cap-composite, fine-surface and background shaders in native offscreen
EGL. To keep the verification bounded, it uses the verified v19 detailed mesh
(1,986,313 triangles), which shares the active fine/native fragment shader.
These images review color and lighting; they do not claim to show v27 cleanup
or the active Gentle geometry.

`validation.json` records the source hashes and exact shader hashes. The frozen
prechange shader text in `baseline-shaders.json` comes from restored source
`310ac98b`; it is a regression fixture, not another runtime asset.
`ui-validation.json` records the focused actual-DOM/module tests, including the
shared CT transfer, preserved ultrasound values and bookmark restoration.

- All 256 input intensities, seven palettes and three window/exposure settings
  match JavaScript versus GLSL within one 8-bit channel level.
- The six existing palettes have byte-identical GPU cap transfers.
- All six existing palette IDs remain byte-identical in surface, translucent
  and MIP scalar modes at the tested camera.
- The default fine mesh is byte-identical before/after in whole-heart, cutaway
  and valve-closeup views. Switching Atlas back to Tissue / space restores the
  exact previous output.
- Measured resident and cap arrays retain their original hashes.

The evidence images are `cutaway-comparison.jpg`, `valve-closeup-comparison.jpg`
and `whole-heart-comparison.jpg`. These are production shader renders, not AI
images. No browser frame-rate or clinical-validation claim follows from them.

Reproduce from a checkout containing the verified v19 mesh and source banks:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 scripts/atlas-cinematic-v27/render_review.py
node tests/atlas-cinematic-v27.mjs /path/to/linkedom/esm/index.js
```
