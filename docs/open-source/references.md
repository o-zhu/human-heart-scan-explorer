# References and source roles

This software’s citation is [CITATION.cff](../../CITATION.cff). The references below identify upstream data, scientific context, and teaching resources; they do not establish clinical validation of this application. Detailed per-file source links, transformations, hashes, and licensing are retained in the asset manifest and adjacent credits.

## Measured preserved-heart data

| Dataset | Citation and source | Used for |
| --- | --- | --- |
| LADAF-2021-17 | Brunet J, Cook AC, Walsh CL, et al. *Complete scan at 19.85 µm of the heart of the body donor LADAF-2021-17*. ESRF. [Dataset DOI](https://doi.org/10.15151/ESRF-DC-1634390196); [Human Organ Atlas record](https://human-organ-atlas.esrf.fr/datasets/1659197537). | Main measured heart, display volumes/sections, derived surfaces, reviewed display masks, and approximate regional annotations. |
| S-20-29 | Walsh CL, Brunet J, Berruyer C, et al. *Complete scan at 19.89 µm of the heart of the body donor S-20-29*. ESRF. [Dataset DOI](https://doi.org/10.15151/ESRF-DC-1773964017); [Human Organ Atlas record](https://human-organ-atlas.esrf.fr/datasets/1773963465). | Independent donor source, display data, and donor-specific approximate planes/context. |
| S-20-28 | Brunet J, Cook AC, Walsh CL, et al. *Overview scan at 19.85 µm of the heart of the body donor S-20-28*. ESRF. [Dataset DOI](https://doi.org/10.15151/ESRF-DC-1966163810); [Human Organ Atlas record](https://human-organ-atlas.esrf.fr/datasets/1966162746). | Independent donor source, display data, and donor-specific approximate planes/context. |

The [Human Organ Atlas](https://human-organ-atlas.esrf.fr/) specifies [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) for its datasets. Retain each dataset’s creators and DOI and identify modifications. These are separate preserved specimens, not matched healthy controls. Reported history and source metadata should remain attributed to the original catalog.

Brunet and colleagues’ heart study, [Radiology (2024), DOI 10.1148/radiol.232731](https://doi.org/10.1148/radiol.232731), and its [open preprint](https://pmc.ncbi.nlm.nih.gov/articles/PMC10592740/) provide anatomical context for the source scans. The project used labeled study images as reference context; that does not validate the application’s own annotations or every named echo target.

## Reference anatomy and imaging-plane guidance

- **BodyParts3D**, The Database Center for Life Science: [official downloads](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html) and [official license](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html). Selected meshes provide illustrative chest context. Element IDs, crop/reduction/transformation records, and the required credit remain in `public/assets/probe-context-v11/`.
- **ASE adult comprehensive TTE guidance (2019)**: [official guideline PDF](https://www.asecho.org/wp-content/uploads/2019/01/2019_Comprehensive-TTE.pdf). Provides named views, acquisition concepts, and teaching targets. It does not establish that an excised specimen contains all target structures.
- **ASE/SCA comprehensive TEE guidance (2013)**: [official guideline PDF](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf). Provides view names, expected anatomy, and probe-control concepts. Guideline figures are not relicensed as original project art.
- **Ray-based CT-to-ultrasound simulation**, [PubMed PMID 19249113](https://pubmed.ncbi.nlm.nih.gov/19249113/). Background for CT-derived educational appearance modeling. Heart Explorer’s implementation is a simplified model, not a validated implementation of an acquired ultrasound system.

## Independent echo recordings

**CardioNetworks / ECHOpedia**, credited to CardioNetworks: Vdbilt (I. A. C. van der Bilt, MD), supplies the identified reusable TTE teaching sources under CC BY-SA 3.0. Primary file records include [PLAX](https://commons.wikimedia.org/wiki/File:PLAXnormal_(CardioNetworks_ECHOpedia).webm), [papillary short axis](https://commons.wikimedia.org/wiki/File:SAXPAP_normal_(CardioNetworks_ECHOpedia).webm), [apical four chamber](https://commons.wikimedia.org/wiki/File:A4C_normal_(CardioNetworks_ECHOpedia).webm), [apical two chamber](https://commons.wikimedia.org/wiki/File:A2Cnormal_(CardioNetworks_ECGpedia).avi.webm), [apical three chamber](https://commons.wikimedia.org/wiki/File:A3Cnormal_(CardioNetworks_ECGpedia).avi.webm), and [subcostal](https://commons.wikimedia.org/wiki/File:Subcostal_normal_(CardioNetworks_ECHOpedia).webm). Per-file conversion/crop details are retained in the media records.

**Nazerian et al. (2020)**, *Transesophageal echocardiography (TEE) in cardiac arrest: results of a hands-on training for a simplified TEE protocol*, The Ultrasound Journal 12:41. [Article and video supplements](https://doi.org/10.1186/s13089-020-00189-0). Five CC BY 4.0 supplements supply independent TEE examples. They are not designated normal studies merely because they illustrate a view.

**TECHmED**, [echocardiographic teaching views](https://www.techmed.sk/en/echo/view/00/), associated YouTube players, ASE/Elsevier supplementary media, and the [University of Toronto/UHN TTE resource](https://pie.med.utoronto.ca/tte/TTE_content/standardviews.html) supply external references. Their URLs and catalog metadata remain separate from locally redistributed media. Availability and player behavior depend on the publisher.

**The POCUS Atlas**, [normal cardiac anatomy](https://www.thepocusatlas.com/normal-cardiac-anatomy) and [legal terms](https://www.thepocusatlas.com/legal), supplied historical examples subject to CC BY-NC 4.0. Those recordings/posters are omitted from the unrestricted package.

## Clinical examples and adapters retained without redistributed data

**SlicerHeart:** Lasso A, Herz C, Nam H, et al. (2022). *SlicerHeart: An open-source computing platform for cardiac image analysis and modeling*. Frontiers in Cardiovascular Medicine 9:886549. [Paper](https://doi.org/10.3389/fcvm.2022.886549); [sample definition](https://github.com/SlicerHeart/SlicerHeart/blob/master/ValveAnnulusAnalysis/ValveAnnulusAnalysis.py). The live demonstration’s repaired congenital-heart CT example is not a healthy control. The software paper/license is not treated as a grant for redistributing the sample images or derived meshes.

**cMAC / Cardiac Atlas Project:** Tobon-Gomez C, De Craene M, McLeod K, et al. (2013). *Benchmarking framework for myocardial tracking and deformation algorithms: An open access database*. Medical Image Analysis 17(6):632–648. [Paper](https://doi.org/10.1016/j.media.2013.03.008); [challenge](https://www.cardiacatlas.org/motion-tracking-2011-challenge/); [policies](https://www.cardiacatlas.org/policy-documents/). MRI and ultrasound in the adapter are separate acquisitions from the same volunteer, without asserted registration or phase synchronization. Redistribution permission for this package remains unresolved.

## Third-party implementation

[meshoptimizer](https://github.com/zeux/meshoptimizer) supplies the bundled mesh decoder; [numcodecs.js](https://github.com/manzt/numcodecs.js) supplies the bundled Blosc codec; [scikit-image](https://github.com/scikit-image/scikit-image) supplies the marching-cubes case table. Preserve the licenses and codec notices under `public/vendor/`. Framework/package dependencies retain their own package-level licenses and locked versions.
