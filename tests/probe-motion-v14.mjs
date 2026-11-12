/** Production scheduling and data-path fixtures; no browser automation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ProbeLabModule} from '../public/probe-lab.js';
import {computeProbeFrame,probeFrameQuality} from '../public/probe-acoustics.js';
import {probeCapPlane,probePose,volumeGeometry,sanitizeProbeState,steerProbe} from '../public/probe-geometry.js';
import {UltraVolumeSource} from '../public/ultra-volume.js';

const domPath=process.argv.find(x=>x.startsWith('--dom='))?.slice(6)||'/workspace/data/heart-ui-test-v11/node_modules/linkedom/esm/index.js';
const {parseHTML}=await import(pathToFileURL(domPath));
const meta=JSON.parse(await readFile('public/assets/manifest.json','utf8')).levels.high;
const frames=JSON.parse(await readFile('public/assets/echo-planes.json','utf8'));
const real={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
let fixture;
function environment(){
 const {document,window}=parseHTML('<!doctype html><html><body><section id="mount"></section></body></html>');
 Object.assign(globalThis,{document,window});Object.defineProperty(document,'activeElement',{configurable:true,writable:true,value:document.body});Object.defineProperty(document,'pointerLockElement',{configurable:true,writable:true,value:null});
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(v){this._value=String(v);}});
 window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:800,height:650});window.HTMLElement.prototype.focus=function(){document.activeElement=this;};
 const context=new Proxy({putImageData(){},setTransform(){}},{get:(o,k)=>k in o?o[k]:(()=>{})});window.HTMLCanvasElement.prototype.getContext=()=>context;
 globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 const timers=new Map(),rafs=new Map();let serial=0;
 globalThis.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 globalThis.requestAnimationFrame=fn=>{const id=++serial;rafs.set(id,fn);return id;};globalThis.cancelAnimationFrame=id=>rafs.delete(id);
 const workers=[];globalThis.Worker=class{constructor(){this.messages=[];workers.push(this);}postMessage(message){this.messages.push(message);}terminate(){this.terminated=true;}};
 const renderer={canvas:document.createElement('canvas'),settings:{palette:4,threshold:.28,cleanupEnabled:true,capContrast:1.8},camera:{yaw:0,pitch:0,roll:0,distance:2,pan:[0,0,0]},uploads:0,set(v){Object.assign(this.settings,v);},requestRender(){},clearCapData(){this.cap=null;},setCapData(cap){this.cap=cap;this.uploads++;},alignPlane(){},basis(){return {eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};}};
 const calls=[],warm=[];const fineSource={samplePlane(plane,options){return new Promise((resolve,reject)=>{const call={plane,options,resolve,reject};calls.push(call);options.signal.addEventListener('abort',()=>reject(new DOMException('Canceled','AbortError')),{once:true});});},scheduleWarmPlane(plane){warm.push(plane);},cancelWarm(){}};
 const module=new ProbeLabModule({renderer,mount:document.getElementById('mount'),frames,fineSource});module.ensureScene=()=>{};module.drawGuide=()=>{};module.orientCamera=()=>{};
 module.setVolume(new Uint8Array(1),meta);
 const tickTimer=id=>{const timer=timers.get(id);assert.ok(timer,'Expected pending timer');timers.delete(id);timer.fn();};
 return fixture={module,renderer,workers,calls,warm,timers,rafs,tickTimer};
}
function frameFor(job,{fine=!!job.fineSlice,value=160,spacingUm}={}){
 const plane=job.fineSlice?.plane||probeCapPlane(job.pose,volumeGeometry(meta)),cap=job.fineSlice?.data||new Uint8Array(64).fill(value),width=8,height=8;
 return {...job,type:'frame',fine,plane,cap,capWidth:8,capHeight:8,capCleaned:fine,capSpacingUm:spacingUm??job.fineSlice?.spacingUm??317.6,ct:new Uint8Array(width*height).fill(value),ultrasound:new Uint8Array(width*height).fill(value),width,height,sector:{depthMm:job.state.depthMm,widthMm:150},stats:{sourceSpacingUm:fine?79.4:317.6,tissueFraction:.5}};
}
async function resolveSource(f,index=0,{spacingUm=79.4}={}){
 const call=f.calls[index];call.resolve({data:new Uint8Array(64).fill(180),width:8,height:8,plane:call.plane,spacingUm,sourceSpacingUm:79.4,complete:true,cleaned:true});await flush();
 return f.workers.at(-1).messages.findLast(x=>x.fineSlice&&x.poseRevision===f.module.fineRunning?.request.poseRevision);
}
function deliver(f,job,options){const frame=frameFor(job,options);f.workers.at(-1).onmessage({data:frame});return frame;}
test.afterEach(async()=>{fixture?.module.leave();fixture=null;Object.assign(globalThis,real);await flush();});

test('entry immediately requests the genuine prepared source, without waiting for an idle debounce',async()=>{
 const f=environment();await f.module.enter();assert.equal(f.calls.length,1);assert.ok(f.calls[0].options.spacingUm>=79.4);
 assert.equal(f.workers.at(-1).messages.filter(x=>x.type==='sample').length,0,'Fine request gets a brief head start over preview');
 assert.match(f.module.$('frame-state').textContent,/Loading Fine/i);
 const job=await resolveSource(f);assert.ok(job.fineSlice);assert.equal(job.fast,false);deliver(f,job);
 assert.match(f.module.$('resolution').textContent,/79.4.*Ultra/);assert.equal(f.renderer.cap.data,job.fineSlice.data);assert.equal(f.warm.length,1);assert.equal(f.module.fineRunning,null);
});

test('v26 release and repeated same-pose requests do not duplicate a pending or completed fine computation',async()=>{
 const f=environment();await f.module.enter();
 for(let n=0;n<4;n++)f.module.requestFrame(false);
 assert.equal(f.calls.length,1);assert.equal(f.module.fineLatest,null);
 const first=await resolveSource(f);deliver(f,first);assert.equal(f.calls.length,1);
 const count=f.workers.at(-1).messages.length;f.module.requestFrame(false);assert.equal(f.calls.length,1);assert.equal(f.workers.at(-1).messages.length,count);
 f.module.poseRevision++;f.module.requestFrame(true);f.module.requestFrame(false);
 assert.equal(f.calls.length,2);assert.equal(f.module.fineLatest,null);
 const moving=await resolveSource(f,1);deliver(f,moving);assert.equal(f.calls.length,2);assert.equal(f.warm.at(-1),f.module.displayedFrame.plane);
});

test('v26 a genuine gain or output-grid change still recomputes the matched image at the same pose',async()=>{
 const f=environment();await f.module.enter();const first=await resolveSource(f);deliver(f,first);
 f.module.state.gainDb+=3;f.module.requestFrame(false);assert.equal(f.calls.length,2);
 const adjusted=await resolveSource(f,1);assert.equal(adjusted.state.gainDb,3);deliver(f,adjusted);assert.notEqual(adjusted.workKey,first.workKey);
});

test('v35 sustained input immediately follows the probe without downloading a fine plane for every move',async()=>{
 const f=environment();await f.module.enter();const first=f.calls[0],revision=f.module.poseRevision;
 for(let i=0;i<40;i++){f.module.state=steerProbe(f.module.state,{roll:.1});f.module.poseChanged(false,false);f.module.requestFrame(true);}
 assert.equal(first.options.signal.aborted,true);assert.equal(f.calls.length,1);assert.equal(f.module.fineLatest,null);assert.equal(f.module.fineRunning,null);
 const preview=f.workers.at(-1).messages.findLast(x=>x.type==='sample');assert.equal(preview.poseRevision,revision+40);assert.equal(preview.width,352);assert.ok(preview.capLongest<=448);assert.equal(preview.fineSlice,undefined);
 deliver(f,preview);assert.equal(f.renderer.cap.plane,f.module.displayedFrame.plane);
 f.tickTimer(f.module.refineTimer);assert.equal(f.calls.length,2,'Only the quiet, latest pose requests source data');assert.equal(f.module.fineRunning.request.poseRevision,revision+40);
 const latest=await resolveSource(f,1);deliver(f,latest);assert.equal(f.module.displayedFrame.poseRevision,revision+40);assert.equal(f.renderer.cap.plane,f.module.displayedFrame.plane);
});

test('v46 continuous input coalesces cache-only fine work and keeps current-plane blocks streaming',async()=>{
 const f=environment(),resident=[],warming=[];
 f.module.fineSource.sampleResidentPlane=(plane,options)=>new Promise(resolve=>resident.push({plane,options,resolve}));
 f.module.fineSource.warmPlane=(plane,options)=>new Promise((resolve,reject)=>{warming.push({plane,options,resolve});options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
 await f.module.enter();f.module.poseChanged(true);
 const firstTimer=f.module.movingTimer;assert.ok(firstTimer);
 for(let i=0;i<20;i++){f.module.state=steerProbe(f.module.state,{tilt:.02});f.module.poseChanged(true);}
 assert.equal(f.module.movingTimer,firstTimer,'Continuous movement does not restart the live-detail timer');
 f.tickTimer(firstTimer);assert.equal(resident.length,1);resident[0].resolve(null);await flush();assert.equal(warming.length,1);
 assert.equal(warming[0].options.localOnly,false);assert.equal(warming[0].options.currentPlane,true);assert.equal(warming[0].options.retainTransfers,true);
 f.module.poseChanged(true);f.tickTimer(f.module.movingTimer);resident[1].resolve(null);await flush();
 assert.equal(warming[0].options.signal.aborted,true,'Latest moving plane replaces the obsolete warming request');assert.equal(warming.length,2);
 const current=f.module.poseRevision;f.module.poseChanged(true);f.tickTimer(f.module.movingTimer);
 const slice={data:new Uint8Array(64).fill(180),width:8,height:8,plane:resident[2].plane,spacingUm:79.4,sourceSpacingUm:79.4,complete:true,cleaned:true};resident[2].resolve(slice);await flush();
 const fine=f.workers.at(-1).messages.findLast(x=>x.fineSlice);assert.ok(fine);assert.equal(fine.poseRevision,current+1);assert.ok(fine.capLongest>=640);deliver(f,fine);assert.equal(f.module.displayedFrame.fine,true);
 assert.equal(f.calls.length,1,'Moving work never requests a blocking full-network reformat');
 f.module.requestFrame(false);assert.equal(warming[1].options.signal.aborted,true);assert.equal(f.module.movingTimer,0);assert.equal(f.calls.length,2);
});

test('v46 a late moving fine plane cannot be attached to a newer probe pose or survive exit',async()=>{
 const f=environment(),resident=[];f.module.fineSource.sampleResidentPlane=(plane,options)=>new Promise(resolve=>resident.push({plane,options,resolve}));
 await f.module.enter();f.module.poseChanged(true);f.tickTimer(f.module.movingTimer);
 f.module.state=steerProbe(f.module.state,{tilt:2});f.module.poseChanged(true);
 const obsolete=resident[0];obsolete.resolve({data:new Uint8Array(64),width:8,height:8,plane:obsolete.plane,spacingUm:79.4,sourceSpacingUm:79.4,complete:true,cleaned:true});await flush();
 assert.equal(f.workers.at(-1).messages.filter(x=>x.fineSlice).length,0);f.tickTimer(f.module.movingTimer);f.module.leave();
 assert.equal(resident[1].options.signal.aborted,true);resident[1].resolve({});await flush();assert.equal(f.renderer.uploads,0);assert.equal(f.module.movingTimer,0);
});

test('v46 detail failure clears the loading label while preserving the usable measured preview',async()=>{
 const f=environment();await f.module.enter();f.calls[0].reject(new Error('A fine-detail block stopped responding.'));await flush();
 assert.match(f.module.$('frame-state').textContent,/Detail Unavailable/);assert.doesNotMatch(f.module.$('frame-state').textContent,/Loading/);assert.equal(f.module.fineRunning,null);assert.match(f.module.$('fine-status').textContent,/retry/);
});

test('late coarse frames cannot replace a finer frame for the same pose or an older pose',async()=>{
 const f=environment();await f.module.enter();const job=await resolveSource(f);deliver(f,job);const before=f.renderer.uploads;
 f.module.acceptFrame(frameFor({...job,id:job.id+100,fast:true,fineSlice:null},{fine:false}));assert.equal(f.renderer.uploads,before);assert.match(f.module.$('frame-state').textContent,/Ultra/);
 f.module.poseRevision++;f.module.requestFrame(true);const moved=f.workers.at(-1).messages.findLast(x=>x.type==='sample');deliver(f,moved);const second=f.renderer.uploads;
 f.module.acceptFrame(frameFor({...job,id:moved.id+100,fineSlice:null},{fine:false}));assert.equal(f.renderer.uploads,second);assert.equal(f.module.displayedFrame.poseRevision,moved.poseRevision);
});

test('coarse fallback at a newer pose prevents an older fine result from jumping backward',async()=>{
 const f=environment();await f.module.enter();const old=await resolveSource(f);f.module.poseRevision++;f.module.requestFrame(true);
 const preview=f.workers.at(-1).messages.findLast(x=>x.type==='sample');deliver(f,preview,{fine:false});const before=f.renderer.uploads;
 deliver(f,old);assert.equal(f.renderer.uploads,before);assert.equal(f.module.displayedFrame.poseRevision,preview.poseRevision);assert.equal(f.calls.length,1);
 f.module.requestFrame(false);assert.equal(f.calls.length,2);
 const current=await resolveSource(f,1);deliver(f,current);assert.equal(f.module.displayedFrame.poseRevision,preview.poseRevision);assert.equal(f.module.displayedFrame.fine,true);
});

test('v35 live and settled grids are bounded for the displayed pane and retain the measured source identity',async()=>{
 const f=environment();await f.module.enter();const full=f.module.fineRunning.request;
 f.module.poseRevision++;f.module.requestFrame(true);const moving=f.workers.at(-1).messages.findLast(x=>x.type==='sample');
 for(const key of ['width','beams','samples','capLongest'])assert.ok(full[key]>moving[key],key);
 assert.ok(full.width>=800&&full.width<=896);assert.ok(moving.width<=384&&moving.capLongest<=448);assert.equal(full.fineSpacingUm,moving.fineSpacingUm);assert.equal(full.fineSpacingUm,79.4);
 const q1=probeFrameQuality(full.state,800),q2=probeFrameQuality({...full.state,rollDeg:23,sweepDeg:12},800);assert.deepEqual(q1,q2);
 assert.equal(f.calls.length,1,'Input samples only the resident volume');f.module.requestFrame(false);assert.equal(f.calls.length,2);assert.ok(f.calls[1].options.spacingUm>79.4,'The quiet reformat samples real fine voxels at the displayed cap budget');
});

test('v35 a local reformat yields immediately to input and all displayed geometry follows the matching preview',async()=>{
 const f=environment();await f.module.enter();const first=await resolveSource(f);deliver(f,first);const cap=f.renderer.cap;
 f.module.state=steerProbe(f.module.state,{tilt:1});f.module.poseRevision++;f.module.requestFrame(false);f.calls[1].options.onProgress({phase:'sampling',ready:0,total:200,local:true,resident:true});
 f.module.state=steerProbe(f.module.state,{tilt:1});f.module.poseChanged(true);assert.equal(f.calls[1].options.signal.aborted,true);
 const preview=f.workers.at(-1).messages.findLast(x=>x.type==='sample');assert.equal(preview.fineSlice,undefined);deliver(f,preview);
 assert.notEqual(f.renderer.cap,cap);assert.equal(f.renderer.settings.oblique,f.renderer.cap.plane);assert.equal(f.module.displayedFrame.pose,preview.pose);assert.match(f.module.$('resolution').textContent,/317.6.*Preview/);
 f.tickTimer(f.module.refineTimer);const current=await resolveSource(f,2);deliver(f,current);assert.equal(f.module.displayedFrame.poseRevision,current.poseRevision);assert.match(f.module.$('resolution').textContent,/79.4.*Ultra/);
});

test('v35 input preempts obsolete fine acoustics without leaving a stuck fine job',async()=>{
 const f=environment();await f.module.enter();const job=await resolveSource(f),worker=f.workers.at(-1);
 f.module.poseRevision++;f.module.requestFrame(true);assert.ok(worker.messages.some(x=>x.type==='cancel'));assert.equal(f.module.fineRunning,null);
 deliver(f,job);assert.equal(f.renderer.uploads,0);assert.equal(f.calls.length,1);
 f.module.requestFrame(false);assert.equal(f.calls.length,2);const current=await resolveSource(f,1);deliver(f,current);assert.equal(f.module.fineRunning,null);assert.equal(f.module.displayedFrame.poseRevision,current.poseRevision);
});

test('changing the starting preset cancels source work and rejects every old frame',async()=>{
 const f=environment();await f.module.enter();const old=f.module.fineRunning.request;f.module.selectPreset('parasternal');assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.calls.length,1);
 const before=f.renderer.uploads;f.module.acceptFrame({...frameFor(old),fine:true,refinementToken:0});assert.equal(f.renderer.uploads,before);
 f.tickTimer(f.module.refineTimer);assert.equal(f.calls.length,2);
 const job=await resolveSource(f,1);deliver(f,job);assert.equal(f.module.displayedFrame.state.preset,'parasternal');
});

test('exit aborts the fine source, clears preview timers and ignores late source completion',async()=>{
 const f=environment();await f.module.enter();const call=f.calls[0];f.module.leave();assert.equal(call.options.signal.aborted,true);assert.equal(f.module.previewTimer,0);assert.equal(f.module.fineRunning,null);
 call.resolve({});await flush();assert.equal(f.renderer.uploads,0);assert.equal(f.workers.at(-1).terminated,true);
});

test('v35 an already measured physical plane is reused during input but never moved onto a tilted plane',async()=>{
 const f=environment();await f.module.enter();const ready=await resolveSource(f);deliver(f,ready);const cached=f.module.reusableFineSlice;
 f.module.poseRevision++;f.module.requestFrame(true);const same=f.workers.at(-1).messages.findLast(x=>x.type==='sample');
 assert.equal(same.fineSlice,cached);assert.equal(same.fineSlice.data,ready.fineSlice.data);assert.equal(f.calls.length,1);
 f.module.state=steerProbe(f.module.state,{tilt:3});f.module.poseRevision++;f.module.requestFrame(true);const tilted=f.workers.at(-1).messages.findLast(x=>x.type==='sample');
 assert.equal(tilted.fineSlice,undefined);assert.equal(f.calls.length,1);assert.equal(f.module.reusableFineSlice,cached);
 f.module.state=ready.state;f.module.poseRevision++;f.module.requestFrame(true);const returned=f.workers.at(-1).messages.findLast(x=>x.type==='sample');
 assert.equal(returned.fineSlice,cached);assert.equal(f.calls.length,1,'Returning to the measured physical section reuses its immutable pixels without a request');
});

test('v35 a cleanup change accepts the new valid frame even when its source quality is lower',async()=>{
 const f=environment();await f.module.enter();const ready=await resolveSource(f);deliver(f,ready);
 f.renderer.settings.cleanupEnabled=false;f.module.invalidatePending();f.module.requestFrame(false);
 const original=f.workers.at(-1).messages.findLast(x=>x.type==='sample');deliver(f,original,{fine:false});
 assert.equal(f.module.displayedFrame.id,original.id);assert.equal(f.module.displayedFrame.cleanupEnabled,false);assert.equal(f.module.displayedFrame.fine,false);
});

test('v35 a cold same-pose fine refinement still publishes the current resident preview after explicit invalidation',async()=>{
 const f=environment();await f.module.enter();const ready=await resolveSource(f);deliver(f,ready);const oldId=f.module.displayedId;
 f.module.invalidatePending();f.module.requestFrame(false);assert.equal(f.calls.length,2);assert.ok(f.module.minFrameId>oldId);
 f.tickTimer(f.module.previewTimer);const preview=f.workers.at(-1).messages.findLast(x=>x.type==='sample');
 assert.ok(preview.id>=f.module.minFrameId);assert.equal(preview.fineSlice,undefined);deliver(f,preview);
 assert.equal(f.module.displayedFrame.id,preview.id);assert.equal(f.module.displayedFrame.fine,false);assert.match(f.module.$('frame-state').textContent,/Preview/);
});

test('v35 display cap reduction retains source pixels and reports its actual physical sampling',async()=>{
 Object.assign(globalThis,real);
 const tinyMeta={dimensions:[65,65,65],spacingUm:1000},geometry=volumeGeometry(tinyMeta),state=sanitizeProbeState({depthMm:100,originMm:[0,60,0],contactLocked:false}),pose={originMm:[0,60,0],right:[1,0,0],beam:[0,-1,0],normal:[0,0,1],up:[0,1,0]},plane=probeCapPlane(pose,geometry);
 const width=513,height=513,data=Uint8Array.from({length:width*height},(_,i)=>Math.round((i%width)/(width-1)*180+Math.floor(i/width)/(height-1)*60)),sourceSpacingUm=plane.width*geometry.longestMm*1000/(width-1),original=data.slice();
 const source={data:new Uint8Array(65**3),dimensions:tinyMeta.dimensions,meta:tinyMeta,geometry};
 const fineSlice={data,width,height,plane,spacingUm:sourceSpacingUm,sourceSpacingUm,complete:true,cleaned:true};
 const reduced=await computeProbeFrame(source,{state,pose,fast:false,width:160,beams:48,samples:128,capLongest:97,fineSlice,fineSpacingUm:sourceSpacingUm});
 assert.equal(reduced.capWidth,97);assert.equal(reduced.capHeight,97);assert.notEqual(reduced.cap,data);assert.deepEqual(data,original);assert.equal(reduced.plane,plane);
 assert.equal(reduced.cap[0],data[0]);assert.equal(reduced.cap.at(-1),data.at(-1));assert.ok(Math.abs(reduced.cap[48+48*97]-120)<=1);
 assert.equal(reduced.capSpacingUm,plane.width*geometry.longestMm*1000/96);assert.equal(reduced.stats.sourceSpacingUm,sourceSpacingUm);assert.ok(reduced.capSpacingUm>sourceSpacingUm);assert.ok(reduced.stats.capElapsedMs>=0&&reduced.stats.acousticElapsedMs>=0);
 const preview=await computeProbeFrame(source,{state,pose,fast:true,width:160,beams:48,samples:128,capLongest:97});
 assert.equal(preview.capSpacingUm,plane.width*geometry.longestMm*1000/96);assert.equal(preview.stats.sourceSpacingUm,1000);
});

test('v35 a resident live frame uses the same current-plane cap for CT and acoustic sampling',async()=>{
 Object.assign(globalThis,real);
 const tinyMeta={dimensions:[33,33,33],spacingUm:2000},geometry=volumeGeometry(tinyMeta),state=sanitizeProbeState({depthMm:100,originMm:[0,60,0],contactLocked:false}),pose={originMm:[0,60,0],right:[1,0,0],beam:[0,-1,0],normal:[0,0,1],up:[0,1,0]};
 const data=Uint8Array.from({length:33**3},(_,i)=>{const x=i%33-16,y=Math.floor(i/33)%33-16,z=Math.floor(i/(33*33))-16;return x*x+y*y+z*z<180?145+Math.round(45*Math.sin(x*.2)*Math.cos(z*.2)):0;}),original=data.slice();
 const source={data,dimensions:tinyMeta.dimensions,meta:tinyMeta,geometry},request={state,pose,fast:true,width:160,beams:64,samples:192,capLongest:97};
 const live=await computeProbeFrame(source,request),referenceSlice={data:live.cap,width:live.capWidth,height:live.capHeight,plane:live.plane,spacingUm:live.capSpacingUm,sourceSpacingUm:2000,complete:true,cleaned:true};
 const reference=await computeProbeFrame(source,{...request,fineSlice:referenceSlice,fineSpacingUm:2000});
 assert.deepEqual(live.ct,reference.ct);assert.deepEqual(live.ultrasound,reference.ultrasound);assert.ok(live.stats.tissueFraction>0);assert.equal(live.fine,false);assert.equal(live.stats.sourceSpacingUm,2000);assert.deepEqual(data,original);
});

test('a native cached plane serves a movement request without asking the worker to lower its resolution',async()=>{
 Object.assign(globalThis,real);let worker;const sent=[];
 const source=new UltraVolumeSource({activity:null,fetcher:async()=>new Response('{}'),workerFactory:()=>worker={terminate(){},postMessage(m){sent.push(m);if(m.type==='init')queueMicrotask(()=>worker.onmessage({data:{type:'ready'}}));}}});
 const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.1,height:.1};
 const first=source.samplePlane(plane,{spacingUm:79.4});await flush();const request=sent.find(x=>x.type==='sample');
 worker.onmessage({data:{type:'result',id:request.id,result:{data:new Uint8Array(4).buffer,width:2,height:2,plane,spacingUm:79.4,sourceSpacingUm:79.4,complete:true}}});const native=await first;
 const moving=await source.samplePlane(plane,{spacingUm:220});assert.equal(moving,native);assert.equal(sent.filter(x=>x.type==='sample').length,1);source.destroy();
});

test('local warm-up runs without the network gate, while optional network warming yields to input and foreground work',async()=>{
 Object.assign(globalThis,real);let worker;const sent=[],listeners=new Set();let allow=false;
 const activity={getState:()=>({allowBackground:allow}),subscribe(fn){listeners.add(fn);fn(this.getState());return()=>listeners.delete(fn);},beginForeground(){return()=>{};}};
 const source=new UltraVolumeSource({activity,fetcher:async()=>new Response('{}'),workerFactory:()=>worker={terminate(){},postMessage(m){sent.push(m);if(m.type==='init')queueMicrotask(()=>worker.onmessage({data:{type:'ready'}}));}}});
 const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.1,height:.1};
 source.scheduleWarmPlane(plane);await flush();const local=sent.find(x=>x.type==='warm');assert.equal(local.localOnly,true);
 worker.onmessage({data:{type:'warmed',id:local.id,result:{ready:3}}});await flush();assert.equal(sent.filter(x=>x.type==='warm').length,1);
 allow=true;for(const fn of listeners)fn(activity.getState());await flush();const network=sent.findLast(x=>x.type==='warm');assert.equal(network.localOnly,false);
 allow=false;for(const fn of listeners)fn(activity.getState());await flush();assert.ok(sent.some(x=>x.type==='cancel'&&x.id===network.id));
 const foreground=source.samplePlane(plane);await flush();assert.equal(listeners.size,0,'Foreground work removes the idle warm subscription');const sample=sent.findLast(x=>x.type==='sample');
 worker.onmessage({data:{type:'result',id:sample.id,result:{data:new Uint8Array(4).buffer,width:2,height:2,plane,spacingUm:79.4,sourceSpacingUm:79.4,complete:true}}});await foreground;source.destroy();
});

test('motion and settled acoustic frames from identical fine pixels are byte-identical',async()=>{
 Object.assign(globalThis,real);
 const tinyMeta={dimensions:[65,65,65],spacingUm:1000},geometry=volumeGeometry(tinyMeta),state=sanitizeProbeState({depthMm:100,originMm:[0,60,0],contactLocked:false}),pose={originMm:[0,60,0],right:[1,0,0],beam:[0,-1,0],normal:[0,0,1],up:[0,1,0]},plane=probeCapPlane(pose,geometry);
 const width=129,height=129,data=Uint8Array.from({length:width*height},(_,i)=>{const x=i%width-64,y=Math.floor(i/width)-64;return x*x+y*y<2100?130+Math.round(60*Math.sin(x*.15)*Math.cos(y*.11)):0;});
 const source={data:new Uint8Array(65**3),dimensions:tinyMeta.dimensions,meta:tinyMeta,geometry};
 const request={state,pose,width:640,beams:128,samples:480,fineSlice:{data,width,height,plane,spacingUm:79.4,sourceSpacingUm:79.4,complete:true,cleaned:true}};
 const moving=await computeProbeFrame(source,{...request,fast:true}),settled=await computeProbeFrame(source,{...request,fast:false});
 for(const key of ['ct','ultrasound','cap'])assert.deepEqual(moving[key],settled[key]);assert.equal(moving.width,settled.width);assert.equal(moving.height,settled.height);
});
