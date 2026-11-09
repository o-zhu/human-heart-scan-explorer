# Ultra prefetch, reference echocardiography and Probe lab

## Delivered experience

The explorer now prioritizes the selected 79.4 µm section immediately, prepares
nearby sections while the user browses, and reuses decoded images synchronously.
Echo windows use measured Ultra reformats at all 13 prepared planes and pair them
with openly licensed clinical ultrasound reference movies. The new Probe lab
lets the user position and steer a virtual probe while a matching CT cutaway,
measured CT sector and simulated ultrasound sector update together.

Tissue / space remains the initial material. These additions retain the existing
reconstruction, anatomical overlays, chamber and valve views, and native atlas.

## Ultra section scheduling

The foreground request starts immediately, independently of the 85 ms debounce
used for orthogonal card work. The scheduler shares transfers and image decoding
between the selected cut face, section cards and speculative neighbors.

In normal conditions, the short look-ahead is three sections in the scrolling
direction and two behind. After 180 ms without another focus change, it can
expand to eight ahead and four behind, subject to a 10 MiB current-axis encoded
budget. The two other visible sections and their nearest neighbors have lower
priority. A newly selected face can preempt lower-priority network requests.
Recent focused transfers are retained briefly to support a direction reversal.

The image decoder runs in a module worker when worker canvas support is available.
Decoded density arrays transfer to the page without another pixel-buffer copy.
An older browser can use the same decoder on the main thread with yielding during
grayscale extraction. Changing sections cancels stale consumers; a shared image
continues loading if another current consumer still needs it.

| Resource | Bound |
|---|---:|
| Decoded Ultra section cache | 48 MiB |
| Encoded images in memory | 12 MiB |
| Encoded images in persistent Cache Storage | 96 MiB |
| Queued persistent writes | 16 MiB |
| Derived 158.8 µm card cache | 12 MiB, at most 18 entries |
| Concurrent tasks under normal conditions | 3, at most 2 speculative |

Data Saver disables speculative neighbors. Slow connections reduce concurrency
and look-ahead. Hidden tabs and other explorer modules pause background section
work. Cache Storage is optional: storage denial falls back to bounded memory.
The app does not preload the complete approximately 508 MB hosted section bank.

The app also avoids uploading an identical cap texture repeatedly. Moving one
section retains the other cards' colored pixel caches when their source pixels
have not changed.

**Practical limit:** the first uncached section, a large jump beyond the prepared
neighborhood, or a slow connection can still require loading. No zero-latency or
browser frame-rate guarantee is implied. These changes preserve the previously
prepared lossless display pixels and their source-coordinate crop metadata.

## Echo Ultra textures

All 13 existing reference planes now have measured oblique reformats from the
79.4 µm source level. The 12 unique lossless WebP assets occupy **8,527,994 bytes**;
two equivalent short-axis references share an image. The density images are
1525 × 1525 or 1525 × 2011 pixels (including landscape orientation), with the original plane center, basis and
physical extent retained. The three-dimensional cap receives the full image;
the small section preview is sampled to at most 640 pixels for responsive display.

These are losslessly encoded *display-windowed, interpolated reformats*, not the
original quantitative 16-bit acquisition. Validation reports zero decoded
display-pixel error relative to the generated reformat. Source provenance and
exact hashes are recorded in `public/assets/echo-textures.json`.

The selected reference texture has priority, one adjacent preset can warm during
idle time, and decoded images use a 24 MiB LRU. A separate worker performs image
decoding and grayscale extraction. The loaded volume provides an initial section
while a new Ultra image arrives.

Moving, tilting or rotating away from a prepared plane uses the currently loaded
3D volume at its displayed source resolution. Resetting the plane restores its
prepared Ultra texture. The interface does not label an arbitrary coarse-volume
reformat as Ultra. Prepared images use the cleaned support; an original-scan
comparison uses the loaded original volume instead.

## Real ultrasound reference movies

The Echo module embeds **12 native cine loops** as H.264 MP4, totaling
**14,455,544 bytes**, with **320,230 bytes** of posters. Only the selected movie is
loaded; the complete library is not a startup dependency. The player supplies
play/pause, native seeking, speed selection, looping and an enlarged view.

