/** Firefox's per-draw index limit, complete-model submission and usable fallback.
 * Run: node --test tests/mesh-draw-batching-v37.mjs
 * The strict GL fixture models rejected draws; it is not a browser/GPU test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX_MESH_INDICES_PER_DRAW,drawIndexedTriangles,assertMeshDrawSucceeded} from '../public/mesh-draw.js';
import {FineSurfacePass} from '../public/fine-surface.js';
import {VolumeRenderer} from '../public/renderer.js';

const manifest=JSON.parse(readFileSync(new URL('../public/assets/display-compact-v29/surface-manifest.json',import.meta.url),'utf8'));
const gentle=manifest.lods.find(lod=>lod.id==='gentle');
const mainIndexCount=gentle.compactTransport.indexCount;
const firefoxLimit=30_000_000;

function strictGL({limit=firefoxLimit,reject=()=>false,contextLost=false}={}){
 const calls=[],events=[];let error=0,vao=null,framebuffer=null;
 const gl={
  NO_ERROR:0,INVALID_OPERATION:1282,TRIANGLES:4,UNSIGNED_INT:5125,FRAMEBUFFER:36160,DEPTH_TEST:2929,LEQUAL:515,DEPTH_BUFFER_BIT:256,
  drawElements(mode,count,type,offset){
   const call={mode,count,type,offset,vao};calls.push(call);
   if(count>limit||reject(call)){error=gl.INVALID_OPERATION;events.push('rejected');}
   else events.push('mesh');
  },
  getError(){const value=error;error=0;return value;},isContextLost:()=>contextLost,
  bindVertexArray(value){vao=value;},bindFramebuffer(target,value){framebuffer=value;},
  viewport(){},disable(){},enable(){},useProgram(){},getUniformLocation:(program,name)=>name,
  uniform2f(){},uniform1i(){},uniform3fv(){},depthFunc(){},clearDepth(){},clear(){},
  drawArrays(){events.push(framebuffer?'background':'volume');},
 };
 return {gl,calls,events,get framebuffer(){return framebuffer;}};
}

function assertCompleteCoverage(calls,count){
 let next=0;
 for(const call of calls){
  assert.equal(call.mode,4);assert.equal(call.type,5125);
  assert.equal(call.offset,next*Uint32Array.BYTES_PER_ELEMENT,'byte offset follows the preceding batch exactly');
  assert.equal(call.offset%12,0,'each batch starts on a whole triangle');
  assert.ok(call.count>0&&call.count<=MAX_MESH_INDICES_PER_DRAW);
  assert.equal(call.count%3,0,'no triangle is split across draws');
  next+=call.count;
 }
 assert.equal(next,count,'all original indices are drawn once, in their original order');
}

function surfaceFixture(options={}){
 const fixture=strictGL(options),{gl,events}=fixture;
 const pass=Object.assign(Object.create(FineSurfacePass.prototype),{
  gl,enabled:true,indexCount:mainIndexCount,manifest,lod:gentle,bounds:manifest.bounds,
  vao:'main',program:'surface',backgroundProgram:'background',uniforms:{},
  boundsMin:'boundsMin',boundsMax:'boundsMax',debrisEnabled:'debrisCleanupEnabled',hasDebrisMask:true,
  nativeUniforms:{nativeReplacementEnabled:'nativeReplacementEnabled',nativePatchPass:'nativePatchPass'},
  refinementUniforms:{refinementPatchPass:'refinementPatchPass',refinementPatchIndex:'refinementPatchIndex'},
  target:{texture:'color',depthTexture:'depth',framebuffer:'surface-target',width:640,height:480},
 });
 const renderer={
  gl,extent:manifest.extent,settings:{mode:0,threshold:manifest.threshold,cleanupEnabled:true,showPlanes:false,palette:0,quality:'auto',clipAxis:-1},
  bindSceneUniforms(){events.push('uniforms');return false;},
  compositeScene(){events.push('composite');},
  nativeMainDetail:{bindBase(){},draw(){gl.bindVertexArray('native');drawIndexedTriangles(gl,9);}},
  localSurfaceRefinement:{bindBase(){},draw(){gl.bindVertexArray('local');drawIndexedTriangles(gl,12);}},
 };
 return {...fixture,pass,renderer};
}

test('the shipped complete heart exceeds the Firefox single-draw limit and reproduces its nonthrowing rejection',()=>{
 assert.equal(mainIndexCount,70_856_055);assert.equal(mainIndexCount,gentle.triangles*3);
 const {gl,calls,events}=strictGL();
 assert.doesNotThrow(()=>gl.drawElements(gl.TRIANGLES,mainIndexCount,gl.UNSIGNED_INT,0));
 assert.deepEqual(events,['rejected']);assert.equal(calls.length,1);
 assert.throws(()=>assertMeshDrawSucceeded(gl),/complete detailed model.*0x502/);
});

test('bounded submission covers every real-model triangle, including the final partial batch',()=>{
 const {gl,calls}=strictGL();
 const draws=drawIndexedTriangles(gl,mainIndexCount);
 assert.equal(MAX_MESH_INDICES_PER_DRAW%3,0);assert.ok(MAX_MESH_INDICES_PER_DRAW<firefoxLimit);
 assert.equal(draws,24);assert.equal(calls.length,draws);
 assertCompleteCoverage(calls,mainIndexCount);
 assert.equal(calls.at(-1).count,1_856_055);assert.equal(calls.at(-1).offset,276_000_000);
 assert.doesNotThrow(()=>assertMeshDrawSucceeded(gl));
});

test('empty, exact-boundary and adjacent triangle counts preserve complete sequential coverage',()=>{
 for(const count of [0,3,MAX_MESH_INDICES_PER_DRAW-3,MAX_MESH_INDICES_PER_DRAW,MAX_MESH_INDICES_PER_DRAW+3,firefoxLimit]){
  const {gl,calls}=strictGL();
  assert.equal(drawIndexedTriangles(gl,count),Math.ceil(count/MAX_MESH_INDICES_PER_DRAW));
  assertCompleteCoverage(calls,count);assertMeshDrawSucceeded(gl);
 }
});

test('invalid counts fail before submitting any geometry',()=>{
 for(const count of [-3,1,4,1.5,NaN,Infinity,undefined,'3',Number.MAX_SAFE_INTEGER,0x80000001]){
  const {gl,calls}=strictGL();
  assert.throws(()=>drawIndexedTriangles(gl,count),/invalid triangle count/);
  assert.equal(calls.length,0);
 }
});

test('the draw checker catches a lost context even when getError returns NO_ERROR',()=>{
 const {gl}=strictGL({contextLost:true});
 assert.equal(gl.getError(),gl.NO_ERROR);
 assert.throws(()=>assertMeshDrawSucceeded(gl),/complete detailed model/);
});

test('production FineSurfacePass draws the full base and both patch passes before compositing',()=>{
 const {pass,renderer,calls,events}=surfaceFixture();
 pass.draw(renderer,640,480,{},4/3);
 assertCompleteCoverage(calls.filter(call=>call.vao==='main'),mainIndexCount);
 assert.equal(pass.drawCalls,24);
 assert.deepEqual(calls.slice(-2).map(call=>[call.vao,call.count]),[['native',9],['local',12]]);
 assert.equal(events.filter(event=>event==='composite').length,1);
 assert.equal(events.at(-1),'composite');assert.equal(events.includes('rejected'),false);
});

test('production FineSurfacePass never presents patch-only geometry if any base draw is rejected',()=>{
 const {pass,renderer,events}=surfaceFixture({reject:call=>call.vao==='main'&&call.offset===12_000_000});
 assert.throws(()=>pass.draw(renderer,640,480,{},4/3),/complete detailed model/);
 assert.equal(events.filter(event=>event==='rejected').length,1);
 assert.equal(events.includes('composite'),false);
});

test('production FineSurfacePass also prevents presentation when a patch draw fails',()=>{
 const {pass,renderer,events}=surfaceFixture({reject:call=>call.vao==='local'});
 assert.throws(()=>pass.draw(renderer,640,480,{},4/3),/complete detailed model/);
 assert.equal(events.includes('composite'),false);
});

test('a retained compact fallback releases only after one complete successful Ultra presentation',()=>{
 const good=surfaceFixture();let completed=0;
 good.pass.onPresented=()=>{completed++;};
 good.pass.draw(good.renderer,640,480,{},4/3);assert.equal(completed,1);assert.equal(good.pass.onPresented,null);
 good.pass.draw(good.renderer,640,480,{},4/3);assert.equal(completed,1,'The fallback-release callback runs once.');
 const bad=surfaceFixture({reject:call=>call.vao==='local'});bad.pass.onPresented=()=>{completed++;};
 assert.throws(()=>bad.pass.draw(bad.renderer,640,480,{},4/3),/complete detailed model/);assert.equal(completed,1,'A rejected model never releases its usable fallback.');
});

test('production renderer disables a rejected detailed pass and presents the existing volume fallback',()=>{
 const f=surfaceFixture({reject:call=>call.vao==='main'}),{pass,renderer,events}=f;
 const errors=[];pass.onError=error=>errors.push(error);
 Object.assign(renderer,{
  loaded:true,fineSurface:pass,renderProfile:'reconstruction',viewRevision:1,
  canvas:{width:640,height:480,dataset:{},getBoundingClientRect:()=>({width:640,height:480})},
  camera:{yaw:0,pitch:0,distance:2,pan:[0,0,0],target:[0,0,0]},
  pollGpuTimers(){},uploadCapData(){},basis:VolumeRenderer.prototype.basis,prepareSceneDepth(){},
  drawContextLayer(){events.push('context');},
 });
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{value:{devicePixelRatio:1},configurable:true});
 try{
  VolumeRenderer.prototype.render.call(renderer,true);
  assert.equal(pass.enabled,false);assert.equal(errors.length,1);
  assert.match(errors[0].message,/complete detailed model/);
  assert.equal(events.includes('composite'),false,'the incomplete mesh target is never presented');
  assert.equal(events.filter(event=>event==='volume').length,1,'the existing volume is rendered to the visible framebuffer');
  assert.equal(renderer.renderStats.presented,true);assert.equal(renderer.renderStats.fineSurface,undefined);
  assert.equal(renderer.canvas.dataset.rendered,'true');assert.equal(renderer.completedRevision,1);
 }finally{
  if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete globalThis.window;
 }
});
