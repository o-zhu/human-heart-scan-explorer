#!/usr/bin/env python3
"""Verify the shipped v24 deformation shaders with scientific EGL renderings.

The actual JS GLSL literals are compiled unchanged. Transform feedback compares
their positions with deformPoint() and their normals with an independent
finite-difference cofactor calculation using that same JS position function.
This checks implementation correctness, not anatomical or motion accuracy.
"""
from __future__ import annotations

import argparse
import ctypes as C
import gzip
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import re
import subprocess
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("motion_egl_helper", ROOT / "scripts/native-surface-v20/render_egl.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def atomic_bytes(path, data):
    pending = path.with_name(path.name + ".pending")
    assert pending.write_bytes(data) == len(data)
    pending.replace(path)
    assert path.read_bytes() == data


def save_png(path, image):
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    data = stream.getvalue()
    # Pillow verify checks PNG chunk CRCs, and load additionally inflates pixels.
    Image.open(io.BytesIO(data)).verify()
    Image.open(io.BytesIO(data)).load()
    atomic_bytes(path, data)
    Image.open(path).verify()
    Image.open(path).load()


def literal(source, name):
    match = re.search(r"export const " + re.escape(name) + r"\s*=\s*`([\s\S]*?)`;", source)
    if not match or "${" in match.group(1):
        raise ValueError(f"Expected a literal GLSL export: {name}")
    return match.group(1)


class MotionRenderer(helper.SurfaceRenderer):
    def __init__(self, vertex, fragment, width, height):
        super().__init__(width, height)
        self.f("glDeleteProgram", None, [self.U])(self.program)
        self.program = self.compile(vertex, fragment)
        names = (C.c_char_p * 2)(b"vPosition", b"vNormal")
        self.f("glTransformFeedbackVaryings", None, [self.U, self.I, C.POINTER(C.c_char_p), self.U])(
            self.program, 2, names, 0x8C8C)
        self.f("glLinkProgram", None, [self.U])(self.program)
        ok = self.I()
        self.f("glGetProgramiv", None, [self.U, self.U, C.POINTER(self.I)])(self.program, 0x8B82, C.byref(ok))
        log = C.create_string_buffer(32768)
        self.f("glGetProgramInfoLog", None, [self.U, self.I, self.P, C.c_char_p])(self.program, 32768, None, log)
        assert ok.value, log.value.decode()
        self.link_log = log.value.decode()
        self.f("glUseProgram", None, [self.U])(self.program)
        self.uniforms = {}
        self.f("glDisable", None, [self.U])(0x0B44)
        self.f("glDisable", None, [self.U])(0x0BE2)
        self.f("glDepthFunc", None, [self.U])(0x0201)
        self.check("program initialization")

    def check(self, label):
        error = self.f("glGetError", self.U, [])()
        assert error == 0, f"GL error 0x{error:x}: {label}"

    def uniform(self, name, value, integer=False):
        key = "u" + name
        if key not in self.uniforms:
            self.uniforms[key] = self.location(self.program, key.encode())
        location = self.uniforms[key]
        if isinstance(value, (list, tuple, np.ndarray)):
            self.f(f"glUniform{len(value)}f", None, [self.I] + [self.F] * len(value))(location, *value)
        elif integer:
            self.f("glUniform1i", None, [self.I, self.I])(location, int(value))
        else:
            self.f("glUniform1f", None, [self.I, self.F])(location, float(value))

    def upload(self, positions, normals, indices=None, packed_normals=False):
        vao = self.U()
        self.f("glGenVertexArrays", None, [self.I, C.POINTER(self.U)])(1, C.byref(vao))
        self.f("glBindVertexArray", None, [self.U])(vao)
        buffers = []
        for slot, array in enumerate((positions, normals)):
            array = np.ascontiguousarray(array)
            buffer = self.U()
            self.f("glGenBuffers", None, [self.I, C.POINTER(self.U)])(1, C.byref(buffer))
            buffers.append(buffer)
            self.f("glBindBuffer", None, [self.U, self.U])(0x8892, buffer)
            self.f("glBufferData", None, [self.U, C.c_ssize_t, self.P, self.U])(0x8892, array.nbytes, array.ctypes.data, 0x88E4)
            self.f("glEnableVertexAttribArray", None, [self.U])(slot)
            packed = slot == 1 and packed_normals
            self.f("glVertexAttribPointer", None, [self.U, self.I, self.U, self.U, self.I, self.P])(
                slot, 3, 0x1402 if packed else 0x1406, int(packed), 0, None)
        if indices is not None:
            indices = np.ascontiguousarray(indices, dtype=np.uint32)
            buffer = self.U()
            self.f("glGenBuffers", None, [self.I, C.POINTER(self.U)])(1, C.byref(buffer))
            buffers.append(buffer)
            self.f("glBindBuffer", None, [self.U, self.U])(0x8893, buffer)
            self.f("glBufferData", None, [self.U, C.c_ssize_t, self.P, self.U])(0x8893, indices.nbytes, indices.ctypes.data, 0x88E4)
        self.check("geometry upload")
        return vao, buffers

    def release(self, mesh):
        vao, buffers = mesh
        self.f("glBindVertexArray", None, [self.U])(0)
        for buffer in buffers:
            self.f("glDeleteBuffers", None, [self.I, C.POINTER(self.U)])(1, C.byref(buffer))
        self.f("glDeleteVertexArrays", None, [self.I, C.POINTER(self.U)])(1, C.byref(vao))

    def settings(self, mode, amount, twist=True, cut=False):
        yaw, pitch, flip = .48, .20, -1
        right = [flip * math.cos(yaw), 0, -flip * math.sin(yaw)]
        up = [-flip * math.sin(pitch) * math.sin(yaw), flip * math.cos(pitch), -flip * math.sin(pitch) * math.cos(yaw)]
        view = [math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch)]
        for name, value in (("Center", [0, 0, 0]), ("Right", right), ("Up", up), ("View", view),
                            ("Min", [0, 0, 0]), ("Max", [1, 1, 1]), ("Pan", [0, 0]),
                            ("Tint", [.47, .35, .27]), ("CutAxis", [0, 0, 1]),
                            ("CutValue", -.025), ("Span", 1.12), ("Aspect", self.width / self.height),
                            ("Amount", amount), ("Twist", float(twist))):
            self.uniform(name, value)
        for name, value in (("FloatPosition", 1), ("Mode", mode), ("CutEnabled", cut)):
            self.uniform(name, value, integer=True)

    def render(self, mesh, index_count, mode, amount, cut=False):
        self.settings(mode, amount, cut=cut)
        self.f("glBindVertexArray", None, [self.U])(mesh[0])
        self.f("glClearColor", None, [self.F] * 4)(.031, .083, .105, 1)
        self.f("glClear", None, [self.U])(0x4000 | 0x0100)
        start = time.monotonic()
        self.f("glDrawElements", None, [self.U, self.I, self.U, self.P])(4, index_count, 0x1405, None)
        self.f("glFinish", None, [])()
        seconds = time.monotonic() - start
        result = np.empty((self.height, self.width, 4), np.uint8)
        self.f("glReadPixels", None, [self.I] * 4 + [self.U, self.U, self.P])(
            0, 0, self.width, self.height, 0x1908, 0x1401, result.ctypes.data)
        self.check("scientific rendering")
        return result[::-1, :, :3].copy(), seconds

    def feedback(self, mesh, count, mode, amount, twist):
        self.settings(mode, amount, twist=twist)
        self.f("glBindVertexArray", None, [self.U])(mesh[0])
        buffer = self.U()
        self.f("glGenBuffers", None, [self.I, C.POINTER(self.U)])(1, C.byref(buffer))
        target, byte_count = 0x8C8E, count * 6 * 4
        self.f("glBindBuffer", None, [self.U, self.U])(target, buffer)
        self.f("glBufferData", None, [self.U, C.c_ssize_t, self.P, self.U])(target, byte_count, None, 0x88E1)
        self.f("glBindBufferBase", None, [self.U, self.U, self.U])(target, 0, buffer)
        self.f("glEnable", None, [self.U])(0x8C89)
        self.f("glBeginTransformFeedback", None, [self.U])(0)
        self.f("glDrawArrays", None, [self.U, self.I, self.I])(0, 0, count)
        self.f("glEndTransformFeedback", None, [])()
        self.f("glDisable", None, [self.U])(0x8C89)
        self.f("glFinish", None, [])()
        self.check("transform feedback")
        mapped = self.f("glMapBufferRange", self.P, [self.U, C.c_ssize_t, C.c_ssize_t, self.U])(
            target, 0, byte_count, 1)
        assert mapped, "Could not read transform-feedback results"
        result = np.frombuffer(C.string_at(mapped, byte_count), dtype=np.float32).reshape(count, 6).copy()
        assert self.f("glUnmapBuffer", self.U, [self.U])(target)
        self.f("glBindBufferBase", None, [self.U, self.U, self.U])(target, 0, 0)
        self.f("glDeleteBuffers", None, [self.I, C.POINTER(self.U)])(1, C.byref(buffer))
        self.check("transform-feedback readback")
        return result


