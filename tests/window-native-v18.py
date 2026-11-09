"""Verify candidate CT display profiles against the production shader and modules.

Uses measured, hash-verified source caps and volumes in offscreen EGL. This is
scientific pixel verification, not browser QA, a speed benchmark, or proof that
one contrast setting is universally optimal. No source or production file is
modified. The existing native fixture supplies context setup and source readers.
"""
from pathlib import Path
import argparse
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--profiles', type=Path, default=ROOT/'docs/windowing-v18/candidate-profiles.json')
parser.add_argument('--output', type=Path, default=ROOT/'docs/windowing-v18/native')
options = parser.parse_args()
profile_path, output_path = options.profiles.resolve(), options.output.resolve()

# Reuse context/source-loading code only; do not execute the historical tests.
argv = sys.argv[:]
sys.argv = [sys.argv[0], '--output', str(output_path)]
fixture = ROOT/'tests/renderer-responsiveness-v16-native.py'
fixture_setup = fixture.read_text().split('checks=[]')[0]
fixture_setup = fixture_setup.replace('W, H, VW, VH = 490, 590, 180, 217', 'W, H, VW, VH = 640, 800, 180, 217')
exec(compile(fixture_setup, str(fixture), 'exec'))
sys.argv = argv

payload = read_json(profile_path)
profile_groups = payload.get('donors', payload)
required = ['windowEnabled', 'windowLow', 'windowHigh', 'windowGamma', 'capContrast', 'cutFaceExposure']
production_profiles = node('import {DONORS} from "./public/donors.js";import {getWindowPresets} from "./public/window-presets.js";'
    'console.log(JSON.stringify(Object.fromEntries(DONORS.map(d=>[d.id,getWindowPresets(d)]))));')
source_hashes = {}


def source_record(path):
    path = path.resolve()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    source_hashes[str(path.relative_to(ROOT))] = digest
    return digest


def selected_profiles(donor):
    group = profile_groups[donor['id']]
    if isinstance(group, dict):
        group = group.get('profiles', group.get('candidates'))
    assert isinstance(group, list) and 1 <= len(group) <= 7, donor['id']
    profiles = []
    for item in group:
        setting = item.get('settings', item.get('profile', item))
        setting = {key: setting[key] for key in required}
        production_id = 'contrast' if item['id'] == 'strong' else item['id']
        production = next((p for p in production_profiles[donor['id']] if p['id'] == production_id), None)
        if production:
            # The sweep records selection evidence. The actual application
            # export supplies every shipped setting exercised below.
            actual = {key: production['settings'][key] for key in required}
            assert setting == actual, (donor['id'], item['id'], 'analysis/production profile mismatch')
            setting = actual
        assert 0 <= setting['windowLow'] < setting['windowHigh'] <= 1
        assert .5 <= setting['cutFaceExposure'] <= 3
        assert .5 <= setting['capContrast'] <= 3
        assert .5 <= setting['windowGamma'] <= 2.5
        profiles.append(dict(id=item['id'], label=item.get('label', item.get('name', item['id'])), settings=setting))
    if not any(item['id'] in ('original', 'baseline', 'current') for item in profiles):
        profiles.insert(0, dict(id='original', label='Original donor window', settings={key:donor['displayWindow'][key] for key in required}))
    return profiles


all_profiles = [dict(donor=donor['id'], **profile) for donor in donors for profile in selected_profiles(donor)]
settings_json = json.dumps([p['settings'] for p in all_profiles], separators=(',', ':'))
expected = node('import {capColor} from "./public/render-styles.js";const ps='+settings_json+';'
    'console.log(JSON.stringify(ps.map(s=>Array.from({length:6},(_,p)=>Array.from({length:256},(_,b)=>'
    'capColor(b/255,s.capContrast,p,s).map(c=>Math.round(Math.pow(Math.max(0,c),.89)*255)))))));')

palette = node('import {buildAnatomyPalette} from "./public/render-styles.js";console.log(JSON.stringify(buildAnatomyPalette()));')
expected_anatomy = node('import {capColor,capAnatomyColor,buildAnatomyPalette} from "./public/render-styles.js";const ps='+settings_json+';'
    'console.log(JSON.stringify(ps.map(s=>Array.from({length:6},(_,j)=>[0,2].map(selected=>Array.from({length:256},(_,b)=>'
    'capAnatomyColor(capColor(b/255,s.capContrast,5,s),j+1,buildAnatomyPalette(),.65,selected)'
    '.map(c=>Math.round(Math.pow(Math.max(0,c),.89)*255))))))));')

