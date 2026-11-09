"""Measured CT plane and actual probe-mesh projection before/after entry repair.

This is a scientific geometry diagram, not a browser screenshot. The displayed
probe comes from the production mesh and the plane is a prepared Ultra image.
"""
from pathlib import Path
import json
import subprocess

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/probe-entry-v14"
OUT.mkdir(exist_ok=True)
JS = r"""
import {readFileSync} from 'node:fs';
import {PROBE_PRESETS,probePhysicalScale,volumeGeometry,initializeProbeEntry,sanitizeProbeState,probePose} from './public/probe-geometry.js';
import {createProbeMeshes,probeDisplayScale} from './public/probe-scene.js';
const cases=[];
for(const donor of ['s-20-29','s-20-28']){
 const root='public/assets/donors/'+donor,manifest=JSON.parse(readFileSync(root+'/manifest.json')),planes=JSON.parse(readFileSync(root+'/echo-planes.json')),prepared=JSON.parse(readFileSync(root+'/probe-textures.json')),geometry=volumeGeometry(manifest.levels.high);
 for(const id of ['apical','atrial']){
  const preset=PROBE_PRESETS.find(p=>p.id===id),frame={...planes.frames[preset.frame].world,referenceMm:geometry.longestMm},oldFrame={...frame};delete oldFrame.probeEntry;
  const oldState=sanitizeProbeState({preset:id,referenceMm:geometry.longestMm,depthMm:preset.depthMm*probePhysicalScale(geometry.longestMm),angleDeg:preset.angleDeg,contactLocked:true,contactPositionMm:[0,0]}),state=initializeProbeEntry(oldState,frame);
  cases.push({donor,id,referenceMm:geometry.longestMm,scale:probeDisplayScale(geometry.longestMm),prepared:prepared.preparedPlanes.find(p=>p.id===id),before:{state:oldState,pose:probePose(oldState,oldFrame)},after:{state,pose:probePose(state,frame)}});
 }
}
console.log(JSON.stringify({cases,meshes:Object.fromEntries(['phased','tee'].map(kind=>[kind,createProbeMeshes(kind).map(m=>({...m,vertices:Array.from(m.vertices)}))]))}));
"""
scene = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", JS], cwd=ROOT))
report = json.loads((OUT / "verification.json").read_text())
plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": "#e6edeb", "axes.labelcolor": "#9fb3b2"})
fig, axes = plt.subplots(4, 2, figsize=(7.9, 16.8), dpi=180, facecolor="#0c1417")


def draw_mesh(ax, case, pose, plane):
    basis = np.column_stack([pose["right"], pose["normal"], -np.array(pose["beam"])])
    center = np.array(plane["center"]) * case["referenceMm"]
    right, up, normal = [np.array(plane[k]) for k in ["right", "up", "normal"]]
    triangles, colors, depths = [], [], []
    for mesh in scene["meshes"]["tee" if case["id"] == "atrial" else "phased"]:
        source = np.array(mesh["vertices"]).reshape(-1, 6)
        world = source[:, :3] @ basis.T * case["scale"] + np.array(pose["originMm"])
        q = world - center
        uv = np.column_stack([q @ right, q @ up]).reshape(-1, 3, 2)
        depth = (q @ normal).reshape(-1, 3).mean(axis=1)
        normals = (source[:, 3:] @ basis.T).reshape(-1, 3, 3).mean(axis=1)
        light = .65 + .3 * np.abs(normals @ normal)
        colors.extend(np.clip(np.array(mesh["color"])[None, :] * light[:, None], 0, 1))
        triangles.extend(uv)
        depths.extend(depth)
    order = np.argsort(depths)
    ax.add_collection(PolyCollection(np.array(triangles)[order], facecolors=np.array(colors)[order], edgecolors="none", zorder=4))


for row, case in enumerate(scene["cases"]):
    entry = next(p for s in report["sources"] if s["donor"] == case["donor"] for p in s["presets"] if p["id"] == case["id"])
    prepared = case["prepared"]
    plane = prepared["plane"]
    image = np.array(Image.open(ROOT / "public" / prepared["url"].removeprefix("./")).convert("L")) / 255
    # A common, stated transfer for the diagram; it does not alter the source.
    image = np.clip(image, 0, 1) ** .6
    width, height = np.array([plane["width"], plane["height"]]) * case["referenceMm"]
    center = np.array(plane["center"]) * case["referenceMm"]
    right, up = np.array(plane["right"]), np.array(plane["up"])
    for column, side in enumerate(["before", "after"]):
        ax = axes[row, column]
        ax.set_facecolor("#050b0d")
        ax.imshow(image, cmap="gray", vmin=0, vmax=1, extent=(-width/2, width/2, -height/2, height/2), origin="upper", zorder=1, interpolation="bilinear")
        pose, state = case[side]["pose"], case[side]["state"]
        origin = np.array(pose["originMm"])
        uv = np.array([np.dot(origin-center, right), np.dot(origin-center, up)])
        half = np.deg2rad(state["angleDeg"] / 2)
        for sign in [-1, 1]:
            far = origin + state["depthMm"] * (np.array(pose["beam"])*np.cos(half) + np.array(pose["right"])*np.sin(half)*sign)
            ax.plot([uv[0],np.dot(far-center,right)],[uv[1],np.dot(far-center,up)], color="#78af9c", linewidth=.75, alpha=.7, zorder=2)
        draw_mesh(ax, case, pose, plane)
        ax.scatter(*uv, s=22, color="#f4b18d" if side=="before" else "#bdd9b1", edgecolor="#142325", linewidth=.6, zorder=5)
        title = f"{case['donor'].upper()} · {'Long-axis entry' if case['id']=='apical' else 'Opposite entry'}"
        ax.set_title(title, loc="left", fontsize=10.5, pad=8)
        detail = ("Before · tip inside retained tissue" if side=="before" else f"After · {entry['tipCellClearanceMm']:.1f} mm clearance")
        ax.text(.035,.95,detail,transform=ax.transAxes,fontsize=8.5,va="top",color="#f4b18d" if side=="before" else "#bdd9b1",bbox={"facecolor":"#050b0d","edgecolor":"none","pad":2,"alpha":.86})
        ax.text(.035,.04,f"Depth {state['depthMm']:.1f} mm",transform=ax.transAxes,fontsize=8,color="#9cb0ae")
        ax.plot([65,85],[-88,-88],color="#dce7e4",linewidth=2)
        ax.text(75,-84,"20 mm",ha="center",fontsize=7.5,color="#9cb0ae")
        ax.set(xlim=(-100,100),ylim=(-97,151),aspect="equal",xticks=[],yticks=[])
        for spine in ax.spines.values():spine.set_color("#263d40")
fig.text(.06,.985,"Probe entry outside the measured heart", fontsize=17, ha="left", va="top")
fig.text(.06,.961,"Same Ultra CT plane and compact probe mesh.\nOnly the beam entry and usable depth change.",fontsize=9.5,va="top",color="#a5b8b5")
fig.text(.06,.009,"Measured plane diagram · 79.4–79.56 µm · display gamma 0.6\nSynthetic contact, not registered skin · not a browser screenshot",fontsize=8.2,color="#92a8a5")
fig.subplots_adjust(left=.06,right=.97,top=.916,bottom=.04,wspace=.13,hspace=.17)
path=OUT/"entry-before-after.png"
fig.savefig(path,facecolor=fig.get_facecolor())
plt.close(fig)
print(path)
