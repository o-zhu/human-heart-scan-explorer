# Full reference-illustration QC — v60

This revision reopens **all 56 active illustrations**, including images retained by v58 and the targeted v59 PLAX-MV repair. Each view receives a new review of its actual pixels, exact acquisition reference, wall/boundary inventory, cavity connections, valve phase and attachments, labels, and thumbnail readability. Historical approvals are not treated as current evidence.

The final collection contains **28 repaired views** (11 TTE and 17 TEE) and **28 originals retained after fresh review**. There were 47 generation attempts: 28 selected and 19 rejected. Every selected replacement has an independent second inspection tied to its actual 960px and 384px export hashes and its 200px display review.

## Review standard

The [guidelines](GUIDELINES.md) define eight independent domains scored 0–2. A score of 1 means an unresolved ambiguity or incomplete requirement; it cannot be averaged away. Acceptance requires all applicable domains to be resolved and no hard anatomical or labeling failure. A 16/16 result is a schematic-QC result, **not a measured clinical accuracy percentage**.

The central distinction is between a required tissue band and an appropriately thin fibrous structure. Atrial and ventricular free walls need finite filled tissue, with atrial/RV walls thinner than LV myocardium. Vessel walls need finite thin bands. Valve leaflets, annuli, aortomitral continuity and genuine chordae remain thin. Restoring a wall must not create a muscular seal across an orifice.

Semilunar curvature is evaluated relative to ventricular upstream and arterial downstream, with an explicitly recorded phase. A fixed screen-direction rule would be wrong across these views. Several repairs use a coherent ejection schematic to make an open outflow and closed atrioventricular valve easy to distinguish.

## Evidence and limits

ASE 2019 Table 2 supplies the exact TTE anatomy and ultrasound views. ASE/SCA 2013 Table 10 and its numbered acquisition discussion supply the TEE views. BSE mitral and right-valve guidance provides supplementary attachment and valve-plane interpretation. Source publication years are preserved independently of hosting URLs. Source PDFs/crops are review inputs and are not redistributed in this public update.

The source Table 10 caption for pulmonary-vein view 14 uses “UE”, while its dedicated section 14 on printed page 939 explicitly names and describes the **ME** pulmonary-vein acquisition. This revision follows the dedicated acquisition text and retains the existing stable identity, ME metadata and geometric calibration. It does not silently change a physical preset based on an inconsistent thumbnail caption.

Some source drawings use compressed terminal valve or single-line wall notation. The new original artwork makes these relationships clearer for this project's larger reference images without asserting that the source schematic is itself anatomically erroneous. A short PA continuation in TG RV basal is an explicit schematic clarification of RVOT–PV–PA continuity; it is not represented as a measured extension or verified patient section.

All reviews are AI-assisted source comparison and visual inspection. No independent clinician sign-off, patient correspondence, quantitative wall thickness, valve-motion validation or new CT registration is claimed.

## Deliverables and provenance

- [asset-manifest.json](asset-manifest.json): all 56 fresh review records; original/current asset identities; per-view findings, boundary inventories, phase, scores, exact prompts and attempt history; exported hashes.
- [AUDIT.md](AUDIT.md): readable per-view comparison and findings.
- [GUIDELINES.md](GUIDELINES.md): reusable detection, generation and grading standard.
- `public/reference-artwork-v60.js`: explicit current mapping, with no image-error fallback to superseded artwork.

New images are separate versioned assets. Unchanged images retain their exact bytes while receiving fresh review records. All historical manifests and original images remain available for comparison and rollback.

## Packaging and verification

```sh
python3 scripts/prepare-reference-icons-v60.py --reviews /absolute/accepted-reviews.json
python3 scripts/prepare-reference-icons-v60.py --reviews /absolute/accepted-reviews.json --write
python3 scripts/prepare-reference-icons-v60.py --verify
node --test tests/tte-atlas.test.mjs tests/tee-atlas.test.mjs
python3 scripts/build-reference-audit-report-v60.py --html /absolute/Heart-Explorer-Reference-QC-v60.html --markdown docs/reference-views-v60/AUDIT.md
```

The packager only resamples square masters and encodes 960px/384px WebP at quality 91, method 6. It rejects unresolved scores, missing exact-source evidence, missing per-view boundary inventories, incomplete independent review, and acceptance records that do not match the actual exported image/thumbnail hashes. The 200px inspection is made from the decoded encoded thumbnail.

The verifier checks all 112 active files, immutable v59 baseline bytes, exact current runtime selection and complete fresh review coverage. These structural checks supplement the visual inspection; they do not establish anatomy by themselves. Browser observations, deployment, GitHub integration and transport delivery are recorded separately in the release receipt.

The catalogue, clinical acquisition settings, scientific scan data, measured planes, donor calibration, prepared reference bank, mesh/masks, media sources and existing upload policies retain their existing scope. No reference figure or clinical media is added to the public payload.
