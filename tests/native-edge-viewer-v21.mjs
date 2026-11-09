import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { NativeEdgeLoader, nativeToWorld, selectAvailableTile, validateGuidedManifest } from '../public/native-edge-loader.js';
import { boundedRead } from '../public/native-edge-worker.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const tile = (xyz = [35,31,36]) => ({ xyz, url: `https://heart.test/${xyz.join('_')}.nbe.gz`, sha256: 'a'.repeat(64), bytes: 10, decodedBytes: 100, triangles: 8 });
const manifest = () => ({ schema: 'guided-native-v21', complete: false, dimensionsXYZ: [7614,7614,8480], sourceSpacingUm: 19.85,
  tiles: [tile(),tile([36,31,36])], coverage: { plannedBlocks: 20, completedBlocks: 2 } });

test('Native selection identifies exact and nearest blocks explicitly in acquisition coordinates', () => {
  const tiles = manifest().tiles;
  const exact = selectAvailableTile(tiles,[4544,4032,4672]);
  assert.equal(exact.exact,true); assert.deepEqual(exact.tile.xyz,[35,31,36]); assert.equal(exact.distanceMm,0);
  const nearest = selectAvailableTile(tiles,[4800,4032,4672]);
  assert.equal(nearest.exact,false); assert.deepEqual(nearest.requestedBlock,[37,31,36]); assert.deepEqual(nearest.tile.xyz,[36,31,36]);
  assert.equal(nearest.distanceMm,128*19.85/1000);
  assert.deepEqual(nativeToWorld([3806.5,3806.5,4239.5]),[0,0,-0]);
  assert.throws(()=>selectAvailableTile(tiles,[7614,0,0]),/inside/);
  assert.throws(()=>selectAvailableTile([], [1,1,1]),/available/);
});

test('Manifest validation rejects inconsistent coverage, duplicate blocks, and unbounded or misregistered payloads', () => {
  assert.equal(validateGuidedManifest(manifest(),'https://heart.test/').tiles.length,2);
  let m=manifest();m.tiles.push(m.tiles[0]);assert.throws(()=>validateGuidedManifest(m,'https://heart.test/'),/duplicated/);
  m=manifest();m.tiles[0].decodedBytes=5*1024*1024+1;assert.throws(()=>validateGuidedManifest(m,'https://heart.test/'),/invalid/);
  m=manifest();m.dimensionsXYZ[0]=7615;assert.throws(()=>validateGuidedManifest(m,'https://heart.test/'),/incompatible/);
  m=manifest();m.complete=true;assert.throws(()=>validateGuidedManifest(m,'https://heart.test/'),/completion flag/);
  m=manifest();m.tiles[0].url='javascript:alert(1)';assert.throws(()=>validateGuidedManifest(m,'https://heart.test/'),/unsupported/);
});

function pool() {
  const workers=[];
  const loader=new NativeEdgeLoader({baseUrl:'https://heart.test/whole-native.html',createWorker:()=>{
    const worker={messages:[],postMessage(data){this.messages.push(data);},terminate(){this.stopped=true;}};
    workers.push(worker);return worker;
  }});
  const emit=data=>workers.at(-1).onmessage({data});
  return {loader,workers,emit};
}

test('One persistent worker coalesces queued and active region changes without stale commits', async () => {
  const {loader,workers,emit}=pool();
  const overview=loader.loadOverview({...tile(),decodedBytes:100});
  const a=loader.loadTile(tile());const abortedA=assert.rejects(a,{name:'AbortError'});
  const b=loader.loadTile(tile([36,31,36]));
  assert.equal(workers.length,1);assert.equal(workers[0].messages.filter(m=>m.type==='load').length,1);
  emit({type:'done',id:1,result:{pieces:1}});await overview;await abortedA;
  assert.equal(loader.active.id,3);assert.equal(workers.length,1);
  const abortedB=assert.rejects(b,{name:'AbortError'});
  const c=loader.loadTile(tile([35,30,36]));const abortedC=assert.rejects(c,{name:'AbortError'});
  const d=loader.loadTile(tile([36,30,36]));
  assert.equal(loader.active.id,3);assert.equal(loader.pending.size,1);
  assert.equal(workers[0].messages.at(-1).type,'cancel');
  emit({type:'piece',id:3,index:0,total:8,mesh:{old:true}});await settle();
  assert.equal(workers[0].messages.at(-1).type,'cancel','Cancelled piece must not receive a rendering acknowledgement.');
  emit({type:'done',id:3,error:'cancelled',aborted:true});
  assert.equal(loader.active.id,5);
  emit({type:'done',id:3,result:{stale:true}});assert.equal(loader.active.id,5);
  emit({type:'done',id:5,result:{current:true}});assert.deepEqual(await d,{current:true});
  await abortedB;await abortedC;loader.dispose();assert.equal(workers[0].stopped,true);
});

