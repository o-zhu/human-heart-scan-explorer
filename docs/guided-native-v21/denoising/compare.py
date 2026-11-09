#!/usr/bin/env python3
"""Bounded scientific comparison; reads cached source blocks, writes no surface assets.

Run from the repo root. Raw inputs are deliberately not vendored in this report.
The selected 108-cubed ROI uses an actual 40-sample neighbor halo. All regional
single-block measurements use only the central 48 cubed, also leaving halo 40.
"""
from __future__ import annotations

import os
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
import argparse
import gc
import hashlib
import json
from pathlib import Path
import struct
import time

import blosc2
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from scipy import ndimage as ndi
import scipy
import skimage
from skimage.measure import marching_cubes, mesh_surface_area
from skimage.restoration import denoise_tv_chambolle

THRESHOLD = float(np.float32(17133.4))
SPACING_UM = 19.85
METHODS = ('raw', 'gaussian_1p5', 'tv800_16', 'tv800_40')
TITLES = ('Raw intensity', 'Gaussian σ = 1.5 voxels', 'TV 800 · 16 iterations', 'TV 800 · 40 iterations')
COLORS = ('#e77825', '#0072b2', '#009e73', '#b456a0')
REPRESENTATIVES = ((27,38,25), (34,30,39), (33,30,24))
REGION_TITLES = ('Broad tissue / low-density boundary', 'Branching narrow low-density clefts', 'Fine strands in a noisy low-density region')


def read_block(xyz, roots, provenance):
    name = '_'.join(map(str, xyz)) + '.n5'
    path = next((root/name for root in roots if (root/name).exists()), None)
    if path is None:
        raise FileNotFoundError(name)
    blob = path.read_bytes()
    mode, ndim, x, y, z = struct.unpack('>HHIII', blob[:16])
    if mode != 0 or ndim != 3 or not all(1 <= n <= 128 for n in (x,y,z)):
        raise ValueError(f'Unexpected N5 header: {path}')
    decoded = blosc2.decompress(blob[16:])
    if len(decoded) != x*y*z*2:
        raise ValueError(f'Unexpected decoded length: {path}')
    provenance[name] = dict(bytes=len(blob), sha256=hashlib.sha256(blob).hexdigest())
    return np.frombuffer(decoded, dtype='>u2').reshape(z,y,x).astype(np.float32)


