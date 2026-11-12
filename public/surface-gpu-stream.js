/** One verified surface chunk in flight; no full decoded CPU mesh is retained.
 * Index storage is split into whole-triangle buffers, avoiding a single 283 MB
 * driver allocation. Positions, normals, connectivity and corner order survive
 * unchanged. A staged geometry cannot draw until every byte and flag is ready.
 */
export const SURFACE_UPLOAD_CHUNK_BYTES=2*1024*1024;
const aborted=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Surface preparation was canceled.','AbortError');};
const resourceError=message=>Object.assign(new Error(message),{resourceFailure:true});
const uploadFailure=(error,signal)=>signal?.aborted||error?.name==='AbortError'||error?.resourceFailure?error:Object.assign(resourceError(error?.message||String(error)),{cause:error});
const now=()=>globalThis.performance?.now?.()??Date.now();

function delay(signal,milliseconds=8){
 return new Promise((resolve,reject)=>{
  const finish=()=>{signal?.removeEventListener('abort',cancel);resolve();};
  const timer=setTimeout(finish,milliseconds);
  const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(signal.reason||new DOMException('Surface preparation was canceled.','AbortError'));};
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 });
}

function linkedSignal(...sources){
 const controller=new AbortController(),links=[];
 for(const signal of new Set(sources.filter(Boolean))){
  const cancel=()=>controller.abort(signal.reason||new DOMException('Surface preparation was canceled.','AbortError'));
  if(signal.aborted){cancel();break;}
  signal.addEventListener('abort',cancel,{once:true});links.push([signal,cancel]);
 }
 return {signal:controller.signal,close(){for(const [signal,cancel]of links)signal.removeEventListener('abort',cancel);}};
}

/** Pass the signal to cooperative workspace gates; race other gates so abort
 * still settles promptly. Remove our listener on both success and failure.
 */
async function workspace(waitForWorkspace,signal){
 aborted(signal);
 const pending=Promise.resolve().then(()=>{aborted(signal);return waitForWorkspace?.(signal);});
 if(!signal){await pending;return;}
 await new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(callback,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);callback(value);};
  const cancel=()=>finish(reject,signal.reason||new DOMException('Surface preparation was canceled.','AbortError'));
  signal.addEventListener('abort',cancel,{once:true});
  pending.then(value=>finish(resolve,value),error=>finish(reject,error));
  if(signal.aborted)cancel();
 });
 aborted(signal);
}

/** Poll in later tasks, with no blocking GL wait and no hidden-tab rAF dependency.
 * The caller's workspace wait excludes paused time from this active GPU budget.
 */
export async function waitForSurfaceGPU(gl,{signal,waitForWorkspace=async()=>{},timeoutMs=15000}={}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<0)throw new Error('Invalid surface graphics timeout.');
 await workspace(waitForWorkspace,signal);
 if(gl.isContextLost?.())throw resourceError('The graphics context was interrupted during surface preparation.');
 if(!gl.fenceSync||!gl.clientWaitSync||!gl.deleteSync)throw resourceError('Sequential surface uploads are unavailable in this graphics context.');
 const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
 if(!fence)throw resourceError('The graphics device could not schedule surface preparation.');
 let activeMs=0;
 try{
  gl.flush();
  // Yield a real task before polling. A microtask-only acknowledgement can
  // starve UI painting while a fast driver accepts many consecutive chunks.
  await delay(signal,0);
  for(;;){
   await workspace(waitForWorkspace,signal);
   if(gl.isContextLost?.())throw resourceError('The graphics context was interrupted during surface preparation.');
   const start=now(),state=gl.clientWaitSync(fence,0,0);
   if(state===gl.ALREADY_SIGNALED||state===gl.CONDITION_SATISFIED)return;
   if(state!==gl.TIMEOUT_EXPIRED)throw resourceError('The graphics device could not finish surface preparation.');
   await delay(signal);
   // A suspended/throttled page can return from this short timer minutes
   // later. Count bounded polling time, never that inactive wall-clock gap.
   activeMs+=Math.min(100,Math.max(0,now()-start));
   if(activeMs>timeoutMs)throw resourceError('The graphics device took too long to prepare this surface.');
  }
 }finally{gl.deleteSync(fence);}
}

function checkGraphics(gl){
 const error=gl.getError();
 if(error!==gl.NO_ERROR||gl.isContextLost?.())throw resourceError('The graphics device could not retain the complete surface.');
}

