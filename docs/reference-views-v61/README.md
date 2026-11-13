# Targeted atrial-septum and valve-clarity follow-up — v61

This revision contains three requested illustration corrections:

| Key | View | Review focus |
| --- | --- | --- |
| `tte:subcostal` | Subcostal four-chamber | Distinguish the atrial septum's muscular rim from its genuinely thin central region without implying a ventricular-thickness septum. |
| `tee:deeptg5c` | Deep transgastric five-chamber | Clarify the mitral junction, the LA–LV relationship and the fibrous border of LVOT; keep one coherent valve phase. |
| `tee:tglax` | Transgastric long-axis | Make the mitral leaflets and LA–LV connection readable and keep the aortomitral relationship distinct from a solid tissue seal. |

The v60 assets and review records remain immutable. Its 53 other entry objects
are carried over exactly and are not described as newly reviewed. The detailed
[v60 review standard](../reference-views-v60/GUIDELINES.md) still applies to the
three new reviews. The old TG drawings selected an ejection phase with closed
mitral valves; a closed valve is not itself evidence of an anatomical blockage.
The new review must judge actual leaflet clarity, attachments and connections.

## Accepted changes

- **Subcostal four-chamber:** replaced the long ivory RA–LA seam with a thin,
  continuous tissue-colored septal band. The muscular rims taper toward a
  thinner central region; this is a simplified tissue distinction, not a claim
  that the fossa ovalis is uniformly thick myocardium. The existing mitral and
  tricuspid valve profiles and chamber orientation are preserved.
- **Transgastric long-axis:** opened the two mitral leaflets to make LA–LV
  communication clear. The aortic valve is closed in the same filling phase.
  A distinct aortic-root wall encloses the sinus behind the cusp, while central
  cusp coaptation remains inside the lumen. The short aortomitral attachment
  remains distinct from a permanent wall across the mitral orifice.
- **Deep transgastric five-chamber:** opened and labeled the mitral valve,
  with an open tricuspid valve and closed aortic valve. The LA–LV inflow passage
  is visible beside the separate LVOT. The aortic cusps meet on the aortic side
  of their basal attachments, downward toward Ao in this image.

The selected masters and actual 960px, 384px and decoded 200px exports were
inspected by the generating/reviewing agents and separately by the integrating
agent. The [review notes](REVIEW.md) explain the rejected intermediate images.
This is a source-based, AI-assisted schematic review, without independent
clinician certification. Exact accepted image hashes and per-view evidence
are recorded in `asset-manifest.json`.

The preparation code cannot establish visual acceptance. Future changes require
a new review of actual exported pixels before filling in a passing record.

## Preparation workflow

Use a JSON array, or `{ "entries": [...] }`, containing one record for each
target. A preview can contain any subset of those targets; a release requires
all three. Each record starts with:

```json
{
  "mode": "tte",
  "id": "subcostal",
  "disposition": "replace",
  "generation": {
    "tool": "image_gen",
    "output_path": "/absolute/path/to/selected-square-master.png",
    "selected_master_sha256": "<actual SHA-256>",
    "prompt": "<exact final image-edit prompt>",
    "references": [
      {
        "role": "existing edit target",
        "path": "/absolute/path/to/reference.webp",
        "sha256": "<actual SHA-256>"
      }
    ],
    "attempts": ["<actual attempt identities and acceptance/rejection reasons>"]
  },
  "review": { "status": "pending" }
}
```

Preview export performs RGB conversion, uniform LANCZOS resampling and WebP
encoding only. It does not crop, redraw, repair anatomy, write a manifest or
change the active atlas. The 200px preview is decoded from the exact 384px WebP.

```sh
python3 scripts/prepare-reference-icons-v61.py --reviews /absolute/candidates.json --preview-dir /absolute/review-output
```

Inspect the master, actual960 and384 WebP files, and decoded200 preview. Fill the
review only after inspection. It uses the v60 schema: `status`, eight
`domain_scores`, `total_score`, eight `checks`, `hard_failures`, `summary`,
`phase`, `independent_review`, `boundary_inventory`, `sources`, `initial_audit`,
`full_size_reviewed`, `thumbnail_reviewed`, `compact_size_reviewed`, and
`export_review`. The latter contains `status`, `observations`,
`image_sha256` and `thumbnail_sha256` matching the preview exports. All eight
domains must resolve under the stated schematic scope. The source references
need exact HTTPS URLs; each generation input needs its role and actual hash.

```sh
python3 scripts/prepare-reference-icons-v61.py --reviews /absolute/accepted-reviews.json
python3 scripts/prepare-reference-icons-v61.py --reviews /absolute/accepted-reviews.json --write
```

After successful writing, switch only the artwork imports in
`public/tte-atlas-data.js` and `public/tee-atlas-data.js` from
`reference-artwork-v60.js` to `reference-artwork-v61.js`, then verify:

```sh
python3 scripts/prepare-reference-icons-v60.py --verify --historical
python3 scripts/prepare-reference-icons-v61.py --verify
```

The v61 check validates the frozen v54/v58/v59/v60 history, exact carried-over
entries, all112 current assets, the explicit registry and both live catalogue
mappings. Changing a public path requires a new accepted manifest. There is no
image-load fallback to a superseded illustration.

## Publication boundaries

Keep the existing gallery behavior, view identifiers, labels, angle UI,
reference videos, donor planes, CT textures, masks and reconstruction context.
No immutable data bank, upload gate or new hosting stage is needed for six small
WebP files. Publish with the existing15-stage build workflow, verify the live
image URLs, then push the public-safe source and original generated artwork to
GitHub. Preserve asset exclusions and source-figure licensing; do not include
publisher figures used for internal comparison. New Box handoffs are not used.
