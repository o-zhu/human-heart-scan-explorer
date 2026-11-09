#!/usr/bin/env python3
"""Verify the final two-donor deployment using hidden-stdin Site service access.

Only root runs this after both data banks are uploaded and all upload routes are
read-only. Bounded concurrent GETs check exact deployed source/assets and four
R2 inventories. Empty PUT probes cannot satisfy the immutable upload manifests;
they verify the final 405 gate without creating or replacing any object.
No browser playback, pointer-lock or interactive-FPS claim is made.
"""
from __future__ import annotations
import concurrent.futures as futures
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import termios
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
MODULES=[
    'app.js','styles.css','donors.js','download-priority.js','appearance.js',
    'echo.js','echo.css','echo-texture-worker.js','echo-media-cache.js',
    'flow-views.js','flow-views.css','hosted-ultra.js','section-detail.js',
    'ultra-sections.js','ultra-prefetch.js','ultra-cache-worker.js',
    'probe-lab.js','probe-lab.css','probe-geometry.js','probe-acoustics.js',
    'probe-acoustics-worker.js','renderer.js','ultra-volume.js',
    'ultra-volume-worker.js','ultra-volume-core.js','ultra-volume-backend.js',
    'volume-loader.js','volume-loader-worker.js','anatomy-data.js',
]
DONORS=[
    dict(id='ladaf-2021-17',specimen='LADAF-2021-17',spacing=79.4,
         manifest='assets/manifest.json',cleanup='assets/cleanup/manifest.json',
         anatomy='assets/anatomy/manifest.json',echoPlanes='assets/echo-planes.json',
         echo='assets/echo-textures.json',flow='assets/flow-views-v5.json',
         ultra='assets/ultra-sections/manifest.json',fine='assets/ultra-volume-v7.json',
         ultraIndex='server/ultra-upload-index.json',fineIndex='server/ultra-volume-index-v7.json'),
    dict(id='ucl-zcr-2629',specimen='UCL-ZCR-2629',spacing=28.128,
         manifest='assets/donors/ucl-zcr-2629/manifest.json',
         cleanup='assets/donors/ucl-zcr-2629/cleanup/manifest.json',
         anatomy='assets/donors/ucl-zcr-2629/anatomy/manifest.json',
         echoPlanes='assets/donors/ucl-zcr-2629/echo-planes.json',
         echo='assets/donors/ucl-zcr-2629/echo-textures.json',
         flow='assets/donors/ucl-zcr-2629/flow-views.json',
         ultra='assets/donors/ucl-zcr-2629/ultra-sections.json',
         fine='assets/donors/ucl-zcr-2629/ultra-volume.json',
         ultraIndex='server/donors/ucl-zcr-2629/ultra-index.json',
         fineIndex='server/donors/ucl-zcr-2629/volume-index.json'),
]
SHA=lambda b:hashlib.sha256(b).hexdigest()


