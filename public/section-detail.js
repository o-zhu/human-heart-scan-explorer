import {hostedSections} from './hosted-ultra.js';
const checkAbort = signal => { if (signal?.aborted) throw new DOMException('This section is no longer needed.','AbortError'); };

/** Exact alternate pixels from the shared hosted 79.4 µm scan section. */
export class SectionDetail {
 constructor(store = hostedSections){this.store=store;this.cache=new Map();this.bytes=0;}
 async init(){
  const source=await this.store.init();
  this.manifest={...source,spacingUm:source.spacingUm*2,
   imageDimensionsXYZ:source.imageDimensionsXYZ.map(n=>(n+1)/2),
   inPlaneSourceStride:2,
   detailDerivation:'Exact alternate pixels from the hosted s2 image, without interpolation.'};
  return this.manifest;
 }
 index(axis,position){return Math.round(position*(this.manifest.sliceCounts[axis]-1));}
 cached(axis,index){
  const key=axis+':'+index,result=this.cache.get(key);
  if(result){this.cache.delete(key);this.cache.set(key,result);}
  return result;
 }
 async load(axis,index,{signal,priority=30,onProgress}={}){
  checkAbort(signal);
  const cached=this.cached(axis,index);if(cached)return cached;
  // Every caller has its own cancellation subscription. The shared store deduplicates
  // transfers/decoding, so cancelling an obsolete card cannot cancel the active cap.
  const full=await this.store.load(axis,index,{signal,priority,onProgress});
  checkAbort(signal);
  const shared=this.cached(axis,index);if(shared)return shared;
  const key=axis+':'+index,width=Math.ceil(full.width/2),height=Math.ceil(full.height/2),data=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data[y*width+x]=full.data[2*y*full.width+2*x];
  // Fractional full extents are intentional for an even source dimension:
  // the last alternate pixel lies one native pixel before its far edge.
  const result={...full,data,width,height,key,spacingUm:full.spacingUm*2,
   fullWidth:(full.fullWidth+1)/2,fullHeight:(full.fullHeight+1)/2,
   crop:[full.crop[0]/2,full.crop[1]/2,width,height],
   source:'Hosted measured scan section, exact alternate pixels',inPlaneSourceStride:2};
  if(data.byteLength<=12*1024*1024){
   this.cache.set(key,result);this.bytes+=data.byteLength;
   while(this.bytes>12*1024*1024||this.cache.size>18){
    const oldest=this.cache.keys().next().value;this.bytes-=this.cache.get(oldest).data.byteLength;this.cache.delete(oldest);
   }
  }
  return result;
 }
}
