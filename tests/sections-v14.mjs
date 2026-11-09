/** Regression checks for cached slice transitions; no browser automation. */
import test from 'node:test';
import * as sectionNames from '../public/section-names.js';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {HostedSectionStore} from '../public/hosted-ultra.js';
import {SectionImageBackend} from '../public/ultra-prefetch.js';
import {ScanActivity} from '../public/download-priority.js';
import {VolumeRenderer} from '../public/renderer.js';
import {orthogonalFrame} from '../public/planes.js';
import {croppedSectionFrame} from '../public/section-layout.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate,label){for(let i=0;i<1600;i++){if(predicate())return;await tick();}throw new Error('Timed out: '+label);}
const appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function appFunction(name){
 let start=appSource.indexOf(`function ${name}(`);if(appSource.slice(start-6,start)==='async ')start-=6;
 const tail=appSource.slice(start),end=tail.slice(1).search(/\n(?:async )?function |\nclass /);
 assert(start>=0,name);return end<0?tail:tail.slice(0,end+1);
}
function section(index,{spacingUm=79.4,axis=1}={}){return {key:`ultra:${axis}:${index}`,axis,index,spacingUm,cleaned:true,width:3,height:3,data:new Uint8Array(9).fill(index+80)};}
function appHarness(){
 const cap={...section(8),sectionAxis:1,sectionIndex:8},settings={clipAxis:1,clipPosition:.5,slices:[.5,.5,.5]},cache=new Map(),messages={},calls=[],frames=[],tasks=[];let serial=0;
 const renderer={cap,settings,loaded:true,backend:'webgl2',extent:[.9,1,.9],set(values){Object.assign(this.settings,values);calls.push({type:'settings',values});},
  setCapData(value){this.cap=value;calls.push({type:'cap',value});},clearCapData(){this.cap=null;calls.push({type:'clear'});}};
 const context=vm.createContext({...sectionNames,sectionNaming:sectionNames.sectionNamingFor({source:{id:'ladaf-2021-17'}}),renderer,performance:{now:()=>2345},activeAxis:1,slicePositions:[.5,.5,.5],slices:[0,1,2].map(axis=>({draw(){calls.push({type:'draw',axis,index:Math.round(context.slicePositions[axis]*16)});}})),
  pendingSectionDraws:new Set(),sectionDrawFrame:0,sectionDrawTask:0,requestAnimationFrame(fn){frames.push(fn);return ++serial;},setTimeout(fn){tasks.push(fn);return ++serial;},
  cutFaceQuality:'ultra',ultraFailed:false,ultraBusy:false,currentTab:'reconstruction',donor:{fineSpacingUm:79.4},sectionDetail:{manifest:{spacingUm:158.8}},
  clamp:(x,a,b)=>Math.max(a,Math.min(x,b)),sectionCount:()=>17,
  cancelUltraLoad(){},updateUltraFocus(){for(const [axis,position] of context.slicePositions.entries()){const image=cache.get(`${axis}:${Math.round(position*16)}`);if(image)context.slices[axis].ultra=image;}},
  syncControls(){},syncUltraControls(){},refreshUltraCut(){},queueDetailedSections(){},setText:(id,value)=>{messages[id]=value;},spacingLabel:n=>`${n} µm`,
  orthogonalFrame,croppedSectionFrame});
 for(const name of ['currentSectionTexture','setUltraTexture','applySectionCap','scheduleSectionDraw','setSlices'])vm.runInContext(appFunction(name),context);
 return {context,renderer,cache,messages,calls,frames,tasks,flushFrame(){for(const fn of frames.splice(0))fn();},flushTasks(){for(const fn of tasks.splice(0))fn();}};
}

test('A decoded next slice changes the exact texture and plane together, without clearing the Ultra cap',()=>{
 const h=appHarness(),next=section(9);h.cache.set('1:9',next);h.context.setSlices([.5,9/16,.5]);
 assert.equal(h.renderer.cap.data,next.data);assert.equal(h.renderer.cap.sectionIndex,9);assert.equal(h.renderer.settings.clipPosition,9/16);
 assert.equal(h.calls.filter(c=>c.type==='clear').length,0);assert.equal(h.messages.sectionSyncStatus,'Sagittal is linked to the 3D cutaway');
});

test('An encoded-only hit advances the current resident plane immediately and refines that same plane',()=>{
 const h=appHarness(),previous=h.renderer.cap;h.context.setSlices([.5,9/16,.5]);
 assert.equal(h.renderer.cap,null);assert.equal(h.renderer.settings.clipPosition,9/16);assert.equal(h.context.slicePositions[1],9/16);
 assert.match(h.messages.capDetailStatus,/Current section 10 · volume preview/);assert.equal(h.calls.filter(c=>c.type==='clear').length,1);
 assert.equal(previous.sectionIndex,8,'Old fine pixels retain their original identity and are never moved.');
 h.context.slices[1].ultra=section(9);h.context.applySectionCap(h.context.slices[1],1);
 assert.equal(h.renderer.cap.sectionIndex,9);assert.equal(h.renderer.settings.clipPosition,9/16);
 assert.deepEqual([...h.renderer.cap.plane.center],[...orthogonalFrame(1,9/16,h.renderer.extent).center]);
});