export class StreamedSurfaceGeometry{
 constructor(gl,layout,vao){
  const {vertexCount,indexCount}=layout;
  if(!Number.isSafeInteger(vertexCount)||vertexCount<1||vertexCount>30_000_000||!Number.isSafeInteger(indexCount)||indexCount<3||indexCount%3||indexCount>120_000_000||vertexCount*12+indexCount*4+32>512*1024*1024)throw new Error('Invalid streamed surface layout.');
  this.gl=gl;this.vao=vao;this.vertexCount=vertexCount;this.indexCount=indexCount;
  this.sizes={position:vertexCount*6,normal:vertexCount*6,index:indexCount*4};
  this.received={position:0,normal:0,index:0};this.attributes={};this.buffers=[];this.indices=[];
  this.ready=false;this.disposed=false;this.uploading=false;this.abortController=new AbortController();
 }
 current(signal){aborted(signal);aborted(this.abortController.signal);if(this.disposed)throw new DOMException('Surface preparation was canceled.','AbortError');}
 allocate(){const buffer=this.gl.createBuffer();if(!buffer)throw resourceError('Surface graphics storage is unavailable.');this.buffers.push(buffer);return buffer;}
 async write({kind,byteOffset,buffer},options={}){
  this.current(options.signal);
  if(this.ready||this.uploading)throw new Error('Surface upload order is invalid.');
  const unit=kind==='index'?12:6,bytes=buffer instanceof ArrayBuffer?new Uint8Array(buffer):null;
  if(!Object.hasOwn(this.sizes,kind)||!bytes||!bytes.length||bytes.length>SURFACE_UPLOAD_CHUNK_BYTES||bytes.length%unit||byteOffset!==this.received[kind]||byteOffset+bytes.length>this.sizes[kind])throw new Error('Invalid streamed surface chunk.');
  if(kind!=='position'&&this.received.position!==this.sizes.position||kind==='index'&&this.received.normal!==this.sizes.normal)throw new Error('Surface attributes arrived out of order.');
  this.uploading=true;
  const linked=linkedSignal(this.abortController.signal,options.signal),uploadOptions={...options,signal:linked.signal};
  try{
   await workspace(options.waitForWorkspace,linked.signal);this.current(linked.signal);
   const gl=this.gl;gl.bindVertexArray(this.vao);
   try{
    if(kind==='index'){
     const gpu=this.allocate();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gpu);
     gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,bytes,gl.STATIC_DRAW);
     this.indices.push({buffer:gpu,count:bytes.length/4});
    }else{
     const location=kind==='position'?0:1,type=kind==='position'?gl.UNSIGNED_SHORT:gl.SHORT;
     let gpu=this.attributes[kind];
     if(!gpu){
      gpu=this.attributes[kind]=this.allocate();gl.bindBuffer(gl.ARRAY_BUFFER,gpu);
      gl.bufferData(gl.ARRAY_BUFFER,this.sizes[kind],gl.STATIC_DRAW);checkGraphics(gl);
      gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,3,type,true,0,0);
     }else gl.bindBuffer(gl.ARRAY_BUFFER,gpu);
     gl.bufferSubData(gl.ARRAY_BUFFER,byteOffset,bytes);
    }
    checkGraphics(gl);
   }finally{
    // The working view may render during the wait. Never retain GL bindings
    // across an await or assume that a prior upload's bindings still exist.
    gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);
   }
   await waitForSurfaceGPU(gl,uploadOptions);this.current(linked.signal);
   this.received[kind]+=bytes.length;
  }catch(error){const failure=uploadFailure(error,linked.signal);this.dispose(failure);throw failure;}
  finally{linked.close();this.uploading=false;}
 }
 async finish(flags,options={}){
  this.current(options.signal);
  if(this.uploading||this.ready||Object.keys(this.sizes).some(kind=>this.received[kind]!==this.sizes[kind]))throw new Error('The complete streamed surface has not arrived.');
  if(!(flags instanceof Uint8Array)||flags.length!==this.vertexCount)throw new Error('The complete surface cleanup is missing.');
  this.uploading=true;
  const linked=linkedSignal(this.abortController.signal,options.signal),uploadOptions={...options,signal:linked.signal};
  const gl=this.gl;let gpu;
  try{
  for(let offset=0;offset<flags.length;offset+=SURFACE_UPLOAD_CHUNK_BYTES){
   await workspace(options.waitForWorkspace,linked.signal);this.current(linked.signal);
   gl.bindVertexArray(this.vao);
   try{
    if(!gpu){
     gpu=this.allocate();gl.bindBuffer(gl.ARRAY_BUFFER,gpu);gl.bufferData(gl.ARRAY_BUFFER,flags.length,gl.STATIC_DRAW);checkGraphics(gl);
     gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,1,gl.UNSIGNED_BYTE,true,0,0);
    }else gl.bindBuffer(gl.ARRAY_BUFFER,gpu);
    gl.bufferSubData(gl.ARRAY_BUFFER,offset,flags.subarray(offset,Math.min(flags.length,offset+SURFACE_UPLOAD_CHUNK_BYTES)));checkGraphics(gl);
   }finally{gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);}
   await waitForSurfaceGPU(gl,uploadOptions);this.current(linked.signal);options.onProgress?.(Math.min(flags.length,offset+SURFACE_UPLOAD_CHUNK_BYTES),flags.length);
  }
  this.ready=true;
  }catch(error){const failure=uploadFailure(error,linked.signal);this.dispose(failure);throw failure;}
  finally{linked.close();this.uploading=false;}
 }
 draw(drawIndexed){
  if(!this.ready||this.disposed)throw new Error('An incomplete surface cannot be displayed.');
  let calls=0;
  for(const item of this.indices){this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER,item.buffer);calls+=drawIndexed(this.gl,item.count);}
  return calls;
 }
 dispose(reason){
  if(this.disposed)return;
  this.disposed=true;this.ready=false;
  this.abortController.abort(reason||new DOMException('Surface preparation was canceled.','AbortError'));
  for(const buffer of this.buffers)this.gl.deleteBuffer(buffer);
  this.buffers=[];this.indices=[];this.attributes={};
 }
}
