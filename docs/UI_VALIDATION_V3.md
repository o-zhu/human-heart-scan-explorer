# Version 3 browser verification

Verified against the complete static application on 4 November 2026.

- Default Porcelain style and cleaned complete-heart volume loaded successfully.
- Anatomy style colored the 3D cutaway and all three orthogonal sections; all six region legend entries were available. Aortic-outflow selection updated the description and dimmed other regions.
- Tissue / space and Anatomy styles worked in the Echo windows module. Cleanup could be toggled off and on. The echo legend emphasized the LV and the unmodified plane retained its 158.8 µm source section.
- Genuine source data streamed successfully for Z section 363 at 79.4 µm. After the cache-header fix, Z section 364 automatically reused cached source data and stayed at 79.4 µm. Section and clip positions matched.
- Moving X/Y crosshairs within the active Z image preserved the same 79.4 µm cut texture and Z plane.
- A complete central X ultra section also streamed and rendered at 79.4 µm. Its larger transfer remained explicitly requested.
- Desktop application framing remained fixed while the inspector scrolled or expanded its anatomical legend.
- JavaScript syntax, physical-coordinate regression checks, and shader compile/link checks passed. Separate native OpenGL ES renders verified the actual scan, mask, anatomical colors and new lighting.

The browser used the software fallback, so the browser checks do not establish performance on every WebGL device. UI screenshots in this directory show actual measured-data rendering.