test('The next mesh is acknowledged only after the current upload finishes', async () => {
  const {loader,workers,emit}=pool();let release;
  const job=loader.loadTile(tile(),{onPiece:()=>new Promise(resolve=>{release=resolve;})});
  emit({type:'piece',id:1,index:0,total:8,mesh:{}});await settle();
  assert.equal(workers[0].messages.filter(m=>m.type==='ack').length,0);
  release();await settle();assert.deepEqual(workers[0].messages.at(-1),{type:'ack',id:1,index:0});
  emit({type:'done',id:1,result:{pieces:8}});await job;loader.dispose();
});

test('Worker failure frees the queue and a late old worker error cannot stop its replacement', async () => {
  const {loader,workers,emit}=pool();
  const old=loader.loadOverview(tile());const failed=assert.rejects(old,/worker stopped/);
  const next=loader.loadTile(tile());
  workers[0].onerror();await failed;assert.equal(workers.length,2);
  workers[0].onerror();assert.equal(workers[1].stopped,undefined);
  emit({type:'done',id:2,result:{pieces:8}});await next;loader.dispose();
});

test('Streaming reads stop at their declared bound', async () => {
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8));controller.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}});
  await assert.rejects(boundedRead(stream,10),/declared size/);assert.equal(cancelled,true);
});

function planePayload({island=false}={}) {
  const n=129, maskBytes=Math.ceil(n**3/8),counts=[n*n+(island?18:0),island?18:0,island?18:0];
  const streamBytes=counts.map(count=>Math.ceil(count*5/8));
  const buffer=new ArrayBuffer(64+maskBytes+streamBytes.reduce((sum,count)=>sum+count,0)),head=new Uint32Array(buffer,0,16),bytes=new Uint8Array(buffer);
  head.set([0x3145424e,1,n,n,n,5,maskBytes,...counts,4480,3968,4608,0,0,0]);
  const view=new DataView(buffer);view.setFloat32(52,17133.4,true);view.setFloat32(56,19.85,true);
  for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=64;x<n;x++){const index=(z*n+y)*n+x;bytes[64+(index>>3)]|=1<<(index&7);}
  if(island)for(let z=8;z<11;z++)for(let y=8;y<11;y++)for(let x=8;x<11;x++){const index=(z*n+y)*n+x;bytes[64+(index>>3)]|=1<<(index&7);}
  let offset=64+maskBytes;
  for(let axis=0;axis<3;axis++){
    for(let i=0;i<counts[axis];i++){const bit=i*5+4;bytes[offset+(bit>>3)]|=1<<(bit&7);}
    offset+=streamBytes[axis];
  }
  return {raw:bytes,encoded:new Uint8Array(gzipSync(bytes))};
}

