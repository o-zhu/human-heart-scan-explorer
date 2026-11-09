"""Reformat authentic N5 s3 voxels into the reviewed educational echo planes.

Uses echo-geometry/echo-planes.json world frames and the same plane/pixel and
world/source mapping as public/mpr-worker.js. Display values are normalized once
from the original uint16 volume, then sampled with trilinear interpolation.
No ultrasound signal, tissue detail, segmentation, or anatomy is synthesized.

Prerequisites: download_s3.py and assemble_s3.py; the cropped display cache from
prepare_sections.py is reused if present. The cache can also be rebuilt here.

Run: python prepare_echo_textures.py --frames ../echo-geometry/echo-planes.json
"""

import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import time

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates


ROOT = pathlib.Path.cwd()
PRESET_IDS = [
    "plax", "psax_mitral", "psax_papillary", "a4c", "a2c", "a3c",
    "subcostal", "me4c", "me2c", "melax", "meavsax", "bicaval", "tgpapillary",
]
SOURCE_XYZ = np.array([949, 949, 1059], dtype=np.int32)
WORLD_EXTENT = np.array([474 / 529, 1.0, 474 / 529], dtype=np.float64)
WORLD_UNIT_UM = 529 * 317.6
SPACING_UM = 158.8
WINDOW = (14640, 23545)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def display_volume(root):
    path = root / "s3-cropped-display-u8.npy"
    if path.exists():
        data = np.load(path, mmap_mode="r")
        assert data.shape == tuple(SOURCE_XYZ[::-1]) and data.dtype == np.uint8
        return data
    raw = np.load(root / "s3-volume-u16.npy", mmap_mode="r")
    assert raw.shape == (1060, 951, 951) and raw.dtype == np.uint16
    data = np.lib.format.open_memmap(
        path, mode="w+", dtype="uint8", shape=tuple(SOURCE_XYZ[::-1])
    )
    yy, xx = np.ogrid[:949, :949]
    keep = (xx - 474) ** 2 + (yy - 474) ** 2 <= 420 ** 2
    for zi in range(1059):
        values = (raw[zi, :949, :949].astype(np.float32) - WINDOW[0]) * (255 / 8905)
        data[zi] = np.rint(np.clip(values, 0, 255)).astype(np.uint8)
        data[zi, ~keep] = 0
    data.flush()
    return data


