import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fineVolumeRequest} from '../server/ultra-volume-store-v7.mjs';

const bytes=new Uint8Array(40).fill(7),sha256=createHash('sha256').update(bytes).digest('hex');
const index={'00/01/02.gz':{bytes:bytes.length,sha256}},url='https://heart.example/api/ultra-volume/v7/00/01/02.gz';
const request=(method,body,headers)=>new Request(url,{method,...(body?{body}:{}),headers});
function bucket(){const objects=new Map();return {objects,async head(key){return objects.get(key)||null;},async get(key){const o=objects.get(key);return o?{...o,body:new Blob([o.data]).stream()}:null;},async put(key,data,opts){objects.set(key,{key,size:data.byteLength,data,httpEtag:'"test-etag"',customMetadata:opts.customMetadata});},async list(){return {objects:[...objects.values()],truncated:false};}};}
test('Write route is closed by default; invalid paths do not create objects',async()=>{
 const b=bucket();assert.equal((await fineVolumeRequest(request('PUT',bytes),b,index)).status,405);
 assert.equal((await fineVolumeRequest(new Request(url+'extra'),b,index,{uploadsEnabled:true})).status,404);assert.equal(b.objects.size,0);
});
test('Upload is manifest-bound, size/hash checked and immutable',async()=>{
 const b=bucket(),open={uploadsEnabled:true};
 assert.equal((await fineVolumeRequest(request('PUT',bytes.slice(1)),b,index,open)).status,400);
 assert.equal((await fineVolumeRequest(request('PUT',new Uint8Array(40)),b,index,open)).status,400);
 assert.equal((await fineVolumeRequest(request('PUT',bytes),b,index,open)).status,201);
 assert.equal((await fineVolumeRequest(request('PUT',bytes),b,index,open)).status,204);assert.equal(b.objects.size,1);
 [...b.objects.values()][0].customMetadata.sha256='wrong';assert.equal((await fineVolumeRequest(request('PUT',bytes),b,index,open)).status,409);
});
test('Reads preserve compressed bytes and validate stored metadata; status matches all objects',async()=>{
 const b=bucket();await fineVolumeRequest(request('PUT',bytes),b,index,{uploadsEnabled:true});
 const get=await fineVolumeRequest(request('GET'),b,index);assert.equal(get.status,200);assert.equal(get.headers.get('content-encoding'),null);assert.equal(get.headers.get('x-content-sha256'),sha256);assert.deepEqual(new Uint8Array(await get.arrayBuffer()),bytes);
 const head=await fineVolumeRequest(request('HEAD'),b,index);assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
 assert.equal((await fineVolumeRequest(request('GET',null,{'if-none-match':'"test-etag"'}),b,index)).status,304);
 const status=await (await fineVolumeRequest(new Request(url.replace('00/01/02.gz','status')),b,index)).json();assert.equal(status.complete,true);assert.equal(status.bytes,40);assert.equal(status.uploadsEnabled,false);
 [...b.objects.values()][0].customMetadata.sha256='wrong';assert.equal((await fineVolumeRequest(request('GET'),b,index)).status,503);
});
