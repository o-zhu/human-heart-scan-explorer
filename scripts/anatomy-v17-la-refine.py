"""Conservative LA exterior completion from the original LADAF-2021-17 source.

Only previously unclassified label cells may change, and only to LA. Original
intensities, cleanup, surface geometry, and every existing regional identity are
held fixed. These are approximate educational region colors, not ground truth.
"""
from pathlib import Path
import argparse
import ctypes
import gzip
import hashlib
import importlib.util
import json
import subprocess

import numpy as np
from scipy import ndimage as ndi
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs/anatomy-v17-la'
SOURCE_DIMS = np.array([475, 475, 530])
DIMS = np.array([317, 317, 354])
SCALE = (DIMS - 1) / (SOURCE_DIMS - 1)
SPACING = 0.3176 / SCALE
BASELINE_SHA = 'da41d280d86b5b458494e45f76435f457c771cfe4d7380d412f4109cf4940e44'
BASELINE_ASSET = ROOT / 'public/assets/anatomy/labels-v12-da41d280d86b.raw.gz'
PALETTE = np.array([[155,169,176],[227,109,115],[84,166,230],[242,179,107],
                    [99,199,186],[196,153,232],[97,204,224]], np.float32)
PARAMETERS = {
    'baselineRevision': 'surface-ownership-v12',
    'baselineSha256': BASELINE_SHA,
    'sourceTissueThresholdRaw': 17100,
    'maximumDistanceFromExistingLAMm': 2.4,
    'otherRegionProtectionMarginMm': 0.95,
    'sourceOccupancyRule': 'Maximum original uint16 intensity among source voxel centers assigned to each endpoint-registered annotation cell; no source smoothing or intensity change.',
    'geodesicConnectivity': 6,
    'edgeDifferenceScale': 1200,
    'lowDensityGapPenalty': 3,
    'maximumGeodesicCost': 14,
    'existingNonzeroIdentitiesFrozen': True,
}


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def save_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, allow_nan=False) + '\n')


def load_baseline():
    raw = gzip.decompress(BASELINE_ASSET.read_bytes())
    if hashlib.sha256(raw).hexdigest() != BASELINE_SHA:
        raise ValueError('The reviewed v12 baseline changed')
    return np.frombuffer(raw, np.uint8).reshape(tuple(DIMS[::-1])).copy()


def prepare(work, source, previous_work):
    work.mkdir(parents=True, exist_ok=True)
    src = np.load(source, mmap_mode='r')
    if src.dtype != np.uint16 or src.shape != tuple(SOURCE_DIMS[::-1]):
        raise ValueError('Expected the original registered uint16 s4 source')
    old = load_baseline()
    peak = np.zeros_like(old, dtype=np.uint16)
    ys = np.rint(np.arange(src.shape[1]) * SCALE[1]).astype(int)[:, None]
    xs = np.rint(np.arange(src.shape[2]) * SCALE[0]).astype(int)[None, :]
    # Unlike a blurred point sample, this records whether each annotation cell
    # contains any measured source tissue, preserving very thin folded walls.
    for z in range(src.shape[0]):
        np.maximum.at(peak[round(z * SCALE[2])], (ys, xs), src[z])
    np.save(work / 'source-peak.npy', peak)
    np.save(work / 'distance-la.npy', ndi.distance_transform_edt(
        old != 3, sampling=SPACING[::-1]).astype(np.float32))
    np.save(work / 'distance-other.npy', ndi.distance_transform_edt(
        ~((old > 0) & (old != 3)), sampling=SPACING[::-1]).astype(np.float32))
    working = np.load(previous_work / 'working-volume.npy')
    if working.shape != old.shape:
        raise ValueError('Working source registration differs from v12')
    np.save(work / 'working-volume.npy', working)


