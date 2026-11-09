/** Download and decode one explicitly selected surface away from the render thread.
 * v23 transport parts reconstruct one welded HFM; they never introduce mesh seams.
 */
const MAX_PART=32*1024*1024,MAX_PACKED=256*1024*1024,MAX_DECODED=512*1024*1024;
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const validSize=(n,max)=>Number.isInteger(n)&&n>0&&n<=max;
const validHash=h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);
let paused=false,downloadAbort=null,running=false;
const resumeWaiters=[];
let lastProgress=null,gzipDecoder=null;
// Emit only measured work. A time threshold still reports a slow stream that
// has not yet advanced a whole percent, without flooding the render thread.
function reportProgress(message,force=false){
 const now=globalThis.performance?.now?.()??Date.now(),percent=message.totalBytes>0?Math.floor(message.loadedBytes/message.totalBytes*100):-1;
 if(!force&&lastProgress&&message.phase===lastProgress.phase&&message.stage===lastProgress.stage&&percent===lastProgress.percent&&now-lastProgress.time<100)return;
 lastProgress={phase:message.phase,stage:message.stage,percent,time:now};
 self.postMessage({type:'progress',...message});
}
function gzipDecompressor(){
 if(!gzipDecoder){
  try{gzipDecoder=new DecompressionStream('gzip');}
  catch{throw new Error('This browser cannot decompress gzip surface files.');}
 }
 return gzipDecoder;
}
function checkCompression(bytes){if(bytes.length>=2&&bytes[0]===31&&bytes[1]===139)gzipDecompressor();}
function setPaused(value){
 paused=!!value;
 if(paused)downloadAbort?.abort();
 else for(const resume of resumeWaiters.splice(0))resume();
}
async function waitForWorkspace(){while(paused)await new Promise(resolve=>resumeWaiters.push(resolve));}
async function activeDownload(operation){
 for(;;){
  await waitForWorkspace();const abort=new AbortController();downloadAbort=abort;
  try{return await operation(abort.signal);}
  catch(error){if(!abort.signal.aborted)throw error;}
  finally{if(downloadAbort===abort)downloadAbort=null;}
 }
}

