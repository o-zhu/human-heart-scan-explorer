/** Production worker scheduling in a Node worker, not browser automation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {probeCapPlane,volumeGeometry,sanitizeProbeState} from '../public/probe-geometry.js';
import {probeFrameQuality} from '../public/probe-acoustics.js';

test('v35 the real acoustic worker completes one live frame, coalesces the latest pose, and cancels obsolete fine work',async()=>{
 const moduleURL=new URL('../public/probe-acoustics-worker.js',import.meta.url).href;
 const wrapper=`import {parentPort} from 'node:worker_threads';
 globalThis.self={postMessage:(message,transfer)=>parentPort.postMessage(message,transfer)};
 await import(${JSON.stringify(moduleURL)});
 parentPort.on('message',message=>{if(message.type==='batch')for(const item of message.items)self.onmessage({data:item});else self.onmessage({data:message});});
 parentPort.postMessage({type:'ready'});`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(wrapper))),messages=[],waiters=[];
 worker.on('message',message=>{messages.push(message);for(const waiter of [...waiters])if(waiter.match(message)){clearTimeout(waiter.timer);waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(message);}});
 const until=match=>new Promise((resolve,reject)=>{const previous=messages.find(match);if(previous){resolve(previous);return;}const waiter={match,resolve};waiter.timer=setTimeout(()=>reject(new Error('The production probe worker did not finish.')),10000);waiters.push(waiter);});
 try{
  await until(message=>message.type==='ready');
  const meta={dimensions:[33,33,33],spacingUm:2000},geometry=volumeGeometry(meta),data=new Uint8Array(33**3).fill(150),state=sanitizeProbeState({depthMm:100,originMm:[0,60,0],contactLocked:false});
  const pose={originMm:[0,60,0],right:[1,0,0],beam:[0,-1,0],up:[0,1,0],normal:[0,0,1]};
  worker.postMessage({type:'load',version:1,data,meta});await until(message=>message.type==='loaded');
  const job=id=>({type:'sample',id,version:1,poseRevision:id,workKey:`live-${id}`,state,pose:{...pose,originMm:[id/100,60,0]},fast:true,cleanupEnabled:true,...probeFrameQuality(state,800,true)});
  worker.postMessage({type:'batch',items:Array.from({length:40},(_,index)=>job(index+1))});
  const last=await until(message=>message.type==='frame'&&message.id===40),frames=messages.filter(message=>message.type==='frame');
  assert.deepEqual(frames.map(frame=>frame.id),[1,40]);assert.equal(last.workKey,'live-40');assert.deepEqual(last.plane,probeCapPlane(last.pose,geometry));assert.ok(last.width<=384&&Math.max(last.capWidth,last.capHeight)<=448);
  const plane=probeCapPlane(pose,geometry),fineSlice={data:new Uint8Array(1537**2).fill(175),width:1537,height:1537,plane,spacingUm:79.4,sourceSpacingUm:79.4,complete:true,cleaned:true};
  const oldFine={...job(41),pose,fast:false,...probeFrameQuality(state,800,false),fineSlice,fineSpacingUm:79.4,refinementToken:1};
  worker.postMessage({type:'batch',items:[oldFine,{type:'cancel'},job(42),job(43)]});
  const latest=await until(message=>message.type==='frame'&&message.id===43);
  assert.deepEqual(messages.filter(message=>message.type==='frame').map(frame=>frame.id),[1,40,43]);assert.equal(messages.some(message=>message.type==='error'),false);
  assert.equal(latest.poseRevision,43);assert.equal(latest.fine,false);assert.deepEqual(latest.pose,job(43).pose);assert.deepEqual(latest.plane,probeCapPlane(latest.pose,geometry));
 }finally{for(const waiter of waiters)clearTimeout(waiter.timer);await worker.terminate();}
});
