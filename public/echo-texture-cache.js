/** Shared measured-preset texture cache; independent of Echo UI and media. */
const abortError=()=>Object.assign(new Error('Section request was superseded.'),{name:'AbortError'});
export const isUltra=(sourceSpacing,planeSpacing,target=79.4)=>Number.isFinite(sourceSpacing)&&sourceSpacing>0&&Math.abs(sourceSpacing-target)<=Math.max(.04,target*1e-5)&&planeSpacing>0&&planeSpacing<=target+Math.max(.04,target*1e-5);
async function decodeDensityOnMain(blob,item){
 const bitmap=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
 try{
  if(bitmap.width!==item.width||bitmap.height!==item.height)throw new Error('Section dimensions do not match the manifest.');
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(bitmap.width,bitmap.height):document.createElement('canvas');
  canvas.width=bitmap.width;canvas.height=bitmap.height;
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);
  const rgba=context.getImageData(0,0,bitmap.width,bitmap.height).data,data=new Uint8Array(bitmap.width*bitmap.height);
  for(let i=0;i<data.length;i++)data[i]=rgba[i*4+3]?rgba[i*4]:0;
  return {data,width:bitmap.width,height:bitmap.height,spacingUm:item.spacingUm,sourceSpacingUm:item.sourceSpacingUm||item.spacingUm,ultra:isUltra(item.sourceSpacingUm||item.spacingUm,item.spacingUm,item.fineSpacingUm),encodedBytes:item.bytes,cleaned:item.cleaned===true};
 }finally{bitmap.close();}
}