async function readBounded(stream,target,offset,limit,onProgress,pauseForWorkspace=false){
 const reader=stream.getReader();let used=0;
 try{
  for(;;){
   // The decoder retains its completed bytes and stream backpressure while a
   // lab is active. Check again after read: priority can change during the wait.
   if(pauseForWorkspace)await waitForWorkspace();
   const {value,done}=await reader.read();
   if(pauseForWorkspace)await waitForWorkspace();
   if(done)break;
   if(used+value.byteLength>limit)throw new Error('Fine surface length exceeds its manifest.');
   target.set(value,offset+used);used+=value.byteLength;onProgress?.(used);
  }
  if(used!==limit)throw new Error('Fine surface length did not match.');
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
}

// Older v19 clients supply the decoded size but omit the packed size. Keep
// those requests bounded while they are streaming, before combining chunks.
async function readCapped(stream,limit,onProgress){
 const reader=stream.getReader(),chunks=[];let used=0;
 try{
  for(;;){
   const {value,done}=await reader.read();if(done)break;
   if(used+value.byteLength>limit)throw new Error('Fine surface download exceeds the supported size.');
   chunks.push(value);used+=value.byteLength;onProgress?.(used,value);
  }
  const bytes=new Uint8Array(used);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
}

async function download({url,parts,sha256,compressedBytes}){
 if(compressedBytes!==undefined&&!validSize(compressedBytes,MAX_PACKED))throw new Error('Invalid fine surface download length.');
 if(parts!==undefined){
  if(!Array.isArray(parts)||!parts.length||parts.length>16||!validSize(compressedBytes,MAX_PACKED)||!validHash(sha256))throw new Error('Invalid fine surface transport manifest.');
  let total=0;
  for(const p of parts){
   if(!p||typeof p.url!=='string'||!validSize(p.compressedBytes,MAX_PART)||!validHash(p.sha256))throw new Error('Invalid fine surface part manifest.');
   total+=p.compressedBytes;
  }
  if(total!==compressedBytes)throw new Error('Fine surface transport length did not match.');
  await waitForWorkspace();
  const bytes=new Uint8Array(total);let offset=0,verifiedParts=0;
  for(const p of parts){
   await activeDownload(async signal=>{
   const response=await fetch(p.url,{priority:'low',signal});
   if(!response.ok)throw new Error('Fine surface download failed ('+response.status+').');
   if(!response.body)throw new Error('Fine surface download was empty.');
   await readBounded(response.body,bytes,offset,p.compressedBytes,n=>{
    const loaded=offset+n;checkCompression(bytes.subarray(0,loaded));
    reportProgress({phase:'download',stage:'download',loadedBytes:loaded,totalBytes:total,verifiedParts,totalParts:parts.length});
   });
   if(await hash(bytes.subarray(offset,offset+p.compressedBytes))!==p.sha256)throw new Error('Fine surface part checksum did not match.');
   });
   offset+=p.compressedBytes;
   reportProgress({phase:'download',stage:'verify-part',loadedBytes:offset,totalBytes:total,verifiedParts:++verifiedParts,totalParts:parts.length},true);
  }
  await waitForWorkspace();
  if(await hash(bytes)!==sha256)throw new Error('Fine surface checksum did not match.');
  reportProgress({phase:'download',stage:'verify-surface',loadedBytes:total,totalBytes:total,verifiedParts,totalParts:parts.length},true);
  return bytes;
 }
 return activeDownload(async signal=>{
 const response=await fetch(url,{priority:'low',signal});
 if(!response.ok)throw new Error('Fine surface download failed ('+response.status+').');
 if(!response.body)throw new Error('Fine surface download was empty.');
 let bytes;
 if(compressedBytes!==undefined){
  bytes=new Uint8Array(compressedBytes);
  await readBounded(response.body,bytes,0,compressedBytes,n=>{
   checkCompression(bytes.subarray(0,n));
   reportProgress({phase:'download',stage:'download',loadedBytes:n,totalBytes:compressedBytes});
  });
 }else{
  const prefix=new Uint8Array(2);let prefixLength=0;
  bytes=await readCapped(response.body,MAX_PACKED,(n,chunk)=>{
   const take=Math.min(2-prefixLength,chunk.length);
   if(take){prefix.set(chunk.subarray(0,take),prefixLength);prefixLength+=take;checkCompression(prefix.subarray(0,prefixLength));}
   reportProgress({phase:'download',stage:'download',loadedBytes:n,totalBytes:0});
  });
  if(!validSize(bytes.length,MAX_PACKED))throw new Error('Fine surface download exceeds the supported size.');
 }
 if(sha256&&await hash(bytes)!==sha256)throw new Error('Fine surface checksum did not match.');
 reportProgress({phase:'download',stage:'verify-part',loadedBytes:bytes.length,totalBytes:bytes.length,verifiedParts:sha256?1:0,totalParts:1},true);
 return bytes;
 });
}

self.onmessage=async event=>{
 if(event.data?.type==='workspace-priority'){setPaused(event.data.paused);return;}
 if(running)return;
 running=true;setPaused(event.data.paused===true);
 const {expectedBytes,decodedSha256}=event.data;
 try{
  if(!validSize(expectedBytes,MAX_DECODED))throw new Error('Invalid fine surface decoded length.');
  if(typeof globalThis.crypto?.subtle?.digest!=='function')throw new Error('This browser cannot securely verify surface files (SHA-256 unavailable).');
  if(event.data.compact){
   const compact=event.data.compact;
   if(compact.decodedBytes!==expectedBytes||compact.decodedSha256!==decodedSha256)throw new Error('Compact surface identity did not match the selected profile.');
   const {decodeCompactSurface}=await import('./compact-surface-codec.js');
   const decoded=await decodeCompactSurface(compact,{
    loadPart:(part,onProgress)=>activeDownload(async signal=>{
     if(typeof part.url!=='string')throw new Error('Compact surface part URL is missing.');
     const response=await fetch(part.url,{priority:'low',signal});
     if(!response.ok)throw new Error('Compact surface download failed ('+response.status+').');
     if(!response.body)throw new Error('Compact surface download was empty.');
     const bytes=new Uint8Array(part.compressedBytes);
     await readBounded(response.body,bytes,0,part.compressedBytes,onProgress);
     return bytes;
    }),
    waitForWorkspace,
    onProgress:progress=>reportProgress(progress,progress.stage==='verify-part'||progress.stage==='decode-block'||progress.stage==='verify-surface'),hash,
   });
   await waitForWorkspace();
   const {bytes,...layout}=decoded;
   self.postMessage({buffer:bytes.buffer,...layout},[bytes.buffer]);
   return;
  }
  let bytes=await download(event.data);
  await waitForWorkspace();
  if(bytes[0]===31&&bytes[1]===139){
   reportProgress({phase:'decode',stage:'inflate',loadedBytes:0,totalBytes:expectedBytes},true);
   const stream=new Blob([bytes]).stream().pipeThrough(gzipDecompressor());
   const decoded=new Uint8Array(expectedBytes);
   await readBounded(stream,decoded,0,expectedBytes,n=>reportProgress({phase:'decode',stage:'inflate',loadedBytes:n,totalBytes:expectedBytes}),true);bytes=decoded;
  }
  await waitForWorkspace();
  if(bytes.length!==expectedBytes)throw new Error('Fine surface length did not match.');
  const geometrySourceSha256=await hash(bytes);
  if(decodedSha256&&geometrySourceSha256!==decodedSha256)throw new Error('Fine surface decoded checksum did not match.');
  reportProgress({phase:'decode',stage:'verify-surface',loadedBytes:expectedBytes,totalBytes:expectedBytes},true);
  await waitForWorkspace();
  const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<32||d.getUint32(0,true)!==0x314d4648||d.getUint32(4,true)!==1)throw new Error('Unsupported fine surface format.');
  const vertexCount=d.getUint32(8,true),indexCount=d.getUint32(12,true),positionOffset=d.getUint32(16,true),normalOffset=d.getUint32(20,true),indexOffset=d.getUint32(24,true);
  if(!vertexCount||!indexCount||indexCount%3||positionOffset<32||positionOffset%4||normalOffset%4||indexOffset%4||positionOffset+vertexCount*6>normalOffset||normalOffset+vertexCount*6>indexOffset||indexOffset+indexCount*4!==bytes.length)throw new Error('Invalid fine surface layout.');
  const indices=new Uint32Array(bytes.buffer,bytes.byteOffset+indexOffset,indexCount);
  for(let start=0;start<indices.length;start+=262144){
   await waitForWorkspace();
   const end=Math.min(indices.length,start+262144);
   for(let i=start;i<end;i++)if(indices[i]>=vertexCount)throw new Error('Invalid fine surface index.');
   reportProgress({phase:'decode',stage:'validate-indices',loadedBytes:end*4,totalBytes:indexCount*4},end===indices.length);
  }
  // The controller also gates installation, covering a workspace change after
  // this final worker check but before the main thread accepts the message.
  await waitForWorkspace();
  self.postMessage({buffer:bytes.buffer,vertexCount,indexCount,positionOffset,normalOffset,indexOffset,geometrySourceSha256},[bytes.buffer]);
 }catch(error){self.postMessage({error:error.message});}
};
