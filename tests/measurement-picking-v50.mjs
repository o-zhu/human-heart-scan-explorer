import test from 'node:test';
import assert from 'node:assert/strict';
import {MeasurementSurfacePicker,measurementPickWindow,decodeMeasurementPixels,pickSoftwareMeasurement,unprojectMeasurementDepth} from '../public/measurement-picking.js';
import {createMeasurementFrame,presentMeasurementFrame,measurementFrameCurrent} from '../public/measurement-frame.js';
import {sceneWindowDepth} from '../public/render-depth.js';
import {sourceToWorld} from '../public/planes.js';
import {volumeGeometry} from '../public/probe-geometry.js';

const turn=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(check){for(let i=0;i<100;i++){if(check())return;await turn();}assert.fail('Asynchronous checkpoint was not reached.');}
const basis=()=>({eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]});
const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);
function fixture({width=9,height=9,cssWidth=9,cssHeight=9,gl=null}={}){
 const canvas=new EventTarget();Object.assign(canvas,{width,height,rect:{width:cssWidth,height:cssHeight},getBoundingClientRect(){return this.rect;}});
 const cameraBasis=basis(),meta={dimensions:[101,81,61],spacingUm:[100,200,300]};
 const renderer={canvas,gl,loaded:true,viewRevision:1,measurementSourceKey:'donor-a',meta,dimensions:meta.dimensions,extent:volumeGeometry(meta).extent,data:new Uint8Array(8),settings:{mode:0,showPlanes:0,clipAxis:-1,threshold:.3,cleanupEnabled:true},autoRotate:false,basis:()=>cameraBasis,uniforms:{},createProgram:()=>({kind:'program'}),bindSceneUniforms(){}};
 function present(options={}){
  const frame=createMeasurementFrame(renderer,{basis:cameraBasis,width:canvas.width,height:canvas.height,aspect:canvas.width/canvas.height,kind:gl?'volume':'software',...options});
  if(frame.kind==='software')frame.linearDepth={width:frame.width,height:frame.height,data:new Float32Array(frame.width*frame.height).fill(Infinity)};
  return presentMeasurementFrame(renderer,frame);
 }
 return {renderer,canvas,cameraBasis,present,frame:present()};
}
function encode(depth,flag=1){const n=Math.round(depth*16777215);return [n>>>16&255,n>>>8&255,n&255,flag];}

test('physical normalization preserves a 3–4–5 mm distance with anisotropic source spacing',()=>{
 const f=fixture(),g=volumeGeometry(f.renderer.meta);
 assert.deepEqual(g.sourceSizeMm,[10,16,18]);
 const a=sourceToWorld([0,0,0],g.extent),b=sourceToWorld([.3,.25,0],g.extent);
 close(Math.hypot(...a.map((n,i)=>n-b[i]))*g.longestMm,5);
});

test('depth unprojection uses the presented camera, aspect and donor units across pixel ratios',()=>{
 for(const [width,height,cssWidth,cssHeight]of [[600,400,600,400],[1200,800,600,400],[333,221,997,663]]){
  const {frame}=fixture({width,height,cssWidth,cssHeight}),point=[.2,-.15,.3],depth=1.7;
  const u=.5+.5*point[0]/(depth*.32*frame.aspect),v=.5-.5*point[1]/(depth*.32);
  const result=unprojectMeasurementDepth(frame,u,v,sceneWindowDepth(depth));
  result.forEach((n,i)=>close(n,point[i]));
  unprojectMeasurementDepth(frame,u,v,depth,{linear:true}).forEach((n,i)=>close(n,point[i]));
 }
 assert.equal(unprojectMeasurementDepth(fixture().frame,.5,.5,1),null);
 assert.equal(unprojectMeasurementDepth(fixture().frame,.5,.5,Infinity,{linear:true}),null);
});

test('exact displayed pixel wins over a nearer-depth neighbor; tolerance unprojects the selected neighbor',()=>{
 const {frame,renderer}=fixture(),center=4+4*9;
 frame.linearDepth.data[center]=2;frame.linearDepth.data[center+1]=1.5;
 const window=measurementPickWindow(frame,.5,.5,4),first=pickSoftwareMeasurement(frame,window,renderer.settings);
 first.world.forEach(n=>close(n,0));
 frame.linearDepth.data[center]=Infinity;
 const next=pickSoftwareMeasurement(frame,window,renderer.settings);
 assert.ok(next.world[0]>0);close(next.world[2],.5);
 assert.equal(pickSoftwareMeasurement(frame,measurementPickWindow(frame,.5,.5,0),renderer.settings),null);
 assert.ok(window.width<=33&&window.height<=33);
});

