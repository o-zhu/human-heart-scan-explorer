/** Visible-surface picking without retaining or drawing another Ultra mesh. */
import {volumeShaderSources} from './renderer.js';
import {worldToSource,clipPlane,dot} from './planes.js';
import {SCENE_NEAR,SCENE_FAR} from './render-depth.js';
import {measurementFrameCurrent} from './measurement-frame.js';

const MAX_SIDE=33,MAX_BYTES=MAX_SIDE*MAX_SIDE*4,MAX_WAIT_MS=1000;
const now=()=>globalThis.performance?.now?.()??Date.now();
const cancelled=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Point selection canceled.','AbortError');};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

const vertex=`#version 300 es
void main(){
 vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
 gl_Position=vec4(p*2.-1.,0.,1.);
}`;
const declarations=`
precision highp int;
uniform vec2 measurementOrigin,measurementOutputSize;
uniform int measurementComposite;
vec2 measurementScreen;
float measurementCut;
`;
const encode=`
void encodeMeasurement(){
 if(!(gl_FragDepth>=0.&&gl_FragDepth<1.)){fragColor=vec4(0.);return;}
 uint value=uint(round(gl_FragDepth*16777215.));
 fragColor=vec4(vec3(float((value>>16)&255u),float((value>>8)&255u),float(value&255u))/255.,(measurementCut>.5?2.:1.)/255.);
}`;

function instrument(source){
 if(!source.includes('void main(){'))throw new Error('The displayed-surface shader contract has changed.');
 return source.replace('void main(){',declarations+'\nvoid measurementMain(){').replaceAll('gl_FragCoord.xy','measurementScreen');
}
// Keep the cap intersection, threshold, cropped raster and cleanup decisions
// byte-for-byte from the displayed composite. Only its color output is unused.
const capStart=volumeShaderSources.composite.indexOf(' if(mode==0&&clipAxis>=0){');
const capEnd=volumeShaderSources.composite.lastIndexOf('\n fragColor=');
const capColor='color=pow(max(capShade(p,value),vec3(0.)),vec3(.89));';
if(capStart<0||capEnd<capStart||!volumeShaderSources.composite.slice(capStart,capEnd).includes(capColor))throw new Error('The displayed cap picking contract has changed.');
const capClause=volumeShaderSources.composite.slice(capStart,capEnd).replace(capColor,'measurementCut=1.;');
const fine=instrument(volumeShaderSources.composite.replace(capColor,capColor+'measurementCut=1.;'))+encode+`
void main(){
 measurementScreen=measurementOrigin+gl_FragCoord.xy;measurementCut=0.;
 measurementMain();encodeMeasurement();
}`;
const volume=instrument(volumeShaderSources.volume.replace('found=true;foundT=entry;','found=true;foundT=entry;measurementCut=1.;'))+encode+`
void main(){
 vec2 outputPoint=measurementOrigin+gl_FragCoord.xy;
 measurementScreen=floor(outputPoint/measurementOutputSize*resolution)+.5;
 measurementCut=0.;measurementMain();
 if(measurementComposite==1){
  vec2 screen=outputPoint/measurementOutputSize;
  ${capClause}
 }
 encodeMeasurement();
}`;
export const measurementPickingShaderSources={vertex,fine,volume};

export function measurementRay(frame,u,v){
 const b=frame.basis,aspect=frame.aspect||frame.width/frame.height;
 const ray=b.forward.map((n,i)=>n+b.right[i]*(2*u-1)*aspect*.32+b.up[i]*(1-2*v)*.32);
 const length=Math.hypot(...ray);return ray.map(n=>n/length);
}

export function unprojectMeasurementDepth(frame,u,v,depth,{linear=false}={}){
 if(!Number.isFinite(depth)||(linear?depth<=0:depth<0||depth>=1))return null;
 const forwardDepth=linear?depth:SCENE_FAR*SCENE_NEAR/(SCENE_FAR-depth*(SCENE_FAR-SCENE_NEAR));
 if(!(forwardDepth>0&&forwardDepth<SCENE_FAR))return null;
 const ray=measurementRay(frame,u,v),along=dot(ray,frame.basis.forward);
 if(!(along>0))return null;
 return frame.basis.eye.map((n,i)=>n+ray[i]*forwardDepth/along);
}

