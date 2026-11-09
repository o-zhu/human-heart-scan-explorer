"""Review production reference-probe geometry in native EGL, without a browser.

The BodyParts3D torso is illustrative and is not registered to the donor. This
checks mesh scale, indicator visibility and framing, not clinical registration,
DOM/SVG indicator labels, browser layout, or browser interaction/performance.
"""
from pathlib import Path
import ctypes as C
import gzip
import hashlib
import json
import re
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/probe-lab-v13"
OUT.mkdir(exist_ok=True)
BASELINE = "4b22b2f9fd66314e716c39b1148f8682bdac06f1"
W, H = 600, 640

# Node exports the actual authored meshes and source-pose mapping. The fixed
# v12 source is imported in memory; no baseline runtime file is written.
JS = r"""
import * as current from './public/probe-scene.js';
import {PROBE_PRESETS,PROBE_REFERENCE_MM,sanitizeProbeState,probePose,probeContactSurface} from './public/probe-geometry.js';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
const baselineCommit=process.argv[1];
const original=execFileSync('git',['show',baselineCommit+':public/probe-scene.js'],{encoding:'utf8'});
const source=original.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,spec)=>'from '+q+pathToFileURL(resolve('public',spec)).href+q);
const baseline=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const manifest=JSON.parse(readFileSync('public/assets/probe-context-v11/manifest.json','utf8'));
const data=gunzipSync(readFileSync('public/assets/probe-context-v11/'+manifest.dataFile));
const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
for(const mesh of manifest.meshes){
 if(mesh.name==='skin')continue;
 const a=new Float32Array(data.buffer,data.byteOffset+mesh.offset,mesh.count*6);
 for(let j=0;j<a.length;j+=6)for(let i=0;i<3;i++){low[i]=Math.min(low[i],a[j+i]);high[i]=Math.max(high[i],a[j+i]);}
}
const copy=meshes=>meshes.map(m=>({...m,vertices:Array.from(m.vertices)}));
const hash=meshes=>{const h=createHash('sha256');for(const m of meshes){h.update(Buffer.from(m.vertices.buffer,m.vertices.byteOffset,m.vertices.byteLength));h.update(JSON.stringify({color:m.color,gloss:m.gloss}));}return h.digest('hex');};
const meshes={},mainComparison={};
for(const kind of ['phased','tee']){
 const old=baseline.createProbeMeshes(kind),now=current.createProbeMeshes(kind);
 meshes[kind]={before:copy(old),after:copy(current.createReferenceProbeMeshes(kind)),main:copy(now)};
 mainComparison[kind]={beforeSha256:hash(old),afterSha256:hash(now)};
}
const frames=JSON.parse(readFileSync('public/assets/echo-planes.json','utf8')).frames;
const cases=[];
for(const preset of PROBE_PRESETS){
 const frame={...frames[preset.frame].world,referenceMm:PROBE_REFERENCE_MM};
 for(const rotated of [false,...(preset.id==='parasternal'?[true]:[])]){
  const state=sanitizeProbeState({preset:preset.id,referenceMm:PROBE_REFERENCE_MM,depthMm:preset.depthMm,
   ...(rotated?{contactPositionMm:[18,-12],sweepDeg:17,tiltDeg:-12,rollDeg:65}:{})});
  const surface=probeContactSurface(preset.id,frame),sourcePose=probePose(state,frame);
  const oldPose=baseline.referenceTorsoPose(state,manifest,surface),newPose=current.referenceTorsoPose(state,manifest,surface,sourcePose);
  if(!oldPose||!newPose)throw new Error('Reference pose missing: '+preset.id);
  cases.push({id:preset.id+(rotated?'-moved-rotated':''),label:preset.name+(rotated?' / moved + rotated':''),
   kind:preset.id==='atrial'?'tee':'phased',state,sourcePose,beforePose:oldPose,afterPose:newPose,
   before:Array.from(baseline.probeModelMatrix(oldPose,baseline.REFERENCE_PROBE_VISUAL_SCALE)),
   after:Array.from(current.probeModelMatrix(newPose,current.REFERENCE_PROBE_VISUAL_SCALE))});
 }
}
const mainPose={originMm:[0,0,0],right:[1,0,0],normal:[0,1,0],beam:[0,0,-1]};
console.log(JSON.stringify({meshes,mainComparison,cases,
 scales:{beforeReference:baseline.REFERENCE_PROBE_VISUAL_SCALE,afterReference:current.REFERENCE_PROBE_VISUAL_SCALE,beforeMain:baseline.probeDisplayScale(PROBE_REFERENCE_MM),afterMain:current.probeDisplayScale(PROBE_REFERENCE_MM)},
 mainModels:{before:Array.from(baseline.probeModelMatrix(mainPose,baseline.probeDisplayScale(PROBE_REFERENCE_MM))),after:Array.from(current.probeModelMatrix(mainPose,current.probeDisplayScale(PROBE_REFERENCE_MM)))},
 cameras:Object.fromEntries(['front','oblique'].map(mode=>[mode,current.referenceTorsoCamera(mode,600/640,{min:low,max:high})]))}));
"""
scene = json.loads(subprocess.check_output(
    ["node", "--input-type=module", "-e", JS, BASELINE], cwd=ROOT
))
assert scene["scales"]["beforeMain"] == scene["scales"]["afterMain"] == 0.4
assert scene["scales"]["afterReference"] == 1.2
for record in scene["mainComparison"].values():
    assert record["beforeSha256"] == record["afterSha256"]
