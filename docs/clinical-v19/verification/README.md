# Native clinical rendering review

`scripts/verify-clinical-native-v19.py` renders the actual imported arrays with the application's exported production GLSL in an offscreen EGL context. It uses the manifest's native dimensions, physical spacing, initial section, source phase, display window and camera distance. The script verifies the compressed and decoded frame hashes before rendering.

The twelve captures cover the SlicerHeart overview, native valve/outflow region and native cardiac reference, plus cMAC whole-heart MRI. For each series the script compares the initial face-on view, a modest oblique view, and a higher intensity threshold. `clinical-native-render.json` records each source-frame checksum, section, phase index, camera, exact pixel dimensions and shader checksum. These are native rendering checks; they do not measure browser loading, input responsiveness or device frame rates.

## Selected initial views

- **cMAC whole-heart MRI:** camera distance 2.0 leaves a visible margin around the cardiac field at a square viewport. The previous 1.65 starting distance clipped the displayed field; 1.85 nearly touched its edges. The inspected alternatives are retained in `additional/cmac-distance-1.85.png` and `additional/cmac-distance-2.0.png`. Camera framing does not change acquired data or the field-of-view crop.
- **SlicerHeart native valve/outflow region:** source phase index 10, original source Z index 135, corresponding to local slice 55 of the 100-slice crop. Its normalized position is `55 / 99`, exactly a native sample center. This starting point displays the central leaflet/outflow pattern more clearly than the initially selected phase 0. It is an illustrative section, not a validated anatomical annotation or an inferred ECG/physiological phase.
- **Threshold:** retain 0.36 for SlicerHeart. In the tested comparison, raising the threshold to 0.44 removes more measured low-intensity edge structure. It does not create a validated valve or wall segmentation.

The initial-view comparison at `additional/native-valve-initial-view-comparison.jpg` retains source phases 0 and 10 at original Z indices 130, 135 and 140. The current series metadata and preparation scripts record the selected view; no source frame is modified, reordered or synthesized.

## Interpretation limits

These clinical datasets are much more coarsely sampled than the preserved-heart HiP-CT source. A thresholded CT or MR intensity surface is also different from an anatomical wall segmentation: enhanced blood and neighboring tissues may be included. Smooth shading and a native-spacing cut face do not recover structures below acquired resolution. The whole-heart MRI's 1.5 mm stored slice interval overlaps 3 mm source slice thickness. The source-specific preparation documents record these distinctions.

The shared normalized display axes follow the application's source-to-world convention. Spatial anisotropy is retained through physical extents. The local clinical display is not registration between MRI and ultrasound, between either clinical case and a preserved donor, or between the scanned anatomy and the Probe Lab's illustrative torso.

No browser automation or production HTTP preview was performed in this review. Offscreen output establishes shader compilation, physical-grid presentation and the specific inspected source views, not full browser integration or diagnostic validity.
