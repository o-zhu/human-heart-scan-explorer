import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {gzipSync} from 'node:zlib';
import {prepareSurfaceParts,cleanupSurfaceStaging} from '../public/surface-part-staging.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const never=()=>new Promise(()=>{});
const missing=()=>Object.assign(new Error('Missing file'),{name:'NotFoundError'});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function fixture(count=4){
 const bytes=Array.from({length:count},(_,part)=>Uint8Array.from({length:257+part},(_,index)=>(part*17+index*13)&255));
 const parts=bytes.map((value,index)=>({url:'part-'+index,compressedBytes:value.length,sha256:hash(value)}));
 return {bytes,parts};
}

/** Deterministic OPFS surface, including atomic close and independent jobs. */
function memoryStorage(hooks={}){
 const directories=new Map(),events=[];
 const root={
  async getDirectoryHandle(name,{create}={}){
   await hooks.beforeDirectory?.(name);
   if(!directories.has(name)){
    if(!create)throw missing();
    const files=new Map();
    const directory={files,
     async getFileHandle(fileName,{create}={}){
      if(!files.has(fileName)){
       if(!create)throw missing();
       const record={bytes:new Uint8Array()};
       const handle={
        async createWritable(){
         await hooks.beforeWriter?.(fileName);
         let pending,aborted=false;
         return {
          async write(bytes){events.push(['write',fileName]);await hooks.beforeWrite?.(fileName,bytes);pending=bytes.slice();},
          async close(){events.push(['close',fileName]);await hooks.beforeClose?.(fileName);if(aborted)throw new DOMException('Aborted','AbortError');record.bytes=pending||new Uint8Array();},
          async abort(){events.push(['abort',fileName]);aborted=true;await hooks.beforeAbort?.(fileName);},
         };
        },
        async getFile(){
         events.push(['read',fileName]);await hooks.beforeRead?.(fileName,record);
         if(!files.has(fileName))throw missing();
         return hooks.file?.(fileName,record)??new Blob([record.bytes]);
        },
       };
       if(hooks.noWritable)delete handle.createWritable;
       files.set(fileName,{record,handle});
      }
      return files.get(fileName).handle;
     },
     async removeEntry(fileName){events.push(['remove-file',fileName]);if(!files.delete(fileName))throw missing();},
    };
    directories.set(name,directory);
   }
   return directories.get(name);
  },
  async removeEntry(name){events.push(['remove-directory',name]);await hooks.beforeRemove?.(name);if(!directories.delete(name))throw missing();},
 };
 return {directories,events,root,storage:{async getDirectory(){await hooks.beforeRoot?.();return root;}}};
}

function options(source,disk,extra={}){
 const messages=[],downloads=[];let active=0,maxActive=0;
 const value={stagingId:'test-job',storage:disk?.storage||{},hash,onProgress:message=>messages.push(message),timeoutMs:25,cleanupTimeoutMs:25,
  loadPart:async(part,progress)=>{
   const index=source.parts.indexOf(part);downloads.push(index);active++;maxActive=Math.max(maxActive,active);
   try{progress?.(Math.floor(source.bytes[index].length/2));await tick();progress?.(source.bytes[index].length);return source.bytes[index].slice();}
   finally{active--;}
  },...extra};
 return {value,messages,downloads,get maxActive(){return maxActive;}};
}

async function consume(prepared,source){
 for(const part of source.parts){const packed=await prepared.loadPart(part,()=>{});assert.equal(hash(packed),part.sha256);}
}