assert scene["mainModels"]["before"] == scene["mainModels"]["after"]

# Reuse only native, surfaceless EGL initialization from the existing verifier.
setup = (ROOT / "scripts/verify-shader.py").read_text().split("create=fn('glCreateShader'")[0]
exec(setup)
F = C.c_float
create = fn("glCreateShader", U, [U])
source = fn("glShaderSource", None, [U, I, C.POINTER(C.c_char_p), C.POINTER(I)])
compile_shader = fn("glCompileShader", None, [U])
getiv = fn("glGetShaderiv", None, [U, U, C.POINTER(I)])
getlog = fn("glGetShaderInfoLog", None, [U, I, C.POINTER(I), C.c_char_p])
runtime = (ROOT / "public/probe-scene.js").read_text()
report = {
    "scope": "Native production GLSL and mesh review; no browser, DOM/SVG callout, clinical registration or performance claim.",
    "referenceAnatomy": "BodyParts3D / DBCLS, CC BY 4.0; not donor-registered.",
    "baselineCommit": BASELINE,
    "runtimeSha256": hashlib.sha256(runtime.encode()).hexdigest(),
    "mainMeshComparison": scene["mainComparison"],
    "scales": scene["scales"],
    "shaders": [],
    "views": [],
}
shaders = []
for name, kind in [("VERTEX", 0x8B31), ("FRAGMENT", 0x8B30)]:
    shader_source = re.search(r"const " + name + r"=`([\s\S]*?)`;", runtime).group(1).encode()
    shader = create(kind)
    ptr = C.c_char_p(shader_source)
    source(shader, 1, C.byref(ptr), None)
    compile_shader(shader)
    ok, log = I(), C.create_string_buffer(16384)
    getiv(shader, 0x8B81, C.byref(ok))
    getlog(shader, 16384, None, log)
    assert ok.value, log.value.decode()
    shaders.append(shader)
    report["shaders"].append({"name": name, "compiled": True, "sha256": hashlib.sha256(shader_source).hexdigest()})
program = fn("glCreateProgram", U, [])()
for shader in shaders:
    fn("glAttachShader", None, [U, U])(program, shader)
fn("glLinkProgram", None, [U])(program)
ok = I()
fn("glGetProgramiv", None, [U, U, C.POINTER(I)])(program, 0x8B82, C.byref(ok))
assert ok.value, "Native geometry program failed to link"
report["driver"] = fn("glGetString", C.c_char_p, [U])(0x1F01).decode()
fn("glUseProgram", None, [U])(program)
loc = fn("glGetUniformLocation", I, [U, C.c_char_p])
u1 = fn("glUniform1f", None, [I, F])
u3 = fn("glUniform3f", None, [I, F, F, F])
u4 = fn("glUniform4f", None, [I, F, F, F, F])
um = fn("glUniformMatrix4fv", None, [I, I, U, P])

