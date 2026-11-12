import {fineAbort} from './ultra-volume-core.js';
import {withAbort} from './load-watchdog.js';

/** Share a bounded number of verified brick operations across changing planes.
 * A superseded consumer may leave an already-started transfer to fill the cache;
 * queued obsolete work is removed immediately. Integrity failures never keep
 * sibling work alive, and every physical operation has a finite deadline.
 */
export class FineBrickQueue {
 constructor({limit=4,timeoutMs=20000,retries=1}={}){
  this.limit=Math.max(1,Math.min(12,limit));this.timeoutMs=timeoutMs;this.retries=retries;
  this.items=new Map();this.active=0;this.peak=0;this.shared=0;this.retained=0;this.timeouts=0;
 }
 request(key,load,{signal,priority='high',retainOnAbort=false}={}){
  if(signal?.aborted)return Promise.reject(signal.reason||fineAbort());
  let task=this.items.get(key);
  if(task?.controller.signal.aborted)task=null;
  if(!task){task={key,load,priority,controller:new AbortController(),waiters:new Set(),started:false};this.items.set(key,task);}
  else{this.shared++;if(priority==='high')task.priority='high';}
  return new Promise((resolve,reject)=>{
   const waiter={resolve,reject,signal,abort:null};
   const detach=()=>{signal?.removeEventListener('abort',waiter.abort);task.waiters.delete(waiter);};
   waiter.abort=()=>{
    detach();reject(signal.reason||fineAbort());
    if(task.waiters.size)return;
    if(task.started&&retainOnAbort&&(signal.reason?.name||'AbortError')==='AbortError'){this.retained++;return;}
    task.controller.abort(signal.reason||fineAbort());
    if(!task.started&&this.items.get(key)===task)this.items.delete(key);
   };
   waiter.finish=(error,value)=>{detach();error?reject(error):resolve(value);};
   task.waiters.add(waiter);signal?.addEventListener('abort',waiter.abort,{once:true});
   if(signal?.aborted)waiter.abort();else this.pump();
  });
 }
 pump(){
  while(this.active<this.limit){
   const waiting=[...this.items.values()].filter(task=>!task.started&&task.waiters.size&&!task.controller.signal.aborted);
   const task=waiting.find(task=>task.priority==='high')||waiting[0];if(!task)return;
   task.started=true;this.active++;this.peak=Math.max(this.peak,this.active);void this.run(task);
  }
 }
 async run(task){
  let result,error;
  try{
   for(let attempt=0;attempt<=this.retries;attempt++){
    const controller=new AbortController(),abort=()=>controller.abort(task.controller.signal.reason||fineAbort());
    task.controller.signal.addEventListener('abort',abort,{once:true});if(task.controller.signal.aborted)abort();
    const timer=setTimeout(()=>{this.timeouts++;const failure=new Error('A fine-detail block stopped responding. Move the probe or retry the view.');failure.name='TimeoutError';controller.abort(failure);},this.timeoutMs);
    try{result=await withAbort(Promise.resolve().then(()=>task.load(controller.signal)),controller.signal);error=null;break;}
    catch(failure){error=failure;if(failure.name!=='TimeoutError'||attempt===this.retries||task.controller.signal.aborted)break;}
    finally{clearTimeout(timer);task.controller.signal.removeEventListener('abort',abort);}
   }
  }finally{
   if(this.items.get(task.key)===task)this.items.delete(task.key);this.active--;
   for(const waiter of [...task.waiters])waiter.finish(error,result);
   this.pump();
  }
 }
 destroy(){for(const task of this.items.values()){task.controller.abort(fineAbort());for(const waiter of [...task.waiters])waiter.finish(fineAbort());}this.items.clear();}
 getStatus(){return {activeBrickTransfers:this.active,queuedBrickTransfers:[...this.items.values()].filter(t=>!t.started).length,peakBrickTransfers:this.peak,sharedBrickTransfers:this.shared,retainedBrickTransfers:this.retained,brickTimeouts:this.timeouts};}
}
