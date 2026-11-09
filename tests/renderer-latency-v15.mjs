/** Actual renderer orchestration with a recording WebGL interface; no browser. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {VolumeRenderer} from '../public/renderer.js';

function cap(id=1,width=3,height=4){
 return {key:'slice-'+id,data:new Uint8Array(width*height).fill(id),width,height,
  cleaned:true,spacingUm:79.4,sectionAxis:1,sectionIndex:id,
  plane:{center:[0,0,id*.001],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.9,height:1}};
}
function fixture(){
 const calls=[],draws=[];let fenceReady=true,program,viewport,boundFramebuffer=null;
 const names=['TEXTURE0','TEXTURE1','TEXTURE2','TEXTURE3','TEXTURE4','TEXTURE5','TEXTURE_2D','TEXTURE_3D','RGBA8','RGBA','R8','RED','UNSIGNED_BYTE','FRAMEBUFFER','COLOR_ATTACHMENT0','FRAMEBUFFER_COMPLETE','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','LINEAR','CLAMP_TO_EDGE','TRIANGLES','SYNC_GPU_COMMANDS_COMPLETE','TIMEOUT_EXPIRED'];
 const constants=Object.fromEntries(names.map((name,i)=>[name,i+1]));let uniforms={};
 const gl=new Proxy({...constants,
  createTexture(){return {};},createFramebuffer(){return {};},
  checkFramebufferStatus(){return constants.FRAMEBUFFER_COMPLETE;},
  clientWaitSync(){calls.push({name:'clientWaitSync'});return fenceReady?0:constants.TIMEOUT_EXPIRED;},
  deleteSync(){calls.push({name:'deleteSync'});},fenceSync(){return {};},
  useProgram(value){program=value;uniforms={};},
  bindFramebuffer(_,value){boundFramebuffer=value;},viewport(...value){viewport=value;},
  drawArrays(){calls.push({name:'drawArrays'});draws.push({program,viewport,framebuffer:boundFramebuffer,uniforms:{...uniforms}});},
  getParameter(){return false;}
 },{get(target,name){if(name in target)return target[name];return (...args)=>{
  calls.push({name,args});if(name.startsWith('uniform'))uniforms[args[0]]=args.length===2?args[1]:args.slice(1);
 };}});
 // Keep this upload-focused fixture within one ordinary preview batch. The
 // larger-canvas progressive path is exercised by renderer-responsiveness-v16.
 const canvas={width:240,height:200,dataset:{},getBoundingClientRect:()=>({width:240,height:200}),
  toDataURL(){calls.push({name:'toDataURL'});return 'data:image/png;fixture';}};
 const renderer=Object.assign(Object.create(VolumeRenderer.prototype),{
  gl,canvas,loaded:true,program:'volume',compositeProgram:'composite',
  uniforms:new Proxy({},{get:(_,name)=>name}),compositeUniforms:new Proxy({},{get:(_,name)=>name}),
  settings:{mode:0,palette:4,threshold:.28,opacity:.8,clipAxis:1,clipPosition:.5,clipFlip:0,showPlanes:0,
   slices:[.5,.5,.5],quality:'auto',capContrast:1,cutFaceExposure:1.35,cleanupEnabled:true,surfaceSmoothing:1},
  camera:{yaw:.3,pitch:.1,roll:Math.PI,distance:1.65,pan:[0,0,0]},extent:[.9,1,.9],dimensions:[475,475,530],
  capTexture:{},anatomyColors:Array.from({length:16},()=>[.5,.5,.5]),interactionPixels:70000,
  lastInteraction:-1e6,timerExtension:null,gpuQueries:[],autoRotate:false,pending:0,
  // Match requestRender's invalidation contract while this upload-only fixture
  // deliberately omits RAF/timer scheduling. Completed views now skip redraws.
  requestRender(){this.requests=(this.requests||0)+1;this.viewRevision=(this.viewRevision||0)+1;this.refinement=null;this.refineRequested=false;}
 });
 globalThis.window={devicePixelRatio:1};globalThis.requestAnimationFrame=()=>1;
 return {renderer,gl,canvas,calls,draws,ready(value){fenceReady=value;},clear(){calls.length=draws.length=0;renderer.pending=0;},
  uploads(){return calls.filter(c=>(c.name==='texImage2D'||c.name==='texSubImage2D')&&c.args.at(-1)!==null);},
  allocations(){return calls.filter(c=>c.name==='texImage2D'&&c.args.at(-1)===null);}};
}

test('a burst of accepted slices stages only the latest native pixels and performs no input-time WebGL calls',()=>{
 const h=fixture();let last;
 for(let index=0;index<24;index++)h.renderer.setCapData(last=cap(index));
 assert.equal(h.renderer.cap,last,'The application sees the accepted metadata immediately.');
 assert.equal(h.calls.length,0,'Input does not upload or synchronize the graphics queue.');
 h.renderer.render();const uploads=h.uploads();
 assert.equal(uploads.length,1);assert.equal(uploads[0].name,'texSubImage2D');assert.equal(h.allocations().length,1);
 assert.equal(uploads[0].args.at(-1),last.data,'Only the last requested source buffer reaches the GPU.');
 assert.deepEqual(h.draws[0].uniforms.capCenter,last.plane.center);
});

test('an in-flight GPU frame delays both the new upload and draw until its fence is ready',()=>{
 const h=fixture();h.renderer.setCapData(cap(1));h.renderer.render();h.clear();h.ready(false);
 const next=cap(2);h.renderer.setCapData(next);h.renderer.settings.clipPosition=.6;h.renderer.render();
 assert.equal(h.renderer.cap,next);assert.equal(h.uploads().length,0);assert.equal(h.draws.length,0);
 assert.ok(h.renderer.pending,'The latest view remains scheduled.');
 h.ready(true);h.renderer.render();assert.equal(h.uploads().length,1);assert.equal(h.draws.length,1);
 assert.equal(h.uploads()[0].args.at(-1),next.data);assert.equal(h.draws[0].uniforms.clipPosition,.6);
 assert.deepEqual(h.draws[0].uniforms.capCenter,next.plane.center);
 assert.ok(h.calls.findIndex(c=>c.name==='deleteSync')<h.calls.findIndex(c=>c.name==='texSubImage2D'));
 assert.ok(h.calls.findIndex(c=>c.name==='texSubImage2D')<h.calls.findIndex(c=>c.name==='drawArrays'));
});

test('a queued slice superseded while the GPU is busy is never uploaded later',()=>{
 const h=fixture();h.renderer.setCapData(cap(1));h.renderer.render();h.clear();h.ready(false);
 h.renderer.setCapData(cap(2));h.renderer.render();const latest=cap(3);h.renderer.setCapData(latest);h.renderer.render();
 assert.equal(h.uploads().length,0);h.ready(true);h.renderer.render();
 assert.equal(h.uploads().length,1);assert.equal(h.uploads()[0].args.at(-1),latest.data);
});

test('unchanged source pixels reposition without upload, while new pixels reuse the texture allocation',()=>{
 const h=fixture(),a=cap(1);h.renderer.setCapData(a);h.renderer.render();h.clear();
 const moved={...a,plane:{...a.plane,center:[.1,0,0]}};h.renderer.setCapData(moved);h.renderer.render();
 assert.equal(h.uploads().length,0);assert.deepEqual(h.draws[0].uniforms.capCenter,moved.plane.center);
 h.clear();const next=cap(2);h.renderer.setCapData(next);h.renderer.render();
 assert.equal(h.uploads().length,1);assert.equal(h.uploads()[0].name,'texSubImage2D');assert.equal(h.uploads()[0].args.at(-1),next.data);
 h.clear();h.renderer.setCapData(cap(3,5,7));h.renderer.render();
 assert.equal(h.allocations().length,0,'Slightly different crop sizes reuse the existing storage.');
 assert.equal(h.uploads()[0].name,'texSubImage2D');assert.deepEqual(h.draws[0].uniforms.capRasterSize,[5,7]);
 h.clear();h.renderer.setCapData(cap(4,257,513));h.renderer.render();
 assert.equal(h.allocations().length,1);assert.deepEqual(h.allocations()[0].args.slice(3,5),[512,768]);
 assert.deepEqual(h.draws[0].uniforms.capRasterSize,[257,513]);
 h.clear();h.renderer.setCapData(cap(5,11,13));h.renderer.render();assert.equal(h.allocations().length,0);
 assert.deepEqual([h.renderer.capTextureWidth,h.renderer.capTextureHeight],[512,768],'Storage does not churn when later crops shrink.');
 assert.deepEqual(h.draws[0].uniforms.capRasterSize,[11,13]);
});

test('clearing a staged cap avoids uploading it and removes the cap from the next frame',()=>{
 const h=fixture();h.renderer.setCapData(cap(1));h.renderer.render();h.clear();
 h.renderer.setCapData(cap(2,11,13));h.renderer.clearCapData();h.renderer.render();
 assert.equal(h.uploads().length,0);assert.equal(h.draws[0].uniforms.capReady,0);
});

test('a snapshot uploads the latest native face before its forced full-resolution draw',()=>{
 const h=fixture();h.renderer.setCapData(cap(1));h.renderer.render();h.clear();h.ready(false);
 const latest=cap(2,11,13);h.renderer.setCapData(latest);h.renderer.interacting=true;
 assert.match(h.renderer.snapshot(),/^data:image\/png/);assert.equal(h.uploads().length,1);
 assert.equal(h.uploads()[0].args.at(-1),latest.data);assert.equal(h.draws.length,1);assert.equal(h.draws[0].uniforms.skipCap,0);
 assert.ok(h.calls.findIndex(c=>c.name==='texSubImage2D')<h.calls.findIndex(c=>c.name==='drawArrays'));
 assert.ok(h.calls.findIndex(c=>c.name==='drawArrays')<h.calls.findIndex(c=>c.name==='toDataURL'));
});

test('hidden or unloaded canvases do not spend GPU work uploading pending detail',()=>{
 const h=fixture();h.renderer.loaded=false;h.renderer.setCapData(cap(1));h.renderer.render();assert.equal(h.calls.length,0);
 h.renderer.loaded=true;h.canvas.getBoundingClientRect=()=>({width:0,height:0});h.renderer.render();assert.equal(h.calls.length,0);
 h.canvas.getBoundingClientRect=()=>({width:768,height:512});h.renderer.render();assert.equal(h.uploads().length,1);
});