def compare(work):
    old = load_baseline()
    peak = np.load(work / 'source-peak.npy')
    dl = np.load(work / 'distance-la.npy')
    other = np.load(work / 'distance-other.npy')
    v = np.load(work / 'working-volume.npy')
    measured = peak >= PARAMETERS['sourceTissueThresholdRaw']
    candidate = old.copy()
    candidate[(old == 0) & measured & (dl <= 3.5)] = 3
    candidates = {'nearest-unprotected': candidate}
    closed = ndi.binary_closing(old == 3, structure=ndi.generate_binary_structure(3, 2), iterations=4)
    candidate = old.copy()
    candidate[(old == 0) & measured & closed] = 3
    candidates['morphological-closing'] = candidate
    eligible = ((old == 0) & measured & (dl <= PARAMETERS['maximumDistanceFromExistingLAMm'])
                & (other >= dl + PARAMETERS['otherRegionProtectionMarginMm']))
    mask = eligible | ((old == 3) & measured)
    markers = np.where((old == 3) & measured, 3, 0).astype(np.uint8)
    methods = module('v17_geodesic', 'anatomy-v5-methods.py')
    grown, _ = methods.geodesic(v, mask, markers, work,
        edge_scale=PARAMETERS['edgeDifferenceScale'],
        gap_penalty=PARAMETERS['lowDensityGapPenalty'],
        max_cost=PARAMETERS['maximumGeodesicCost'])
    candidate = old.copy()
    candidate[eligible & (grown == 3)] = 3
    candidates['source-connected'] = candidate
    statistics = {}
    for name, labels in candidates.items():
        changed = labels != old
        np.save(work / (name + '.npy'), labels)
        statistics[name] = {
            'addedLACells': int(changed.sum()),
            'existingNonzeroCellsChanged': int(np.count_nonzero(changed & (old > 0))),
            'cellsWithoutMeasuredSourceTissue': int(np.count_nonzero(changed & ~measured)),
            'cellsNearCompetingRegion': int(np.count_nonzero(changed & (other < dl + 0.95))),
            'maximumAddedDistanceMm': float(dl[changed].max()) if changed.any() else 0,
            'addedCellsMissedBySmoothedSourceThreshold': int(np.count_nonzero(changed & (v < 17100))),
        }
    save_json(DOCS / 'method-comparison.json', {
        'parameters': PARAMETERS, 'selected': 'source-connected',
        'selectionReason': 'Source occupancy recovers thin measured walls. A physical collar, source-connected geodesic and competing-region guard constrain spread. Nearest completion reaches adjacent disputed boundaries; closing can bridge folds and also enters the guard region.',
        'candidates': statistics,
    })
    print(json.dumps(statistics, indent=2), flush=True)


def source_plane(source, axis, n):
    return source[n] if axis == 'z' else source[:, n, :] if axis == 'y' else source[:, :, n]


def sample_labels(labels, axis, n):
    axes = [0, 1, 2]
    ai = {'x': 2, 'y': 1, 'z': 0}[axis]
    axes.remove(ai)
    aa, bb = np.indices(tuple(SOURCE_DIMS[::-1][axes]))
    coords = [None] * 3
    coords[axes[0]] = aa * SCALE[::-1][axes[0]]
    coords[axes[1]] = bb * SCALE[::-1][axes[1]]
    coords[ai] = np.full(aa.shape, n * SCALE[::-1][ai])
    return ndi.map_coordinates(labels, coords, order=0, prefilter=False)


