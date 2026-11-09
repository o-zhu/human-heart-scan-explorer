"""Prepare higher-cadence normal TTE loops and native-pixel TEE sector crops.

All transformations start from the cited, licensed original files. No image is
upscaled, no frame is interpolated, and no clinical feature is reconstructed.
TEE crops retain the all-frame visible-signal union plus an eight-pixel margin;
source annotations and watermarks are retained. The ultrasound acquisitions are
independent of the static HiP-CT specimen.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import urllib.request

import numpy as np
from PIL import Image, ImageDraw
from prepare_echo_media_v6 import entries, probe

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
CARDIO = {
    'plax': ('PLAXnormal_(CardioNetworks_ECHOpedia).webm',
             'c/cd/PLAXnormal_%28CardioNetworks_ECHOpedia%29.webm'),
    'a4c': ('A4C_normal_(CardioNetworks_ECHOpedia).webm',
            '1/1b/A4C_normal_%28CardioNetworks_ECHOpedia%29.webm'),
    'a2c': ('A2Cnormal_(CardioNetworks_ECGpedia).avi.webm',
            '2/21/A2Cnormal_%28CardioNetworks_ECGpedia%29.avi.webm'),
    'subcostal': ('Subcostal_normal_(CardioNetworks_ECHOpedia).webm',
                  '7/70/Subcostal_normal_%28CardioNetworks_ECHOpedia%29.webm'),
    'psax_papillary': ('SAXPAP_normal_(CardioNetworks_ECHOpedia).webm',
                       '2/22/SAXPAP_normal_%28CardioNetworks_ECHOpedia%29.webm'),
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def visible_crop(source, width, height):
    """Conservative, even-pixel crop of all decoded frames, not a single poster."""
    process = subprocess.Popen([
        'ffmpeg', '-v', 'error', '-i', str(source), '-map', '0:v:0',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    union = np.zeros((height, width), dtype=bool)
    maximum = np.zeros((height, width), dtype=np.uint8)
    size, frames = width * height * 3, 0
    while True:
        raw = process.stdout.read(size)
        if not raw:
            break
        assert len(raw) == size
        frame = np.frombuffer(raw, np.uint8).reshape(height, width, 3)
        level = frame.max(axis=2)
        maximum = np.maximum(maximum, level)
        union |= level > 12
        frames += 1
    assert process.wait() == 0
    yy, xx = np.where(union)
    x = max(0, (int(xx.min()) - 8) // 2 * 2)
    y = max(0, (int(yy.min()) - 8) // 2 * 2)
    right = min(width, (int(xx.max()) + 10) // 2 * 2)
    bottom = min(height, (int(yy.max()) + 10) // 2 * 2)
    outside = np.ones_like(union)
    outside[y:bottom, x:right] = False
    return dict(x=x, y=y, width=right-x, height=bottom-y,
                visibleThreshold=12, marginPixels=8, inspectedFrames=frames,
                maximumDiscardedChannelValue=int(maximum[outside].max(initial=0)),
                retainedFrameArea=(right-x)*(bottom-y)/(width*height))


def video_stream(metadata):
    return next(stream for stream in metadata['streams'] if stream['codec_type'] == 'video')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('/workspace/data/echo-media-v7'))
    parser.add_argument('--original-cache', type=Path, default=Path('/workspace/data/echo-media-v6'))
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    out = PUBLIC / 'assets/echo-media-v7'
    docs = ROOT / 'docs/echo-v7'
    out.mkdir(parents=True, exist_ok=True)
    docs.mkdir(parents=True, exist_ok=True)
    catalog_path = PUBLIC / 'assets/echo-media-v6.json'
    catalog = json.loads(catalog_path.read_text())
    baseline_path = docs / 'previous-cine-quality.json'
    if not baseline_path.exists():
        baseline_path.write_text(json.dumps({clip['id']: {
            key: clip[key] for key in ['width', 'height', 'frames', 'averageFrameRate', 'bytes', 'sourceUrl']
        } for clip in catalog['clips']}, indent=2)+'\n')
    baseline = json.loads(baseline_path.read_text())
    originals = {entry['id']: entry for entry in entries()}
    measurements = []
    for clip in catalog['clips']:
        original_entry = originals[clip['id']]
        is_cardio = clip['mode'] == 'tte' and clip['preset'] in CARDIO
        is_tee = clip['mode'] == 'tee'
        if not (is_cardio or is_tee):
            clip['qualityLabel'] = ('624 × 480 native pixels · 51 fps · original recorded frames'
                                    if clip['preset'] == 'a3c' else
                                    '492 × 352 source pixels · 10 fps GIF source · changing-plane sweep')
            continue
        if is_cardio:
            page_name, download_path = CARDIO[clip['preset']]
            source_url = 'https://commons.wikimedia.org/wiki/File:' + page_name
            download_url = 'https://upload.wikimedia.org/wikipedia/commons/' + download_path
            source = args.cache / (clip['preset'] + '.webm')
            clip.update(sourceUrl=source_url, downloadUrl=download_url,
                        sourceName='CardioNetworks / ECHOpedia',
                        author='CardioNetworks: Vdbilt (I. A. C. van der Bilt, MD)',
                        description=f"Normal {clip['title'].lower()} reference from CardioNetworks / ECHOpedia; original recorded motion at 51 frames per second.",
                        clinicalStatus='Normal reference, according to source',
                        license='CC BY-SA 3.0',
                        licenseUrl='https://creativecommons.org/licenses/by-sa/3.0/',
                        licenseEvidenceUrl=source_url)
        else:
            source = args.original_cache / original_entry['filename']
            download_url = original_entry['downloadUrl']
        if not source.exists():
            source.parent.mkdir(parents=True, exist_ok=True)
            request = urllib.request.Request(download_url, headers={'User-Agent': 'HeartAtlas-Educational/1.0'})
            with urllib.request.urlopen(request, timeout=60) as response:
                source.write_bytes(response.read())
        source_meta = probe(source)
        original = video_stream(source_meta)
        crop = visible_crop(source, original['width'], original['height']) if is_tee else None
        filters = (f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']}," if crop else '')
        filters += 'pad=ceil(iw/2)*2:ceil(ih/2)*2'
        target = out / (clip['id'] + '.mp4')
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(source),
            '-map', '0:v:0', '-an', '-vf', filters, '-fps_mode', 'vfr',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', str(target)
        ], check=True)
        prepared_meta = probe(target)
        video = video_stream(prepared_meta)
        assert int(video['nb_read_frames']) == int(original['nb_read_frames'])
        assert not any(stream['codec_type'] == 'audio' for stream in prepared_meta['streams'])
        assert target.stat().st_size <= 4 * 1024 * 1024
        assert video['width'] <= original['width'] and video['height'] <= original['height']
        duration = float(prepared_meta['format']['duration'])
        poster = out / (clip['id'] + '.webp')
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', str(duration*.35),
            '-i', str(target), '-frames:v', '1', '-quality', '92', '-y', str(poster)
        ], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-f', 'null', '-'], check=True)
        modifications = ('Transcoded from the licensed original to silent H.264 MP4 at CRF 16; all recorded frames and native pixel detail retained. No upscaling or motion interpolation. ')
        if crop:
            modifications += (f"Black margins trimmed to {crop['width']} × {crop['height']} at ({crop['x']}, {crop['y']}); all-frame visible signal and annotations plus an eight-pixel margin retained. ")
        modifications += 'The poster is one native-size frame. Attribution and source annotations are retained.'
        fps = str(video['avg_frame_rate']).split('/')
        frame_rate = float(fps[0])/float(fps[1])
        clip.update(url='./assets/echo-media-v7/'+target.name,
                    poster='./assets/echo-media-v7/'+poster.name,
                    width=video['width'], height=video['height'], durationSeconds=duration,
                    frames=int(video['nb_read_frames']), averageFrameRate=video['avg_frame_rate'],
                    sourceFrameRate=original['avg_frame_rate'], sourceFrames=int(original['nb_read_frames']),
                    bytes=target.stat().st_size, posterBytes=poster.stat().st_size,
                    sha256=digest(target), sourceSha256=digest(source),
                    sourceDimensions=[original['width'], original['height']],
                    modifications=modifications,
                    qualityLabel=f"{video['width']} × {video['height']} {'native crop' if crop else 'native pixels'} · {frame_rate:g} fps · {'black margins trimmed' if crop else 'original recorded frames'}")
        if crop:
            clip['nativeCrop'] = crop
        measurements.append(dict(id=clip['id'], previous=baseline[clip['id']],
                                 width=video['width'], height=video['height'],
                                 frames=clip['frames'], averageFrameRate=clip['averageFrameRate'],
                                 bytes=clip['bytes'], crop=crop, sourceUrl=clip['sourceUrl'],
                                 sourceDimensions=clip['sourceDimensions'],
                                 interpretation='Original 51 fps recorded motion replaces a 10–12 fps GIF.' if is_cardio else
                                 'Black margins removed at native pixels; no increase in acquisition resolution.'))
        print(clip['id'], clip['width'], clip['height'], clip['frames'], clip['averageFrameRate'], clip['bytes'], flush=True)
    catalog.update(version='echo-media-v7', retrievedDate='2026-11-05',
                   totalVideoBytes=sum(clip['bytes'] for clip in catalog['clips']),
                   totalPosterBytes=sum(clip['posterBytes'] for clip in catalog['clips']))
    catalog_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False)+'\n')
    (docs / 'media-quality.json').write_text(json.dumps(measurements, indent=2)+'\n')
    contact = Image.new('RGB', (1080, 1080), '#10181d')
    draw = ImageDraw.Draw(contact)
    for index, clip in enumerate(catalog['clips']):
        image = Image.open(PUBLIC/clip['poster'].removeprefix('./')).convert('RGB')
        image.thumbnail((350, 230))
        x, y = (index % 3)*360, (index // 3)*270
        contact.paste(image, (x+(360-image.width)//2, y+35+(230-image.height)//2))
        draw.text((x+10, y+8), clip['id'], fill='white')
        draw.text((x+10, y+22), f"{clip['width']}x{clip['height']} | {clip['averageFrameRate']} fps", fill='#a5c2c9')
    contact.save(docs/'cine-contact-sheet.jpg', quality=92)
    print(json.dumps({'clips':len(catalog['clips']), 'videoBytes':catalog['totalVideoBytes'],
                      'posterBytes':catalog['totalPosterBytes']}))


if __name__ == '__main__':
    main()
