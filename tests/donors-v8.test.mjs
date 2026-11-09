import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DONORS,donorFromSearch,donorUrl} from '../public/donors.js';
import {SectionDetail} from '../public/section-detail.js';
import {croppedSectionFrame} from '../public/section-layout.js';
import {fineVolumeRequest} from '../server/ultra-volume-store-v7.mjs';
import {ultraRequest} from '../server/ultra-store.mjs';

test('Donor selection and shared views cannot carry the previous specimen identity',()=>{
 assert.equal(donorFromSearch('').id,'ladaf-2021-17');
 assert.equal(donorFromSearch('?donor=2298522198').id,'ucl-zcr-2629');
 assert.equal(donorFromSearch('?donor=unknown').id,'ladaf-2021-17');
 const url=donorUrl('https://example.test/?unrelated=1#view=old','ucl-zcr-2629');
 assert.equal(url.searchParams.get('donor'),'ucl-zcr-2629');assert.equal(url.hash,'');
 for(const field of ['manifestUrl','ultraManifestUrl','ultraVolumeManifestUrl','cacheName','volumeCacheName','pauseKey'])assert.notEqual(DONORS[0][field],DONORS[1][field],field);
 assert.equal(DONORS[1].nativeSpacingUm,7.032);assert.equal(DONORS[1].fineSpacingUm,28.128);
});

test('Detailed sections preserve donor spacing and even-grid pixel centers',async()=>{
 const full={data:Uint8Array.from({length:24},(_,i)=>i),width:4,height:6,fullWidth:8,fullHeight:6,crop:[2,0,4,6],spacingUm:28.128};
 const detail=new SectionDetail({init:async()=>({spacingUm:28.128,imageDimensionsXYZ:[8,6,7],sliceCounts:[3,3,3]}),load:async()=>full});
 await detail.init();const result=await detail.load(0,1);
 assert.equal(result.spacingUm,56.256);assert.deepEqual([...result.data],[0,2,8,10,16,18]);
 const frame=croppedSectionFrame({center:[0,0,0],right:[1,0,0],up:[0,1,0],width:7,height:5},result);
 assert.equal(frame.width,2);assert.equal(frame.height,4);
 assert.ok(Math.abs(frame.center[0]-frame.width/2+1.5)<1e-12,'First retained source pixel center is unchanged.');
 assert.ok(Math.abs(frame.center[0]+frame.width/2-.5)<1e-12,'Last alternate pixel is two native steps after the first.');
});

function bucket(){const objects=new Map();return {objects,async head(key){return objects.get(key)||null;},async get(key){const v=objects.get(key);return v?{...v,body:new Blob([v.data]).stream()}:null;},async put(key,data,opts){objects.set(key,{key,size:data.byteLength,data,httpEtag:'"source"',customMetadata:opts.customMetadata});},async list({prefix}){return {objects:[...objects.values()].filter(o=>o.key.startsWith(prefix)),truncated:false};}};}
for(const [kind,handler,path] of [['volume',fineVolumeRequest,'00/00/00.gz'],['ultra',ultraRequest,'x/0001.webp']]){
 test(`${kind} data uses an isolated donor route, namespace and provenance`,async()=>{
  const data=new Uint8Array(40).fill(18),sha256=createHash('sha256').update(data).digest('hex');
  const index={[path]:{bytes:data.length,sha256}},b=bucket();
  const route=`/api/donors/ucl-zcr-2629/${kind}/`,prefix=`hoa-heart/ucl-zcr-2629/${kind}-v8/`;
  const opts={route,prefix,specimen:'UCL-ZCR-2629',spacingUm:28.128,sourceScale:'2'};
  const url='https://heart.test'+route+path;
  assert.equal((await handler(new Request(url,{method:'PUT',body:data}),b,index,opts)).status,405);
  assert.equal((await handler(new Request(url,{method:'PUT',body:data}),b,index,{...opts,uploadsEnabled:true})).status,201);
  const stored=b.objects.get(prefix+path);assert.equal(stored.customMetadata.specimen,'UCL-ZCR-2629');assert.equal(stored.customMetadata.spacingUm,'28.128');
  const response=await handler(new Request(url),b,index,opts);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),data);
  const status=await (await handler(new Request('https://heart.test'+route+'status'),b,index,opts)).json();assert.equal(status.complete,true);assert.equal(status.uploadsEnabled,false);
  assert.equal(await handler(new Request('https://heart.test/api/ultra/v4/'+path),b,index,opts),null);
 });
}