test('The real worker verifies gzip hashes, emits eight acknowledged meshes, reuses encoded cache, and rejects corrupt metadata', async () => {
  const originalFetch=globalThis.fetch,originalSelf=globalThis.self;
  const {raw,encoded}=planePayload();let downloads=0,currentResolve;const messages=[];
  const hfm=new Uint8Array(100);new Uint32Array(hfm.buffer,0,8).set([0x314d4648,1,3,3,32,68,88,1]);new Uint32Array(hfm.buffer,88,3).set([0,1,2]);
  const hfmGzip=new Uint8Array(gzipSync(hfm)),manifestBytes=new TextEncoder().encode(JSON.stringify(manifest())),manifestGzip=new Uint8Array(gzipSync(manifestBytes));
  const pointer={manifestUrl:'./manifest.json.gz',sha256:digest(manifestGzip),bytes:manifestGzip.length,decodedBytes:manifestBytes.length,decodedSha256:digest(manifestBytes)};
  globalThis.fetch=async url=>{downloads++;return new Response(url.endsWith('/index.json')?JSON.stringify(pointer):url.endsWith('/manifest.json.gz')?manifestGzip:url.includes('/overview-')?hfmGzip:encoded);};
  globalThis.self={postMessage(data){messages.push(data);if(data.type==='piece')queueMicrotask(()=>self.onmessage({data:{type:'ack',id:data.id,index:data.index}}));if(data.type==='done')currentResolve(data);}};
  try {
    await import('../public/native-edge-worker.js?worker-integration');
    const record={...tile(),bytes:encoded.length,decodedBytes:raw.length,sha256:digest(encoded),decodedSha256:digest(raw),triangles:32768};
    const run=(id,record,kind='tile')=>new Promise(resolve=>{currentResolve=resolve;self.onmessage({data:{type:'load',id,kind,record}});});
    const first=await run(1,record);assert.equal(first.error,undefined);assert.equal(first.result.pieces,8);assert.equal(first.result.triangles,32768);
    assert.equal(messages.filter(m=>m.type==='piece').length,8);
    const second=await run(2,record);assert.equal(second.error,undefined);assert.equal(downloads,1);assert.equal(second.result.cacheEntries,1);
    assert.ok(second.result.cacheBytes<=12*1024*1024);
    const corrupt=await run(3,{...record,sha256:'0'.repeat(64)});assert.match(corrupt.error,/checksum/);
    const inflated=await run(4,{...record,decodedBytes:64});assert.match(inflated.error,/declared size/);
    const wrongPlace=await run(5,{...record,xyz:[36,31,36]});assert.match(wrongPlace.error,/selected coordinates/);
    const parts=Array.from({length:2},(_,i)=>({url:`https://heart.test/overview-${i}.gz`,sha256:digest(hfmGzip),decodedSha256:digest(hfm),bytes:hfmGzip.length,decodedBytes:hfm.length,triangles:1}));
    const overview=await run(6,{parts,triangles:2},'overview');assert.equal(overview.error,undefined);assert.equal(overview.result.pieces,2);assert.equal(overview.result.triangles,2);
    assert.equal(messages.filter(m=>m.type==='piece'&&m.id===6).length,2);
    const index=await run(7,{url:'https://heart.test/index.json'},'manifest');assert.equal(index.error,undefined);assert.equal(index.result.baseUrl,'https://heart.test/manifest.json.gz');assert.deepEqual(index.result.manifest,manifest());
  } finally {globalThis.fetch=originalFetch;if(originalSelf===undefined)delete globalThis.self;else globalThis.self=originalSelf;}
});

async function actualWorker(t, routes, moduleTag) {
  const originalFetch=globalThis.fetch,originalSelf=globalThis.self,messages=[],downloads=[];
  let sequence=0,resolveDone=null;
  t.after(()=>{globalThis.fetch=originalFetch;if(originalSelf===undefined)delete globalThis.self;else globalThis.self=originalSelf;});
  globalThis.fetch=async input=>{
    const url=String(input);assert.ok(routes.has(url),`Unexpected fixture download: ${url}`);downloads.push(url);
    return new Response(routes.get(url));
  };
  globalThis.self={postMessage(data,transfer=[]){
    // Exercise actual transferable-buffer detachment, not just direct object reuse.
    const message=structuredClone(data,{transfer});messages.push(message);
    if(message.type==='piece')queueMicrotask(()=>self.onmessage({data:{type:'ack',id:message.id,index:message.index}}));
    if(message.type==='done'){const resolve=resolveDone;resolveDone=null;assert.ok(resolve);resolve(message);}
  }};
  await import(`../public/native-edge-worker.js?${moduleTag}`);
  const run=(record,kind='tile')=>new Promise(resolve=>{
    assert.equal(resolveDone,null,'Worker fixtures must issue sequential jobs.');resolveDone=resolve;
    self.onmessage({data:{type:'load',id:++sequence,kind,record}});
  });
  return {run,messages,downloads,pieces:id=>messages.filter(m=>m.type==='piece'&&m.id===id).map(m=>m.mesh)};
}

