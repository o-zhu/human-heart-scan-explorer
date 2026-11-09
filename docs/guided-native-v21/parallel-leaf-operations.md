# Parallel leaf precomputation

`scripts/guided-native-v21/precompute_leaves.py` is a scheduling wrapper around the unchanged numerical `Builder`. It precomputes only the exact adaptive leaves that the original recursive traversal would visit. Parent merges, final QEM, distance checks and mesh export remain sequential in the original builder after the worker pool has closed.

## Production commands

Run from the repository after the native run has completed. Do not run the original builder concurrently against the same output directory.

```bash
python scripts/guided-native-v21/precompute_leaves.py \
  --run {source-cache}/guided-native-v21/whole/run \
  --out {source-cache}/guided-native-v21/whole/overview \
  --triangles 1500000 --detail-triangles 2500000 \
  --workers 4 --rss-limit-mib 2048
```

After successful return, use the same numerical settings in the normal builder:

```bash
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 \
python scripts/guided-native-v21/build_overview.py \
  --run {source-cache}/guided-native-v21/whole/run \
  --out {source-cache}/guided-native-v21/whole/overview \
  --triangles 1500000 --detail-triangles 2500000
```

The shared defaults are group size 4, leaf face cap 750,000, merge face cap 6,000,000, intermediate factor 2, clustering cell limit 16 native voxels, constrained-QEM cell 32 native voxels, two QEM passes, 256 samples per leaf, 4,096 reverse samples, seed 210794 and 32 MiB asset limit. The wrapper passes these unchanged to the existing methods. It does not alter fingerprints or completion checks and production mode rejects an incomplete input plan.

## Isolation and resources

Only the parent constructs `Builder`, validates the complete input inventory, and writes `input-manifest.json` and `build.json`. Spawned workers receive global totals and identity plus only their assigned leaf records. A worker constructs minimal `Builder` state without calling its initializer and proves its assigned node is a leaf before invoking the existing `node()` method.

Each node path has one task. A Python audit hook permits worker writes only to that leaf's NPZ/JSON files and their temporary counterparts. Parent metadata hashes are checked before and after the pool. The C helper cache is compiled in the parent before spawning; bytecode writes are disabled. Builder, codec and C source hashes are checked throughout to reject a mixed-code run.

Four processes use one numerical-library thread each, with no parallel parent stages. At most eight futures are queued. The aggregate budget uses the parent's measured peak RSS, the sum of worker peak RSS values, and a 16 MiB multiprocessing-helper reserve. Each worker's ceiling is:

`(2048 MiB − parent peak RSS after initialization − 16 MiB) / 4`.

For example, parent peaks of 128, 256 and 512 MiB give worker ceilings of 476, 444 and 380 MiB respectively. These are budget examples, not measurements of the full run. A 64 MiB minimum worker allowance and cgroup headroom check must pass before spawning. Workers report their own RSS rather than relying on host PID translation. Completed leaf checkpoints survive exceptions; an original builder or a repeated precompute call verifies and reuses them. No native reconstruction process is controlled by this wrapper.

## Bounded numerical equivalence proof

`parallel-leaf-proof.json` records the successful eight-tile pilot. Two workers each processed a distinct leaf. Both leaf NPZ files, all six hierarchy NPZ files, and final overview/detail compressed HFM assets matched the original sequential build byte for byte. Normal traversal reused precomputed leaf files without changing their modification times. Shared metadata stayed unchanged while workers ran. An intentional second-leaf failure preserved the first checkpoint; the subsequent resume reused it.

The maximum concurrent RSS upper bound, including the separate proof driver, was **204.20 MiB**. The proof completed in **4.81 seconds**. This proves the tested scheduling equivalence and failure behavior; it is not a four-worker whole-organ speed benchmark or a guarantee that all parent merges meet the 6M cap.

Node JSON contains real elapsed times, and the final canonical node-record hash includes those times. Separate builds therefore have different timing/RSS fields and different timing-derived node-record hashes. The proof independently recomputed each actual provenance hash and compared all numerical fields; it did not rewrite production metadata.

The promoted wrapper was byte-identical to the tested prototype, SHA-256:

`9e504f9f4e659cfccfa0d38c43c9cc175b4001e098df85a9c1c74c2d656291de`

The repeatable pilot driver is `parallel-leaf-proof.py`; it uses a fresh temporary output directory by default and supports `--base` for an explicitly chosen fresh directory. It performs only the eight-tile pilot. Run it separately from production work if another proof is needed.
