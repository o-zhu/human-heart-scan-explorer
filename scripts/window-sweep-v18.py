#!/usr/bin/env python3
"""Compare display-only windows on immutable, measured Ultra sections.

No source image, geometry, threshold or runtime setting is modified. Metrics
describe retained display tones and contrast, not anatomical fidelity/accuracy.
"""
from pathlib import Path
import hashlib
import itertools
import json
import math
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import binary_erosion, uniform_filter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/windowing-v18'
OUT.mkdir(parents=True, exist_ok=True)
DONORS = json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    'import {DONORS} from "./public/donors.js";console.log(JSON.stringify(DONORS));'
], cwd=ROOT, text=True))
FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
SMALL = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
BG = '#0b1115'
PERCENTILES = [.005, .01, .025, .05, .1, .5, .9, .95, .975, .99, .995, .999]
SOURCE_PATH = lambda url: ROOT / 'public' / url.removeprefix('./').split('?')[0]

# Raw-domain starting points are rounded to the existing slider increments.
# Profile values are frozen after the source comparisons, not fitted at runtime.
CHOICES = {
    'ladaf-2021-17': {
        'balanced': (17100, 22500, .90, 3.00, 1.00),
        'strong': (17700, 21650, 1.05, 3.00, 1.00),
    },
    's-20-29': {
        'balanced': (19600, 21900, .90, 3.00, 1.00),
        'strong': (19900, 21400, .90, 3.00, 1.00),
    },
    's-20-28': {
        'balanced': (16900, 21950, .90, 3.00, 1.00),
        'strong': (17500, 20850, 1.00, 3.00, 1.00),
    },
}


def settings_for(donor, values):
    low, high, gamma, exposure, contrast = values
    a, b = donor['sourceWindow']
    return dict(windowEnabled=True, windowLow=round((low-a)/(b-a), 3),
                windowHigh=round((high-a)/(b-a), 3), windowGamma=gamma,
                cutFaceExposure=exposure, capContrast=contrast)


def transfer(settings):
    """Exact Tissue/space cap transfer, followed by production gamma .89.

    Head-on 3D cut face and custom-window CT card agree here; oblique 3D faces
    additionally multiply color by .91+.09*abs(dot(normal,view)) before gamma.
    """
    value = np.arange(256, dtype=np.float64)/255
    contrast = settings.get('capContrast', 1)
    if settings.get('windowEnabled'):
        q = np.clip((value-settings['windowLow']) /
                    (settings['windowHigh']-settings['windowLow']), 0, 1)**settings['windowGamma']
        q = np.clip((q-.5)*contrast+.5, 0, 1)
    else:
        q = np.clip((value-.48)*contrast*1.12+.58, .015, .98)
    hard = q.copy()
    exposure = settings.get('cutFaceExposure', 1)
    q = exposure*q/(1+(exposure-1)*q)
    color = np.array([.015, .035, .045]) + q[:, None]*np.array([.965, .925, .835])
    rgb = np.clip(np.rint(np.maximum(0, color)**.89*255), 0, 255).astype(np.uint8)
    luminance = rgb @ np.array([.2126, .7152, .0722])
    return hard, rgb, luminance


def raw_window(donor, settings):
    a, b = donor['sourceWindow']
    return [round(a+(b-a)*settings.get(k, fallback))
            for k, fallback in [('windowLow', 0), ('windowHigh', 1)]]


def effective_window(donor, settings):
    if not settings.get('windowEnabled'):
        return None
    low, high = settings['windowLow'], settings['windowHigh']
    c, g = settings['capContrast'], settings['windowGamma']
    a, b = donor['sourceWindow']
    result = []
    for q in [0, 1]:
        t = np.clip((q-.5)/c+.5, 0, 1)**(1/g)
        result.append(round(a+(b-a)*(low+t*(high-low)), 2))
    return result


def image_for(bank, item):
    path = bank / item['path']
    data = path.read_bytes()
    assert hashlib.sha256(data).hexdigest() == item['sha256'], path
    arr = np.asarray(Image.open(path).convert('L')).copy()
    assert hashlib.sha256(arr.tobytes()).hexdigest() == item['sourceDisplaySha256'], path
    return arr