test('all independent parts download, verify and close before preparation; reads stay bounded and serial',async()=>{
 const source=fixture(),disk=memoryStorage(),o=options(source,disk);
 const prepared=await prepareSurfaceParts(source.parts,o.value);
 assert.equal(prepared.sequential,true);assert.deepEqual(o.downloads,[0,1,2,3]);assert.equal(o.maxActive,1);
 assert.equal(disk.events.some(([type])=>type==='read'),false);
 assert.equal(disk.events.filter(([type])=>type==='close').length,source.parts.length);
 assert.deepEqual(o.messages.filter(m=>['download-start','download-complete','streaming-fallback'].includes(m.stage)).map(m=>m.stage),['download-start','download-complete']);
 assert.equal(o.messages.at(-1).downloadedBytes,source.bytes.reduce((sum,bytes)=>sum+bytes.length,0));
 const before=o.downloads.length;await consume(prepared,source);assert.equal(o.downloads.length,before);
 assert.equal(disk.events.filter(([type])=>type==='read').length,source.parts.length);
 await prepared.close();assert.equal(disk.directories.size,0);
 await assert.rejects(prepared.loadPart(source.parts[0]),error=>error.name==='AbortError');
 assert.equal(o.downloads.length,before);
});

test('unavailable or older storage starts the existing serial stream without a staged-completion claim',async()=>{
 const source=fixture();
 for(const disk of [null,memoryStorage({noWritable:true}),memoryStorage({beforeRoot(){throw new DOMException('Disabled','SecurityError');}})]){
  const o=options(source,disk),prepared=await prepareSurfaceParts(source.parts,o.value);
  assert.equal(prepared.sequential,false);assert.equal(o.downloads.length,0);
  assert.deepEqual(o.messages.map(m=>m.stage),['streaming-fallback']);
  await consume(prepared,source);assert.deepEqual(o.downloads,[0,1,2,3]);assert.equal(o.maxActive,1);await prepared.close();
  if(disk)assert.equal(disk.directories.size,0);
 }
});

test('quota fallback keeps verified disk parts and the current packed block without repeating downloads',async()=>{
 const source=fixture(),disk=memoryStorage({beforeWrite(name){if(name==='part-2')throw new DOMException('Full','QuotaExceededError');}}),o=options(source,disk);
 const prepared=await prepareSurfaceParts(source.parts,o.value);
 assert.equal(prepared.sequential,false);assert.deepEqual(o.downloads,[0,1,2]);
 assert.equal(o.messages.some(m=>m.stage==='download-complete'),false);
 await consume(prepared,source);assert.deepEqual(o.downloads,[0,1,2,3]);assert.equal(o.maxActive,1);
 assert.deepEqual(disk.events.filter(([type])=>type==='read').map(([,name])=>name),['part-0','part-1']);
 assert.equal(o.messages.filter(m=>m.stage==='streaming-fallback').length,1);await prepared.close();assert.equal(disk.directories.size,0);
});

test('a hanging write and hanging abort settle into bounded fallback without losing earlier parts',{timeout:2000},async()=>{
 const source=fixture(3),disk=memoryStorage({beforeWrite:name=>name==='part-1'?never():undefined,beforeAbort:never}),o=options(source,disk);
 const prepared=await prepareSurfaceParts(source.parts,o.value);
 assert.deepEqual(o.downloads,[0,1]);assert.equal(prepared.sequential,false);
 await consume(prepared,source);assert.deepEqual(o.downloads,[0,1,2]);
 assert.equal(o.messages.some(m=>m.stage==='download-complete'),false);await prepared.close();assert.equal(disk.directories.size,0);
});

test('evicted, corrupt or hung disk reads restore only that part through the normal verified loader',{timeout:2000},async()=>{
 const source=fixture(3);
 for(const failure of ['missing','corrupt','hang','oversize']){
  let failed=false,arrayRead=false;
  const disk=memoryStorage({
   beforeRead(name,record){if(name!=='part-1'||failed)return;failed=true;if(failure==='missing')throw missing();if(failure==='corrupt')record.bytes[0]^=1;if(failure==='hang')return never();},
   file(name){if(name==='part-1'&&failure==='oversize')return {size:100*1024*1024,arrayBuffer(){arrayRead=true;throw new Error('Oversized data must never allocate.');}};},
  }),o=options(source,disk),prepared=await prepareSurfaceParts(source.parts,o.value);
  assert.equal(prepared.sequential,true);await consume(prepared,source);
  assert.deepEqual(o.downloads,failure==='hang'?[0,1,2,1,2]:[0,1,2,1]);assert.equal(prepared.sequential,false);assert.equal(arrayRead,false);
  if(failure==='hang'){
   assert.deepEqual(disk.events.filter(([type])=>type==='read').map(([,name])=>name),['part-0','part-1']);
   assert.deepEqual(o.messages.filter(m=>m.stage==='restore-start').map(m=>m.part),[2,3]);
  }
  assert.equal(o.messages.filter(m=>m.stage==='streaming-fallback').length,1);
  await prepared.close();assert.equal(disk.directories.size,0);
 }
});

