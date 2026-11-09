import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ultraRequest} from '../server/ultra-store.mjs';

const pixels=Uint8Array.from({length:48},(_,i)=>i),sha256=createHash('sha256').update(pixels).digest('hex');
const index={'x/0237.webp':{bytes:pixels.length,sha256}},stored=new Map();let puts=0;
const bucket={
 async head(key){const value=stored.get(key);return value?{...value}:null;},
 async get(key){const value=stored.get(key);return value?{...value,body:new Blob([value.data]).stream()}:null;},
 async put(key,data,options){puts++;assert.equal(options.sha256,createHash('sha256').update(data).digest('hex'));stored.set(key,{key,data:data.slice(),size:data.length,customMetadata:options.customMetadata,httpEtag:'"fixture"'});},
 async list(){return {objects:[...stored.values()],truncated:false};}
};
const url='https://example.test/api/ultra/v4/x/0237.webp';
const req=(method='GET',body,headers={})=>new Request(url,{method,body,headers});
assert.equal(await ultraRequest(new Request('https://example.test/'),bucket,index),null);
assert.equal((await ultraRequest(req(),bucket,index)).status,503);
assert.equal((await ultraRequest(req('PUT',pixels),bucket,index)).status,405);
assert.equal((await ultraRequest(req('PUT',pixels.slice(0,47)),bucket,index,{uploadsEnabled:true})).status,400);
assert.equal((await ultraRequest(req('PUT',new Uint8Array(49)),bucket,index,{uploadsEnabled:true})).status,400);
assert.equal((await ultraRequest(req('PUT',new Uint8Array(48)),bucket,index,{uploadsEnabled:true})).status,400);
assert.equal(puts,0);
assert.equal((await ultraRequest(req('PUT',pixels),bucket,index,{uploadsEnabled:true})).status,201);
assert.equal((await ultraRequest(req('PUT',pixels),bucket,index,{uploadsEnabled:true})).status,204);
assert.equal(puts,1);
const get=await ultraRequest(req(),bucket,index);
assert.equal(get.status,200);assert.deepEqual(new Uint8Array(await get.arrayBuffer()),pixels);
assert.equal(get.headers.get('x-content-sha256'),sha256);assert.match(get.headers.get('cache-control'),/^private,/);
assert.equal((await ultraRequest(req('GET',undefined,{'if-none-match':'"fixture"'}),bucket,index)).status,304);
assert.equal((await ultraRequest(req('HEAD'),bucket,index)).body,null);
const status=await (await ultraRequest(new Request('https://example.test/api/ultra/v4/status'),bucket,index)).json();
assert.equal(status.complete,true);assert.equal(status.verified,1);assert.equal(status.bytes,pixels.length);
assert.equal((await ultraRequest(new Request('https://example.test/api/ultra/v4/unknown.webp'),bucket,index)).status,404);
assert.equal((await ultraRequest(req('DELETE'),bucket,index,{uploadsEnabled:true})).status,405);
assert.equal((await ultraRequest(req('PUT',pixels),bucket,index,{uploadsEnabled:false})).status,405);
assert.equal(puts,1);
console.log('PASS: bounded uploads, length/hash rejection, idempotent exact storage, byte-identical retrieval, private caching, completeness check, unknown-key rejection and final read-only mode.');
