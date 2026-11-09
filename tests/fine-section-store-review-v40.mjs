/** Independent storage-identity and concurrent-writer review regressions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {FineSectionStore} from '../public/fine-section-store.js';

const manifest={schemaVersion:1,version:'review',codec:'gzip-u8-zyx-positive-halo',
 sourceSpacingUm:80,sourceShapeXYZ:[16,16,16],sourceOriginXYZ:[0,0,0],fullDimensionsXYZ:[16,16,16],
 longestMm:1.2,brickSize:8,storedEdge:9,brickCountsXYZ:[2,2,2],
 blocks:{0:{rawSha256:'1'.repeat(64)},1:{rawSha256:'2'.repeat(64)}}};
const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.75,height:.75};
const plan={width:64,height:64,spacingUmXY:[14.2857142857,14.2857142857]};
let seed=12345;const pixels=Uint8Array.from({length:4096},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});
const result=p=>({data:pixels,width:64,height:64,plane:p,spacingUm:14.2857142857,spacingUmXY:plan.spacingUmXY,sourceSpacingUm:80,complete:true,cleaned:true});

function disk(){
 const entries=new Map(),key=r=>typeof r==='string'?r:r.url;
 const cache={
  async match(r){return entries.get(key(r))?.clone();},
  async put(r,response){entries.set(key(r),response.clone());},
  async delete(r){return entries.delete(key(r));},
  async keys(){
   const snapshot=[...entries.keys()].map(url=>new Request(url));
   // Real Cache API reads are asynchronous; two independent workers may both
   // observe the pre-write collection. Never rely on same-process FIFO alone.
   await new Promise(resolve=>setTimeout(resolve,10));return snapshot;
  },
 };
 return {entries,async open(){return cache;}};
}
const store=(source,cache,options={})=>new FineSectionStore(source,{baseUrl:'https://heart.test/',cacheStorage:cache,...options});

test('every block-grid coordinate input contributes to the saved-source identity',async()=>{
 const cache=disk(),a=store(manifest,cache),b=store({...manifest,brickCountsXYZ:[1,4,2]},cache);
 assert.notEqual(await a.identity(),await b.identity(),'Changed block-ID to XYZ mapping cannot inherit a saved section.');
 const c=store({...manifest,schemaVersion:2},cache);
 assert.notEqual(await a.identity(),await c.identity(),'A new source schema cannot inherit an old section identity.');
});

test('independent concurrent writers converge to the shared encoded byte ceiling',async()=>{
 const cache=disk(),limit=4100;
 const a=store({...manifest,datasetId:'A'},cache,{limit}),b=store({...manifest,datasetId:'B'},cache,{limit});
 await Promise.all([a.identity(),b.identity()]);
 assert.equal(a.save(result(plane),plan),true);
 assert.equal(b.save(result({...plane,center:[.1,0,0]}),plan),true);
 await Promise.all([a.writeQueue,b.writeQueue]);
 let storedBytes=0;
 for(const response of cache.entries.values())storedBytes+=(await response.clone().arrayBuffer()).byteLength;
 assert.ok(storedBytes<=limit,`Concurrent saved sections occupy ${storedBytes} bytes, above ${limit}.`);
 assert.ok(cache.entries.size>=1,'Budget trimming should retain at least one valid complete section.');
 assert.equal(a.pendingBytes,0);assert.equal(b.pendingBytes,0);
});