texture, fbo, depth, buffer = U(), U(), U(), U()
fn("glGenTextures", None, [I, C.POINTER(U)])(1, C.byref(texture))
fn("glBindTexture", None, [U, U])(0x0DE1, texture)
fn("glTexImage2D", None, [U, I, I, I, I, I, U, U, P])(0x0DE1, 0, 0x8058, W, H, 0, 0x1908, 0x1401, None)
fn("glGenFramebuffers", None, [I, C.POINTER(U)])(1, C.byref(fbo))
fn("glBindFramebuffer", None, [U, U])(0x8D40, fbo)
fn("glFramebufferTexture2D", None, [U, U, U, U, I])(0x8D40, 0x8CE0, 0x0DE1, texture, 0)
fn("glGenRenderbuffers", None, [I, C.POINTER(U)])(1, C.byref(depth))
fn("glBindRenderbuffer", None, [U, U])(0x8D41, depth)
fn("glRenderbufferStorage", None, [U, U, I, I])(0x8D41, 0x81A6, W, H)
fn("glFramebufferRenderbuffer", None, [U, U, U, U])(0x8D40, 0x8D00, 0x8D41, depth)
assert fn("glCheckFramebufferStatus", U, [U])(0x8D40) == 0x8CD5
position = fn("glGetAttribLocation", I, [U, C.c_char_p])(program, b"position")
normal = fn("glGetAttribLocation", I, [U, C.c_char_p])(program, b"normal")
for attribute in [position, normal]:
    fn("glEnableVertexAttribArray", None, [U])(attribute)
fn("glGenBuffers", None, [I, C.POINTER(U)])(1, C.byref(buffer))
fn("glBindBuffer", None, [U, U])(0x8892, buffer)
fn("glEnable", None, [U])(0x0B71)
fn("glDepthFunc", None, [U])(0x0203)
fn("glEnable", None, [U])(0x0BE2)
fn("glBlendFuncSeparate", None, [U, U, U, U])(0x0302, 0x0303, 1, 0x0303)

manifest = json.loads((ROOT / "public/assets/probe-context-v11/manifest.json").read_text())
body_bytes = gzip.decompress((ROOT / "public/assets/probe-context-v11" / manifest["dataFile"]).read_bytes())
body = [{**mesh, "vertices": np.frombuffer(body_bytes, dtype="<f4", count=mesh["count"] * 6, offset=mesh["offset"])} for mesh in manifest["meshes"]]


def camera(basis, reference_mm=400):
    for key, value in [("eye", basis["eye"]), ("forward", basis["forward"]), ("cameraRight", basis["right"]), ("cameraUp", basis["up"])]:
        u3(loc(program, key.encode()), *value)
    u1(loc(program, b"referenceMm"), reference_mm)
    u1(loc(program, b"aspect"), W / H)


def draw(mesh, model=None):
    vertices = np.asarray(mesh["vertices"], dtype=np.float32).reshape(-1, 6)
    fn("glBufferData", None, [U, C.c_ssize_t, P, U])(0x8892, vertices.nbytes, vertices.ctypes.data, 0x88E4)
    pointer = fn("glVertexAttribPointer", None, [U, I, U, U, I, P])
    pointer(position, 3, 0x1406, 0, 24, None)
    pointer(normal, 3, 0x1406, 0, 24, 12)
    matrix = np.asarray(model if model is not None else np.eye(4).ravel(), dtype=np.float32)
    um(loc(program, b"model"), 1, 0, matrix.ctypes.data)
    alpha = mesh.get("alpha", 1)
    u4(loc(program, b"color"), *mesh["color"], alpha)
    u1(loc(program, b"gloss"), mesh.get("gloss", 0.04 if mesh.get("name") == "skin" else 0.08))
    fn("glDepthMask", None, [U])(int(alpha > 0.7))
    fn("glDrawArrays", None, [U, I, I])(4, 0, len(vertices))
    fn("glDepthMask", None, [U])(1)


def begin():
    fn("glViewport", None, [I, I, I, I])(0, 0, W, H)
    fn("glClearColor", None, [F, F, F, F])(0.04, 0.075, 0.08, 1)
    fn("glClear", None, [U])(0x4000 | 0x0100)


def pixels():
    fn("glFinish", None, [])()
    rgba = np.empty((H, W, 4), np.uint8)
    fn("glReadPixels", None, [I, I, I, I, U, U, P])(0, 0, W, H, 0x1908, 0x1401, rgba.ctypes.data)
    return rgba[::-1, :, :3].copy()


def render(case, mode, version, include_probe=True, include_marker=True):
    begin()
    camera(scene["cameras"][mode])
    for mesh in body:
        if mesh["name"] != "skin":
            draw(mesh)
    if include_probe:
        for mesh in scene["meshes"][case["kind"]][version]:
            if include_marker or mesh.get("role") != "indicator":
                draw(mesh, case[version])
    for mesh in body:
        if mesh["name"] == "skin":
            draw(mesh)
    return pixels()


