"""Read-only production delivery verification. Site access is hidden stdin.

This checks deployed bytes and HTTP video range delivery, not browser playback,
pointer-lock permission, or interactive frame rate.
"""
import hashlib
import gzip
import json
import pathlib
import sys
import termios
import urllib.request

fd = sys.stdin.fileno()
previous = termios.tcgetattr(fd)
hidden = termios.tcgetattr(fd)
hidden[3] &= ~termios.ECHO
termios.tcsetattr(fd, termios.TCSANOW, hidden)
print('Ready for Site service access JSON on stdin (input is hidden).', flush=True)
try:
    access = json.loads(sys.stdin.readline())
finally:
    termios.tcsetattr(fd, termios.TCSANOW, previous)

origin = access['siteUrl'].rstrip('/')
assert origin.startswith('https://') and origin.endswith('.chatgpt.site')
root = pathlib.Path(__file__).resolve().parents[1]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


opener = urllib.request.build_opener(NoRedirect())


def request(path, extra_headers=None):
    headers = {'OAI-Sites-Authorization': 'Bearer ' + access['bearer']}
    headers.update(extra_headers or {})
    req = urllib.request.Request(origin + '/' + path.lstrip('./'), headers=headers)
    with opener.open(req, timeout=45) as response:
        return response.status, dict(response.headers), response.read()


def get(path):
    status, _, content = request(path)
    assert status == 200, (path, status)
    return content


html = get('/')
for marker in [b'id="probeTab"', b'id="probePanel"', b'probe-lab.css', b'id="ultraCacheStatus"']:
    assert marker in html, marker
assert b'id="scanDownloadBar"' in html
assert b'id="nativeTab"' not in html and b'id="nativePanel"' not in html
assert html.index(b'id="echoTab"') < html.index(b'id="probeTab"')

modules = {}
for name in [
    'app.js', 'styles.css', 'echo.js', 'echo.css', 'echo-texture-worker.js', 'hosted-ultra.js',
    'section-detail.js', 'ultra-prefetch.js', 'ultra-cache-worker.js',
    'probe-lab.js', 'probe-lab.css', 'probe-geometry.js', 'probe-acoustics.js',
    'probe-acoustics-worker.js', 'renderer.js', 'ultra-volume.js',
    'ultra-volume-worker.js', 'ultra-volume-core.js', 'ultra-volume-backend.js',
]:
    data = get(name)
    assert data == (root / 'public' / name).read_bytes(), name
    modules[name] = 'exact source match'

echo = json.loads(get('assets/echo-textures.json'))
assert echo['version'] == 'echo-ultra-v6'
assert len(echo['textures']) == 13
echo_textures = {}
for name, item in echo['textures'].items():
    data = get(item['url'])
    assert len(data) == item['bytes'], name
    assert hashlib.sha256(data).hexdigest() == item['sha256'], name
    assert item['sourceSpacingUm'] == 79.4 and item['maxDecodedPixelError'] == 0
    echo_textures[name] = {'bytes': len(data), 'spacingUm': item['spacingUm'], 'sha256Verified': True}

media = json.loads(get('assets/echo-media-v6.json'))
assert len(media['clips']) == 12
assert media['version'] == 'echo-media-v7'
media_files = {}
for clip in media['clips']:
    data = get(clip['url'])
    assert len(data) == clip['bytes'], clip['id']
    assert hashlib.sha256(data).hexdigest() == clip['sha256'], clip['id']
    assert len(get(clip['poster'])) == clip['posterBytes'], clip['id']
    media_files[clip['id']] = {'videoBytes': len(data), 'sha256Verified': True}

# Record the static host's range behavior honestly. The Echo player fetches the
# selected full clip into a bounded Blob cache and gives native video a local URL.
sample = media['clips'][0]
status, headers, data = request(sample['url'], {'Range': 'bytes=0-1023'})
normalized_headers = {key.lower(): value for key, value in headers.items()}
assert status in (200, 206)
assert data == (root / 'public' / sample['url'].lstrip('./')).read_bytes()[:len(data)]
range_delivery = {'status': status, 'bytes': len(data), 'contentType': normalized_headers.get('content-type'),
                  'contentRange': normalized_headers.get('content-range'), 'partialContent': status == 206}

ultra = json.loads(get('assets/ultra-sections/manifest.json'))
ultra_samples = {}
for axis, index in [('x', 237), ('y', 237), ('z', 265)]:
    record = ultra['slices'][axis][index]
    data = get(ultra['assetBaseUrl'] + record['path'] + '?v=' + record['sha256'][:16])
    assert len(data) == record['bytes'] and hashlib.sha256(data).hexdigest() == record['sha256']
    ultra_samples[f'{axis}:{index}'] = {'bytes': len(data), 'sha256Verified': True}

fine = json.loads(get('assets/ultra-volume-v7.json'))
assert fine['sourceSpacingUm'] == 79.4 and len(fine['blocks']) == 5127
fine_status = json.loads(get(fine['assetBaseUrl'] + 'status'))
assert fine_status['complete'] and not fine_status['uploadsEnabled']
assert fine_status['verified'] == 5127 and fine_status['bytes'] == fine['totalEncodedBytes']
fine_samples = {}
for item in list(fine['blocks'].values())[::1400]:
    status, headers, data = request(fine['assetBaseUrl'] + item['path'])
    assert status == 200 and len(data) == item['bytes']
    assert hashlib.sha256(data).hexdigest() == item['sha256']
    assert hashlib.sha256(gzip.decompress(data)).hexdigest() == item['rawSha256']
    assert not {k.lower(): v for k, v in headers.items()}.get('content-encoding')
    fine_samples[item['path']] = {'encodedAndDecodedChecksumsVerified': True, 'bytes': len(data)}
probe_planes = {}
for item in fine['preparedPlanes']:
    data = get(item['url'])
    assert len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256']
    probe_planes[item['id']] = {'width': item['width'], 'height': item['height'], 'sha256Verified': True}

result = {
    'verified': True, 'updatedInterface': True, 'modules': modules,
    'echoTextureCount': len(echo_textures), 'echoTextures': echo_textures,
    'referenceMovieCount': len(media_files), 'referenceMovies': media_files,
    'videoRangeDelivery': range_delivery, 'hostedUltraSamples': ultra_samples,
    'fineVolumeInventory': fine_status, 'fineVolumeSamples': fine_samples, 'preparedProbePlanes': probe_planes,
    'scope': 'Read-only production HTML, module, asset checksum and HTTP checks. No interactive browser playback, pointer-lock or frame-rate claim.',
}
pathlib.Path(access['reportPath']).write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result), flush=True)
