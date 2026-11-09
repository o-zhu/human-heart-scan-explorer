# Registered resident sections during rapid browsing

The v14/v15 application intentionally retained the last Ultra texture and its
original clipping position until the exact next image finished decoding. This
prevented an old texture from appearing at a new plane, but a fast sequence of
requests could outrun decoding repeatedly. Each finished image then belonged to
an obsolete index, leaving the displayed cut plane frozen until scrolling ended.

`ResidentSectionSource` in `public/resident-sections.js` supplies an immediately
available fallback from the scan volume already loaded in memory. It does not
fetch, decode or prepare another donor-wide dataset. A section is sampled at the
requested normalized coordinate in the original scan axes. Pixels retain the
native resident grid in-plane; only the section-normal coordinate is linearly
interpolated when a requested plane falls between resident slices. Source-aligned
requests retain the exact byte values. The existing shared CT transfer applies
windowing, brightness, cleanup and optional anatomy colors afterward.

These are explicitly **resident-resolution previews**, not Ultra images. The
returned object carries its actual in-plane spacing, original XYZ axis, requested
index and position, full physical layout, and `resident`/`preview` flags. A true
current Ultra or Detailed section should take precedence. The application must
continue rejecting late results for obsolete positions, and replace a current
preview with its current fine image without moving the plane.

## API and memory

```js
const sections = new ResidentSectionSource();
sections.setVolume(volumeData, volumeMeta);
const section = sections.get(axis, normalizedPosition, requestedIndex);
```

`get()` returns `null` until a source volume exists. Source replacement clears
the cache and changes the generation in result keys. There is no asynchronous
work inside `get()` and no dependency on the downloaded Ultra-image inventory.

The default cache retains at most two results per axis and 4 MiB total. A result
larger than the budget can still be returned but is not retained. Exact cached
requests reuse their arrays. Evicted arrays are never overwritten because a CT
card or queued GPU frame may still reference them. Blindly recycling those
arrays would also defeat the renderer's data-identity upload checks.

## Native CPU extraction measurements

The benchmark loads every donor's low and high volume through the actual
production worker, verifies each encoded and decoded part against its manifest,
then times section extraction. Requests jump and reverse rather than stepping
only through adjacent slices. Half lie between resident source planes. Timing
includes new result arrays and bounded cache bookkeeping; it excludes volume
loading, color conversion, Canvas, GPU, network and browser input latency.

| High resident volume | X median | Y median | Z median |
| --- | ---: | ---: | ---: |
| LADAF-2021-17 | 4.23 ms | 0.75 ms | 0.51 ms |
| S-20-29 | 5.41 ms | 0.63 ms | 0.45 ms |
| S-20-28 | 4.30 ms | 0.75 ms | 0.47 ms |

X sections traverse the volume at a large memory stride and cost more than the
contiguous Y/Z rows. Their high-volume 95th-percentile times were 5.16–7.06 ms,
with a maximum of 9.07 ms in this run. The six retained high-volume sections
occupy approximately 1.39–1.46 MB, depending on the donor. Low-volume medians
range from 0.12–1.33 ms. Full samples are in `benchmark.json`.

This supports coalescing section-card work and avoiding a new CPU extraction on
every wheel event. Where supported, the GPU can sample the existing resident
volume through its usual full-output cut-face transfer while CPU extraction is
reserved for the CT cards and software renderer.

## Verification

Six focused tests pass. They check independent scalar XYZ sampling, every source-
aligned byte in test volumes, fractional planes, nonuniform spacing, physical
frame orientation, long jumps and reversals, unchanged earlier published arrays,
cache bounds, source invalidation, cold-before-volume behavior, and invalid-input
handling.

```sh
node --test tests/resident-sections-v16.mjs
node scripts/benchmark-resident-sections-v16.mjs
```

The helper cannot recreate absent Ultra structure from a coarser resident volume.
Its purpose is to keep the requested plane registered and moving while exact
fine pixels arrive. Native CPU measurements do not establish browser frame rate.
