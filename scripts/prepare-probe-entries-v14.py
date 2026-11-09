"""Derive external synthetic Probe Lab entries from each donor's own support.

Only the entry along an existing beam and its starting depth change. Plane
axes, density samples, segmentation and prepared Ultra images are untouched.
The result is a conservative viewing placement, not a registered skin surface.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import math

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
REFERENCE_MM = 168.0104
PRESETS = [
    ("apical", "a4c", 145, 76),
    ("parasternal", "plax", 135, 80),
    ("short-axis", "psax_papillary", 130, 84),
    ("atrial", "me4c", 135, 80),
]


def prepare(donor, write=False):
    directory = ROOT / "public/assets/donors" / donor
    path = directory / "echo-planes.json"
    planes = json.loads(path.read_text())
    support = json.loads((directory / "cleanup/manifest.json").read_text())
    assert planes["datasetId"] == support["datasetId"]
    compressed = (ROOT / "public" / support["volumeUrl"]).read_bytes()
    digest = hashlib.sha256(compressed).hexdigest()
    assert digest == support["sha256"], "Unexpected source support bytes"
    raw = gzip.decompress(compressed)
    shape = np.array(support["dimensions"])
    mask = np.frombuffer(raw, dtype=np.uint8).reshape(shape[::-1])
    z, y, x = np.nonzero(mask)
    extent = np.array(support["physicalCenterExtentUm"]) / 1000
    points = np.column_stack([
        (x / (shape[0] - 1) - .5) * extent[0],
        (z / (shape[2] - 1) - .5) * extent[2],
        (.5 - y / (shape[1] - 1)) * extent[1],
    ])
    reference = float(planes["referenceMm"])
    scale = reference / REFERENCE_MM
    # A half-cell diagonal bounds any location within an occupied support
    # sample, independent of the preset beam direction.
    cell_guard = float(np.linalg.norm(extent / (shape - 1)) / 2)
    clearance = 8 * scale
    far_margin = 5 * scale
    records = []
    for preset, frame_id, legacy_depth, angle in PRESETS:
        world = planes["frames"][frame_id]["world"]
        center = np.array(world["center"]) * reference
        up = np.array(world["up"])
        up /= np.linalg.norm(up)
        right = np.array(world["right"])
        right /= np.linalg.norm(right)
        normal = np.cross(-up, right)
        q = points - center
        toward_probe = q @ up
        lateral = q @ right
        elevation = q @ normal
        old_offset = legacy_depth * scale * .47
        # Keep already-safe origins. Do not move parasternal/cross-section
        # reference entries closer just because a tighter bound is available.
        required_offset = math.ceil((toward_probe.max() + cell_guard + clearance) * 1000) / 1000
        offset = max(old_offset, required_offset)
        radial = np.hypot(offset - toward_probe, lateral)
        needed_depth = float(radial.max() + cell_guard + far_margin)
        depth = max(legacy_depth * scale, math.ceil(needed_depth * 10) / 10)
        assert depth <= 190 * scale, "Calibrated sector exceeds the current depth limit"
        entry = {
            "key": f"{donor}:support-entry-v14:{preset}",
            "referenceMm": reference,
            "tipOffsetMm": offset,
            "depthMm": depth,
            "sourceSupportSha256": digest,
            "clearanceMm": clearance,
            "cellGuardMm": cell_guard,
            "method": "Entry along the unchanged beam beyond this donor's retained source support plus a half-cell guard and 8 scaled mm clearance; synthetic positioning aid, not registered skin.",
        }
        world["probeEntry"] = entry
        near_plane = np.abs(elevation) <= cell_guard * 1.5
        fan = near_plane & (np.abs(np.arctan2(lateral, offset - toward_probe)) <= math.radians(angle / 2))
        records.append({
            "preset": preset,
            "frameId": frame_id,
            "legacyOffsetMm": old_offset,
            "legacyDepthMm": legacy_depth * scale,
            "supportRangeAlongUpMm": [float(toward_probe.min()), float(toward_probe.max())],
            "tipOutsideWholeSupportByMm": float(offset - toward_probe.max() - cell_guard),
            "tipMovedMm": offset - old_offset,
            "maximumProjectedRadiusMm": float(radial.max()),
            "inPlaneFanSupportSamples": int(fan.sum()),
            "inPlaneFanDepthCoverage": float(np.mean(radial[fan] <= depth)),
            "entry": entry,
        })
    if write:
        path.write_text(json.dumps(planes, indent=2) + "\n")
    return {
        "donor": donor,
        "datasetId": support["datasetId"],
        "supportSamples": len(points),
        "supportSha256": digest,
        "referenceMm": reference,
        "presets": records,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Update frame metadata and preparation report")
    args = parser.parse_args()
    report = {
        "method": "Conservative source-support entry placement without plane or voxel changes.",
        "limitations": "The synthetic contact surface is not donor-registered anatomy. This verifies starting placement, not collision avoidance during arbitrary later motion.",
        "sources": [prepare(donor, args.write) for donor in ["s-20-29", "s-20-28"]],
    }
    if args.write:
        output = ROOT / "docs/probe-entry-v14"
        output.mkdir(exist_ok=True)
        (output / "preparation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({
        "written": args.write,
        "donors": [{"id": r["donor"], "presets": [{
            "id": p["preset"], "tipMovedMm": round(p["tipMovedMm"], 3),
            "clearanceMm": round(p["tipOutsideWholeSupportByMm"], 3),
            "depthMm": p["entry"]["depthMm"],
        } for p in r["presets"]]} for r in report["sources"]],
    }, indent=2))


if __name__ == "__main__":
    main()
