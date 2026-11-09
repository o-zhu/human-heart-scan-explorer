# All-donor native echo review

This extends the v5 audit without modifying its historical scripts. Each donor is exported and rendered separately to bound temporary disk usage. `source-target-sweeps.py` is a separate source-plane optimization tool owned by the main implementation.

Expected complete coverage: 3 donors × 56 presets × 2 camera anchors = 336 production-geometry renders, plus 168 measured-source/coverage records. Visual review outcomes are separate from the numeric and rendering checks.

```sh
node scripts/echo-donor-qc-v6/export-review.mjs --donor=s-20-28 --out=/dev/shm/echo-donor-qc-v6 --width=640 --height=560
node scripts/echo-donor-qc-v6/sample-caps.mjs /dev/shm/echo-donor-qc-v6
/tmp/heart-v29-python/bin/python scripts/echo-donor-qc-v6/render_gallery.py --input=/dev/shm/echo-donor-qc-v6 --output=docs/echo-donor-qc-v6/native/s-20-28
/tmp/heart-v29-python/bin/python scripts/echo-donor-qc-v6/source-contact-sheet.py --input=/dev/shm/echo-donor-qc-v6 --output=docs/echo-donor-qc-v6/native/s-20-28
```

Repeat all four commands with `ladaf-2021-17` and `s-20-29`, removing only that workflow's temporary directory between donors. `--ids=a4c,me4c` restricts a renderer smoke check; complete evidence must contain all 56 IDs. Runtime sources are hashed at export and must remain unchanged through rendering. Source volumes and cap bytes are independently hash-verified. The production controller carries `donorCalibration` and `anatomyTargetsMm` through to the renderer.

The final source-contact-sheet step is required after every export refresh. Individual PNGs/native cameras and source contact sheets are separate outputs; an old sheet must not be mistaken for a current individual reformat. Verify that `source-review.json.exportSha256` equals the native `review.json.exportSha256`, and verify both recorded sheet hashes. Do not use `--allow-stale` for final evidence. Retain intentionally withheld source sections in the denominator separately from unexpected missing poses.

After all three donors have been rendered, run `/tmp/heart-v29-python/bin/python scripts/echo-donor-qc-v6/verify-evidence.py`. It checks exact registry coverage, current runtime fingerprints, all 147 raw PNG pixel hashes against production MPR bytes, both camera files, source-sheet binding, and the distinction between intentional withholding and unexpected missing poses. Its compact receipt is `docs/echo-donor-qc-v6/native-summary.json`; it does not assign clinical pass grades.

The native EGL renderer uses exported, unmodified production GLSL, actual production MPR sampling, actual accepted controller planes, actual camera alignment, actual probe/context draw calls and projected sector commands. Canvas guide antialiasing is replayed with Pillow, so the output is native scientific evidence, not a browser screenshot. Context callout fonts, fine replacement surfaces, local fine exclusion fields and browser UI are outside this renderer's scope.

Donor-specific cleanup and display settings are used. Reviewed LADAF lumen fields must never be applied to the two S-20 volumes. Missing extracardiac targets are labelled outside acquired coverage, with no invented CT section. A zero GL error or a coplanarity pass does not establish clinical correspondence; use `docs/echo-donor-qc-v6/reference-criteria.md` for the separate individual visual review.