The player fetches the selected short MP4 into a bounded Blob cache, then gives
the native video element a local object URL. Playback and seeking use that local
buffer, avoiding dependence on the static host's unsupported byte-range
requests. Only the selected clip is fetched; changing selection cancels stale
work. The largest clip is approximately 4 MB. A first uncached movie waits for
its complete download before it can play; the poster and loading state remain
visible during this step. Retained movie object URLs are limited to 8 MiB,
with at most one selected transfer and a 4 MiB input-buffer limit. The player
detaches its previous source before releasing the cache pin; eviction then
revokes unused URLs without revoking the current video source.

| Approach | Available named references |
|---|---|
| TTE | Parasternal long-axis; short-axis at papillary level; mitral-to-papillary sweep; apical four-, two- and three-chamber; subcostal four-chamber |
| TEE | Midesophageal four-chamber, two-chamber, long-axis with color Doppler, bicaval; transgastric short-axis |

An exact reusable midesophageal aortic-valve short-axis cine was not selected.
That preset says so; users may choose another explicitly named TEE reference.
The mitral short-axis movie is identified as a sweep rather than a fixed plane.
The TEE clips are published clinical teaching loops, not asserted to be normal
studies. TEE sources are 720p or 1080p; TTE sources retain their native dimensions.

The movies are independent acquisitions from other people. They are associated by
named view only: there is no patient-specific registration, shared beat phase or
motion synchronization with the preserved HiP-CT specimen.

### Media credits and reuse

Each displayed clip includes its contributor, source link, license link and
conversion note. Full per-file provenance and SHA-256 values are in
`public/assets/echo-media-v6.json`; the preparation script records the original
source files as well as hosted derivatives.