def review(work, source):
    DOCS.mkdir(parents=True, exist_ok=True)
    old = load_baseline()
    new = np.load(work / 'source-connected.npy')
    src = np.load(source, mmap_mode='r')
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 17)
    planes = [('z',130), ('z',170), ('z',210), ('z',250), ('z',280), ('y',352)]
    for axis, number in planes:
        raw = source_plane(src, axis, number)
        before = sample_labels(old, axis, number)
        after = sample_labels(new, axis, number)
        # Same intensity window and same source pixels in all panels.
        gray = np.clip((raw.astype(np.float32) - 15000) / 8500, 0, 1)
        rgb = np.repeat(gray[..., None] * 255, 3, axis=2)
        panels = []
        for labels in [None, before, after]:
            out = rgb.copy()
            if labels is not None:
                mask = (labels > 0) & (raw >= 17100)
                out[mask] = out[mask] * .35 + PALETTE[labels[mask]] * (.4 + .6 * gray[mask,None]) * .65
            box = (190, 120, 410, 390) if axis == 'z' else (160, 70, 410, 325)
            im = Image.fromarray(np.uint8(np.clip(out, 0, 255))).crop(box)
            panels.append(im.resize((440, 540), Image.Resampling.NEAREST))
        fig = Image.new('RGB', (1320, 585), (11,17,20))
        draw = ImageDraw.Draw(fig)
        for i, (name, im) in enumerate(zip(['Original uint16', 'v12 regions', 'v17 LA completion'], panels)):
            fig.paste(im, (i*440, 45))
            draw.text((i*440+12, 12), f'{axis.upper()}={number} | {name}', fill='white', font=font)
        fig.save(DOCS / f'source-{axis}-{number}.jpg', quality=94)

    # Render original s4 tissue with the published cleanup mask. Surface hits
    # are computed once per camera and recolored without moving any geometry.
    cleanup_meta = json.loads((ROOT/'public/assets/cleanup/manifest.json').read_text())
    cleanup_raw = gzip.decompress((ROOT/'public'/cleanup_meta['volumeUrl']).read_bytes())
    cleanup = np.frombuffer(cleanup_raw, np.uint8).reshape(tuple(cleanup_meta['dimensions'][::-1]))
    ix = np.rint(np.arange(src.shape[2]) * (cleanup.shape[2]-1)/(src.shape[2]-1)).astype(int)
    iy = np.rint(np.arange(src.shape[1]) * (cleanup.shape[1]-1)/(src.shape[1]-1)).astype(int)
    iz = np.rint(np.arange(src.shape[0]) * (cleanup.shape[0]-1)/(src.shape[0]-1)).astype(int)
    volume = np.ascontiguousarray(np.where(cleanup[iz[:,None,None],iy[None,:,None],ix[None,None,:]] > 0, src, 0), np.uint16)
    libpath = work/'source-render.so'
    subprocess.run(['g++','-O3','-std=c++17','-shared','-fPIC','-fopenmp',
                    str(ROOT/'scripts/anatomy-v12-render.cpp'),'-o',str(libpath)], check=True)
    fn = ctypes.CDLL(str(libpath)).render
    u16 = np.ctypeslib.ndpointer(np.uint16, ndim=3, flags='C_CONTIGUOUS')
    f64 = np.ctypeslib.ndpointer(np.float64, ndim=1, flags='C_CONTIGUOUS')
    f32 = np.ctypeslib.ndpointer(np.float32, flags='C_CONTIGUOUS')
    fn.argtypes = [u16,ctypes.c_int,ctypes.c_int,ctypes.c_int,f64,f64,f64,f64,ctypes.c_double,
                   ctypes.c_int,ctypes.c_int,ctypes.c_double,f64,ctypes.c_double,ctypes.c_double,f32,f32]
    fn.restype = None
    views = [('posterior',[.6,1.,-.04],None), ('lateral',[1.,.25,-.05],None),
             ('superior',[1.,.6,-.6],None), ('y352-cut',[.55,-1.,-.1],352.)]
    surface_report = {}
    for name, offset, cut in views:
        offset = np.array(offset, float); offset /= np.linalg.norm(offset)
        direction = -offset
        up = np.array([0.,0.,-1.]); right = np.cross(direction, up); right /= np.linalg.norm(right)
        up = np.cross(right,direction)
        origin = np.array([247.,251.,265.]) + offset*850
        width,height = 640,820
        hits = np.full((height,width,3),-1,np.float32); shade = np.zeros((height,width),np.float32)
        normal = np.array([0.,-1.,0.]) if cut is not None else np.zeros(3,float)
        fn(volume,*volume.shape[::-1],origin,right,up,direction,.65,width,height,17100.,
           normal,-cut if cut is not None else 0.,0.,hits,shade)
        valid = hits[:,:,0]>=0
        xyz = np.clip(np.rint(np.maximum(hits,0)*SCALE).astype(int),0,DIMS-1)
        fig = Image.new('RGB',(width*2,height+45),(11,17,20)); draw = ImageDraw.Draw(fig)
        surface_report[name] = {}
        for col,(key,labels) in enumerate([('v12',old),('v17',new)]):
            lab = labels[xyz[:,:,2],xyz[:,:,1],xyz[:,:,0]]
            rgb = PALETTE[lab]*(shade[:,:,None]*.86+.14); rgb[~valid]=[11,17,20]
            fig.paste(Image.fromarray(np.uint8(np.clip(rgb,0,255))),(col*width,45))
            draw.text((col*width+12,12),f'{name} | {key}',fill='white',font=font)
            surface_report[name][key] = {'visiblePixels':int(valid.sum()),
                'laPixels':int((valid&(lab==3)).sum()), 'neutralPixels':int((valid&(lab==0)).sum())}
        fig.save(DOCS/f'surface-{name}.jpg',quality=94)
        np.save(work/f'hits-{name}.npy',hits)
        np.save(work/f'shade-{name}.npy',shade)
        print('Reviewed native source view',name,flush=True)
    save_json(DOCS/'surface-review.json',{'source':'Original uint16 s4; published cleanup; raw isovalue 17100.',
        'geometryHeldIdentical':True,'meaning':'Coverage of fixed native surface projections, not segmentation accuracy.',
        'views':surface_report})