transfer_checks = []
gpu_luts = {}
for index, profile in enumerate(all_profiles):
    settings = profile['settings']
    for p_index in range(6):
        program = programs['ramp']
        bind_fbo(0x8D40, fbo)
        target(program, 256, 1)
        profile_uniforms(program, settings)
        ui(program, 'palette', p_index)
        ui(program, 'anatomyReady', 0)
        u3(program, 'planeNormal', [0, 0, 1])
        u3(program, 'eye', [0, 0, 2])
        ramp = pixels(256, 1)[0, :, :3]
        difference = np.abs(ramp.astype(np.int16)-np.asarray(expected[index][p_index], np.int16))
        assert difference.max() <= 1, (profile['donor'], profile['id'], p_index, difference.max())
        transfer_checks.append(dict(donor=profile['donor'], profile=profile['id'], palette=p_index,
            maxChannelDifference=int(difference.max()), meanChannelDifference=float(difference.mean())))
        if p_index == 4:
            gpu_luts[(profile['donor'], profile['id'])] = ramp.copy()
    # Ensure the same exposure/window controls preserve the anatomy hue shoulder.
    for label in range(1, 7):
        texture(3, np.full((1, 1, 1), label, np.uint8))
        for selected_index, selected in enumerate([0, 2]):
            program = programs['ramp']
            bind_fbo(0x8D40, fbo)
            target(program, 256, 1)
            profile_uniforms(program, settings)
            ui(program, 'palette', 5)
            ui(program, 'anatomyReady', 1)
            ui(program, 'anatomySelected', selected)
            uf(program, 'anatomyOpacity', .65)
            u3(program, 'anatomyDimensions', [1, 1, 1])
            u3(program, 'extent', [1, 1, 1])
            palette_array = np.asarray(palette, np.float32)
            fn('glUniform3fv', None, [I, I, P])(loc(program, b'anatomyColors[0]'), 16, palette_array.ctypes.data)
            ramp = pixels(256, 1)[0, :, :3]
            difference = np.abs(ramp.astype(np.int16)-np.asarray(expected_anatomy[index][label-1][selected_index], np.int16))
            assert difference.max() <= 1, (profile['donor'], profile['id'], label, selected)
            assert ramp.max() < 255
            transfer_checks.append(dict(donor=profile['donor'], profile=profile['id'], palette=5,
                label=label, selected=selected, maxChannelDifference=int(difference.max()),
                meanChannelDifference=float(difference.mean())))

# Exercise the actual CT/Echo/Probe painting methods, not a copied transfer.
# Legacy disabled-window section cards intentionally retain their old grayscale
# display. Every selected custom-window candidate must agree across all modules.
module_checks = node(r'''
import assert from 'node:assert/strict';
import {buildAnatomyPalette} from './public/render-styles.js';
import {paintSectionPixels} from './public/section-paint.js';
import {paintEchoPreview} from './public/echo.js';
import {ProbeLabModule} from './public/probe-lab.js';
const profiles='''+json.dumps(all_profiles, separators=(',', ':'))+r''';
const ramp=Uint8Array.from({length:512},(_,i)=>i%256),saved=Uint8Array.from(ramp);
const support=new Uint8Array(512).fill(1),labels=new Uint8Array(512),colors=buildAnatomyPalette();
const grid={intensity:ramp,support,labels,hasAnatomy:false,width:256,height:2};
globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
const output={},canvases=Object.fromEntries(['ct','ultrasound'].map(key=>[key,{getContext(){return {
  putImageData(image){output[key]=Uint8ClampedArray.from(image.data);},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}};}}]));
let usReference;const checks=[];
for(const profile of profiles){
 if(!profile.settings.windowEnabled)continue;
 for(let palette=0;palette<6;palette++){
  const settings={...profile.settings,palette,threshold:.3,cleanupEnabled:true};
  const section=paintSectionPixels(ramp,256,2,2,.5,{width:256,height:2},settings,null,null);
  const echo=paintEchoPreview(grid,settings,settings.capContrast,colors);
  assert.deepEqual(section,echo);
  const probe={renderer:{settings,extent:[1,1,1]},appearance:null,geometry:{longestMm:50},$:key=>canvases[key],
    displayedFrame:{width:256,height:2,ct:ramp,ultrasound:Uint8Array.from(ramp,v=>255-v),pose:{},sector:{depthMm:50},state:{depthMm:50}}};
  ProbeLabModule.prototype.paintImages.call(probe);
  assert.deepEqual(section,output.ct);
  if(usReference)assert.deepEqual(output.ultrasound,usReference);else usReference=output.ultrasound;
  assert.deepEqual(ramp,saved);
  checks.push({donor:profile.donor,profile:profile.id,palette,sectionEchoProbeEqual:true,sourceUnchanged:true,ultrasoundUnchanged:true});
 }
}
console.log(JSON.stringify(checks));
''')