- [The POCUS Atlas normal cardiac anatomy](https://www.thepocusatlas.com/normal-cardiac-anatomy):
  six TTE clips, **CC BY-NC 4.0**. The
  [licensing page](https://www.thepocusatlas.com/legal) explicitly states this
  noncommercial license. Individual contributors are credited in the player.
- [CardioNetworks / ECHOpedia, normal A3C](https://commons.wikimedia.org/wiki/File:A3Cnormal_(CardioNetworks_ECGpedia).avi.webm):
  **CC BY-SA 3.0**, credited to Vdbilt / I. A. C. van der Bilt. The hosted
  conversion retains that license.
- [Nazerian et al., The Ultrasound Journal 12:41 (2020)](https://doi.org/10.1186/s13089-020-00189-0):
  five TEE supplementary teaching movies, **CC BY 4.0**, matched to supplementary
  videos 1a–1e.

Conversions preserve source frames and annotations, remove audio, and pad odd
dimensions by at most one black row or column for H.264 compatibility. Posters
are scaled source frames. Source license conditions continue to apply to these
media assets, including noncommercial and share-alike conditions where stated.

## Probe lab

The module uses one physical pose in millimetres to generate the probe guide,
sector geometry, full-plane CT cut face, CT sector and simulated ultrasound. A
completed frame updates the coupled views together, preventing an older result
from replacing a newer probe or volume state.

| Input | Effect |
|---|---|
| Control probe | Requests cursor capture after an explicit user action |
| W / S | Advance / withdraw along the probe beam |
| A / D | Translate sideways in the imaging plane |
| R / F | Translate out of the imaging plane |
| Captured mouse | Pan and tilt the beam |
| Alt + horizontal mouse | Rotate the imaging plane around the beam |
| Q / E | Rotate the imaging plane using the keyboard |
| Shift | Precision movement and steering |
| Escape | Release cursor capture |

There are also a drag pad, steer/rotate mode buttons, translation step buttons
and angle sliders. Unsupported or denied cursor capture leaves these controls
available. Blur, hiding the tab and leaving the module clear held keys and release
capture. Inputs keep ordinary editing behavior. The shared 3D view remains
orbitable and zoomable when the cursor is free.

Starting poses include apical long axis, parasternal long axis, ventricular short
axis and an atrial / TEE-side entry. View controls face the slice, show an oblique
cutaway, or frame the probe. Depth, sector width, gain, dynamic range and
illustrative frequency/attenuation controls are available. Shared-view links save
the probe pose; returning to reconstruction restores its earlier framing while
preserving the chosen tissue style and surface finish.

### Simulation meaning and limits

The simulation uses the measured CT anatomy for spatial location. Changes in
windowed CT intensity act as interface proxies; their beam incidence changes the
reflection contribution. A spatially fixed scatter field supplies stable speckle,
and depth attenuation, shadowing, finite-resolution blur and log compression
produce the ultrasound-style display. Processing runs in a worker with latest
pending-pose coalescing and a larger refinement after movement settles. A yielding
fallback is available if workers cannot start.

This is an **educational appearance simulation**, not a validated prediction of
clinical echocardiography. HiP-CT display intensity is not measured acoustic
impedance. The specimen has no acquired heartbeat, Doppler flow, complete chest
wall, ribs or lungs, and approximate starting positions are not registered to a
patient or physical transducer. Arbitrary probe planes use the currently loaded
317.6 µm or preview volume, with actual resolution shown. There is no claim that
these free-moving planes use the prepared 79.4 µm Echo textures.

Conceptual background:
[Kutter, Shams and Navab (2009)](https://pubmed.ncbi.nlm.nih.gov/19249113/),
*Visualization and GPU-accelerated simulation of medical ultrasound from CT
images*, DOI 10.1016/j.cmpb.2008.12.011. This implementation is a lightweight
illustrative model; it does not reproduce a validated implementation from that
paper or apply a pretrained acoustic model.

## Validation and remaining verification boundary

- Nineteen scheduler, transport, storage and decode checks are recorded in
  `ultra-prefetch-v6-verification.json`.
- Actual app state tests cover immediate Ultra dispatch, stale-result rejection,
  cache reuse, module transitions, appearance preservation and volume-load races
  in `app-state-validation-v6.json`.
- Actual Probe module integration tests cover explicit capture, denial/fallback,
  keyboard/mouse state, frame consistency, cleanup on exit and asynchronous
  re-entry in `probe-integration-validation-v6.json`.
- Source/world and crop registration tests cover orthogonal planes, all 13 Echo
  bases, physical offsets and asymmetric MPR pixel orientation.
- Echo's focused tests cover queue races, preview orientation and late-result
  protection. Asset checks verify all movie streams and independent world-to-source
  sampling on a 31 × 31 grid for each prepared plane. Its actual module DOM tests
  verify the named cine mapping and playback controls with mocked media APIs.
- Eight selected-movie cache tests cover bounded streaming, checksums, stale
  cancellation, active URL pins and eviction. Thirteen actual Echo DOM behavior
  groups cover progress, Blob attachment, rapid switching, initial paused state,
  playback continuation, leave/reentry, retry errors and final URL cleanup.
- Thirteen probe geometry/acoustic checks, including real worker coalescing and
  all four starting positions sampled from the actual heart, are recorded in
  `probe-v6-validation.json`. The matching CT/simulated sectors are in
  `probe-v6-contact-sheet.png`.
- `echo-v6/gpu-cap-validation.json` and `echo-v6/gpu-cap-review.jpg` inspect two
  new Ultra Echo cut faces with the actual production GLSL in offscreen EGL.
  Media and section contact sheets were also visually inspected.

Browser automation was blocked by the session's browser policy. The tests above
use explicit mocks for browser permission/UI behavior and native offscreen
rendering for graphics verification. They do not certify real browser pointer
lock, cine playback, responsive layout or interactive FPS. Production delivery is
checked separately by fetching the published modules, verifying source/asset
checksums, and inspecting HTTP movie range responses.

The focused production media check in `scripts/verify-production-media-v6.py`
also checks the published player/cache code, manifest and representative full
movie downloads against the local source bytes. The earlier complete delivery
check verified all 12 movie hashes and posters. Correct HTTP delivery and mocked
native media tests do not substitute for an actual Safari or other browser
playback run.
