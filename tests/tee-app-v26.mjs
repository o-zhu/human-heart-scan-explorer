/** Execute real app workspace transitions with delayed module data and DOM events. */
import test from 'node:test';
import * as sectionNames from '../public/section-names.js';
// This fixture strips imports; preserve the real section-name dependency.
const fixtureFunction=(...args)=>new Function(...Object.keys(sectionNames),...args).bind(null,...Object.values(sectionNames));
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {DONORS,ALL_SOURCES,donorFromSearch,donorUrl,spacingLabel} from '../public/donors.js';
const entry=process.argv[2];if(!entry)throw new Error('Pass the installed LinkeDOM ESM entry.');
const {parseHTML}=await import(pathToFileURL(entry));
const html=await readFile(new URL('../page.html',import.meta.url),'utf8');
const code=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/\nmain\(\);\s*$/,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fixture({slowTee=false,hash=''}={}){
 const {document,window}=parseHTML(html),events=[],instances={},wait=deferred();
 const renderer={loaded:true,settings:{mode:0,palette:4,threshold:.28,clipAxis:1,clipPosition:.64,clipFlip:1,showPlanes:0,cleanupEnabled:true,windowEnabled:true,windowLow:.1,windowHigh:.9,windowGamma:1.1,cutFaceExposure:1.35},camera:{yaw:.4,pitch:.2,roll:Math.PI,distance:1.3,pan:[.1,0,0]},autoRotate:false,set(p){Object.assign(this.settings,p);},clearCapData(){events.push(['clearCap']);},requestRender(){},reset(){events.push(['reset']);}};
 const initial=structuredClone({settings:renderer.settings,camera:renderer.camera});
 const location={search:'',href:'https://fixture.invalid/'+hash,hash};
 const history={replaceState(a,b,value){location.href=String(value);location.hash=new URL(value).hash;}};
 function makeModule(kind){return class{
  constructor({mount}){this.state={kind};this.mount=mount;mount.innerHTML=`<div id="${kind}ViewportMount"></div>`;instances[kind]=this;events.push(['construct',kind]);}
  async init(){events.push(['init',kind]);if(kind==='tee'&&slowTee)await wait.promise;}
  setVolume(){}getState(){return this.state;}restore(state){this.state=state;events.push(['restore',kind]);}
  enter(){events.push(['enter',kind]);renderer.set({clipAxis:3});renderer.camera.pan=[.2,.1,.1];}
  leave(){events.push(['leave',kind]);}reset(){events.push(['resetModule',kind]);}
 };}
 const loader=async kind=>kind==='tee'?{TeeLabModule:makeModule(kind)}:kind==='probe'?{ProbeLabModule:makeModule(kind)}:{EchoModule:makeModule(kind)};
 const api=fixtureFunction('document','location','history','navigator','donorFromSearch','donorUrl','spacingLabel','DONORS','ALL_SOURCES','scanActivity','HostedSectionStore','UltraVolumeSource','SectionDetail','VolumeLoader','ResidentSectionSource','loadWorkbenchModule','setTimeout','clearTimeout','suppliedRenderer','suppliedEvents',code+`
 renderer=suppliedRenderer;manifest={defaultThreshold:.32,levels:{high:{}}};
 appearance={load:async()=>{},changed(){}};activeAxis=1;
 fineSurfaceController={select:{value:'gentle'},setWorkspaceActive(active){suppliedEvents.push(['surfacePriority',active]);}};
 cancelUltraLoad=()=>{};cancelDetailedSections=()=>{};updateUltraFocus=()=>{};refreshUltraCut=()=>{};queueDetailedSections=()=>{};syncControls=()=>{};
 return {bind,switchTab,restore,ensureModuleData,state:()=>({currentTab,activeAxis,restoredTee,restoredTeeCamera}),renderer};`)(
 document,location,history,{clipboard:{async writeText(value){events.push(['clipboard',value]);}}},donorFromSearch,donorUrl,spacingLabel,DONORS,ALL_SOURCES,{beginForeground(){return ()=>{};}},class{},class{},class{},class{},class{},loader,()=>0,()=>{},renderer,events);
 api.bind();
 const trigger=id=>document.getElementById(id).dispatchEvent(new window.Event('click',{bubbles:true}));
 return {api,document,events,instances,wait,renderer,initial,location,trigger};
}

test('late TEE preparation cannot reclaim the shared viewport from the newer Probe tab',async()=>{
 const f=fixture({slowTee:true}),opening=f.api.switchTab('tee');await tick();
 assert.equal(f.document.getElementById('viewport').parentElement.id,'teeViewportMount');
 await f.api.switchTab('probe');assert.equal(f.document.getElementById('viewport').parentElement.id,'probeViewportMount');
 f.wait.resolve();await opening;
 assert.equal(f.api.state().currentTab,'probe');assert.equal(f.document.getElementById('viewport').parentElement.id,'probeViewportMount');
 assert.equal(f.events.some(e=>e[0]==='enter'&&e[1]==='tee'),false);
 assert.equal(f.document.getElementById('teePanel').hidden,true);assert.equal(f.document.getElementById('probeTab').getAttribute('aria-selected'),'true');
});

test('TEE returns to the prior reconstruction while preserving shared window edits',async()=>{
 const f=fixture();await f.api.switchTab('tee');
 f.renderer.set({windowGamma:.82,cutFaceExposure:1.7});
 await f.api.switchTab('reconstruction');
 assert.deepEqual(f.renderer.camera,f.initial.camera);assert.equal(f.renderer.settings.clipAxis,1);assert.equal(f.renderer.settings.clipPosition,.64);
 assert.equal(f.renderer.settings.windowGamma,.82);assert.equal(f.renderer.settings.cutFaceExposure,1.7);
 assert.equal(f.document.getElementById('reconstructionPanel').hidden,false);assert.equal(f.document.getElementById('teePanel').hidden,true);
 assert.deepEqual(f.events.filter(e=>e[0]==='surfacePriority'),[['surfacePriority',false],['surfacePriority',true]]);
});

test('TEE reset and shared-view links use the independent TEE state',async()=>{
 const f=fixture();await f.api.switchTab('tee');
 f.instances.tee.state={preset:'atrial',insertionMm:42,multiplaneDeg:110,teePreset:'custom'};
 f.trigger('resetView');assert.ok(f.events.some(e=>e[0]==='resetModule'&&e[1]==='tee'));
 f.trigger('shareView');await tick();
 const saved=JSON.parse(decodeURIComponent(f.location.hash.slice(6)));
 assert.equal(saved.module,'tee');assert.deepEqual(saved.tee,f.instances.tee.state);assert.equal(saved.probe,undefined);
 const restored=fixture({hash:f.location.hash});restored.api.restore();
 assert.deepEqual(restored.api.state().restoredTee,saved.tee);
 assert.equal(restored.renderer.settings.clipAxis,1,'A module clipping plane is not restored as a reconstruction section.');
 assert.deepEqual(restored.api.state().restoredTeeCamera,saved.camera);
});

test('TEE import and metadata are lazy and repeated tab entries reuse one complete module',async()=>{
 const f=fixture();assert.equal(f.events.some(e=>e[0]==='construct'),false);
 await f.api.switchTab('tee');await f.api.switchTab('reconstruction');await f.api.switchTab('tee');
 assert.equal(f.events.filter(e=>e[0]==='construct'&&e[1]==='tee').length,1);
 assert.equal(f.events.filter(e=>e[0]==='init'&&e[1]==='tee').length,1);
 assert.equal(f.events.filter(e=>e[0]==='enter'&&e[1]==='tee').length,2);
});