class VerificationError(Exception):
    """Messages include only known paths/statuses/check names, never response bodies."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


def require(condition,message):
    if not condition:raise VerificationError(message)


def access_from_stdin():
    fd=sys.stdin.fileno();previous=termios.tcgetattr(fd);hidden=termios.tcgetattr(fd)
    hidden[3]&=~termios.ECHO;termios.tcsetattr(fd,termios.TCSANOW,hidden)
    print('Ready for Site service access JSON on stdin (input is hidden).',flush=True)
    try:return json.loads(sys.stdin.readline())
    finally:termios.tcsetattr(fd,termios.TCSANOW,previous)


class Client:
    def __init__(self,access):
        self.origin=access['siteUrl'].rstrip('/')
        parsed=urllib.parse.urlsplit(self.origin)
        require(parsed.scheme=='https' and parsed.hostname and parsed.hostname.endswith('.chatgpt.site')
                and not parsed.username and not parsed.password and parsed.path in ('','/') and not parsed.query and not parsed.fragment,
                'The Site origin is invalid.')
        self.bearer=access['bearer']
        require(isinstance(self.bearer,str) and self.bearer,'Missing Site service access.')

    def url(self,path):
        require(isinstance(path,str) and '\\' not in path,'Invalid asset path.')
        url=urllib.parse.urljoin(self.origin+'/',path)
        parsed=urllib.parse.urlsplit(url);base=urllib.parse.urlsplit(self.origin)
        require((parsed.scheme,parsed.netloc)==(base.scheme,base.netloc), 'Asset attempted to leave the Site origin.')
        require(not parsed.username and not parsed.password,'Asset URL contains credentials.')
        return url

    def request(self,path,method='GET',extra_headers=None,body=None):
        url=self.url(path)
        headers={'OAI-Sites-Authorization':'Bearer '+self.bearer}
        headers.update(extra_headers or {})
        for attempt in range(3):
            request=urllib.request.Request(url,headers=headers,method=method,data=body)
            try:
                # A fresh opener per thread prevents redirect-handler sharing.
                with urllib.request.build_opener(NoRedirect()).open(request,timeout=55) as response:
                    data=response.read();return response.status,{k.lower():v for k,v in response.headers.items()},data
            except urllib.error.HTTPError as error:
                status=error.code
                # Do not inspect or print error bodies, which may contain an auth page.
                error.close()
                if status in (429,500,502,503,504) and attempt<2:
                    time.sleep(.4*(attempt+1));continue
                return status,{},b''
            except (urllib.error.URLError,TimeoutError,OSError):
                if attempt<2:time.sleep(.4*(attempt+1));continue
                raise VerificationError(f'{method} {path}: network request failed.') from None
        raise VerificationError(f'{method} {path}: retries exhausted.')

    def get(self,path):
        status,headers,data=self.request(path)
        require(status==200,f'GET {path}: expected 200, received {status}.')
        return headers,data

    def exact_local(self,path):
        headers,data=self.get(path)
        relative=urllib.parse.urlsplit(self.url(path)).path.lstrip('/')
        local=ROOT/'public'/relative
        require(local.is_file(),f'Local reference is missing: {relative}.')
        expected=local.read_bytes()
        require(data==expected,f'Deployed bytes differ from source: {relative}.')
        return headers,data


def parallel(items,fn,workers,label):
    results=[]
    with futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for result in pool.map(fn,items):
            results.append(result)
    print(json.dumps({'stage':label,'verifiedItems':len(results)}),flush=True)
    return results


def selected(items,count=4):
    items=list(items)
    if len(items)<=count:return items
    return [items[round(i*(len(items)-1)/(count-1))] for i in range(count)]


def run(access):
    started=time.monotonic();client=Client(access)
    workers=max(1,min(12,int(access.get('workers',10))))
    result={'verified':False,'scope':'Production HTTP, exact deployed source/assets, four immutable-bank inventories, representative checksums and read-only gates. No browser playback, pointer-lock or interactive frame-rate assertion.'}
    _,html=client.get('/')
    for marker in [b'id="donorSelect"',b'id="probeTab"',b'id="probePanel"',b'id="scanDownloadBar"',b'id="ultraCacheStatus"']:
        require(marker in html,'Required interface control is absent: '+marker.decode())
    require(b'id="nativeTab"' not in html and b'id="nativePanel"' not in html,'The hidden full-resolution atlas is present.')
    require(html.index(b'id="echoTab"')<html.index(b'id="probeTab"'),'Echo windows must precede Probe lab.')
    option=re.search(rb'<option\b[^>]*value="ucl-zcr-2629"[^>]*>',html)
    require(option is not None and b'disabled' not in option.group(),'The new donor selector is not enabled.')
    result['interface']={'sourceSelector':True,'youngDonorEnabled':True,'echoBeforeProbe':True,'fullResolutionAtlasHidden':True}
    def module(name):
        _,data=client.exact_local(name)
        if name=='donors.js':require(b'ready:false' not in data.replace(b' ',b''),'A donor remains marked unavailable in the deployed catalog.')
        return name,{'bytes':len(data),'sha256':SHA(data),'exactSourceMatch':True}
    result['runtimeModules']=dict(parallel(MODULES,module,workers,'runtime-source'))

    metadata_tasks=[(donor['id'],key,donor[key]) for donor in DONORS for key in ['manifest','cleanup','anatomy','echoPlanes','echo','flow','ultra','fine']]
    def metadata(task):
        donor,key,path=task;_,data=client.exact_local(path)
        try:parsed=json.loads(data)
        except (ValueError,UnicodeError):raise VerificationError('Invalid JSON in '+path) from None
        return donor,key,parsed
    metadata_results=parallel(metadata_tasks,metadata,workers,'source-manifests')
    documents={d['id']:{} for d in DONORS}
    for donor,key,document in metadata_results:documents[donor][key]=document
    assets=[];banks=[];donor_report={}
    for donor in DONORS:
        ident=donor['id'];m=documents[ident];spacing=donor['spacing']
        require(m['manifest']['specimen']==donor['specimen'],f'{ident}: primary manifest source identity differs.')
        require(m['cleanup']['specimen']==donor['specimen'] and m['anatomy']['specimen']==donor['specimen'],f'{ident}: cleanup/anatomy source identity differs.')
        require(m['ultra']['spacingUm']==spacing and m['fine']['sourceSpacingUm']==spacing,f'{ident}: fine source pitch differs.')
        require(m['echo']['sourceSpacingUm']==spacing and m['flow']['sourceSpacingUm']==spacing,f'{ident}: Echo/Flow fine source pitch differs.')
        require(len(m['echo']['textures'])==13,f'{ident}: expected 13 prepared Echo windows.')
        require(len(m['flow']['presets'])==8,f'{ident}: expected 8 Flow windows.')
        require(len(m['fine'].get('preparedPlanes',[]))==4,f'{ident}: expected 4 prepared Probe starts.')
        if ident=='ucl-zcr-2629':
            require(m['manifest']['donorAge']=='<18' and m['manifest']['donorMedicalInfo']=='Disease free','New donor metadata does not match the official record.')
            require(m['echoPlanes'].get('clinicalPresetsReviewed') is False and m['anatomy'].get('expertValidated') is False,'Provisional new-donor anatomy must remain labeled unvalidated.')
        def add(kind,name,path,record=None,decoded=None):
            assets.append({'donor':ident,'kind':kind,'name':name,'path':path,'record':record or {},'decoded':decoded})
        add('cleanup','support',m['cleanup']['volumeUrl'],{'bytes':m['cleanup']['compressedBytes'],'sha256':m['cleanup']['sha256']},
            {'bytes':math.prod(m['cleanup']['dimensions']),'values':[0,255]})
        add('anatomy','regions',m['anatomy']['volumeUrl'],{'bytes':m['anatomy']['compressedBytes'],'sha256':m['anatomy']['compressedSha256']},
            {'bytes':m['anatomy']['decodedBytes'],'sha256':m['anatomy']['sha256']})
        # One actual encoded part at both levels verifies density delivery without
        # downloading every original/unmasked fallback part.
        for level,record in m['manifest']['levels'].items():
            p=record['parts'][0];add('volume',level,p['url'],p)
        for name in ['a4c','plax','me4c']:
            item=m['echo']['textures'][name]
            require(item.get('sourceSpacingUm',item.get('spacingUm'))==spacing,f'{ident}: wrong Echo texture pitch.')
            add('echo',name,item['url'],item)
        for item in m['fine']['preparedPlanes']:
            require(item['sourceSpacingUm']==spacing,f'{ident}: wrong prepared Probe pitch.')
            add('probe',item['id'],item['url'],item)
        for name in ['rv-inflow','lv-outflow']:
            item=next(p for p in m['flow']['presets'] if p['id']==name)['texture']
            require(item.get('sourceSpacingUm',item.get('spacingUm'))==spacing,f'{ident}: wrong Flow texture pitch.')
            add('flow',name,item['url'],item)
        for kind,manifest_key,index_key in [('orthogonal','ultra','ultraIndex'),('density','fine','fineIndex')]:
            local_index=json.loads((ROOT/donor[index_key]).read_text())
            source=m[manifest_key]
            banks.append({'donor':ident,'kind':kind,'base':source['assetBaseUrl'],'index':local_index,'manifest':source})
        donor_report[ident]={'specimen':donor['specimen'],'fineSpacingUm':spacing,
            'detailedDimensionsXYZ':m['manifest']['levels']['high']['dimensions'],
            'echoWindows':len(m['echo']['textures']),'flowWindows':len(m['flow']['presets']),
            'preparedProbePlanes':len(m['fine']['preparedPlanes']),
            'clinicalPresetsReviewed':m['echoPlanes'].get('clinicalPresetsReviewed','existing annotated reference')}
    def verify_asset(task):
        headers,data=client.exact_local(task['path']);record=task['record']
        if 'bytes' in record:require(len(data)==record['bytes'],f'{task["path"]}: encoded length differs.')
        if 'sha256' in record:require(SHA(data)==record['sha256'],f'{task["path"]}: encoded checksum differs.')
        decoded=task['decoded']
        if decoded:
            require(not headers.get('content-encoding'),f'{task["path"]}: gzip bytes must remain opaque to HTTP.')
            try:raw=gzip.decompress(data)
            except Exception:raise VerificationError(f'{task["path"]}: gzip decoding failed.') from None
            require(len(raw)==decoded['bytes'],f'{task["path"]}: decoded length differs.')
            if 'sha256' in decoded:require(SHA(raw)==decoded['sha256'],f'{task["path"]}: decoded checksum differs.')
            if 'values' in decoded:require(set(raw).issubset(set(decoded['values'])),f'{task["path"]}: invalid support values.')
        return {'donor':task['donor'],'kind':task['kind'],'name':task['name'],'bytes':len(data),'sha256Verified':True}
    result['donorAssets']=parallel(assets,verify_asset,workers,'representative-donor-assets')
    result['donors']=donor_report

    def inventory(bank):
        _,data=client.get(bank['base']+'status')
        try:status=json.loads(data)
        except Exception:raise VerificationError(bank['base']+'status: invalid JSON.') from None
        expected=len(bank['index']);expected_bytes=sum(r['bytes'] for r in bank['index'].values())
        require(status.get('complete') is True and status.get('uploadsEnabled') is False,
                bank['base']+'status: the collection is incomplete or uploads remain enabled.')
        require(status.get('expected')==expected and status.get('verified')==expected and status.get('bytes')==expected_bytes,
                bank['base']+'status: inventory totals differ from local allowlist.')
        require(status.get('missingCount')==0 and status.get('mismatchCount')==0,
                bank['base']+'status: missing or mismatched objects.')
        return bank['donor']+':'+bank['kind'],{k:status[k] for k in ['complete','expected','verified','bytes','uploadsEnabled','missingCount','mismatchCount']}
    result['bankInventories']=dict(parallel(banks,inventory,4,'immutable-bank-inventories'))
    samples=[]
    for bank in banks:
        records=bank['index']
        if bank['kind']=='orthogonal':
            picks=[]
            for axis in 'xyz':
                candidates=[r for r in bank['manifest']['slices'][axis] if not r['empty']]
                require(bool(candidates),bank['base']+axis+': no nonempty slices.')
                picks.append(candidates[len(candidates)//2]['path'])
            picks.append(bank['manifest']['emptyPath'])
        else:picks=selected(list(records),4)
        for path in picks:samples.append((bank,path,records[path]))
    def bank_sample(task):
        bank,path,entry=task
        status,headers,data=client.request(bank['base']+path+'?v='+entry['sha256'][:16])
        require(status==200,bank['base']+path+f': expected 200, received {status}.')
        require(len(data)==entry['bytes'] and SHA(data)==entry['sha256'],bank['base']+path+': encoded checksum/size failed.')
        require(headers.get('x-content-sha256')==entry['sha256'],bank['base']+path+': integrity header mismatch.')
        require(not headers.get('content-encoding'),bank['base']+path+': asset must not carry HTTP content encoding.')
        if bank['kind']=='density':
            record=next(r for r in bank['manifest']['blocks'].values() if r['path']==path)
            try:decoded=gzip.decompress(data)
            except Exception:raise VerificationError(bank['base']+path+': density decompression failed.') from None
            require(len(decoded)==bank['manifest']['decodedBrickBytes'] and SHA(decoded)==record['rawSha256'],bank['base']+path+': decoded checksum failed.')
        return {'donor':bank['donor'],'kind':bank['kind'],'path':path,'bytes':len(data),'encodedSha256Verified':True,'decodedSha256Verified':bank['kind']=='density'}
    result['bankSamples']=parallel(samples,bank_sample,workers,'bank-object-samples')
    def gate(bank):
        path=next(iter(bank['index']))
        status,_,_=client.request(bank['base']+path,method='PUT',extra_headers={'Content-Type':'application/octet-stream','Content-Length':'0'},body=b'')
        require(status==405,bank['base']+': the final empty PUT probe did not return 405.')
        return bank['donor']+':'+bank['kind'],{'method':'PUT','bodyBytes':0,'status':405,'wroteData':False}
    result['readOnlyGates']=dict(parallel(banks,gate,4,'read-only-gates'))

    _,media_bytes=client.exact_local('assets/echo-media-v6.json');media=json.loads(media_bytes)
    require(len(media['clips'])==12,'Reference movie catalog must retain 12 clips.')
    # One TTE and one TEE reference checks each delivery path; metadata is exact
    # for the complete catalog. Their relationship to the donors remains distinct.
    clips=[media['clips'][0],media['clips'][-1]]
    def movie(clip):
        _,data=client.exact_local(clip['url']);require(len(data)==clip['bytes'] and SHA(data)==clip['sha256'],'Reference movie checksum differs: '+clip['id'])
        _,poster=client.exact_local(clip['poster']);require(len(poster)==clip['posterBytes'],'Reference movie poster size differs: '+clip['id'])
        return {'id':clip['id'],'bytes':len(data),'sha256Verified':True}
    result['referenceMovies']=parallel(clips,movie,2,'reference-movie-samples')
    result['referenceMovieCatalogCount']=len(media['clips'])
    result['verified']=True;result['elapsedSeconds']=round(time.monotonic()-started,2)
    return result


def main():
    access=access_from_stdin()
    report_path=Path(access['reportPath'])
    try:
        report=run(access)
    except VerificationError as error:
        report={'verified':False,'error':str(error),'scope':'Production HTTP/data verification stopped at the stated failure.'}
        report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report),flush=True);raise SystemExit(1) from None
    except Exception as error:
        # Unexpected exception values can contain remote data. Print the type
        # only; never interpolate auth input or an upstream response body.
        report={'verified':False,'error':'Unexpected verification failure: '+type(error).__name__}
        report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report),flush=True);raise SystemExit(1) from None
    report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)

if __name__=='__main__':main()
