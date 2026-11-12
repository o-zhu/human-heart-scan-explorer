/** Production controller and media lifecycle, with an explicit fake player API.
 * This does not claim browser playback or physical iOS device verification. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createYouTubeReference,youtubeReferenceURL,supplementalTeeAngle} from '../public/echo-reference-player.js';
import {EchoModule} from '../public/echo.js';
import {TEE_ATLAS_VIEWS} from '../public/tee-atlas-data.js';
const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const teeSources=JSON.parse(readFileSync(new URL('../public/assets/tee-atlas/media.json',import.meta.url))).clips;
const {document,window}=parseHTML('<html><head></head><body><main id="echo"></main><div id="fixture"><iframe data-echo="cine-embed" hidden></iframe></div></body></html>');
Object.assign(globalThis,{document,window,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(value){this._value=String(value);}});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const players=[];
class Player{
 constructor(frame,{events}){this.frame=frame;this.events=events;this.muted=false;this.played=false;this.destroyed=false;this.stopped=false;this.state=-1;players.push(this);}
 mute(){this.muted=true;}
 playVideo(){this.played=true;}
 stopVideo(){this.stopped=true;}
 getPlayerState(){return this.state;}
 stateChange(state){this.state=state;this.events.onStateChange({data:state,target:this});}
 destroy(){this.destroyed=true;this.frame.remove();}
 ready(){this.events.onReady({target:this});}
}
window.YT={Player};
const selected={id:'one',title:'Source cine',url:'https://www.youtube-nocookie.com/embed/AbcDef012_-'};
const url=new URL(youtubeReferenceURL(selected.url,'https://heart.example'));
for(const [key,value] of Object.entries({autoplay:'1',mute:'1',enablejsapi:'1',playsinline:'1',origin:'https://heart.example'}))assert.equal(url.searchParams.get(key),value);
assert.throws(()=>youtubeReferenceURL('https://example.org/embed/AbcDef012_-'));
let selection='one',readies=0,errors=0,blocked=0;
const fixture=document.getElementById('fixture');
const start=(options={})=>createYouTubeReference({placeholder:fixture.querySelector('iframe'),selected,isCurrent:()=>selection==='one',onReady:()=>readies++,onBlocked:()=>blocked++,onError:()=>errors++,apiLoader:()=>Promise.resolve({Player}),...options});
const oldPlaceholder=fixture.querySelector('iframe'),first=start();await settle();
assert.notEqual(first.frame,oldPlaceholder);assert.equal(first.frame.onload,null);assert.equal(readies,0,'An iframe load is never player readiness.');
const firstPlayer=players.at(-1);selection='two';first.destroy();firstPlayer.ready();
assert.equal(readies,0);assert.equal(firstPlayer.destroyed,true);assert.equal(fixture.querySelector('iframe').hasAttribute('src'),false);
selection='one';const second=start();await settle();const secondPlayer=players.at(-1);
assert.notEqual(second.frame,first.frame);assert.notEqual(second.frame.id,first.frame.id);
secondPlayer.ready();assert.equal(readies,1);assert.equal(secondPlayer.muted,true);assert.equal(secondPlayer.played,true);assert.equal(second.frame.style.opacity,'1');
secondPlayer.events.onAutoplayBlocked();assert.equal(blocked,1);assert.equal(readies,1);
second.destroy();
const timeout=start({timeoutMs:5});await settle();const timeoutPlayer=players.at(-1);await new Promise(resolve=>setTimeout(resolve,12));
assert.equal(errors,1);timeoutPlayer.ready();assert.equal(readies,1,'Late readiness cannot undo a timeout fallback.');timeout.destroy();
const failing=start();await settle();const failingPlayer=players.at(-1);failingPlayer.events.onError({data:153});failingPlayer.ready();
assert.equal(errors,2);assert.equal(readies,1);failing.destroy();

// API readiness and an autoplay request are not proof that video data arrived.
const waitForWatchdog=()=>new Promise(resolve=>setTimeout(resolve,20));
const stalled=start({playbackTimeoutMs:8});await settle();const stalledPlayer=players.at(-1);stalledPlayer.ready();
const beforeStall=errors,afterReady=readies;await waitForWatchdog();
assert.equal(errors,beforeStall+1);assert.equal(stalledPlayer.stopped,true);assert.equal(stalledPlayer.destroyed,true);
assert.equal(fixture.querySelector('iframe').hasAttribute('src'),false);assert.equal(fixture.querySelector('iframe').hidden,true);
stalledPlayer.ready();stalledPlayer.stateChange(1);assert.equal(readies,afterReady,'Late success cannot undo a playback-start failure.');stalled.destroy();

const buffering=start({playbackTimeoutMs:15});await settle();const bufferingPlayer=players.at(-1);bufferingPlayer.ready();bufferingPlayer.stateChange(1);
const beforeBuffer=errors;await waitForWatchdog();assert.equal(errors,beforeBuffer,'Playing cancels the start watchdog.');
bufferingPlayer.stateChange(3);await new Promise(resolve=>setTimeout(resolve,10));bufferingPlayer.stateChange(3);await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(errors,beforeBuffer+1,'Repeated buffering events cannot restart the bounded deadline.');assert.equal(bufferingPlayer.stopped,true);buffering.destroy();

for(const state of [0,2,5]){
 const idle=start({playbackTimeoutMs:8});await settle();const idlePlayer=players.at(-1);idlePlayer.ready();idlePlayer.stateChange(3);idlePlayer.stateChange(state);
 const beforeIdle=errors;await waitForWatchdog();assert.equal(errors,beforeIdle,`Idle state ${state} must not fail.`);assert.equal(idlePlayer.destroyed,false);idle.destroy();
}
const queuedPause=start({playbackTimeoutMs:8});await settle();const queuedPlayer=players.at(-1);queuedPlayer.ready();queuedPlayer.state=2;
const beforeQueued=errors;await waitForWatchdog();assert.equal(errors,beforeQueued,'A pause whose event is still queued must not fail.');queuedPause.destroy();
const denied=start({playbackTimeoutMs:8});await settle();const deniedPlayer=players.at(-1);deniedPlayer.ready();deniedPlayer.events.onAutoplayBlocked();deniedPlayer.stateChange(3);
const beforeDenied=errors;await waitForWatchdog();assert.equal(errors,beforeDenied,'Blocked autoplay, including a queued buffering event, waits for the user.');
deniedPlayer.stateChange(1);deniedPlayer.stateChange(3);await waitForWatchdog();assert.equal(errors,beforeDenied+1,'Once playback begins, subsequent buffering is bounded again.');denied.destroy();
const disposed=start({playbackTimeoutMs:8});await settle();const disposedPlayer=players.at(-1);disposedPlayer.ready();disposed.destroy();
const beforeDisposed=errors;await waitForWatchdog();assert.equal(errors,beforeDisposed,'Leaving cancels both watchdogs.');assert.equal(disposedPlayer.stopped,true);

const renderer={settings:{palette:4,threshold:.28,cleanupEnabled:true},requestRender(){},clearCapData(){},set(){}};
const echo=new EchoModule({renderer,mount:document.getElementById('echo')});
const video=echo.$('cine-video');let plays=0,loads=0,rejectAutoplay=false;
video.pause=()=>{video.paused=true;};video.load=()=>{loads++;video.error=null;video.readyState=0;};video.play=()=>{plays++;return rejectAutoplay?Promise.reject(Object.assign(new Error('Blocked'),{name:'NotAllowedError'})):Promise.resolve();};
Object.defineProperty(video,'src',{get(){return video.getAttribute('src');},set(value){video.setAttribute('src',value);}});
echo.active=true;echo.state={...echo.state,mode:'tee',preset:'me5c'};
const clip=teeSources.find(source=>source.id==='ase-2013-tee-01');
echo.setMediaCatalog({clips:[clip]});
assert.equal(plays,1);assert.equal(video.muted,true);assert.equal(video.defaultMuted,true);assert.equal(video.autoplay,true);assert.equal(video.hasAttribute('playsinline'),true);
assert.equal(video.classList.contains('is-framed'),true,'A reviewed reference opens in Fit Ultrasound.');
assert.equal(echo.$('cine-fit').textContent,'Full Frame');
assert.equal(echo.cineLoadedId,null,'A URL assignment is not evidence of a decoded frame.');
video.dispatchEvent(new window.Event('loadeddata'));assert.equal(echo.cineLoadedId,clip.id);
assert.equal(echo.$('cine-visible-source').getAttribute('href'),clip.sourceUrl);
assert.equal(echo.$('cine-angle').hidden,false);assert.equal(echo.$('cine-angle-value').textContent,'5°');assert.match(echo.$('cine-angle-note').textContent,/range 0–10°/);assert.match(echo.$('cine-angle-note').textContent,/not a measured angle from this recording/);
const priorLoads=loads;
echo.$('cine-fit').click();assert.equal(video.classList.contains('is-framed'),false,'Full Frame remains an explicit option.');
assert.equal(echo.$('cine-fit').textContent,'Fit Ultrasound');
echo.updateCine();assert.equal(loads,priorLoads,'Unrelated plane updates preserve playback.');
echo.setMediaCatalog({clips:[{...clip}]});
assert.equal(video.classList.contains('is-framed'),false,'A refresh of the same source preserves the explicit Full Frame choice.');
assert.equal(loads,priorLoads,'Fit changes and same-source catalog refresh do not reload the movie.');
echo.selectPreset(clip.preset);
assert.equal(video.classList.contains('is-framed'),true,'Explicitly selecting a view starts with Fit Ultrasound, including the same view.');
assert.equal(loads,priorLoads,'Reselecting the same view need not reload its movie.');
echo.$('cine-fit').click();
echo.mount.querySelector('[data-reference="back"]').scrollIntoView=()=>{};
echo.openReferenceView();
assert.equal(video.classList.contains('is-framed'),true,'Reopening detail starts with Fit Ultrasound.');
assert.equal(loads,priorLoads,'Reopening an active source preserves playback.');
echo.$('cine-fit').click();
echo.setMediaCatalog({clips:[{...clip,url:'https://publisher.example/revised.mp4'}]});assert.equal(plays,2,'Same-id catalog corrections still replace the actual source.');
assert.equal(video.classList.contains('is-framed'),true,'A replacement source resets the prior Full Frame choice.');
assert.equal(echo.$('cine-angle').hidden,true,'A same-id replacement URL cannot inherit the old source review');assert.equal(echo.$('cine-angle-note').hidden,true);
video.error=null;video.dispatchEvent(new window.Event('error'));assert.equal(echo.$('cine-retry').hidden,true,'A queued empty media error cannot fail the replacement.');
rejectAutoplay=true;echo.startCine({...clip,url:'https://publisher.example/retry.mp4'});await settle();assert.match(echo.$('cine-status').textContent,/press Play/);
echo.state.preset='memodbicaval';echo.setMediaCatalog({clips:[teeSources.find(source=>source.id==='ase-2013-tee-12')]});
assert.equal(echo.$('cine-angle-value').textContent,'60°');assert.match(echo.$('cine-angle-note').textContent,/range 50–70°/);
// Exercise every selected source through the real controller, including the
// zero-degree RPV view. Metadata is fixture state, not a playback assertion.
const screen=echo.mount.querySelector('.echo-cine-screen');
Object.defineProperties(screen,{clientWidth:{value:640,configurable:true},clientHeight:{value:480,configurable:true}});
screen.getBoundingClientRect=()=>({left:0,top:0,width:640,height:480});
video.getBoundingClientRect=()=>({left:0,top:0,width:640,height:480});
for(const view of TEE_ATLAS_VIEWS){
 echo.state.preset=view.id;
 const source=teeSources.find(source=>source.preset===view.id);
 echo.setMediaCatalog({clips:[source]});
 assert.equal(video.classList.contains('is-framed'),true,`${view.id}: a new publisher selection uses its reviewed fit`);
 video.readyState=1;video.videoWidth=1280;video.videoHeight=720;video.currentSrc=source.url;
 video.dispatchEvent(new window.Event('loadedmetadata'));
 const expected=supplementalTeeAngle(view,source);
 if(expected){
  assert.equal(echo.$('cine-angle').hidden,false,view.id);
  assert.equal(echo.$('cine-angle').style.visibility,'visible',`${view.id}: metadata reveals the angle`);
  assert.equal(echo.$('cine-angle-value').textContent,expected.label,view.id);
  assert.equal(echo.$('cine-angle').querySelector('[data-multiplane="indicator"]').getAttribute('aria-label'),expected.explanation);
  assert.equal(echo.$('cine-angle-pointer').getAttribute('x2'),String(expected.x));
  assert.equal(echo.$('cine-angle-pointer').getAttribute('y2'),String(expected.y));
 }else{
  assert.equal(echo.$('cine-angle').hidden,true,`${view.id}: native or unreviewed source gets no duplicate overlay`);
  assert.equal(echo.$('cine-angle-note').hidden,true,`${view.id}: no misleading synthetic-angle note`);
 }
 echo.$('cine-fit').click();
 assert.equal(video.classList.contains('is-framed'),false,`${view.id}: Full Frame remains available`);
}
const retryLoads=loads;echo.$('cine-retry').click();
assert.ok(loads>retryLoads,'An explicit retry restarts the current source.');
assert.equal(video.classList.contains('is-framed'),false,'Retry preserves the explicit Full Frame choice for that source.');
assert.equal(echo.$('cine-fit').textContent,'Fit Ultrasound');
echo.state={...echo.state,mode:'tte',preset:'a4c'};echo.setMediaCatalog({clips:[{...selected,preset:'a4c',mode:'tte',kind:'youtube',sourceUrl:clip.sourceUrl}]});await settle();
const embedded=echo.$('cine-embed'),embeddedPlayer=players.at(-1);assert.equal(echo.$('cine-angle').hidden,true);assert.equal(echo.$('cine-empty').hidden,false);
embedded.dispatchEvent(new window.Event('load'));assert.equal(echo.cineLoadedId,null);
embeddedPlayer.ready();assert.equal(echo.cineLoadedId,selected.id);assert.equal(echo.$('cine-empty').hidden,true);
echo.leave();embeddedPlayer.events.onError();assert.equal(echo.$('cine-embed').hasAttribute('src'),false);assert.equal(echo.$('cine-embed').hidden,true);assert.equal(echo.cineLoadedId,null);
echo.destroy();
console.log('PASS source-player v39: fresh iframe identity; actual API readiness; bounded playback-start and repeated buffering; stopped/destroyed failed players; pause/cue/end/blocked-autoplay exemptions; queued state events; stale selection/timeout/error rejection; same-id URL replacement; Fit defaults and per-selection Full Frame choice without reload; visible attribution; selected-source angle policy honored across all 28 TEE references.');