test('volume scene-row boundaries use the shader bottom-origin ray; cap uses the output ray',()=>{
 const {frame}=fixture({width:600,height:600,cssWidth:600,cssHeight:600});
 const volumeFrame={...frame,kind:'volume',sceneWidth:400,sceneHeight:400};
 const window=measurementPickWindow(volumeFrame,300.5/600,1-1.5/600,0),bytes=new Uint8Array(4);
 bytes.set(encode(sceneWindowDepth(2)));
 const hit=decodeMeasurementPixels(volumeFrame,window,bytes),expected=unprojectMeasurementDepth(volumeFrame,200.5/400,1-1.5/400,sceneWindowDepth(2));
 hit.world.forEach((n,i)=>close(n,expected[i],2e-5));
 bytes[3]=2;
 const cap=decodeMeasurementPixels(volumeFrame,window,bytes),capExpected=unprojectMeasurementDepth(volumeFrame,300.5/600,1-1.5/600,sceneWindowDepth(2));
 cap.world.forEach((n,i)=>close(n,capExpected[i],2e-5));assert.equal(cap.cutFace,true);
});

test('presentation snapshots reject changed source, calibration, pose, size, mode and resource state',()=>{
 const {renderer,canvas,cameraBasis,frame,present}=fixture();
 assert.equal(measurementFrameCurrent(renderer,frame),true);
 cameraBasis.eye[0]=.1;assert.equal(frame.basis.eye[0],0);assert.equal(measurementFrameCurrent(renderer,frame),false);cameraBasis.eye[0]=0;
 renderer.autoRotate=true;cameraBasis.eye[0]=.1;assert.equal(measurementFrameCurrent(renderer,frame),true);renderer.autoRotate=false;cameraBasis.eye[0]=0;
 renderer.settings.threshold=.4;assert.equal(measurementFrameCurrent(renderer,frame),false);renderer.settings.threshold=.3;
 renderer.cap={};assert.equal(measurementFrameCurrent(renderer,frame),false);delete renderer.cap;
 canvas.rect.width+=1;assert.equal(measurementFrameCurrent(renderer,frame),false);canvas.rect.width-=1;
 canvas.width+=1;assert.equal(measurementFrameCurrent(renderer,frame),false);canvas.width-=1;
 renderer.measurementSourceKey='donor-b';assert.equal(measurementFrameCurrent(renderer,frame),false);renderer.measurementSourceKey='donor-a';
 renderer.settings.mode=1;assert.equal(measurementFrameCurrent(renderer,frame),false);renderer.settings.mode=0;
 const next=present();assert.ok(next.frameSerial>frame.frameSerial);assert.equal(measurementFrameCurrent(renderer,frame),false);
 assert.equal(measurementFrameCurrent(renderer,next),true);
});

test('a pending click waits for a matching presented frame; abort removes its waiter',async()=>{
 const f=fixture(),picker=new MeasurementSurfacePicker(f.renderer);f.cameraBasis.eye[0]=.1;
 const pending=picker.pick(.5,.5,{toleranceCssPixels:0});await until(()=>f.renderer.measurementFrameWaiters?.size===1);
 const next=f.present();next.linearDepth.data[40]=2;
 const hit=await pending;close(hit.world[0],.1);assert.equal(hit.frameRevision,1);
 f.cameraBasis.eye[0]=.2;const controller=new AbortController(),aborted=picker.pick(.5,.5,{signal:controller.signal});
 await until(()=>f.renderer.measurementFrameWaiters.size===1);controller.abort();assert.equal(await aborted,null);assert.equal(f.renderer.measurementFrameWaiters.size,0);picker.dispose();
});

