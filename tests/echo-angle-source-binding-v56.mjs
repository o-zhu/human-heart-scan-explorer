/** Real MP4 cache/object-URL delivery with controlled video metadata events.
 * Usage: node tests/echo-angle-source-binding-v56.mjs /path/to/linkedom/esm/index.js [public-fixture-root]
 * Missing licensed MP4 fixtures explicitly skip this check in public clones;
 * supply the verified public-fixture-root to run it. No browser decoding claim. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {EchoModule} from '../public/echo.js';
import {EchoMediaCache} from '../public/echo-media-cache.js';
import {supplementalTeeAngle} from '../public/echo-reference-player.js';
import {TEE_ATLAS_VIEWS} from '../public/tee-atlas-data.js';

const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const {document,window}=parseHTML('<html><head></head><body><main id="echoPanel"></main></body></html>');
Object.assign(globalThis,{document,window,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(value){this._value=String(value);}});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const json=path=>JSON.parse(readFileSync(new URL(`../public/assets/${path}`,import.meta.url)));
const locals=json('echo-media-v6.json').clips,publisher=json('tee-atlas/media.json').clips;
const four=locals.find(source=>source.id==='tee-me4c'),two=locals.find(source=>source.id==='tee-me2c');
const publisherFour=publisher.find(source=>source.id==='ase-2013-tee-02');
const missing=publisher.find(source=>source.id==='ase-2013-tee-01'),native=publisher.find(source=>source.id==='ase-2013-tee-03');
const fixtureRoot=process.argv[3]||fileURLToPath(new URL('../public/',import.meta.url));
const absent=[four,two].filter(source=>!existsSync(resolve(fixtureRoot,source.url)));
if(absent.length){console.log(`SKIP source binding v56: omitted licensed MP4 fixtures (${absent.map(source=>source.id).join(', ')}). Supply a verified public-fixture-root or run in the full source checkout.`);process.exit(0);}
const bodies=new Map([four,two].map(source=>[source.url,readFileSync(resolve(fixtureRoot,source.url))]));
const requests=[];let releaseOld;
const oldDownload=new Promise(resolve=>{releaseOld=resolve;});
const cache=new EchoMediaCache({fetcher:async url=>{
 requests.push(url);
 // Deliberately let a superseded fetch resolve after cancellation. Production
 // cache and controller identities must reject it before source installation.
 if(url===two.url)await oldDownload;
 const body=bodies.get(url);assert.ok(body,`Unexpected fixture request ${url}`);
 return new Response(body,{status:200,headers:{'Content-Length':String(body.length)}});
}});
const renderer={settings:{palette:4,threshold:.28,cleanupEnabled:true},requestRender(){},clearCapData(){},set(){}};
const echo=new EchoModule({renderer,mount:document.getElementById('echoPanel')});
echo.mediaCache.destroy();echo.mediaCache=cache;
const video=echo.$('cine-video'),screen=echo.mount.querySelector('.echo-cine-screen');
let loads=0;
video.pause=()=>{video.paused=true;};video.load=()=>{loads++;video.readyState=0;video.error=null;};video.play=()=>Promise.resolve();
Object.defineProperty(video,'src',{get(){return video.getAttribute('src');},set(value){video.setAttribute('src',value);}});
Object.defineProperties(screen,{clientWidth:{value:640},clientHeight:{value:480}});
screen.getBoundingClientRect=()=>({left:0,top:0,width:640,height:480});
video.getBoundingClientRect=()=>({left:0,top:0,width:640,height:480});
const emit=type=>video.dispatchEvent(new window.Event(type));
const metadata=url=>{video.currentSrc=url;video.readyState=1;video.videoWidth=640;video.videoHeight=480;emit('loadedmetadata');};
const hidden=()=>echo.$('cine-angle').hidden||echo.$('cine-angle').style.visibility==='hidden';
const waitForCache=async()=>{if(cache.pending)await cache.pending.promise;await settle();};
const angleFor=source=>supplementalTeeAngle(TEE_ATLAS_VIEWS.find(view=>view.id===source.preset),source);
echo.active=true;echo.state={...echo.state,mode:'tee',preset:four.preset};
echo.setMediaCatalog({clips:[four,publisherFour,two,missing,native]});
await waitForCache();
const firstBlob=video.getAttribute('src'),firstRequest=echo.cineRequestId;
assert.match(firstBlob,/^blob:/);assert.notEqual(firstBlob,four.url);
assert.equal(echo.cineAngleSource.url,firstBlob);assert.equal(echo.cineAngleSource.requestId,firstRequest);
assert.deepEqual(new Uint8Array(await (await fetch(firstBlob)).arrayBuffer()),new Uint8Array(bodies.get(four.url)),'Object URL resolves to the real, hash-checked MP4 bytes');
assert.equal(hidden(),true,'A completed download is not decoded metadata');
metadata(four.url);assert.equal(hidden(),true,'Catalog-path metadata cannot stand in for the played Blob URL');
metadata(firstBlob);assert.equal(hidden(),false,'Four-chamber Blob metadata enables its supplemental dial');
assert.equal(echo.$('cine-angle-value').textContent,angleFor(four).label);
assert.equal(echo.cineFullFrame,false,'Fresh local selections use the default fit intent.');
assert.equal(video.classList.contains('is-framed'),false,'Local movies without reviewed crop metadata remain uncropped.');
assert.equal(echo.$('cine-fit').hidden,true,'An unreviewed crop is not offered for local ultrasound.');

const fitLoads=loads,fitRequests=requests.length;
echo.cineFullFrame=!echo.cineFullFrame;echo.updateCine();
assert.equal(hidden(),false);assert.equal(video.getAttribute('src'),firstBlob);
assert.equal(loads,fitLoads);assert.equal(requests.length,fitRequests,'Fit changes reuse the bound played source');

echo.state.preset=two.preset;echo.updateCine();
const staleDownload=cache.pending.promise.catch(error=>error);
assert.equal(hidden(),true,'A different selection hides the previous angle immediately');
metadata(firstBlob);assert.equal(hidden(),true,'A late previous-source metadata event cannot label a pending selection');
echo.state.preset=four.preset;echo.updateCine();await waitForCache();metadata(firstBlob);
assert.equal(hidden(),false);const restoredRequest=echo.cineRequestId;
releaseOld();const aborted=await staleDownload;assert.equal(aborted.name,'AbortError');await settle();
assert.equal(video.getAttribute('src'),firstBlob);assert.equal(echo.cineAngleSource.requestId,restoredRequest);
assert.equal(echo.$('cine-angle-value').textContent,angleFor(four).label,'Superseded download cannot relabel the current movie');

echo.cineFullFrame=true;echo.updateCine();
video.error={code:3};emit('error');assert.equal(hidden(),true);assert.equal(echo.cineAngleSource,null);
video.error=null;metadata(firstBlob);assert.equal(hidden(),true,'Late metadata cannot restore a failed source');
echo.startCine(four);await waitForCache();assert.equal(hidden(),true,'Cached retry waits for its own ready metadata');
assert.ok(echo.cineRequestId>restoredRequest);emit('loadedmetadata');assert.equal(hidden(),true,'Queued metadata with HAVE_NOTHING remains hidden');
metadata(firstBlob);assert.equal(hidden(),false,'Cached retry rebinds the actual Blob URL');
assert.equal(echo.cineFullFrame,true,'Retry preserves the current selection framing choice.');

echo.mediaSelection=publisherFour.id;echo.updateCine();metadata(publisherFour.url);
assert.equal(echo.cineFullFrame,false,'A different source in the same view returns to the default fit.');
assert.equal(video.classList.contains('is-framed'),true,'The publisher source uses its reviewed 1.4 crop.');
assert.equal(echo.$('cine-angle').hidden,true,'The publisher Four-Chamber movie keeps its native dial');
assert.equal(echo.$('cine-angle-note').hidden,true,'Switching source within one view removes the synthetic-angle note');
echo.mediaSelection=four.id;echo.updateCine();await waitForCache();metadata(firstBlob);
assert.equal(hidden(),false,'Switching back to local Four-Chamber restores its required supplement');

echo.state.preset=missing.preset;echo.updateCine();
assert.equal(hidden(),true);metadata(firstBlob);assert.equal(hidden(),true,'Old Blob metadata cannot satisfy an external source');
metadata(missing.url);assert.equal(hidden(),false);assert.equal(echo.cineAngleSource.url,missing.url);
assert.equal(echo.$('cine-angle-value').textContent,angleFor(missing).label);

echo.state.preset=native.preset;echo.updateCine();metadata(native.url);
assert.equal(angleFor(native),null,'Reviewed native commissural readout needs no synthetic dial');
assert.equal(echo.$('cine-angle').hidden,true);assert.equal(echo.$('cine-angle-note').hidden,true);
echo.leave();assert.equal(hidden(),true);assert.equal(echo.cineAngleSource,null);echo.destroy();
console.log('PASS source binding v56: real hash-checked MP4 Blob URL; four-chamber metadata; fit reuse; stale selection and late download rejection; error/late metadata; cached retry; same-view native/local switching and note cleanup; Blob-to-external transition; native commissural deduplication; teardown.');
