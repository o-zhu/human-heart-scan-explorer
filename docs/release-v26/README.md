# Heart Explorer: cleanup, responsive fine planes and TEE lab

This update starts from Site version 38, source commit
`c6511a375acf30d74a664725e5857cc6b8019898`. The existing public Site address and
audience are retained. The exact published version and source commit belong in
`publication-receipt.json`; this implementation note alone is not evidence that
a deployment succeeded.

## Reconstruction

The main surface is now called **Ultra-high Fidelity**. Its internal `gentle`
profile, original mesh, threshold and measured **79.4 µm** source are unchanged.
It remains the fresh default. Existing explicit surface choices are retained.
The reviewed lumen and detached-component controls remain enabled by default
and independently reversible.

The v26 display review addresses the remaining atrial object, arterial lumen
fragments, the sheet proximal to the aortic valve, and small perivalvular/RV
candidates. The exact source selections and their protections are documented
under `../cleanup-v26/`. Frozen v25 assets remain available for comparisons.
The current masks and flag file are separately pinned to their source banks;
none of the measured CT cards, original voxel arrays or original mesh payloads
are rewritten. Material labels are interpretations for display cleanup, not a
validated diagnosis or anatomical segmentation.

Four masks use lossless X-axis bit packing. Each logical fine-source sample is
one bit; mask boundaries are not resampled. GPU shaders and CPU anatomy picking
share the same nearest-sample convention. The loader verifies source identity,
dimensions, byte counts, compressed and decoded hashes, and unused padding bits
before atomically replacing all masks. Detached-component flags retain every
original position, normal and index and are uniform over each whole triangle.

The **19.85 µm** native bank remains available in the main view as a local region
replacement and in its independent inspector. The surrounding whole-heart
surface still comes from the 79.4 µm bank. The native bank's denoised,
prior-guided processing and approximate region-selection qualifications remain.
The new display name does not change those source resolutions.

## Probe and TEE responsiveness

An in-plane sweep can now reuse an already loaded measured image, after checking
coplanarity and coverage. The image keeps its original sampling coordinates;
the accepted probe pose continues to control the instrument and scan fan.
Shifts and tilts that change the physical plane still use the actual source.

The shared pipeline also removes duplicate release-timer work, starts missing
brick reads first, bounds foreground/background concurrency separately, protects
the active plane in the decoded cache, alternates quiet neighbor warming, avoids
redundant persistent-cache misses, transfers temporary rasters directly and
cancels sibling source reads after a verification failure.

The separate whole-heart mesh job yields when Probe or TEE is active. It pauses
transport, decoded-stream consumption and final transfer. The controller also
guards cleanup loading and GPU installation, covering workspace changes after
worker completion. Interrupted cleanup retries against retained mesh bytes;
canceled selections remove their resume waiters and cannot reappear later.

| Measured case | Previous path | Updated path |
| --- | --- | --- |
| LADAF 12° sweep within a loaded prepared plane | 739 bricks; 128,512,403 additional bytes | No new brick requests or bytes; original stored pixel hash retained |
| Same sweep, local source phase | 1,242 ms | 0.52 ms |
| Actual 0.1 mm displacement, controlled 25 ms per-response latency | 5.77 s | 2.50 s; identical final pixels and source-byte count |

These are reproducible source acquisition/sampling measurements, excluding the
acoustic worker, GPU upload and browser paint. The latency fixture uses local
files with a fixed request delay, without a bandwidth throttle. It does not
measure the public server or a user's connection. A genuinely new cold plane
can still need roughly 100–130 MB. The resident preview remains visible while
verified native detail loads. Complete results, alternatives considered and
limits are in `../probe-performance-v26/README.md` and `benchmark.json` there.

## TEE lab

The separate **TEE lab** has insertion/withdrawal, shaft rotation, two-axis tip
flexion and electronic multiplane rotation from 0° to 180°. Mechanical controls
move and bend the catheter. Electronic angle changes the image basis while
keeping the physical instrument fixed. Four source-linked starting sections,
angle stops, keyboard/drag steering, camera controls and matched CT/simulated
ultrasound are included.

**Lock steering** freezes manual motion while leaving imaging controls available.
Starting views and Reset establish an unlocked reference pose. Probe and TEE
retain independent controls/bookmarks; changing workspaces restores the previous
Reconstruction camera and cutaway without discarding shared brightness changes.

The tract is authored and unregistered, and displayed insertion centimetres are
model distances. Unreviewed donors use geometric reference labels. Ultrasound is
a CT-derived proxy from a fixed specimen, with no measured motion, acoustic
impedance calibration, contact-force or collision solver. The control reference,
method and actual source/render evidence are in `../tee-lab-v26/README.md`.

## Verification and recovery

The focused evidence covers source equality, source-pinned cleanup decoding,
bit-exact CPU/GPU mask parity, reversible production renders, bounded caches,
work cancellation, original native pixels, separate TEE mechanical/electronic
motion and real app workspace transitions. Native EGL tests use production
shaders and actual source data; they do not establish browser frame rate or
clinical accuracy. Relevant test commands are in `../../LOCAL-DEVELOPMENT.md`.

`scripts/release-v26/checkpoint.py` creates a checksum-verified source overlay
and verifies every restored file. The baseline Git commit and unchanged source
banks are explicit dependencies; this is not a complete raw-scan backup.
Compact new decision ledgers are kept in source control with the code/assets.

The earlier work-in-progress Box upload was confirmed at
2026-11-06 23:56:48 UTC. A later request to open the Box recovery folder was
blocked by automatic approval review. `backup-access-status.json` records that
limit; no completed-release Box upload or readback is claimed. Prior confirmed
checkpoints are retained, and no unattended Box uploader is running.
