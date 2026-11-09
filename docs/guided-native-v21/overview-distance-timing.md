# Overview distance-validation timing

The first whole display LOD finished in 572.49 seconds, including final
simplification, encoding and unchanged validation. Its record contains all
816,640 original leaf samples for the forward comparison
and 4,096 display samples for the reverse comparison. Reverse validation visited
2,140 original source leaf groups. At the time of this assessment, the detail
LOD was still running; this document does not claim a finished whole overview.

[The timing record](overview-distance-timing.json) and
[executed checker](verify-overview-distance-timing.py) document a bounded,
read-only probe conducted while the original build continued. It used one
process, one thread and a hard 1 GiB address-space limit. Peak resident memory
was 422,948,864 bytes; the entire probe took 2.59 seconds. The source code,
stored overview artifact, actual sample coordinates and distance-result arrays
are identified by hashes. No production metadata, numerical settings, source
objects or running process were changed.

| Measured operation | Seconds |
|---|---:|
| Construct polydata for the actual 1,499,999-triangle display | 0.0271 |
| Initialize its implicit-distance locator | 0.6863 |
| Bulk query for 1,024 actual original reference samples | 0.0180 |
| Scalar queries for the same samples on the same locator | 0.0182 |
| Unchanged `closest_distances` helper, including setup | 0.7206 |
| Decode and exactly weld one original 448,650-triangle leaf | 0.3145 |
| Initialize that leaf's distance locator | 0.3284 |
| Query 32 actual original leaf samples | 0.00045 |

Bulk and scalar queries returned bit-identical arrays. The unchanged helper
also returned the identical result. There is no evidence here of an avoidable
bottleneck in the bulk `FunctionValue` call itself. The reverse comparison
re-decodes and welds each visited original leaf, then initializes a new locator.
Repeating that setup across thousands of groups is the likely dominant cost.
These measurements are a small concurrent probe, not a complete phase profile
or an isolated throughput benchmark; the dense leaf is not an average leaf.

The active detail validation was left unchanged. All original samples and
numeric methods remain intact. Forward and reverse geometric error statistics
are reported separately in the eventual overview manifest. Their scope is the
lossy navigation display relative to the original step-4 surface, not the
fidelity of the native archive or anatomical accuracy.
