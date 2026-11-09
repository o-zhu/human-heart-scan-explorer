# In-vivo cardiac CT, MRI and paired ultrasound: source review

Reviewed 5 November 2026. These are candidates for a future import, not additional
datasets already loaded into Heart Explorer. Access and release status were
checked on the source pages below; full data packages were not downloaded.

## Resolution and the practical choice

No public in-vivo whole-heart CT or MRI collection matching the approximately
20 µm original HiP-CT sampling was identified. The current viewer's Ultra planes
use approximately 79 µm source sampling. Clinical data can provide physiological
chamber geometry and cardiac motion, but should not be expected to resolve the
same fine fibers, chordae or thin valve structures. Upsampling a clinical volume
does not recover those missing observations.

Voxel spacing, acquisition resolution and true spatial resolving power are
different quantities. The values below are the sources' reported image spacing
or acquisition parameters, not a guarantee of resolved feature size. In
particular, a reconstructed 1 mm grid must not be described as an acquired 1 mm
scan when the acquisition was coarser.

## Most relevant sources

| Candidate | Actual release and useful detail | Ultrasound pairing | Access checked |
|---|---|---|---|
| **Cardiac Atlas Project: STACOM 2011 / cMAC** | 15 healthy volunteers; cine MRI, a gated whole-heart MRI, tagged MRI and 4D apical ultrasound. Strongest candidate here for a same-person anatomy/echo comparison. Exact per-series spacing still needs checking in the image headers. | **Yes, same volunteer.** Registration and cardiac-phase matching remain necessary. | Official page describes public data and case archives; its retrieved download table did not expose working archive links, so immediate download was not verified. |
| **HVSMR-2.0** | 60 clinical 3D CMR scans, with four chamber and four great-vessel labels. Mean reported spacing **0.73 × 0.73 × 0.81 mm**. Congenital-heart-disease cohort; these are gated static volumes. | No paired echo described in the release. | Official MIT project links the released Figshare collection. |
| **SlicerHeart 4D CT sample** | MONAI Physio documents a public `TruncalValve_4DCT.seq.nrrd` sample with **21 phases** and an automatic downloader. Particularly useful for a small moving-heart prototype. Exact spacing and dataset-specific redistribution terms need checking before embedding. | No matching ultrasound identified for this sample. | Public download is documented by the project; the volume was not downloaded in this review. |
| **ASOCA** | 40 clinical coronary CT angiograms: 20 normal coronary cases and 20 with coronary disease. Reported spacing **0.3–0.4 mm in plane, 0.625 mm through plane**. Expert labels cover the coronary arteries, not all cardiac chambers. | No paired echo described. | Current UK Data Service record marks the image ZIPs as permission-controlled. Registration and owner approval are required. |
| **MM-WHS** | 60 CT and 60 MRI volumes; seven whole-heart regions. CT reported around **0.78 × 0.78 × 1.6 mm**; MRI acquired around **2 mm** and reconstructed/resampled around **1 mm**. CT and MRI counts do not establish same-person pairing. | No paired echo described. | Official site requires the signed registration terms and organizer process. |
| **ImageCAS** | About 1,000 clinical CCTA volumes with coronary labels; a useful larger CT cohort. Confirm spacing in the selected cases rather than rely on conflicting secondary summaries. | No paired echo described. | Authors link an official Kaggle release and an email request route. No account was used or request sent. |

### Paired-data limitation worth preserving

**MITEA** is another relevant resource, but its advertised release is 3D
echocardiography with MRI-derived LV labels: 134 participants, scan/rescan, and
end-diastolic/end-systolic frames. It should not be presented as a confirmed
download of raw MRI plus a complete synchronized ultrasound cine. Its study's
CMR protocol used 1.4 × 1.4 mm in-plane sampling and 6 mm slices. The official
request route requires an institutional email and restricts redistribution.

The cMAC documentation explicitly describes landmark-based registration between
MRI and ultrasound, and temporal mismatch between modalities. Same-person scans
are therefore a better correspondence source than unrelated recordings, but
still need alignment checks before an interactive slice is claimed to match an
ultrasound frame.

## Recommended next implementation

1. **Same-person MRI/echo comparison:** establish cMAC archive access and inspect
   one volunteer's whole-heart MRI and 4D ultrasound headers, coverage and phase
   correspondence before preparing the full set.
2. **Open clinical MRI with existing regions:** start with one suitably chosen
   HVSMR-2.0 case. Its pathology and static acquisition must remain visible; it
   should not be labeled a healthy reference just because its chambers are open.
3. **A contracting CT demonstration:** evaluate the SlicerHeart 4D sample before
   implementing phase streaming. Clinical CT contrast highlights blood rather
   than the same tissue signal as HiP-CT, so it needs an independent transfer
   function and segmentation pipeline.

Keep the existing HiP-CT sources for fine structural inspection. A clinical
dataset would add complementary geometry and function, with its true source
resolution displayed. Super-resolution or synthetic motion should not be
represented as measured detail.

## Excluded from the ready-to-import shortlist

The AI-CVM **Cardiac-CT** page describes an attractive 14-region ImageCAS
extension, but its own current status says the dataset is not yet publicly
available pending journal acceptance. It is a future lead, not a verified
available download. Scanner galleries and CT-derived digital phantoms likewise
do not establish an openly available original patient image series.

## Primary sources

- [cMAC / STACOM 2011 official data page](https://www.cardiacatlas.org/motion-tracking-2011-challenge/)
- [cMAC registration and temporal-alignment README](https://www.cardiacatlas.org/wp-content/uploads/2024/03/readme.pdf)
- [HVSMR-2.0 project and data links](https://segchd.csail.mit.edu/)
- [HVSMR-2.0 original paper, author-hosted PDF](https://segchd.csail.mit.edu/files/HVSMR-2.0.pdf)
- [SlicerHeart CT sample download documentation](https://project-monai.github.io/monai-physio/cli_scripts/download_data.html)
- [ASOCA current data access record](https://reshare.ukdataservice.ac.uk/855916/)
- [ASOCA original challenge paper and acquisition parameters](https://doi.org/10.1016/j.compmedimag.2022.102049)
- [MM-WHS official acquisition and access information](https://zmiclab.github.io/zxh/0/mmwhs/data.html)
- [ImageCAS author-maintained repository](https://github.com/XiaoweiXu/ImageCAS-A-Large-Scale-Dataset-and-Benchmark-for-Coronary-Artery-Segmentation-based-on-CT)
- [MITEA official release and access terms](https://www.cardiacatlas.org/mitea/)
- [MITEA original study](https://www.frontiersin.org/journals/cardiovascular-medicine/articles/10.3389/fcvm.2022.1016703/full)
- [AI-CVM Cardiac-CT current release status](https://ai-cvm.org/cardiac-ct-dataset/)
- [HiP-CT whole-heart imaging paper](https://doi.org/10.1148/radiol.232731)
