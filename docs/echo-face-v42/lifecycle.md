# Cut-face lifecycle and fallback regression results

## Result

**43 tests passed, 0 failed, 0 skipped.** The focused v42 suite contributes
23 checks; the existing exact-raster, section-cache and workspace-transition
suites contribute another 20.

```sh
node --test tests/echo-cut-face-v42.mjs tests/fine-exact-raster-v3.mjs tests/fine-section-store-v40.mjs tests/echo-refinement-transition-v40.mjs
```

The new suite can also run independently:

```sh
node --test tests/echo-cut-face-v42.mjs
```

| Suite | Passed | Scope |
|---|---:|---|
| `echo-cut-face-v42.mjs` | 23 | Complete-face bounds, actual Echo lifecycle, CT preservation, failure/retry, CPU and picking parity |
| `fine-exact-raster-v3.mjs` | 5 | Exact sampling versus broader free-probe reuse, strict cache/raster identity, worker forwarding |
| `fine-section-store-v40.mjs` | 10 | Exact saved pixels, corruption recovery, cancellation, memory/storage limits and quota failure |
| `echo-refinement-transition-v40.mjs` | 5 | Retained completed cleanup geometry, compatibility and cancellation across workspace transitions |

## Focused v42 coverage

The tests run the production `EchoModule` methods for plane selection,
sampling, cap presentation, CT painting, leaving and entering the page. Time,
asynchronous source responses and DOM/canvas output sinks are controlled; the
rendering lifecycle is not reimplemented inside the fixture.

- A complete face uses a separate exact raster on the same physical plane.
  Full-face completion leaves the CT sample object, source bytes, crop,
  dimensions and painted canvas unchanged.
- A fine ROI alone remains labelled **Preview** in 3D. The completed CT crop
  independently reports its own detail, without inheriting full-face loading
  or error status.
- Prepared crops, already complete crops, adjusted views and cleanup-off
  comparison retain their intended request and persistence behavior.
- Late ROI, full-face and coarse responses cannot replace the current fine
  view. Changing views or leaving aborts pending work; re-entry starts a new
  request.
- Incomplete, relabelled, malformed and invalid-size/spacing results are
  rejected. Failure keeps the current source visible, displays the relevant
  **Retry Detail** action and can recover through the actual retry lifecycle.
- Five cases execute the actual production CPU worker in a VM and compare its
  result to production `pickVolume`. They cover resident sampling outside the
  crop, coarse-support rejection, cleanup-off comparison, and the difference
  between cleaned and uncleaned cap pixels. The actual `CPUVolumeRenderer`
  message path is checked for preserving `cleaned` provenance.

## Existing assertion correction

The TG midpapillary exact-raster test previously compared a canonical sampler
plane to an entire controller object containing extra acquisition metadata.
The test now compares all six physical raster fields exactly: `center`,
`right`, `up`, `normal`, `width` and `height`.

Before changing that assertion, `EchoModule.getPlane()` and the entire
`ultra-volume-core.js` source were verified unchanged against v73 commit
`831198eeede3a6e0afac12fc644e4862e60527b9`. This correction does not relax any
coordinate, orientation, crop or exact-cache tolerance assertion.

These controlled regressions are not a browser appearance, physical iOS,
download-performance or clinical-validity test. The targeted native fine-mesh
comparison and the all-donor/view audit provide separate rendering evidence.