test('each restored disk part announces its network work even after an intervening valid upload',async()=>{
 const source=fixture(4),disk=memoryStorage({beforeRead(name){if(name==='part-0'||name==='part-2')throw missing();}}),o=options(source,disk);
 const prepared=await prepareSurfaceParts(source.parts,o.value);
 const consumed=[];
 for(const [index,part]of source.parts.entries()){
  const bytes=await prepared.loadPart(part,()=>{});assert.equal(hash(bytes),part.sha256);
  consumed.push(index);o.messages.push({stage:'test-upload-ack',part:index+1});
 }
 assert.deepEqual(consumed,[0,1,2,3]);assert.deepEqual(o.downloads,[0,1,2,3,0,2]);
 assert.equal(o.messages.filter(m=>m.stage==='streaming-fallback').length,1);
 assert.deepEqual(o.messages.filter(m=>m.stage==='restore-start').map(m=>m.part),[1,3]);
 const first=o.messages.findIndex(m=>m.stage==='restore-start'),second=o.messages.findIndex(m=>m.stage==='restore-start'&&m.part===3);
 assert.ok(o.messages.slice(first+1,second).some(m=>m.stage==='test-upload-ack'&&m.part===2));
 await prepared.close();
});

test('stalled root and late directory creation cannot hang loading or leave a late job directory',{timeout:2000},async()=>{
 const source=fixture(1),blocked=memoryStorage({beforeRoot:never}),first=options(source,blocked);
 const fallback=await prepareSurfaceParts(source.parts,first.value);assert.equal(fallback.sequential,false);assert.equal(first.downloads.length,0);await fallback.close();
 const late=deferred(),disk=memoryStorage({beforeDirectory:()=>late.promise}),o=options(source,disk);
 const prepared=await prepareSurfaceParts(source.parts,o.value);assert.equal(prepared.sequential,false);assert.equal(disk.directories.size,0);
 late.resolve();for(let i=0;i<10;i++)await tick();assert.equal(disk.directories.size,0);
 await prepared.close();
});

test('cancellation interrupts uncooperative storage, reports no completion and releases the job',{timeout:2000},async()=>{
 const source=fixture(2),entered=deferred(),controller=new AbortController();
 const disk=memoryStorage({beforeWrite(){entered.resolve();return never();}}),o=options(source,disk,{signal:controller.signal,timeoutMs:1000});
 const pending=prepareSurfaceParts(source.parts,o.value);await entered.promise;
 const reason=new DOMException('Donor changed','AbortError');controller.abort(reason);
 await assert.rejects(pending,error=>error===reason);assert.equal(disk.directories.size,0);
 assert.equal(o.messages.some(m=>m.stage==='download-complete'),false);assert.equal(o.messages.some(m=>m.stage==='streaming-fallback'),false);
});