def package(work, source):
    old = load_baseline(); new = np.load(work/'source-connected.npy')
    peak = np.load(work/'source-peak.npy'); dl = np.load(work/'distance-la.npy'); other = np.load(work/'distance-other.npy')
    changed = new != old
    assert np.all(old[changed] == 0) and np.all(new[changed] == 3)
    assert np.all(peak[changed]>=17100) and np.all(dl[changed]<=2.4)
    assert np.all(other[changed]>=dl[changed]+.95)
    prior = module('v17_regression', 'anatomy-v12-refine.py')
    checks = prior.landmark_checks(new)
    assert all(v['matched']==v['total'] for v in checks.values())
    output = ROOT/'public/assets/anatomy'; manifest_path = output/'manifest.json'
    baseline_path = DOCS/'baseline-manifest-v12.json'
    if not baseline_path.exists():
        meta = json.loads(manifest_path.read_text())
        assert meta['sha256'] == BASELINE_SHA
        save_json(baseline_path, meta)
    meta = json.loads(baseline_path.read_text())
    raw = new.tobytes(); packed = gzip.compress(raw, compresslevel=9,mtime=0)
    digest = hashlib.sha256(raw).hexdigest(); filename=f'labels-v17-la-{digest[:12]}.raw.gz'
    (output/filename).write_bytes(packed)
    meta.update({'revision':'la-exterior-v17','volumeUrl':'./assets/anatomy/'+filename,
        'sha256':digest,'compressedSha256':hashlib.sha256(packed).hexdigest(),
        'decodedBytes':len(raw),'compressedBytes':len(packed),'generatedDate':'2026-11-05',
        'generator':'scripts/anatomy-v17-la-refine.py',
        'method':meta['method']+' v17 adds only source-connected, previously neutral LA exterior cells containing measured original source tissue within 2.4 mm of existing LA and at least 0.95 mm farther from every competing region. All previous nonzero identities, including ventricular surface corrections, are bit-identical.',
        'methodParameters':PARAMETERS,
        'previousMethodParameters':meta['methodParameters'],
        'validation':'All 43 pre-existing source-review controls are retained and every nonzero v12 label is unchanged. Six original uint16 sections and four fixed native s4 surface projections compare before/after. Three completion methods were compared. These establish preservation and constrained coverage, not expert ground truth or a clinical accuracy score.',
    })
    meta['limitations'].insert(1,'LA completion is restricted to short source-connected extensions of existing approximate LA territory. Pulmonary-vein ostia, atrioventricular transition and arterial boundaries are not independently relabeled; uncertain neutral boundaries remain.')
    for label in meta['labels']:
        if label['id']!=3: continue
        points=np.argwhere(new==3)[:,::-1]
        label['voxelCount']=int(len(points))
        label['boundsNormalizedXYZ']=[(points.min(axis=0)/(DIMS-1)).tolist(),(points.max(axis=0)/(DIMS-1)).tolist()]
        label['description']='Collapsed LA territory with conservative source-connected completion of thin exterior covering. Neighboring nonzero regions are protected; ostial and basal transition boundaries remain provisional.'
        label['method']='v12 source-guided LA plus v17 original-source occupancy, bounded geodesic continuity and competing-region protection.'
    save_json(manifest_path, meta)
    source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
    save_json(DOCS/'verification.json',{'landmarkGroups':checks,'priorControlsPassed':sum(v['matched'] for v in checks.values()),
        'existingNonzeroLabelsUnchanged':True,'allOtherRegionsBitIdentical':True,
        'addedLACells':int(changed.sum()),'addedCellsWithoutSourceTissue':0,
        'maximumAddedDistanceMm':float(dl[changed].max()),
        'minimumCompetingRegionDistanceAdvantageMm':float((other[changed]-dl[changed]).min()),
        'segmentationAccuracyMeasured':False,'supportsQuantification':False})
    record={'revision':meta['revision'],'asset':filename,'sha256':digest,
        'compressedSha256':meta['compressedSha256'],'decodedBytes':len(raw),'compressedBytes':len(packed),
        'sourceNpySha256':source_hash,'sourceValuesModified':False,'sourceGeometryModified':False,
        'registrationModified':False,'baselineSha256':BASELINE_SHA,
        'sourceShapeZYX':SOURCE_DIMS[::-1].tolist(),'sourceDtype':'uint16'}
    save_json(DOCS/'packaging.json',record)
    print(json.dumps(record,indent=2),flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['prepare','compare','review','package','all'])
    p.add_argument('--work',type=Path,default=Path('/workspace/data/anatomy-v17-la'))
    p.add_argument('--previous-work',type=Path,default=Path('/workspace/data/anatomy-v12'))
    p.add_argument('--source',type=Path,default=Path('/workspace/data/anatomy-v12/source-s4.npy'))
    a=p.parse_args()
    if a.action in ['prepare','all']: prepare(a.work,a.source,a.previous_work)
    if a.action in ['compare','all']: compare(a.work)
    if a.action in ['review','all']: review(a.work,a.source)
    if a.action in ['package','all']: package(a.work,a.source)


if __name__=='__main__': main()
