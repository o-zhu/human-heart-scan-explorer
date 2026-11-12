# Third-party notices

The root [MIT License](LICENSE) applies to original project code and original documentation. It does not relicense third-party code, scans, anatomy, media, or their derivatives. A permitted screenshot may still carry the licenses of the data/media visible within it. Preserve source credits and identify modifications.

## Human Organ Atlas / ESRF

The three active measured preserved-heart datasets are licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Credit the individual dataset creators and **Human Organ Atlas Collaboration / ESRF**:

- **LADAF-2021-17:** Joseph Brunet, Andrew C. Cook, Claire L. Walsh, and colleagues. [Dataset DOI 10.15151/ESRF-DC-1634390196](https://doi.org/10.15151/ESRF-DC-1634390196); [source record](https://human-organ-atlas.esrf.fr/datasets/1659197537).
- **S-20-29:** Claire L. Walsh, Joseph Brunet, C. Berruyer, and colleagues. [Dataset DOI 10.15151/ESRF-DC-1773964017](https://doi.org/10.15151/ESRF-DC-1773964017); [source record](https://human-organ-atlas.esrf.fr/datasets/1773963465).
- **S-20-28:** Joseph Brunet, Andrew C. Cook, Claire L. Walsh, and colleagues. [Dataset DOI 10.15151/ESRF-DC-1966163810](https://doi.org/10.15151/ESRF-DC-1966163810); [source record](https://human-organ-atlas.esrf.fr/datasets/1966162746).

Retain the source record’s complete creator list when making a formal dataset citation. Included/restored arrays, meshes, masks, labels, and CT textures are modified display derivatives. Depending on the family, processing includes windowing, cropping, conservative support masking, surface extraction, smoothing/reduction, reviewed display exclusions, annotation, or compression. The applicable manifests and `docs/` records describe the exact transformations and limitations. The source creators do not endorse this application.

## BodyParts3D

**BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.**

[Official source and terms](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html); [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The derivative under `public/assets/probe-context-v11/` contains selected reference skin, thoracic bones/cartilage, and historical reference anatomy. Changes include cropping, mesh reduction, normal calculation, and coordinate transforms. Active context also uses documented illustrative donor-specific fittings. Retain its adjacent `LICENSES.md` and manifest with source element IDs, archive hash, and changes. It is not donor-registered anatomy. Original instrument geometry is separately authored project material, not manufacturer CAD.

## Reusable local echocardiography media

### CardioNetworks / ECHOpedia

Identified CardioNetworks-derived files are credited to **CardioNetworks: Vdbilt (I. A. C. van der Bilt, MD)** and retain [Creative Commons Attribution-ShareAlike 3.0 Unported](https://creativecommons.org/licenses/by-sa/3.0/). Adapted clips and posters remain under that license. Their inclusion does not relicense the independent application code.

The five normal TTE replacements in `public/assets/echo-media-v7/` and the separately sourced historical A3C example have distinct provenance. Do not infer the rights of old `echo-media-v6/` files from a later catalog that reused their logical view names. The exact asset inventory determines which files are included.

Original records: [PLAX](https://commons.wikimedia.org/wiki/File:PLAXnormal_(CardioNetworks_ECHOpedia).webm), [papillary short axis](https://commons.wikimedia.org/wiki/File:SAXPAP_normal_(CardioNetworks_ECHOpedia).webm), [A4C](https://commons.wikimedia.org/wiki/File:A4C_normal_(CardioNetworks_ECHOpedia).webm), [A2C](https://commons.wikimedia.org/wiki/File:A2Cnormal_(CardioNetworks_ECGpedia).avi.webm), [A3C](https://commons.wikimedia.org/wiki/File:A3Cnormal_(CardioNetworks_ECGpedia).avi.webm), and [subcostal](https://commons.wikimedia.org/wiki/File:Subcostal_normal_(CardioNetworks_ECHOpedia).webm).

Changes include silent H.264 conversion and poster extraction; applicable native dimensions, frame cadence, crop, hashes, and modification records remain in the media catalog and `public/assets/echo-media-v7/LICENSES.md`. The authors do not endorse the application.

### Nazerian et al.

Five TEE examples and posters derive from supplementary videos 1a–1e of **Nazerian et al. (2020), The Ultrasound Journal 12:41**, [DOI 10.1186/s13089-020-00189-0](https://doi.org/10.1186/s13089-020-00189-0), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The publisher’s rights statement includes supplementary material unless separately excluded; no separate exclusion was identified for these clips.

Retained records describe silent conversion, native-frame preservation, and any black-margin crop. These are independent clinical teaching examples, not scans of the HiP-CT donor or necessarily normal studies. Preserve adjacent notices and per-file modifications.

## Original teaching illustrations

The current Reference Views artwork under `public/assets/reference-views-v54/` contains 56 newly generated original teaching schematics, each with a full image and thumbnail. View-specific anatomical diagrams and ultrasound examples informed their orientation and content; those published figures and crops are not redistributed by this update. The [asset manifest](docs/reference-views-v54/asset-manifest.json) retains each prompt, reference source, input hash, generated/output hash, and review record. The [guidelines](docs/reference-views-v54/GUIDELINES.md) identify the 2019 comprehensive TTE, 2013 comprehensive TEE, and 2013 basic perioperative TEE documents used as authorities. Retain these citations and provenance. These schematics are project illustrations, not measured anatomy or independent clinical validation.

The original TTE text-prompt artwork under `public/assets/tte-atlas/art-v1/` and original abstract TEE SVGs under `public/assets/tee-atlas/diagrams/` are project illustrations. Their recorded generation methods are retained. They are not measured anatomy and do not establish clinical accuracy.

The separate older ASE-reference-derived TEE `art-v2/` images are **excluded** from the public package pending clarification of derivative rights. The new original v54 schematics do not change that exclusion. Do not restore the excluded files merely because they appeared on an earlier hosted demonstration.

## Omitted or externally linked material

- **The POCUS Atlas:** historical recordings/posters have known [CC BY-NC 4.0 terms](https://www.thepocusatlas.com/legal) and are omitted from the unrestricted package. Attribution alone does not remove the noncommercial condition.
- **SlicerHeart sample CT and derived surfaces:** data redistribution permission was not established. The project’s [BSD software license](https://github.com/SlicerHeart/SlicerHeart/blob/master/LICENSE) is not treated as a license for its sample images. Data payloads and derived clinical render galleries are omitted; original adapters and factual provenance remain.
- **cMAC / Cardiac Atlas Project data:** the [challenge page](https://www.cardiacatlas.org/motion-tracking-2011-challenge/) describes access by attribution, while [CAP policies](https://www.cardiacatlas.org/policy-documents/) include transfer conditions. Their exact applicability to the public challenge example needs clarification; this package does not claim unrestricted redistribution rights. Image payloads/derived galleries are omitted, with adapters and factual metadata retained.
- **ASE/SCA guideline figures, ASE/Elsevier videos, TECHmED/YouTube and institutional teaching media:** citations, source links, and catalog metadata are retained. No general open license for rehosting these media is asserted. External player/source access is optional and governed by the publisher. Guideline-derived image files and unreviewed mixed-media screenshots are omitted.

See [assets and availability](docs/open-source/assets.md) for setup consequences and legitimate acquisition steps. Access to a public download does not by itself permit redistribution.

## Vendored code

| Component | Attribution and license | Retained notice |
| --- | --- | --- |
| meshopt decoder | Copyright 2016–2025 Arseny Kapoulkine; MIT. [Upstream](https://github.com/zeux/meshoptimizer). | `public/vendor/meshopt-LICENSE.md` |
| numcodecs.js 0.3.2 | Copyright 2020 Trevor Manz; MIT. [Upstream](https://github.com/manzt/numcodecs.js). | `public/vendor/numcodecs/LICENSE`, `README.md` |
| Bundled Blosc and codecs | Upstream Blosc, bitshuffle, LZ4, Snappy, zlib, Zstd, FastLZ, and integer-header notices as supplied. | `public/vendor/numcodecs/licenses/` |
| Marching-cubes cases from scikit-image | scikit-image team and credited upstream contributors; BSD terms in the retained license. [Upstream](https://github.com/scikit-image/scikit-image). | `public/vendor/scikit-image-LICENSE.txt`; attribution in `public/native-edge-table.js` |

Keep these full license texts with copies of the relevant code. Framework and optional scientific dependencies keep their own package licenses; inspect their installed notices and lockfile rather than treating the root MIT license as a blanket grant for every dependency.
