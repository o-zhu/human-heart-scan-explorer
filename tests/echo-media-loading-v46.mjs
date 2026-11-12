/** Production media selection and player transitions. LinkeDOM controls media
 * transport; the fixed-box assertions are layout contracts, not browser CLS. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {localEchoReference,preferredEchoReference} from '../public/echo-reference-player.js';
import {EchoModule} from '../public/echo.js';

const catalog=name=>JSON.parse(readFileSync(new URL(`../public/assets/${name}`,import.meta.url)));
const local=catalog('echo-media-v6.json').clips;
const tte=catalog('tte-atlas/media.json').clips;
const tee=catalog('tee-atlas/media.json').clips;
const clips=[...tte,...tee,...local];
const expected=[...['plax','psax_papillary','a4c','a2c','a3c','subcostal'].map(preset=>({mode:'tte',preset})),...['me4c','melax','me2c','bicaval'].map(preset=>({mode:'tee',preset}))];
for(const view of expected){
 const selected=preferredEchoReference(clips,view);
 assert.equal(selected.id,`${view.mode}-${view.preset}`);
 assert.equal(selected.correspondence.kind,'named-view');
 assert.equal(readFileSync(new URL(`../public/${selected.url.slice(2)}`,import.meta.url)).length,selected.bytes,'The preferred clip is actually present at its catalog size.');
}
const approved=local.find(clip=>clip.id==='tte-a4c'),remote=tte.find(clip=>clip.preset==='a4c'&&clip.kind==='youtube');
for(const mutation of [
 {external:true},{license:'CC BY-NC 4.0'},{url:'https://other.example/a4c.mp4'},
 {correspondence:{sourceLabelVerified:true,kind:'broader-view'}},
 {correspondence:{sourceLabelVerified:false,kind:'named-view'}},{sha256:''},{bytes:5*1024*1024},
])assert.equal(preferredEchoReference([remote,{...approved,...mutation}],{mode:'tte',preset:'a4c'}),remote);
for(const preset of ['plax_deep','plax_av','plax_mv','a4c_lv','a4c_rv','a4c_cs','a4c_la_pv','a2c_lv','a3c_lv','psax_mitral'])assert.equal(localEchoReference(clips,{mode:'tte',preset}),null,'Local defaults must not turn a standard view into a specialized acquisition.');
assert.equal(localEchoReference(clips,{mode:'tee',preset:'tgpapillary'}),null,'The broader TG example is not an exact midpapillary substitute.');
assert.equal(localEchoReference(clips,{mode:'tte',preset:'me4c'}),null);
assert.match(preferredEchoReference(clips,{mode:'tee',preset:'melax'}).title,/color Doppler/i);

const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const {document,window}=parseHTML('<html><head></head><body><main id="echo"></main></body></html>');
Object.assign(globalThis,{document,window,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(value){this._value=String(value);}});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const players=[];
class Player{
 constructor(frame,{events}){this.frame=frame;this.events=events;this.state=-1;players.push(this);}
 mute(){} playVideo(){} stopVideo(){this.stopped=true;} destroy(){this.destroyed=true;this.frame.remove();}
 getPlayerState(){return this.state;}
 ready(){this.events.onReady({target:this});}
 stateChange(state){this.state=state;this.events.onStateChange({target:this,data:state});}
}
window.YT={Player};
const renderer={settings:{palette:4,threshold:.28,cleanupEnabled:true},requestRender(){},clearCapData(){},set(){}};
const echo=new EchoModule({renderer,mount:document.getElementById('echo')});
const video=echo.$('cine-video');
video.pause=()=>{video.paused=true;};video.load=()=>{};video.play=()=>Promise.resolve();
Object.defineProperty(video,'src',{get(){return video.getAttribute('src');},set(value){video.setAttribute('src',value);}});
const requests=[];
echo.mediaCache.fetcher=async url=>{
 requests.push(url);
 assert.ok(url.startsWith('./assets/echo-media-v'),'Only a selected local movie may be downloaded.');
 const data=readFileSync(new URL(`../public/${url.slice(2)}`,import.meta.url));
 return new Response(data,{headers:{'content-length':String(data.length)}});
};
echo.active=true;echo.state={...echo.state,mode:'tte',preset:'a4c'};
const slot=echo.mount.querySelector('.echo-cine-status-slot'),status=echo.$('cine-loading');
const sameSlot=()=>{assert.equal(status.parentNode,slot);assert.equal(slot.hidden,false);assert.equal(echo.mount.querySelectorAll('.echo-cine-status-slot').length,1);};
try{
 echo.setMediaCatalog({clips});
 await echo.mediaCache.pending?.promise;await settle();
 assert.equal(echo.mediaSelection,'tte-a4c');assert.deepEqual(requests,[approved.url]);
 assert.equal(players.length,0,'The local default must not start a remote player.');
 assert.equal(document.head.querySelectorAll('[data-echo-preconnect]').length,0,'No speculative YouTube connection on a local-loop visit.');
 assert.equal(echo.$('cine-visible-source').getAttribute('href'),approved.sourceUrl);
 assert.equal(echo.$('cine-license').getAttribute('href'),approved.licenseUrl);
 assert.equal(echo.$('cine-guideline').hidden,false,'The acquisition guideline remains available with a local example.');
 const available=echo.$('cine-select').querySelectorAll('option');
 assert.equal(available.length,clips.filter(clip=>clip.mode==='tte'&&clip.preset==='a4c').length,'All source alternatives stay selectable.');
 sameSlot();

 echo.$('cine-select').value=remote.id;echo.$('cine-select').dispatchEvent(new window.Event('change'));
 await settle();
 const player=players.at(-1),frame=echo.$('cine-embed');
 assert.equal(echo.mediaSelection,remote.id);assert.equal(echo.$('cine-fallback').hidden,false);
 assert.equal(frame.style.position,'absolute');assert.equal(frame.style.width,'100%');assert.equal(frame.style.height,'100%');assert.equal(frame.style.minHeight,'0');
 assert.equal(document.head.querySelectorAll('[data-echo-preconnect]').length,3);
 sameSlot();player.ready();sameSlot();player.stateChange(1);assert.equal(status.hidden,true);sameSlot();
 player.stateChange(3);assert.equal(status.hidden,false);sameSlot();
 echo.setMediaCatalog({clips,incompleteSources:[]});
 assert.equal(echo.mediaSelection,remote.id,'Catalog recovery preserves an explicitly selected remote source.');
 assert.equal(players.at(-1),player,'Unchanged selected media does not restart on catalog refresh.');
 player.events.onError();assert.equal(echo.$('cine-retry').hidden,false);assert.equal(echo.$('cine-fallback').hidden,false);sameSlot();
 echo.$('cine-retry').dispatchEvent(new window.Event('click'));await settle();
 const retried=players.at(-1);assert.notEqual(retried,player);assert.notEqual(retried.frame,frame);
 assert.equal(retried.frame.style.width,'100%');assert.equal(retried.frame.style.height,'100%');
 assert.equal(document.head.querySelectorAll('[data-echo-preconnect]').length,3,'Retries reuse the same connection hints.');sameSlot();
 echo.$('cine-fallback').dispatchEvent(new window.Event('click'));await settle();
 assert.equal(echo.mediaSelection,'tte-a4c');assert.equal(retried.stopped,true);assert.equal(retried.destroyed,true);
 assert.equal(requests.length,1,'The selected local fallback reuses its verified cached bytes.');
 const statusText=echo.$('cine-status').textContent;retried.ready();retried.stateChange(1);retried.events.onError();
 assert.equal(echo.mediaSelection,'tte-a4c');assert.equal(echo.$('cine-status').textContent,statusText,'Late remote events cannot overwrite the local fallback.');sameSlot();

 echo.state={...echo.state,mode:'tee',preset:'melax'};echo.setMediaCatalog({clips});await echo.mediaCache.pending?.promise;await settle();
 assert.equal(echo.mediaSelection,'tee-melax');
 assert.match(echo.$('cine-select').querySelector('option[value="tee-melax"]').textContent,/Color Doppler/);
 assert.equal(video.classList.contains('is-framed'),false,'The native full-frame default is preserved.');
 assert.equal(echo.$('cine-angle').hidden,true,'No invented angle dial is added to a different source.');sameSlot();
}finally{echo.destroy();}
console.log('PASS media v46: ten licensed named-view defaults; specialized/sweep/NC exclusions; real local-byte delivery and cache reuse; no initial YouTube work; retained alternatives/attribution/guideline; explicit selection survives catalog refresh; bounded retry/fallback/stale-event behavior; stable frame and status-slot contracts; Doppler and full-frame semantics.');