test('workspace pause suspends storage deadlines and starts no following part before resume',{timeout:2000},async()=>{
 const source=fixture(2),write=deferred(),entered=deferred(),resume=deferred();let paused=false;
 const disk=memoryStorage({beforeWrite(name){if(name==='part-0'){entered.resolve();return write.promise;}}});
 const o=options(source,disk,{isPaused:()=>paused,waitForWorkspace:async()=>{if(paused)await resume.promise;},timeoutMs:20});
 const pending=prepareSurfaceParts(source.parts,o.value);await entered.promise;paused=true;await sleep(60);
 assert.deepEqual(o.downloads,[0]);assert.equal(o.messages.some(m=>m.stage==='streaming-fallback'),false);
 write.resolve();await tick();assert.deepEqual(o.downloads,[0]);paused=false;resume.resolve();
 const prepared=await pending;assert.equal(prepared.sequential,true);assert.deepEqual(o.downloads,[0,1]);await prepared.close();
});

test('bad source checksums, malformed metadata and allocation failures are fatal rather than storage fallback',async()=>{
 const source=fixture(2);
 for(const failure of ['checksum','allocation']){
  const disk=memoryStorage(),o=options(source,disk);
  o.value.loadPart=async part=>{if(failure==='allocation')throw new RangeError('Allocation failed');return new Uint8Array(part.compressedBytes);};
  await assert.rejects(prepareSurfaceParts(source.parts,o.value),failure==='checksum'?/checksum/:/Allocation/);
  assert.equal(o.messages.some(m=>m.stage==='streaming-fallback'),false);assert.equal(disk.directories.size,0);
 }
 const disk=memoryStorage(),o=options(source,disk);
 await assert.rejects(prepareSurfaceParts([{...source.parts[0],compressedBytes:8*1024*1024+1}],o.value),/staging part/);
 assert.equal(disk.directories.size,0);assert.equal(o.downloads.length,0);
});

test('cleanup is scoped to a validated job and resolves even if native removal never does',{timeout:2000},async()=>{
 const disk=memoryStorage();await disk.root.getDirectoryHandle('heart-surface-stage-other',{create:true});await disk.root.getDirectoryHandle('heart-surface-stage-mine',{create:true});
 assert.equal(await cleanupSurfaceStaging('../other',{storage:disk.storage,timeoutMs:20}),false);assert.equal(disk.directories.size,2);
 assert.equal(await cleanupSurfaceStaging('mine',{storage:disk.storage,timeoutMs:20}),true);assert.equal(disk.directories.size,1);
 assert.equal(disk.directories.has('heart-surface-stage-other'),true);
 const blocked=memoryStorage({beforeRemove:never});assert.equal(await cleanupSurfaceStaging('mine',{storage:blocked.storage,timeoutMs:20}),false);
 assert.equal(await cleanupSurfaceStaging('mine',{storage:{getDirectory(){throw new Error('Disabled');}},timeoutMs:20}),false);
});

test('hard-termination cleanup retries a native lock and rechecks NotFound for late directory creation',{timeout:2000},async()=>{
 let removals=0;
 const locked=memoryStorage({beforeRemove(){if(++removals===1)throw new DOMException('Writer still closing','NoModificationAllowedError');}});
 await locked.root.getDirectoryHandle('heart-surface-stage-locked',{create:true});
 await locked.root.getDirectoryHandle('heart-surface-stage-other',{create:true});
 assert.equal(await cleanupSurfaceStaging('locked',{storage:locked.storage,afterTermination:true,retryDelayMs:5,timeoutMs:200}),true);
 assert.equal(removals,4);assert.equal(locked.directories.has('heart-surface-stage-locked'),false);assert.equal(locked.directories.has('heart-surface-stage-other'),true);
 const late=memoryStorage();
 const cleanup=cleanupSurfaceStaging('late',{storage:late.storage,afterTermination:true,retryDelayMs:5,timeoutMs:200});
 await sleep(10);await late.root.getDirectoryHandle('heart-surface-stage-late',{create:true});
 assert.equal(await cleanup,true);assert.equal(late.directories.size,0);
 const blocked=memoryStorage({beforeRoot:never});
 assert.equal(await cleanupSurfaceStaging('blocked',{storage:blocked.storage,afterTermination:true,retryDelayMs:5,timeoutMs:20}),false);
 const blockedRemoval=memoryStorage({beforeRemove:never});
 assert.equal(await cleanupSurfaceStaging('blocked',{storage:blockedRemoval.storage,afterTermination:true,retryDelayMs:5,timeoutMs:20}),false);
 assert.equal(blockedRemoval.events.filter(([type])=>type==='remove-directory').length,1,'A hung native promise cannot start unbounded cleanup work.');
});