function graphicsFixture(){
 const state={active:1000,viewport:[10,20,30,40],program:{old:'program'},vao:{old:'vao'},draw:{old:'draw'},read:{old:'read'},pack:{old:'pack'},unpack:{old:'unpack'},color:[false,true,false,true],packing:new Map(),textures:new Map(),flags:new Set(['DEPTH_TEST','SCISSOR_TEST','DITHER']),lost:false,busy:false,failDraw:false,failRead:false,error:0};
 const buffers=new Map(),fences=[],deleted=[],allocations=[],calls=[];let id=0,readWidth=0,readHeight=0;
 const gl={TEXTURE0:1000,NO_ERROR:0};
 for(const name of ['TEXTURE_2D','TEXTURE_3D','TEXTURE_BINDING_2D','TEXTURE_BINDING_3D','ACTIVE_TEXTURE','DRAW_FRAMEBUFFER_BINDING','READ_FRAMEBUFFER_BINDING','VIEWPORT','CURRENT_PROGRAM','VERTEX_ARRAY_BINDING','PIXEL_PACK_BUFFER_BINDING','PIXEL_UNPACK_BUFFER_BINDING','COLOR_WRITEMASK','DEPTH_TEST','BLEND','CULL_FACE','SCISSOR_TEST','DITHER','PACK_ALIGNMENT','PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS','DRAW_FRAMEBUFFER','READ_FRAMEBUFFER','FRAMEBUFFER','PIXEL_PACK_BUFFER','PIXEL_UNPACK_BUFFER','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','NEAREST','CLAMP_TO_EDGE','RGBA8','RGBA','UNSIGNED_BYTE','COLOR_ATTACHMENT0','FRAMEBUFFER_COMPLETE','STREAM_READ','COLOR','TRIANGLES','SYNC_GPU_COMMANDS_COMPLETE','ALREADY_SIGNALED','CONDITION_SATISFIED','TIMEOUT_EXPIRED'])gl[name]=name;
 for(const name of ['PACK_ALIGNMENT','PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'])state.packing.set(name,name==='PACK_ALIGNMENT'?8:2);
 const textureKey=target=>state.active+':'+target;
 Object.assign(gl,{
  activeTexture:value=>{state.active=value;},bindTexture:(target,value)=>state.textures.set(textureKey(target),value),
  getParameter(name){const m={ACTIVE_TEXTURE:state.active,DRAW_FRAMEBUFFER_BINDING:state.draw,READ_FRAMEBUFFER_BINDING:state.read,VIEWPORT:state.viewport,CURRENT_PROGRAM:state.program,VERTEX_ARRAY_BINDING:state.vao,PIXEL_PACK_BUFFER_BINDING:state.pack,PIXEL_UNPACK_BUFFER_BINDING:state.unpack,COLOR_WRITEMASK:state.color};if(name in m)return m[name];if(name==='TEXTURE_BINDING_2D'||name==='TEXTURE_BINDING_3D')return state.textures.get(textureKey(name==='TEXTURE_BINDING_2D'?'TEXTURE_2D':'TEXTURE_3D'))||null;return state.packing.get(name)||0;},
  isEnabled:key=>state.flags.has(key),enable:key=>state.flags.add(key),disable:key=>state.flags.delete(key),
  bindFramebuffer(target,value){if(target==='FRAMEBUFFER'||target==='DRAW_FRAMEBUFFER')state.draw=value;if(target==='FRAMEBUFFER'||target==='READ_FRAMEBUFFER')state.read=value;},
  viewport:(...v)=>{state.viewport=v;},useProgram:v=>{state.program=v;},bindVertexArray:v=>{state.vao=v;},bindBuffer(target,value){if(target==='PIXEL_PACK_BUFFER')state.pack=value;else if(target==='PIXEL_UNPACK_BUFFER')state.unpack=value;},colorMask:(...v)=>{state.color=v;},pixelStorei:(k,v)=>state.packing.set(k,v),
  createTexture:()=>({texture:++id}),createFramebuffer:()=>({framebuffer:++id}),createVertexArray:()=>({vao:++id}),createBuffer(){const b={buffer:++id};buffers.set(b,null);return b;},
  deleteTexture:v=>deleted.push(v),deleteFramebuffer:v=>deleted.push(v),deleteVertexArray:v=>deleted.push(v),deleteBuffer:v=>{deleted.push(v);buffers.delete(v);},deleteProgram:v=>deleted.push(v),
  texParameteri(){},texImage2D(_a,_b,_c,w,h){allocations.push(w*h*4);},framebufferTexture2D(){},checkFramebufferStatus:()=>gl.FRAMEBUFFER_COMPLETE,
  bufferData(target,size){assert.equal(target,gl.PIXEL_PACK_BUFFER);allocations.push(size);buffers.set(state.pack,new Uint8Array(size));},getUniformLocation:(_p,name)=>name,uniform1i(){},uniform2f(){},
  clearBufferfv(target,draw,values){assert.equal(target,gl.COLOR);assert.deepEqual([...values],[0,0,0,0]);calls.push('clear');},
  drawArrays(mode,start,count){assert.equal(mode,gl.TRIANGLES);assert.equal(count,3);calls.push('draw');if(state.failDraw)state.error=1282;},
  readPixels(_x,_y,w,h,_format,_type,offset){assert.equal(offset,0,'Readback must target a PBO, never block into a typed array.');assert.ok(buffers.has(state.pack));readWidth=w;readHeight=h;calls.push('read');const bytes=buffers.get(state.pack);for(let at=0;at<w*h*4;at+=4)bytes.set(encode(sceneWindowDepth(2)),at);},
  fenceSync(){const fence={id:++id,signaled:false};fences.push(fence);return fence;},flush(){},clientWaitSync(fence,flags,timeout){assert.equal(flags,0);assert.equal(timeout,0);if(state.busy)return gl.TIMEOUT_EXPIRED;fence.signaled=true;return gl.CONDITION_SATISFIED;},deleteSync:fence=>deleted.push(fence),
  getBufferSubData(target,offset,destination){assert.equal(target,gl.PIXEL_PACK_BUFFER);assert.ok(fences.at(-1).signaled);destination.set(buffers.get(state.pack).subarray(offset,offset+readWidth*readHeight*4));if(state.failRead)state.error=1282;calls.push('get');},
  getError(){const e=state.error;state.error=0;return e;},isContextLost:()=>state.lost,
 });
 const snapshot=()=>({active:state.active,viewport:[...state.viewport],program:state.program,vao:state.vao,draw:state.draw,read:state.read,pack:state.pack,unpack:state.unpack,color:[...state.color],flags:[...state.flags].sort(),packing:[...state.packing]});
 return {gl,state,calls,allocations,fences,deleted,buffers,snapshot};
}

