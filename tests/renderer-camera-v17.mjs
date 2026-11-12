/** Stable camera, section and Lab detail with bounded latest-only GPU work. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {VolumeRenderer} from '../public/renderer.js';
import {orthogonalFrame} from '../public/planes.js';
import {getDeviceResourcePolicy} from '../public/device-resources.js';

function cap(id=1){return {data:new Uint8Array(35).fill(id),width:5,height:7,cleaned:true,
 plane:{center:[0,0,id*.01],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.8,height:1}};}

function fixture({width=1500,height=1000,renderProfile}={}){
 const saved={window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,
  cancelAnimationFrame:globalThis.cancelAnimationFrame,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,
  performance:globalThis.performance};
 let now=1000,next=0,fenceReady=true,framebufferWorks=true,program,framebuffer=null,viewport,scissor=null,scissored=false,uniforms={};
 const frames=new Map(),timers=new Map(),calls=[],draws=[],listeners=new Map();
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
 const canvas={width:0,height:0,dataset:{},style:{},setPointerCapture(){},addEventListener(name,callback){listeners.set(name,callback);},getBoundingClientRect:()=>({width,height}),toDataURL:()=>`data:image/png;${canvas.width}x${canvas.height}`};
 const renderer=Object.assign(Object.create(VolumeRenderer.prototype),{gl,canvas,loaded:true,program:'volume',compositeProgram:'composite',
  // These fixtures exercise requested desktop fidelity; constrained/unknown
  // hardware budgets are verified independently by resource-policy tests.
  resourcePolicy:getDeviceResourcePolicy({navigator:{deviceMemory:8,hardwareConcurrency:8,userAgent:'Desktop'}}),
  uniforms:new Proxy({},{get:(_,key)=>key}),compositeUniforms:new Proxy({},{get:(_,key)=>key}),
  settings:{mode:0,palette:4,threshold:.28,opacity:.8,clipAxis:1,clipPosition:.5,clipFlip:0,showPlanes:0,slices:[.5,.5,.5],quality:'auto',capContrast:1.8,cutFaceExposure:1.35,cleanupEnabled:true,surfaceSmoothing:1},
  camera:{yaw:.3,pitch:.1,roll:Math.PI,distance:1.65,pan:[0,0,0]},extent:[.9,1,.9],dimensions:[475,475,530],
  capTexture:{id:'cap'},anatomyColors:Array.from({length:16},()=>[.5,.5,.5]),interactionPixels:160000,
  viewRevision:0,displayedRevision:-1,refineRequested:false,lastInteraction:0,timerExtension:null,gpuQueries:[],autoRotate:false,pending:0,renderProfile,onChange(){},
 });
 renderer.bindControls();
 function advance(ms,runFrame=false){
  now+=ms;
  for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}
  if(runFrame){const first=frames.entries().next().value;if(first){frames.delete(first[0]);first[1](now);}}
 }
 return {renderer,canvas,gl,calls,draws,frames,timers,advance,
  event(name,fields={}){listeners.get(name)?.({pointerId:1,clientX:100,clientY:100,button:0,preventDefault(){},...fields});},
  frame(){advance(16,true);},ready(value){fenceReady=value;},framebufferWorks(value){framebufferWorks=value;},
  clear(){calls.length=draws.length=0;},
  close(){for(const [key,value] of Object.entries(saved))globalThis[key]=value;}};
}

function assertNativeCamera(h){
 assert.equal(h.draws.length,1,'One native scene pass; no enlarged low-resolution background.');
 const draw=h.draws[0];assert.equal(draw.program,'volume');assert.equal(draw.framebuffer,null);
 assert.deepEqual(draw.viewport,[0,0,h.canvas.width,h.canvas.height]);assert.equal(draw.scissor,null);
 assert.deepEqual(draw.uniforms.resolution,[h.canvas.width,h.canvas.height]);assert.equal(draw.uniforms.skipCap,0);
 assert.equal(h.renderer.renderStats.volumePixels,h.renderer.renderStats.outputPixels);
 assert.equal(h.renderer.renderStats.cameraQuality,true);assert.equal(h.renderer.submittedFrame.kind,'camera');
 return draw;
}

function assertNativeSection(h){
 assert.equal(h.draws.length,1,'One native scene pass; scrolling never enlarges a low-resolution surface.');
 const draw=h.draws[0];assert.equal(draw.program,'volume');assert.equal(draw.framebuffer,null);
 assert.deepEqual(draw.viewport,[0,0,h.canvas.width,h.canvas.height]);assert.equal(draw.scissor,null);
 assert.deepEqual(draw.uniforms.resolution,[h.canvas.width,h.canvas.height]);assert.equal(draw.uniforms.skipCap,0);
 assert.equal(h.renderer.renderStats.volumePixels,h.renderer.renderStats.outputPixels);
 assert.equal(h.renderer.renderStats.cameraQuality,false);assert.equal(h.renderer.renderStats.sectionQuality,true);
 assert.equal(h.renderer.submittedFrame.kind,'section');assert.equal(h.renderer.completedRevision,h.renderer.viewRevision);
 return draw;
}

test('an actual pointer orbit keeps the settled scene grid, then release and idle leave it sharp',()=>{
 const h=fixture();try{
  h.renderer.setCapData(cap());h.frame();h.renderer.snapshot();const idle=h.draws.at(-1),size=[h.canvas.width,h.canvas.height];
  h.clear();h.event('pointerdown');assert.equal(h.frames.size,0,'Pointer capture alone does not replace the completed view.');
  h.event('pointermove',{clientX:126,clientY:110});h.frame();const moving=assertNativeCamera(h);
  assert.deepEqual([h.canvas.width,h.canvas.height],size);
  for(const key of ['palette','threshold','stepSize','surfaceSmoothing','capContrast','cutFaceExposure','windowLow','windowHigh','windowGamma'])assert.deepEqual(moving.uniforms[key],idle.uniforms[key],key);
  assert.notDeepEqual(moving.uniforms.eye,idle.uniforms.eye);
  const revision=h.renderer.viewRevision;h.clear();h.event('pointerup');h.frame();h.event('lostpointercapture');h.frame();h.advance(350);
  assert.equal(h.draws.length,0,'Releasing the pointer does not redraw a coarse preview or a redundant expensive frame.');
  assert.equal(h.renderer.viewRevision,revision);assert.equal(h.frames.size,0);assert.equal(h.renderer.cameraQuality,true);
 }finally{h.close();}
});

test('wheel zoom, pointer pan, pinch zoom and keyboard camera changes all retain native scene detail',()=>{
 for(const gesture of ['wheel','pan','pinch','keyboard']){
  const h=fixture();try{
   h.renderer.requestRender();h.frame();h.clear();
   if(gesture==='wheel')h.event('wheel',{deltaY:-130});
   if(gesture==='keyboard')h.event('keydown',{key:'ArrowRight'});
   if(gesture==='pan'){h.event('pointerdown',{button:2});h.event('pointermove',{clientX:135,clientY:118});}
   if(gesture==='pinch'){
    h.event('pointerdown');h.event('pointerdown',{pointerId:2,clientX:180});
    h.event('pointermove',{pointerId:2,clientX:190});h.event('pointermove',{pointerId:2,clientX:230});
   }
   h.frame();assertNativeCamera(h);
  }finally{h.close();}
 }
});

test('late Ultra pixels preserve camera quality while identical setting callbacks schedule no extra work',()=>{
 const h=fixture();try{
  h.renderer.requestRender();h.frame();h.event('wheel',{deltaY:-100});h.frame();h.clear();
  const fresh=cap(7);h.renderer.setCapData(fresh);h.frame();const draw=assertNativeCamera(h);
  assert.deepEqual(draw.uniforms.capCenter,fresh.plane.center);assert.equal(draw.uniforms.capReady,1);
  h.clear();const revision=h.renderer.viewRevision;
  for(let i=0;i<20;i++)h.renderer.set({palette:4,slices:[.5,.5,.5],quality:'auto'});
  assert.equal(h.renderer.viewRevision,revision);assert.equal(h.frames.size,0);assert.equal(h.calls.length,0);
  h.advance(350);assert.equal(h.frames.size,0);
 }finally{h.close();}
});

test('the first loaded volume stays bounded and a later source-resolution upgrade preserves camera quality',()=>{
 const h=fixture();try{
  h.renderer.loaded=false;h.gl.MAX_3D_TEXTURE_SIZE=500;h.gl.NO_ERROR=0;
  h.gl.getParameter=key=>key===h.gl.MAX_3D_TEXTURE_SIZE?4096:false;h.gl.getError=()=>0;
  h.renderer.load(new Uint8Array(64),{dimensions:[4,4,4],spacingUm:1});h.frame();
  assert.equal(h.draws.length,2);assert(h.renderer.renderStats.volumePixels<=161000);
  h.event('wheel',{deltaY:-80});h.frame();h.clear();
  h.renderer.load(new Uint8Array(512),{dimensions:[8,8,8],spacingUm:.5});h.frame();assertNativeCamera(h);
  assert.deepEqual(h.draws[0].uniforms.dimensions,[8,8,8]);
 }finally{h.close();}
});

test('rapid orthogonal slice changes retain native surface detail and the latest resident plane',()=>{
 const h=fixture();try{
  h.renderer.requestRender();h.frame();h.event('wheel',{deltaY:-100});h.frame();h.clear();
  for(const clipPosition of [.51,.55,.62,.78,.91]){h.renderer.lastInteraction=performance.now();h.renderer.set({clipPosition});h.renderer.clearCapData();}
  assert.equal(h.renderer.cameraQuality,false);assert.equal(h.frames.size,1);
  h.frame();const scene=assertNativeSection(h);
  assert.equal(scene.uniforms.clipPosition,.91);assert.equal(scene.uniforms.capReady,0);
  assert.equal(h.renderer.renderStats.capSource,'resident-volume');assert.equal(h.renderer.renderStats.cameraQuality,false);
  h.clear();const fresh={...cap(12),plane:orthogonalFrame(1,.91,h.renderer.extent)};
  h.renderer.setCapData(fresh);h.frame();const fine=assertNativeSection(h);
  assert.deepEqual(fine.uniforms.capCenter,fresh.plane.center);assert.equal(fine.uniforms.capReady,1);
  h.clear();h.advance(350);assert.equal(h.frames.size,0);assert.equal(h.draws.length,0,'Idle cannot repaint a coarse scene over the sharp section.');
 }finally{h.close();}
});

test('one busy camera frame coalesces many camera changes and cap arrivals to only the latest pose',()=>{
 const h=fixture();try{
  h.renderer.requestRender();h.frame();h.event('wheel',{deltaY:-100});h.frame();h.ready(false);h.clear();
  h.event('pointerdown');let latest;
  for(let i=1;i<=24;i++){
   h.event('pointermove',{clientX:100+i*4,clientY:100+i});h.renderer.setCapData(latest=cap(i));h.frame();
   assert.equal(h.frames.size,1);assert.equal(h.draws.length,0);
  }
  assert(!h.calls.some(call=>call.name==='texSubImage2D'),'Busy frames cannot upload intermediate caps.');
  const expected=h.renderer.basis();h.ready(true);h.frame();const draw=assertNativeCamera(h);
  assert.deepEqual(draw.uniforms.eye,expected.eye);assert.deepEqual(draw.uniforms.forward,expected.forward);
  assert.deepEqual(draw.uniforms.capCenter,latest.plane.center);
  const uploads=h.calls.filter(call=>call.name==='texSubImage2D');assert.equal(uploads.length,1);assert.equal(uploads[0].args.at(-1),latest.data);
 }finally{h.close();}
});

test('slow camera frames retain explicit quality and do not alter the separate oblique work budget',()=>{
 const h=fixture();try{
  h.renderer.interactionPixels=80000;h.renderer.requestRender();h.frame();h.event('wheel',{deltaY:-80});h.frame();
  h.ready(false);h.event('wheel',{deltaY:-20});for(let i=0;i<8;i++)h.frame();
  assert.equal(h.renderer.interactionPixels,80000);assert(h.renderer.cameraWaitLowerBoundMs>=48);
  h.ready(true);h.clear();h.frame();assertNativeCamera(h);
  const gl=h.gl;gl.QUERY_RESULT_AVAILABLE=301;gl.QUERY_RESULT=302;
  gl.getQueryParameter=(_,kind)=>kind===gl.QUERY_RESULT_AVAILABLE?true:400000000;
  h.renderer.timerExtension={GPU_DISJOINT_EXT:401};h.renderer.gpuQueries=[{query:{},pixels:1500000,kind:'camera'}];
  h.renderer.pollGpuTimers();assert.equal(h.renderer.cameraFrameMs,400);assert.equal(h.renderer.interactionPixels,80000);
  h.renderer.timerExtension=null;h.clear();h.renderer.set({clipAxis:3,oblique:cap(6).plane});h.frame();
  assert(h.renderer.renderStats.volumePixels<81000);assert.equal(h.renderer.renderStats.cameraQuality,false);
 }finally{h.close();}
});

test('a camera gesture interrupts partial idle refinement without presenting unfinished bands',()=>{
 const h=fixture();try{
  h.renderer.requestRender();h.frame();h.advance(270);h.frame();assert(h.renderer.refinement.nextRow>0);
  h.ready(false);h.clear();h.event('pointerdown');h.event('pointermove',{clientX:140});h.frame();
  assert.equal(h.draws.length,0);assert.equal(h.renderer.refinement,null);
  h.ready(true);h.frame();assertNativeCamera(h);assert.equal(h.renderer.completedRevision,h.renderer.viewRevision);
  h.clear();h.event('pointerup');h.frame();h.advance(350);assert.equal(h.draws.length,0);assert.equal(h.frames.size,0);
 }finally{h.close();}
});

test('programmatic camera restores and auto rotation also keep a native scene grid',()=>{
 const h=fixture();try{
  h.renderer.requestRender();h.frame();h.clear();h.renderer.camera.pan=[.1,-.1,0];h.renderer.requestRender();h.frame();assertNativeCamera(h);
  h.clear();h.renderer.set({clipPosition:.65});h.frame();assert.equal(h.renderer.renderStats.cameraQuality,false);
  h.clear();h.renderer.autoRotate=true;h.renderer.requestRender();h.frame();assertNativeCamera(h);assert.equal(h.frames.size,1);
  h.clear();h.frame();assertNativeCamera(h);h.renderer.autoRotate=false;
 }finally{h.close();}
});

test('a locked camera following an Echo slice stays on the bounded scene path',()=>{
 const h=fixture();try{
  h.renderer.requestRender();h.frame();h.event('wheel',{deltaY:-50});h.frame();h.clear();
  const plane={normal:[0,0,1],up:[0,-1,0],right:[1,0,0],center:[0,0,.1],width:1,height:1};
  h.renderer.set({clipAxis:3,oblique:plane});h.renderer.clearCapData();
  h.renderer.alignPlane(plane.normal,plane.up,plane.center,{followScene:true});h.frame();
  assert.equal(h.draws.length,2);assert(h.renderer.renderStats.volumePixels<=161000);
  assert.equal(h.renderer.renderStats.cameraQuality,false);assert.equal(h.draws.at(-1).uniforms.planeDistance,.1);
  h.clear();h.renderer.alignPlane(plane.normal,plane.up,plane.center);h.frame();assertNativeCamera(h);
 }finally{h.close();}
});

test('auto-rotation respects orthogonal section intent without lowering the section grid',()=>{
 const h=fixture();try{
  h.renderer.requestRender();h.frame();h.renderer.autoRotate=true;h.renderer.requestRender();h.frame();h.clear();
  for(let i=1;i<=12;i++){
   h.renderer.set({clipPosition:.5+i*.01});h.frame();assertNativeSection(h);h.clear();
  }
  h.frame();assertNativeSection(h);
  h.clear();h.advance(180);h.frame();assertNativeCamera(h);
  assert.equal(h.draws[0].uniforms.clipPosition,.62);h.renderer.autoRotate=false;
 }finally{h.close();}
});

test('first-axis clinical alignment preserves section detail while oblique tracking stays bounded',()=>{
 const h=fixture();try{
  h.renderer.settings.clipAxis=-1;h.renderer.requestRender();h.frame();h.clear();
  const plane=orthogonalFrame(0,.61,h.renderer.extent);
  // The clinical controller follows this order when scrolling a new axis.
  h.renderer.clearCapData();h.renderer.set({mode:0,clipAxis:0,clipPosition:.61,oblique:null});
  h.renderer.alignPlane(plane.normal,plane.up,plane.center,{followScene:true});h.frame();const draw=assertNativeSection(h);
  assert.deepEqual(draw.uniforms.planeNormal,[1,0,0]);assert.deepEqual(h.renderer.camera.pan,plane.center);
  assert.equal(draw.uniforms.capReady,0);
  h.clear();h.renderer.set({clipAxis:3,oblique:plane});
  h.renderer.alignPlane(plane.normal,plane.up,plane.center,{followScene:true});h.frame();
  assert.equal(h.renderer.sectionQuality,false);assert.equal(h.renderer.cameraQuality,false);
  assert(h.renderer.renderStats.volumePixels<=161000);
 }finally{h.close();}
});

test('late cap delivery during auto-rotation preserves active section intent, while a manual camera command takes over',()=>{
 const h=fixture();try{
  h.renderer.autoRotate=true;h.renderer.requestRender('camera');h.frame();
  h.renderer.set({clipPosition:.62});h.frame();h.clear();
  const fresh={...cap(6),plane:orthogonalFrame(1,.62,h.renderer.extent)};
  h.renderer.setCapData(fresh);h.frame();const draw=assertNativeSection(h);
  assert.deepEqual(draw.uniforms.capCenter,fresh.plane.center);
  h.clear();h.event('wheel',{deltaY:-50});h.frame();assertNativeCamera(h);
  h.renderer.autoRotate=false;
 }finally{h.close();}
});

test('all orthogonal axes and retained sides use the same surface and cap inputs as a settled frame',()=>{
 const h=fixture();try{
  h.renderer.requestRender();h.frame();h.renderer.interactionPixels=35000;
  for(const axis of [0,1,2])for(const flip of [0,1]){
   h.clear();const position=.57+axis*.07,frame=orthogonalFrame(axis,position,h.renderer.extent);
   h.renderer.lastInteraction=performance.now();h.renderer.set({clipAxis:axis,clipPosition:position,clipFlip:flip});
   h.renderer.setCapData({...cap(axis*2+flip+1),plane:frame});h.frame();const moving=assertNativeSection(h);
   assert.equal(moving.uniforms.clipAxis,axis);assert.equal(moving.uniforms.clipFlip,flip);
   assert.deepEqual(moving.uniforms.capCenter,frame.center);
   h.clear();h.renderer.snapshot();
   assert.deepEqual(h.draws[0].viewport,moving.viewport);
   assert.deepEqual(h.draws[0].uniforms,moving.uniforms,'Scrolling and settled rendering use identical source rays, transfer, cut plane and pixels.');
  }
 }finally{h.close();}
});

test('a busy native section frame coalesces every pending plane and cap to the latest state',()=>{
 const h=fixture();try{
  h.renderer.set({clipPosition:.51});h.frame();h.ready(false);h.clear();let latest;
  for(let i=1;i<=24;i++){
   const position=.51+i*.01;h.renderer.lastInteraction=performance.now();h.renderer.set({clipPosition:position});
   latest={...cap(i),plane:orthogonalFrame(1,position,h.renderer.extent)};h.renderer.setCapData(latest);h.frame();
   assert.equal(h.frames.size,1);assert.equal(h.draws.length,0);
  }
  assert(!h.calls.some(call=>call.name==='texSubImage2D'),'No intermediate cap uploads may queue behind a busy frame.');
  assert.equal(h.renderer.interactionPixels,160000,'A costly section cannot change the bounded oblique budget.');
  assert(h.renderer.sectionWaitLowerBoundMs>=48);
  h.ready(true);h.frame();const draw=assertNativeSection(h);
  assert.equal(draw.uniforms.clipPosition,.75);assert.deepEqual(draw.uniforms.capCenter,latest.plane.center);
  const uploads=h.calls.filter(call=>call.name==='texSubImage2D');assert.equal(uploads.length,1);assert.equal(uploads[0].args.at(-1),latest.data);
 }finally{h.close();}
});

test('source, threshold, mode, plane-guide and oblique changes leave orthogonal section intent',()=>{
 for(const change of ['source','threshold','volume','mip','planes','oblique','whole']){
  const h=fixture();try{
   h.renderer.set({clipPosition:.61});h.frame();assertNativeSection(h);h.clear();
   if(change==='source'){
    h.renderer.meta={dimensions:[...h.renderer.dimensions],spacingUm:317.6};
    h.gl.MAX_3D_TEXTURE_SIZE=500;h.gl.NO_ERROR=0;
    h.gl.getParameter=key=>key===h.gl.MAX_3D_TEXTURE_SIZE?4096:false;h.gl.getError=()=>0;
    h.renderer.load(new Uint8Array(512),{dimensions:[8,8,8],spacingUm:.5});
   }else h.renderer.set({threshold:{threshold:.32},volume:{mode:1},mip:{mode:2},planes:{showPlanes:1},oblique:{clipAxis:3,oblique:cap(7).plane},whole:{clipAxis:-1}}[change]);
   h.frame();assert.equal(h.renderer.sectionQuality,false,change);assert.equal(h.renderer.cameraQuality,false,change);
   assert(h.renderer.renderStats.volumePixels<=161000,change+' retains bounded scene work');
   assert.equal(h.renderer.submittedFrame.kind,'preview',change);
  }finally{h.close();}
 }
});

test('new measured phases on the same physical grid retain section detail and replace scalar data',()=>{
 const h=fixture();try{
  h.gl.MAX_3D_TEXTURE_SIZE=500;h.gl.NO_ERROR=0;
  h.gl.getParameter=key=>key===h.gl.MAX_3D_TEXTURE_SIZE?4096:false;h.gl.getError=()=>0;
  h.renderer.loaded=false;
  h.renderer.load(new Uint8Array(512),{dimensions:[8,8,8],spacingUm:[500,500,500]});h.frame();
  assert(h.renderer.renderStats.volumePixels<=161000,'The first acquired phase still has bounded startup work.');
  h.renderer.set({clipPosition:.61});h.renderer.clearCapData();h.frame();h.clear();
  const phase=new Uint8Array(512).fill(120);
  h.renderer.load(phase,{dimensions:[8,8,8],spacingUm:[500,500,500]});
  h.renderer.set({clipAxis:1,clipPosition:.61,slices:[.5,.5,.5]});h.frame();const draw=assertNativeSection(h);
  assert.equal(h.renderer.data,phase);assert.equal(h.calls.filter(call=>call.name==='texImage3D').at(-1).args.at(-1),phase);
  assert.equal(draw.uniforms.capReady,0,'The new phase is sampled from its current scalar texture, not a prior fine cap.');
  assert.equal(draw.uniforms.clipPosition,.61);assert.deepEqual(draw.uniforms.dimensions,[8,8,8]);
  h.clear();h.renderer.load(phase,{dimensions:[8,8,8],spacingUm:[500,500,600]});h.frame();
  assert.equal(h.renderer.sectionQuality,false,'A spacing change is a new physical grid even with identical dimensions.');
  assert(h.renderer.renderStats.volumePixels<=161000);
 }finally{h.close();}
});

test('section timing cannot lower detail, and explicit quality controls set the stable section grid',()=>{
 const h=fixture();try{
  h.renderer.set({clipPosition:.61});h.frame();h.clear();h.renderer.interactionPixels=80000;
  const gl=h.gl;gl.QUERY_RESULT_AVAILABLE=301;gl.QUERY_RESULT=302;
  gl.getQueryParameter=(_,kind)=>kind===gl.QUERY_RESULT_AVAILABLE?true:400000000;
  h.renderer.timerExtension={GPU_DISJOINT_EXT:401};h.renderer.gpuQueries=[{query:{},pixels:1500000,kind:'section'}];
  h.renderer.pollGpuTimers();assert.equal(h.renderer.sectionFrameMs,400);assert.equal(h.renderer.interactionPixels,80000);
  h.renderer.timerExtension=null;window.devicePixelRatio=2;
  for(const [quality,pixels] of [['low',450000],['high',2600000],['auto',1500000]]){
   h.clear();h.renderer.set({quality,clipPosition:h.renderer.settings.clipPosition+.01});h.frame();assertNativeSection(h);
   assert(Math.abs(h.renderer.renderStats.outputPixels-pixels)<3000,quality);
  }
 }finally{h.close();}
});

test('explicit Render quality determines camera resolution instead of an automatic gesture downgrade',()=>{
 const h=fixture();try{
  window.devicePixelRatio=2;h.renderer.requestRender();h.frame();h.clear();
  for(const [quality,pixels] of [['low',450000],['high',2600000],['auto',1500000]]){
   h.renderer.set({quality});h.event('wheel',{deltaY:-25});h.frame();assertNativeCamera(h);
   assert(Math.abs(h.renderer.renderStats.outputPixels-pixels)<3000,quality);h.clear();
  }
 }finally{h.close();}
});

test('a wide main reconstruction preserves real screen samples while camera and section input remain latest-only',()=>{
 const h=fixture({width:2400,height:1600,renderProfile:'reconstruction'});try{
  h.event('wheel',{deltaY:-25});h.frame();assertNativeCamera(h);
  assert.deepEqual([h.canvas.width,h.canvas.height],[2400,1600]);
  assert.equal(h.renderer.renderStats.outputPixelRatio,1);
  const settings=structuredClone(h.renderer.settings),budget=h.renderer.interactionPixels;
  h.clear();h.ready(false);
  for(let i=1;i<=12;i++){h.renderer.set({clipPosition:.5+i*.01});h.frame();}
  assert.equal(h.draws.length,0,'A busy GPU cannot accumulate superseded high-resolution frames.');
  h.ready(true);h.frame();const latest=assertNativeSection(h);
  assert.equal(latest.uniforms.clipPosition,.62);
  assert.deepEqual([h.canvas.width,h.canvas.height],[2400,1600]);
  assert.equal(h.renderer.settings.threshold,settings.threshold);
  assert.equal(h.renderer.settings.surfaceSmoothing,settings.surfaceSmoothing);
  assert.equal(h.renderer.settings.cleanupEnabled,settings.cleanupEnabled);
  assert.equal(h.renderer.interactionPixels,budget);
  h.clear();h.renderer.setCapData(cap(2));h.frame();assertNativeSection(h);
  assert.deepEqual([h.canvas.width,h.canvas.height],[2400,1600]);
 }finally{h.close();}
});

test('main output ceilings distinguish retained fine geometry from scalar fallback without changing model settings',()=>{
 const h=fixture({width:2400,height:1600,renderProfile:'reconstruction'});try{
  window.devicePixelRatio=2;
  const calls=[],source={threshold:.28,sourceSpacingUm:79.4};
  h.renderer.fineSurface={indexCount:23618685*3,manifest:source,
   activeFor:r=>r.settings.mode===0&&r.settings.threshold===source.threshold,
   draw(_renderer,w,h){calls.push([w,h]);}};
  h.renderer.requestRender('camera');h.frame();
  assert.equal(h.renderer.renderStats.fineSurface,true);
  assert.equal(h.renderer.renderStats.maxOutputPixels,6000000);
  assert(Math.abs(h.canvas.width*h.canvas.height-6000000)<5000);
  assert.deepEqual(calls.at(-1),[h.canvas.width,h.canvas.height]);
  assert.strictEqual(h.renderer.fineSurface.manifest,source);
  h.renderer.set({threshold:.37});h.frame();
  assert.equal(h.renderer.settings.threshold,.37,'Custom thresholds must remain explicit scalar views.');
  assert.equal(h.renderer.renderStats.maxOutputPixels,4000000);
  assert(Math.abs(h.canvas.width*h.canvas.height-4000000)<5000);
  h.renderer.set({quality:'high'});h.frame();
  assert.equal(h.renderer.renderStats.maxOutputPixels,6000000);
  h.renderer.set({threshold:.28});h.frame();
  assert.equal(h.renderer.renderStats.maxOutputPixels,8000000);
  h.renderer.set({quality:'low'});h.frame();
  assert.equal(h.renderer.renderStats.maxOutputPixels,450000);
  assert(Math.abs(h.canvas.width*h.canvas.height-450000)<3000);
 }finally{h.close();}
});

test('paired workspaces retain output ceilings and explicit scene work remains bounded',()=>{
 const h=fixture({width:2400,height:1600,renderProfile:'reconstruction'});try{
  window.devicePixelRatio=2;h.event('wheel',{deltaY:-25});h.frame();
  assert.equal(h.renderer.renderStats.maxOutputPixels,4000000);
  for(const profile of ['echo','probe','tee']){
   h.clear();h.renderer.renderProfile=profile;
   h.renderer.set({clipAxis:3,oblique:{normal:[0,0,1],center:[0,0,profile==='tee'?.1:.2],right:[1,0,0],up:[0,1,0],width:1,height:1}});
   h.renderer.requestRender('scene');h.frame();
   assert.equal(h.renderer.renderStats.maxOutputPixels,1500000,profile);
   assert(h.renderer.renderStats.volumePixels<161000,profile+' keeps bounded oblique ray work.');
   assert.equal(h.renderer.renderStats.fullResolutionCap,true,profile);
  }
  h.clear();h.renderer.renderProfile='reconstruction';h.renderer.set({mode:1});h.frame();
  assert.equal(h.renderer.renderStats.maxOutputPixels,1500000,'Translucent volume rendering is unchanged.');
  h.renderer.set({mode:2});h.frame();
  assert.equal(h.renderer.renderStats.maxOutputPixels,1500000,'MIP rendering is unchanged.');
 }finally{h.close();}
});

test('both Lab oblique cuts keep the settled scene grid across movement, pan, release and late detail',()=>{
 for(const renderProfile of ['probe','tee']){
  const h=fixture({renderProfile});try{
   const plane={normal:[.6,0,.8],center:[.04,.03,.08],right:[.8,0,-.6],up:[0,1,0],width:.8,height:1};
   h.renderer.set({clipAxis:3,oblique:plane});h.frame();assertNativeSection(h);h.clear();
   // A genuine camera gesture followed immediately by the next accepted probe
   // pose previously switched the same scene back to an enlarged 160k preview.
   h.event('pointerdown',{button:2});h.event('pointermove',{clientX:132,clientY:112});
   h.frame();assertNativeCamera(h);h.clear();
   const latest={...plane,center:[.07,.06,.10]};
   h.renderer.set({oblique:latest});h.renderer.setCapData({...cap(9),plane:latest});h.frame();
   const moving=assertNativeSection(h);assert.deepEqual(moving.uniforms.capCenter,latest.center);
   const movingUniforms=structuredClone(moving.uniforms);h.clear();h.renderer.snapshot();
   assert.deepEqual(h.draws[0].uniforms,movingUniforms,'The moving and settled scene use identical source rays, plane, threshold and transfer.');
   h.clear();h.event('pointerup');h.frame();h.advance(350);assert.equal(h.draws.length,0);
   h.renderer.setCapData({...cap(10),plane:latest});h.frame();assertNativeSection(h);
   assert.equal(h.renderer.renderStats.maxOutputPixels,1500000,'Lab output ceiling stays bounded.');
  }finally{h.close();}
 }
});

test('continuous Lab input coalesces behind one busy GPU frame and only uploads the newest accepted cap',()=>{
 for(const renderProfile of ['probe','tee']){
  const h=fixture({renderProfile});try{
   const plane={normal:[0,0,1],center:[0,0,0],right:[1,0,0],up:[0,1,0],width:.8,height:1};
   h.renderer.set({clipAxis:3,oblique:plane});h.frame();h.ready(false);h.clear();let latest;
   for(let i=1;i<=24;i++){
    latest={...cap(i),plane:{...plane,center:[0,0,i*.005]}};
    h.renderer.set({oblique:latest.plane});h.renderer.setCapData(latest);h.frame();
    assert.equal(h.frames.size,1);assert.equal(h.draws.length,0);
   }
   assert.equal(h.calls.filter(call=>call.name==='texSubImage2D').length,0);
   assert.equal(h.renderer.interactionPixels,160000,'Slow Lab frames must not alter another workspace’s preview budget.');
   h.ready(true);h.frame();const draw=assertNativeSection(h);
   assert.deepEqual(draw.uniforms.capCenter,latest.plane.center);assert.equal(draw.uniforms.planeDistance,.12);
   assert.equal(h.calls.filter(call=>call.name==='texSubImage2D').length,1);
  }finally{h.close();}
 }
});

test('Lab camera-following preserves sharp sections but source and display mode changes stay bounded',()=>{
 for(const renderProfile of ['probe','tee']){
  const h=fixture({renderProfile});try{
   const plane={normal:[0,0,1],center:[0,0,.1],right:[1,0,0],up:[0,1,0],width:.8,height:1};
   h.renderer.set({clipAxis:3,oblique:plane});
   h.renderer.alignPlane(plane.normal,plane.up,plane.center,{followScene:true});h.frame();assertNativeSection(h);
   h.clear();h.renderer.set({threshold:.39});h.frame();assert(h.renderer.renderStats.volumePixels<=161000);
   assert.equal(h.renderer.sectionQuality,false);h.clear();
   h.renderer.set({oblique:{...plane,center:[0,0,.2]}});h.frame();assertNativeSection(h);
   assert.equal(h.draws[0].uniforms.threshold,.39,'Keep custom source thresholds.');
   h.clear();h.renderer.set({mode:1});h.frame();assert(h.renderer.renderStats.volumePixels<=161000);
   assert.equal(h.renderer.sectionQuality,false);
  }finally{h.close();}
 }
});

test('Lab quality controls remain a stable explicit choice on constrained devices',()=>{
 for(const renderProfile of ['probe','tee']){
  const h=fixture({width:1200,height:900,renderProfile});try{
   window.devicePixelRatio=3;h.renderer.resourcePolicy=getDeviceResourcePolicy({navigator:{userAgent:'iPhone'}});
   const plane={normal:[0,0,1],center:[0,0,.1],right:[1,0,0],up:[0,1,0],width:.8,height:1};
   for(const [quality,budget] of [['auto',1000000],['low',450000],['high',1000000]]){
    h.clear();plane.center=[0,0,plane.center[2]+.01];
    h.renderer.set({clipAxis:3,oblique:{...plane},quality});h.frame();assertNativeSection(h);
    assert.equal(h.renderer.renderStats.maxOutputPixels,budget);
    assert(h.renderer.renderStats.outputPixels<=budget+2500);
   }
  }finally{h.close();}
 }
});

test('mobile camera output caps device pixel ratio and large canvas memory without changing source settings',()=>{
 const policy=getDeviceResourcePolicy({navigator:{userAgent:'iPhone'}});
 for(const [width,height] of [[400,600],[1200,900]]){
  const h=fixture({width,height,renderProfile:'reconstruction'});try{
   window.devicePixelRatio=3;h.renderer.resourcePolicy=policy;
   const settings=structuredClone(h.renderer.settings);
   h.renderer.requestRender('camera');h.frame();
   assert.equal(h.renderer.renderStats.maxOutputPixels,1000000);
   assert(h.canvas.width<=width*1.5+1&&h.canvas.height<=height*1.5+1);
   assert(h.canvas.width*h.canvas.height<1002000);
   if(width===400)assert.deepEqual([h.canvas.width,h.canvas.height],[600,900]);
   assert.deepEqual(h.renderer.settings,settings);
  }finally{h.close();}
 }
});

