"""Read-only deployed cine/cache checks; credentials arrive through hidden stdin.

This validates the published Blob cache and complete MP4 downloads. It is not
an interactive browser playback test.
"""
import concurrent.futures
import hashlib
import json
import pathlib
import sys
import termios
import urllib.error
import urllib.parse
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
parsed_origin = urllib.parse.urlsplit(origin)
assert parsed_origin.scheme == 'https' and parsed_origin.hostname.endswith('.chatgpt.site')
assert not parsed_origin.username and not parsed_origin.password and not parsed_origin.query
root = pathlib.Path(__file__).resolve().parents[1]
media = json.loads((root / 'public/assets/echo-media-v6.json').read_text())


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(path, headers=None, method='GET'):
    request_headers = {'OAI-Sites-Authorization': 'Bearer ' + access['bearer'], 'Accept-Encoding': 'identity'}
    request_headers.update(headers or {})
    req = urllib.request.Request(origin + '/' + path.lstrip('./'), headers=request_headers, method=method)
    opener = urllib.request.build_opener(NoRedirect())
    try:
        response = opener.open(req, timeout=55)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, {key.lower(): value for key, value in response.headers.items()}, response.read()


def exact_module(filename):
    status, _, data = request(filename)
    assert status == 200 and data == (root / 'public' / filename).read_bytes(), filename
    return filename, hashlib.sha256(data).hexdigest()


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    modules = dict(pool.map(exact_module, ['echo.js', 'echo.css', 'echo-media-cache.js', 'app.js', 'probe-lab.js']))

status, _, encoded = request('assets/echo-media-v6.json')
assert status == 200 and encoded == (root / 'public/assets/echo-media-v6.json').read_bytes()
assert len(media['clips']) == 12
# All movies were already checked before the player-only change. Recheck short,
# large and first-view files for the new complete-download playback path.
samples = list({clip['id']: clip for clip in [media['clips'][0], min(media['clips'], key=lambda c: c['bytes']), max(media['clips'], key=lambda c: c['bytes'])]}.values())


def check_clip(clip):
    status, headers, data = request(clip['url'])
    assert status == 200 and len(data) == clip['bytes'], clip['id']
    assert headers.get('content-type', '').startswith('video/mp4'), clip['id']
    assert hashlib.sha256(data).hexdigest() == clip['sha256'], clip['id']
    status, _, poster = request(clip['poster'])
    assert status == 200 and poster == (root / 'public' / clip['poster'].lstrip('./')).read_bytes(), clip['id']
    return clip['id'], {'fullGetStatus': 200, 'bytes': len(data), 'sha256Verified': True, 'posterExact': True}


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    clip_checks = dict(pool.map(check_clip, samples))

status, headers, html = request('/')
assert status == 200 and b'id="probeTab"' in html and b'id="ultraCacheStatus"' in html
result = {
    'verified': True,
    'deliveryMode': 'Selected-only full MP4 fetch, bounded Blob object-URL cache, native local playback and seeking',
    'modules': modules,
    'catalogCount': len(media['clips']),
    'representativeFullDownloads': clip_checks,
    'interfaceDelivered': True,
    'pageContentSecurityPolicy': headers.get('content-security-policy'),
    'scope': 'Actual production player/cache code, manifest, full movie hashes, posters and interface delivery; no browser playback, pointer-lock or frame-rate claim.',
}
pathlib.Path(access['reportPath']).write_text(json.dumps(result, indent=2) + chr(10))
print(json.dumps(result), flush=True)
