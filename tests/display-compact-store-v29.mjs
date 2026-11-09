import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { displayCompactRequest, displayCompactUploadsEnabled } from '../server/display-compact-store-v29.mjs';
import { comparisonDisplayRequest } from '../server/comparison-display-store-v10.mjs';

const name='mesh/positions-000.gz',api='/api/display-compact-v29/';
const bytes=new Uint8Array([31,139,1,2,3]);
const sha256=createHash('sha256').update(bytes).digest('hex');
const index={[name]:{bytes:bytes.length,sha256,contentType:'application/octet-stream'}};
const token='separate-compact-display-collection-test-secret';
const req=(path,method='GET',key,body=bytes)=>new Request('https://example.test'+path,{method,...(method==='PUT'?{body}:{}),headers:key?{'X-Heart-Compact-Upload':key}:{}});
function bucket(){const objects=new Map();return {objects,
 async head(k){return objects.get(k)||null;},
 async get(k){const a=objects.get(k);return a?{...a,body:new Blob([a.data]).stream()}:null;},
 async put(k,data,opts){objects.set(k,{key:k,size:data.length,data:new Uint8Array(data),customMetadata:opts.customMetadata});},
 async list(){return {objects:[...objects.values()],truncated:false};},
};}

test('closed default cannot be reopened by a retained secret; seed writes require scoped token',async()=>{
 assert.equal(displayCompactUploadsEnabled,false);
 const b=bucket();
 assert.equal((await displayCompactRequest(req(api+name,'PUT',token),b,index,{uploadToken:token})).status,405);
 for(const key of [undefined,'incorrect'])assert.equal((await displayCompactRequest(req(api+name,'PUT',key),b,index,{uploadsEnabled:true,uploadToken:token})).status,403);
 assert.equal(b.objects.size,0);
});

test('authorized upload enforces exact bytes and immutable identity, then serves verified data',async()=>{
 const b=bucket(),open={uploadsEnabled:true,uploadToken:token};
 assert.equal((await displayCompactRequest(req(api+name,'PUT',token,new Uint8Array([0])),b,index,open)).status,400);
 assert.equal((await displayCompactRequest(req(api+name,'PUT',token,new Uint8Array(bytes.length)),b,index,open)).status,400);
 assert.equal((await displayCompactRequest(req(api+name,'PUT',token),b,index,open)).status,201);
 assert.equal((await displayCompactRequest(req(api+name,'PUT',token),b,index,open)).status,204);
 const response=await displayCompactRequest(req('/assets/display-compact-v29/'+name),b,index);
 assert.equal(response.status,200);assert.equal(response.headers.get('x-content-sha256'),sha256);
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 const inventory=await(await displayCompactRequest(req(api+'status'),b,index)).json();
 assert.equal(inventory.complete,true);assert.equal(inventory.uploadsEnabled,false);
 b.objects.get('hoa-heart/display-compact-v29/'+name).customMetadata.sha256='0'.repeat(64);
 assert.equal((await displayCompactRequest(req(api+name,'PUT',token),b,index,open)).status,409);
});

test('unknown files and all source banks remain outside the new collection',async()=>{
 for(const path of ['/assets/fine-surface-v23/gentle.part-000.gz','/api/ultra/v4/status','/api/ultra-volume/v7/status','/assets/display-compact-v29/mesh-manifest.json','/'])assert.equal(await displayCompactRequest(req(path),null,index),null);
 assert.equal(await displayCompactRequest(req('/assets/display-compact-v29/'+name),null,index,{servePublic:false}),null);
 assert.equal((await displayCompactRequest(req(api+'unlisted.gz','PUT',token),bucket(),index,{uploadsEnabled:true,uploadToken:token})).status,404);
});

