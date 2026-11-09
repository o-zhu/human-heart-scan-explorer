import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import * as current from '../server/probe-heart-store-v44.mjs';

const source=await readFile(new URL('../server/probe-heart-store-v44.mjs',import.meta.url),'utf8');
const helper=new URL('../server/comparison-display-store-v10.mjs',import.meta.url).href;
async function fixturePolicy(policy){
 const code=source.replace("'./comparison-display-store-v10.mjs'",JSON.stringify(helper))
  .replace(/export const probeHeartV44ReleasePolicy = '[^']+';/,`export const probeHeartV44ReleasePolicy = 'probe-heart-v44:${policy}';`);
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
const [seed,final]=await Promise.all(['seed','read-only'].map(fixturePolicy));
const api='/api/probe-heart-v44/',asset='/assets/probe-heart-v44/',prefix='hoa-heart/probe-heart-v44/';
const names=['s-20-29.hfm.gz','s-20-28.hfm.gz'],name=names[0];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const payloads=new Map(names.map(n=>[n,gzipSync(Buffer.from('Exact opaque whole-heart fixture for '+n))]));
const index=Object.fromEntries([...payloads].map(([n,bytes])=>[n,{bytes:bytes.length,sha256:sha(bytes),contentType:'application/octet-stream'}]));
const token='probe-heart-specific-test-token-with-32-characters';
const open={uploadsEnabled:true,uploadToken:token};
const req=(route,method='GET',key,body=payloads.get(name),headers={})=>new Request('https://example.test'+route,{
 method,...(['PUT','POST','PATCH'].includes(method)?{body,...(body instanceof ReadableStream?{duplex:'half'}:{})}:{}),
 headers:{...(key?{'X-Heart-Probe-Heart-Upload':key}:{}),...headers},
});
function bucket(){
 const objects=new Map();
 return {objects,writes:0,reads:0,lastPutOptions:null,
  async head(key){this.reads++;return objects.get(key)||null;},
  async get(key){this.reads++;const object=objects.get(key);return object?{...object,body:new Blob([object.data]).stream()}:null;},
  async put(key,data,options){this.writes++;this.lastPutOptions=options;objects.set(key,{key,size:data.length,data:new Uint8Array(data),customMetadata:{...options.customMetadata}});},
  async list({prefix:scope}){this.reads++;return{objects:[...objects.values()].filter(object=>object.key.startsWith(scope)),truncated:false};},
 };
}
async function seedBoth(b){
 for(const n of names)assert.equal((await seed.probeHeartV44Request(req(api+n,'PUT',token,payloads.get(n)),b,index,open)).status,201);
}

test('immutable production index contains exactly both actual source mesh identities',async()=>{
 const production=JSON.parse(await readFile(new URL('../server/probe-heart-index-v44.json',import.meta.url),'utf8'));
 const manifest=JSON.parse(await readFile(new URL('../public/assets/probe-heart-v44/manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(production).sort(),[...names].sort());
 for(const n of names){
  const bytes=await readFile(new URL('../public/assets/probe-heart-v44/'+n,import.meta.url));
  const lod=manifest.donors.find(d=>d.donorId===n.replace('.hfm.gz','')).lod;
  assert.equal(production[n].bytes,bytes.length);assert.equal(production[n].sha256,sha(bytes));
  assert.equal(lod.compressedBytes,bytes.length);assert.equal(lod.sha256,production[n].sha256);
  assert.equal(production[n].contentType,'application/octet-stream');assert.ok(bytes.length<=3*1024*1024);
 }
 assert.match(current.probeHeartV44ReleasePolicy,/^probe-heart-v44:(?:seed|read-only)$/);
 assert.equal(current.probeHeartV44UploadsEnabled,current.probeHeartV44ReleasePolicy.endsWith(':seed'));
 assert.equal(current.probeHeartV44PublicServingEnabled,current.probeHeartV44ReleasePolicy.endsWith(':read-only'));
});

test('seed GET and PUT require the dedicated token and explicit runtime gate',async()=>{
 const b=bucket();
 for(const options of [{},{uploadToken:token},{uploadsEnabled:true},{uploadsEnabled:true,uploadToken:'short'},{uploadsEnabled:true,uploadToken:' '.repeat(40)}]){
  for(const method of ['GET','PUT'])assert.equal((await seed.probeHeartV44Request(req(api+name,method,token),b,index,options)).status,405);
 }
 for(const key of [undefined,'incorrect','x'.repeat(token.length)])for(const method of ['GET','PUT']){
  assert.equal((await seed.probeHeartV44Request(req(api+name,method,key),b,index,open)).status,403);
 }
 for(const method of ['GET','PUT'])assert.equal((await seed.probeHeartV44Request(req(api+name,method,undefined,undefined,{'X-Heart-Coronary-Upload':token}),b,index,open)).status,403);
 assert.equal((await seed.probeHeartV44Request(req(api+'status'),b,index,open)).status,403);
 for(const method of ['HEAD','POST','PATCH','DELETE','OPTIONS'])assert.equal((await seed.probeHeartV44Request(req(api+name,method,token),b,index,open)).status,405);
 assert.equal(b.writes,0);assert.equal(b.reads,0);
});

test('seed public meshes stay blocked while the manifest remains static',async()=>{
 const b=bucket();await seedBoth(b);
 for(const n of names)for(const method of ['GET','HEAD'])for(const servePublic of [false,true]){
  assert.equal((await seed.probeHeartV44Request(req(asset+n,method,token),b,index,{...open,servePublic})).status,503);
 }
 assert.equal(await seed.probeHeartV44Request(req(asset+'manifest.json'),b,index),null);
 const response=await seed.probeHeartV44Request(req(api+name,'GET',token),b,index,open);
 assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),payloads.get(name));
 assert.equal(response.headers.get('x-heart-probe-heart-policy'),'probe-heart-v44:seed');
});

test('PUT validates bounded exact bytes before storage, remains idempotent, and refuses immutable conflicts',async()=>{
 const b=bucket(),bytes=payloads.get(name);
 for(const bad of [bytes.subarray(1),new Uint8Array(bytes.length)])assert.equal((await seed.probeHeartV44Request(req(api+name,'PUT',token,bad),b,index,open)).status,400);
 assert.equal((await seed.probeHeartV44Request(req(api+name,'PUT',token,bytes,{'Content-Length':String(bytes.length+1)}),b,index,open)).status,400);
 assert.equal(b.writes,0);
 assert.equal((await seed.probeHeartV44Request(req(api+name,'PUT',token),b,index,open)).status,201);
 assert.equal(b.lastPutOptions.sha256,index[name].sha256);
 assert.deepEqual(b.lastPutOptions.customMetadata,{sha256:index[name].sha256,collection:'probe-heart-v44',sourcePath:name});
 assert.equal((await seed.probeHeartV44Request(req(api+name,'PUT',token),b,index,open)).status,204);
 assert.equal(b.writes,1);
 b.objects.get(prefix+name).customMetadata.sha256='0'.repeat(64);
 assert.equal((await seed.probeHeartV44Request(req(api+name,'PUT',token),b,index,open)).status,409);
 assert.equal(b.writes,1);
});

test('oversized streamed PUT is cancelled before another chunk or any bucket operation',async()=>{
 let pulls=0,cancelled=false;
 const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(index[name].bytes+1));},cancel(){cancelled=true;}},{highWaterMark:0});
 const b=bucket();
 assert.equal((await seed.probeHeartV44Request(req(api+name,'PUT',token,body),b,index,open)).status,400);
 assert.equal(pulls,1);assert.equal(cancelled,true);assert.equal(b.reads,0);assert.equal(b.writes,0);
});

