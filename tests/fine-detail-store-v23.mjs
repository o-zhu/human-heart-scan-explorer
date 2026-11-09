import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fineDetailRequest, fineDetailUploadsEnabled } from '../server/fine-detail-store-v23.mjs';

const name='fine-surface-v23/gentle.part-000.gz',api='/api/fine-detail-v23/';
const bytes=new Uint8Array([31,139,1,2,3]);
const sha256=createHash('sha256').update(bytes).digest('hex');
const index={[name]:{bytes:bytes.length,sha256,contentType:'application/octet-stream'}};
const token='only-this-new-collection-can-use-this-test-key';
const req=(path,method='GET',key)=>new Request('https://example.test'+path,{method,...(method==='PUT'?{body:bytes}:{}),headers:key?{'X-Heart-Fine-Upload':key}:{}});
function bucket(){const objects=new Map();return {objects,
 async head(k){return objects.get(k)||null;},
 async get(k){const a=objects.get(k);return a?{...a,body:new Blob([a.data]).stream()}:null;},
 async put(k,data,opts){objects.set(k,{key:k,size:data.length,data:new Uint8Array(data),customMetadata:opts.customMetadata});},
 async list(){return {objects:[...objects.values()],truncated:false};},
};}

test('final code gate and defaults are closed; service access is insufficient to upload',async()=>{
 assert.equal(fineDetailUploadsEnabled,false);
 const b=bucket();
 assert.equal((await fineDetailRequest(req(api+name,'PUT',token),b,index,{uploadToken:token})).status,405);
 for(const key of [undefined,'incorrect'])assert.equal((await fineDetailRequest(req(api+name,'PUT',key),b,index,{uploadsEnabled:true,uploadToken:token})).status,403);
 assert.equal(b.objects.size,0);
});

test('exact scoped secret permits immutable indexed upload and byte-identical public reads',async()=>{
 const b=bucket(),open={uploadsEnabled:true,uploadToken:token};
 assert.equal((await fineDetailRequest(req(api+name,'PUT',token),b,index,open)).status,201);
 assert.equal((await fineDetailRequest(req(api+name,'PUT',token),b,index,open)).status,204);
 assert.equal(b.objects.size,1);
 const response=await fineDetailRequest(req('/assets/'+name),b,index);
 assert.equal(response.status,200);assert.equal(response.headers.get('x-content-sha256'),sha256);
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 const inventory=await(await fineDetailRequest(req(api+'status'),b,index)).json();
 assert.equal(inventory.complete,true);assert.equal(inventory.uploadsEnabled,false);
});

test('seed route leaves originals static and unrelated banks cannot be intercepted or changed',async()=>{
 for(const path of ['/assets/native-surface-v20/native.hfm.gz','/api/guided-native-v21/status','/assets/fine-surface-v23/manifest.json','/'])assert.equal(await fineDetailRequest(req(path),null,index),null);
 assert.equal(await fineDetailRequest(req('/assets/'+name),null,index,{servePublic:false}),null);
 assert.equal((await fineDetailRequest(req(api+'unlisted.gz','PUT',token),bucket(),index,{uploadsEnabled:true,uploadToken:token})).status,404);
});
