/** Bound optional preparation by active time, without timing out a paused lab.
 * Progress must reflect completed work or received bytes, never a timer pulse.
 * A stalled worker can be terminated by its owner; late promises cannot commit.
 */
export class ActiveLoadWatchdog {
 constructor({onTimeout,idleMs=90000,totalMs=600000,now=()=>performance.now(),schedule=(fn,delay)=>globalThis.setTimeout(fn,delay),cancel=id=>globalThis.clearTimeout(id)}={}){
  this.onTimeout=onTimeout;this.idleMs=idleMs;this.totalMs=totalMs;this.now=now;this.schedule=schedule;this.cancel=cancel;
  this.active=true;this.closed=false;this.elapsed=0;this.idle=0;this.last=now();this.arm();
 }
 account(){const next=this.now();if(this.active){const delta=Math.max(0,next-this.last);this.elapsed+=delta;this.idle+=delta;}this.last=next;}
 arm(){if(!this.closed&&this.active)this.timer=this.schedule(()=>this.check(),Math.max(1,Math.min(1000,this.idleMs-this.idle,this.totalMs-this.elapsed)));}
 check(){
  if(this.closed)return;this.account();
  if(this.active&&(this.idle>=this.idleMs||this.elapsed>=this.totalMs)){
   this.close();const error=new Error(this.idle>=this.idleMs?'Surface preparation stopped responding.':'Surface preparation exceeded its time budget.');error.name='TimeoutError';this.onTimeout?.(error);return;
  }
  this.arm();
 }
 progress(){if(this.closed)return;this.account();this.idle=0;}
 setActive(active){if(this.closed||this.active===!!active)return;this.account();this.active=!!active;this.cancel(this.timer);this.timer=null;this.arm();}
 close(){if(this.closed)return;this.closed=true;this.cancel(this.timer);this.timer=null;}
}

/** Race every awaited stage, including a promise that ignores AbortSignal. */
export function withAbort(operation,signal){
 if(!signal)return Promise.resolve(operation);
 return new Promise((resolve,reject)=>{
  const done=()=>signal.removeEventListener('abort',aborted);
  const aborted=()=>{done();reject(signal.reason||new DOMException('Loading was interrupted.','AbortError'));};
  signal.addEventListener('abort',aborted,{once:true});
  Promise.resolve(operation).then(value=>{done();signal.aborted?aborted():resolve(value);},error=>{done();reject(error);});
  if(signal.aborted)aborted();
 });
}

/** Observe real response bytes without copying whole responses into memory. */
export function progressFetch(onProgress,fetcher=(...args)=>globalThis.fetch(...args)){
 return async(...args)=>{
  const response=await fetcher(...args);onProgress();
  if(!response.ok||!response.body)return response;
  const reader=response.body.getReader();
  const body=new ReadableStream({
   async pull(controller){
    try{const {value,done}=await reader.read();if(done){reader.releaseLock();controller.close();return;}onProgress();controller.enqueue(value);}
    catch(error){reader.releaseLock();controller.error(error);}
   },
   cancel(reason){return reader.cancel(reason).finally(()=>reader.releaseLock());},
  });
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
}
