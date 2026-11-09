# Echo windows: measured Ultra sections and independent clinical cine

**Historical v6 release record.** The current equal-pane interface, native CT
display, streamed adjusted planes, and revised cine collection are documented
in [the v7 release record](../echo-v7/README.md).

## Implemented behavior

All **13 existing preset planes** now have real reformats from the **79.4 µm**
HiP-CT display volume. The 3D cut face receives the full grayscale density
texture, either 1525 × 1525 or 1525 × 2011 pixels (landscape planes are rotated).
The selected preset loads first. A lower-resolution section from the currently
loaded volume is shown immediately while the Ultra transfer completes.
Returning to a cached preset installs its Ultra texture immediately.

The collection is **8,527,994 bytes** across **12 unique lossless WebP files**.
The papillary TTE and transgastric presets share identical prepared pixels and
therefore share one file. All 13 prepared images decode with **zero pixel error**
against the reformatted 8-bit source arrays. Losslessness describes the WebP
encoding; the display source was already windowed from the original intensities
and conservatively cleaned. It is not a lossless substitute for the full raw
16-bit research scan.

Geometry has not been changed or clinically validated. The same existing
approximate reference planes are preserved. The source voxel spacing is 79.4 µm;
rounding each exact original plane extent to an integer image dimension changes
the in-plane sampling interval by less than 0.04 µm. Both source spacing and
actual horizontal/vertical pixel spacing are recorded in the manifest.

Offsetting, tilting, or rotating a preset produces a different plane and uses the
currently loaded volume. The displayed resolution changes to that volume's
actual source spacing. **Reset plane** restores the prepared Ultra image. The
same fallback applies when the user disables **Clean scan**, because the prepared
Ultra textures contain the conservative cleanup mask. A source texture is never
reused on a mismatched plane.

## Responsiveness and memory

- The selected preset owns a foreground request slot. Older work is demoted and
  excess speculative requests are aborted, so rapid preset changes do not wait
  behind an obsolete transfer.
- At most two transfers run, with at most one speculative transfer. After the
  selected preset settles, one neighboring preset may load after 700 ms of idle
  time. There is no automatic full-bank download. Saving data or hiding the page
  suppresses the neighbor request.
- Leaving Echo stops queued and in-flight speculative work and pauses the cine.
  Decoded useful pixels remain in a **24 MiB LRU cache**.
- A worker decodes WebP through `createImageBitmap` and `OffscreenCanvas`, extracts
  R8 density, and transfers the density buffer back without an additional copy.
  Older browsers without that worker capability use a main-thread canvas
  fallback and retain the ordinary volume display if image decoding fails.
- The small 2D preview is bounded to a 640-pixel longest edge. Its geometry and
  mask samples are cached. A small color lookup handles contrast and palette
  changes, while the full-resolution texture remains on the 3D cut face.
- Request IDs prevent old images from replacing a newer plane. A late coarse
  worker result also cannot replace an already completed Ultra section.

## Clinical cine collection

The module includes **12 actual ultrasound movies**, hosted as H.264 MP4 files
alongside the application, with native playback controls, scrubbing, speed,
looping, and a wider comparison option. Video is initially paused, always muted,
and contains no audio track. The movie is adjacent to the 3D cutaway. Only the
selected movie downloads in full, with visible progress, while its poster is
shown. Once it is complete, the native video element receives a local
`video/mp4` Blob URL. Scrubbing therefore uses the downloaded movie and does not
depend on HTTP byte-range support from the site's static asset host. A first
uncached selection must finish its small transfer before playback; returning to
a retained movie needs no transfer.

`echo-media-cache.js` admits only the catalog's local MP4 path pattern and
enforces the catalog's exact byte count, a **4 MiB maximum per movie**, and an
**8 MiB LRU limit for retained movie URLs**. The largest movie is 4,013,030
bytes. A single selected fetch uses an input buffer bounded by that movie's
declared size; SHA-256 is checked where Web Crypto is available. Browser decoder
memory and temporary Blob creation are separate from the retained cache budget.
No other movie is prefetched. A new selection or module exit aborts the old
transfer and guards against late completions. The active native source is
detached before its cache pin is released; evicted URLs are revoked, and
destruction revokes all remaining URLs. Playback can continue across selections
after the user starts it, but initial entry and reentry stay paused. Failed
transfers or playback expose a retry without a repeated automatic retry loop.