test('the real compact worker finishes staging before its first GPU acknowledgement and still rejects invalid decoded content',{timeout:10000},async()=>{
 const manifest=JSON.parse(await readFile(new URL('../public/assets/display-compact-v29/mesh-manifest.json',import.meta.url),'utf8'));
 // Keep the production geometry declarations and exact source gates. Small
 // independently hashed gzip fixtures allow observing the phase boundary, but
 // intentionally have no HFC geometry and must fail before a single GPU chunk.
 const payload=new Uint8Array(24),packed=new Uint8Array(gzipSync(payload));
 manifest.parts=manifest.parts.map((part,index)=>({...part,url:'part-'+index,compressedBytes:packed.length,payloadBytes:payload.length,sha256:hash(packed),payloadSha256:hash(payload)}));
 manifest.compressedBytes=packed.length*manifest.parts.length;
 const harness=`import {parentPort,workerData} from 'node:worker_threads';
 const missing=()=>Object.assign(new Error('Missing file'),{name:'NotFoundError'});
 const memoryStorage=${memoryStorage.toString()};
 const disk=memoryStorage();
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{storage:disk.storage}});
 globalThis.self={postMessage:(message,transfers)=>parentPort.postMessage({...message,testDiskJobs:disk.directories.size},transfers)};
 globalThis.fetch=async(url,{signal}={})=>{signal?.throwIfAborted();parentPort.postMessage({type:'test-fetch',url});return new Response(workerData.packed);};
 await import(${JSON.stringify(new URL('../public/fine-surface-worker.js',import.meta.url).href)});
 parentPort.on('message',data=>void self.onmessage({data}));parentPort.postMessage({type:'ready'});`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(harness)),{workerData:{packed}}),messages=[],waiters=[];
 worker.on('message',message=>{messages.push(message);for(const waiter of [...waiters])if(waiter.predicate(message)){waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(message);}});
 worker.on('error',error=>{for(const waiter of waiters.splice(0))waiter.reject(error);});
 const waitFor=predicate=>{const found=messages.find(predicate);return found?Promise.resolve(found):new Promise((resolve,reject)=>waiters.push({predicate,resolve,reject}));};
 try{
  await waitFor(message=>message.type==='ready');
  const flags=new Uint8Array(manifest.vertexCount);
  worker.postMessage({streamSurface:true,stagingId:'real-worker',compact:manifest,expectedBytes:manifest.decodedBytes,decodedSha256:manifest.decodedSha256,debrisFlags:flags},[flags.buffer]);
  const start=await waitFor(message=>message.type==='surface-start'||message.error);assert.equal(start.error,undefined);
  assert.equal(messages.filter(message=>message.type==='test-fetch').length,manifest.parts.length);
  const completed=messages.findIndex(message=>message.stage==='download-complete'),started=messages.indexOf(start);
  assert.ok(completed>=0&&completed<started);assert.equal(messages[completed].testDiskJobs,1);
  assert.equal(messages.some(message=>message.type==='surface-chunk'),false);
  worker.postMessage({type:'surface-ack',sequence:0});
  const error=await waitFor(message=>message.error);assert.match(error.error,/block header/);assert.equal(error.testDiskJobs,0);
  assert.equal(messages.some(message=>message.type==='surface-chunk'||message.type==='surface-complete'),false);
  assert.equal(messages.slice(completed+1).some(message=>message.type==='progress'&&message.phase==='download'),false);
  assert.equal(messages.filter(message=>message.type==='test-fetch').length,manifest.parts.length);
 }finally{await worker.terminate();}
});