test('final policy rejects every mutation even with surviving token and upload options',async()=>{
 const b=bucket();
 for(const route of [api+name,api+'status',api+'unknown.hfm.gz',asset+name,asset+'manifest.json'])for(const method of ['PUT','POST','PATCH','DELETE','OPTIONS']){
  const response=await final.probeHeartV44Request(req(route,method,token),b,index,open);
  assert.equal(response.status,405);assert.equal(response.headers.get('x-heart-probe-heart-policy'),'probe-heart-v44:read-only');
 }
 assert.equal(b.writes,0);assert.equal(b.reads,0);
});

test('final GET, HEAD, conditional GET and status preserve exact opaque gzip identity',async()=>{
 const b=bucket();await seedBoth(b);
 for(const n of names){
  const response=await final.probeHeartV44Request(req(asset+n+'?v='+index[n].sha256.slice(0,16)),b,index,open);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-encoding'),null);
  assert.equal(response.headers.get('content-length'),String(index[n].bytes));assert.equal(response.headers.get('x-content-sha256'),index[n].sha256);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),payloads.get(n));
  const head=await final.probeHeartV44Request(req(asset+n,'HEAD'),b,index);
  assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('etag'),response.headers.get('etag'));
  const cached=await final.probeHeartV44Request(req(asset+n,'GET',undefined,undefined,{'If-None-Match':response.headers.get('etag')}),b,index);
  assert.equal(cached.status,304);assert.equal(cached.headers.get('content-length'),null);
 }
 const status=await(await final.probeHeartV44Request(req(api+'status'),b,index,open)).json();
 assert.equal(status.complete,true);assert.equal(status.expected,2);assert.equal(status.verified,2);assert.equal(status.uploadsEnabled,false);
 assert.equal(status.bytes,[...payloads.values()].reduce((sum,b)=>sum+b.length,0));
 assert.equal(await final.probeHeartV44Request(req(asset+name),b,index,{servePublic:false}),null);
});