function decodedViews(mesh) {
  return {
    positions:new Uint8Array(mesh.buffer,mesh.positionOffset,mesh.vertexCount*mesh.positionBytes),
    normals:new Int16Array(mesh.buffer,mesh.normalOffset,mesh.vertexCount*3),
    indices:new Uint32Array(mesh.buffer,mesh.indexOffset,mesh.indexCount),
  };
}

test('Actual worker cleanup modes share verified native cache, partition a real decoded island, and validate original triangle counts', {timeout:10000},async t=>{
  const {raw,encoded}=planePayload({island:true}),url='https://heart.test/native-cleanup-v22.nbe.gz';
  const worker=await actualWorker(t,new Map([[url,encoded]]),'native-cleanup-integration-v22');
  const record={...tile(),url,bytes:encoded.length,decodedBytes:raw.length,sha256:digest(encoded),decodedSha256:digest(raw),triangles:32872};
  const originalHash=digest(raw),encodedHash=digest(encoded),results={};
  for(const mode of ['original','cleaned','removed']){
    const reply=await worker.run({...record,cleanupView:mode});assert.equal(reply.error,undefined);
    assert.equal(reply.result.cleanupView,mode);assert.equal(reply.result.pieces,8);assert.equal(reply.result.sourceTriangles,32872);
    assert.equal(reply.result.triangles,mode==='original'?32872:mode==='cleaned'?32768:104);
    assert.equal(reply.result.suppressedTriangles,mode==='original'?0:104);
    assert.equal(reply.result.cacheEntries,1);assert.equal(reply.result.cacheBytes,encoded.length);
    if(mode==='original')assert.equal(reply.result.cleanup,null);
    else {assert.equal(reply.result.cleanup.removedComponents,1);assert.equal(reply.result.cleanup.removedSamples,27);}
    assert.equal(worker.pieces(reply.id).length,8);results[mode]=reply;
  }
  assert.deepEqual(worker.downloads,[url],'Mode changes must reuse the verified encoded source, not redownload it.');
  for(let i=0;i<8;i++){
    const original=worker.pieces(results.original.id)[i],cleaned=worker.pieces(results.cleaned.id)[i],removed=worker.pieces(results.removed.id)[i];
    const a=decodedViews(original),b=decodedViews(cleaned),c=decodedViews(removed);
    assert.equal(cleaned.indexCount+removed.indexCount,original.indexCount);
    assert.deepEqual(b.positions,a.positions);assert.deepEqual(c.positions,a.positions);
    for(const chosen of [b,c])for(const vertex of new Set(chosen.indices))for(let axis=0;axis<3;axis++)assert.equal(chosen.normals[vertex*3+axis],a.normals[vertex*3+axis]);
  }
  for(const [mode,triangles]of [['original',32871],['cleaned',32768],['removed',104]]){
    const invalid=await worker.run({...record,cleanupView:mode,triangles});
    assert.match(invalid.error,/Native triangle counts did not match/);assert.equal(invalid.result,undefined,'Filtered counts must never satisfy the source record.');
  }
  const badDecoded=await worker.run({...record,cleanupView:'cleaned',decodedSha256:'0'.repeat(64)});
  assert.match(badDecoded.error,/decoded surface checksum/);assert.equal(worker.pieces(badDecoded.id).length,0);
  const badMode=await worker.run({...record,cleanupView:'unsupported'});
  assert.match(badMode.error,/cleanup view is invalid/);assert.equal(worker.pieces(badMode.id).length,0);
  const recovered=await worker.run({...record,cleanupView:'cleaned'});assert.equal(recovered.error,undefined);assert.equal(recovered.result.triangles,32768);
  assert.deepEqual(worker.downloads,[url]);assert.equal(digest(raw),originalHash);assert.equal(digest(encoded),encodedHash);
});

