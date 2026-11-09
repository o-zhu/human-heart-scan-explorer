# Assets, setup, and reproducibility

The code license and data licenses are separate. The [asset manifest](asset-manifest.json) is the machine-readable inventory for this prepared release. It records expected paths, source/rights information, sizes, hashes, and permitted acquisition URLs. The public package intentionally omits material whose redistribution permission is unresolved or incompatible with an unrestricted release.

## Restore permitted assets

If you received separate asset ZIPs, first verify their sizes and SHA-256 hashes against the release inventory, inspect entries for unsafe paths, and extract to the specified repository paths. Use only the exact source and asset archive identities named together by the current release manifest; it may explicitly reuse unchanged assets from an earlier release. Required dotfiles belong to source, not the asset ZIPs.

The standard-library downloader provides an alternative and verifies already restored files:

```sh
python3 scripts/fetch-assets.py --list
python3 scripts/fetch-assets.py --group runtime --dry-run
python3 scripts/fetch-assets.py --group runtime
```

The `runtime` group restores manifest-listed permitted files under `public/assets/`. The `fine-data` group restores the separately indexed data under `data/`, including the fine section/brick collections needed for exact arbitrary-plane detail:

```sh
python3 scripts/fetch-assets.py --group fine-data --dry-run
python3 scripts/fetch-assets.py --group fine-data
```

Use `--group all` for all **listed, permitted** assets. This does not mean all original scientific acquisitions or every optional native reconstruction bank. `--list` gives transfer totals without downloading; `--dry-run` checks local files without writing or downloading. A matching file is reused. Downloads are checked for exact length and SHA-256 before atomic installation; a changed upstream object is an error, not permission to accept different bytes.

The default acquisition source is the existing public demo’s immutable, indexed asset paths, as recorded in the manifest. Availability depends on that host. A separately hosted mirror can be selected with `--base-url` only if it supplies the same paths and exact bytes. Do not put a private transfer URL into the application’s runtime configuration.

The fine-data collection is a substantial download. Inspect its actual byte total and allow room for extracted assets, browser cache, and any temporary archive copies before restoring it. The original raw acquisitions and scientific intermediates are larger and are not downloaded by this utility.

After restoration, run:

```sh
python3 scripts/serve-local.py
```

Open `http://127.0.0.1:8000/`. See [development](development.md) for supported API routes and [deployment](deployment.md) before using another host.

## Included or legitimately retrievable families

| Family | Rights and role | Important qualification |
| --- | --- | --- |
| Three active HOA hearts | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Display volumes, source-derived surfaces, masks, labels, and CT textures retain dataset attribution. This includes the complete compact heart surfaces in `probe-heart-v44` used by Chest Orientation. | Modified educational display derivatives, not raw quantitative scans or validated segmentations. |
| BodyParts3D context | [CC BY 4.0](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html). Cropped/reduced/transformed skin and bone context. | Illustrative reference anatomy, not registered donor anatomy. |
| CardioNetworks teaching clips | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Identified local MP4/poster derivatives. | Share-alike applies to adapted media; it is not replaced by the code’s MIT license. |
| Nazerian et al. teaching clips | [CC BY 4.0 publisher license](https://link.springer.com/article/10.1186/s13089-020-00189-0). Five TEE loops and posters. | Independent clinical examples, not the specimen’s ultrasound. |
| Original illustrations | TTE text-prompt illustrations and original TEE SVG schematics, with their provenance. | Illustrative teaching art, not measured anatomy or validation. |
| Vendor codecs/tables | Their retained MIT, BSD, and codec notices. | Includes embedded codec WASM; preserve all vendor notices. |

The exact per-file decision in the manifest controls inclusion. Similar filenames or a catalog’s current source credit do not establish the license of an older media file. Original and transformed data keep distinct identities.

## Deliberately omitted material

| Family | Why omitted | Legitimate next step |
| --- | --- | --- |
| SlicerHeart clinical CT and derived meshes | A data-specific redistribution grant for the sample and derivatives was not established. The upstream software license alone does not establish one. | Review the [sample-source project](https://github.com/SlicerHeart/SlicerHeart/blob/master/ValveAnnulusAnalysis/ValveAnnulusAnalysis.py) and obtain the necessary permission. The original import/processing scripts remain. |
| cMAC MRI and measured 4D ultrasound derivatives | The challenge describes access by attribution, but a grant allowing this public redistribution was not established. The applicability of general CAP transfer restrictions to this example remains unresolved. | Follow the [challenge’s access instructions](https://www.cardiacatlas.org/motion-tracking-2011-challenge/) and [CAP policies](https://www.cardiacatlas.org/policy-documents/); clarify permitted transfer/derivatives before rehosting. |
| POCUS Atlas recordings/posters | Their known [CC BY-NC 4.0 terms](https://www.thepocusatlas.com/legal) restrict commercial use. | Acquire/use locally only under those terms or obtain additional permission; do not treat the files as unrestricted MIT assets. |
| ASE-reference-derived TEE art-v2 and source figure crops | No open license for redistributing those guideline-derived figures was established. | Use the retained original SVG teaching diagrams, or obtain permission. Keep the original guideline citation. |
| External ASE/Elsevier, TECHmED/YouTube, and institutional teaching media | Links and source metadata are retained, but no general right to copy their recordings or thumbnails into a release was established. | Use publisher/source links and permitted player behavior; do not claim offline playback or download/rehost the files without permission. |
| Mixed-source documentation galleries | A rendered screenshot can contain licensed media, not just original UI. Unreviewed galleries are omitted from the public export. | Create a rights-cleared screenshot from permitted content and retain dataset/media credits. |

This intentionally prevents the cleared package from reproducing every feature/media item of the live demonstration. Missing clinical data must remain visibly unavailable; the application must not substitute another donor or synthetic data under the original label.

## What is not reproduced from the source ZIP

The current source checkout did not contain the six complete local HOA fine banks. Their indexes, identities, restoration paths, and bounded loaders are retained; use the manifest-backed acquisition workflow for the listed objects. Their availability must be verified when restoring a clean release.

The optional guided-native inspector uses a much larger separately hosted bank and recovery/index mechanism. The complete original quantitative HiP-CT acquisition, every raw N5 cache, and every scientific processing intermediate are absent. The package includes available reconstruction, cleanup, meshing, texture, compression, and conversion scripts, but full preprocessing requires the exact external inputs and environment documented by each pipeline.

No source ZIP, successful installation, or unit-test result establishes complete offline reproducibility. The release inventory records which payloads were physically included, which were retrieved and hash-checked, and which remain external or restricted.

## Credits and asset changes

Keep [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md), [references](references.md), the per-family notices, and the scientific manifests with redistributed assets. Record transformations such as windowing, crop, reduction, filtering, mesh extraction, transcoding, or new annotations. When producing a new derivative, preserve the original and assign a new path/version and checksums.
