export class MPRSampler {
 constructor(){
  this.worker=new Worker(new URL('./mpr-worker.js',import.meta.url),{type:'module'});this.next=0;this.pending=new Map();
  this.worker.onmessage=e=>{const m=e.data,entry=this.pending.get(m.id);if(entry){this.pending.delete(m.id);entry.resolve(m);}};
  this.worker.onerror=e=>{for(const p of this.pending.values())p.reject(new Error(e.message||'The scan section could not be reconstructed.'));this.pending.clear();};
 }
 setVolume(data,meta,extent){this.worker.postMessage({type:'load',data,dimensions:meta.dimensions,extent});this.loaded=true;}
 sample(plane,{width=768,height=768}={}){
  if(!this.loaded)return Promise.reject(new Error('The scan is still loading.'));
  const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({type:'sample',id,plane,width,height});});
 }
 destroy(){this.worker.terminate();for(const p of this.pending.values())p.reject(new Error('The section viewer was closed.'));this.pending.clear();}
}