test('Repeated requests and crosshair edits retain the correct current resident plane without repeated clears',()=>{
 const h=appHarness();h.context.setSlices([.5,9/16,.5]);
 h.context.setSlices([.5,9/16,.5]);h.context.setSlices([6/16,9/16,7/16]);
 assert.equal(h.renderer.cap,null);assert.equal(h.renderer.settings.clipPosition,9/16);
 assert.equal(h.context.slicePositions[1],9/16);assert.equal(h.calls.filter(c=>c.type==='clear').length,1);
 h.context.slices[1].ultra=section(9);h.context.applySectionCap(h.context.slices[1],1);
 assert.equal(h.renderer.cap.sectionIndex,9);assert.equal(h.renderer.settings.clipPosition,9/16);
});

test('Rapid scrolling rejects stale pixels, advances immediately, and uses the best exact current source',()=>{
 const h=appHarness();h.context.setSlices([.5,9/16,.5]);h.context.setSlices([.5,10/16,.5]);
 h.context.slices[1].ultra=section(9);h.context.applySectionCap(h.context.slices[1],1);
 assert.equal(h.renderer.cap,null);assert.equal(h.renderer.settings.clipPosition,10/16);
 h.context.slices[1].detail=section(10,{spacingUm:158.8});h.context.applySectionCap(h.context.slices[1],1);
 assert.equal(h.renderer.cap.spacingUm,158.8);assert.equal(h.renderer.cap.sectionIndex,10);assert.equal(h.renderer.settings.clipPosition,10/16);
 h.context.slices[1].ultra=section(10);h.context.applySectionCap(h.context.slices[1],1);
 assert.equal(h.renderer.cap.sectionIndex,10);assert.equal(h.renderer.cap.spacingUm,79.4);assert.equal(h.renderer.settings.clipPosition,10/16);
});

test('An explicit fine-image failure permits the correctly registered available-detail fallback',()=>{
 const h=appHarness();h.context.setSlices([.5,9/16,.5]);h.context.ultraFailed=true;
 h.context.slices[1].detail=section(9,{spacingUm:158.8});h.context.applySectionCap(h.context.slices[1],1);
 assert.equal(h.renderer.cap.spacingUm,158.8);assert.equal(h.renderer.cap.sectionIndex,9);assert.equal(h.renderer.settings.clipPosition,9/16);
});

test('A failed selected image with no Detailed fallback shows the selected volume plane, never a stale fine face',()=>{
 const h=appHarness();h.context.setSlices([.5,9/16,.5]);h.context.ultraFailed=true;
 h.context.applySectionCap(h.context.slices[1],1);
 assert.equal(h.renderer.cap,null);assert.equal(h.renderer.settings.clipPosition,9/16);
 assert.equal(h.messages.sectionSyncStatus,'Sagittal is linked to the 3D cutaway');
 assert.match(h.messages.capDetailStatus,/volume preview/);
});

test('Large uncached jumps and reversals advance on every input without CPU extraction in the WebGL event path',()=>{
 const h=appHarness(),indices=[9,14,3,12,15,2,8,0,16,7,13,1];
 h.context.residentSections={get(){throw new Error('WebGL input must not extract CPU section pixels.');}};
 for(const index of indices){
  h.context.setSlices([.5,index/16,.5]);
  assert.equal(h.renderer.settings.clipPosition,index/16);assert.equal(h.renderer.cap,null);
 }
 assert.equal(h.calls.filter(c=>c.type==='clear').length,1);
 assert.equal(h.frames.length,1);assert.equal(h.calls.filter(c=>c.type==='draw').length,0);
 h.context.slices[1].ultra=section(indices.at(-2));h.context.applySectionCap(h.context.slices[1],1);
 assert.equal(h.renderer.cap,null,'An obsolete decoded slice cannot undo the current resident view.');
 h.context.slices[1].ultra=section(indices.at(-1));h.context.applySectionCap(h.context.slices[1],1);
 assert.equal(h.renderer.cap.sectionIndex,indices.at(-1));
 h.flushFrame();h.flushTasks();assert.equal(h.calls.find(c=>c.type==='draw'&&c.axis===1).index,indices.at(-1));
});