def world_to_source(world):
    """World [X,Y,Z] -> source [X,Y,Z], matching the browser MPR worker."""
    return np.stack([
        (world[0] / WORLD_EXTENT[0] + 0.5) * (SOURCE_XYZ[0] - 1),
        (0.5 - world[2] / WORLD_EXTENT[2]) * (SOURCE_XYZ[1] - 1),
        (world[1] / WORLD_EXTENT[1] + 0.5) * (SOURCE_XYZ[2] - 1),
    ])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=pathlib.Path,
                        default=ROOT / "echo-geometry" / "echo-planes.json")
    parser.add_argument("--data-root", type=pathlib.Path, default=ROOT / "heart-data")
    parser.add_argument("--output", type=pathlib.Path, default=ROOT / "echo-textures")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--quality", type=int, default=95)
    args = parser.parse_args()
    args.data_root.mkdir(parents=True, exist_ok=True)
    started = time.time()
    source_geometry_bytes = args.frames.read_bytes()
    geometry = json.loads(source_geometry_bytes)
    frames = geometry["frames"]
    assert set(PRESET_IDS).issubset(frames)
    args.output.mkdir(parents=True, exist_ok=True)
    data = display_volume(args.data_root)

    def render(preset_id):
        frame = frames[preset_id]
        p = frame["world"]
        center = np.asarray(p["center"], dtype=np.float64)
        right = np.asarray(p["right"], dtype=np.float64)
        up = np.asarray(p["up"], dtype=np.float64)
        normal = np.asarray(p["normal"], dtype=np.float64)
        assert abs(np.linalg.norm(right) - 1) < 1e-6
        assert abs(np.linalg.norm(up) - 1) < 1e-6
        assert abs(np.dot(right, up)) < 1e-6
        assert np.linalg.norm(np.cross(right, up) - normal) < 1e-6
        expected_center = np.asarray(frame["voxelXYZ"]["center"], dtype=np.float64) * 2
        assert np.max(np.abs(world_to_source(center) - expected_center)) < 1e-5

        # Images include both endpoint pixel centers. Width/height rounding is
        # reflected in actualSpacingUmXY; the physical plane span is unchanged.
        width = int(np.floor(p["width"] * WORLD_UNIT_UM / SPACING_UM + 0.5)) + 1
        height = int(np.floor(p["height"] * WORLD_UNIT_UM / SPACING_UM + 0.5)) + 1
        u = (np.arange(width, dtype=np.float64) / (width - 1) - 0.5) * p["width"]
        v = (0.5 - np.arange(height, dtype=np.float64) / (height - 1)) * p["height"]
        world = (center[:, None, None]
                 + right[:, None, None] * u[None, None, :]
                 + up[:, None, None] * v[None, :, None])
        source = world_to_source(world)
        values = map_coordinates(
            data, source[::-1], order=1, prefilter=False, mode="constant", cval=0,
            output=np.float32,
        )
        pixels = np.floor(values + 0.5).clip(0, 255).astype(np.uint8)
        path = args.output / f"{preset_id}.jpg"
        Image.fromarray(pixels).save(path, format="JPEG", quality=args.quality,
                                     optimize=True, progressive=False)
        encoded = path.read_bytes()
        decoded = np.asarray(Image.open(path).convert("L"))
        error = np.abs(decoded.astype(np.int16) - pixels.astype(np.int16))
        result = {
            "url": f"./assets/echo-textures/{preset_id}.jpg",
            "spacingUm": SPACING_UM,
            "width": width,
            "height": height,
            "actualSpacingUmXY": [p["width"] * WORLD_UNIT_UM / (width - 1),
                                  p["height"] * WORLD_UNIT_UM / (height - 1)],
            "widthWorld": p["width"],
            "heightWorld": p["height"],
            "center": p["center"],
            "right": p["right"],
            "up": p["up"],
            "normal": p["normal"],
            "bytes": len(encoded),
            "sha256": hashlib.sha256(encoded).hexdigest(),
            "confidence": frame["confidence"],
            "note": frame["note"],
        }
        validation = {
            "id": preset_id,
            "sourceCenterXYZ": world_to_source(center).tolist(),
            "expectedSourceCenterXYZ": expected_center.tolist(),
            "meanAbsoluteCompressionError": float(error.mean()),
            "maximumAbsoluteCompressionError": int(error.max()),
            "displayIntensityRange": [int(pixels.min()), int(pixels.max())],
            "nonzeroPixelCount": int(np.count_nonzero(pixels)),
        }
        print(f"Encoded {preset_id}: {width}x{height}, {len(encoded)} bytes", flush=True)
        return preset_id, result, validation

    entries = {}
    validation = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for preset_id, entry, checks in pool.map(render, PRESET_IDS):
            entries[preset_id] = entry
            validation.append(checks)
    write_json(args.output / "manifest.json", entries)
    provenance = {
        "schemaVersion": 1,
        "datasetId": "1659197537",
        "datasetUrl": "https://human-organ-atlas.esrf.fr/datasets/1659197537",
        "specimen": "LADAF-2021-17",
        "doi": "10.15151/ESRF-DC-1634390196",
        "license": "CC BY 4.0",
        "attribution": "Brunet et al. / ESRF Human Organ Atlas",
        "sourceScale": "s3",
        "sourceScaleDimensionsXYZ": [951, 951, 1060],
        "sourceCroppedDimensionsXYZ": SOURCE_XYZ.tolist(),
        "sourceSpacingUm": SPACING_UM,
        "sourceDtype": "uint16",
        "displayDtype": "uint8",
        "sourceIntensityWindow": list(WINDOW),
        "worldExtentXYZ": WORLD_EXTENT.tolist(),
        "worldUnitUm": WORLD_UNIT_UM,
        "worldToSourceXYZ": "[(wx/extentX+0.5)*948,(0.5-wz/extentZ)*948,(wy+0.5)*1058]",
        "pixelSampling": "col=0..width-1 spans -widthWorld/2..+widthWorld/2 along right; "
                         "row=0..height-1 spans +heightWorld/2..-heightWorld/2 along up. "
                         "World point=center+u*right+v*up. Trilinear sampling of the "
                         "windowed display volume, rounded to uint8.",
        "containerMask": {"centerXY": [474, 474], "radiusVoxels": 420,
                          "outsideValue": 0, "anatomicalSegmentation": False},
        "jpegQuality": args.quality,
        "compressionLossless": False,
        "geometryFile": args.frames.name,
        "geometrySha256": hashlib.sha256(source_geometry_bytes).hexdigest(),
        "geometryValidation": geometry["validation"],
        "geometryLimitations": geometry["limitations"],
        "displayOrientation": geometry["displayOrientation"],
        "generatedDate": "2026-11-04",
        "imageCount": len(entries),
        "totalBytes": sum(v["bytes"] for v in entries.values()),
        "elapsedSeconds": time.time() - started,
        "validation": validation,
    }
    write_json(args.output / "provenance.json", provenance)
    print("READY " + json.dumps({k: provenance[k] for k in
          ("imageCount", "totalBytes", "elapsedSeconds", "geometrySha256")}), flush=True)


if __name__ == "__main__":
    main()
