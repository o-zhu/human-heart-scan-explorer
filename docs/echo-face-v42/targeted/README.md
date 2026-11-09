# Reported cut-face failure: targeted reproduction

The v73 renderer returned zero cap density outside the selected CT image's
rectangle, although its mesh clipping plane cut the entire organ. The exposed
interior mesh reproduced the sharp crop boundary and rough/open face shown in
the PLAX AV, PLAX MV and PSAX PV/PA screenshots.

`reported-view-comparison.jpg` compares frozen v73 shaders with the corrected
production shaders. Both columns use the actual **1,986,313-triangle detail
mesh**, the exported accepted probe camera and physical plane, the existing
**0.28** mesh threshold, the same published support mask, and identical CT ROI
pixels. The cap input and immediate fallback come from the hash-verified
**317.6 µm resident display volume**. This is not a test of downloaded 79.4 µm
sections, optional reviewed cleanup masks, physical iOS hardware or browser FPS.

| View | Before cap pixels | After cap pixels | Restored pixels |
|---|---:|---:|---:|
| PLAX AV | 31,189 | 50,307 | 19,118 |
| PLAX MV | 28,250 | 45,166 | 16,916 |
| PSAX PV/PA | 34,033 | 42,108 | 8,075 |

All original ROI cap pixels and all unrelated mesh/background pixels were
byte-identical between columns. Every restored pixel exactly matched the
current-plane resident source. Source, shader and mesh hashes are retained in
`reported-view-native.json` and `samples.json`.

The separate source-space count uses the production MPR worker and an
independent plane/volume-box intersection. At threshold 0.28, the original
crops omitted 38.48%, 37.71% and 19.60% of supported tissue samples respectively.
The report also retains threshold 0.18 counts for the resident-volume path.
These are display-sample coverage measurements, not anatomical or clinical
accuracy scores.

## Reproduce

From the repository root, export the accepted LADAF controller planes and run:

```sh
node scripts/echo-face-v42/export-review.mjs --donor=ladaf-2021-17 --out={temporary-cache}
node scripts/echo-face-v42/sample-before.mjs {temporary-cache}
python tests/echo-face-v42-before-native.py --input {temporary-cache} --before-shaders docs/echo-face-v42/targeted/v73-before-shaders.json --output {temporary-cache}/native
```

The original run used a controller export from v73 commit
`831198eeede3a6e0afac12fc644e4862e60527b9`; the separate all-view audit verifies
that the accepted planes and CT crops remain unchanged in the correction.
Only the reported failure evidence is retained here; the full donor/view matrix
is covered by the broader v42 review.
