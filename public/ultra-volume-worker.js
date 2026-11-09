import {FineVolumeBackend} from './ultra-volume-backend.js';
let backend;
const jobs=new Map();
self.onmessage=async({data:m})=>{
 if(m.type==='init'){backend=new FineVolumeBackend(m.manifest,{baseUrl:m.baseUrl,cacheName:m.cacheName,resourcePolicy:m.resourcePolicy});self.postMessage({type:'ready'});return;}
 if(m.type==='cancel'){jobs.get(m.id)?.abort();return;}
 if(!['sample','warm'].includes(m.type)||!backend)return;
 const controller=new AbortController();jobs.set(m.id,controller);
 try{
  if(m.type==='warm'){
   const result=await backend.warmPlane(m.plane,{signal:controller.signal,localOnly:m.localOnly!==false});
   if(!controller.signal.aborted)self.postMessage({type:'warmed',id:m.id,result,stats:backend.getStatus()});
   return;
  }
  const result=await backend.samplePlane(m.plane,{signal:controller.signal,spacingUm:m.spacingUm,exactRaster:m.exactRaster===true,persistSection:m.persistSection===true,onProgress:progress=>self.postMessage({type:'progress',id:m.id,progress})});
  if(controller.signal.aborted)return;
  // Prepared images stay cached here. An arbitrary reformat has no worker-side
  // owner after this response, so transfer it directly instead of cloning a
  // native-sized (often 8–10 MB) raster which would immediately be discarded.
  const retained=backend.prepared.get(result.preparedPlaneId)?.data===result.data;
  const data=retained?result.data.slice():result.data;self.postMessage({type:'result',id:m.id,result:{...result,data:data.buffer},stats:backend.getStatus()},[data.buffer]);
 }catch(error){controller.abort();self.postMessage({type:'error',id:m.id,name:error.name,message:error.message});}
 finally{jobs.delete(m.id);}
};
