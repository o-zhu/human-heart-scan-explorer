"""Inspect actual prepared/source video streams and bounded local delivery assets."""
from pathlib import Path
import hashlib
import json
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
catalog = json.loads((PUBLIC/'assets/echo-media-v6.json').read_text())
previous = json.loads((ROOT/'docs/echo-v7/previous-cine-quality.json').read_text())
assert catalog['version'] == 'echo-media-v7'
assert len(catalog['clips']) == 12


def streams(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-count_frames', '-show_entries',
        'stream=codec_type,codec_name,width,height,nb_read_frames,avg_frame_rate',
        '-of', 'json', str(path)]))['streams']


def rate(text):
    numerator, denominator = text.split('/')
    return float(numerator)/float(denominator)


def boxes(raw):
    result, offset = {}, 0
    while offset < len(raw):
        size, kind = struct.unpack_from('>I4s', raw, offset)
        if size == 1:
            size = struct.unpack_from('>Q', raw, offset+8)[0]
        elif size == 0:
            size = len(raw)-offset
        assert size >= 8 and offset+size <= len(raw)
        result[kind] = offset
        offset += size
    assert offset == len(raw)
    return result


results = []
for clip in catalog['clips']:
    path = PUBLIC/clip['url'].removeprefix('./')
    raw = path.read_bytes()
    assert len(raw) == clip['bytes'] and len(raw) <= 4*1024*1024
    assert hashlib.sha256(raw).hexdigest() == clip['sha256']
    assert (PUBLIC/clip['poster'].removeprefix('./')).stat().st_size == clip['posterBytes']
    layout = boxes(raw)
    assert layout[b'moov'] < layout[b'mdat'], clip['id']
    output = streams(path)
    assert len(output) == 1 and output[0]['codec_type'] == 'video'
    video = output[0]
    assert video['codec_name'] == 'h264'
    assert (video['width'], video['height']) == (clip['width'], clip['height'])
    assert int(video['nb_read_frames']) == clip['frames']
    assert rate(video['avg_frame_rate']) == rate(clip['averageFrameRate'])
    if '/echo-media-v7/' not in clip['url']:
        continue
    if clip['mode'] == 'tte':
        source = Path('/workspace/data/echo-media-v7')/(clip['preset']+'.webm')
    else:
        source = Path('/workspace/data/echo-media-v6')/(clip['id']+'.'+clip['downloadUrl'].rsplit('.',1)[1])
    assert hashlib.sha256(source.read_bytes()).hexdigest() == clip['sourceSha256']
    original = next(stream for stream in streams(source) if stream['codec_type'] == 'video')
    assert int(original['nb_read_frames']) == clip['frames'] == clip['sourceFrames']
    assert rate(original['avg_frame_rate']) == rate(clip['averageFrameRate'])
    assert (original['width'], original['height']) == tuple(clip['sourceDimensions'])
    if clip['mode'] == 'tte':
        assert (video['width'], video['height']) == (original['width'], original['height'])
        assert rate(video['avg_frame_rate']) == 51
        assert rate(previous[clip['id']]['averageFrameRate']) < 13
        assert clip['license'] == 'CC BY-SA 3.0'
        assert clip['sourceUrl'].startswith('https://commons.wikimedia.org/wiki/File:')
    else:
        crop = clip['nativeCrop']
        assert (video['width'], video['height']) == (crop['width'], crop['height'])
        assert crop['x'] >= 0 and crop['y'] >= 0
        assert crop['x']+crop['width'] <= original['width']
        assert crop['y']+crop['height'] <= original['height']
        assert crop['inspectedFrames'] == clip['frames']
        assert crop['maximumDiscardedChannelValue'] <= 4
        assert rate(video['avg_frame_rate']) == 25
        assert clip['license'] == 'CC BY 4.0'
        assert clip['clinicalStatus'] == 'Published clinical teaching loop'
    results.append(dict(id=clip['id'], nativeSourceDimensions=clip['sourceDimensions'],
                        outputDimensions=[clip['width'],clip['height']], frames=clip['frames'],
                        fps=rate(clip['averageFrameRate']), bytes=clip['bytes']))

assert len(results) == 10
assert catalog['totalVideoBytes'] == sum(clip['bytes'] for clip in catalog['clips'])
assert catalog['totalPosterBytes'] == sum(clip['posterBytes'] for clip in catalog['clips'])
report = dict(passed=True, currentClips=12, revisedClips=10,
              videoBytes=catalog['totalVideoBytes'], posterBytes=catalog['totalPosterBytes'],
              previousVideoBytes=sum(clip['bytes'] for clip in previous.values()),
              maximumClipBytes=max(clip['bytes'] for clip in catalog['clips']),
              checks=['All active MP4s fully decode with actual H.264 streams, no audio, correct hashes and native dimensions.',
                      'All active MP4s put moov before mdat for fast-start local playback.',
                      'All ten revised movies retain the original decoded frame count and cadence without upscaling.',
                      'Five TTE original recordings are 51 fps rather than the previous 10–12 fps GIF cadence.',
                      'Five TEE outputs use the recorded native-pixel crops, remain 25 fps and retain clinical teaching labels.',
                      'Exact source/prepared hashes and poster byte counts match the licensed catalog; every clip fits the unchanged 4 MiB bound.'],
              revised=results)
(ROOT/'docs/echo-v7/media-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
