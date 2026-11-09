import {makeUltraPlan} from './ultra-plan.js';

/**
 * Explicit, cancellable source streaming for 79.4 µm orthogonal cut faces.
 * The standard 158.8 µm texture should remain visible until load() resolves.
 */
export class UltraSections {
  constructor(){this.cache=new Map();this.pending=new Map();this.serial=0;}
  async init(){
    if(this.ready)return this.ready;
    this.ready=(async()=>{
      const response=await fetch(new URL('./assets/ultra-source.json',import.meta.url));
      if(!response.ok)throw new Error('Ultra detail metadata is unavailable.');
      this.manifest=await response.json();
      if(this.manifest.supportUrl){
        try{
          const r=await fetch(new URL(this.manifest.supportUrl,import.meta.url));
          if(r.ok)this.support=await r.json();
        }catch{/* Conservative bounding-box fallback still preserves the heart. */}
      }
      return this.manifest;
    })();
    try{return await this.ready;}catch(error){this.ready=null;throw error;}
  }
  plan(axis,index){
    if(!this.manifest)throw new Error('Initialize ultra detail before estimating the transfer.');
    return makeUltraPlan(axis,index,this.manifest,this.support);
  }
  estimate(axis,index){
    const plan=this.plan(axis,index);
    return {blocks:plan.blocks.length,estimatedBytes:plan.estimatedBytes,cached:this.hasCached(axis,index),cachedBlocks:this.hasCached(axis,index)?plan.blocks.length:0,
      rangeOptimized:plan.rangeOptimized,width:plan.width,height:plan.height,spacingUm:79.4};
  }
  hasCached(axis,index){return this.cache.has(`s2:${axis}:${index}`);}
  workerInstance(){
    if(this.worker)return this.worker;
    if(!globalThis.Worker)throw new Error('This browser cannot stream ultra detail in a background worker.');
    const worker=new Worker(new URL('./ultra-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data:message})=>{
      const task=this.pending.get(message.id);if(!task)return;
      if(message.type==='progress'){task.onProgress?.(message.progress);return;}
      this.pending.delete(message.id);task.cleanup?.();
      if(message.type==='error'){
        const error=new Error(message.message);error.name=message.name;task.reject(error);return;
      }
      if(message.type==='cache-status'){task.resolve(message.cached);return;}
      const result=message.result;
      this.cache.delete(result.key);this.cache.set(result.key,result);
      while(this.cache.size>6)this.cache.delete(this.cache.keys().next().value);
      task.resolve(result);
    };
    worker.onerror=()=>{
      for(const task of this.pending.values()){task.cleanup?.();task.reject(new Error('Ultra detail could not start. The detailed cutaway remains available.'));}
      this.pending.clear();worker.terminate();this.worker=null;
    };
    worker.postMessage({type:'configure',manifest:this.manifest,support:this.support});
    this.worker=worker;return worker;
  }
  async canLoadFromCache(axis,index){
    await this.init();if(this.hasCached(axis,index))return true;
    const worker=this.workerInstance(),id=++this.serial;
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject,query:true});worker.postMessage({type:'cache-status',id,axis,index});});
  }
  async load(axis,index,{signal,onProgress,cacheOnly=false}={}){
    await this.init();
    if(signal?.aborted)throw new DOMException('Ultra detail request cancelled.','AbortError');
    const plan=this.plan(axis,index);
    this.cancel();
    if(this.cache.has(plan.key)){
      const result=this.cache.get(plan.key);this.cache.delete(plan.key);this.cache.set(plan.key,result);
      onProgress?.({stage:'ready',completed:result.blocks,loaded:result.blocks,total:result.blocks,receivedBytes:0,bytes:0,cached:true,spacingUm:79.4});
      return result;
    }
    const worker=this.workerInstance(),id=++this.serial;
    return new Promise((resolve,reject)=>{
      const abort=()=>{
        worker.postMessage({type:'cancel',id});this.pending.delete(id);cleanup();
        reject(new DOMException('Ultra detail request cancelled.','AbortError'));
      };
      const cleanup=()=>signal?.removeEventListener('abort',abort);
      signal?.addEventListener('abort',abort,{once:true});
      this.pending.set(id,{resolve,reject,onProgress,cleanup,abort});
      worker.postMessage({type:'load',id,axis,index,cacheOnly});
    });
  }
  cancel(){for(const task of [...this.pending.values()])if(!task.query)task.abort?.();}
  dispose(){
    this.cancel();this.worker?.terminate();this.worker=null;
    for(const task of this.pending.values())task.resolve(false);
    this.pending.clear();this.cache.clear();
  }
}
