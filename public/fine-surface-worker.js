/** Download and decode one explicitly selected surface away from the render thread.
 * v23 transport parts reconstruct one welded HFM; they never introduce mesh seams.
 */
const MAX_PART=32*1024*1024,MAX_PACKED=256*1024*1024,MAX_DECODED=512*1024*1024;
const DOWNLOAD_IDLE_MS=20000,MAX_DOWNLOAD_RECOVERIES=3;
let downloadRecoveries=0;
let boundedSurfaceHash=true,surfaceHashModule=null;
const hash=async bytes=>{
 if(!boundedSurfaceHash||bytes.byteLength<=8*1024*1024)return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 // Web Crypto accepts the whole input in one operation. Avoid an additional
 // full-model verification copy on cautious devices; never skip any identity.
 const {sha256Surface}=await(surfaceHashModule??=import('./surface-sha256.js'));
 return sha256Surface(bytes,{waitForWorkspace,onProgress:(loadedBytes,totalBytes)=>reportProgress({phase:'decode',stage:'verify-surface',loadedBytes,totalBytes})});
};
const validSize=(n,max)=>Number.isInteger(n)&&n>0&&n<=max;
const validHash=h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);
const isResourceFailure=error=>error?.resourceFailure===true||error?.name==='RangeError'||/out of memory|allocation failed|could not allocate|array buffer allocation/i.test(error?.message||'');
let paused=false,downloadAbort=null,running=false;
const resumeWaiters=[];
let lastProgress=null,gzipDecoder=null;
let streamSequence=0,streamAcknowledgement=null;
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
 if(paused)downloadAbort?.abort(Object.assign(new Error('Surface download paused for the active workspace.'),{name:'AbortError',workspacePause:true}));
 else for(const resume of resumeWaiters.splice(0))resume();
}
async function waitForWorkspace(signal){
 while(paused){
  signal?.throwIfAborted();
  await new Promise((resolve,reject)=>{
   const resume=()=>{signal?.removeEventListener('abort',abort);resolve();};
   const abort=()=>{const index=resumeWaiters.indexOf(resume);if(index>=0)resumeWaiters.splice(index,1);reject(signal.reason||new DOMException('Surface loading was cancelled.','AbortError'));};
   resumeWaiters.push(resume);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
 }
 signal?.throwIfAborted();
}
// Abort must settle even if a browser's fetch/read/cancel promise does not.
// Observe abandoned promises, but never await stream cleanup before recovery.
function interruptible(operation,signal){
 if(!signal)return Promise.resolve(operation);
 return new Promise((resolve,reject)=>{
  const finish=(callback,value)=>{signal.removeEventListener('abort',cancel);callback(value);};
  const cancel=()=>finish(reject,signal.reason||new DOMException('Surface loading was cancelled.','AbortError'));
  signal.addEventListener('abort',cancel,{once:true});
  Promise.resolve(operation).then(value=>signal.aborted?cancel():finish(resolve,value),error=>finish(reject,error));
  if(signal.aborted)cancel();
 });
}
function cancelStream(stream,reason){
 try{Promise.resolve(stream?.cancel(reason)).catch(()=>{});}catch{}
}
function releaseReader(reader){try{reader.releaseLock();}catch{}}
const transportError=(message,details={})=>Object.assign(new Error(message),{retryableNetwork:true,...details});
async function networkRead(reader,network){
 try{return await interruptible(reader.read(),network?.signal);}
 catch(error){
  if(network&&!network.signal.aborted&&error?.name==='TypeError')error.retryableNetwork=true;
  throw error;
 }
}

/** The manifest already divides Ultra into independent, verified blocks.
 * Recover just the unfinished block; never concatenate partial HTTP bodies.
 * The idle clock covers headers and every body read, and ends before hashing.
 */
async function fetchSurface(url,signal,consume){
 const abort=new AbortController();let timer=null,response=null,complete=false;
 const cancel=()=>abort.abort(signal.reason);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 const progress=()=>{
  clearTimeout(timer);
  timer=setTimeout(()=>abort.abort(transportError('Surface download stopped receiving data.',{name:'TimeoutError'})),DOWNLOAD_IDLE_MS);
 };
 try{
  abort.signal.throwIfAborted();progress();
  const pending=Promise.resolve().then(()=>{
   abort.signal.throwIfAborted();return fetch(url,{priority:'low',signal:abort.signal});
  }).then(value=>{
   if(abort.signal.aborted){cancelStream(value?.body,abort.signal.reason);throw abort.signal.reason;}
   return value;
  },error=>{
   if(!abort.signal.aborted&&error?.name==='TypeError')error.retryableNetwork=true;
   throw error;
  });
  response=await interruptible(pending,abort.signal);
  if(!response.ok){
   const error=new Error('Surface download failed ('+response.status+').');
   if(response.status===408||response.status===429||response.status>=500&&response.status<=599)error.retryableNetwork=true;
   throw error;
  }
  if(!response.body)throw transportError('Surface download was empty.');
  const result=await interruptible(consume(response.body,{signal:abort.signal,progress}),abort.signal);
  complete=true;return result;
 }catch(error){abort.abort(error);cancelStream(response?.body,error);throw error;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(!complete)cancelStream(response?.body,abort.signal.reason);}
}

async function recoveryDelay(milliseconds,signal){
 for(;;){
  await waitForWorkspace(signal);const abort=new AbortController();downloadAbort=abort;let timer;
  const cancel=()=>abort.abort(signal.reason);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  try{await interruptible(new Promise(resolve=>{timer=setTimeout(resolve,milliseconds);}),abort.signal);return;}
  catch(error){if(signal?.aborted)throw signal.reason||error;if(!abort.signal.reason?.workspacePause)throw error;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(downloadAbort===abort)downloadAbort=null;}
 }
}
async function activeDownload(operation,signal){
 for(;;){
  await waitForWorkspace(signal);const abort=new AbortController();downloadAbort=abort;let retryDelay=0;
  const cancel=()=>abort.abort(signal.reason);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  // Only the network helper races pause/abort. Keep completed-body hashing
  // attached to this attempt so a pause cannot orphan it and start a copy.
  try{abort.signal.throwIfAborted();const result=await operation(abort.signal);signal?.throwIfAborted();return result;}
  catch(error){
   if(signal?.aborted)throw signal.reason||error;
   if(isResourceFailure(error))throw error;
   if(abort.signal.reason?.workspacePause&&(error===abort.signal.reason||error?.name==='AbortError'||error?.retryableNetwork))continue;
   if(!error?.retryableNetwork)throw error;
   if(downloadRecoveries>=MAX_DOWNLOAD_RECOVERIES)throw Object.assign(new Error(error.message+' Surface download could not reconnect after 3 recovery attempts.'),{networkFailure:true,cause:error});
   const retryAttempt=++downloadRecoveries;retryDelay=1000*2**(retryAttempt-1);
   reportProgress({phase:'download',stage:'reconnect',retryAttempt,maxRetries:MAX_DOWNLOAD_RECOVERIES,retryDelayMs:retryDelay},true);
  }
  finally{signal?.removeEventListener('abort',cancel);if(downloadAbort===abort)downloadAbort=null;}
  await recoveryDelay(retryDelay,signal);
 }
}

async function acknowledgeStream(type,message,transfer=[]){
 await waitForWorkspace();
 const sequence=streamSequence++;
 return await new Promise((resolve,reject)=>{
  streamAcknowledgement={sequence,resolve,reject,bufferBytes:message.buffer?.byteLength||0};
  try{self.postMessage({type,sequence,...message},transfer);}catch(error){streamAcknowledgement=null;reject(error);}
 });
}

/** The original transport is one gzip stream split into independently verified
 * parts. Feed at most 64 KiB at a time, with decompressor backpressure connected
 * to the GPU acknowledgement. Never join its 228 MB download or 437 MB output.
 */
async function streamOriginalSurface(request,{debrisFlags,onStart,onChunk}){
 const {SurfaceSha256}=await import('./surface-sha256.js');
 const {SurfaceStreamVerifier}=await import('./surface-stream.js');
 const {compressedBytes,sha256,expectedBytes,decodedSha256}=request;
 if(!validSize(compressedBytes,MAX_PACKED)||!validHash(sha256)||!validHash(decodedSha256))throw new Error('Invalid fine surface transport manifest.');
 const parts=request.parts||[{url:request.url,compressedBytes,sha256}];
 if(!Array.isArray(parts)||!parts.length||parts.length>16)throw new Error('Invalid fine surface transport manifest.');
 let total=0;
 for(const part of parts){if(!part||typeof part.url!=='string'||!validSize(part.compressedBytes,MAX_PART)||!validHash(part.sha256))throw new Error('Invalid fine surface part manifest.');total+=part.compressedBytes;}
 if(total!==compressedBytes)throw new Error('Fine surface transport length did not match.');
 let decompressor;
 try{decompressor=new DecompressionStream('gzip');}catch{throw new Error('This browser cannot decompress gzip surface files.');}
 const writer=decompressor.writable.getWriter(),reader=decompressor.readable.getReader(),cancel=new AbortController();
 const wait=()=>waitForWorkspace(cancel.signal),packedHash=new SurfaceSha256();
 const sink=new SurfaceStreamVerifier({expectedBytes,decodedSha256,debrisFlags,onStart,onChunk,waitForWorkspace:wait,onProgress:reportProgress});
 let downloaded=0,verifiedParts=0;
 const produce=(async()=>{
  try{
   for(const part of parts){
    let packed=await activeDownload(async signal=>{
     const bytes=new Uint8Array(part.compressedBytes);
     await fetchSurface(part.url,signal,(body,network)=>readBounded(body,bytes,0,part.compressedBytes,count=>reportProgress({phase:'download',stage:'download',loadedBytes:downloaded+count,totalBytes:compressedBytes,verifiedParts,totalParts:parts.length}),false,network));
     if(await hash(bytes)!==part.sha256)throw new Error('Fine surface part checksum did not match.');
     return bytes;
    },cancel.signal);
    if(!downloaded&&(packed[0]!==31||packed[1]!==139))throw new Error('Invalid fine surface compression.');
    downloaded+=packed.length;verifiedParts++;
    reportProgress({phase:'download',stage:'verify-part',loadedBytes:downloaded,totalBytes:compressedBytes,verifiedParts,totalParts:parts.length},true);
    for(let offset=0;offset<packed.length;offset+=65536){
     await wait();const bytes=packed.subarray(offset,Math.min(offset+65536,packed.length));
     packedHash.update(bytes);await interruptible(writer.write(bytes),cancel.signal);
    }
    packed=null;
   }
   if(packedHash.digest()!==sha256)throw new Error('Fine surface checksum did not match.');
   await interruptible(writer.close(),cancel.signal);return {ok:true};
  }catch(error){cancel.abort(error);void writer.abort(error).catch(()=>{});return {error};}
 })();
 try{
  for(;;){
   await wait();const {value,done}=await interruptible(reader.read(),cancel.signal);await wait();if(done)break;
   await sink.write(value);
  }
  const produced=await produce;if(produced.error)throw produced.error;
  return await sink.finish();
 }catch(error){
  cancel.abort(error);cancelStream(reader,error);
  await produce;throw error;
 }finally{releaseReader(reader);try{writer.releaseLock();}catch{}}
}

async function readBounded(stream,target,offset,limit,onProgress,pauseForWorkspace=false,network=null){
 const reader=stream.getReader();let used=0;
 try{
  for(;;){
   // The decoder retains its completed bytes and stream backpressure while a
   // lab is active. Check again after read: priority can change during the wait.
   if(pauseForWorkspace)await waitForWorkspace();
   const {value,done}=await networkRead(reader,network);
   if(pauseForWorkspace)await waitForWorkspace();
   if(done)break;
   if(used+value.byteLength>limit)throw new Error('Fine surface length exceeds its manifest.');
   if(!value.byteLength)continue;
   network?.progress();
   target.set(value,offset+used);used+=value.byteLength;onProgress?.(used);
  }
  if(used!==limit)throw network?transportError('Fine surface download length did not match.'):new Error('Fine surface length did not match.');
 }catch(error){cancelStream(reader,error);throw error;}
 finally{releaseReader(reader);}
}

// Older v19 clients supply the decoded size but omit the packed size. Keep
// those requests bounded while they are streaming, before combining chunks.
async function readCapped(stream,limit,onProgress,network=null){
 const reader=stream.getReader(),chunks=[];let used=0;
 try{
  for(;;){
   const {value,done}=await networkRead(reader,network);if(done)break;
   if(used+value.byteLength>limit)throw new Error('Fine surface download exceeds the supported size.');
   if(!value.byteLength)continue;
   network?.progress();
   chunks.push(value);used+=value.byteLength;onProgress?.(used,value);
  }
  const bytes=new Uint8Array(used);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
 }catch(error){cancelStream(reader,error);throw error;}
 finally{releaseReader(reader);}
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
   await fetchSurface(p.url,signal,(body,network)=>readBounded(body,bytes,offset,p.compressedBytes,n=>{
    const loaded=offset+n;checkCompression(bytes.subarray(0,loaded));
    reportProgress({phase:'download',stage:'download',loadedBytes:loaded,totalBytes:total,verifiedParts,totalParts:parts.length});
   },false,network));
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
 const bytes=await fetchSurface(url,signal,async(body,network)=>{
 if(compressedBytes!==undefined){
  const bytes=new Uint8Array(compressedBytes);
  await readBounded(body,bytes,0,compressedBytes,n=>{
   checkCompression(bytes.subarray(0,n));
   reportProgress({phase:'download',stage:'download',loadedBytes:n,totalBytes:compressedBytes});
  },false,network);
  return bytes;
 }else{
  const prefix=new Uint8Array(2);let prefixLength=0;
  const bytes=await readCapped(body,MAX_PACKED,(n,chunk)=>{
   const take=Math.min(2-prefixLength,chunk.length);
   if(take){prefix.set(chunk.subarray(0,take),prefixLength);prefixLength+=take;checkCompression(prefix.subarray(0,prefixLength));}
   reportProgress({phase:'download',stage:'download',loadedBytes:n,totalBytes:0});
  },network);
  if(!validSize(bytes.length,MAX_PACKED))throw new Error('Fine surface download exceeds the supported size.');
  return bytes;
 }
 });
 if(sha256&&await hash(bytes)!==sha256)throw new Error('Fine surface checksum did not match.');
 reportProgress({phase:'download',stage:'verify-part',loadedBytes:bytes.length,totalBytes:bytes.length,verifiedParts:sha256?1:0,totalParts:1},true);
 return bytes;
 });
}

