/** Exercise startup, bounded idle work and gesture interruption with actual renderer methods. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {VolumeRenderer,volumeShaderSources} from '../public/renderer.js';

function cap(id=1){return {data:new Uint8Array(35).fill(id),width:5,height:7,cleaned:true,
 plane:{center:[0,0,id*.01],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.8,height:1}};}

function fixture(){
 const saved={window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,
  cancelAnimationFrame:globalThis.cancelAnimationFrame,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,
  performance:globalThis.performance};
 let now=1000,next=0,fenceReady=true,framebufferWorks=true,program,framebuffer=null,viewport,scissor=null,scissored=false,uniforms={};
 const frames=new Map(),timers=new Map(),calls=[],draws=[];
 globalThis.window={devicePixelRatio:1};globalThis.performance={now:()=>now};
 globalThis.requestAnimationFrame=callback=>{const id=++next;frames.set(id,callback);return id;};
 globalThis.cancelAnimationFrame=id=>frames.delete(id);
 globalThis.setTimeout=(callback,delay)=>{const id=++next;timers.set(id,{callback,at:now+delay});return id;};
 globalThis.clearTimeout=id=>timers.delete(id);
 const names=['TEXTURE0','TEXTURE1','TEXTURE2','TEXTURE3','TEXTURE4','TEXTURE5','TEXTURE_2D','TEXTURE_3D','RGBA8','RGBA','R8','RED','UNSIGNED_BYTE','FRAMEBUFFER','COLOR_ATTACHMENT0','FRAMEBUFFER_COMPLETE','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','LINEAR','NEAREST','CLAMP_TO_EDGE','TRIANGLES','SYNC_GPU_COMMANDS_COMPLETE','TIMEOUT_EXPIRED','SCISSOR_TEST'];
 const constants=Object.fromEntries(names.map((name,index)=>[name,index+1]));
 const gl=new Proxy({...constants,
  createTexture:()=>({id:++next,type:'texture'}),createFramebuffer:()=>({id:++next,type:'framebuffer'}),
  checkFramebufferStatus:()=>framebufferWorks?constants.FRAMEBUFFER_COMPLETE:0,
  useProgram(value){program=value;uniforms={};},
  bindFramebuffer(_,value){framebuffer=value;},viewport(...values){viewport=values;},
  enable(flag){if(flag===constants.SCISSOR_TEST)scissored=true;},
  disable(flag){if(flag===constants.SCISSOR_TEST)scissored=false;},scissor(...values){scissor=values;},
  clientWaitSync:()=>fenceReady?0:constants.TIMEOUT_EXPIRED,
  fenceSync:()=>({id:++next,type:'fence'}),getParameter:()=>false,
  drawArrays(){draws.push({program,framebuffer,viewport:[...viewport],scissor:scissored?[...scissor]:null,uniforms:{...uniforms}});},
 },{get(target,name){if(name in target)return target[name];return (...args)=>{
  calls.push({name,args});if(name.startsWith('uniform'))uniforms[args[0]]=args.length===2?args[1]:args.slice(1);
 };}});
 const canvas={width:0,height:0,dataset:{},getBoundingClientRect:()=>({width:1500,height:1000}),toDataURL:()=>`data:image/png;${canvas.width}x${canvas.height}`};
 const renderer=Object.assign(Object.create(VolumeRenderer.prototype),{gl,canvas,loaded:true,program:'volume',compositeProgram:'composite',
  uniforms:new Proxy({},{get:(_,key)=>key}),compositeUniforms:new Proxy({},{get:(_,key)=>key}),
  settings:{mode:0,palette:4,threshold:.28,opacity:.8,clipAxis:1,clipPosition:.5,clipFlip:0,showPlanes:0,slices:[.5,.5,.5],quality:'auto',capContrast:1.8,cutFaceExposure:1.35,cleanupEnabled:true,surfaceSmoothing:1},
  camera:{yaw:.3,pitch:.1,roll:Math.PI,distance:1.65,pan:[0,0,0]},extent:[.9,1,.9],dimensions:[475,475,530],
  capTexture:{id:'cap'},anatomyColors:Array.from({length:16},()=>[.5,.5,.5]),interactionPixels:160000,
  viewRevision:0,displayedRevision:-1,refineRequested:false,lastInteraction:0,timerExtension:null,gpuQueries:[],autoRotate:false,pending:0,
 });
 function advance(ms,runFrame=false){
  now+=ms;
  for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}
  if(runFrame){const first=frames.entries().next().value;if(first){frames.delete(first[0]);first[1](now);}}
 }
 return {renderer,canvas,gl,calls,draws,frames,timers,advance,
  frame(){advance(16,true);},ready(value){fenceReady=value;},framebufferWorks(value){framebufferWorks=value;},
  clear(){calls.length=draws.length=0;},
  close(){for(const [key,value] of Object.entries(saved))globalThis[key]=value;}};
}

test('the first usable view is a bounded scene plus a full-output current cut face',()=>{
 const h=fixture();try{
  h.renderer.requestRender();h.frame();
  assert.equal(h.draws.length,2);const [scene,face]=h.draws;
  assert(scene.viewport[2]*scene.viewport[3]<=161000);
  assert.deepEqual(face.viewport,[0,0,1500,1000]);assert.equal(face.framebuffer,null);
  assert.equal(face.uniforms.capReady,0,'A resident preview needs no image decoding or pixel upload.');
  assert.equal(face.uniforms.clipPosition,.5);assert.equal(face.uniforms.palette,4);assert.equal(face.uniforms.cutFaceExposure,1.35);
  assert.equal(h.renderer.renderStats.capSource,'resident-volume');assert.equal(h.renderer.renderStats.fullResolutionCap,true);
  assert.match(volumeShaderSources.composite,/if\(mode==0&&clipAxis>=0\)\{/);
  assert.match(volumeShaderSources.composite,/if\(capReady==0\)return cleanupAt\(p\)<\.5\?0\.:sourceDensity\(p\);/);
 }finally{h.close();}
});

test('idle full detail is rendered in bounded offscreen bands and presented only when complete',()=>{
 const h=fixture();try{
  h.renderer.setCapData(cap());h.frame();const revision=h.renderer.viewRevision;h.clear();h.advance(270);
  let nextRow=0,batches=0;
  while(h.frames.size&&batches<100){
   h.clear();h.frame();const volume=h.draws.find(draw=>draw.program==='volume');assert(volume);
   assert.notEqual(volume.framebuffer,null);assert.deepEqual(volume.viewport,[0,0,1500,1000]);
   assert.equal(volume.uniforms.resolution[0],1500);assert.equal(volume.uniforms.resolution[1],1000);
   assert.equal(volume.uniforms.skipCap,0,'Full-sized bands use the unchanged full-detail shader.');
   assert.deepEqual(volume.scissor.slice(0,3),[0,nextRow,1500]);
   assert(volume.scissor[2]*volume.scissor[3]<=160000);
   nextRow+=volume.scissor[3];batches++;
   const presented=h.draws.filter(draw=>draw.framebuffer===null);
   assert.equal(presented.length,nextRow===1000?1:0,'Partial or stale bands never reach the canvas.');
   assert.equal(h.renderer.viewRevision,revision,'Internal scheduling does not invalidate the view.');
  }
  assert.equal(nextRow,1000);assert(batches>1);assert.equal(h.renderer.completedRevision,revision);
  assert.equal(h.renderer.refineRequested,false);assert.equal(h.renderer.refinement,null);assert.equal(h.frames.size,0);
 }finally{h.close();}
});

test('new oblique input interrupts idle work after at most the one in-flight band and discards stale scenes',()=>{
 const h=fixture();try{
  h.renderer.settings.clipAxis=3;h.renderer.settings.oblique=cap(1).plane;
  h.renderer.setCapData(cap(1));h.frame();h.advance(270);h.frame();
  const oldTarget=h.renderer.refinementTarget,oldRevision=h.renderer.viewRevision;
  assert(h.renderer.refinement.nextRow>0);h.ready(false);h.clear();
  const latest=cap(9);h.renderer.setCapData(latest);h.renderer.set({oblique:latest.plane,clipPosition:.73});h.frame();
  assert.equal(h.draws.length,0);assert.equal(h.renderer.refinement,null);assert(h.renderer.viewRevision>oldRevision);
  h.ready(true);h.frame();assert.equal(h.draws.length,2);
  const [scene,face]=h.draws;assert.notEqual(scene.framebuffer,oldTarget.framebuffer);assert.equal(scene.scissor,null);
  assert.equal(scene.uniforms.clipPosition,.73);assert.equal(face.uniforms.clipPosition,.73);
  assert.deepEqual(face.uniforms.capCenter,latest.plane.center);
  assert.equal(h.renderer.refineRequested,false);h.advance(270);h.clear();h.frame();
  assert.deepEqual(h.draws[0].scissor.slice(0,2),[0,0],'The new scene starts a fresh full coverage, not old unfinished rows.');
 }finally{h.close();}
});

test('repeated busy-fence polls reduce oblique work even without a GPU timer extension',()=>{
 const h=fixture();try{
  h.renderer.settings.clipAxis=3;h.renderer.settings.oblique=cap(1).plane;
  h.renderer.requestRender();h.frame();const initial=h.renderer.interactionPixels;h.ready(false);
  h.renderer.lastInteraction=performance.now();h.renderer.set({oblique:cap(6).plane});
  h.frame();h.frame();h.frame();
  assert(h.renderer.interactionPixels<initial*.5);assert(h.renderer.interactionPixels>=35000);
  assert(h.renderer.fenceWaitLowerBoundMs>=48);assert.equal(h.renderer.timerExtension,null);
  h.ready(true);h.clear();h.frame();assert(h.renderer.renderStats.workPixels<81000);
  assert.deepEqual(h.draws.at(-1).viewport,[0,0,1500,1000],'Budget changes cannot blur the output cut face.');
 }finally{h.close();}
});

test('idle bands and snapshots cannot inflate the next moving-scene budget',()=>{
 const h=fixture();try{
  const gl=h.gl;gl.QUERY_RESULT_AVAILABLE=301;gl.QUERY_RESULT=302;
  gl.getQueryParameter=(_,kind)=>kind===gl.QUERY_RESULT_AVAILABLE?true:100000;
  h.renderer.timerExtension={GPU_DISJOINT_EXT:401};
  h.renderer.gpuQueries=[{query:{},pixels:160000,kind:'refinement'},{query:{},pixels:1500000,kind:'snapshot'}];
  h.renderer.interactionPixels=80000;h.renderer.pollGpuTimers();
  assert.equal(h.renderer.interactionPixels,80000);assert.equal(h.renderer.refinementPixels,160000);
  assert.equal(h.renderer.gpuQueries.length,0);
 }finally{h.close();}
});

test('whole-organ startup is bounded and idle refinement keeps the original full-detail rays',()=>{
 const h=fixture();try{
  h.renderer.set({clipAxis:-1});h.frame();assert.equal(h.renderer.renderStats.capPixels,0);
  const preview=h.draws[0].uniforms;h.advance(270);h.clear();h.frame();
  const idle=h.draws[0];assert(idle.scissor);assert.equal(idle.uniforms.clipAxis,-1);
  for(const key of ['threshold','palette','stepSize','surfaceSmoothing','opacity','cameraAspect','eye','forward','right','up'])assert.deepEqual(idle.uniforms[key],preview[key],key);
 }finally{h.close();}
});

test('snapshot cancels incomplete idle work and captures the accepted full-resolution view',()=>{
 const h=fixture();try{
  h.renderer.setCapData(cap(1));h.frame();h.advance(270);h.frame();h.clear();
  const latest=cap(11);h.renderer.setCapData(latest);h.ready(false);const image=h.renderer.snapshot();
  assert.match(image,/1500x1000/);assert.equal(h.draws.length,1);assert.equal(h.draws[0].framebuffer,null);
  assert.equal(h.draws[0].scissor,null);assert.deepEqual(h.draws[0].viewport,[0,0,1500,1000]);
  assert.deepEqual(h.draws[0].uniforms.capCenter,latest.plane.center);assert.equal(h.draws[0].uniforms.skipCap,0);
  assert.equal(h.renderer.refinement,null);assert.equal(h.renderer.completedRevision,h.renderer.viewRevision);
  h.advance(500);assert.equal(h.frames.size,0,'Cancelled idle work cannot overwrite the completed capture.');
 }finally{h.close();}
});

test('an unavailable optional idle target keeps the usable sharp-cap preview',()=>{
 const h=fixture();try{
  h.renderer.setCapData(cap(1));h.frame();h.framebufferWorks(false);h.advance(270);h.clear();h.frame();
  assert.equal(h.renderer.refinementTargetUnsupported,true);assert.equal(h.renderer.refinementTarget,null);
  assert.equal(h.renderer.refineRequested,false);assert.equal(h.draws.length,2);
  assert.deepEqual(h.draws.at(-1).viewport,[0,0,1500,1000]);assert.equal(h.draws.at(-1).uniforms.capReady,1);
  assert.equal(h.frames.size,0);
 }finally{h.close();}
});