test('cleanup aliases serve only indexed exact bytes with matching HEAD and conditional responses',async()=>{
 const b=bucket(),key='cleanup/pulmonary-lumen-v29.hfm.gz';
 const alias='/assets/cleanup-v29/pulmonary-lumen-v29.hfm.gz';
 const cleanupIndex={[key]:{bytes:bytes.length,sha256,contentType:'application/octet-stream'}};
 const open={uploadsEnabled:true,uploadToken:token};
 assert.equal((await displayCompactRequest(req(api+key,'PUT',token),b,cleanupIndex,open)).status,201);
 assert.equal(b.objects.has('hoa-heart/display-compact-v29/'+key),true);
 assert.equal(await displayCompactRequest(req(alias),b,cleanupIndex,{servePublic:false}),null);
 const response=await displayCompactRequest(req(alias+'?v='+sha256.slice(0,16)),b,cleanupIndex);
 assert.equal(response.status,200);
 assert.equal(response.headers.get('content-type'),'application/octet-stream');
 assert.equal(response.headers.get('content-encoding'),null,'Opaque gzip payload must not be HTTP-decompressed.');
 assert.equal(response.headers.get('x-content-sha256'),sha256);
 assert.equal(response.headers.get('content-length'),String(bytes.length));
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 const head=await displayCompactRequest(req(alias,'HEAD'),b,cleanupIndex);
 assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal(head.headers.get('etag'),response.headers.get('etag'));
 const conditional=new Request('https://example.test'+alias,{headers:{'If-None-Match':response.headers.get('etag')}});
 const cached=await displayCompactRequest(conditional,b,cleanupIndex);
 assert.equal(cached.status,304);assert.equal(cached.headers.has('content-length'),false);
 assert.equal(await cached.text(),'');
 b.objects.get('hoa-heart/display-compact-v29/'+key).customMetadata.sha256='0'.repeat(64);
 assert.equal((await displayCompactRequest(req(alias),b,cleanupIndex)).status,503);
});

test('cleanup aliases cannot route manifests, unknown files, historical assets, or public writes',async()=>{
 const key='cleanup/pulmonary-lumen-v29.hfm.gz';
 const cleanupIndex={[key]:{bytes:bytes.length,sha256,contentType:'application/octet-stream'}};
 for(const path of ['/assets/cleanup-v29/surface-manifest.json','/assets/cleanup-v29/lumen-manifest.json','/assets/cleanup-v29/unlisted.hfm.gz','/assets/cleanup-v28/pulmonary-lumen-v29.hfm.gz','/assets/cleanup-v29-right/pulmonary-lumen-v29.hfm.gz'])
  assert.equal(await displayCompactRequest(req(path),null,cleanupIndex),null);
 assert.equal(await displayCompactRequest(req('/assets/cleanup-v29/pulmonary-lumen-v29.hfm.gz','PUT',token),null,cleanupIndex,{uploadsEnabled:true,uploadToken:token}),null);
 assert.equal((await displayCompactRequest(req(api+key,'PUT',token),null,cleanupIndex,{uploadToken:token})).status,405);
});

test('exact compact JSON metadata supports verified upload and public/API reads',async()=>{
 const b=bucket(),open={uploadsEnabled:true,uploadToken:token};
 for(const key of ['sections-manifest.json','mesh-manifest.json','surface-manifest.json']) {
  const data=new TextEncoder().encode(JSON.stringify({kind:key,fixture:true}));
  const digest=createHash('sha256').update(data).digest('hex');
  const metadataIndex={[key]:{bytes:data.length,sha256:digest,contentType:'application/json'}};
  assert.equal((await displayCompactRequest(req(api+key,'PUT',token,data),b,metadataIndex,open)).status,201);
  assert.equal((await displayCompactRequest(req(api+key,'PUT',token,data),b,metadataIndex,open)).status,204);
  for(const path of [api+key,'/assets/display-compact-v29/'+key]) {
   const response=await displayCompactRequest(req(path+'?v='+digest.slice(0,16)),b,metadataIndex);
   assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/json');
   assert.equal(response.headers.get('x-content-sha256'),digest);
   assert.equal(response.headers.get('content-encoding'),null);
   assert.deepEqual(new Uint8Array(await response.arrayBuffer()),data);
   const head=await displayCompactRequest(req(path,'HEAD'),b,metadataIndex);
   assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(data.length));
   assert.equal(await head.text(),'');
  }
  assert.equal(await displayCompactRequest(req('/assets/display-compact-v29/'+key),b,metadataIndex,{servePublic:false}),null);
 }
});

test('compact JSON opt-in does not admit unknown metadata or change older collection rules',async()=>{
 const data=new TextEncoder().encode('{"fixture":true}');
 const record={bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),contentType:'application/json'};
 const b=bucket(),open={uploadsEnabled:true,uploadToken:token};
 for(const key of ['sections-manifest.json','mesh-manifest.json','surface-manifest.json']) {
  const old=await comparisonDisplayRequest(req('/api/comparison-display-v10/'+key,'PUT',token,data),b,{[key]:record},{uploadsEnabled:true});
  assert.equal(old.status,500,'Existing collections must not acquire a JSON exception.');
 }
 const index={'sections-manifest.json':record};
 assert.equal((await displayCompactRequest(req(api+'unlisted.json','PUT',token,data),b,index,open)).status,404);
 assert.equal(await displayCompactRequest(req('/assets/display-compact-v29/unlisted.json'),b,index),null);
 assert.equal((await displayCompactRequest(req(api+'unlisted.json','PUT',token,data),b,{'unlisted.json':record},open)).status,500);
 assert.equal(b.objects.size,0);
});