Each movie is an independent acquisition of another person. The static fixed
specimen has no cardiac cycle, and these movies are **not spatially registered
or synchronized** with it. The UI states this beside the cine. Matching means
the named clinical view family only. The fixed specimen also has collapsed
cavities and other preparation-related differences from a living heart.

| CT preset | Reference movie | Source and credit | License |
|---|---|---|---|
| PLAX | Normal parasternal long-axis | Nigist Taddese — The POCUS Atlas | CC BY-NC 4.0 |
| PSAX, papillary | Normal papillary short-axis | Felipe Urriola — The POCUS Atlas | CC BY-NC 4.0 |
| PSAX, mitral | Mitral-to-papillary sweep | Hannah Kopinski, Lindsay Davis, Matthew Riscinti — The POCUS Atlas | CC BY-NC 4.0 |
| A4C | Normal apical four-chamber | Hannah Kopinski, Lindsay Davis — The POCUS Atlas | CC BY-NC 4.0 |
| A2C | Normal apical two-chamber | Justin Bowra — The POCUS Atlas | CC BY-NC 4.0 |
| A3C | Normal apical three-chamber | CardioNetworks: Vdbilt / I. A. C. van der Bilt | CC BY-SA 3.0 |
| Subcostal | Normal subcostal four-chamber | Hannah Kopinski, Lindsay Davis, Matthew Riscinti — The POCUS Atlas | CC BY-NC 4.0 |
| ME 4C | Published ME four-chamber loop | Nazerian et al., supplementary video 1a | CC BY 4.0 |
| ME LAX | Published ME long-axis with color Doppler | Nazerian et al., supplementary video 1b | CC BY 4.0 |
| ME 2C | Published ME two-chamber loop | Nazerian et al., supplementary video 1c | CC BY 4.0 |
| Bicaval | Published ME bicaval loop | Nazerian et al., supplementary video 1d | CC BY 4.0 |
| TG SAX | Published transgastric short-axis loop | Nazerian et al., supplementary video 1e | CC BY 4.0 |
| ME AV SAX | No exact reusable cine selected | Other TEE references are available in the selector with their own names | — |

The POCUS Atlas mitral short-axis recording sweeps toward the papillary muscles;
the UI explicitly describes that motion. The TEE long-axis recording includes
color Doppler and is labeled accordingly. The TEE publication does not designate
each individual reference loop as normal, so these are labeled **published
clinical teaching loops**, without inventing a normal diagnosis.

The video files total **14,455,544 bytes**; posters add **320,230 bytes**. The TTE
files retain native spatial resolution (440–624 pixels wide). TEE retains
1280 × 720 or 1920 × 1080 pixels. Every decoded source frame was preserved;
there is no generated motion or artificial upscaling. Original source
annotations and credits remain visible. Odd dimensions were padded with at most
one black row or column for H.264. Original audio was omitted. For WMV sources,
the video-only duration is shorter than the container duration, which included
audio timing and padding; the number of source video frames is unchanged.

## Primary sources and license evidence

Sources and license pages were checked on 2026-11-04. The manifest records every
direct download URL, source page, source hash, prepared hash, author, license,
modification, dimensions, frame count, duration, and encoded size. This notice
applies to the media assets; it does not change the software license.

1. **The POCUS Atlas — Normal Cardiac Anatomy**:
   <https://www.thepocusatlas.com/normal-cardiac-anatomy>.
   The original catalog names each view and its contributor. The primary legal
   page, <https://www.thepocusatlas.com/legal>, has a **Licensing** heading that
   explicitly links **Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**
   to <https://creativecommons.org/licenses/by-nc/4.0/>. The corresponding web
   retrieval in this session exposed that declaration at lines 41–43. Reuse of
   these six hosted clips is subject to that noncommercial license, with the
   displayed contributor credits, source links, and modification notice.

