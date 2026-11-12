# Bounded surface identity acceleration — v53

The compact Ultra stream verifies three independent identities before it can
publish geometry: the complete decoded HFM, exact positions and exact indices.
Those checks consume **797,917,878 bytes** across the unchanged
437,470,524-byte source. Previously every incremental compression round ran in
JavaScript, on the critical path between downloaded blocks and GPU uploads.

`public/surface-sha256.js` now has an optional scalar WebAssembly compressor.
It preserves `SurfaceSha256.update()` and `digest()`, the exact SHA-256 values,
the existing JavaScript fallback, and the yielding `sha256Surface()` helper.
No verification is skipped and no scientific asset or source identity changes.

## Storage and failure behavior

- Each hash retains its existing 416 bytes of explicit JavaScript working
  arrays: state, schedule and final-block storage.
- All accelerated hashes in one worker share **one fixed 65,536-byte memory
  page**. An individual copy is at most **64,512 bytes**. Calls finish
  synchronously and restore each caller's independent hash state.
- The embedded module is **8,917 bytes**, has no imports and cannot grow its
  memory. It uses ordinary scalar integer operations, with no threads, SIMD,
  external library, separate asset fetch or full-input allocation.
- `initializeSurfaceHash()` performs a known-vector self-check before enabling
  the backend. Unsupported engines, CSP rejection, failed initialization and a
  two-second compilation deadline preserve the JavaScript path.
- A runtime failure commits no partial state. The same span is replayed through
  JavaScript and acceleration is disabled for that worker. Completed hashes
  still reject further updates, and transferred input ownership remains safe.
- The async helper retains workspace waits, measured progress, cancellation and
  task yields between bounded input chunks. The surface worker initializes the
  optional backend before constructing its streaming verifiers.

The 65,536-byte figure describes explicit Wasm memory. JavaScript objects,
compiled code and engine-private storage are additional, implementation-defined
overhead; this is not a total browser process-memory measurement.

## Reviewable and reproducible source

The compressor is an original translation of the existing project's SHA-256
compression logic. `scripts/build-surface-sha256-v53.py` expresses its rounds,
schedule, bounds check and fixed memory layout, then emits both the embedded
binary and the readable [WebAssembly text](surface-sha256.wat). It needs only
Python's standard library. No external compiler or hash package is required.

```sh
python3 scripts/build-surface-sha256-v53.py --check
node --test tests/surface-sha256-v53.mjs tests/surface-sha256-v47.mjs
node scripts/benchmark-surface-sha256-v53.mjs --geometry --output docs/surface-hash-v53/validation.json
```

Run the build script without `--check` only when intentionally changing the
compressor. The exact embedded binary has SHA-256
`d659c9a9139e5ed4d5515e7e0c39fdb1216e3b06d2d638c398c3915fede217d0`.

## Measured validation

The [recorded benchmark](validation.json) used Node v24.22.1 on x64. Synthetic
results are medians of three alternating runs after warming both implementations.

| Work | JavaScript | Accelerated | Hash throughput change |
| --- | ---: | ---: | ---: |
| 96 MiB + 71 bytes, bounded incremental input | 550.7 ms | 295.0 ms | 1.87× |
| Actual HFM, positions and topology: 797,917,878 hash bytes | 4,620.0 ms | 2,442.6 ms | 1.89× |

The real-source comparison reads the immutable original Ultra through gzip in
chunks of at most 262,144 bytes. It allocates no whole decoded model and checks
all three hashes against both their pinned source identities and independent
`node:crypto` results. These timings isolate hash CPU work; download,
decompression, graphics and device-specific rendering costs are excluded.

The 13 focused checks cover standard vectors, all small padding boundaries,
unaligned input views, awkward incremental chunks, independent interleaved hash
states, immediate input-buffer transfer, fixed memory, invalid spans, unsupported
engines, CSP failure, self-check failure, hanging and late compilation, runtime
fallback, pause/cancellation, existing real Compact worker behavior, and a
stream longer than 512 MiB.

This reduces measured verification cost. It does not establish a corresponding
whole-page loading speedup, diagnose a particular historical tablet stall, or
prove Safari/iPad performance. Sequential transport storage and GPU backpressure
remain separate parts of the loading transaction.
