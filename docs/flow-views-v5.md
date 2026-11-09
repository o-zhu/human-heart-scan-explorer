# Chamber flow and valve views — v5

The new **Chambers & valves** module adds eight manually calibrated cutaways through the measured LADAF-2021-17 scan. It shares the existing 3D renderer and offers a source section alongside each view. It does not replace the scan with an illustrative heart model.

## Views and source review

Source coordinates below refer to the 475 × 475 × 530 reference grid at 317.6 µm spacing. Each target defines where the camera looks and where plane adjustments pivot; it is separate from the larger texture frame center.

| View | Intended anatomy | Source target XYZ | Review and limits |
|---|---|---|---|
| RV inflow | Tricuspid region, RV cavity, subvalvular tissue | 232, 186, 298 | Compared longitudinal sections through the open right-heart cavity and thin free wall. Individual leaflets are not named. |
| RV outflow | Muscular outlet, pulmonary root, cusp profiles | 174, 292, 226 | Compared Y260, 275, 290, 305 and X145–190. Y292 preserves fine cusp profiles and outlet continuity. |
| RA inflow | Atrial cavity and preserved caval-side entry | 245, 187, 175 | Compared Y175–225 and X237–310. Vessel ends are truncated; the view does not claim both full cavae are visible. |
| RA outflow | Tricuspid opening from the atrial side | 239.735, 181.275, 289.342 | Fits a plane to 14 previously reviewed hinge landmarks, then offsets it 1.588 mm toward the atrium. Four nearby sections were compared. |
| LV inflow | Mitral region, chordal region, LV myocardium | 290, 273, 288 | Compared X260–335 and Y250–325. The LV lumen is collapsed in this fixed specimen. |
| LV outflow | Aortic cusps, outflow tract, aortomitral region | 260, 265, 270 | Compared source-XY directions of −30°, −10°, +10°, +30°. The +30° plane includes cusp profiles and ventricular continuation. |
| LA inflow | Atrial lining and preserved pulmonary venous entry region | 310, 302, 190 | Compared X300, 310, 320, 330. X310 provides entry-region continuity; all four pulmonary veins are not individually identified. |
| LA outflow | Mitral opening from the atrial side | 306, 272, 262 | Compared oblique levels centered at Z262, 270, 277, 285. The atrial level leaves leaflet/subvalvular tissue behind the plane. |

The tricuspid hinge points depart from their best-fit plane by 1.84 mm RMS. That fit helps choose a useful viewing angle; it is not a measurement of a segmented annulus. All eight views are anatomical starting positions, with the intended structures and limitations stated in the interface. They are separate from the existing TTE/TEE approximation module.

Regional identification was checked against the original dataset and the authors' published source-anatomy/valve figures:

- [Human Organ Atlas complete-heart dataset](https://human-organ-atlas.esrf.fr/datasets/1659197537), DOI 10.15151/ESRF-DC-1634390196.
- [Brunet et al., Radiology 2024](https://pubmed.ncbi.nlm.nih.gov/39012246/), DOI 10.1148/radiol.232731.
- [Authors' 2023 preprint and anatomy figures](https://pmc.ncbi.nlm.nih.gov/articles/PMC10592740/).

The final source sections are in `flow-views-source-review-v5.jpg`. The additional 12 tissue landmarks in `flow-views-landmarks-v5.json` were selected from uncolored source images before viewing the revised segmentation. They provide a small independent regional check, not a whole-heart accuracy estimate.

## High-resolution cut faces

Each preset has its own oblique texture sampled at **79.4 µm** from the existing `s2-clean-display-u8.npy` volume. Sampling uses the source crop origin `[444, 356, 60]`, rather than treating the crop as a new anatomical coordinate system. The source volume is already windowed to an 8-bit display representation, with window `[14640, 23545]` and the existing conservative support cleanup. The oblique reformat uses trilinear interpolation; WebP then preserves every resulting display pixel losslessly. This is not a claim of lossless preservation of the original quantitative 16-bit source.

| Texture | Dimensions | Encoded bytes |
|---|---:|---:|
| RV inflow | 1545 × 2353 | 546,334 |
| RV outflow | 1205 × 2025 | 882,398 |
| RA inflow | 1205 × 2285 | 471,220 |
| RA outflow | 2157 × 2277 | 659,224 |
| LV inflow | 1453 × 2113 | 817,174 |
| LV outflow | 1685 × 2161 | 967,742 |
| LA inflow | 1301 × 2025 | 642,038 |
| LA outflow | 1301 × 1841 | 496,912 |
| **All eight** | **25,481,564 decoded 8-bit pixels** | **5,483,042** |

Encoding reduces these prepared display planes by **78.48%** relative to their decoded 8-bit arrays, with a maximum round-trip pixel error of **zero**. Each download is below 1 MB. Only the selected fine texture is fetched; small thumbnails are separate. Decoded fine planes have an approximately 20 MiB cache budget. The 600 × 600 canvas is a section preview; its size does not reduce the 3D cut-face texture.

The full plane covers the projected conservative source support, not just the small anatomical focus shown in the preview. Plane normal, right/up vectors, dimensions and source target are retained in metadata. The source-to-world mapping is:

```
world XYZ = [(sourceX − 237)/529,
             (sourceZ − 264.5)/529,
             (237 − sourceY)/529]
```

Texture endpoints map to the first and last sampled pixel centers. Plane adjustments rotate about the anatomical target and translate in physical millimeters along the resulting normal.

## Interaction

Each view has **Explore angle**, **Close-up**, and **Face section** camera options. Users can orbit normally, click the section to face it, and scroll the section or move the cut slider to sample adjacent tissue. Plane rotation, tilt, contrast, threshold and cut-side reversal remain available. The default texture remains exact only at its prepared plane. Adjusted planes use the current loaded volume through the existing MPR worker, and their lower source resolution is explicitly shown. **Restore fine plane** returns to the original 79.4 µm cut.

The prepared fine planes use clean support. Turning **Clean scan** off switches the cap to the currently loaded original-volume MPR and labels that resolution; it does not misrepresent the cleaned fine texture as original exterior data. Turning cleanup back on restores the fine texture at an unchanged preset plane. The toggle uses the shared asynchronous `AppearanceController.setCleanupEnabled` method so the original volume can be reloaded correctly.

Style and smoothing controls use the shared renderer. Tissue / space is the application's default; anatomy colors use the current shared segmentation. Source, Gentle and Smooth affect the renderer's surface normals. The measured fine cut-face pixels remain unchanged.

A background low-to-high volume refinement updates sampling but preserves the current Flow camera, including a user's orbit or zoom. MPR workers are created only for adjusted/original-support sections and terminated on leaving the module or replacing the volume. Pending work is versioned so an older result cannot overwrite the active preset.

## Integration contract

Load `flow-views.css` and import `FlowViewsModule` from `flow-views.js`.

```js
const flow = new FlowViewsModule({
  renderer,
  mount: document.querySelector('#flowPanel'),
  onExit: () => switchTab('reconstruction'),
  toast,
  appearance,
});
```

The module creates `#flowViewportMount`. Move the existing `#viewport` into that mount when activating the module; do not create a second WebGL renderer. The host remains responsible for saving/restoring the previous reconstruction or echo state and returning the viewport to its prior mount.

- `init()` loads and validates metadata; idempotent and asynchronous.
- `setVolume(data, meta)` updates the loaded full-source-grid sampling data. It must be called on background refinement and original/clean volume replacement.
- `await enter()` activates the module and applies its view. The host should await it before restoring an externally saved camera.
- `leave()` cancels pending work, removes the active cap and releases the MPR worker.
- `getState()` / `restore(state)` serialize the preset and plane/view controls.
- `reset()` restores the current preset's geometry and camera.
- `updateAppearance()` synchronizes shared palette, cleanup and smoothing UI; call it from the host's appearance callback.
- `destroy()` releases module work and its decoded-texture cache.

The independent `flowPlane(preset, state, longestMm)` export exposes the same geometric transformation used at runtime and in verification. `sampleFlowSection` and `paintFlowSection` separate preview sampling from recoloring. The intensity, support and anatomical-label grid is cached for each plane; a 256-value lookup table per region replaces repeated color allocation and exponentiation in the pixel loop.

## Verification

`python scripts/prepare_flow_views.py` regenerates the eight textures, metadata, source sheet and encoding report from the local source cache. It checks all plane bases for orthonormality and all encoded textures for lossless pixel round trips.

`node scripts/verify_flow_views.mjs` passed all 32 transformed frame checks, exact source/world registration at texture corner/midpoint samples, 79.4 µm pixel spacing, encoded sizes and SHA-256 checksums for all eight assets.

`python scripts/render_flow_views_v5.py` rendered the actual current GLSL with the original reference volume and all eight real cap textures in software EGL. The camera construction matches `FlowViewsModule.positionCamera`. All eight views produced visible tissue and no GL errors. The reviewed contact sheet is `flow-views-gpu-review-v5.jpg`; the accompanying JSON records the shader hash and driver. RV and LV outflow close-ups were pixel-identical between idle and moving flags at the same raster size. These checks establish source registration and rendering behavior, not browser frame-rate claims.

The source review and actual rendered views were inspected visually. Browser interaction validation is left to the host's existing integration workflow; the EGL check does not claim to exercise DOM event wiring.

`node scripts/verify_flow_preview.mjs` compared the optimized section painter with the previous direct loop on decoded real textures and the final `continuity-gated-v5` maps. All **44** full 600 × 600 comparisons were byte-identical, covering all eight presets, both flips, six palettes, cleanup on/off and anatomical emphasis. In this Node CPU microbenchmark, median direct painting took **127.06 ms**, cached recoloring **2.75 ms**, and sampling a new source grid **18.38 ms**. Those figures exclude browser canvas presentation and GPU rendering; the exact-pixel equivalence is the quality gate. The JSON records individual cases. Decoded source-plane arrays for this test are read from `FLOW_PREVIEW_CACHE`, defaulting to `{source-cache}/flow-views-v5`.