test('GPU picks restore graphics state, reuse bounded storage and read only after the nonblocking fence',async()=>{
 const g=graphicsFixture(),f=fixture({gl:g.gl}),picker=new MeasurementSurfacePicker(f.renderer),before=g.snapshot();
 const a=await picker.pick(.5,.5),b=await picker.pick(.6,.5);
 assert.ok(a&&b);assert.deepEqual(g.snapshot(),before);assert.deepEqual(g.allocations,[4356,4356]);
 assert.equal(g.calls.filter(x=>x==='draw').length,2);assert.equal(g.calls.filter(x=>x==='get').length,2);
 assert.equal(g.calls[0],'clear');assert.ok(g.fences.every(x=>x.signaled));picker.dispose();assert.equal(g.buffers.size,0);
});

test('canceling GPU work settles UI but cannot submit another draw before the old fence signals',async()=>{
 const g=graphicsFixture(),f=fixture({gl:g.gl}),picker=new MeasurementSurfacePicker(f.renderer);g.state.busy=true;
 const first=picker.pick(.5,.5);await until(()=>g.fences.length===1);picker.cancel();assert.equal(await first,null);
 const second=picker.pick(.6,.5);await turn();await turn();assert.equal(g.fences.length,1);assert.equal(g.calls.filter(x=>x==='draw').length,1);
 g.state.busy=false;assert.ok(await second);assert.equal(g.fences.length,2);assert.ok(g.fences.every(x=>x.signaled));picker.dispose();
});

test('frame and graphics deadlines report temporary unavailability; a later true miss clears it',async()=>{
 const pendingFrame=fixture(),software=new MeasurementSurfacePicker(pendingFrame.renderer);pendingFrame.cameraBasis.eye[0]=.1;
 assert.equal(await software.pick(.5,.5),null);assert.match(software.unavailableReason,/updating/);
 pendingFrame.present();assert.equal(await software.pick(.5,.5),null);assert.equal(software.unavailableReason,'');software.dispose();
 const g=graphicsFixture(),f=fixture({gl:g.gl}),picker=new MeasurementSurfacePicker(f.renderer);g.state.busy=true;
 assert.equal(await picker.pick(.5,.5),null);assert.match(picker.unavailableReason,/preparing/);assert.equal(g.fences.length,1);
 g.state.busy=false;assert.ok(await picker.pick(.5,.5));assert.equal(picker.unavailableReason,'');assert.equal(g.fences.length,2);picker.dispose();
});

test('a new presentation during GPU readback rejects its old hit and samples the new frame',async()=>{
 const g=graphicsFixture(),f=fixture({gl:g.gl}),picker=new MeasurementSurfacePicker(f.renderer);g.state.busy=true;
 const pending=picker.pick(.5,.5);await until(()=>g.fences.length===1);f.cameraBasis.eye[0]=.1;f.renderer.viewRevision=2;f.present();g.state.busy=false;
 const hit=await pending;assert.equal(hit.frameRevision,2);close(hit.world[0],.1);assert.equal(g.fences.length,2);picker.dispose();
});

test('failed draw, failed readback and context loss never return retained pick pixels',async()=>{
 for(const failure of ['failDraw','failRead','context']){
  const g=graphicsFixture(),f=fixture({gl:g.gl}),picker=new MeasurementSurfacePicker(f.renderer);assert.ok(await picker.pick(.5,.5));
  if(failure==='context'){
   g.state.busy=true;const pending=picker.pick(.5,.5);await until(()=>g.fences.length===2);g.state.lost=true;f.canvas.dispatchEvent(new Event('webglcontextlost'));assert.equal(await pending,null);
  }else{g.state[failure]=true;assert.equal(await picker.pick(.5,.5),null);assert.ok(picker.unavailableReason);}
  picker.dispose();assert.equal(g.buffers.size,0);
 }
});