test('Previously decoded detailed sections are reused without awaiting the Ultra decoder',()=>{
 const h=appHarness(),detail=section(13,{spacingUm:158.8});
 h.context.sectionDetail.cached=(axis,index)=>axis===1&&index===13?detail:null;
 h.context.setSlices([.5,13/16,.5]);assert.equal(h.renderer.cap.data,detail.data);
 assert.equal(h.renderer.cap.sectionIndex,13);assert.equal(h.renderer.settings.clipPosition,13/16);
});

test('Rapid cached scrolling publishes the newest 3D face immediately and coalesces CT card work after the render opportunity',()=>{
 const h=appHarness();
 for(let index=9;index<=13;index++){
  h.cache.set(`1:${index}`,section(index));h.context.setSlices([.5,index/16,.5]);
  assert.equal(h.renderer.cap.sectionIndex,index,'The 3D face does not wait for a card or debounce.');
 }
 assert.equal(h.calls.filter(c=>c.type==='draw').length,0);assert.equal(h.frames.length,1);
 h.flushFrame();assert.equal(h.calls.filter(c=>c.type==='draw').length,0,'Cards leave the renderer an animation-frame opportunity first.');
 assert.equal(h.tasks.length,1);h.flushTasks();
 assert.deepEqual(h.calls.filter(c=>c.type==='draw').map(c=>c.axis),[0,1,2]);
 assert.equal(h.calls.find(c=>c.type==='draw'&&c.axis===1).index,13,'Superseded indices are never painted.');
});

test('A decoded worker arrival publishes its registered cap before any 2D repaint and pending card work stops off-module',async()=>{
 const h=appHarness();let listener;
 h.context.ultraSource={subscribe(fn){listener=fn;},init(){return Promise.resolve(this);}};
 h.context.ultraSubscribed=false;h.context.ultraReady=null;h.context.syncUltraCacheStatus=()=>{};
 vm.runInContext(appFunction('prepareUltra'),h.context);await h.context.prepareUltra();
 h.context.setSlices([.5,9/16,.5]);listener({type:'ready',axis:1,index:9,result:section(9)});
 assert.equal(h.renderer.cap.sectionIndex,9);assert.equal(h.renderer.settings.clipPosition,9/16);
 assert.equal(h.calls.filter(c=>c.type==='draw').length,0);
 h.context.currentTab='probe';h.flushFrame();h.flushTasks();
 assert.equal(h.calls.filter(c=>c.type==='draw').length,0,'An inactive rail must not use a frame budget.');
});

class Disk{constructor(){this.data=new Map();}async match(url){return this.data.get(url)?.clone();}async put(url,response){this.data.set(url,response.clone());}async delete(url){return this.data.delete(url);}async keys(){return [...this.data.keys()].map(url=>({url}));}}
function manifest(count=48){return {schemaVersion:2,cropped:true,spacingUm:79.4,sliceCounts:[count,count,count],imageDimensionsXYZ:[189,189,189],sourceIndexStep:4,
 sourceWindow:[14640,23545],compressionLossless:true,assetBaseUrl:'https://scan.example/ultra/',
 slices:Object.fromEntries([...'xyz'].map(axis=>[axis,Array.from({length:count},(_,i)=>({path:`${axis}/${i}.webp`,bytes:16,crop:[0,0,3,3]}))]))};}
async function storedHarness({missing=false}={}){
 const disk=new Disk(),m=manifest(),activity=new ScanActivity({ready:true}),metrics={fetches:0,decodes:0};let store;
 for(const axis of [...'xyz'])for(let i=0;i<48;i++)if(!missing||i===16)await disk.put(`https://scan.example/ultra/${axis}/${i}.webp`,new Response(new Uint8Array(16).fill(i)));
 const backend=new SectionImageBackend({cacheOptions:{cacheStorage:{open:async()=>disk},storageManager:null},
  fetchImpl:async()=>{metrics.fetches++;throw new Error('No speculative network fetch is allowed during interaction.');},
  decodeImpl:async(blob)=>{metrics.decodes++;return new Uint8Array(9).fill(new Uint8Array(await blob.arrayBuffer())[0]);},onStats:s=>store?.receiveTransportStats(s)});
 store=new HostedSectionStore({loader:(r,o)=>backend.load(r,o),manifest:m,autoDownloadCollection:false,activity,idleDelay:1e6,decodedLimit:384,visibility:()=>true});
 activity.beginGesture('wheel');store.setFocus(0,16,{positions:[16,16,16]});
 await store.load(0,16);
 return {store,activity,metrics,close(){store.dispose();backend.dispose();activity.dispose();}};
}