2. **CardioNetworks / ECHOpedia — A3Cnormal**:
   <https://commons.wikimedia.org/wiki/File:A3Cnormal_(CardioNetworks_ECGpedia).avi.webm>.
   The primary file record identifies CardioNetworks: Vdbilt as author, describes
   a normal apical three-chamber view, and specifies **CC BY-SA 3.0** with verified
   copyright-holder permission. License:
   <https://creativecommons.org/licenses/by-sa/3.0/>. The derived MP4 and poster
   are offered under the same license. No diagnostic annotations were removed.

3. **Nazerian et al. (2020), The Ultrasound Journal 12:41**:
   “Transesophageal echocardiography (TEE) in cardiac arrest: results of a
   hands-on training for a simplified TEE protocol.” DOI:
   <https://doi.org/10.1186/s13089-020-00189-0>.
   Primary article and supplemental links:
   <https://link.springer.com/article/10.1186/s13089-020-00189-0>.
   Additional files 1–5 are teaching views 1a–1e. The article's rights section
   specifies **CC BY 4.0** for the article and included material unless separately
   credited; no separate restriction was identified for these supplementary
   clips. License: <https://creativecommons.org/licenses/by/4.0/>.

4. **Measured specimen source**:
   <https://human-organ-atlas.esrf.fr/datasets/1659197537>.
   Existing scan provenance and credit in the application remain applicable to
   the prepared CT display textures.

## Validation and reproduction

```sh
python scripts/prepare_echo_ultra_v6.py
python scripts/prepare_echo_media_v6.py
node --test tests/echo-v6.test.mjs
node --test tests/echo-v6-media-cache.test.mjs
python tests/echo-v6-assets.py
node tests/echo-v6-ui.mjs /path/to/test-only/linkedom/esm/index.js
```

The asset check verifies encoded hashes, decoded-pixel hashes, dimensions,
losslessness, metadata completeness, all 13 preset mappings, all 12 actual video
streams, and frame counts. It independently converts renderer-world coordinates
back into source voxel coordinates and checks a 31 × 31 sample grid per plane.
The tiny permissible one-level difference comes from the previously exported
world frame's 9-decimal rounding; a transposition, wrong crop origin, mirroring,
or misplaced plane would fail this check.

The JavaScript tests exercise current-request priority, preemption, bounded
speculation, pause/cancel behavior, cache eviction, retry after failure,
duplicate-request sharing, preview orientation and flip, and late coarse-result
protection. A separate test DOM checks the actual Echo template, named cine
mapping, explicit missing-view behavior, muted initial pause, playback intent,
speed, loop, enlargement, and pause on leaving. Eight media-cache tests cover
full selected-only delivery, aborted and stale work, bounded LRU retention,
active-source pins, malformed/truncated payloads, checksums, and URL cleanup.
The actual Echo DOM test covers 13 cine behavior groups, including visible
progress, rapid selection races, leave/reentry, explicit retry, and URL eviction
without revoking an attached video source. Native media APIs and object URL
creation/revocation are mocked in that test; actual browser playback and seeking
are not claimed. Its result is
`ui-validation.json`; the test DOM library is not a production dependency.
Visual review sheets are `preset-contact-sheet.jpg` and
`cine-contact-sheet.jpg` in this directory. Browser UI playback was not exercised
here because the session's browser policy blocked reloading the local site;
validation uses actual media decoding, source registration, and state tests.

## Host integration

The existing `EchoModule` public API is preserved. The host continues loading
`public/assets/echo-textures.json`; `setPresetTextures` accepts its `textures`
wrapper. The cine catalog is lazy-loaded internally on entering the module, so
no additional host call is required. `setMediaCatalog(catalog)` is available for
hosts that prefer supplying it. `warmPreset(key)` only starts a speculative
texture request while Echo is active. Include the new
`public/echo-texture-worker.js` and `public/echo-media-cache.js` in deployment
alongside the module. MP4 filenames and media bytes are unchanged; no custom
Worker route or asset-binding change is required for cine delivery.
