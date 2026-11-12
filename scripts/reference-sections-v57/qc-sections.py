#!/usr/bin/env python3
"""Independently audit prepared R8 reference planes against immutable fine bricks.

Uses a direct world-to-source transform and eight-corner interpolation in Python,
not the JavaScript rasterizer. All source/output bytes are local, hash-verified
and read-only. Contact sheets show the existing source-windowed R8 values.
"""
from __future__ import annotations

import argparse
from collections import OrderedDict
from datetime import datetime, timezone
import gzip
import hashlib
import itertools
import json
import math
from pathlib import Path
import statistics
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
MIB = 1024 * 1024
SOURCES = {
    "ladaf-2021-17": ("public/assets/ultra-volume-v7.json", "data/ultra-volume-v7"),
    "s-20-29": ("public/assets/donors/s-20-29/ultra-volume.json", "data/donors/s-20-29/ultra-volume"),
    "s-20-28": ("public/assets/donors/s-20-28/ultra-volume.json", "data/donors/s-20-28/ultra-volume"),
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_bytes())


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)


def statistics_summary(values):
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return {"count": 0}
    return {"count": len(ordered), "minimum": ordered[0],
            "median": statistics.median(ordered),
            "p90": ordered[min(len(ordered)-1, math.ceil(.9*len(ordered))-1)],
            "maximum": ordered[-1], "sum": sum(ordered)}


class SourceBricks:
    """A bounded read-only decoded cache; hashes are checked before every install."""
    def __init__(self, manifest, directory, limit=96*MIB):
        self.manifest = manifest
        self.directory = Path(directory)
        self.limit = limit
        self.cache = OrderedDict()
        self.resident = 0
        self.verified = set()
        self.loads = 0

    def get(self, index):
        key = str(index)
        record = self.manifest["blocks"].get(key)
        if record is None:
            return None
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        relative = Path(record["path"])
        assert not relative.is_absolute() and ".." not in relative.parts
        path = self.directory / relative
        assert path.is_file() and not path.is_symlink()
        encoded = path.read_bytes()
        assert len(encoded) == record["bytes"] and sha(encoded) == record["sha256"], "Source gzip hash mismatch"
        raw = gzip.decompress(encoded)
        edge = self.manifest["storedEdge"]
        assert len(raw) == edge**3 == self.manifest["decodedBrickBytes"]
        assert sha(raw) == record["rawSha256"], "Source voxel hash mismatch"
        decoded = np.frombuffer(raw, dtype=np.uint8).reshape((edge, edge, edge))
        while self.cache and self.resident + decoded.nbytes > self.limit:
            _, old = self.cache.popitem(last=False)
            self.resident -= old.nbytes
        self.cache[key] = decoded
        self.resident += decoded.nbytes
        self.verified.add(key)
        self.loads += 1
        return decoded


def source_coordinates(plane, width, height, manifest, columns, rows):
    # Directly form each pixel's physical point, then independently reorder the
    # world XYZ axes to acquisition XYZ. This does not use a scanline plan.
    u = (np.asarray(columns, dtype=np.float64)/(width-1)-.5)*plane["width"]
    v = (.5-np.asarray(rows, dtype=np.float64)/(height-1))*plane["height"]
    points = (np.asarray(plane["center"])[None, :] +
              u[:, None]*np.asarray(plane["right"])[None, :] +
              v[:, None]*np.asarray(plane["up"])[None, :])
    size = np.asarray(manifest["fullDimensionsXYZ"], dtype=np.float64)
    acquisition = points[:, [0, 2, 1]] * np.asarray([1, -1, 1])
    return acquisition*max(size-1)+(size-1)/2-np.asarray(manifest["sourceOriginXYZ"])