def read_region(origin_xyz, shape_xyz, roots, provenance):
    origin = np.array(origin_xyz, dtype=int)
    end = origin + shape_xyz
    result = np.empty(tuple(shape_xyz[::-1]), np.float32)
    for z in range(origin[2]//128, (end[2]-1)//128+1):
        for y in range(origin[1]//128, (end[1]-1)//128+1):
            for x in range(origin[0]//128, (end[0]-1)//128+1):
                xyz = np.array((x,y,z))
                block = read_block(xyz, roots, provenance)
                start = xyz*128
                low, high = np.maximum(origin, start), np.minimum(end, start+block.shape[::-1])
                dst = tuple(slice(int(a),int(b)) for a,b in zip((low-origin)[::-1],(high-origin)[::-1]))
                src = tuple(slice(int(a),int(b)) for a,b in zip((low-start)[::-1],(high-start)[::-1]))
                result[dst] = block[src]
    return result


def filtered(raw, method):
    if method == 'raw':
        return raw
    if method == 'gaussian_1p5':
        return ndi.gaussian_filter(raw, 1.5, radius=6, mode='nearest')
    iterations = 16 if method == 'tv800_16' else 40
    return denoise_tv_chambolle(raw, weight=800, max_num_iter=iterations, eps=0, channel_axis=None)


def metrics(field, rawmask):
    mask = field >= THRESHOLD
    labels, count = ndi.label(mask, structure=np.ones((3,3,3), bool))
    sizes = np.bincount(labels.ravel())[1:]
    if field.min() < THRESHOLD < field.max():
        vertices, faces, _, _ = marching_cubes(field, THRESHOLD, allow_degenerate=False)
        triangles = len(faces)
        area = float(mesh_surface_area(vertices, faces))
    else:
        triangles, area = 0, 0.
    return dict(triangles=triangles, areaVoxelSquared=area,
        tissueFraction=float(mask.mean()), components26=int(count),
        componentsBelow27Voxels=int(np.count_nonzero(sizes < 27)),
        voxelsInComponentsBelow27=int(sizes[sizes < 27].sum()),
        largestComponentVoxels=int(sizes.max(initial=0)),
        classificationDisagreementWithRaw=float(np.mean(mask != rawmask)))


def compare(raw, crop, save_fields=False):
    rows, fields = {}, {}
    rawmask = raw[crop] >= THRESHOLD
    for method in METHODS:
        started = time.perf_counter()
        full = filtered(raw, method)
        seconds = time.perf_counter()-started
        core = np.ascontiguousarray(full[crop])
        rows[method] = metrics(core, rawmask)
        rows[method]['filterSeconds'] = seconds
        fields[method] = core
        if method != 'raw':
            del full
        gc.collect()
    a, b = fields['tv800_16'], fields['tv800_40']
    difference = dict(classificationDisagreement=float(np.mean((a>=THRESHOLD)!=(b>=THRESHOLD))),
        intensityRmsDifference=float(np.sqrt(np.mean((a-b)**2))),
        intensityMaxDifference=float(np.max(np.abs(a-b))))
    return rows, fields if save_fields else None, difference


def style_axis(ax, image, color, spacing=SPACING_UM, ticklabels=True):
    n, m = image.shape
    extent = (-spacing/2000, (m-.5)*spacing/1000, -spacing/2000, (n-.5)*spacing/1000)
    ax.imshow(image, cmap='gray', vmin=14640, vmax=23545, origin='lower',
        interpolation='nearest', extent=extent)
    if image.min() < THRESHOLD < image.max():
        ax.contour(np.arange(m)*spacing/1000,np.arange(n)*spacing/1000,
            image,levels=[THRESHOLD],colors=[color],linewidths=.6)
    ax.tick_params(labelsize=8, length=2)
    if not ticklabels:
        ax.set_xticklabels([]); ax.set_yticklabels([])
    ax.set_aspect('equal')


def selected_figure(fields, out):
    fig, axes = plt.subplots(3,4,figsize=(13.0,10.4), constrained_layout=True)
    orientations = (('XY · local z = 54', lambda a:a[54]),
                    ('XZ · local y = 54', lambda a:a[:,54,:]),
                    ('YZ · local x = 54', lambda a:a[:,:,54]))
    for row,(label,section) in enumerate(orientations):
        for col,method in enumerate(METHODS):
            ax=axes[row,col]
            style_axis(ax,section(fields[method]),COLORS[col])
            if row == 0: ax.set_title(TITLES[col],fontsize=11)
            if col == 0: ax.set_ylabel(label+'\nmm',fontsize=10)
            if row == 2: ax.set_xlabel('mm',fontsize=9)
    fig.suptitle('Native fold-rich patch · identical intensity window and threshold\n'
                 '108³ samples; true 40-sample neighbor halo; 19.85 µm spacing',fontsize=13)
    fig.savefig(out/'selected-region.png', dpi=150, metadata={'Software':'Heart Explorer denoising comparison'})
    plt.close(fig)


def regional_figure(region_fields, out):
    fig, axes = plt.subplots(3,4,figsize=(13.0,10.2), constrained_layout=True)
    for row,xyz in enumerate(REPRESENTATIVES):
        fields=region_fields[xyz]
        for col,method in enumerate(METHODS):
            ax=axes[row,col]
            style_axis(ax,fields[method][24],COLORS[col])
            if row == 0: ax.set_title(TITLES[col],fontsize=11)
            if col == 0:
                ax.set_ylabel(REGION_TITLES[row]+'\nblock '+str(xyz)+' · mm',fontsize=9)
            if row == 2: ax.set_xlabel('mm',fontsize=9)
    fig.suptitle('Denoising changes both noise contours and narrow structures\n'
        'XY center slices; 48³ measured cores with 40-sample halos; threshold 17,133.4',fontsize=13)
    fig.savefig(out/'regional-comparison.png',dpi=150,metadata={'Software':'Heart Explorer denoising comparison'})
    plt.close(fig)


def edge_profile(region_fields, out):
    fields=region_fields[REPRESENTATIVES[0]]
    fig, axes=plt.subplots(1,2,figsize=(10.8,4.1),constrained_layout=True)
    raw=fields['raw'][24]
    style_axis(axes[0],raw,COLORS[0])
    y=24*SPACING_UM/1000
    axes[0].axhline(y,color='#67d8ff',linewidth=1.2)
    axes[0].set_title('Broad boundary · raw slice and profile line',fontsize=10)
    axes[0].set_xlabel('x (mm)');axes[0].set_ylabel('y (mm)')
    xx=np.arange(48)*SPACING_UM/1000
    profiles={}
    for method,title,color in zip(METHODS,TITLES,COLORS):
        values=fields[method][24,24,:]
        profiles[method]=[float(x) for x in values]
        axes[1].plot(xx,values,label=title,color=color,linewidth=1.5)
    axes[1].axhline(THRESHOLD,color='#333333',ls=':',lw=1,label='Extraction threshold')
    axes[1].set_xlabel('x (mm)');axes[1].set_ylabel('Original intensity units')
    axes[1].set_title('Same physical line through all 3D-filtered fields',fontsize=10)
    axes[1].legend(fontsize=8,loc='upper left');axes[1].grid(alpha=.15)
    fig.savefig(out/'boundary-profile.png',dpi=150)
    plt.close(fig)
    return dict(blockXYZ=list(REPRESENTATIVES[0]),
        nativeOriginXYZ=(np.array(REPRESENTATIVES[0])*128+40).tolist(),
        profileLocalZY=[24,24], spacingUm=SPACING_UM, intensity=profiles)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root',type=Path,default=Path('{source-cache}/guided-native-v21'))
    parser.add_argument('--legacy-cache',type=Path,default=Path('{source-cache}/native-surface-v20/chunks-s0'))
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parent)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    roots=(args.data_root/'network-pilot',args.legacy_cache)
    blosc2.set_nthreads(1)
    provenance={}
    selected_origin=np.array([4490,3978,4618])
    selected_input=read_region(selected_origin-40,np.array([188]*3),roots,provenance)
    selected,fields,difference=compare(selected_input,(slice(40,-40),)*3,save_fields=True)
    selected_figure(fields,args.output)
    del selected_input,fields
    gc.collect()
    summary=dict(schema='native-denoising-comparison-v21.1',
        thresholdRaw=THRESHOLD,thresholdRequested=17133.4,nativeSpacingUm=SPACING_UM,
        versions=dict(numpy=np.__version__,scipy=scipy.__version__,skimage=skimage.__version__),
        methodDefinitions=dict(raw='Original uint16 intensities cast to float32 without rescaling',
            gaussian_1p5='3D separable Gaussian sigma 1.5, finite radius 6, nearest boundary',
            tv800_16='Chambolle TV weight 800 original intensity units; exactly 16 iterations; eps=0',
            tv800_40='Chambolle TV weight 800 original intensity units; exactly 40 iterations; eps=0'),
        metricNotes=dict(triangles='skimage marching_cubes, Lewiner, allow_degenerate=False; counts may differ from NBE1 classic cases',
            components='26-connected above-threshold voxel components inside the measured crop; includes crop-cut components',
            area='Extracted triangle area in native-voxel squared; an outcome measure, not an accuracy measure',
            sampling='32 pre-existing stratified source blocks; not a random sample or organ-wide accuracy validation',
            timing='Single serial comparison during other work; filter times are descriptive, not controlled throughput benchmarks'),
        selectedRegion=dict(coreOriginXYZ=selected_origin.tolist(),coreShapeZYX=[108]*3,
            realSourceHalo=40,methods=selected,tv16Versus40=difference),regional=[])
    print(json.dumps({'selectedRegion':summary['selectedRegion']}),flush=True)
    pilot=json.loads((args.data_root/'whole-stratified-pilot.json').read_text())['rows']
    region_fields={}
    for index,row in enumerate(pilot):
        xyz=tuple(row['xyz']);raw=read_block(xyz,roots,provenance)
        methods,fields,difference=compare(raw,(slice(40,-40),)*3,save_fields=xyz in REPRESENTATIVES)
        summary['regional'].append(dict(blockXYZ=list(xyz),coreOriginXYZ=(np.array(xyz)*128+40).tolist(),
            coreShapeZYX=[48]*3,realSourceHalo=40,methods=methods,tv16Versus40=difference))
        if fields is not None: region_fields[xyz]=fields
        print(json.dumps({'region':index+1,'blockXYZ':xyz,'triangles':{k:v['triangles'] for k,v in methods.items()}}),flush=True)
        del raw
    regional_figure(region_fields,args.output)
    summary['boundaryProfile']=edge_profile(region_fields,args.output)
    aggregate={}
    for method in METHODS:
        rows=[r['methods'][method] for r in summary['regional']]
        aggregate[method]=dict(triangles=sum(r['triangles'] for r in rows),
            components26=sum(r['components26'] for r in rows),
            meanTissueFraction=float(np.mean([r['tissueFraction'] for r in rows])),
            meanRawDisagreement=float(np.mean([r['classificationDisagreementWithRaw'] for r in rows])),
            totalFilterSeconds=sum(r['filterSeconds'] for r in rows),
            emptyCores=sum(r['triangles']==0 for r in rows))
    summary['regionalAggregate']=aggregate
    summary['sourceBlocks']=provenance
    (args.output/'measurements.json').write_text(json.dumps(summary,indent=2)+'\n')
    seam=args.data_root/'alignment'/'tv-finite-halo.json'
    (args.output/'seam-validation.json').write_bytes(seam.read_bytes())
    initial=args.data_root/'denoise'/'pilot-metrics.json'
    (args.output/'exploratory-pilot.json').write_bytes(initial.read_bytes())
    print(json.dumps({'aggregate':aggregate,'output':str(args.output)}),flush=True)


if __name__ == '__main__':
    main()
