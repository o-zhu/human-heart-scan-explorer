"""Independent clinical-orientation measurements of an existing pose audit.

This reads exported poses; it does not create acquisitions, modify production
geometry, or imply that approximate specimen landmarks are clinical ground truth.
Usage: python3 scripts/echo-clinical-review-v5/measure-defaults.py [audit.json] [out.json]
"""
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs/echo-alignment-v5/current.json"
OUTPUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "docs/echo-clinical-review-v5/defaults.json"


def sub(a, b):
    return [x - y for x, y in zip(a, b)]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def scale(a, factor):
    return [x * factor for x in a]


def length(a):
    return math.sqrt(dot(a, a))


def unit(a):
    value = length(a)
    if value < 1e-12:
        raise ValueError("Degenerate direction in exported pose")
    return scale(a, 1 / value)


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def angle(a, b):
    return math.degrees(math.acos(max(-1, min(1, dot(unit(a), unit(b))))))


raw = SOURCE.read_bytes()
audit = json.loads(raw)
model = next(m for m in audit["models"] if m["donor"] == "ladaf-2021-17")
frame = model["tee"]
axes = [frame[key] for key in ("left", "superior", "anterior")]
landmarks = frame["landmarksMm"]
rows = [r for r in audit["rows"] if r["donor"] == "ladaf-2021-17"
        and r["planeReference"] == "refined" and r["adjustment"] == "baseline"]
if len(rows) != 56 or len({r["id"] for r in rows}) != 56:
    raise ValueError("Expected exactly 56 unique primary-donor refined default poses")


def direction_local(vector):
    return [dot(vector, axis) for axis in axes]


def position_local(point):
    return [v / frame["scale"] for v in direction_local(sub(point, frame["originMm"]))]


measurements = []
for row in rows:
    pose = row["plane"]["acquisitionPose"]
    origin, beam, normal = pose["originMm"], unit(pose["beam"]), unit(pose["normal"])
    fit = pose["contextFit"]
    item = {"id": row["id"], "mode": row["mode"], "originLocalLSAMm": position_local(origin),
            "beamLocalLSA": direction_local(beam), "fit": fit}
    if "markerDirection" in pose:
        item["markerLocalLSA"] = direction_local(pose["markerDirection"])
        item["markerReferenceAngleDeg"] = angle(pose["markerDirection"], pose["markerReference"])
    if "shaft" in pose.get("instrument", {}):
        item["shaftLocalLSA"] = direction_local(pose["instrument"]["shaft"])
    item["landmarks"] = {}
    for name, point in landmarks.items():
        delta = sub(point, origin)
        depth = dot(delta, beam)
        item["landmarks"][name] = {"beamDepthMm": depth,
            "rayDistanceMm": length(sub(delta, scale(beam, depth))),
            "planeDistanceMm": abs(dot(delta, normal)), "beamAngleDeg": angle(delta, beam)}
    item["axisProxyAnglesDeg"] = {
        "apexToAorticRegion": angle(beam, sub(landmarks["aorticLumen"], landmarks["apex"])),
        "leftVentricleCenterToAorticRegion": angle(beam, sub(landmarks["aorticLumen"], landmarks["leftVentricle"])),
    }
    measurements.append(item)

by_id = {row["id"]: row["plane"]["acquisitionPose"] for row in rows}
pairs = []
for first, second in (("a4c", "a2c"), ("a2c", "a3c")):
    a, b = by_id[first], by_id[second]
    axis = unit([x+y for x, y in zip(a["beam"], b["beam"])])
    ma = unit(sub(a["markerDirection"], scale(axis, dot(a["markerDirection"], axis))))
    mb = unit(sub(b["markerDirection"], scale(axis, dot(b["markerDirection"], axis))))
    pairs.append({"from": first, "to": second,
        "signedMarkerRotationAroundMeanBeamDeg": math.degrees(math.atan2(dot(axis, cross(ma, mb)), dot(ma, mb))),
        "contactDisplacementMm": length(sub(a["originMm"], b["originMm"]))})

report = {"scope": "Independent orientation/landmark diagnostics, not clinical registration or validation.",
    "sourceAudit": str(SOURCE), "sourceAuditSha256": hashlib.sha256(raw).hexdigest(),
    "auditedProductionHashes": audit["sourceHashes"], "frame": frame,
    "definitions": {"LSA": "patient left, superior, anterior in the fixed illustrative frame",
        "rayDistanceMm": "Perpendicular distance to the infinite central beam line; beamDepthMm distinguishes points behind the probe.",
        "axisProxies": "Broad specimen annotations only; neither proxy is a measured LVOT or flow axis.",
        "markerPair": "Signed rotation after projecting both physical markers onto the plane perpendicular to their mean beam; this is not a scanner clock-face measurement."},
    "apicalPairs": pairs, "rows": measurements}
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"output": str(OUTPUT), "poses": len(measurements),
                  "sourceAuditSha256": report["sourceAuditSha256"], "apicalPairs": pairs}))