test('Downloaded neighbors continue decoding throughout an active scroll gesture, with zero network traffic',async()=>{
 const h=await storedHarness();try{
  assert.equal(h.activity.getState().allowPrefetch,false);assert.equal(h.activity.getState().allowBackground,false);
  await until(()=>h.store.has(0,17)&&h.store.has(0,15),'locally decoded neighbors');
  for(let index=17;index<=30;index++){
   h.store.setFocus(0,index,{positions:[index,16,16]});const result=await h.store.load(0,index);
   assert.equal(result.data[0],index);assert.equal(result.spacingUm,79.4);
   await until(()=>h.store.has(0,index+1),'next local slice');assert(h.store.cacheBytes<=384);
  }
  assert.equal(h.metrics.fetches,0);assert(h.metrics.decodes>15);assert(h.store.wanted.size<=17);
 }finally{h.close();}
});

test('A missing speculative disk image cannot silently become a network download or a displayed error',async()=>{
 const h=await storedHarness({missing:true}),errors=[];h.store.subscribe(event=>{if(event.type==='error')errors.push(event);});
 try{
  await until(()=>h.store.localMissUntil.has('ultra:0:17'),'disk-only cache miss');
  await until(()=>h.store.active.size===0,'bounded local window completes');
  assert.equal(h.metrics.fetches,0);assert.equal(errors.length,0);assert(h.store.has(0,16));
  assert.equal(h.activity.getState().allowBackground,false);
 }finally{h.close();}
});

test('A selected face can join a disk-only miss and retry once with foreground priority',async()=>{
 const m=manifest(),activity=new ScanActivity({ready:true}),jobs=[];activity.beginGesture('wheel');
 const store=new HostedSectionStore({manifest:m,activity,idleDelay:1e6,autoDownloadCollection:false,visibility:()=>true,
  loader:(request)=>new Promise((resolve,reject)=>{jobs.push({request,resolve,reject});})});
 try{
  store.metrics.persistentAvailable=true;
  const current=section(16,{axis:0});store.remember(current);store.setFocus(0,16,{positions:[16,16,16]});
  await until(()=>jobs.some(j=>j.request.index===17&&j.request.axis===0),'local next-slice request');
  const local=jobs.find(j=>j.request.index===17&&j.request.axis===0);assert.equal(local.request.localOnly,true);
  const selected=store.load(0,17);await tick();const error=new Error('cache miss');error.name='CacheMissError';local.reject(error);
  await until(()=>jobs.some(j=>j!==local&&j.request.index===17&&j.request.axis===0),'foreground retry');
  const retry=jobs.find(j=>j!==local&&j.request.index===17&&j.request.axis===0);assert.equal(retry.request.localOnly,false);assert.equal(retry.request.priority,0);
  retry.resolve({data:new Uint8Array(9).fill(117),receivedBytes:16});assert.equal((await selected).data[0],117);
 }finally{store.dispose();activity.dispose();for(const job of jobs)job.resolve({data:new Uint8Array(9)});}
});

test('Fine cap uploads coalesce to the latest frame, reuse allocations, and skip unchanged pixels',()=>{
 const calls=[],gl=new Proxy({},{get:(_,name)=>name.startsWith('tex')||name==='pixelStorei'||name==='bindTexture'||name==='activeTexture'?(...args)=>calls.push({name,args}):name});
 const renderer=Object.assign(Object.create(VolumeRenderer.prototype),{gl,capTexture:{},requestRender(){}}),a=section(8),b=section(9);
 renderer.setCapData(a);renderer.setCapData(b);renderer.setCapData({...b,plane:{center:[1,0,0]}});
 assert.equal(calls.filter(c=>c.name==='texImage2D'||c.name==='texSubImage2D').length,0,'Input callbacks never upload obsolete intermediate textures.');
 renderer.uploadCapData();assert.equal(calls.filter(c=>c.name==='texImage2D').length,1);
 assert.equal(calls.find(c=>c.name==='texImage2D').args.at(-1),null);
 assert.equal(calls.find(c=>c.name==='texSubImage2D').args.at(-1),b.data);
 renderer.setCapData({...b,plane:{center:[2,0,0]}});renderer.uploadCapData();
 assert.equal(calls.filter(c=>c.name==='texSubImage2D').length,1);
 renderer.setCapData(section(10));renderer.uploadCapData();assert.equal(calls.filter(c=>c.name==='texSubImage2D').length,2);
 renderer.setCapData({...section(11),width:4,data:new Uint8Array(12)});renderer.uploadCapData();
 assert.equal(calls.filter(c=>c.name==='texImage2D').length,1,'Adjacent crop changes retain the allocation.');
 assert.equal(calls.filter(c=>c.name==='texSubImage2D').length,3);
 renderer.setCapData({...section(12),width:257,data:new Uint8Array(257*3)});renderer.uploadCapData();
 assert.equal(calls.filter(c=>c.name==='texImage2D').length,2,'Only growth beyond the retained storage reallocates.');
});