def sample_plan(manifest, donor_id):
    plans = []
    for axis in 'xyz':
        n = len(manifest['slices'][axis])
        for group, fractions in [('selection', [.36, .5, .64]), ('additional-checks', [.43, .57])]:
            for fraction in fractions:
                plans.append((axis, round((n-1)*fraction), group))
    if donor_id == 'ladaf-2021-17':
        plans += [('y', 275, 'screenshot-reference'), ('z', 201, 'screenshot-reference')]
    return list(dict.fromkeys(plans))


def sample_metrics(hist, pair_hist, settings):
    hard, rgb, lum = transfer(settings)
    total = max(1, hist.sum())
    cdf = np.cumsum(hist)/total
    source_q = np.searchsorted(cdf, [.1, .5, .9])
    occupied = hist > 0
    # Only count true transfer plateaus, not palette tint or white RGB channels.
    # Legacy caps clamp to .015/.98 rather than0/1, which also erases source
    # differences. Count a repeated endpoint plateau even when its RGB is ivory.
    black, white = hard <= hard.min()+1e-12, hard >= hard.max()-1e-12
    if black.sum() < 2: black[:] = False
    if white.sum() < 2: white[:] = False
    distinct = len(np.unique(rgb[occupied], axis=0))
    d = np.abs(lum[:, None]-lum[None, :])
    pair_total = max(1, pair_hist.sum())
    pair_flat = (d < .5)
    return dict(visiblePixels=int(hist.sum()), blackPlateauPercent=float(hist[black].sum()/total*100),
                whitePlateauPercent=float(hist[white].sum()/total*100),
                sourceCodes=int(occupied.sum()), distinctDisplayedRGB=int(distinct),
                meanLuminance255=float(hist@lum/total),
                p10MedianP90Luminance255=lum[source_q].tolist(),
                texturePairMeanDifference255=float((pair_hist*d).sum()/pair_total),
                texturePairFlattenedPercent=float(pair_hist[pair_flat].sum()/pair_total*100))