def projection_metrics(case, mode):
    basis = scene["cameras"][mode]
    model = np.asarray(case["after"]).reshape(4, 4).T
    vertices = np.concatenate([np.asarray(m["vertices"]).reshape(-1, 6)[:, :3] for m in scene["meshes"][case["kind"]]["after"]])
    world = vertices @ model[:3, :3].T + model[:3, 3]
    delta = world / 400 - basis["eye"]
    d = delta @ basis["forward"]
    x = (delta @ basis["right"]) / (d * 0.32 * W / H)
    y = (delta @ basis["up"]) / (d * 0.32)
    outside = (d <= 0.015) | (np.abs(x) >= 1) | (np.abs(y) >= 1)
    return {"maxNormalizedExtent": round(float(max(np.max(np.abs(x)), np.max(np.abs(y)))), 5), "verticesOutsideView": int(np.count_nonzero(outside)), "vertexCount": len(vertices)}


def font(size):
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default()


def make_panel(rgb, heading, detail):
    panel = Image.new("RGB", (W, H + 84), "#0a1317")
    panel.paste(Image.fromarray(rgb), (0, 54))
    pen = ImageDraw.Draw(panel)
    pen.text((16, 10), heading, fill="#e4e6db", font=font(20))
    pen.text((16, H + 60), detail, fill="#9eb6b2", font=font(13))
    return panel


def changed(a, b):
    return int(np.count_nonzero(np.max(np.abs(a.astype(np.int16) - b.astype(np.int16)), axis=2) > 3))


for mode in ["front", "oblique"]:
    standard_rows, moved_rows = [], []
    for case in scene["cases"]:
        old = render(case, mode, "before")
        new = render(case, mode, "after")
        background = render(case, mode, "after", include_probe=False)
        no_marker = render(case, mode, "after", include_marker=False)
        framing = projection_metrics(case, mode)
        old_pixels, new_pixels = changed(old, background), changed(new, background)
        record = {"id": case["id"], "camera": mode, "beforeVisibleProbePixels": old_pixels,
                  "afterVisibleProbePixels": new_pixels, "afterVisibleIndicatorPixels": changed(new, no_marker), **framing}
        report["views"].append(record)
        assert np.count_nonzero(new.max(axis=2) > 30) > 10000, "Reference torso failed to render"
        assert framing["verticesOutsideView"] == 0, f"Probe clipping: {case['id']} / {mode} / {framing}"
        if case["kind"] == "phased" and "moved" not in case["id"]:
            assert new_pixels > old_pixels * 2, f"Reference probe did not visibly enlarge: {record}"
        row = Image.new("RGB", (W * 2, H + 84))
        row.paste(make_panel(old, "Before · " + case["label"], "Same " + mode + " camera · prior reference mapping / scale 0.45"), (0, 0))
        row.paste(make_panel(new, "After · " + case["label"], "Source-pose mapping · scale 1.20 · raised indicator"), (W, 0))
        (moved_rows if "moved" in case["id"] else standard_rows).append(row)
    sheet = Image.new("RGB", (W * 2, (H + 84) * len(standard_rows)))
    for index, row in enumerate(standard_rows):
        sheet.paste(row, (0, (H + 84) * index))
    sheet.save(OUT / ("native-" + mode + "-review.png"))
    for row in moved_rows:
        row.save(OUT / ("native-" + mode + "-moved-review.png"))

# The middle instrument retains the exact v12 model matrix and mesh bytes. A
# native pixel comparison additionally confirms that this geometry path matches.
direction = lambda vector: np.asarray(vector) / np.linalg.norm(vector)
eye, target = np.array([95, -140, 80]), np.array([0, 0, 27])
forward = direction(target - eye)
right = direction(np.cross(forward, [0, 0, 1]))
up = direction(np.cross(right, forward))
main_basis = {"eye": eye / 170, "forward": forward, "right": right, "up": up}
middle = []
for version in ["before", "after"]:
    begin()
    camera(main_basis, 170)
    for mesh in scene["meshes"]["phased"]["before" if version == "before" else "main"]:
        draw(mesh, scene["mainModels"][version])
    middle.append(pixels())
assert np.array_equal(middle[0], middle[1]), "Middle instrument pixels changed"
report["middleUnchanged"] = {"meshBytes": True, "scale": True, "modelMatrix": True, "nativePixels": True}
Image.fromarray(middle[1]).save(OUT / "native-middle-unchanged.png")
report["verified"] = True
(OUT / "native-verification.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
