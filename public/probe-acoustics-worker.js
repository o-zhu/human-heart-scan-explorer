import {computeProbeFrame} from './probe-acoustics.js';
import {volumeGeometry} from './probe-geometry.js';

let volume=null,latest=null,running=null,epoch=0;
const pendingYields=[];
const channel=new MessageChannel();
channel.port1.onmessage=()=>pendingYields.shift()?.();
const yieldToEvents=()=>new Promise(resolve=>{pendingYields.push(resolve);channel.port2.postMessage(0);});

async function pump(){
 if(running||!volume)return;
 while(latest&&volume){
  const job=latest;latest=null;running=job;const generation=epoch,source=volume;
  try{
   const frame=await computeProbeFrame(source,job,{yieldFn:yieldToEvents,cancelled:()=>generation!==epoch||source!==volume});
   if(frame&&generation===epoch&&source===volume)self.postMessage({type:'frame',...frame},[frame.cap.buffer,frame.ct.buffer,frame.ultrasound.buffer]);
  }catch(error){if(generation===epoch)self.postMessage({type:'error',id:job.id,version:job.version,fine:!!job.fineSlice,refinementToken:job.refinementToken,message:error.message||'The probe section could not finish.'});}
  running=null;
 }
}

self.onmessage=event=>{
 const message=event.data;
 if(message.type==='load'){
  epoch++;latest=null;
  volume={data:message.data instanceof Uint8Array?message.data:new Uint8Array(message.data),dimensions:message.meta.dimensions,meta:message.meta,geometry:volumeGeometry(message.meta),support:message.support||null};
  self.postMessage({type:'loaded',version:message.version});return;
 }
 if(message.type==='support'){if(volume)volume.support=message.support||null;epoch++;return;}
 if(message.type==='cancel'){epoch++;latest=null;return;}
 if(message.type!=='sample'||!volume)return;
 latest=message;
 // Finish one small live frame to avoid starvation. Superseded settled frames
 // are interrupted at a bounded yield and only the newest pending pose runs.
 if(running&&(!running.fast||!message.fast))epoch++;
 pump();
};