test('Actual worker overview repair pins source hashes, preserves retained arrays, and rejects mismatched counts, popcount or padding', {timeout:10000},async t=>{
  const raw=new Uint8Array(140),url='https://heart.test/repair-overview-v22.hfm.gz';
  new Uint32Array(raw.buffer,0,8).set([0x314d4648,1,4,9,32,80,104,1]);
  new Float32Array(raw.buffer,32,12).set([0,0,0,1,0,0,1,1,0,0,1,0]);
  new Int16Array(raw.buffer,80,12).set([0,0,32767,0,0,32767,0,0,32767,0,0,32767]);
  new Uint32Array(raw.buffer,104,9).set([0,1,2,2,1,0,0,2,3]);
  const encoded=new Uint8Array(gzipSync(raw)),routes=new Map([[url,encoded]]);
  const maskRecord=(name,value)=>{
    const data=Uint8Array.of(value),compressed=new Uint8Array(gzipSync(data)),url=`https://heart.test/${name}.keep.gz`;
    routes.set(url,compressed);return {url,bytes:compressed.length,decodedBytes:data.length,sha256:digest(compressed),decodedSha256:digest(data)};
  };
  const goodMask=maskRecord('valid-v22',0b00000101),badPopcount=maskRecord('bad-popcount-v22',0b00000001),badPadding=maskRecord('bad-padding-v22',0b10000101);
  const part={url,sha256:digest(encoded),decodedSha256:digest(raw),bytes:encoded.length,decodedBytes:raw.length,triangles:3};
  const filter={sourceSha256:part.sha256,sourceDecodedSha256:part.decodedSha256,originalTriangles:3,retainedTriangles:2,removedTriangles:1,bitOrder:'little',bit1:'retain',mask:goodMask};
  const job=(specification=filter,overviewRepair=true)=>({parts:[{...part,faceFilter:specification}],triangles:3,overviewRepair});
  const worker=await actualWorker(t,routes,'overview-repair-integration-v22');
  const original=await worker.run(job(filter,false),'overview');assert.equal(original.error,undefined);
  assert.equal(original.result.triangles,3);assert.equal(original.result.sourceTriangles,3);assert.equal(original.result.removedTriangles,0);assert.equal(original.result.overviewRepair,false);
  assert.equal(worker.downloads.includes(goodMask.url),false,'The explicit original view must not fetch or apply a repair mask.');
  const repaired=await worker.run(job(),'overview');assert.equal(repaired.error,undefined);
  assert.equal(repaired.result.triangles,2);assert.equal(repaired.result.sourceTriangles,3);assert.equal(repaired.result.removedTriangles,1);assert.equal(repaired.result.overviewRepair,true);
  const a=decodedViews(worker.pieces(original.id)[0]),b=decodedViews(worker.pieces(repaired.id)[0]);
  assert.deepEqual(a.positions,b.positions);assert.deepEqual(a.normals,b.normals);assert.deepEqual([...b.indices],[0,1,2,0,2,3]);
  assert.equal(new DataView(worker.pieces(repaired.id)[0].buffer).getUint32(12,true),6);
  const failures=[
    {name:'foreign compressed source',filter:{...filter,sourceSha256:'0'.repeat(64)},error:/verified display repair is unavailable/},
    {name:'foreign decoded source',filter:{...filter,sourceDecodedSha256:'0'.repeat(64)},error:/verified display repair is unavailable/},
    {name:'corrupt mask checksum',filter:{...filter,mask:{...goodMask,sha256:'0'.repeat(64)}},error:/compressed surface checksum/},
    {name:'validly hashed mask with wrong popcount',filter:{...filter,mask:badPopcount},error:/face count did not match/},
    {name:'validly hashed mask with nonzero padding',filter:{...filter,mask:badPadding},error:/nonzero padding/},
    {name:'foreign face count',filter:{...filter,originalTriangles:4,removedTriangles:2},error:/mask does not match/},
    {name:'missing repair',filter:null,error:/verified display repair is unavailable/},
  ];
  for(const failure of failures){
    const reply=await worker.run(job(failure.filter),'overview');
    assert.match(reply.error,failure.error,failure.name);assert.equal(reply.result,undefined);assert.equal(worker.pieces(reply.id).length,0,`${failure.name} must fail before any repaired piece is emitted.`);
  }
  const wrongPart=job();wrongPart.parts[0].triangles=2;
  const partReply=await worker.run(wrongPart,'overview');assert.match(partReply.error,/part has an inconsistent triangle count/);assert.equal(worker.pieces(partReply.id).length,0);
  const wrongTotal=job();wrongTotal.triangles=2;
  const totalReply=await worker.run(wrongTotal,'overview');assert.match(totalReply.error,/complete overview triangle count did not match/);assert.equal(totalReply.result,undefined,'A repaired count cannot replace the original source count.');
  assert.equal(digest(raw),part.decodedSha256);assert.equal(digest(encoded),part.sha256);
});
