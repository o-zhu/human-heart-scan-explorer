#!/usr/bin/env python3
"""Independent geometry/data contracts for the three measured comparison donors.

No network or browser. Synthetic asymmetric sources exercise the actual source
decoder/registration. Actual assets are decoded independently and compared with
the source cache. --require-fine makes pending fine banks or coarse prepared
planes a failure; omit it while preprocessing is still running.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import tempfile
from datetime import datetime, timezone

import blosc2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CACHE_ROOT = Path("/workspace/data")
DONORS = {"ucl-zcr-2337": "2298521860", "ucl-zcr-2627": "2298522608", "ucl-zcr-2628": "2298522707"}
spec = importlib.util.spec_from_file_location("donor_pipeline", ROOT / "scripts/prepare-donor-v10.py")
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


def read(path):
    return json.loads(path.read_text())


def sha(value):
    return hashlib.sha256(value).hexdigest()


def near(actual, expected, message="physical coordinates", tolerance=1e-8):
    error = float(np.max(np.abs(np.asarray(actual) - np.asarray(expected))))
    assert error <= tolerance, f"{message}: maximum error {error}"
    return error


def decode_independent(payload, kind, chunk_xyz):
    """Explicit coordinate assignment, separate from the production reshape."""
    if kind == "n5":
        mode, dimensions, nx, ny, nz = struct.unpack(">HHIII", payload[:16])
        assert mode == 0 and dimensions == 3
        raw = blosc2.decompress(payload[16:])
        integers = np.frombuffer(raw, dtype=">u2")
        x, y, z = np.meshgrid(np.arange(nx), np.arange(ny), np.arange(nz), indexing="ij")
        result = integers[x + nx * (y + ny * z)].transpose(2, 1, 0)
    else:
        nx, ny, nz = map(int, chunk_xyz)
        raw = blosc2.decompress(payload)
        integers = np.frombuffer(raw, dtype="<u2")
        x, y, z = np.meshgrid(np.arange(nx), np.arange(ny), np.arange(nz), indexing="ij")
        result = integers[z + nz * (y + ny * x)].transpose(2, 1, 0)
    return result, sha(raw)


def synthetic_decode():
    shape = (7, 5, 3)
    x, y, z = np.meshgrid(*[np.arange(n) for n in shape], indexing="ij")
    xyz = (x + 100*y + 1000*z + 256).astype(np.uint16)
    expected = xyz.transpose(2, 1, 0)
    n5_raw = expected.astype(">u2").tobytes()
    n5 = struct.pack(">HHIII", 0, 3, *shape) + blosc2.compress(n5_raw, typesize=2)
    zarr_raw = xyz.astype("<u2").tobytes()
    zarr = blosc2.compress(zarr_raw, typesize=2)
    for kind, payload, raw in [("n5", n5, n5_raw), ("zarr", zarr, zarr_raw)]:
        actual, raw_hash = pipeline.decode_chunk(payload, kind, shape)
        assert np.array_equal(actual, expected), f"{kind} swaps axes or byte order"
        assert raw_hash == sha(raw)
        independent, independent_hash = decode_independent(payload, kind, shape)
        assert np.array_equal(actual, independent) and raw_hash == independent_hash
    # N5 terminal chunks may declare smaller dimensions than the nominal block.
    edge, _ = pipeline.decode_chunk(n5, "n5", (128, 128, 128))
    assert np.array_equal(edge, expected)
    rejected = 0
    bad_inputs = [(b"short", "n5", shape), (n5, "n5", (6, 5, 3)),
                  (struct.pack(">HH", 1, 3) + n5[4:], "n5", shape),
                  (zarr, "zarr", (7, 5, 4)), (zarr, "unknown", shape)]
    for args in bad_inputs:
        try:
            pipeline.decode_chunk(*args)
        except ValueError:
            rejected += 1
        else:
            raise AssertionError("Invalid source layout was accepted")
    return dict(asymmetricXYZ=list(shape), verifiedFormats=["N5 big-endian X-fast", "Zarr little-endian Z-fast"],
                edgeN5Verified=True, malformedLayoutsRejected=rejected)


def synthetic_source(kind, directory):
    """Cached-only Source bootstrap with even dimensions and Y longest."""
    cache = directory / kind
    cache.mkdir()
    (cache / "source-metadata.json").write_text("{}")
    (cache / "source-neuroglancer.json").write_text("{}")
    fine, high = [10, 22, 14], [3, 6, 4]
    levels = {"2": dict(dimensionsXYZ=fine, voxelMicrons=4),
              "4": dict(dimensionsXYZ=high, voxelMicrons=16)}
    if kind == "n5":
        root = dict(axes=["x", "y", "z"], units=["um"]*3, resolution=[1]*3,
                    downsamplingFactors=[[2**i]*3 for i in range(5)])
    else:
        root = dict(multiscales=[dict(axes=[dict(name=a, unit="micrometer") for a in "xyz"],
                    datasets=[dict(path=level, coordinateTransformations=[dict(type="scale", scale=[d["voxelMicrons"]]*3),
                          dict(type="translation", translation=[d["voxelMicrons"]/2]*3)]) for level, d in levels.items()])])
    (cache / "source-root-attributes.json").write_text(json.dumps(root))
    for level, d in levels.items():
        attrs = (dict(dimensions=d["dimensionsXYZ"], blockSize=[128]*3, dataType="uint16", compression=dict(type="blosc"))
                 if kind == "n5" else dict(shape=d["dimensionsXYZ"], chunks=[128]*3, dtype="<u2", order="C",
                                          compressor=dict(id="blosc"), dimension_separator="/", filters=None))
        (cache / f"s{level}-attributes.json").write_text(json.dumps(attrs))
    config = dict(slug="synthetic-" + kind, datasetId="fixture", metadataDirectory=str(cache),
                  source=dict(format=kind, baseUrl="https://invalid.example/", fineLevel="2", highLevel="4",
                              window=[0, 65535], levels=levels))
    source = pipeline.Source(config, cache, directory / "project")
    assert source.full.tolist() == [13, 25, 17]
    assert source.high_dims.tolist() == [4, 7, 5]
    assert source.low_dims.tolist() == [3, 4, 3]
    near((source.high_dims-1)*source.high_spacing, (source.full-1)*source.fine_spacing)
    near((source.low_dims-1)*source.low_spacing, (source.full-1)*source.fine_spacing)
    assert np.argmax(source.extent_um) == 1
    for index in [[0, 0, 0], [1, 2, 3], source.high_dims-1]:
        index = np.asarray(index)
        coarse = source.transforms["4"]["origin"] + (index + source.high_shift)*source.high_spacing
        fine_point = source.transforms["2"]["origin"] + index*source.ratio*source.fine_spacing
        near(coarse, fine_point, "source sample center registration")
    volume = np.zeros(tuple(source.full[::-1]), np.uint8)
    z, y, x = np.indices(tuple(source.source_fine[::-1]))
    volume[:14, :22, :10] = 1 + (x + 3*y + 7*z) % 254
    for axis in "xyz":
        pixels, crop, width, height = pipeline.section(volume, [0, 0, 0], source, axis, 1)
        canvas = np.zeros((height, width), np.uint8)
        ox, oy, w, h = crop
        canvas[oy:oy+h, ox:ox+w] = pixels
        expected = volume[:, :, 4] if axis == "x" else volume[:, 4, :] if axis == "y" else volume[4]
        assert np.array_equal(canvas, expected), f"{axis} section drops terminal acquired pixels"
        assert np.count_nonzero(expected) == (fine[1]*fine[2] if axis == "x" else fine[0]*fine[2] if axis == "y" else fine[0]*fine[1])
        pixels, _, _, _ = pipeline.section(volume, [0, 0, 0], source, axis, int(source.high_dims["xyz".index(axis)]-1))
        assert not pixels.any(), "Padding planes must be empty, not extrapolated anatomy"
    return dict(format=kind, sourceFineXYZ=fine, paddedFineXYZ=source.full.tolist(),
                highXYZ=source.high_dims.tolist(), lowXYZ=source.low_dims.tolist(),
                sourceVoxelsOmitted=0, longestSourceAxis="Y", lowEndpointResidualUm=0)


def trilinear(values, coordinates, outside_zero=False):
    """Independent eight-corner interpolation in explicit XYZ coordinates."""
    q = np.asarray(coordinates, float)
    dims = np.asarray(values.shape[::-1])
    valid = np.all((q >= 0) & (q <= dims-1), axis=-1)
    q = np.clip(q, 0, dims-1)
    base = np.floor(q).astype(int)
    upper = np.minimum(base+1, dims-1)
    f = q-base
    result = np.zeros(q.shape[:-1], float)
    for dz in [0, 1]:
        for dy in [0, 1]:
            for dx in [0, 1]:
                p = np.stack([upper[..., 0] if dx else base[..., 0],
                              upper[..., 1] if dy else base[..., 1],
                              upper[..., 2] if dz else base[..., 2]], axis=-1)
                weight = (f[..., 0] if dx else 1-f[..., 0])*(f[..., 1] if dy else 1-f[..., 1])*(f[..., 2] if dz else 1-f[..., 2])
                result += values[p[..., 2], p[..., 1], p[..., 0]].astype(float)*weight
    if outside_zero:
        result[~valid] = 0
    return np.floor(result+.5).astype(values.dtype)


def coarse_check(slug, dataset):
    assets, cache = ROOT / "public/assets/donors" / slug, CACHE_ROOT / ("heart-donor-"+dataset)
    manifest, geometry, config = read(assets / "manifest.json"), read(cache / "browser-geometry.json"), read(ROOT / "configs/donors" / (slug+".json"))
    assert manifest["datasetId"] == dataset and manifest["donorAge"] == "<18"
    assert manifest["donorSex"] is None and manifest["registrationPadding"]["sourceVoxelsOmitted"] == 0
    full, acquired = np.array(geometry["fullFineDimensionsXYZ"]), np.array(geometry["sourceFineDimensionsXYZ"])
    assert np.all(full >= acquired) and np.all(full-acquired < 4)
    extent = (full-1)*geometry["fineSpacingUm"]
    near(extent, manifest["sourceScaleCenterExtentUm"])
    near(max(extent)/1000, geometry["longestMm"])
    near(extent[[0, 2, 1]]/max(extent), geometry["extent"])
    part_records = []
    for level, info in manifest["levels"].items():
        dims = info["dimensions"]
        spacing = info["spacingUm"]
        near((np.asarray(dims)-1)*spacing, extent, level+" physical endpoint")
        for key, suffix in [("parts", "-clean"), ("originalParts", "")]:
            source = np.load(cache / (f"display-{level}{suffix}-u8.npy"), mmap_mode="r")
            assert tuple(source.shape) == tuple(dims[::-1])
            offset, byte_count, compressed, assembled_sha = 0, 0, 0, hashlib.sha256()
            source_sha = hashlib.sha256()
            for part in info[key]:
                z0, z1 = part["zRange"]
                assert z0 == offset and z1 > z0 and z1 <= dims[2], "Multipart source has gap/overlap"
                p = ROOT / "public" / part["url"].removeprefix("./")
                assert p.is_relative_to(assets)
                encoded = p.read_bytes()
                assert len(encoded) == part["bytes"] and sha(encoded) == part["sha256"]
                assert len(encoded) < 16*1024**2
                residuals = np.frombuffer(gzip.decompress(encoded), dtype=np.uint8).reshape(z1-z0, dims[1], dims[0])
                assert residuals.nbytes == part["uncompressedBytes"]
                if part["predictor"] == "delta-z":
                    actual = np.cumsum(residuals, axis=0, dtype=np.uint8)
                elif part["predictor"] == "delta-x":
                    actual = np.cumsum(residuals, axis=2, dtype=np.uint8)
                else:
                    assert part["predictor"] == "none"
                    actual = residuals
                raw = actual.tobytes()
                assert sha(raw) == part["rawSha256"] and np.array_equal(actual, source[z0:z1])
                assembled_sha.update(raw); source_sha.update(source[z0:z1].tobytes())
                offset, byte_count, compressed = z1, byte_count+len(raw), compressed+len(encoded)
            assert offset == dims[2] and byte_count == info["uncompressedBytes"]
            assert compressed == info["compressedBytes" if key == "parts" else "originalCompressedBytes"]
            assert assembled_sha.hexdigest() == source_sha.hexdigest()
            part_records.append(dict(level=level, cleaned=key=="parts", parts=len(info[key]),
                                     decodedBytes=byte_count, compressedBytes=compressed, sha256=assembled_sha.hexdigest(), maximumByteError=0))
    # Source high chunks are decoded with a separate explicit-coordinate decoder.
    original = np.load(cache / "source-high-u16.npy", mmap_mode="r")
    download = read(cache / "high-download.json")
    selected = np.unique(np.linspace(0, len(download["records"])-1, 5, dtype=int))
    for index in selected:
        record = download["records"][int(index)]
        x, y, z = record["coordinateXYZ"]
        payload = (cache / "chunks-s4" / f"{x}_{y}_{z}.bin").read_bytes()
        assert sha(payload) == record["sha256"]
        decoded, decoded_hash = decode_independent(payload, config["source"]["format"], [128]*3)
        assert decoded_hash == record["decodedSha256"]
        expected = original[z*128:(z+1)*128, y*128:(y+1)*128, x*128:(x+1)*128]
        assert np.array_equal(expected, decoded[:expected.shape[0], :expected.shape[1], :expected.shape[2]])
    registered = np.load(cache / "display-high-raw-u16.npy", mmap_mode="r")
    rng = np.random.default_rng(int(dataset))
    points = np.vstack([rng.integers([0, 0, 0], geometry["highDimensionsXYZ"], size=(4096, 3)),
                        [0, 0, 0], np.array(geometry["highDimensionsXYZ"])-1])
    expected = trilinear(original, points + np.array(geometry["highOriginalSourceIndexShift"]))
    expected[np.any(points*4 >= acquired, axis=1)] = 0
    actual = registered[points[:, 2], points[:, 1], points[:, 0]]
    error = int(np.max(np.abs(actual.astype(int)-expected.astype(int))))
    assert error == 0, "High source physical registration or zero padding is incorrect"
    for axis, n in enumerate(geometry["highDimensionsXYZ"]):
        padding = np.flatnonzero(np.arange(n)*4 >= acquired[axis])
        for index in padding:
            face = np.take(registered, index, axis=2-axis)
            assert np.count_nonzero(face) == 0, "Source padding is not zero"
    roi_path = ROOT / "docs/donors" / slug / "heart-roi-support-review.json"
    roi = read(roi_path) if roi_path.exists() else None
    if roi:
        assert roi["omittedThresholdVoxels"] == 0 and roi["retainedFraction"] == 1
    return dict(datasetId=dataset, parts=part_records, independentlyDecodedSourceChunks=len(selected),
                registeredHighVoxelsChecked=len(points), maximumSourceRegistrationByteError=error,
                paddingFineColumnsXYZ=(full-acquired).tolist(), physicalExtentMm=(extent/1000).tolist(),
                sourceFineExtentPreserved=True, cardiacRoiPreserved=roi), geometry


def measured_views_check(slug, dataset, geometry, require_fine):
    assets, cache = ROOT / "public/assets/donors" / slug, CACHE_ROOT / ("heart-donor-"+dataset)
    frames, echoes, flow, probe, anatomy = [read(assets / name) for name in ["echo-planes.json", "echo-textures.json", "flow-views.json", "probe-textures.json", "anatomy/manifest.json"]]
    for m in [frames, echoes, flow, probe, anatomy]:
        assert m["datasetId"] == dataset and m["geometricComparisonOnly"] is True
    assert not frames["anatomicIdentityAssigned"] and not frames["clinicalPresetsReviewed"]
    assert not flow["anatomicIdentityAssigned"] and not flow["expertValidated"]
    assert not anatomy["segmentationAvailable"] and [a["id"] for a in anatomy["labels"]] == [0]
    assert gzip.decompress((ROOT / "public" / anatomy["volumeUrl"].removeprefix("./")).read_bytes()) == bytes(8)
    prep = read(ROOT / "docs/donors" / slug / "view-preparation.json")
    fine = bool(prep["fineSource"])
    if require_fine:
        assert fine, f"{slug}: prepared planes have not yet been rebuilt from fine source"
        assert prep.get("sourceUnchangedThroughoutPreparation") is True, "Fine preparation lacks the immutable-source hash guard"
    source_spacing = geometry["fineSpacingUm"] if fine else geometry["highSpacingUm"]
    source = np.load(cache / ("s2-clean-display-u8.npy" if fine else "display-high-clean-u8.npy"), mmap_mode="r")
    origin = np.asarray(read(cache / "s2-clean-display.json")["originXYZ"]) if fine else np.zeros(3)
    dimensions = np.asarray(geometry["fullFineDimensionsXYZ"] if fine else geometry["highDimensionsXYZ"])
    for m in [echoes, flow, probe]:
        near(m["sourceSpacingUm"], source_spacing, "honest prepared source spacing")
    assert len(frames["frames"]) == len(echoes["textures"]) == 13
    assert len(flow["presets"]) == 8 and len(probe["preparedPlanes"]) == 4
    items = []
    for key, frame in frames["frames"].items():
        assert frame["displayName"] == frames["presetOverrides"][key]["name"]
        assert "section" in frame["displayName"].lower()
        items.append(("echo:"+key, echoes["textures"][key], frame["world"]))
    for p in flow["presets"]:
        assert p["chamber"] is None and p["anatomicIdentityAssigned"] is False
        assert "section" in p["title"].lower()
        items.append(("comparison:"+p["id"], p["texture"], p["world"]))
    items.extend(("probe:"+p["id"], p, p["plane"]) for p in probe["preparedPlanes"])
    rng = np.random.default_rng(114)
    records = []
    for name, item, plane in items:
        path = ROOT / "public" / item["url"].removeprefix("./")
        assert path.is_relative_to(assets), "A prepared plane points at a different donor"
        encoded = path.read_bytes()
        assert sha(encoded) == item["sha256"] and len(encoded) == item["bytes"]
        pixels = np.asarray(Image.open(path).convert("L"))
        h, w = pixels.shape
        assert [w, h] == [item["width"], item["height"]]
        assert sha(pixels.tobytes()) == item["pixelSha256"]
        assert item["cleaned"] is True and item["lossless"] is True
        near(item["sourceSpacingUm"], source_spacing)
        near(item["spacingUmXY"], [plane["width"]*geometry["longestMm"]*1000/(w-1), plane["height"]*geometry["longestMm"]*1000/(h-1)])
        # Include interior tissue pixels so empty background cannot mask a transform error.
        positive = np.argwhere(pixels > 0)
        assert len(positive) > 20
        selected = np.vstack([positive[rng.integers(0, len(positive), 512)], rng.integers([0, 0], [h, w], size=(512, 2))])
        row, col = selected.T
        right, up, center, normal = [np.asarray(plane[k]) for k in ["right", "up", "center", "normal"]]
        near(np.cross(right, up), normal)
        near([np.linalg.norm(right), np.linalg.norm(up), right@up], [1, 1, 0])
        world = center + (col/(w-1)-.5)[:, None]*plane["width"]*right + (.5-row/(h-1))[:, None]*plane["height"]*up
        physical = world[:, [0, 2, 1]]*[1, -1, 1]*geometry["longestMm"]*1000
        xyz = physical/source_spacing + (dimensions-1)/2 - origin
        expected = trilinear(source, xyz, outside_zero=True)
        error = int(np.max(np.abs(pixels[row, col].astype(int)-expected.astype(int))))
        assert error <= 1, f"{name} is not the recorded source plane: {error} grayscale levels"
        records.append(dict(id=name, dimensions=[w, h], sourceSpacingUm=source_spacing,
                            sampledPixels=len(row), maxIndependentTrilinearByteError=error))
    return dict(fineSource=fine, sourceSpacingUm=source_spacing, measuredImageCount=len(records),
                anatomyLabelsAssigned=0, independentPixelChecks=records)


def fine_bank_check(slug, dataset, geometry, require_fine):
    assets, cache = ROOT / "public/assets/donors" / slug, CACHE_ROOT / ("heart-donor-"+dataset)
    paths = [assets / "ultra-volume.json", assets / "ultra-sections.json", cache / "s2-clean-display.json"]
    missing = [str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else str(p) for p in paths if not p.exists()]
    if missing:
        assert not require_fine, f"Pending fine assets: {missing}"
        return dict(pending=True, missing=missing)
    volume, sections, source_meta = map(read, paths)
    assert volume["datasetId"] == sections["datasetId"] == dataset
    assert volume["fullDimensionsXYZ"] == sections["imageDimensionsXYZ"] == geometry["fullFineDimensionsXYZ"]
    assert sections["sourceDimensionsXYZ"] == geometry["sourceFineDimensionsXYZ"]
    assert sections["sliceCounts"] == geometry["highDimensionsXYZ"] and sections["sourceIndexStep"] == 4
    assert volume["sourceOriginXYZ"] == source_meta["originXYZ"] and volume["sourceShapeXYZ"] == source_meta["shapeXYZ"]
    near(volume["longestMm"], geometry["longestMm"])
    near(volume["sourceSpacingUm"], geometry["fineSpacingUm"])
    near(volume["extent"], geometry["extent"])
    source = np.load(cache / "s2-clean-display-u8.npy", mmap_mode="r")
    assert list(source.shape[::-1]) == volume["sourceShapeXYZ"]
    origin = np.asarray(volume["sourceOriginXYZ"])
    # Trace sampled fine display voxels all the way back to acquired uint16,
    # independently of the producer's fine decoder and display helper.
    config = read(ROOT / "configs/donors" / (slug+".json"))
    download = read(cache / "fine-download.json")
    assert download["completeSupportedChunks"] is True
    compact = np.load(cache / "support-low-u8.npy", mmap_mode="r")
    rng = np.random.default_rng(20261105)
    acquired = np.asarray(geometry["sourceFineDimensionsXYZ"])
    full = np.asarray(geometry["fullFineDimensionsXYZ"])
    low = np.asarray(geometry["lowDimensionsXYZ"])
    raw_checks = 0
    for index in np.unique(np.linspace(0, len(download["records"])-1, 7, dtype=int)):
        item = download["records"][int(index)]
        coordinate = np.asarray(item["coordinateXYZ"])
        p = cache / "chunks-s2" / ("_".join(map(str, coordinate))+".bin")
        encoded = p.read_bytes()
        assert sha(encoded) == item["sha256"]
        decoded, decoded_hash = decode_independent(encoded, config["source"]["format"], [128]*3)
        assert decoded_hash == item["decodedSha256"]
        begin = coordinate*128
        lo = np.maximum(begin, origin)
        hi = np.minimum(np.minimum(begin+np.asarray(decoded.shape[::-1]), acquired), origin+np.asarray(source.shape[::-1]))
        assert np.all(hi > lo)
        points = rng.integers(lo, hi, size=(256, 3))
        local = points-begin
        raw = decoded[local[:, 2], local[:, 1], local[:, 0]].astype(float)
        window = config["source"]["window"]
        expected = np.rint(np.clip((raw-window[0])/(window[1]-window[0]), 0, 1)*255).astype(np.uint8)
        mask_q = np.floor(points/(full-1)*(low-1)+.5).astype(int)
        expected[compact[mask_q[:, 2], mask_q[:, 1], mask_q[:, 0]] == 0] = 0
        display_q = points-origin
        actual = source[display_q[:, 2], display_q[:, 1], display_q[:, 0]]
        assert np.array_equal(actual, expected), "Fine display differs from independently decoded/windowed acquired source"
        raw_checks += len(points)
    records = []
    for axis, count in zip("xyz", sections["sliceCounts"]):
        items = sections["slices"][axis]
        assert len(items) == count
        nonempty = [i for i, item in enumerate(items) if not item["empty"]]
        picks = sorted(set(np.linspace(0, count-1, 5, dtype=int).tolist() + [nonempty[0], nonempty[-1]]))
        for index in picks:
            item = items[index]
            p = ROOT / "data/donors" / slug / "ultra-sections" / item["path"]
            encoded = p.read_bytes(); pixels = np.asarray(Image.open(p).convert("L"))
            assert len(encoded) == item["bytes"] and sha(encoded) == item["sha256"]
            assert sha(pixels.tobytes()) == item["sourceDisplaySha256"]
            if item["empty"]:
                assert not pixels.any()
                local = index*4 - origin["xyz".index(axis)]
                if 0 <= local < source.shape[2-"xyz".index(axis)]:
                    expected = np.take(source, local, axis=2-"xyz".index(axis))
                    assert not expected.any()
                continue
            ox, oy, w, h = item["crop"]
            a = "xyz".index(axis)
            local = index*4-origin[a]
            positive = np.argwhere(pixels > 0)
            assert len(positive) > 0
            selected = np.vstack([positive[rng.integers(0, len(positive), 1024)],
                                  rng.integers([0, 0], [h, w], size=(1024, 2))])
            rows, cols = selected.T
            xs, ys = cols+ox, rows+oy
            if axis == "x":
                expected = source[ys-origin[2], xs-origin[1], local]
            elif axis == "y":
                expected = source[ys-origin[2], local, xs-origin[0]]
            else:
                expected = source[local, ys-origin[1], xs-origin[0]]
            assert np.array_equal(pixels[rows, cols], expected), f"{slug} {axis}:{index} crop is shifted"
            records.append(dict(axis=axis, index=index, imagePixels=w*h, sourcePixelsChecked=len(rows),
                                crop=item["crop"], maximumByteError=0, fullDecodedImageHashVerified=True))
    blocks = volume["blocks"]
    ids = sorted(blocks, key=int)
    counts = volume["brickCountsXYZ"]
    checked = []
    for j in np.unique(np.linspace(0, len(ids)-1, 17, dtype=int)):
        ident = ids[int(j)]; item = blocks[ident]; i = int(ident)
        bx, by, bz = i % counts[0], i//counts[0] % counts[1], i//(counts[0]*counts[1])
        p = ROOT / "data/donors" / slug / "ultra-volume" / item["path"]
        encoded = p.read_bytes(); raw = gzip.decompress(encoded)
        assert len(encoded) == item["bytes"] and sha(encoded) == item["sha256"] and sha(raw) == item["rawSha256"]
        actual = np.frombuffer(raw, dtype=np.uint8).reshape(65, 65, 65)
        measured = source[bz*64:bz*64+65, by*64:by*64+65, bx*64:bx*64+65]
        expected = np.zeros((65, 65, 65), np.uint8)
        expected[:measured.shape[0], :measured.shape[1], :measured.shape[2]] = measured
        assert np.array_equal(actual, expected), "Sparse brick origin/positive halo differs from measured source"
        checked.append(ident)
    return dict(pending=False, orthogonalSamples=records, sparseBricksChecked=checked,
                independentlyVerifiedFineSourceVoxels=raw_checks,
                positiveHaloByteExact=True, sourceSpacingUm=geometry["fineSpacingUm"],
                orthogonalInPlaneSpacingUm=sections["spacingUm"], orthogonalStepUm=sections["sliceSpacingUm"])


def main():
    global CACHE_ROOT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-fine", action="store_true")
    parser.add_argument("--slug", choices=DONORS, action="append")
    parser.add_argument("--cache-root", type=Path, default=CACHE_ROOT, help="Parent directory containing acquired source caches")
    args = parser.parse_args()
    CACHE_ROOT = args.cache_root
    report = dict(passed=False, validatedAt=datetime.now(timezone.utc).isoformat(), validationScope="Independent source/data/geometry tests; no browser or human anatomical validation.", requireFine=args.require_fine,
                  sourceDecode=synthetic_decode())
    with tempfile.TemporaryDirectory(prefix="heart-donor-contracts-") as d:
        report["syntheticRegistration"] = [synthetic_source(kind, Path(d)) for kind in ["n5", "zarr"]]
    directory = ROOT / "docs/donor-comparison-v10"
    directory.mkdir(parents=True, exist_ok=True)
    previous = directory / "data-validation.json"
    report["donors"] = read(previous).get("donors", {}) if previous.exists() else {}
    for slug in args.slug or DONORS:
        dataset = DONORS[slug]
        coarse, geometry = coarse_check(slug, dataset)
        print(json.dumps(dict(donor=slug, stage="coarse-source-and-parts", passed=True)), flush=True)
        views = measured_views_check(slug, dataset, geometry, args.require_fine)
        print(json.dumps(dict(donor=slug, stage="prepared-plane-pixels", images=views["measuredImageCount"],
                              sourceSpacingUm=views["sourceSpacingUm"], passed=True)), flush=True)
        fine = fine_bank_check(slug, dataset, geometry, args.require_fine)
        report["donors"][slug] = dict(coarse=coarse, measuredViews=views, fineBanks=fine)
        single = dict(passed=True, validatedAt=report["validatedAt"], requireFine=args.require_fine,
                      donor=slug, sourceDecode=report["sourceDecode"], syntheticRegistration=report["syntheticRegistration"],
                      data=report["donors"][slug])
        (directory / (slug+"-data-validation.json")).write_text(json.dumps(single, indent=2)+"\n")
        print(json.dumps(dict(donor=slug, coarseByteExact=True, views=len(views["independentPixelChecks"]),
                              sourceSpacingUm=views["sourceSpacingUm"], finePending=fine["pending"])), flush=True)
    report["passed"] = True
    # Fine arrays may be released after a successful per-donor audit. Preserve
    # each completed snapshot rather than requiring all large caches at once.
    for slug in DONORS:
        saved_path = directory / (slug+"-data-validation.json")
        if saved_path.exists():
            saved = read(saved_path)
            assert saved["passed"] is True
            report["donors"][slug] = dict(saved["data"], validatedAt=saved["validatedAt"], requireFine=saved["requireFine"])
    report["requestedDonors"] = args.slug or list(DONORS)
    report["requireFine"] = (len(report["donors"]) == len(DONORS) and all(d.get("requireFine") is True and
        d["measuredViews"]["fineSource"] and not d["fineBanks"]["pending"] for d in report["donors"].values()))
    target = directory / "data-validation.json"
    target.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(dict(passed=True, requestedRequireFine=args.require_fine, allDonorsFineVerified=report["requireFine"], report=str(target))))


if __name__ == "__main__":
    main()