font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
render_checks = []
for donor in donors:
    profiles = selected_profiles(donor)
    manifest = read_json(public_path(donor['manifestUrl']))
    level = manifest['levels']['high']
    for part in level['parts']:
        source_record(public_path(part['url']))
    volume = load_volume(level)
    texture(0, volume, True)
    cleanup = read_json(public_path(donor['cleanupManifestUrl']))
    source_record(public_path(cleanup['volumeUrl']))
    mask = np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()), np.uint8).reshape(*cleanup['dimensions'][::-1]).copy()
    texture(2, mask)
    views = read_json(public_path(donor['flowViewsUrl']))['presets']
    view = next(v for v in views if v['id'] == ('lv-inflow' if donor['id']=='ladaf-2021-17' else 'rv-inflow'))
    source_record(public_path(view['texture']['url']))
    source_cap = verified_image(view['texture'])
    cap_hash = hashlib.sha256(source_cap.tobytes()).hexdigest()
    texture(1, source_cap, True)
    common = [level, cleanup, view['world'], profiles[0]['settings'], view['threshold'], source_cap.shape]
    baseline = draw(programs['volume'], full, *common)
    matte = draw(matte_program, composed, *common, scene=full)[:, :, 0] > 0
    assert matte.sum() > 1000, (donor['id'], 'nontrivial measured face')
    sheet = Image.new('RGB', (W*len(profiles), H+75), '#0b1115')
    crop_sheet = Image.new('RGB', (384*len(profiles), 438), '#0b1115')
    # Pick a dense face patch from the mask alone, using the same crop for all
    # profiles. It is not selected by a candidate's contrast improvement.
    side = 192
    choices = [(int(matte[y:y+side, x:x+side].sum()), x, y)
        for y in range(0, H-side, 48) for x in range(0, W-side, 48)]
    _, cx, cy = max(choices)
    bounds = (cx, cy, cx+side, cy+side)
    for column, profile in enumerate(profiles):
        common[3] = profile['settings']
        rendered = baseline if column == 0 else draw(programs['volume'], full, *common)
        changed = np.any(rendered[:, :, :3] != baseline[:, :, :3], axis=2)
        assert not np.any(changed & ~matte), (donor['id'], profile['id'], 'surface/background unexpectedly changed')
        assert hashlib.sha256(source_cap.tobytes()).hexdigest() == cap_hash
        image = Image.fromarray(rendered[:, :, :3])
        sheet.paste(image, (column*W, 75))
        crop_sheet.paste(image.crop(bounds).resize((384, 384), Image.Resampling.NEAREST), (column*384, 54))
        low, high = donor['sourceWindow']
        settings = profile['settings']
        detail = 'Window off' if not settings['windowEnabled'] else f"{round(low+settings['windowLow']*(high-low)):,}–{round(low+settings['windowHigh']*(high-low)):,} · γ {settings['windowGamma']:.2f}"
        for page, width in [(sheet, W), (crop_sheet, 384)]:
            pen = ImageDraw.Draw(page)
            pen.text((column*width+12, 8), donor['specimen']+' · '+profile['label'], font=font, fill='#eee8df')
            pen.text((column*width+12, 31), detail, font=small, fill='#a4b7b8')
        ImageDraw.Draw(sheet).text((column*W+12, 51), f"Brightness {settings['cutFaceExposure']:.2f} · contrast {settings['capContrast']:.2f} · same measured pixels", font=small, fill='#a4b7b8')
        render_checks.append(dict(donor=donor['id'], profile=profile['id'], settings=settings,
            sourceUrl=view['texture']['url'], sourceSha256=view['texture']['sha256'],
            sourceSpacingUm=view['texture'].get('sourceSpacingUm', view['texture'].get('spacingUm')),
            output=[W, H], capPixels=int(matte.sum()), changedCapPixels=int((changed & matte).sum()),
            changedNonCapPixels=0, sourcePixelsUnchanged=True, threshold=view['threshold'], crop=list(bounds)))
    sheet.save(OUT/(donor['id']+'-native-profiles.jpg'), quality=94)
    crop_sheet.save(OUT/(donor['id']+'-native-detail.png'))
    print(json.dumps(dict(donor=donor['id'], profiles=len(profiles), nativeChecksPassed=True)), flush=True)

for path, digest in source_hashes.items():
    assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest() == digest, path

report = dict(passed=True, driver=fn('glGetString', C.c_char_p, [U])(0x1F01).decode(),
    profileFile=str(profile_path.relative_to(ROOT)), profileFileSha256=hashlib.sha256(profile_path.read_bytes()).hexdigest(),
    productionProfileSource='public/window-presets.js',
    productionProfileSha256=hashlib.sha256((ROOT/'public/window-presets.js').read_bytes()).hexdigest(),
    selectedProfilesMatchProduction=True,
    shaderSourcesSha256=hashlib.sha256(json.dumps(sources, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
    profiles=all_profiles, transferChecks=transfer_checks, moduleChecks=module_checks, renderChecks=render_checks,
    sourceFileHashes=source_hashes, allSourceFilesUnchanged=True,
    scope='Production GLSL in native EGL; exact CPU/CT/Echo/Probe transfer checks and unchanged ultrasound pixels. Measured source-verified prepared Ultra caps and 3D volumes for three donors. Profile changes affect only the measured cut-face color, preserving surface, geometry, threshold and background pixels. Not browser performance or a universal fidelity score.')
(OUT/'validation.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(dict(passed=True, transferChecks=len(transfer_checks), moduleChecks=len(module_checks),
    nativeViews=len(render_checks), maxChannelDifference=max(item['maxChannelDifference'] for item in transfer_checks))), flush=True)
