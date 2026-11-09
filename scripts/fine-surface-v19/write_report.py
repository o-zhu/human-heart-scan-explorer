#!/usr/bin/env python3
"""Write the concise release evidence from completed, measured surface records."""
from pathlib import Path
import hashlib
import json

ROOT=Path(__file__).resolve().parents[2]
DOCS=ROOT/'docs/fine-surface-v19'
manifest_path=ROOT/'public/assets/fine-surface-v19/manifest.json'
manifest=json.loads(manifest_path.read_text())
preparation=json.loads((DOCS/'preparation.json').read_text())
validation=json.loads((DOCS/'validation.json').read_text())
source_credit=json.loads((ROOT/'public/assets/manifest.json').read_text())
for key in ['datasetUrl','doiUrl','attribution','license','licenseUrl']:manifest[key]=source_credit[key]
source=preparation['source'];processing=manifest['processing']

rows=[];summary=[]
for item in manifest['lods']:
    check=next(v for v in validation['fullObject'] if v['lod']==item['id'])
    rows.append(f"| {item['label']} | {item['vertices']:,} | {item['triangles']:,} | {item['compressedBytes']/1e6:.2f} MB | {item['decodedBytes']/1e6:.2f} MB | {item['quantizationMaximumMm']*1000:.2f} µm |")
    summary.append(dict(id=item['id'],samplesPerDirection=check['hostedToWelded']['samples'],
                        hostedToIntermediateP95Mm=check['hostedToWelded']['p95Mm'],
                        intermediateToHostedP95Mm=check['weldedToHosted']['p95Mm'],
                        hostedToIntermediateMaximumSampledMm=check['hostedToWelded']['maximumSampledMm'],
                        intermediateToHostedMaximumSampledMm=check['weldedToHosted']['maximumSampledMm']))

table=[]
for item in validation['fullObject']:
    for key,label in [('hostedToWelded','Hosted → intermediate'),('weldedToHosted','Intermediate → hosted')]:
        s=item[key]
        table.append(f"| {item['lod']} | {label} | {s['rmsMm']:.4f} | {s['p95Mm']:.4f} | {s['p99Mm']:.4f} | {s['maximumSampledMm']:.4f} |")

local=[]
detail_source=[next(item for item in slab['lods'] if item['id']=='detail')['rawToHosted'] for slab in validation['localSource']]
compact_source=[next(item for item in slab['lods'] if item['id']=='balanced')['rawToHosted'] for slab in validation['localSource']]
for slab in validation['localSource']:
    for item in slab['lods']:
        local.append(f"| {slab['paddedSourceZRange'][0]}–{slab['paddedSourceZRange'][1]} | {item['id']} | {item['rawToHosted']['p95Mm']:.4f} | {item['hostedToRaw']['p95Mm']:.4f} | {slab['rawToSmoothed']['p95Mm']:.4f} |")

