"""Create registered, authentic high-detail orthogonal heart slice assets.

Prerequisites: run download_s3.py, then assemble_s3.py in this directory.
No anatomical structures or textures are synthesized. Display intensities are
derived directly from the public N5 s3 uint16 voxels, with an explicitly recorded
window and circular mounting-container exclusion. JPEG is a display asset, not a
quantitative measurement format. The unmodified source remains in N5.

The crop and even source indices match the application's s4 first/last voxel
center coordinate convention. In-plane sampling is 158.8 um; through-plane
positions are 317.6 um apart, exactly one image per existing s4 slice position.

Run: python prepare_sections.py --quality 92 --workers 8
"""

import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import time

import numpy as np
from PIL import Image


ROOT = pathlib.Path.cwd() / "heart-data"
SOURCE_HTTP = (
    "https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/"
    "LADAF-2021-17/heart/19.85um_complete-organ_bm18/"
)
WINDOW = (14640, 23545)
S3_SPACING = 158.8
S4_SPACING = 317.6
CROP_XYZ = (949, 949, 1059)
SLICE_COUNTS = (475, 475, 530)
CENTER_XY = (474, 474)
RADIUS = 420


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=pathlib.Path, default=ROOT)
    parser.add_argument("--quality", type=int, default=92)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--output", type=pathlib.Path, default=None)
    args = parser.parse_args()
    root = args.data_root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    args.output = (args.output or root / "section-assets").resolve()
    started = time.time()
    out = args.output / "sections"
    out.mkdir(parents=True, exist_ok=True)
    for axis in "xyz":
        (out / axis).mkdir(exist_ok=True)

    raw = np.load(root / "s3-volume-u16.npy", mmap_mode="r")
    assert raw.shape == (1060, 951, 951), raw.shape
    raw = raw[:1059, :949, :949]
    yy, xx = np.ogrid[:949, :949]
    keep = (xx - CENTER_XY[0]) ** 2 + (yy - CENTER_XY[1]) ** 2 <= RADIUS ** 2

    # A single normalized volume avoids repeated strided uint16 reads for each
    # plane. Pixel arithmetic matches the current application's s4 display map.
    normalized_path = root / "s3-cropped-display-u8.npy"
    display = np.lib.format.open_memmap(
        normalized_path, mode="w+", dtype="uint8", shape=raw.shape
    )
    scale = 255.0 / (WINDOW[1] - WINDOW[0])
    for zi in range(raw.shape[0]):
        values = (raw[zi].astype(np.float32) - WINDOW[0]) * scale
        display[zi] = np.rint(np.clip(values, 0, 255)).astype(np.uint8)
        display[zi, ~keep] = 0
    display.flush()
    print(f"Normalized {display.shape} in {time.time() - started:.1f}s", flush=True)

    status = {
        "stage": "encoding",
        "quality": args.quality,
        "output": str(out),
        "targetImageCount": sum(SLICE_COUNTS),
        "completedImages": 0,
        "sourceVolume": str(root / "s3-volume-u16.npy"),
    }
    write_json(root / "cap-detail-status.json", status)

    def encode(job):
        axis, idx = job
        source_idx = 2 * idx
        if axis == "x":
            plane = display[:, :, source_idx]
        elif axis == "y":
            plane = display[:, source_idx, :]
        else:
            plane = display[source_idx, :, :]
        path = out / axis / f"{idx:04d}.jpg"
        Image.fromarray(np.ascontiguousarray(plane)).save(
            path, format="JPEG", quality=args.quality, optimize=True, progressive=False
        )
        data = path.read_bytes()
        return {
            "path": f"{axis}/{idx:04d}.jpg",
            "axis": axis,
            "index": idx,
            "sourceIndex": source_idx,
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "width": int(plane.shape[1]),
            "height": int(plane.shape[0]),
        }

    jobs = [(axis, i) for axis, count in zip("xyz", SLICE_COUNTS) for i in range(count)]
    records = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for record in pool.map(encode, jobs):
            records.append(record)
            if len(records) % 100 == 0 or len(records) == len(jobs):
                size = sum(r["bytes"] for r in records)
                status.update(
                    completedImages=len(records),
                    encodedBytes=size,
                    elapsedSeconds=round(time.time() - started, 2),
                )
                write_json(root / "cap-detail-status.json", status)
                print(
                    f"Encoded {len(records)}/{len(jobs)}: {size / 1e6:.1f} MB, "
                    f"{time.time() - started:.1f}s",
                    flush=True,
                )

    # Validate the data path, registration, and representative encoded images.
    assert all((hi - 1) * S3_SPACING == (lo - 1) * S4_SPACING
               for hi, lo in zip(CROP_XYZ, SLICE_COUNTS))
    validation = []
    for axis, count in zip("xyz", SLICE_COUNTS):
        for idx in (0, count // 2, count - 1):
            path = out / axis / f"{idx:04d}.jpg"
            image = Image.open(path)
            decoded = np.asarray(image.convert("L"))
            source = (display[:, :, 2 * idx] if axis == "x"
                      else display[:, 2 * idx, :] if axis == "y"
                      else display[2 * idx, :, :])
            assert decoded.shape == source.shape, (path, decoded.shape, source.shape)
            error = np.abs(decoded.astype(np.int16) - source.astype(np.int16))
            validation.append({
                "path": str(path.relative_to(out)),
                "sourceIndex": idx * 2,
                "meanAbsoluteDisplayError": float(error.mean()),
                "maximumAbsoluteDisplayError": int(error.max()),
            })
    totals = {
        axis: sum(r["bytes"] for r in records if r["axis"] == axis)
        for axis in "xyz"
    }
    manifest = {
        "schemaVersion": 1,
        "specimen": "LADAF-2021-17",
        "organ": "heart",
        "datasetId": "1659197537",
        "datasetUrl": "https://human-organ-atlas.esrf.fr/datasets/1659197537",
        "doi": "10.15151/ESRF-DC-1634390196",
        "attribution": "Brunet et al. / ESRF Human Organ Atlas",
        "license": "CC BY 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "sourceHttp": SOURCE_HTTP,
        "sourceScale": "s3",
        "sourceScaleDimensions": [951, 951, 1060],
        "nativeSpacingUm": 19.85,
        "sourceDownsamplingFactor": 8,
        "sourceDtype": "uint16",
        "sourceIntensityWindow": list(WINDOW),
        "sourceWindow": list(WINDOW),
        "spacingUm": S3_SPACING,
        "sliceSpacingUm": S4_SPACING,
        "sliceCounts": list(SLICE_COUNTS),
        "imageDimensionsXYZ": list(CROP_XYZ),
        "sourceOffsetXYZ": [0, 0, 0],
        "sourceIndexStep": 2,
        "physicalCenterExtentUm": [(n - 1) * S3_SPACING for n in CROP_XYZ],
        "registration": "Slice index i uses N5 s3 index 2*i. Crop coordinates start at 0. "
                        "The first and last voxel centers match the application's s4 extent.",
        "pattern": "{axis}/{index}.jpg",
        "pad4": True,
        "indexPadding": 4,
        "format": "image/jpeg",
        "displayDtype": "uint8",
        "colorChannels": 1,
        "jpegQuality": args.quality,
        "compressionLossless": False,
        "imageCount": len(records),
        "totalBytes": sum(totals.values()),
        "axisBytes": totals,
        "axes": {
            "x": {"count": 475, "width": 949, "height": 1059,
                  "columns": "Y increasing", "rows": "Z increasing"},
            "y": {"count": 475, "width": 949, "height": 1059,
                  "columns": "X increasing", "rows": "Z increasing"},
            "z": {"count": 530, "width": 949, "height": 949,
                  "columns": "X increasing", "rows": "Y increasing"},
        },
        "textureMapping": "No image flip is applied. The first and last image pixel centers "
                          "represent the first and last source voxel centers. For exact GPU "
                          "sampling, convert physical [0,1] coordinates p to texture UV "
                          "(p*(imageDimensions-1)+0.5)/imageDimensions.",
        "containerMask": {
            "kind": "cylindrical display exclusion",
            "centerXY": list(CENTER_XY),
            "radiusVoxels": RADIUS,
            "radiusUm": RADIUS * S3_SPACING,
            "zExtent": "all cropped Z positions",
            "outsideValue": 0,
            "anatomicalSegmentation": False,
        },
        "processing": [
            "Decode original N5 Blosc-compressed big-endian uint16 blocks.",
            "Crop to [X,Y,Z]=[949,949,1059] to match current s4 center extent.",
            "Linearly window original intensities [14640,23545] to [0,255], round, and clip.",
            "Zero values outside the conservative mounting-container exclusion circle.",
            "Sample even s3 plane indices without in-plane resampling or sharpening.",
            f"Encode single-channel grayscale JPEG at quality {args.quality}.",
        ],
        "limitations": "Display textures have 158.8 um in-plane sampling and 317.6 um slice "
                       "steps. They are windowed 8-bit JPEG assets, not raw quantitative "
                       "intensity data. Native 19.85 um detail is not present. Clinical "
                       "orientation is not established by scan X/Y/Z labels.",
        "generatedDate": "2026-11-04",
        "reproducibility": ["download_s3.py", "assemble_s3.py", "prepare_sections.py"],
    }
    write_json(out / "manifest.json", manifest)
    write_json(root / "section-assets-checksums.json", records)
    summary = {
        "assetRoot": str(args.output),
        "sections": str(out),
        "imageCount": len(records),
        "totalBytes": sum(totals.values()),
        "axisBytes": totals,
        "quality": args.quality,
        "elapsedSeconds": time.time() - started,
        "validation": validation,
    }
    write_json(root / "section-assets-summary.json", summary)
    status.update(stage="complete", **summary)
    write_json(root / "cap-detail-status.json", status)
    print("READY " + json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