/** A bounded rectangle in the presented output grid, with exact pixel first. */
export function measurementPickWindow(frame,u,v,toleranceCssPixels=4){
 if(!Number.isFinite(u+v)||u<0||u>1||v<0||v>1||frame.width<2||frame.height<2||frame.cssWidth<2||frame.cssHeight<2)return null;
 const tolerance=Number.isFinite(toleranceCssPixels)?clamp(toleranceCssPixels,0,8):4;
 const x=clamp(Math.floor(u*frame.width),0,frame.width-1),y=clamp(Math.floor((1-v)*frame.height),0,frame.height-1);
 const rx=Math.min(16,Math.ceil(tolerance*frame.width/frame.cssWidth)),ry=Math.min(16,Math.ceil(tolerance*frame.height/frame.cssHeight));
 const left=Math.max(0,x-rx),bottom=Math.max(0,y-ry),right=Math.min(frame.width-1,x+rx),top=Math.min(frame.height-1,y+ry);
 const width=right-left+1,height=top-bottom+1,candidates=[];
 for(let py=bottom;py<=top;py++)for(let px=left;px<=right;px++){
  const exact=px===x&&py===y;
  const distance=Math.hypot(((px+.5)/frame.width-u)*frame.cssWidth,(1-(py+.5)/frame.height-v)*frame.cssHeight);
  if(exact||distance<=tolerance)candidates.push({x:px,y:py,offset:4*((px-left)+(py-bottom)*width),distance,exact});
 }
 candidates.sort((a,b)=>Number(b.exact)-Number(a.exact)||a.distance-b.distance);
 return {left,bottom,width,height,candidates};
}

function sourceResult(frame,world,cutFace){
 if(!world?.every(Number.isFinite))return null;
 return {world,sourceNormalized:worldToSource(world,frame.extent),cutFace,frameRevision:frame.frameRevision,sourceKey:frame.sourceKey};
}

export function decodeMeasurementPixels(frame,window,pixels){
 for(const sample of window.candidates){
  const at=sample.offset,flag=pixels[at+3];if(flag!==1&&flag!==2)continue;
  const depth=(pixels[at]*65536+pixels[at+1]*256+pixels[at+2])/16777215,cutFace=flag===2;
  let u=(sample.x+.5)/frame.width,v=1-(sample.y+.5)/frame.height;
  if(frame.kind==='volume'&&!cutFace){
   // A bounded moving volume is enlarged in the display. Its surface depth
   // belongs to the sampled scene pixel, not the intervening output ray.
   u=(Math.floor((sample.x+.5)/frame.width*frame.sceneWidth)+.5)/frame.sceneWidth;
   v=1-(Math.floor((sample.y+.5)/frame.height*frame.sceneHeight)+.5)/frame.sceneHeight;
  }
  const world=unprojectMeasurementDepth(frame,u,v,depth);
  if(world)return sourceResult(frame,world,cutFace);
 }
 return null;
}

export function pickSoftwareMeasurement(frame,window,settings){
 const source=frame.linearDepth;
 if(!source||source.width!==frame.width||source.height!==frame.height||source.data?.length!==frame.width*frame.height)return null;
 for(const sample of window.candidates){
  const row=frame.height-1-sample.y,depth=source.data[sample.x+row*frame.width];
  const world=unprojectMeasurementDepth(frame,(sample.x+.5)/frame.width,(row+.5)/frame.height,depth,{linear:true});
  if(!world)continue;
  const plane=clipPlane(settings,frame.extent);
  return sourceResult(frame,world,Boolean(plane&&Math.abs(dot(plane.normal,world)-plane.distance)<1e-5));
 }
 return null;
}

