# Sequential surface GPU staging — v48

`surface-gpu-stream.js` accepts one bounded decoded chunk at a time. The next
chunk can be acknowledged only after a GPU fence completes. Staged geometry
does not become drawable until every position, normal and index byte has
arrived, the worker has verified the complete source and triangle decisions,
and the verified component flags have completed their upload.

## Allocation shape

Position and normal attributes each retain their original 16-bit three-channel
representation. They are allocated once and filled with subrange uploads.
Indices are allocated in separate, whole-triangle buffers of at most 2 MiB;
each buffer is drawn in its original order. A final short buffer is retained
exactly. This changes storage and submission, not geometry or triangle order.

The strict GL accounting fixture exercises the actual Ultra dimensions:

| Allocation | Bytes / count |
| --- | ---: |
| Position buffer | 77,023,134 bytes |
| Normal buffer | 77,023,134 bytes |
| Component flags | 12,837,189 bytes |
| Index bytes, all chunks combined | 283,424,220 bytes |
| Separate index buffers | 136 |
| Largest index buffer | 2,097,144 bytes |
| Maximum individual upload | 2,097,152 bytes |
| Original indices represented and drawn | 70,856,055 |

The final index buffer has 309,780 bytes. No complete decoded HFM or monolithic
283 MB index allocation is required by this uploader. These are logical API
allocations and command sizes, not a measurement of driver or browser process
memory. The final GPU geometry still retains every original index and vertex.

## Lifetime and interleaving rules

Every upload rebinds its own vertex array and buffer. Bindings are cleared
before any asynchronous wait so the working compact model can render in the
same WebGL context. Its vertex-array index and attribute bindings are never
modified by staging. A chunk's byte counter advances only after its fence.

The fence is flushed, polled in later tasks with zero wait timeout, and deleted
on success, failure or cancellation. A real event-loop yield precedes the
first poll. A finite active-polling budget catches a stuck GPU; a long delayed
timer after background suspension cannot consume minutes of inactive time.

Each staged geometry owns an abort controller. It is linked to the load signal
with ordinary abort listeners, without requiring `AbortSignal.any`. Disposal
settles pending fence and workspace waits. The optional workspace callback
receives that combined signal so a cooperative controller can also remove its
registered workspace waiter. A failed write or cleanup upload disposes every
candidate buffer and makes the session unusable; retry must start a new
candidate, preventing duplicated index chunks after a failed fence. GPU
exceptions are classified as resource failures to avoid an automatic larger
transport retry.

## Regression coverage

```sh
node --test tests/surface-gpu-stream-v48.mjs
```

The twelve cases cover the full-model allocation plan and index coverage;
exclusive asynchronous acknowledgements; live-render binding interleaving;
cleanup concurrency and readiness; malformed offsets/layouts; allocation,
upload, fence and flush errors; poisoned-session retry prevention; parent
abort/disposal; cooperative and noncooperative paused gates; context loss;
active timeout versus suspended timers; and production `FineSurfacePass`
construction and verified completion.

The fixture records strict WebGL command semantics. It does not emulate GPU
memory, Safari's graphics process, or a physical iPad. The separate complete
source/worker tests establish the geometry bytes sent to this uploader.