def draw_image(sheet, array, settings, threshold, box, crop=None):
    _, lut, _ = transfer(settings)
    if crop is not None:
        x, y, size = crop
        array = array[y:y+size, x:x+size]
    rgb = lut[array]
    rgb[array/255 < threshold] = 0
    im = Image.fromarray(rgb)
    x, y, w, h = box
    im.thumbnail((w, h), Image.Resampling.LANCZOS)
    sheet.paste(im, (x+(w-im.width)//2, y+(h-im.height)//2))


def dense_crop(array, threshold, size=224):
    # Consistent measured interior patch for visual review. The algorithm only
    # chooses a crop; it does not enhance, filter or replace any displayed pixel.
    a = array.astype(float)
    valid = uniform_filter((a/255 >= threshold).astype(float), size=size)
    mean = uniform_filter(a, size=size)
    variance = np.maximum(0, uniform_filter(a*a, size=size)-mean*mean)
    score = np.sqrt(variance)*np.clip((valid-.88)/.12, 0, 1)
    edge = size//2+1
    score[:edge] = 0; score[-edge:] = 0; score[:, :edge] = 0; score[:, -edge:] = 0
    y, x = np.unravel_index(np.argmax(score), score.shape)
    return [max(0, int(x-size//2)), max(0, int(y-size//2)), size]


def compare_sheet(donor, samples, profiles, path):
    # Central XYZ plus screenshot-matching Y plane for LADAF. Same source pixels
    # and scale in every column. Rows show context, then a native tissue crop.
    selected = [next(s for s in samples if s['axis'] == axis and s['central']) for axis in 'xyz']
    if donor['id'] == 'ladaf-2021-17':
        selected[1] = next(s for s in samples if s['axis'] == 'y' and s['index'] == 275)
    width, height, header = 350, 410, 112
    rows = len(selected)
    sheet = Image.new('RGB', (width*len(profiles), header+rows*(height+248)), BG)
    draw = ImageDraw.Draw(sheet)
    for col, p in enumerate(profiles):
        x = col*width
        draw.text((x+12, 8), donor['specimen']+' · '+p['label'], font=FONT, fill='#eee8df')
        lo, hi = raw_window(donor, p['settings'])
        draw.text((x+12, 34), f'Black {lo:,} · white {hi:,}', font=SMALL, fill='#aeb9bd')
        draw.text((x+12, 54), f'Gamma {p["settings"]["windowGamma"]:.2f} · brightness {p["settings"]["cutFaceExposure"]:.2f}', font=SMALL, fill='#aeb9bd')
        draw.text((x+12, 74), f'Contrast {p["settings"]["capContrast"]:.2f} · {"window on" if p["settings"]["windowEnabled"] else "legacy window off"}', font=SMALL, fill='#aeb9bd')
    review_crops = []
    for row, sample in enumerate(selected):
        y = header+row*(height+248)
        crop = dense_crop(sample['array'], sample['threshold'])
        review_crops.append(dict(axis=sample['axis'], index=sample['index'], cropInStoredImage=crop))
        for col, p in enumerate(profiles):
            x = col*width
            draw_image(sheet, sample['array'], p['settings'], sample['threshold'], (x+8, y+24, width-16, height-30))
            draw.text((x+12, y+3), f'{sample["axis"].upper()} section {sample["index"]+1} · {donor["fineSpacingUm"]:g} µm', font=SMALL, fill='#aeb9bd')
            draw_image(sheet, sample['array'], p['settings'], sample['threshold'], (x, y+height+20, width, 224), crop)
            draw.text((x+12, y+height+1), 'Measured interior crop · unchanged source pixels', font=SMALL, fill='#aeb9bd')
    sheet.save(path, quality=94)
    return review_crops


def bounded_sensitivity(donor, samples, profiles):
    """Small local grid around both review profiles; no winner-score fitting.

    Black/white offsets are in the original normalized encoding; no image is
    decoded per candidate. Histogram and source-pair histograms are reused.
    """
    groups = {}
    for name in ['selection', 'additional-checks']:
        chosen = [s for s in samples if s['group'] == name]
        groups[name] = (
            sum((s['hist'] for s in chosen), np.zeros(256, np.int64)),
            sum((s['pair'] for s in chosen), np.zeros((256,256), np.int64)))
    candidates = []
    seen = set()
    anchors = [p for p in profiles if p['id'] in ['balanced','strong']]
    for anchor in anchors:
        for dlo, dhi, gamma, exposure, contrast in itertools.product(
                [-.02, 0, .02], [-.02, 0, .02], [.85, .9, 1, 1.05, 1.1],
                [2.5, 2.75, 3], [1, 1.2, 1.8]):
            s = dict(anchor['settings'],
                     windowLow=round(max(0, anchor['settings']['windowLow']+dlo), 3),
                     windowHigh=round(min(1, anchor['settings']['windowHigh']+dhi), 3),
                     windowGamma=gamma, cutFaceExposure=exposure, capContrast=contrast)
            key = json.dumps(s, sort_keys=True)
            if key in seen: continue
            seen.add(key)
            metrics = {k: sample_metrics(*hist, s) for k,hist in groups.items()}
            candidates.append(dict(settings=s, rawWindow=raw_window(donor,s), metrics=metrics))
    # Report the nondominated tradeoffs: fewer endpoint plateaus, more display
    # tones, and stronger source-pair differences. This is not a fidelity score.
    objectives = []
    for c in candidates:
        m = c['metrics']['selection']
        objectives.append([-(m['blackPlateauPercent']+m['whitePlateauPercent']),
                            m['distinctDisplayedRGB'], m['texturePairMeanDifference255']])
    objectives = np.array(objectives)
    frontier = []
    for i, values in enumerate(objectives):
        better = (objectives >= values).all(axis=1) & (objectives > values).any(axis=1)
        if not better.any(): frontier.append(i)
    ranges = {}
    for metric in ['blackPlateauPercent','whitePlateauPercent','distinctDisplayedRGB',
                   'meanLuminance255','texturePairMeanDifference255','texturePairFlattenedPercent']:
        vals = [c['metrics']['selection'][metric] for c in candidates]
        ranges[metric] = [min(vals), max(vals)]
    # Contrast sensitivity is especially informative at a fixed display window.
    contrast_series = []
    for anchor in anchors:
        for contrast in [1, 1.2, 1.8]:
            s = dict(anchor['settings'], capContrast=contrast)
            contrast_series.append(dict(anchor=anchor['id'], settings=s,
                effectiveUnclippedRawWindow=effective_window(donor,s),
                metrics={k:sample_metrics(*hist,s) for k,hist in groups.items()}))
    return dict(candidateCount=len(candidates),
        selectionPlanes=9, additionalCheckPlanes=6,
        scope='Local sensitivity grid, not a global search or perceptually validated optimum. Image review selects the published profiles; the grid checks nearby tradeoffs.',
        grid=dict(anchors=['balanced','strong'], normalizedEndpointOffsets=[-.02,0,.02],
                  gamma=[.85,.9,1,1.05,1.1], brightness=[2.5,2.75,3], contrast=[1,1.2,1.8]),
        selectionMetricRanges=ranges, nondominatedCandidateIndices=frontier,
        paretoObjectives=['minimize endpoint plateau percentage','maximize distinct displayed RGB codes',
                          'maximize local source-pair luminance difference'],
        caveat='Both signal and noise may contribute to local source-pair contrast. More tones or contrast do not establish finer spatial resolution or anatomical correctness.',
        contrastSensitivity=contrast_series, candidates=candidates)


def main():
    results = {'scope': 'Display-only Tissue/space transfer. Fixed source data, threshold, geometry and sampling. No clinical or perceptual ground truth.',
               'screenshotAssumption': 'Only the four visible controls are known; reference uses hidden cut-face contrast 1.8, the existing LADAF default. A contrast1.0 sensitivity reference is included.',
               'metricConvention': 'Head-on 3D cap after production output gamma.89; custom-window CT cards use the same color transfer. Oblique 3D faces additionally use the production facing factor .91–1 before gamma. Original unwindowed CT cards have their historical distinct transfer; original comparisons here use the 3D cap transfer.',
               'donors': {}}
    native = {'donors': {}}
    gamma_results = {'donors': {}}
    sensitivity_results = {'donors': {}}
    for donor in DONORS:
        manifest = json.loads(SOURCE_PATH(donor['ultraManifestUrl']).read_text())
        volume = json.loads(SOURCE_PATH(donor['manifestUrl']).read_text())
        bank = ROOT / ('data/ultra-sections' if donor['id'] == 'ladaf-2021-17' else 'data/donors/'+donor['id']+'/ultra-sections')
        threshold = volume['defaultThreshold']
        samples, sample_records = [], []
        for axis, index, group in sample_plan(manifest, donor['id']):
            item = manifest['slices'][axis][index]
            arr = image_for(bank, item)
            mask = arr/255 >= threshold
            hist = np.bincount(arr[mask], minlength=256)
            interior = binary_erosion(mask, iterations=3)
            pair = np.zeros((256, 256), np.int64)
            for dy, dx in [(0, 3), (3, 0)]:
                a, b = arr[:arr.shape[0]-dy or None, :arr.shape[1]-dx or None], arr[dy:, dx:]
                m = interior[:arr.shape[0]-dy or None, :arr.shape[1]-dx or None] & interior[dy:, dx:]
                delta = np.abs(a.astype(np.int16)-b.astype(np.int16))
                m &= (delta >= 2) & (delta <= 16)
                pair += np.bincount(a[m].astype(np.int32)*256+b[m], minlength=256*256).reshape(256,256)
            central = index == round((len(manifest['slices'][axis])-1)*.5)
            sample = dict(axis=axis, index=index, group=group, threshold=threshold, central=central,
                          array=arr, hist=hist, pair=pair)
            samples.append(sample)
            sample_records.append(dict(axis=axis, index=index, displayedSectionNumber=index+1, group=group,
                                       path=str((bank/item['path']).relative_to(ROOT)), sha256=item['sha256'],
                                       sourceDisplaySha256=item['sourceDisplaySha256'], crop=item['crop'],
                                       dimensions=list(arr.shape[::-1]), visiblePixels=int(mask.sum())))
        profiles = [dict(id='original', label='Original', settings=donor['displayWindow'])]
        if donor['id'] == 'ladaf-2021-17':
            profiles += [dict(id='screenshot', label='Screenshot reference', settings=settings_for(donor, (17454,21176,1.1,3,1.8))),
                         dict(id='screenshot-c1', label='Reference · contrast 1', settings=settings_for(donor, (17454,21176,1.1,3,1)))]
        profiles += [dict(id=k, label={'balanced':'Balanced detail','strong':'Strong contrast'}[k], settings=settings_for(donor,v))
                     for k,v in CHOICES[donor['id']].items()]
        native['donors'][donor['id']] = dict(profiles=profiles)
        grouped = {}
        for group in ['selection', 'additional-checks', 'screenshot-reference', 'all']:
            selected = [s for s in samples if group == 'all' or s['group'] == group]
            if not selected: continue
            h = sum((s['hist'] for s in selected), np.zeros(256,np.int64))
            ph = sum((s['pair'] for s in selected), np.zeros((256,256),np.int64))
            grouped[group] = dict(planes=len(selected), histogram=h.tolist(), sourcePercentileProbabilities=PERCENTILES,
                sourcePercentileBytes=np.searchsorted(np.cumsum(h)/h.sum(),PERCENTILES).tolist(),
                profiles=[dict(id=p['id'], rawWindow=raw_window(donor,p['settings']),
                               effectiveUnclippedRawWindow=effective_window(donor,p['settings']),
                               **sample_metrics(h,ph,p['settings'])) for p in profiles])
        per_plane = []
        for s in samples:
            per_plane.append(dict(axis=s['axis'],index=s['index'],group=s['group'],profiles=[dict(id=p['id'],**sample_metrics(s['hist'],s['pair'],p['settings'])) for p in profiles]))
        crops = compare_sheet(donor, samples, profiles, OUT/(donor['id']+'-candidate-comparison.jpg'))
        gamma_profiles = []
        balanced = next(p for p in profiles if p['id'] == 'balanced')
        for gamma in [1.05,1,.9,.85,.8]:
            gamma_profiles.append(dict(id='balanced-gamma-'+str(gamma), label='Balanced gamma '+str(gamma),
                                       settings=dict(balanced['settings'],windowGamma=gamma)))
        gamma_profiles.append(next(p for p in profiles if p['id']=='strong'))
        gamma_path = OUT/(donor['id']+'-gamma-comparison.jpg')
        compare_sheet(donor, samples, gamma_profiles, gamma_path)
        # Compact native-size crop sheet is easier to assess without reducing
        # the source pixel scale in a wide six-column figure.
        full = Image.open(gamma_path)
        crop_sheet = Image.new('RGB',(full.width,112+3*248),BG)
        crop_sheet.paste(full.crop((0,0,full.width,112)),(0,0))
        for row in range(3):
            y = 112+row*658+410
            crop_sheet.paste(full.crop((0,y,full.width,y+248)),(0,112+row*248))
        crop_sheet.save(OUT/(donor['id']+'-gamma-crops.jpg'), quality=94)
        gamma_results['donors'][donor['id']] = gamma_profiles
        sensitivity_results['donors'][donor['id']] = bounded_sensitivity(donor,samples,profiles)
        results['donors'][donor['id']] = dict(sourceWindow=donor['sourceWindow'],
            threshold=threshold, thresholdRaw=donor['sourceWindow'][0]+threshold*np.ptp(donor['sourceWindow']),
            sampleCount=len(samples), sourceEvidence=sample_records, profiles=profiles,
            statistics=grouped, perPlane=per_plane, visualCrops=crops)
        print(donor['id'],json.dumps(grouped['all']['profiles']),flush=True)
    (OUT/'candidate-profiles.json').write_text(json.dumps(native,indent=2)+'\n')
    (OUT/'candidate-analysis.json').write_text(json.dumps(results,indent=2)+'\n')
    (OUT/'gamma-candidates.json').write_text(json.dumps(gamma_results,indent=2)+'\n')
    (OUT/'sensitivity-sweep.json').write_text(json.dumps(sensitivity_results,separators=(',',':'))+'\n')
    print('Saved measured-source comparisons:',OUT,flush=True)


if __name__ == '__main__':
    main()