function delay(ms,signal){
 return new Promise((resolve,reject)=>{
  const finish=()=>{signal?.removeEventListener('abort',abort);resolve();};
  const timer=setTimeout(finish,ms);
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason||new DOMException('Point selection canceled.','AbortError'));};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
}

function waitForFrame(renderer,signal,deadline){
 return new Promise((resolve,reject)=>{
  const waiters=renderer.measurementFrameWaiters||(renderer.measurementFrameWaiters=new Set());
  const finish=value=>{clearTimeout(timer);waiters.delete(notify);signal.removeEventListener('abort',abort);resolve(value);};
  const notify=()=>finish(true),abort=()=>{clearTimeout(timer);waiters.delete(notify);signal.removeEventListener('abort',abort);reject(signal.reason);};
  const timer=setTimeout(()=>finish(false),Math.max(0,deadline-now()));
  waiters.add(notify);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });
}

const textureSlots=[[0,'TEXTURE_3D'],[1,'TEXTURE_2D'],[2,'TEXTURE_3D'],[3,'TEXTURE_3D'],[4,'TEXTURE_3D'],[5,'TEXTURE_2D'],[6,'TEXTURE_2D'],[7,'TEXTURE_2D'],[8,'TEXTURE_3D'],[14,'TEXTURE_2D']];
function saveGraphicsState(gl){
 const active=gl.getParameter(gl.ACTIVE_TEXTURE),textures=[];
 for(const [unit,kind]of textureSlots){gl.activeTexture(gl.TEXTURE0+unit);textures.push([unit,gl[kind],gl.getParameter(kind==='TEXTURE_2D'?gl.TEXTURE_BINDING_2D:gl.TEXTURE_BINDING_3D)]);}
 gl.activeTexture(active);
 return {active,textures,draw:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),viewport:gl.getParameter(gl.VIEWPORT),program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),pack:gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),unpack:gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING),color:gl.getParameter(gl.COLOR_WRITEMASK),flags:['DEPTH_TEST','BLEND','CULL_FACE','SCISSOR_TEST','DITHER'].map(name=>[gl[name],gl.isEnabled(gl[name])]),packing:['PACK_ALIGNMENT','PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'].map(name=>[gl[name],gl.getParameter(gl[name])])};
}
function restoreGraphicsState(gl,s){
 for(const [unit,target,texture]of s.textures){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(target,texture);}gl.activeTexture(s.active);
 gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,s.draw);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,s.read);gl.viewport(...s.viewport);gl.useProgram(s.program);gl.bindVertexArray(s.vao);
 gl.bindBuffer(gl.PIXEL_PACK_BUFFER,s.pack);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,s.unpack);gl.colorMask(...s.color);
 for(const [key,value]of s.packing)gl.pixelStorei(key,value);
 for(const [key,enabled]of s.flags)enabled?gl.enable(key):gl.disable(key);
}

