"""Read-only verification of the deployed assets; service access is hidden stdin."""
import gzip, hashlib, json, pathlib, sys, termios, urllib.request
import numpy as np

fd=sys.stdin.fileno()
previous=termios.tcgetattr(fd)
hidden=termios.tcgetattr(fd)
hidden[3]&=~termios.ECHO
termios.tcsetattr(fd,termios.TCSANOW,hidden)
print('Ready for Site service access JSON on stdin (input is hidden).',flush=True)
try:
    access=json.loads(sys.stdin.readline())
finally:
    termios.tcsetattr(fd,termios.TCSANOW,previous)

origin=access['siteUrl'].rstrip('/')
assert origin.startswith('https://') and origin.endswith('.chatgpt.site')
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None
opener=urllib.request.build_opener(NoRedirect())
def get(path):
    request=urllib.request.Request(origin+'/'+path.lstrip('./'),headers={'OAI-Sites-Authorization':'Bearer '+access['bearer']})
    with opener.open(request,timeout=45) as response:
        assert response.status==200
        return response.read()
def decode_gzip(data):
    return gzip.decompress(data) if data[:2]==b'\x1f\x8b' else data
root=pathlib.Path(__file__).resolve().parents[1]
html=get('/')
for marker in [b'Chambers &amp; valves',b'id="surfaceSmoothing"',b'id="flowPanel"',b'flow-views.css']:
    assert marker in html,marker
modules={}
for name in ['app.js','renderer.js','cpu-worker.js','cpu-renderer.js','appearance.js','section-paint.js','flow-views.js','flow-views.css','volume-loader.js','volume-loader-worker.js','echo.js']:
    data=get(name)
    assert data==(root/'public'/name).read_bytes(),name
    modules[name]='exact source match'

manifest=json.loads(get('assets/manifest.json'))
assert manifest['previewLevel']=='low'
volumes={}
for key in ['low','high']:
    level=manifest['levels'][key]
    assert level['supportCompressed'] and len(level['parts'])==1
    part=level['parts'][0]
    encoded=get(part['url'])
    raw=bytearray(decode_gzip(encoded))
    nx,ny,nz=level['dimensions']
    assert len(raw)==nx*ny*nz
    assert part['predictor']=='delta-z'
    values=np.frombuffer(raw,np.uint8).reshape(nz,ny,nx)
    for z in range(1,nz):
        np.add(values[z],values[z-1],out=values[z])
    assert hashlib.sha256(raw).hexdigest()==part['rawSha256']
    volumes[key]={'decodedBytes':len(raw),'expectedDownloadBytes':level['compressedBytes'],'exactDecodedChecksum':True}
    del raw,values,encoded

anatomy=json.loads(get('assets/anatomy/manifest.json'))
assert anatomy['revision']=='continuity-gated-v5'
labels=decode_gzip(get(anatomy['volumeUrl']))
assert len(labels)==anatomy['decodedBytes'] and hashlib.sha256(labels).hexdigest()==anatomy['sha256']
flow=json.loads(get('assets/flow-views-v5.json'))
assert len(flow['presets'])==8
textures={}
for preset in flow['presets']:
    item=preset['texture']
    data=get(item['url'])
    assert data==(root/'public'/item['url'].lstrip('./')).read_bytes()
    textures[preset['id']]=len(data)
result={'verified':True,'updatedInterface':True,'modules':modules,'volumes':volumes,'anatomyRevision':anatomy['revision'],'anatomyExactDecodedChecksum':True,'flowPresetCount':8,'flowTextureBytes':textures,'scope':'Read-only production HTML and asset/decoded-byte checks; not interactive browser QA.'}
report=pathlib.Path(access['reportPath'])
report.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result),flush=True)