def cpu_reference(points, normals, settings):
    # This evaluates the real JS function. The normal reference is independently
    # obtained by finite differences, not by copying the GLSL derivative formula.
    program = r"""
import fs from 'node:fs';
import {deformPoint,RIG} from './public/motion-field-v24.js';
const {points,normals,settings}=JSON.parse(fs.readFileSync(0,'utf8'));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const results=settings.map(({mode,amount,twist})=>points.map((p,i)=>{
 const position=deformPoint(p,amount,mode,twist),n=normals[i];
 if(!mode||!amount)return [...position,...n];
 const eps=1e-5;
 const j=[0,1,2].map(axis=>{
  const lo=p.slice(),hi=p.slice();lo[axis]-=eps;hi[axis]+=eps;
  const a=deformPoint(lo,amount,mode,twist),b=deformPoint(hi,amount,mode,twist);
  return b.map((x,k)=>(x-a[k])/(2*eps));
 });
 const c=[cross(j[1],j[2]),cross(j[2],j[0]),cross(j[0],j[1])];
 const transformed=[0,1,2].map(k=>n[0]*c[0][k]+n[1]*c[1][k]+n[2]*c[2][k]);
 const norm=Math.hypot(...transformed);
 return [...position,...transformed.map(x=>x/norm)];
}));
console.log(JSON.stringify({rig:RIG,results}));
"""
    response = subprocess.run(["node", "--input-type=module", "-e", program], cwd=ROOT,
                              input=json.dumps(dict(points=points.tolist(), normals=normals.tolist(), settings=settings)),
                              text=True, capture_output=True, check=True)
    return json.loads(response.stdout)


