# PLAX mitral wall and outflow repair — revision 59

> Historical revision. The [fresh v60 review](../reference-views-v60/README.md) supersedes the current acceptance decision for every view. This revision's assets and manifest remain unchanged; its verifier checks the frozen registry.

Only **TTE `plax_mv`** changes in this follow-up to v58. The other 55 illustrations, manifest entry objects and image bytes are carried over unchanged.

The v58 PLAX image left most of the LA perimeter as a single contour and the LVOT/root junction as ambiguous overlapping curves. The replacement supplies a finite thin atrial tissue band, preserves open mitral inflow, and separates one LVOT, distinct fibrous/valve attachments, closed aortic cusp profiles and one aortic lumen. **LVOT** and **Ao** labels clarify the outflow.

The prior PLAX pass is superseded. Original v54/v58 manifests and images remain historical evidence.

## Review materials

- [Detailed anatomical/display guidelines](GUIDELINES.md)
- [Exact prompt](PROMPT.md)
- [Targeted review and before/after comparison](REVIEW.md)
- [Complete current asset manifest](asset-manifest.json)

The current explicit registry is `public/reference-artwork-v59.js`. Both catalogues use its 56-entry mapping. Only the PLAX image/thumbnail URLs change. No image-error fallback can reinstall superseded artwork.

## Reproduce and verify

```sh
python3 scripts/prepare-reference-icons-v59.py --review /absolute/plax-review.json
python3 scripts/prepare-reference-icons-v59.py --review /absolute/plax-review.json --write
python3 scripts/prepare-reference-icons-v59.py --verify
node --test tests/tte-atlas.test.mjs tests/tee-atlas.test.mjs
```

The first command is a dry run. Packaging requires an accepted single-view review and square generated master of at least 960px. It writes 960px/384px WebP files at quality 91, a complete manifest and registry. It never paints, crops or changes anatomy. Exact prompt, input hashes and selected-master hash are recorded.

The v59 verifier checks 112 active files, the actual runtime mapping, immutable v58 baseline and exact equality of 55 carried-over records. It rejects an altered baseline or another replacement. The older v58 verifier now checks its frozen registry, explicitly reporting that current runtime was not checked. Historical integrity and current release verification remain separate.

Keep all 15 existing hosting stages and run `scripts/verify-reference-hosting-v58.py` after staging in the hosted-data checkout. Public GitHub intentionally omits the prepared clinical/reference bank; preserve its sanitized configuration and exclusions. Never copy the complete Sites tree into public GitHub.

This artwork update changes no CT plane, donor data, ultrasound source, mesh, acquisition code or upload gate. Review is AI-assisted and source-based, without independent clinician sign-off.