text=f'''# Fine surface experiment, v19

This is an optional, derived surface of **LADAF-2021-17**, extracted from the
existing **79.4 µm isotropic** fine display volume. It uses a four-times-finer
linear grid than the ordinary 317.6 µm display volume. It is **not** a new
19.85 µm reconstruction of the original acquisition, an independently acquired
view, or a clinically validated segmentation.

**Result:** a compact whole-heart mesh is feasible, but this compression and
smoothing level has visible costs. The detailed variant retains more small
folds than the compact variant. Native comparisons show loss of surface texture
and some small geometry, particularly in the compact mesh. Keep Interactive
volume and the measured Ultra cut faces available for fine structural review;
neither mesh is described as visually lossless.

## What was prepared

The pipeline verified the compressed and decoded SHA-256 of all
**{source['verifiedBlocks']:,} source bricks** ({source['encodedBytes']/1e6:.2f} MB
compressed), then assembled their nonoverlapping cores in a separate padded
uint8 array. The source crop is {source['sourceShapeXYZ'][0]:,} ×
{source['sourceShapeXYZ'][1]:,} × {source['sourceShapeXYZ'][2]:,} voxels.
The array and surface-processing checkpoints are research intermediates, not
startup downloads. The original bank, CT images, and Ultra cut-face textures are
unchanged.

1. Apply an isotropic Gaussian to a separate floating-point field with
   σ = **{processing['densityGaussianSigmaVoxels']:.2f} fine voxels
   ({processing['densityGaussianSigmaMm']*1000:.2f} µm)** and a three-sigma
   truncation. Extract the 0.28 intensity isosurface with VTK Flying Edges.
2. Process overlapping slabs. Retain exact shared boundary vertices and preserve
   topology in this first simplification, with a 0.0794 mm accumulated-error
   parameter. This parameter is an algorithm setting, not an independently
   verified maximum geometric-error bound.
3. Weld identical slab-border vertices and resolve rare floating-point boundary
   duplicates within a **0.0001 mm (0.1 µm)** tolerance. The largest actual weld
   displacement is **{processing['maximumWeldDisplacementMm']*1000:.4f} µm**.
   Then apply whole-object Fast Quadric Mesh Simplification to create the
   detailed level. VTK quadric decimation with its volume-preservation option
   enabled creates the compact level from that detailed geometry.
   **This final simplification is lossy and does not guarantee topology.**
4. Compute smooth vertex normals, spatially reorder triangles, quantize positions
   to 16-bit coordinates and normals to signed 16-bit components, then gzip the
   HFM1 binary. Gzip is lossless; smoothing, simplification, and quantization are
   the separate lossy steps.

Very thin or doubled sheets can produce cancelling averaged vertex normals.
Those vertices use their largest incident nondegenerate triangle's normal,
affecting shading rather than position. Only zero-area triangles are removed
before encoding; triangles that collapse to zero area after quantization are
also omitted. Each LOD's manifest records the normal-fallback count/fraction and
both removal counts, rather than hiding these effects on tiny geometry.

Whole-object VTK quadric decimation exceeded the available 8 GiB preparation
memory. The final detail stage therefore uses `fast-simplification 0.1.13` with
aggressiveness 7 in a separate process; its buffers are freed before the compact
VTK stage starts. This is a change of implementation, not a claim that memory
reduction is lossless. The output is subjected to the same distance audit below.

The fine filtered contour contained **{processing['referenceTriangles']:,}
triangles** before slab simplification and **{processing['weldedTriangles']:,}**
after the slab stage and seam welding. The hosted alternatives are:

| Level | Vertices | Triangles | Download | Decoded mesh | Maximum position quantization error |
|---|---:|---:|---:|---:|---:|
{chr(10).join(rows)}

File sizes use decimal MB. Only the selected mesh is fetched on demand, after
the normal viewer is usable. The fine surface is offered as an experiment;
Interactive volume remains available. Its fixed isosurface corresponds to the
0.28 threshold and cleaned source. Other thresholds and volume/translucent
rendering return to the ordinary renderer rather than pretending to regenerate
the mesh. Ultra cut faces continue to sample their recorded pixels.

## Measured approximation error

The audit decodes the actual hosted HFM1 files, samples points uniformly by
triangle area with a fixed random seed, and computes exact point-to-triangle
distance. The full-object reference is the welded result of the
topology-preserving slab stage. It already contains the density filtering and first
simplification, so this comparison isolates the later LOD and encoding stages.

| Level | Direction | RMS, mm | 95th percentile, mm | 99th percentile, mm | Largest sampled distance, mm |
|---|---|---:|---:|---:|---:|
{chr(10).join(table)}

The dense-source audit also rebuilt unsmoothed and smoothed 79.4 µm contours in
five separate 16-cell source slabs. Each direction uses area-weighted points in
the common interior, with a contour halo outside that interval. These rows show
the final hosted surface's distance from the unsmoothed fine-grid isosurface,
including smoothing and both simplification stages:

| Padded source Z interval | Level | Raw → hosted p95, mm | Hosted → raw p95, mm | Raw → smoothed p95, mm |
|---|---|---:|---:|---:|
{chr(10).join(local)}

Each full-object direction uses **{validation['fullObject'][0]['hostedToWelded']['samples']:,} points**.
Each local direction uses **{validation['localSource'][0]['rawToSmoothed']['samples']:,} points per slab**.
Local contour-to-contour and hosted-to-local-source measurements can overestimate
error when the closest counterpart lies outside the finite slab halo. The
raw-local-source → full-hosted-object distances do not have that target-cropping
limitation. Their larger errors show that some original fine features are
omitted; the small hosted → source errors alone would conceal that loss.

For the detailed mesh, local **unsmoothed source → hosted** 95th-percentile
distance ranges from **{min(v['p95Mm'] for v in detail_source):.2f} to
{max(v['p95Mm'] for v in detail_source):.2f} mm**, and the largest sampled distance
is **{max(v['maximumSampledMm'] for v in detail_source):.2f} mm**. For the compact
mesh, the corresponding p95 range is **{min(v['p95Mm'] for v in compact_source):.2f}–{max(v['p95Mm'] for v in compact_source):.2f} mm**
and the largest sampled distance is **{max(v['maximumSampledMm'] for v in compact_source):.2f} mm**.
These include the filtering and both simplification stages. They are the reason
to retain this as an optional display experiment rather than replace the source
volume or claim subvoxel preservation of every fine feature.

**These are sampled errors, not a Hausdorff bound.** The local audit covers five
slabs rather than every source voxel. The JSON includes tails, maxima, counts,
and both directions. Small structures can disappear or merge despite a low
typical distance. In particular, these measurements do not establish preserved
valve/chordal topology, wall thickness, or diagnostic accuracy. Review the
original measured cut faces when examining a thin structure.

The native whole-organ and valve close-up comparisons are in
[whole-surface-comparison.jpg](native/whole-surface-comparison.jpg) and
[valve-closeup-comparison.jpg](native/valve-closeup-comparison.jpg). They use the
production shaders and matched camera/transfer settings. The mesh's smoother
appearance does not itself establish greater anatomical fidelity.

## Coordinate and data contract

The mesh uses the same full-source endpoint convention as the existing Ultra
bank, with acquisition coordinates mapped to world **(x, z, −y)** and centered
on the source grid. The longest physical dimension is
**{source['longestMm']:.4f} mm**. No speculative slice registration, deformation,
or averaging of resliced axes was applied. X/Y/Z views are reformats of the same
acquisition, not independent observations.

The input is the existing cleaned and windowed **uint8 display** bank, with
source encoding interval {source['sourceWindow'][0]:,}–{source['sourceWindow'][1]:,}.
It does not restore quantitative raw intensities clipped by that earlier display
preparation. The source manifest SHA-256 is
`{source['sourceManifestSha256']}`.

Source attribution: **{source_credit['attribution']}**, [Human Organ Atlas dataset
1659197537]({source_credit['datasetUrl']}), [DOI]({source_credit['doiUrl']}).
The derived mesh follows the source's [{source_credit['license']}]({source_credit['licenseUrl']})
terms; keep this attribution and the processing disclosure when redistributing it.

HFM1 uses a 32-byte little-endian header: magic `0x314d4648`, version 1, vertex
count, index count, position offset, normal offset, index offset, and reserved
zero. Positions are three normalized uint16 values; normals are three normalized
int16 values; triangles contain uint32 indices. All offsets are aligned to four
bytes. Each asset has compressed and decoded SHA-256 records in the manifest.

## Reproduce and inspect

With the complete local fine-volume bank and the preparation dependencies:

```sh
python3 -m pip install -r scripts/fine-surface-v19/requirements.txt
python3 scripts/fine-surface-v19/prepare.py --stage all --workers 2
python3 scripts/fine-surface-v19/validate.py
python3 scripts/fine-surface-v19/write_report.py
```

Use `--work` to put several gigabytes of reproducible intermediates on an
appropriate disk. Source data are read only. The preparation script validates
completed checkpoints and writes small metadata/array checkpoints atomically;
changing preparation inputs invalidates dependent stages. This release used
VTK 9.3.1, NumPy 2.3.5, SciPy 1.17.0, and fast-simplification 0.1.13.
The latter wraps the [Fast Quadric Mesh Simplification implementation](https://github.com/pyvista/fast-simplification).

`preparation.json` records the source, every slab, measured seam accounting and
encoded assets. `validation.json` records the distance audit. Native graphics
checks are recorded separately; they do not measure browser frame rates or
user-device interaction latency.
'''
(DOCS/'README.md').write_text(text)
manifest['validationSummary']=dict(method='Area-weighted sampled surface distances; not a Hausdorff bound or clinical validation.',
                                    reference='Welded, filtered 79.4 µm intermediate after topology-preserving slab simplification; separate local raw-source audits in full report.',
                                    lossy=True,thinStructurePreservationGuaranteed=False,
                                    lods=summary,details='docs/fine-surface-v19/validation.json')
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
preparation['manifest']=manifest
(DOCS/'preparation.json').write_text(json.dumps(preparation,indent=2)+'\n')
print(json.dumps(dict(report=str(DOCS/'README.md'),meshBytes=sum(x['compressedBytes'] for x in manifest['lods']),
                      validationSha256=hashlib.sha256((DOCS/'validation.json').read_bytes()).hexdigest())))
