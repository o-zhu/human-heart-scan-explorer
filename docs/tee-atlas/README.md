# Heart Explorer — TEE view artwork

## Current reference-guided illustrations

The atlas uses 28 individually generated ChatGPT Image illustrations, one for each ASE/SCA 2013 Table 10 target. Each image was guided by its own first-column anatomical schematic from the supplied PDF. The four-chamber pilot provides a shared visual style: restrained terracotta myocardium, ivory endocardial and valve edges, dark blood spaces, and a thin sage ultrasound-sector boundary. Text and acquisition angles remain HTML so generated lettering cannot alter factual labels.

`public/assets/tee-atlas/art-v2/` holds the optimized transparent WebP assets. `TEE_ATLAS_VIEWS[].illustration` is their public mapping; the Echo atlas and TEE lab share it. The enlarged Illustration dialog uses the same high-resolution asset. The sidebar remains the same width, with larger thumbnails inside each card; the comparison panes retain their area.

`artwork-v2.json` records the source page and crop, per-view prompts, source and output hashes, dimensions, byte counts, and review notes. The input schematics are embedded raster images in Table 10, not source vectors. Generated contours are illustrative reinterpretations and are not exact tracings, segmented patient anatomy, synthetic ultrasound, or a clinically validated geometry model. The pulmonary-vein artwork follows the paper's representative schematic; the acquisition text and real cine cover separate vein acquisitions.

Artwork review compared each image with its own reference for gross topology, orientation, distinct view identity, extraneous markings, and thumbnail readability. It is not clinical validation. The actual ultrasound examples, probe parameters, and CT geometry are maintained separately from this artwork.

## Original vector fallback

28 original SVG teaching diagrams for the ASE/SCA 2013 comprehensive examination, Table 10: 15 midesophageal, 9 transgastric, and 4 aortic views. Each SVG has a 220×150 viewBox, descriptive title/description, and original vector geometry.

### Integration

Copy the 28 SVG files to `public/assets/tee-atlas/diagrams/`. `manifest.json` maps canonical view IDs, ordering, labels, and intended public paths. Legacy IDs are preserved. The Python generator is the editable source.

### Original vector conventions

Coral = left heart; cyan = right heart; amber = aorta. Chamber labels and a few distinguishing structures provide navigation recognition. The cartoons use simplified standard echo display relationships, not measured patient geometry or synthetic ultrasound. Multi-plane positioning varies with anatomy; the view definition comes from structures visible in the plane. The pulmonary-vein card intentionally shows separate right/left panels.

## Source and attribution

Anatomical targets and standard view names follow Hahn et al., Guidelines for Performing a Comprehensive Transesophageal Echocardiographic Examination, JASE 2013;26:921–964, Table 10. DOI: 10.1016/j.echo.2013.07.009.

https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf

The original SVGs are newly authored schematic artwork. The current AI-assisted illustrations are based on individual source schematics from the user-supplied guideline and retain that attribution; no open license is asserted for the guideline figures. Both sets are educational navigation aids, not standalone clinical acquisition or diagnostic references.
