/** State integration tests, without a browser or graphics context.
 * Usage: node scripts/verify-app-state-v5.mjs /path/to/linkedom/esm/index.js
 * The DOM dependency is test-only; no production dependency changes are needed.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {EchoModule} from '../public/echo.js';

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
 for(const id of ['echoViewportMount','flowViewportMount']){const node=document.createElement('div');node.id=id;document.getElementById(id.startsWith('echo')?'echoPanel':'flowPanel').append(node);}
 const loader={requests:[],pending:null,load(level,options){this.pending?.reject(new DOMException('Superseded','AbortError'));const d=deferred();this.pending=d;this.requests.push({level,options,...d});return d.promise;},finish(index=this.requests.length-1){const req=this.requests[index];if(this.pending===req)this.pending=null;req.resolve({data:new Uint8Array(req.level.dimensions.reduce((a,b)=>a*b,1)),acceleration:null,gpuCrop:null,stats:{receivedBytes:1234}});},fail(){this.pending.reject(new Error('Deliberate load failure'));this.pending=null;}};
 const renderer={canvas:document.getElementById('volumeCanvas'),loaded:false,backend:'webgl2',settings:{palette:4,mode:0,threshold:.28,opacity:.8,clipAxis:-1,clipPosition:.5,clipFlip:0,showPlanes:0,cleanupEnabled:true,quality:'high',surfaceSmoothing:1,capContrast:1.8},camera:{yaw:.5,pitch:.2,roll:0,distance:1.5,pan:[0,0,0]},extent:[1,1,1],load(data,meta){this.loaded=true;this.meta=meta;},set(values){Object.assign(this.settings,values);},requestRender(){},clearCapData(){},autoRotate:false};
 const appearance={changed(){},sync(){}};
 const modules={echo:{setVolume(){},leave(){},enter(){}},flow:{setVolume(){},leave(){},enter(){return Promise.resolve();}}};
 const manifest={levels:{low:{dimensions:[3,3,3],spacingUm:635,supportCompressed:true},high:{dimensions:[5,5,5],spacingUm:317.6,supportCompressed:true}},defaultLevel:'high',previewLevel:'low'};
 const SectionDetail=class{constructor(){this.manifest={sliceCounts:[5,5,5]};}};
 const code=source+`\nreturn {
  loadLevel,setCleanupMode,switchTab,
  configure(input){renderer=input.renderer;manifest=input.manifest;appearance=input.appearance;echoModule=input.echo;flowModule=input.flow;requestedLevel='high';},
  state(){return {currentLevel,volumeOriginal,cleanupRequested,loading,currentTab,volumeData,settings:{...renderer.settings},camera:structuredClone(renderer.camera)};}
 };`;
 const api=new Function('document','window','location','SectionDetail','VolumeLoader','PALETTE_KEYS','setTimeout','clearTimeout','requestAnimationFrame','console',code)(document,window,{hash:''},SectionDetail,class{constructor(){return loader;}},['ivory','copper','grayscale','porcelain','contrast','anatomy'],()=>1,()=>{},fn=>queueMicrotask(fn),{error(){},warn(){},info(){}});
 api.configure({renderer,manifest,appearance,...modules});return {api,loader,renderer,document,modules};
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
 const e=environment();const before=structuredClone(e.renderer.camera);const d=deferred();e.modules.flow.enter=()=>d.promise;
 const entered=e.api.switchTab('flow');assert.equal(entered,d.promise);assert.equal(e.api.state().currentTab,'flow');assert.equal(e.document.getElementById('viewport').parentElement.id,'flowViewportMount');
 d.resolve();await entered;e.renderer.settings.palette=5;e.renderer.settings.surfaceSmoothing=2;
 e.api.switchTab('reconstruction');assert.deepEqual(e.renderer.camera,before);assert.equal(e.renderer.settings.palette,5);assert.equal(e.renderer.settings.surfaceSmoothing,2);
 assert.notEqual(e.document.getElementById('viewport').parentElement.id,'flowViewportMount');
 reports.push('Flow entry is awaitable; returning restores reconstruction framing while preserving material and surface choices.');
}
{
 const e=Object.create(EchoModule.prototype);let alignments=0,released=0;
 e.active=true;e.state={lockCamera:true,contrast:1.8,flip:false};e.requestId=0;
 e.renderer={set(){},clearCapData(){},alignPlane(){alignments++;}};
 e.$=()=>({textContent:''});e.message=()=>{};e.samplePlane=()=>{};
 e.getPlane=()=>e.meta?{normal:[0,0,1],up:[0,1,0],center:[0,0,0]}:null;
 const meta={dimensions:[5,5,5],spacingUm:317.6};
 e.setVolume(new Uint8Array(125),meta);clearTimeout(e.sampleTimer);assert.equal(alignments,1);
 e.sampler={destroy(){released++;}};e.setVolume(new Uint8Array(125),meta);clearTimeout(e.sampleTimer);
 assert.equal(alignments,1,'Background Echo refinement must preserve an orbit.');assert.equal(released,1);
 e.sampler={destroy(){released++;}};e.leave();assert.equal(released,2);assert.equal(e.sampler,null);
 reports.push('Echo initializes its first plane, preserves later orbit/zoom, and releases replaced or inactive MPR workers.');
}
const result={passed:true,scope:'Actual app state functions with a test DOM and deterministic loader/renderer mocks. No browser UI or frame-rate claim.',checks:reports};
await writeFile('docs/app-state-validation-v5.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