test('mismatched stored metadata fails closed for GET, HEAD, conditional responses and seed readback',async()=>{
 const b=bucket();await seedBoth(b);b.objects.get(prefix+name).size+=1;
 for(const method of ['GET','HEAD'])assert.equal((await final.probeHeartV44Request(req(asset+name,method),b,index)).status,503);
 assert.equal((await final.probeHeartV44Request(req(asset+name,'GET',undefined,undefined,{'If-None-Match':'"sha256-'+index[name].sha256+'"'}),b,index)).status,503);
 assert.equal((await seed.probeHeartV44Request(req(api+name,'GET',token),b,index,open)).status,503);
 const status=await(await seed.probeHeartV44Request(req(api+'status','GET',token),b,index,open)).json();
 assert.equal(status.complete,false);assert.equal(status.mismatchCount,1);assert.equal(status.uploadsEnabled,true);
});

test('collection cannot accept a third name, invalid entry, or objects from another route',async()=>{
 const b=bucket();
 for(const edit of [x=>{delete x[names[1]];},x=>{x['another.hfm.gz']=x[name];},x=>{x[name].bytes=3*1024*1024+1;},x=>{x[name].sha256='bad';},x=>{x[name].contentType='text/plain';}]){
  const bad=structuredClone(index);edit(bad);
  assert.equal((await seed.probeHeartV44Request(req(api+name,'PUT',token),b,bad,open)).status,500);
 }
 for(const n of ['another.hfm.gz','nested/s-20-29.hfm.gz','s-20-29.HFM.gz']){
  assert.equal((await seed.probeHeartV44Request(req(api+n,'PUT',token),b,index,open)).status,404);
  assert.equal((await final.probeHeartV44Request(req(asset+n),b,index)).status,404);
 }
 for(const route of ['/','/api/coronary-v36/status','/assets/fine-surface-v19/balanced.hfm.gz','/api/motion-ct-v24/status']){
  assert.equal(await seed.probeHeartV44Request(req(route,'PUT',token),b,index,open),null);
 }
 assert.equal(b.writes,0);assert.equal(b.reads,0);
 const worker=await readFile(new URL('../worker/index.ts',import.meta.url),'utf8');
 assert.match(worker,/probeHeartV44Request\(request, env\.BUCKET, probeHeartV44Index/);
 assert.match(worker,/HEART_PROBE_HEART_UPLOAD_TOKEN/);assert.match(worker,/if \(probeWholeHeart\) return probeWholeHeart/);
});