def audit_points(pixels, plane, manifest):
    height, width = pixels.shape
    points = {}
    def add(column, row, group):
        column, row = int(column), int(row)
        if 0 <= column < width and 0 <= row < height:
            points.setdefault((column, row), set()).add(group)
    # Exactly 1,024 spatially distributed samples before additional tissue,
    # frame-edge and source-brick-boundary samples are added.
    for row in np.linspace(0, height-1, 32, dtype=np.int64):
        for column in np.linspace(0, width-1, 32, dtype=np.int64):
            add(column, row, "uniform-grid")
    for column in np.linspace(0, width-1, 96, dtype=np.int64):
        add(column, 0, "raster-edge")
        add(column, height-1, "raster-edge")
    for row in np.linspace(0, height-1, 96, dtype=np.int64):
        add(0, row, "raster-edge")
        add(width-1, row, "raster-edge")
    nonzero = np.flatnonzero(pixels)
    if nonzero.size:
        selected = nonzero[np.linspace(0, nonzero.size-1, min(1024, nonzero.size), dtype=np.int64)]
        for index in selected:
            add(index % width, index // width, "nonzero-tissue")
    boundary_candidates = set()
    brick = manifest["brickSize"]
    for row in np.linspace(0, height-1, 24, dtype=np.int64):
        endpoints = source_coordinates(plane, width, height, manifest, [0, width-1], [row, row])
        slope = (endpoints[1]-endpoints[0])/(width-1)
        for axis in range(3):
            if abs(slope[axis]) < 1e-12:
                continue
            for boundary in range(0, manifest["sourceShapeXYZ"][axis], brick):
                column = (boundary-endpoints[0, axis])/slope[axis]
                if 0 <= column <= width-1:
                    boundary_candidates.add((math.floor(column), int(row)))
                    boundary_candidates.add((math.ceil(column), int(row)))
    boundary_candidates = sorted(boundary_candidates, key=lambda p: (p[1], p[0]))
    if boundary_candidates:
        for index in np.linspace(0, len(boundary_candidates)-1, min(768, len(boundary_candidates)), dtype=np.int64):
            add(*boundary_candidates[index], "brick-boundary-neighbor")
    ordered = sorted(points, key=lambda p: (p[1], p[0]))
    assert len(ordered) >= 1024
    columns, rows = np.asarray(ordered, dtype=np.int64).T
    groups = {group: sum(group in tags for tags in points.values())
              for group in sorted(set().union(*points.values()))}
    return columns, rows, groups


def interpolate_independently(coordinates, reader, expected_blocks):
    manifest = reader.manifest
    shape = np.asarray(manifest["sourceShapeXYZ"])
    inside = np.all((coordinates >= 0) & (coordinates <= shape-1), axis=1)
    values = np.zeros(len(coordinates), dtype=np.float64)
    floor_voxels = np.floor(coordinates[inside]).astype(np.int64)
    indices = np.flatnonzero(inside)
    brick_size = manifest["brickSize"]
    counts = manifest["brickCountsXYZ"]
    block_xyz = floor_voxels // brick_size
    block_ids = block_xyz[:, 0]+counts[0]*(block_xyz[:, 1]+counts[1]*block_xyz[:, 2])
    used = set()
    for block_id in np.unique(block_ids):
        selected = indices[block_ids == block_id]
        block = reader.get(int(block_id))
        if block is None:
            continue
        assert str(block_id) in expected_blocks, "A sampled source block is absent from the exported production plan"
        used.add(str(block_id))
        local_floor = np.floor(coordinates[selected]).astype(np.int64)
        fraction = coordinates[selected]-local_floor
        local_floor %= brick_size
        # Eight independent products (not the production nested scanline mix).
        for dz, dy, dx in itertools.product((0, 1), repeat=3):
            weight = np.ones(len(selected), dtype=np.float64)
            for axis, bit in enumerate((dx, dy, dz)):
                weight *= fraction[:, axis] if bit else 1-fraction[:, axis]
            samples = block[local_floor[:, 2]+dz, local_floor[:, 1]+dy, local_floor[:, 0]+dx]
            values[selected] += samples*weight
    return values, inside, used


def box_intersection_coverage(accepted, face, extent):
    center = np.asarray(accepted["center"])
    right = np.asarray(accepted["right"])
    up = np.asarray(accepted["up"])
    normal = np.cross(right, up)
    normal /= np.linalg.norm(normal)
    corners = np.array(list(itertools.product(*[(-value/2, value/2) for value in extent])))
    intersections = []
    for a, b in itertools.combinations(corners, 2):
        if np.count_nonzero(a != b) != 1:
            continue
        da, db = np.dot(a-center, normal), np.dot(b-center, normal)
        if abs(da) <= 1e-9:
            intersections.append(a)
        if abs(db) <= 1e-9:
            intersections.append(b)
        if da*db < 0:
            intersections.append(a+(b-a)*da/(da-db))
    assert intersections, "An acquired plane does not intersect the source box"
    face_center = np.asarray(face["center"])
    offset = float(abs(np.dot(face_center-center, normal)))
    assert offset < 1e-10
    projections = (np.asarray(intersections)-face_center) @ np.array([face["right"], face["up"]]).T
    excess = np.max(np.abs(projections)-np.array([face["width"], face["height"]])/2)
    assert excess <= 1e-8, "Full face fails to contain a source-box intersection"
    return {"sourceBoxIntersectionCount": len(intersections),
            "coplanarDistanceWorld": offset, "maximumContainmentExcessWorld": float(excess)}


def verified_raster(record, specification, bank_root):
    assert record["codec"] in ("gzip-r8", "gzip-r8-delta-v1") and record["cleaned"] is True
    for name in ("plane", "width", "height", "decodedBytes", "spacingUmXY", "sourceSpacingUm"):
        assert record[name] == specification[name], "Prepared geometry differs from the frozen export: " + name
    path = bank_root / "rasters" / (record["sha256"] + ".r8.gz")
    assert path.is_file() and not path.is_symlink()
    encoded = path.read_bytes()
    assert len(encoded) == record["bytes"] and sha(encoded) == record["sha256"]
    raw = gzip.decompress(encoded)
    assert len(raw) == record["width"]*record["height"] == record["decodedBytes"] <= 12*MIB
    pixels = np.frombuffer(raw, dtype=np.uint8).reshape((record["height"], record["width"]))
    if record["codec"] == "gzip-r8-delta-v1":
        # Independent vectorized inverse: bounded row sums fit uint32, then
        # reduce modulo 256. This does not import the runtime's prefix loop.
        sums = np.cumsum(pixels, axis=1, dtype=np.uint32)
        pixels = np.bitwise_and(sums, 255).astype(np.uint8)
    assert sha(pixels.tobytes()) == record["pixelSha256"]
    return pixels


def font(size):
    path = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


def create_contact_sheet(donor_id, source, manifest, bank_root, output):
    acquired = [view for view in manifest["views"] if not view["outsideScan"]]
    assert len(acquired) == 49
    cell_width, cell_height, gap, header = 248, 278, 12, 112
    width, height = 7*cell_width+8*gap, header+7*cell_height+8*gap
    sheet = Image.new("RGB", (width, height), "#101515")
    draw = ImageDraw.Draw(sheet)
    draw.text((gap, 18), donor_id.upper()+" / 49 measured full cut faces", font=font(25), fill="#eef3e8")
    draw.text((gap, 53), f"{source['sourceSpacingUm']:g} um source grid; original R8 window {source['sourceWindow'][0]}-{source['sourceWindow'][1]}; no added transfer", font=font(16), fill="#b8c6ba")
    draw.text((gap, 79), "Scalar-plane coverage review; same source pixels as generated bank; 7 out-of-scan views omitted; no clinical validation", font=font(14), fill="#a8b9ac")
    for number, view in enumerate(acquired):
        record = view["face"]
        pixels = verified_raster(record, record, bank_root)
        tile = Image.fromarray(pixels, mode="L")
        tile.thumbnail((cell_width-12, cell_height-58), Image.Resampling.LANCZOS)
        x = gap+(number % 7)*(cell_width+gap)
        y = header+gap+(number // 7)*(cell_height+gap)
        draw.rectangle((x, y, x+cell_width-1, y+cell_height-1), fill="#000000", outline="#354239")
        draw.text((x+8, y+6), view["mode"].upper()+"  "+view["viewId"], font=font(15), fill="#e6eddf")
        sheet.paste(tile, (x+(cell_width-tile.width)//2, y+29+(cell_height-58-tile.height)//2))
        draw.text((x+8, y+cell_height-24), f"{record['width']} x {record['height']}  |  {record['bytes']/1024:.0f} KiB", font=font(13), fill="#a8b9ac")
    path = output/(donor_id+"-full-face-contact-sheet.png")
    sheet.save(path, optimize=True)
    data = path.read_bytes()
    return {"path": path.name, "bytes": len(data), "sha256": sha(data), "width": width, "height": height,
            "display": "Original source-windowed R8 values, grayscale; Lanczos thumbnail downsampling only; no extra display transfer or synthetic anatomy."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--planes", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--bank-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--donor", choices=SOURCES)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    exported_bytes = args.planes.read_bytes()
    exported = json.loads(exported_bytes)
    assert exported["kind"] == "heart-reference-planes-v57" and len(exported["rows"]) == 168
    started = time.monotonic()
    report = {"schemaVersion": 1, "kind": "heart-reference-section-independent-qc-v57",
              "createdAt": datetime.now(timezone.utc).isoformat(), "status": "running",
              "planesSha256": sha(exported_bytes), "scriptSha256": sha(Path(__file__).read_bytes()),
              "method": "Independent direct physical-coordinate transform and Python eight-corner trilinear interpolation from immutable fine bricks. Full gzip and decoded-pixel hashes plus exact exported geometry are checked for every role. For gzip-r8-delta-v1, the inverse is an independent NumPy uint32 row cumulative sum reduced modulo 256 before checking original pixel hashes.",
              "samplePolicy": "32 x 32 spatial grid, up to 1,024 deterministic nonzero pixels, 384 edge selections and up to 768 source-brick-boundary neighbors. Categories can overlap. Every raster has at least 1,024 unique sample positions.",
              "floatingPointPolicy": "A one-level difference only within 2e-8 of an exact half-integer is reported separately as an arithmetic-order tie, never as a byte-exact point agreement.",
              "sourceCacheBytes": 96*MIB, "scope": "Scalar data, orientation, grid and full-face coverage checks; no anatomical or clinical validation, browser performance or GPU-rendering claim.",
              "donors": [], "rasters": []}
    report_path = args.output/(((args.donor+"-") if args.donor else "")+"independent-qc.json")
    for source in exported["sources"]:
        donor_id = source["donorId"]
        if args.donor and donor_id != args.donor:
            continue
        fine_path, bank_directory = SOURCES[donor_id]
        fine_bytes = (ROOT/fine_path).read_bytes()
        assert sha(fine_bytes) == source["fineManifestSha256"]
        fine = json.loads(fine_bytes)
        reader = SourceBricks(fine, args.source_root/bank_directory)
        prepared_bytes = (args.bank_root/donor_id/"manifest.json").read_bytes()
        prepared = json.loads(prepared_bytes)
        expected_source = {key: source[key] for key in ("donorId", "datasetId", "sourceKey", "sourceMaskSha256", "sourceSpacingUm", "longestMm")}
        expected_source["datasetId"] = str(expected_source["datasetId"])
        assert prepared["source"] == expected_source
        by_view = {(view["mode"], view["viewId"]): view for view in prepared["views"]}
        assert len(by_view) == 56
        donor_rows = [row for row in exported["rows"] if row["donorId"] == donor_id]
        donor_report = {"donorId": donor_id, "sourceKey": source["sourceKey"],
                        "sourceSpacingUm": source["sourceSpacingUm"], "sourceWindow": source["sourceWindow"],
                        "fineManifestSha256": sha(fine_bytes), "preparedManifestSha256": sha(prepared_bytes),
                        "viewCount": 56, "acquiredViews": 49, "outsideViews": [], "rasterRoles": 0,
                        "mismatchCount": 0, "halfIntegerTieCount": 0, "sampleCount": 0,
                        "geometryCoverage": [], "perViewDistinctEncodedBytes": []}
        report["donors"].append(donor_report)
        for row in donor_rows:
            view = by_view[(row["mode"], row["viewId"])]
            assert view["outsideScan"] == row["outsideScan"]
            assert view["outsideReason"] == row["outsideReason"]
            if row["outsideScan"]:
                assert view["ct"] is None and view["face"] is None
                donor_report["outsideViews"].append({"viewId": row["viewId"], "mode": row["mode"], "reason": row["outsideReason"]})
                continue
            coverage = box_intersection_coverage(row["acceptedPlane"], view["face"]["plane"], source["extent"])
            donor_report["geometryCoverage"].append({"viewId": row["viewId"], "mode": row["mode"], **coverage})
            donor_report["perViewDistinctEncodedBytes"].append(sum({view[role]["sha256"]: view[role]["bytes"] for role in ("ct", "face")}.values()))
            for role in ("ct", "face"):
                record = view[role]
                pixels = verified_raster(record, row[role], args.bank_root)
                width = math.ceil(record["plane"]["width"]*source["longestMm"]*1000/source["sourceSpacingUm"])+1
                height = math.ceil(record["plane"]["height"]*source["longestMm"]*1000/source["sourceSpacingUm"])+1
                assert (width, height) == (record["width"], record["height"])
                columns, rows, groups = audit_points(pixels, record["plane"], fine)
                coordinates = source_coordinates(record["plane"], width, height, fine, columns, rows)
                measured, inside, used = interpolate_independently(coordinates, reader, set(map(str, row[role]["sourceBrickIds"])))
                expected = np.floor(measured+.5).astype(np.int16)
                actual = pixels[rows, columns].astype(np.int16)
                delta = np.abs(expected-actual)
                ties = (delta == 1) & (np.abs((measured-np.floor(measured))-.5) <= 2e-8)
                mismatches = (delta != 0) & ~ties
                mismatch_indices = np.flatnonzero(mismatches)
                raster = {"donorId": donor_id, "viewId": row["viewId"], "mode": row["mode"], "role": role,
                          "codec": record["codec"],
                          "width": width, "height": height, "spacingUmXY": record["spacingUmXY"],
                          "encodedBytes": record["bytes"], "decodedBytes": record["decodedBytes"],
                          "sha256": record["sha256"], "pixelSha256": record["pixelSha256"],
                          "sampleCount": len(columns), "sampleCategories": groups,
                          "insideSourceCropSamples": int(inside.sum()), "nonzeroSamples": int(np.count_nonzero(actual)),
                          "nonzeroPixels": int(np.count_nonzero(pixels)), "pixelMinimum": int(pixels.min()), "pixelMaximum": int(pixels.max()),
                          "sampledNonemptySourceBlocks": len(used), "exactPointAgreements": int((delta == 0).sum()),
                          "halfIntegerTieCount": int(ties.sum()), "mismatchCount": int(mismatches.sum()),
                          "mismatchExamples": [{"column": int(columns[index]), "row": int(rows[index]),
                                                "actual": int(actual[index]), "expected": int(expected[index]),
                                                "sourceCoordinate": coordinates[index].tolist(),
                                                "interpolatedValue": float(measured[index])}
                                               for index in mismatch_indices[:8]]}
                report["rasters"].append(raster)
                donor_report["rasterRoles"] += 1
                for key in ("sampleCount", "mismatchCount", "halfIntegerTieCount"):
                    donor_report[key] += raster[key]
            write_json(report_path, report)
        assert donor_report["rasterRoles"] == 98 and len(donor_report["outsideViews"]) == 7
        donor_report["sourceBlocksEncodedAndDecodedVerified"] = len(reader.verified)
        donor_report["sourceBlockLoadsWithCacheMisses"] = reader.loads
        donor_report["perViewDistinctEncodedBytes"] = statistics_summary(donor_report["perViewDistinctEncodedBytes"])
        checkpoint = read_json(args.bank_root/donor_id/"checkpoint.json")
        measurements = list(checkpoint.get("measurements", {}).values())
        donor_report["generationTimingMs"] = {key: statistics_summary([m[key] for m in measurements if key in m])
                                               for key in ("sampleElapsedMs", "backendSourceElapsedMs", "encodeAndWriteElapsedMs")}
        prior_sampling = [m["priorSourceSampling"] for m in measurements if m.get("priorSourceSampling")]
        if prior_sampling:
            donor_report["priorSourceSamplingTimingMs"] = {key: statistics_summary([m[key] for m in prior_sampling if key in m])
                                                          for key in ("sampleElapsedMs", "backendSourceElapsedMs")}
        donor_report["contactSheet"] = create_contact_sheet(donor_id, source, prepared, args.bank_root, args.output)
        assert sha((ROOT/fine_path).read_bytes()) == sha(fine_bytes), "Source manifest mutated during QC"
        print(json.dumps({"donorId": donor_id, "rasters": donor_report["rasterRoles"], "sampleCount": donor_report["sampleCount"],
                          "mismatches": donor_report["mismatchCount"], "halfIntegerTies": donor_report["halfIntegerTieCount"]}), flush=True)
    unique = {record["sha256"]: record for record in report["rasters"]}
    report["totals"] = {"donors": len(report["donors"]), "rasters": len(report["rasters"]), "uniquePayloads": len(unique),
                        "encodedBytes": sum(record["encodedBytes"] for record in unique.values()),
                        "sampleCount": sum(record["sampleCount"] for record in report["rasters"]),
                        "mismatchCount": sum(record["mismatchCount"] for record in report["rasters"]),
                        "halfIntegerTieCount": sum(record["halfIntegerTieCount"] for record in report["rasters"]),
                        "encodedBytesPerUniquePayload": statistics_summary([record["encodedBytes"] for record in unique.values()]),
                        "allZeroRasters": [{key: record[key] for key in ("donorId", "viewId", "mode", "role")}
                                           for record in report["rasters"] if record["nonzeroPixels"] == 0]}
    report["status"] = "passed" if report["totals"]["mismatchCount"] == 0 else "failed"
    report["elapsedSeconds"] = time.monotonic()-started
    report["completedAt"] = datetime.now(timezone.utc).isoformat()
    write_json(report_path, report)
    print(json.dumps({"status": report["status"], **report["totals"], "report": str(report_path)}), flush=True)
    raise SystemExit(0 if report["status"] == "passed" else 1)


if __name__ == "__main__":
    main()