export class MeasurementSurfacePicker{
 constructor(renderer){
  this.renderer=renderer;this.gl=renderer.gl;this.programs=new Map();this.disposed=false;this.active=null;this.unavailableReason='';
  this.contextLost=()=>{this.cancel();this.releaseGraphics();this.unavailableReason='The graphics context was interrupted.';};
  renderer.canvas.addEventListener?.('webglcontextlost',this.contextLost);
 }
 cancel(){this.active?.controller.abort(new DOMException('Point selection canceled.','AbortError'));}
 async pick(u,v,{toleranceCssPixels=4,signal}={}){
  const previous=this.active;this.cancel();
  if(this.disposed||signal?.aborted||!Number.isFinite(u+v)||u<0||u>1||v<0||v>1)return null;
  let finish;const job={controller:new AbortController(),done:new Promise(resolve=>{finish=resolve;})};this.active=job;
  const abort=()=>job.controller.abort(signal.reason||new DOMException('Point selection canceled.','AbortError'));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{
   // Cancellation settles the previous tiny readback before another can
   // submit; rapid hover updates never accumulate graphics commands/storage.
   await previous?.done;cancelled(job.controller.signal);
   const deadline=now()+MAX_WAIT_MS;
   while(now()<deadline){
    cancelled(job.controller.signal);const renderer=this.renderer;
    if(this.disposed||renderer.settings.mode!==0||renderer.settings.showPlanes||renderer.gl?.isContextLost?.()){
     this.unavailableReason='A current visible surface is unavailable.';return null;
    }
    const frame=renderer.presentedMeasurementFrame;
    if(!measurementFrameCurrent(renderer,frame)){if(!await waitForFrame(renderer,job.controller.signal,deadline)){this.unavailableReason='The visible surface is still updating.';return null;}continue;}
    const window=measurementPickWindow(frame,u,v,toleranceCssPixels);if(!window)return null;
    let hit;
    if(frame.kind==='software')hit=pickSoftwareMeasurement(frame,window,renderer.settings);
    else{
     const pixels=await this.readPixels(frame,window,job.controller.signal,deadline);
     cancelled(job.controller.signal);if(!pixels){if(!measurementFrameCurrent(renderer,frame))continue;this.unavailableReason=this.unavailableReason||'The graphics device is still preparing the selected surface.';return null;}
     hit=decodeMeasurementPixels(frame,window,pixels);
    }
    if(measurementFrameCurrent(renderer,frame)){this.unavailableReason='';return hit;}
    // The displayed basis/source changed during readback. Retry its newest
    // presentation, without committing a point from the previous view.
   }
   this.unavailableReason='The visible surface is still updating.';return null;
  }catch(error){if(error?.name!=='AbortError'&&!job.controller.signal.aborted)this.unavailableReason=error?.message||'Visible-surface picking is unavailable.';return null;}
  finally{signal?.removeEventListener('abort',abort);if(this.active===job)this.active=null;finish();}
 }
 ensureGraphics(kind){
  const gl=this.gl;if(this.graphicsFailed||!gl||!gl.fenceSync||!gl.getBufferSubData)throw new Error('Visible-surface picking is unavailable in this graphics context.');
  if(!this.target){
   const target=this.target={texture:gl.createTexture(),framebuffer:gl.createFramebuffer(),buffer:gl.createBuffer(),vao:gl.createVertexArray()};
   if(!target.texture||!target.framebuffer||!target.buffer||!target.vao)throw new Error('The graphics device could not prepare point selection.');
   gl.activeTexture(gl.TEXTURE0+14);gl.bindTexture(gl.TEXTURE_2D,target.texture);
   for(const [key,value]of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,value);
   gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,MAX_SIDE,MAX_SIDE,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
   gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target.texture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('The graphics device could not prepare point selection.');
   gl.bindBuffer(gl.PIXEL_PACK_BUFFER,target.buffer);gl.bufferData(gl.PIXEL_PACK_BUFFER,MAX_BYTES,gl.STREAM_READ);
  }
  const type=kind==='fine'?'fine':'volume';
  if(!this.programs.has(type)){
   const program=this.renderer.createProgram(vertex,measurementPickingShaderSources[type]);
   const names=[...Object.keys(this.renderer.uniforms),'measurementOrigin','measurementOutputSize','measurementComposite'];
   const uniforms=Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(program,['anatomyColors','reviewedMaskOffsets','reviewedMaskGrids'].includes(name)?name+'[0]':name)]));
   this.programs.set(type,{program,uniforms});
  }
  return this.programs.get(type);
 }
 async readPixels(frame,window,signal,deadline){
  const gl=this.gl;cancelled(signal);if(this.graphicsFailed||gl.isContextLost?.())return null;
  // Canceling a JavaScript request cannot cancel submitted GPU work. Keep its
  // fence until signaled; a newer request must drain it before submitting.
  if(this.readback&&!await this.waitReadback(signal,deadline))return null;
  if(!measurementFrameCurrent(this.renderer,frame))return null;
  const saved=saveGraphicsState(gl);let fence;
  try{
   const {program,uniforms:u}=this.ensureGraphics(frame.kind),t=this.target;
   gl.bindFramebuffer(gl.FRAMEBUFFER,t.framebuffer);gl.viewport(0,0,window.width,window.height);gl.bindVertexArray(t.vao);
   for(const name of ['DEPTH_TEST','BLEND','CULL_FACE','SCISSOR_TEST','DITHER'])gl.disable(gl[name]);gl.colorMask(true,true,true,true);
   gl.clearBufferfv(gl.COLOR,0,new Float32Array(4));
   this.renderer.bindSceneUniforms(program,u,frame.sceneWidth,frame.sceneHeight,frame.basis,frame.aspect,frame.composite);
   gl.uniform2f(u.measurementOrigin,window.left,window.bottom);gl.uniform2f(u.measurementOutputSize,frame.width,frame.height);gl.uniform1i(u.measurementComposite,frame.composite?1:0);
   if(frame.kind==='fine'){
    gl.activeTexture(gl.TEXTURE0+5);gl.bindTexture(gl.TEXTURE_2D,frame.surface.target.texture);gl.uniform1i(u.sceneTexture,5);
    gl.activeTexture(gl.TEXTURE0+14);gl.bindTexture(gl.TEXTURE_2D,frame.depthTexture);gl.uniform1i(u.sceneDepthTexture,14);gl.uniform1i(u.sceneDepthReady,1);
   }
   gl.drawArrays(gl.TRIANGLES,0,3);
   gl.bindBuffer(gl.PIXEL_PACK_BUFFER,t.buffer);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
   for(const name of ['PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'])gl.pixelStorei(gl[name],0);
   gl.readPixels(0,0,window.width,window.height,gl.RGBA,gl.UNSIGNED_BYTE,0);
   if(gl.getError()!==gl.NO_ERROR)throw new Error('The graphics device could not read the visible surface.');
   fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!fence)throw new Error('The graphics device could not schedule point selection.');
   this.readback=fence;
   gl.flush();
  }catch(error){if(fence&&fence!==this.readback)gl.deleteSync(fence);this.graphicsFailed=true;this.releaseGraphics();throw error;}
  finally{restoreGraphicsState(gl,saved);}
  // A real task gives WebGL a chance to submit. Never use a blocking wait.
  await delay(0,signal);if(!await this.waitReadback(signal,deadline))return null;
  const pixels=new Uint8Array(window.width*window.height*4),previous=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
  try{gl.bindBuffer(gl.PIXEL_PACK_BUFFER,this.target.buffer);gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,pixels);if(gl.getError()!==gl.NO_ERROR)throw new Error('The graphics device could not return the selected surface.');}
  finally{gl.bindBuffer(gl.PIXEL_PACK_BUFFER,previous);}
  return pixels;
 }
 async waitReadback(signal,deadline){
  const gl=this.gl;
  while(this.readback&&now()<deadline){
   cancelled(signal);if(gl.isContextLost?.())return false;
   const state=gl.clientWaitSync(this.readback,0,0);
   if(state===gl.ALREADY_SIGNALED||state===gl.CONDITION_SATISFIED){gl.deleteSync(this.readback);this.readback=null;return true;}
   if(state!==gl.TIMEOUT_EXPIRED){this.graphicsFailed=true;throw new Error('The graphics device could not finish point selection.');}
   await delay(8,signal);
  }
  return !this.readback;
 }
 releaseGraphics(){
  const gl=this.gl;if(!gl)return;
  if(this.readback)gl.deleteSync(this.readback);this.readback=null;
  for(const {program}of this.programs.values())gl.deleteProgram(program);this.programs.clear();
  const t=this.target;this.target=null;if(!t)return;
  if(t.texture)gl.deleteTexture(t.texture);if(t.framebuffer)gl.deleteFramebuffer(t.framebuffer);if(t.buffer)gl.deleteBuffer(t.buffer);if(t.vao)gl.deleteVertexArray(t.vao);
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.cancel();this.renderer.canvas.removeEventListener?.('webglcontextlost',this.contextLost);this.releaseGraphics();}
}
