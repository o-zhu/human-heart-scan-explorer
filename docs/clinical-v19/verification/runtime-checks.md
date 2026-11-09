# Clinical pilot runtime checks

The v19 clinical pilots passed **21 focused checks**: 11 data/worker checks and
10 DOM/event checks. These checks run locally without a browser, HTTP server,
production request, or graphics driver. The separate native EGL checks exercise
the production volume shaders; see `clinical-native-render.json` and the source
comparison images in this directory.

## Commands

From the repository root, with an installed LinkeDOM ESM entry point:

```sh
node tests/clinical-v19.mjs /absolute/path/to/linkedom/esm/index.js
node tests/clinical-ui-v19.mjs /absolute/path/to/linkedom/esm/index.js
```

The first file also runs its data checks without the LinkeDOM argument, skipping
only its DOM boot check. No clinical source download is required: the tests use
the prepared assets in `public/assets/clinical-v19/`.

## Data and loading evidence

- Every one of the **45 cMAC files** and **41 unique SlicerHeart files** matches
  its declared compressed size and SHA-256. All gzip outputs match their declared
  decoded SHA-256 and exact volume dimensions. The total unique compressed frame
  data is **127,324,423 bytes**.
- cMAC native geometry retains the cardiac crop's DICOM affine, MRI's 3 mm source
  slice thickness versus 1.5 mm stored interval, native ultrasound sample grid,
  cine slice timing variation, and the unregistered/unsynchronized pairing flag.
- SlicerHeart's overview and native reference cover the same physical voxel
  support. Overview sample centers have the required half-native-voxel shift.
  Native detail/reference preserve source spacing. Frame 20 reuses frame 0;
  normal playback loops over the 20 unique volumes.
- The actual frame worker decodes measured bytes and rejects bad checksums,
  incorrect decoded lengths, and failed HTTP responses.
- Selected phases take priority over neighbor preparation. Rapid requests
  coalesce to the newest queued selection, repeated requests share one decoder,
  and the decoded LRU obeys its memory bound.
- Late worker replies cannot repopulate a disposed store. Late phase/series
  completions cannot replace a newer accepted view.

## Interface evidence

The DOM fixture executes the actual clinical application and appearance
controller. GPU rendering and transport are substituted with bounded fixtures;
native section extraction, event handlers, state transitions, and display
controls are real production code.

- The existing application routes clinical source selections before initializing
  HOA section/fine-volume banks. One selected acquired volume enables the first
  view; an entire cine is not a startup requirement.
- MRI, CT, and ultrasound metadata and source-scale labels follow the selected
  series. Sections snap to acquired integer sample planes, including even-sized
  grids, and wheel/slider input updates the linked cutaway.
- Window adjustments use the active series' intensity scale and leave source
  bytes and geometry threshold unchanged. Reset restores that series' profile.
- Series data and metadata switch together. A failed replacement preserves the
  previous available series and permits a retry.
- Static MRI/native CT references disable playback. Moving CT loops omit the
  duplicated closing volume; the native valve detail opens at its reviewed
  source phase and plane. The whole-heart MRI's default camera distance is 2.0.
- Paired echo uses its own acquired ultrasound phase and section controls. MRI
  windowing does not fetch or alter ultrasound data. The interface labels the
  views as separate acquisitions without spatial registration or synchronized
  phases. Unsupported Probe Lab and anatomical labels remain unavailable.
- Saved whole-organ/translucent links restore source, phase, camera, display
  mode, supported palette, threshold, window, and clipping state. Both standard
  and prefixed fullscreen controls target the complete comparison wrapper.
- Shared MRI/echo comparisons restore the independent echo phase and section.
  Selecting the echo as the primary volume leaves comparison mode, keeping
  the separate-acquisition label specific to MRI-versus-echo comparisons.

## Limits

These checks do not measure browser frame rate, user-device input latency,
real-world transfer time, browser layout, or clinical anatomical accuracy.
Native EGL captures are offscreen shader verification, not browser screenshots.
Clinical intensity surfaces remain exploratory displays; this release does not
introduce validated chamber segmentation, MRI/echo registration, synthetic
intermediate motion, or fine detail absent from the original sampling.
