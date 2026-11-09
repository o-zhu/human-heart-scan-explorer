/** State integration tests, without a browser or graphics context.
 * Usage: node scripts/verify-app-state-v6.mjs /path/to/linkedom/esm/index.js
 * The DOM dependency is test-only; no production dependency changes are needed.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {orthogonalFrame} from '../public/planes.js';
import {croppedSectionFrame} from '../public/section-layout.js';
import {DONORS,donorFromSearch,donorUrl,spacingLabel} from '../public/donors.js';

const domPath=process.argv[2];
if(!domPath)throw new Error('Pass the installed linkedom ESM entry point.');
const {parseHTML}=await import(pathToFileURL(domPath));
const html=await readFile('page.html','utf8');
const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\s*$/gm,'').replace(/\nmain\(\);\s*$/,'');
const reports=[];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

function environment(){
 const {document,window}=parseHTML(html);
 // linkedom models option selection but leaves select.value read-only.
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._testValue??this.querySelector('option[selected]')?.value??this.querySelector('option')?.value??'';},set(value){this._testValue=String(value);}});
 for(const name of ['echo','flow','probe']){const node=document.createElement('div');node.id=name+'ViewportMount';document.getElementById(name+'Panel').append(node);}
 const loader={requests:[],pending:null,load(level,options){this.pending?.reject(new DOMException('Superseded','AbortError'));const d=deferred();this.pending=d;this.requests.push({level,options,...d});return d.promise;},finish(index=this.requests.length-1){const req=this.requests[index];if(this.pending===req)this.pending=null;req.resolve({data:new Uint8Array(req.level.dimensions.reduce((a,b)=>a*b,1)),acceleration:null,gpuCrop:null,stats:{receivedBytes:1234}});},fail(){this.pending.reject(new Error('Deliberate load failure'));this.pending=null;}};
 const renderer={canvas:document.getElementById('volumeCanvas'),loaded:false,backend:'webgl2',settings:{palette:4,mode:0,threshold:.28,opacity:.8,clipAxis:-1,clipPosition:.5,clipFlip:0,showPlanes:0,cleanupEnabled:true,quality:'high',surfaceSmoothing:1,capContrast:1.8},camera:{yaw:.5,pitch:.2,roll:0,distance:1.5,pan:[0,0,0]},extent:[1,1,1],cap:null,uploads:0,alignments:0,load(data,meta){this.loaded=true;this.meta=meta;},set(values){Object.assign(this.settings,values);},requestRender(){},clearCapData(){this.cap=null;},setCapData(value){this.cap=value;this.uploads++;},alignPlane(){this.alignments++;},autoRotate:false};
 const appearance={changed(){},sync(){},load:()=>Promise.resolve()};
 const modules=Object.fromEntries(['echo','flow','probe'].map(name=>[name,{volumes:0,leaves:0,setVolume(){this.volumes++;},leave(){this.leaves++;},enter(){return Promise.resolve();}}]));
 const manifest={levels:{low:{dimensions:[3,3,3],spacingUm:635,supportCompressed:true},high:{dimensions:[5,5,5],spacingUm:317.6,supportCompressed:true}},defaultLevel:'high',previewLevel:'low'};
 const detailRequests=[];const SectionDetail=class{constructor(){this.manifest={sliceCounts:[5,5,5],spacingUm:158.8};}index(axis,value){return Math.round(value*4);}load(axis,index,options){const d=deferred();detailRequests.push({axis,index,options,...d});return d.promise;}};
 const ultra={manifest:{},listeners:[],requests:[],focus:[],entries:new Map(),paused:false,init(){return Promise.resolve(this);},subscribe(fn){this.listeners.push(fn);return()=>{};},setFocus(axis,index,options){this.focus.push({axis,index,...options});this.paused=false;},cached(axis,index){return this.entries.get(`${axis}:${index}`);},estimate(){return {estimatedBytes:1000};},getStatus(){return {paused:this.paused,active:0,plannedNeighbors:3,readyNeighbors:1};},pauseBackground(value=true){this.paused=value;},load(axis,index,options){const d=deferred();this.requests.push({axis,index,options,...d});return d.promise;},emit(event){for(const fn of this.listeners)fn(event);}};
 const cards=Array.from({length:3},()=>({paints:0,draw(){this.paints++;}}));const timers=[];
 const code=source+`\nreturn {
  loadLevel,setCleanupMode,switchTab,prepareUltra,setSlices,activateSection,refreshUltraCut,refreshDetailedSections,applySectionCap,
  configure(input){renderer=input.renderer;manifest=input.manifest;appearance=input.appearance;echoModule=input.echo;flowModule=input.flow;probeModule=input.probe;requestedLevel='high';postViewStarted=true;for(const mode of ['echo','flow','probe'])moduleReady.set(mode,Promise.resolve());},
  setupSections(){volumeData=new Uint8Array(125);volumeMeta=manifest.levels.high;renderer.loaded=true;slices=arguments[0];ultraSource=arguments[1];},
  state(){return {currentLevel,volumeOriginal,cleanupRequested,loading,currentTab,volumeData,activeAxis,slicePositions:[...slicePositions],settings:{...renderer.settings},camera:structuredClone(renderer.camera)};}
 };`;
 const api=new Function('document','window','location','SectionDetail','VolumeLoader','PALETTE_KEYS','setTimeout','clearTimeout','requestAnimationFrame','console','orthogonalFrame','croppedSectionFrame','DONORS','donorFromSearch','donorUrl','spacingLabel','HostedSectionStore','UltraVolumeSource','scanActivity',code)(document,window,{hash:''},SectionDetail,class{constructor(){return loader;}},['ivory','copper','grayscale','porcelain','contrast','anatomy'],(fn,ms)=>{timers.push({fn,ms});return timers.length;},()=>{},fn=>queueMicrotask(fn),{error(){},warn(){},info(){}},orthogonalFrame,croppedSectionFrame,DONORS,donorFromSearch,donorUrl,spacingLabel,class{},class{},{setViewerReady(){},beginForeground(){return()=>{};}});
 api.configure({renderer,manifest,appearance,...modules});return {api,loader,renderer,document,modules,ultra,cards,timers,detailRequests};
}

{
 const e=environment();const first=e.api.loadLevel('low',{preview:true,background:false});e.loader.finish();assert.equal(await first,true);
 assert.equal(e.api.state().settings.palette,4);assert.equal(e.document.getElementById('loading').hidden,true);
 const high=e.api.loadLevel('high',{background:true});assert.equal(e.document.getElementById('loading').hidden,true,'Background refinement must keep the view interactive.');
 e.loader.finish();assert.equal(await high,true);assert.equal(e.api.state().currentLevel,'high');
 reports.push('Preview then background refinement retain the visible viewer and Tissue / space.');
}
{
 const e=environment();let p=e.api.loadLevel('high');e.loader.finish();await p;
 p=e.api.setCleanupMode(false);await tick();assert.equal(e.loader.requests.at(-1).options.original,true);assert.equal(e.api.state().settings.cleanupEnabled,true);
 await e.api.setCleanupMode(true);e.loader.finish();await p;
 assert.equal(e.api.state().settings.cleanupEnabled,true);assert.equal(e.api.state().cleanupRequested,true);assert.equal(e.api.state().volumeOriginal,true);
 reports.push('An older original-scan request respects a newer Clean scan selection.');
}
{
 const e=environment();let p=e.api.loadLevel('high');e.loader.finish();await p;
 const old=e.api.setCleanupMode(false);await tick();const latest=e.api.loadLevel('low');await tick();
 assert.equal(await old,false);assert.equal(e.api.state().cleanupRequested,false,'An aborted earlier request must not reset cleanup intent.');
 assert.equal(e.loader.requests.at(-1).options.original,true);e.loader.finish();await latest;
 assert.equal(e.api.state().currentLevel,'low');assert.equal(e.api.state().settings.cleanupEnabled,false);assert.equal(e.api.state().volumeOriginal,true);
 reports.push('Changing scan resolution during original restoration keeps the newest resolution and cleanup intent.');
}
{
 const e=environment();let p=e.api.loadLevel('high');e.loader.finish();await p;
 p=e.api.setCleanupMode(false);e.loader.fail();assert.equal(await p,false);
 assert.equal(e.api.state().settings.cleanupEnabled,true);assert.equal(e.api.state().cleanupRequested,true);assert.equal(e.api.state().currentLevel,'high');
 assert.match(e.document.getElementById('cleanupStatus').textContent,/could not load/);
 reports.push('A failed original load preserves the usable clean volume and reports the failure.');
}
{
 const e=environment();e.renderer.loaded=true;const before=structuredClone(e.renderer.camera);const d=deferred();e.modules.flow.enter=()=>d.promise;
 const entered=e.api.switchTab('flow');assert.ok(entered instanceof Promise);assert.equal(e.api.state().currentTab,'flow');assert.equal(e.document.getElementById('viewport').parentElement.id,'flowViewportMount');
 d.resolve();await entered;e.renderer.settings.palette=5;e.renderer.settings.surfaceSmoothing=2;
 e.api.switchTab('reconstruction');assert.deepEqual(e.renderer.camera,before);assert.equal(e.renderer.settings.palette,5);assert.equal(e.renderer.settings.surfaceSmoothing,2);
 assert.notEqual(e.document.getElementById('viewport').parentElement.id,'flowViewportMount');
 reports.push('Flow entry is awaitable; returning restores reconstruction framing while preserving material and surface choices.');
}
function texture(axis,index){return {axis,index,key:`ultra:${axis}:${index}`,spacingUm:79.4,width:2,height:2,fullWidth:2,fullHeight:2,crop:[0,0,2,2],data:new Uint8Array([0,80,140,255]),encodedBytes:100};}
{
 const e=environment();e.api.setupSections(e.cards,e.ultra);await e.api.prepareUltra();e.api.activateSection(0,false);await tick();
 assert.equal(e.ultra.requests.length,1);assert.equal(e.ultra.requests[0].index,2);
 e.api.setSlices([.75,.5,.5]);await tick();
 assert.equal(e.ultra.requests.at(-1).index,3,'Current Ultra request starts without running the 85 ms card debounce.');
 assert.equal(e.ultra.requests[0].options.signal.aborted,true,'Superseded foreground consumer is canceled.');
 assert.deepEqual(e.ultra.focus.at(-1).positions,[3,2,2]);
 assert.ok(e.timers.some(t=>t.ms===85),'Card painting still uses its independent debounce.');
 const current=e.ultra.requests.at(-1);current.resolve(texture(0,3));await tick();assert.equal(e.renderer.cap.index,3);
 e.ultra.requests[0].resolve(texture(0,2));await tick();assert.equal(e.renderer.cap.index,3,'A stale download cannot replace the visible section.');
 reports.push('Viewed Ultra requests start immediately, canceled prior requests cannot win, and all visible source indices are passed to the scheduler.');
}
{
 const e=environment();e.api.setupSections(e.cards,e.ultra);await e.api.prepareUltra();
 e.ultra.entries.set('0:2',texture(0,2));e.ultra.entries.set('0:3',texture(0,3));
 e.ultra.entries.set('1:2',texture(1,2));e.ultra.entries.set('2:2',texture(2,2));
 e.api.activateSection(0,false);assert.equal(e.renderer.cap.index,2);assert.equal(e.ultra.requests.length,0);
 e.cards[1].cacheKey='retained-y-pixels';e.cards[2].cacheKey='retained-z-pixels';
 const before=e.renderer.uploads;e.api.setSlices([.75,.5,.5]);assert.equal(e.renderer.cap.index,3);assert.equal(e.renderer.uploads,before+1);
 assert.equal(e.cards[1].cacheKey,'retained-y-pixels');assert.equal(e.cards[2].cacheKey,'retained-z-pixels');
 e.api.applySectionCap(e.cards[0],0);e.ultra.emit({type:'ready',axis:0,index:3,result:texture(0,3)});
 assert.equal(e.renderer.uploads,before+1,'Cached selection and ready notifications must not upload identical GPU texture data again.');
 e.ultra.emit({type:'ready',axis:0,index:1,result:texture(0,1)});assert.equal(e.renderer.cap.index,3);
 reports.push('Warm-cache sections apply synchronously, duplicate cap uploads are avoided, and irrelevant prefetch results stay off screen.');
}
{
 const e=environment();e.api.setupSections(e.cards,e.ultra);await e.api.prepareUltra();
 const pending=e.api.refreshDetailedSections();assert.equal(e.detailRequests.length,3);
 const before=structuredClone(e.renderer.camera);const entered=deferred();e.modules.probe.enter=()=>entered.promise;
 const request=e.api.switchTab('probe');assert.ok(request instanceof Promise);assert.equal(e.ultra.paused,true);assert.equal(e.document.getElementById('viewport').parentElement.id,'probeViewportMount');
 assert.ok(e.detailRequests.every(r=>r.options.signal.aborted),'Moving to Probe cancels all orthogonal card consumers.');
 for(const item of e.detailRequests)item.resolve(texture(item.axis,item.index));await pending;assert.ok(e.cards.every(s=>!s.detail));
 e.ultra.emit({type:'ready',axis:0,index:2,result:texture(0,2)});assert.equal(e.cards[0].ultra,undefined);
 entered.resolve();await request;e.renderer.settings.palette=3;e.renderer.settings.surfaceSmoothing=2;e.renderer.camera.pan=[.3,.2,.1];
 e.api.switchTab('echo');assert.equal(e.modules.probe.leaves,1);assert.equal(e.document.getElementById('viewport').parentElement.id,'echoViewportMount');
 e.api.switchTab('reconstruction');assert.equal(e.modules.echo.leaves,1);assert.deepEqual(e.renderer.camera,before);assert.equal(e.renderer.settings.palette,3);assert.equal(e.renderer.settings.surfaceSmoothing,2);assert.equal(e.ultra.paused,false);
 reports.push('Probe entry is awaitable; module switches stop obsolete section work and preserve shared appearance while restoring reconstruction framing.');
}
const result={passed:true,scope:'Actual app state functions with a test DOM and deterministic loader/renderer mocks. No browser UI or frame-rate claim.',checks:reports};
await writeFile('docs/app-state-validation-v6.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