def font(size, bold=False):
    return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans" + ("-Bold" if bold else "") + ".ttf", size)


def comparison_figure(frames, width, height, world_mm):
    margin, gap, top, label_height, bottom = 28, 16, 128, 55, 110
    canvas = Image.new("RGB", (2 * margin + 3 * width + 2 * gap, top + 2 * (height + label_height) + gap + bottom), "#f4f5f2")
    draw = ImageDraw.Draw(canvas)
    draw.text((margin, 20), "High-resolution anatomy under an illustrative motion field", font=font(30, True), fill="#142e35")
    draw.text((margin, 66), "Actual v24 GLSL · 699,001 vertices · 2,500,000 triangles · matched camera and lighting", font=font(19), fill="#344d54")
    draw.text((margin, 96), "Scientific EGL rendering of the existing 79.4 µm display surface; not a browser screenshot", font=font(18), fill="#52666a")
    titles = ["Scanned reference", "Cavity-aware field · peak", "Simple squeeze · peak"]
    subtitles = ["Exact zero-deformation geometry", "Radial redistribution + shortening + twist", "Uniform radial factor + shortening + twist"]
    for row in range(2):
        for col in range(3):
            x, y = margin + col * (width + gap), top + row * (height + label_height + gap)
            draw.text((x, y), titles[col], font=font(20, True), fill="#142e35")
            draw.text((x, y + 28), ("Exterior · " if row == 0 else "Open cutaway · ") + subtitles[col], font=font(13), fill="#52666a")
            canvas.paste(Image.fromarray(frames[row * 3 + col]), (x, y + label_height))
            bar = round(20 / (1.12 * world_mm) * height)
            baseline = y + label_height + height - 27
            draw.line((x + 24, baseline, x + 24 + bar, baseline), fill="#d1e3e3", width=3)
            draw.text((x + 24, baseline - 25), "20 mm", font=font(14), fill="#d1e3e3")
    y = canvas.height - bottom + 16
    draw.text((margin, y), "Motion is synthetic and is not registered to dynamic CT. The fixed specimen is not an identified end-diastolic state.", font=font(18), fill="#344d54")
    draw.text((margin, y + 30), "Cutaways use the same world-space plane (z = −0.025); no caps or new anatomical surfaces are added.", font=font(17), fill="#52666a")
    draw.text((margin, y + 58), "Evidence source: LADAF-2021-17 / Human Organ Atlas · field implementation check, not clinical validation", font=font(17), fill="#52666a")
    return canvas


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mesh", type=Path, default=Path("/workspace/data/guided-native-v21/whole/overview/assets/detail.hfm.gz"))
    parser.add_argument("--output", type=Path, default=ROOT / "docs/motion-lab-v24")
    parser.add_argument("--width", type=int, default=550)
    parser.add_argument("--height", type=int, default=600)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    field_path, lab_path = ROOT / "public/motion-field-v24.js", ROOT / "public/motion-lab-v24.js"
    field_source, lab_source = field_path.read_text(), lab_path.read_text()
    vertex = literal(lab_source, "vertexPrefix") + literal(field_source, "fieldGLSL") + literal(lab_source, "vertexSuffix")
    fragment = literal(lab_source, "fragment")
    source = json.loads((ROOT / "public/assets/motion-lab-v24/donor.json").read_text())
    record = next(item for item in source["overviewLods"] if item["id"] == "detail")["parts"][0]
    packed = args.mesh.read_bytes()
    raw = gzip.decompress(packed)
    assert sha(packed) == record["sha256"] and sha(raw) == record["decodedSha256"]
    magic, version, vertex_count, index_count, pos_offset, norm_offset, index_offset, flag = np.frombuffer(raw, "<u4", count=8)
    assert magic == 0x314D4648 and version == 1 and flag == 1
    positions = np.frombuffer(raw, "<f4", count=int(vertex_count) * 3, offset=int(pos_offset)).reshape(-1, 3)
    normals = np.frombuffer(raw, "<i2", count=int(vertex_count) * 3, offset=int(norm_offset)).reshape(-1, 3)
    indices = np.frombuffer(raw, "<u4", count=int(index_count), offset=int(index_offset))
    renderer = MotionRenderer(vertex, fragment, args.width, args.height)
    mesh = renderer.upload(positions, normals, indices, packed_normals=True)
    frames, renders = [], []
    for cut in (False, True):
        for name, mode, amount in (("rest", 2, 0), ("cavity-aware", 2, 1), ("simple-squeeze", 1, 1)):
            pixels, seconds = renderer.render(mesh, int(index_count), mode, amount, cut)
            assert np.count_nonzero(np.max(pixels, axis=2) > 40) > 5000, "Blank scientific rendering"
            filename = f"render-{name}-{'cutaway' if cut else 'exterior'}.png"
            save_png(args.output / filename, Image.fromarray(pixels))
            frames.append(pixels)
            renders.append(dict(mode=name, amount=amount, cutaway=cut, file=filename, drawSeconds=seconds,
                                width=args.width, height=args.height, imageSha256=sha((args.output / filename).read_bytes())))
    figure = comparison_figure(frames, args.width, args.height, source["worldMm"])
    save_png(args.output / "render-comparison.png", figure)
    renderer.release(mesh)

    # Include actual surface normals and samples close to the radial singularity,
    # both polynomial endpoints, and the GLSL small-q branch at q=0.001.
    rng = np.random.default_rng(24)
    sampled = np.linspace(0, int(vertex_count) - 1, 2048, dtype=int)
    extra = []
    for y in (-.10001, -.1, -.09999, -.04, .08, .21999, .22, .22001, .38):
        for q in (0, 1e-9, 1e-5, .000099, .000101, .000999, .001, .001001, .005, .1, 1, 4):
            for angle in (.3, 2.1):
                radius = .145 * math.sqrt(q)
                extra.append([.055 + radius * math.cos(angle), y, -.045 + radius * math.sin(angle)])
    extra = np.asarray(extra, np.float32)
    extra_normals = rng.normal(size=extra.shape)
    extra_normals /= np.linalg.norm(extra_normals, axis=1, keepdims=True)
    all_positions = np.ascontiguousarray(np.concatenate((positions[sampled], extra)), dtype=np.float32)
    all_normals = np.ascontiguousarray(np.concatenate((np.maximum(normals[sampled].astype(np.float64) / 32767, -1), extra_normals)), dtype=np.float32)
    settings = [dict(mode=2, amount=0, twist=True), dict(mode=0, amount=1, twist=True),
                dict(mode=1, amount=1, twist=True), dict(mode=2, amount=1, twist=True),
                dict(mode=2, amount=1, twist=False), dict(mode=2, amount=.43, twist=True)]
    cpu = cpu_reference(all_positions, all_normals, settings)
    sample_mesh = renderer.upload(all_positions, all_normals)
    comparisons = []
    for setting, expected in zip(settings, cpu["results"]):
        actual = renderer.feedback(sample_mesh, len(all_positions), **setting).astype(np.float64)
        expected = np.asarray(expected, dtype=np.float64)
        assert np.isfinite(actual).all() and np.isfinite(expected).all()
        distance = np.linalg.norm(actual[:, :3] - expected[:, :3], axis=1) * source["worldMm"]
        an = actual[:, 3:] / np.linalg.norm(actual[:, 3:], axis=1, keepdims=True)
        en = expected[:, 3:] / np.linalg.norm(expected[:, 3:], axis=1, keepdims=True)
        normal_angle = np.degrees(np.arctan2(np.linalg.norm(np.cross(an, en), axis=1), np.sum(an * en, axis=1)))
        comparisons.append(dict(**setting, points=len(all_positions),
                                positionMaximumErrorMm=float(distance.max()), positionP95ErrorMm=float(np.quantile(distance, .95)),
                                normalMaximumAngularErrorDeg=float(normal_angle.max()), normalP95AngularErrorDeg=float(np.quantile(normal_angle, .95)),
                                worstNormalPoint=all_positions[int(np.argmax(normal_angle))].tolist()))
    renderer.release(sample_mesh)
    # Exact bound for the y derivative using extrema of W+(y-base)W_y.
    rig = cpu["rig"]
    length = rig["high"] - rig["low"]
    c = (rig["base"] - rig["low"]) / length
    candidates = np.r_[0, 1, np.roots([3, -(2 + 2 * c), c])]
    candidates = candidates[np.isreal(candidates)].real
    candidates = candidates[(candidates >= 0) & (candidates <= 1)]
    w = candidates ** 3 * (10 + candidates * (-15 + 6 * candidates))
    wy = 30 * candidates ** 2 * (1 - candidates) ** 2
    minimum_d = float(np.min(1 - rig["axial"] * (w + (candidates - c) * wy)))
    tolerance_mm, tolerance_deg = .005, .25
    passes = all(item["positionMaximumErrorMm"] < tolerance_mm and item["normalMaximumAngularErrorDeg"] < tolerance_deg for item in comparisons)
    report = dict(schema="heart-motion-egl-audit-v24.1", verificationPassed=passes,
                  scientificRendering=True, browserScreenshot=False, clinicalValidation=False,
                  source=dict(path=str(args.mesh), compressedSha256=sha(packed), decodedSha256=sha(raw),
                              vertices=int(vertex_count), triangles=int(index_count // 3),
                              displaySamplingUm=source["displaySamplingUm"], nativeSpecimenSamplingUm=source["sourceSpacingUm"],
                              additionalSimplification=False, sourceGeometryModified=False),
                  shader=dict(fieldFileSha256=sha(field_source.encode()), labFileSha256=sha(lab_source.encode()),
                              exactVertexShaderSha256=sha(vertex.encode()), exactFragmentShaderSha256=sha(fragment.encode()),
                              compileAndLinkPassed=True, transformFeedbackFromUnmodifiedVertexShader=True, linkLog=renderer.link_log),
                  renderer=dict(driver=renderer.driver, api=renderer.f("glGetString", C.c_char_p, [renderer.U])(0x1F02).decode(),
                                width=args.width, height=args.height, antialiasing=False,
                                timingIsBrowserBenchmark=False),
                  view=dict(yaw=.48, pitch=.20, flip=True, span=1.12, center=[0, 0, 0],
                            cutAxis=[0, 0, 1], cutValue=-.025, cutPlaneInWorldSpace=True, capsAdded=False),
                  cpuGpuComparisons=comparisons,
                  acceptanceTolerances=dict(maximumPositionErrorMm=tolerance_mm, maximumNormalAngularErrorDeg=tolerance_deg,
                                            purpose="Implementation agreement, not anatomical accuracy"),
                  normalReference="Cofactor of central finite-difference Jacobian of the actual JS deformPoint(); step 1e-5 world units. Compared with GLSL transform-feedback vNormal.",
                  analyticalChecks=dict(minimumAxialDerivativeAcrossAllowedAmplitude=minimum_d,
                                        minimumCavityAwareJacobianAcrossAllowedAmplitude=1 - rig["radial"],
                                        positiveJacobianMeansNoLocalFolding=True,
                                        myocardialVolumeConservationEstablished=False),
                  renders=renders, comparisonFile="render-comparison.png",
                  caveats=["Source is the existing simplified whole-heart display mesh, not the full native surface bank.",
                           "Motion is a synthetic single-axis field, not a segmentation-based cardiac mechanics model.",
                           "Neither measured subject motion nor myocardial volume conservation is validated.",
                           "Normals are validated against the deformation differential, not against anatomical tissue normals.",
                           "Cavity-aware is the field name; no chamber segmentation or pressure boundary condition is present.",
                           "World-plane cutaways intersect different material points during motion."])
    report["comparisonSha256"] = sha((args.output / "render-comparison.png").read_bytes())
    report["pngChecksumsAndPixelReadbackPassed"] = True
    atomic_bytes(args.output / "render-report.json", (json.dumps(report, indent=2) + "\n").encode())
    print(json.dumps(dict(verificationPassed=passes, output=str(args.output), driver=renderer.driver,
                         minimumAxialDerivative=minimum_d, comparisons=comparisons), indent=2))
    assert passes, "CPU/GLSL deformation or normal comparison exceeded implementation tolerances"


if __name__ == "__main__":
    main()