function createDensityDecoder(){
 let worker=null,disabled=typeof Worker!=='function'||typeof OffscreenCanvas!=='function',counter=0;
 const pending=new Map();
 const settle=(id,error,value)=>{const job=pending.get(id);if(!job)return;pending.delete(id);job.signal?.removeEventListener('abort',job.abort);if(error)job.reject(error);else job.resolve(value);};
 const fallback=()=>{
  disabled=true;worker?.terminate();worker=null;
  for(const [id,job] of pending){
   if(job.signal?.aborted){settle(id,abortError());continue;}
   decodeDensityOnMain(job.blob,job.item).then(value=>settle(id,null,value),error=>settle(id,error));
  }
 };
 const decode=(blob,item,signal)=>{
  if(signal?.aborted)return Promise.reject(abortError());
  if(disabled)return decodeDensityOnMain(blob,item);
  if(!worker){
   try{
    worker=new Worker(new URL('./echo-texture-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data:message})=>{
     if(message.unsupported){fallback();return;}
     const job=pending.get(message.id);if(!job)return;
     if(message.error){settle(message.id,new Error(message.error));return;}
     settle(message.id,null,{data:new Uint8Array(message.data),width:message.width,height:message.height,spacingUm:job.item.spacingUm,sourceSpacingUm:job.item.sourceSpacingUm||job.item.spacingUm,ultra:isUltra(job.item.sourceSpacingUm||job.item.spacingUm,job.item.spacingUm,job.item.fineSpacingUm),encodedBytes:job.item.bytes,cleaned:job.item.cleaned===true});
    };
    worker.onerror=event=>{event.preventDefault();fallback();};
   }catch{disabled=true;return decodeDensityOnMain(blob,item);}
  }
  return new Promise((resolve,reject)=>{
   const id=++counter,abort=()=>{worker?.postMessage({type:'cancel',id});settle(id,abortError());};
   pending.set(id,{resolve,reject,signal,abort,blob,item});signal?.addEventListener('abort',abort,{once:true});
   worker.postMessage({type:'decode',id,blob,width:item.width,height:item.height});
  });
 };
 decode.dispose=()=>{worker?.terminate();worker=null;for(const id of pending.keys())settle(id,abortError());};
 return decode;
}

/** A selected preset owns a network slot; speculative work is bounded and preemptible. */
export class EchoTextureCache{
 constructor({maxBytes=24*1024*1024,fetcher=(...args)=>globalThis.fetch(...args),decode=null}={}){
  this.maxBytes=maxBytes;this.fetcher=fetcher;this.decode=decode||createDensityDecoder();this.entries=new Map();this.running=new Set();this.queue=[];this.bytes=0;this.clock=0;this.current=null;
 }
 peek(item){const entry=this.entries.get(item?.url);if(entry?.value){entry.used=++this.clock;return entry.value;}return null;}
 load(item,{priority=0}={}){
  if(!item?.url)return Promise.reject(new Error('Missing section URL.'));
  if(priority===0){
   this.current=item.url;
   for(const entry of this.entries.values())if(!entry.value&&entry.item.url!==this.current)entry.priority=1;
   // Preserve one useful in-flight neighbor; cancel older speculative transfers.
   const others=[...this.running].filter(e=>e.item.url!==this.current).sort((a,b)=>b.used-a.used);
   for(const entry of others.slice(1))this.cancel(entry);
  }
  let entry=this.entries.get(item.url);
  if(entry){entry.used=++this.clock;entry.priority=Math.min(entry.priority,priority);this.pump();return entry.promise;}
  entry={item,priority,used:++this.clock,controller:new AbortController(),value:null,settled:false};
  entry.promise=new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;});
  this.entries.set(item.url,entry);this.queue.push(entry);
  // Repeated fast browsing cannot build an unbounded background queue.
  const queued=this.queue.filter(e=>e.item.url!==this.current).sort((a,b)=>b.used-a.used);
  for(const stale of queued.slice(3))this.cancel(stale);
  this.pump();return entry.promise;
 }
 cancel(entry){
  if(entry.settled)return;entry.settled=true;entry.controller.abort();
  this.queue=this.queue.filter(e=>e!==entry);this.running.delete(entry);
  if(this.entries.get(entry.item.url)===entry)this.entries.delete(entry.item.url);
  entry.reject(abortError());
 }
 pump(){
  this.queue.sort((a,b)=>(a.item.url===this.current?-1:b.item.url===this.current?1:a.priority-b.priority)||b.used-a.used);
  while(this.running.size<2&&this.queue.length){
   const index=this.queue.findIndex(e=>e.item.url===this.current||![...this.running].some(r=>r.item.url!==this.current));
   if(index<0)break;const [entry]=this.queue.splice(index,1);this.running.add(entry);
   (async()=>{
    const response=await this.fetcher(entry.item.url,{cache:'force-cache',signal:entry.controller.signal,priority:entry.item.url===this.current?'high':'low'});
    if(!response.ok)throw new Error(`Section image returned ${response.status}`);
    const blob=await response.blob();if(entry.controller.signal.aborted)throw abortError();
    const value=await this.decode(blob,entry.item,entry.controller.signal);if(entry.controller.signal.aborted)throw abortError();
    if(this.entries.get(entry.item.url)!==entry)return;
    entry.value=value;entry.used=++this.clock;entry.settled=true;this.bytes+=value.data.byteLength;
    this.evict();entry.resolve(value);
   })().catch(error=>{
    if(this.entries.get(entry.item.url)===entry)this.entries.delete(entry.item.url);
    if(!entry.settled){entry.settled=true;entry.reject(error);}
   }).finally(()=>{this.running.delete(entry);this.pump();});
  }
 }
 evict(){
  const ready=[...this.entries.values()].filter(e=>e.value&&e.item.url!==this.current).sort((a,b)=>a.used-b.used);
  for(const entry of ready){if(this.bytes<=this.maxBytes)break;this.entries.delete(entry.item.url);this.bytes-=entry.value.data.byteLength;}
 }
 pause(){for(const entry of [...this.entries.values()])if(!entry.value)this.cancel(entry);this.current=null;}
 clear(){this.pause();this.entries.clear();this.bytes=0;}
 destroy(){this.clear();this.decode.dispose?.();}
}

