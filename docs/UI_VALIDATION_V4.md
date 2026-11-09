# Heart explorer v4 validation

Date: 2026-11-04. Site: `{hosting-project}`.

## Revised regional anatomy

The revised label map follows 22 reviewed LV myocardial-envelope contours and a curved right atrioventricular junction fitted to 14 hinge and seven outer-groove observations. It replaces the previous nearest-cavity split through compact LV myocardium and the flat RA/RV cutoff. See [the anatomy methodology](anatomy/README.md), [the source/previous/revised comparison](anatomy/anatomy-x237-before-after.jpg), and [the recorded boundary checks](anatomy/boundary-validation.json).

Twenty dense-tissue landmarks selected before the revised candidate was available changed from five matching regional identities in v3 to 20 in v4. Their local tissue neighborhoods also pass the continuity checks. Six subsequently selected outer-wall refinement points are recorded separately and pass. These are targeted regression checks, not a global segmentation-accuracy estimate or clinical ground truth. The septal color is a regional display convention; basal vessels and atrial/outflow territories remain approximate.

The final label asset is 334,512 bytes compressed and 35,573,106 bytes decoded. Its SHA-256 is `da36ab4d08bf0c114d4e5b44dfaaa4e4abad7a48680b863bd455b45a5b57d64d`. The actual map was loaded in Node with both gzip-file bytes and already HTTP-decompressed bytes. Both produced the expected complete decoded map. The loader inspects gzip magic bytes and retains decoded-length validation.

## Hosted Ultra sections

The collection covers all 1,480 section positions: 475 X, 475 Y and 530 Z. It contains 1,096 nonempty lossless images and one shared empty image. All 384 empty positions are represented without a network image request. All encoded hashes and decoded-pixel hashes were checked, and 13 representative sections were compared with source-derived display arrays with zero pixel error. See [the complete asset validation](hosted-ultra-validation.json) and [the compression comparison](hosted-ultra-compression.png).

Each nonempty image is below 1,000,000 bytes: median 470,913 bytes, maximum 956,458 bytes. The exact lossless claim applies to the windowed 8-bit display values inside the existing conservative scan support, with 79.4 µm in-plane sampling. It does not mean the original uint16 scan or native 19.85 µm acquisition is delivered. Empty exterior margins are omitted, and through-plane section steps remain 317.6 µm.

The complete collection was uploaded before publishing the revised interface. The live R2 inventory verified all 1,097 immutable objects, totaling 507,669,076 bytes, against their expected lengths and SHA-256 metadata. Actual GET bodies for X237, Y237, Z363 and the empty image matched their SHA-256 values. The final worker disables uploads; its read-only behavior is covered by the storage handler tests and must also be checked after final publication with `scripts/upload-ultra.py --verify-read-only`.

## Implementation checks

- `node scripts/verify-geometry.mjs` passes source/world transforms, X/Y/Z crop and canvas placement, annotation alignment, 3D cut-face frames, alternate-pixel detail registration, empty crops and the 13 existing echo-plane bases.
- `node scripts/verify-ultra-storage.mjs` passes bounded upload and checksum validation, idempotency, byte-identical retrieval, private caching, ETag/HEAD behavior, inventory completeness, unknown-path handling and final read-only mode.
- `node --check public/app.js` passes.
- The official Sites/Vinext build completes successfully. Runtime textures are served from R2; the approximately 51 MiB frontend build does not include the 508 MB image collection.
- Focused independent source review found no blocker in the gzip-aware anatomy loader or the final read-only image service.

## Browser observations and remaining verification limit

The managed browser displayed the revised interface with Ultra selected by default. Selecting X237 automatically loaded its 842,946-byte lossless cut-face image; the UI reported 843 KB. Browser WebGL2 was unavailable, so this observation used the existing CPU fallback. A separate EGL check compiled and rendered the actual GPU cap shader without GL errors.

The browser exposed an anatomy-label loading problem before the gzip-aware loader change. The loader was corrected and verified against both forms of the actual complete map, but the test browser then disconnected. Consequently, the final anatomy overlay and the complete post-fix browser interaction sequence were not visually rechecked in that session. The test-browser failure is not counted as a successful UI check.

An additional 1,000 × 850 GPU full-frame/cropped-frame comparison was nearly identical but did not meet a strict maximum-two-level pixel-difference assertion: mean absolute channel difference 0.000658, three pixels with a difference above two, and maximum difference 133 at one pixel. The separate mathematical crop-registration checks pass. This image comparison is retained as a numerical rendering limitation rather than described as exact pixel equality; the lossless source-texture tests concern decoded image pixels, not rendered shader output.
