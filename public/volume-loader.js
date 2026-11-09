/** Fetch, inflate and prepare acceleration away from the interaction thread. */
import {scanActivity} from './download-priority.js';
import {ActiveLoadWatchdog} from './load-watchdog.js';
export class VolumeLoader {
 constructor({activity=scanActivity,workerFactory=url=>new Worker(url,{type:'module'}),watchdogFactory=options=>new ActiveLoadWatchdog({...options,idleMs:60000,totalMs:300000})}={}){this.sequence=0;this.pending=null;this.activity=activity;this.workerFactory=workerFactory;this.watchdogFactory=watchdogFactory;}
 cancel(){
  this.sequence++;this.watchdog?.close();this.watchdog=null;this.worker?.terminate();this.worker=null;
  this.pending?.reject(new DOMException('Superseded volume request','AbortError'));this.pending=null;
 }
 load(level,{original=false,gpuCrop=false,acceleration=true,onProgress=()=>{}}={}){
  this.cancel();const id=this.sequence;
  const release=this.activity?.beginForeground('volume')||(()=>{});
  return new Promise((resolve,reject)=>{
   const worker=this.workerFactory(new URL('./volume-loader-worker.js',import.meta.url));this.worker=worker;this.pending={reject};
   let finished=false;
   const finish=()=>{if(finished)return;finished=true;watchdog.close();worker.terminate();if(this.worker===worker){this.worker=null;this.pending=null;this.watchdog=null;}};
   const watchdog=this.watchdog=this.watchdogFactory({onTimeout:error=>{finish();error.message='The scan download or preparation stopped responding. Try Again to restart the request.';reject(error);}});
   worker.onmessage=event=>{
    if(finished||id!==this.sequence)return;const message=event.data;
    watchdog.progress();
    if(message.type==='progress'){try{onProgress(message);}catch{}return;}
    finish();
    if(message.type==='error'){reject(new Error(message.message));return;}
    if(message.type!=='ready'||!(message.data instanceof ArrayBuffer)){reject(new Error('The scan worker returned an incomplete result. Try Again.'));return;}
    resolve({data:new Uint8Array(message.data),acceleration:message.acceleration,gpuCrop:message.gpuCrop,stats:message.stats,original});
   };
   worker.onerror=event=>{if(finished||id!==this.sequence)return;finish();reject(new Error(event.message||'The scan preparation worker could not start.'));};
   worker.onmessageerror=()=>{if(finished||id!==this.sequence)return;finish();reject(new Error('The scan worker could not transfer its result. Try a smaller resolution.'));};
   try{worker.postMessage({level,original,gpuCrop,acceleration,baseUrl:globalThis.document?.baseURI||import.meta.url});}
   catch(error){finish();reject(error);}
  }).finally(release);
 }
}