self.onmessage=async event=>{
 if(event.data?.type==='workspace-priority'){setPaused(event.data.paused);return;}
 if(event.data?.type==='surface-ack'){
  const pending=streamAcknowledgement;
  // Duplicate/late acknowledgements cannot release a later chunk or accumulate
  // credit. There is exactly one outstanding transfer in this worker.
  if(pending&&event.data.sequence===pending.sequence){
   streamAcknowledgement=null;
   if(event.data.error){const error=new Error(String(event.data.error));error.resourceFailure=event.data.resourceFailure===true;pending.reject(error);}
   else if(event.data.buffer!==undefined&&(!(event.data.buffer instanceof ArrayBuffer)||!pending.bufferBytes||event.data.buffer.byteLength!==pending.bufferBytes))pending.reject(new Error('The returned surface buffer did not match its transfer.'));
   else pending.resolve(event.data.buffer);
  }
  return;
 }
 if(running)return;
 running=true;boundedSurfaceHash=event.data.boundedSurfaceHash!==false;setPaused(event.data.paused===true);
 const {expectedBytes,decodedSha256}=event.data;
 try{
  if(!validSize(expectedBytes,MAX_DECODED))throw new Error('Invalid fine surface decoded length.');
  if(typeof globalThis.crypto?.subtle?.digest!=='function')throw new Error('This browser cannot securely verify surface files (SHA-256 unavailable).');
  if(event.data.streamSurface===true){
   const {initializeSurfaceHash}=await import('./surface-sha256.js');
   await initializeSurfaceHash();
   const debrisFlags=event.data.debrisFlags;
   const onStart=layout=>acknowledgeStream('surface-start',{layout,...layout,expectedBytes});
   const onChunk=({kind,byteOffset,bytes})=>acknowledgeStream('surface-chunk',{kind,byteOffset,buffer:bytes.buffer},[bytes.buffer]);
   let result;
   if(event.data.compact){
    const compact=event.data.compact;
    if(compact.decodedBytes!==expectedBytes||compact.decodedSha256!==decodedSha256)throw new Error('Compact surface identity did not match the selected profile.');
    const {streamCompactSurface,validateCompactManifest}=await import('./compact-surface-codec.js');
    // Reject metadata before disk or network work. The optional OPFS spool
    // separates transfer from geometry preparation without retaining 132 MB of
    // compressed data, or the 437 MB decoded model, in the JavaScript heap.
    validateCompactManifest(compact);
    let previousKind=1;
    for(const part of compact.parts){if(part.kind<previousKind)throw new Error('Compact surface blocks are not in stream order.');previousKind=part.kind;}
    gzipDecompressor();
    const {MeshoptDecoder}=await import('./vendor/meshopt-decoder-0.23.js');
    if(!MeshoptDecoder.supported)throw new Error('Compact surface decoder is unavailable.');
    try{await MeshoptDecoder.ready;}catch{throw new Error('Compact surface decoder could not initialize in this browser.');}
    const {prepareSurfaceParts}=await import('./surface-part-staging.js');
    const prepared=await prepareSurfaceParts(compact.parts,{
     stagingId:event.data.stagingId,waitForWorkspace,isPaused:()=>paused,hash,
     onProgress:progress=>reportProgress(progress,progress.stage!=='download'),
     loadPart:(part,onProgress)=>activeDownload(async signal=>{
      if(typeof part.url!=='string')throw new Error('Compact surface part URL is missing.');
      const bytes=new Uint8Array(part.compressedBytes);
      await fetchSurface(part.url,signal,(body,network)=>readBounded(body,bytes,0,part.compressedBytes,onProgress,false,network));return bytes;
     }),
    });
    try{
     result=await streamCompactSurface(compact,{
      loadPart:prepared.loadPart,debrisFlags,onStart,onChunk,waitForWorkspace,isPaused:()=>paused,hash,
      onProgress:progress=>{
       // Reading verified disk parts is preparation, never a second download.
       if(prepared.sequential&&progress.phase==='download')progress={...progress,phase:'decode',stage:'read-staged-part'};
       reportProgress(progress,progress.stage==='verify-part'||progress.stage==='decode-block'||progress.stage==='verify-final');
      },
     });
    }finally{await prepared.close();}
   }else result=await streamOriginalSurface(event.data,{debrisFlags,onStart,onChunk});
   await waitForWorkspace();
   self.postMessage({type:'surface-complete',...result,debrisFlags},[debrisFlags.buffer]);
   return;
  }
  if(event.data.compact){
   const compact=event.data.compact;
   if(compact.decodedBytes!==expectedBytes||compact.decodedSha256!==decodedSha256)throw new Error('Compact surface identity did not match the selected profile.');
   const {decodeCompactSurface}=await import('./compact-surface-codec.js');
   const decoded=await decodeCompactSurface(compact,{
    loadPart:(part,onProgress)=>activeDownload(async signal=>{
     if(typeof part.url!=='string')throw new Error('Compact surface part URL is missing.');
     const bytes=new Uint8Array(part.compressedBytes);
     await fetchSurface(part.url,signal,(body,network)=>readBounded(body,bytes,0,part.compressedBytes,onProgress,false,network));
     return bytes;
    }),
    waitForWorkspace,isPaused:()=>paused,lookahead:event.data.surfaceLookahead===true,
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
 }catch(error){
  const resourceFailure=isResourceFailure(error);
  self.postMessage({error:error.message,...(resourceFailure?{resourceFailure:true}:{}),...(error?.networkFailure?{networkFailure:true}:{})});
 }
};
