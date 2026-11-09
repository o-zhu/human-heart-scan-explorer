/** Actual Echo DOM/state; network, object URLs and native media APIs are mocked. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {EchoModule} from '../public/echo.js';
import {EchoMediaCache} from '../public/echo-media-cache.js';

const domPath=process.argv[2];
if(!domPath)throw new Error('Pass a test-only linkedom ESM entry point.');
const {parseHTML}=await import(pathToFileURL(domPath));
const {document,window}=parseHTML('<main id="echo"></main>');globalThis.document=document;
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._testValue??this.querySelector('option[selected]')?.value??this.querySelector('option')?.value??'';},set(value){this._testValue=String(value);}});
const renderer={settings:{palette:4,threshold:.28,cleanupEnabled:true},requestRender(){},clearCapData(){},set(){}};
const echo=new EchoModule({renderer,mount:document.getElementById('echo')});
const video=echo.$('cine-video');let plays=0,loads=0;
video.paused=true;video.ended=false;video.error=null;
video.pause=()=>{video.paused=true;};video.play=()=>{video.paused=false;plays++;return Promise.resolve();};video.load=()=>{loads++;video.error=null;video.currentTime=0;};
Object.defineProperty(video,'src',{get(){return video.getAttribute('src');},set(value){video.setAttribute('src',value);}});
echo.$('cine-loop').checked=true;
const calls=[],urls=new Map(),revoked=[];let serial=0;
echo.mediaCache=new EchoMediaCache({maxBytes:48,maxClipBytes:16,fetcher:(url,init)=>new Promise(resolve=>{
 const call={url,init,resolve,responded:false};calls.push(call);
 call.reply=({status=200}={})=>{call.responded=true;resolve(new Response(new Uint8Array(16).fill(calls.indexOf(call)+1),{status}));};
 call.start=()=>{call.responded=true;const stream=new ReadableStream({start(controller){call.controller=controller;},cancel(){call.cancelled=true;}});resolve(new Response(stream));};
}),createURL:blob=>{const url=`blob:echo-test-${++serial}`;urls.set(url,blob);return url;},revokeURL:url=>{assert.notEqual(video.src,url,'Never revoke the attached native source.');revoked.push(url);urls.delete(url);}});
const sourceCatalog=JSON.parse(await readFile('public/assets/echo-media-v6.json','utf8'));
const catalog={...sourceCatalog,clips:sourceCatalog.clips.map(clip=>({...clip,bytes:16,sha256:undefined}))};
const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
const last=()=>calls.at(-1);
const checkClip=preset=>assert.equal(last().url,catalog.clips.find(clip=>clip.preset===preset).url);
const click=name=>echo.$(name).dispatchEvent(new window.Event('click'));
const change=(name,value)=>{echo.$(name).value=value;echo.$(name).dispatchEvent(new window.Event('change'));};

echo.setMediaCatalog(catalog);assert.equal(calls.length,0);assert.equal(loads,0,'Inactive modules must not transfer movies.');
echo.enter();assert.equal(calls.length,1);checkClip('a4c');assert.equal(video.src,null);assert.equal(plays,0);
assert.equal(video.muted,true);assert.ok(video.hasAttribute('controls'));assert.ok(video.hasAttribute('playsinline'));assert.equal(video.hasAttribute('autoplay'),false);
assert.match(document.querySelector('.echo-cine-separation').textContent,/Different person/);
last().start();last().controller.enqueue(new Uint8Array(8));await settle();assert.match(echo.$('cine-status').textContent,/50%/);
video.error={code:4};video.dispatchEvent(new window.Event('error'));assert.equal(echo.$('cine-retry').hidden,true,'A source-clearing error cannot fail a pending replacement.');
last().controller.enqueue(new Uint8Array(8));last().controller.close();await settle();
assert.match(video.src,/^blob:/);assert.equal(plays,0);assert.equal(video.paused,true);assert.match(echo.$('cine-status').textContent,/Entire movie loaded/);
assert.equal(urls.get(video.src).size,16);assert.equal(urls.get(video.src).type,'video/mp4');

await video.play();echo.selectPreset('melax');checkClip('melax');assert.equal(video.src,null);assert.equal(video.paused,true);assert.match(echo.$('cine-description').textContent,/color Doppler/);
const obsolete=last();echo.selectPreset('me2c');checkClip('me2c');assert.equal(obsolete.init.signal.aborted,true);
obsolete.reply();await settle();assert.equal(video.src,null,'A late older fetch cannot install its source.');
last().reply();await settle();assert.equal(echo.cineLoadedId,'tee-me2c');assert.equal(plays,2,'Explicitly started playback survives rapid replacement.');
const previousLoads=loads,previousCalls=calls.length;echo.state.offsetMm=.5;echo.updateCine();
assert.equal(loads,previousLoads);assert.equal(calls.length,previousCalls);assert.match(echo.$('cine-match').textContent,/ADJUSTED/);

video.pause();echo.selectPreset('bicaval');last().reply();await settle();assert.equal(video.paused,true);assert.equal(plays,2,'A deliberately paused movie stays paused on replacement.');
echo.selectPreset('me4c');const abandoned=last();echo.leave();assert.equal(abandoned.init.signal.aborted,true);assert.equal(video.src,null);abandoned.reply();await settle();assert.equal(video.src,null);assert.equal(plays,2);
const beforeReentry=calls.length;echo.enter();assert.equal(calls.length,beforeReentry+1,'An aborted selection retries on reentry.');last().reply();await settle();assert.equal(video.paused,true);
await video.play();echo.leave();const cachedCount=calls.length;echo.enter();await settle();assert.equal(calls.length,cachedCount,'A complete cached movie needs no transfer on reentry.');assert.equal(video.paused,true);assert.equal(plays,3,'Reentry never resumes old play intent.');

echo.selectPreset('meavsax');assert.equal(video.hidden,true);assert.equal(video.src,null);assert.match(echo.$('cine-match').textContent,/NO EXACT/);
change('cine-select','tee-me4c');await settle();assert.equal(video.hidden,false);assert.match(echo.$('cine-match').textContent,/DIFFERENT/);assert.equal(echo.cineLoadedId,'tee-me4c');
change('cine-rate','0.5');assert.equal(video.playbackRate,.5);echo.$('cine-loop').checked=false;echo.$('cine-loop').dispatchEvent(new window.Event('change'));assert.equal(video.loop,false);
click('cine-expand');assert.ok(echo.mount.classList.contains('echo-cine-expanded'));

change('cine-select','tee-melax');const warnings=[];const originalWarn=console.warn;console.warn=(...args)=>warnings.push(args);
try{
 last().reply({status:500});await settle();assert.equal(echo.$('cine-retry').hidden,false);assert.equal(video.hidden,true);assert.match(echo.$('cine-status').textContent,/unavailable/);
 const failedCalls=calls.length;echo.updateCine();assert.equal(calls.length,failedCalls,'Unrelated CT changes do not retry a failed movie repeatedly.');
 click('cine-retry');assert.equal(calls.length,failedCalls+1);last().reply();await settle();assert.equal(echo.cineLoadedId,'tee-melax');assert.equal(video.playbackRate,.5);assert.equal(video.loop,false);assert.equal(video.paused,true);
 video.error={code:4};video.dispatchEvent(new window.Event('error'));assert.equal(echo.$('cine-retry').hidden,false);const beforeRetry=calls.length;click('cine-retry');await settle();assert.equal(calls.length,beforeRetry);assert.equal(video.hidden,false);
 video.error=null;video.dispatchEvent(new window.Event('error'));assert.equal(echo.$('cine-retry').hidden,true,'A stale empty error is ignored.');
}finally{console.warn=originalWarn;}
assert.equal(warnings.length,1);assert.ok(echo.mediaCache.bytes<=48);assert.ok(urls.has(video.src));assert.ok(revoked.length>0,'Browsing exercises URL eviction.');
echo.selectPreset('a2c');const destroyedPending=last();echo.destroy();assert.equal(video.src,null);assert.equal(video.paused,true);assert.equal(urls.size,0);assert.equal(destroyedPending.init.signal.aborted,true);
destroyedPending.reply();await settle();assert.equal(urls.size,0,'Destruction blocks late URL recreation.');assert.equal(echo.active,false);
assert.equal(new Set(revoked).size,revoked.length,'Each retained URL is revoked once.');

const report={passed:true,scope:'Actual Echo template/state with controlled fetch streams, Blob URLs and native media APIs mocked. Browser playback and seeking are not claimed.',checks:[
 'Inactive module makes no movie request; first entry fetches only the selected movie and remains muted/paused.',
 'Partial download progress is visible; the native source becomes a complete video/mp4 Blob URL.',
 'Native controls and playsinline remain present; initial autoplay is absent.',
 'Rapid selection aborts obsolete transfers and ignores their late completion.',
 'User-started playback survives rapid replacements; deliberately paused playback stays paused.',
 'CT plane adjustments neither reload the independent movie nor reset playback.',
 'Leave aborts transfers and detaches the movie; late work cannot restore it.',
 'Reentry retries an aborted selection, reuses a complete cached movie, and remains paused.',
 'Color Doppler is identified; unavailable exact ME AV SAX is not silently substituted.',
 'Manual different-view selection is explicit; speed, loop and enlarge controls persist.',
 'Transfer and native playback errors expose a retry; unrelated CT changes do not trigger retry loops.',
 'LRU evictions never revoke an attached source and stay inside the byte budget.',
 'Destroy releases every URL exactly once and blocks late recreation.'
]};
await writeFile('docs/echo-v6/ui-validation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
