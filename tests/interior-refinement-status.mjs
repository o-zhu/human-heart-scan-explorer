/** Real local/lumen loaders and activation predicates with a small DOM/GPU fixture.
 * The atlas is explicitly ready with matching synthetic fields; its actual
 * binary validation, lookup and upload are covered by the focused atlas suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash,webcrypto} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {FineSurfaceController,FineSurfacePass} from '../public/fine-surface.js';
import {refinementWorldBounds} from '../public/local-surface-refinement.js';

const domPath=process.argv[2];if(!domPath)throw new Error('Pass the installed LinkeDOM ESM entry point.');
const {parseHTML}=await import(pathToFileURL(domPath));
const page=readFileSync(new URL('../page.html',import.meta.url),'utf8');
const SOURCE='e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c';
const GENTLE='175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae';
const digest=x=>createHash('sha256').update(x).digest('hex');
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(predicate){for(let i=0;i<250;i++){if(predicate())return;await tick();}throw new Error('Expected refinement lifecycle state was not reached.');}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

function collection(){
 const bodies=new Map();
 function asset(url,raw,extra={}){const encoded=gzipSync(raw);bodies.set(url,encoded);return {url,compressedBytes:encoded.length,decodedBytes:raw.length,sha256:digest(encoded),decodedSha256:digest(raw),...extra};}
 const patches=Array.from({length:4},(_,i)=>{
  const lo=[948+i*8,948,1058],hi=lo.map(n=>n+3),bounds=refinementWorldBounds(lo,hi),raw=new Uint8Array(100);
  new Uint32Array(raw.buffer,0,8).set([0x31524653,1,3,3,32,68,88,0]);
  new Float32Array(raw.buffer,32,9).set([...bounds.min,bounds.max[0],bounds.min[1],bounds.min[2],bounds.min[0],bounds.max[1],bounds.max[2]]);
  new Int16Array(raw.buffer,68,9).set([0,0,32767,0,0,32767,0,0,32767]);new Uint32Array(raw.buffer,88,3).set([0,1,2]);
  return {id:'fixture-'+i,lowerFullFineXYZ:lo,upperFullFineXYZ:hi,
   surface:asset('./assets/cleanup-v30/fixture-'+i+'.sfr.gz',raw,{format:'SFR1-gzip',vertices:3,triangles:1,bounds}),
   lowBandMask:asset('./assets/cleanup-v30/fixture-'+i+'.bits.gz',new Uint8Array(9),{format:'gzip-bitset-x-zyx',dimensionsXYZ:[3,3,3],storageDimensionsXYZ:[1,3,3]})};
 });
 const surface={version:1,donorId:'ladaf-2021-17',sourceManifestSha256:SOURCE,sourceMeshDecodedSha256:GENTLE,sourceSpacingUm:79.4,threshold:.28,extent:[1,1,1],patches};
 const mask=asset('./assets/cleanup-v30/fixture-lumen.bits.gz',new Uint8Array(9),{id:'rv',dimensionsXYZ:[3,3,3],storageDimensionsXYZ:[1,3,3],lowerFullFineXYZ:[948,948,1058],upperFullFineXYZ:[951,951,1061]});
 // Full desktop preparation requires the four lumen plus four local fields.
 const lumen={id:'fixture-lumen',donorId:'ladaf-2021-17',sourceManifestSha256:SOURCE,sourceSpacingUm:79.4,sourceFullDimensionsXYZ:[1897,1897,2117],extent:[1,1,1],sampling:'nearest',format:'gzip-bitset-x-zyx',masks:['atrial','arterial','valve-region','rv'].map(id=>({...mask,id}))};
 return {bodies,surface,lumen};
}

function readyAtlas(fixture){
 const masks=[...fixture.lumen.masks.map(mask=>['lumen:'+mask.id,mask]),...fixture.surface.patches.map(patch=>['local:'+patch.id,{...patch.lowBandMask,lowerFullFineXYZ:patch.lowerFullFineXYZ}])];
 const fields=masks.map(([id,mask])=>({id,kind:id.split(':')[0],sourceId:id.slice(id.indexOf(':')+1),sourceUrl:mask.url,sourceCompressedSha256:mask.sha256,sourceDecodedSha256:mask.decodedSha256,sourceDecodedBytes:mask.decodedBytes,dimensionsXYZ:mask.dimensionsXYZ,storageDimensionsXYZ:mask.storageDimensionsXYZ,lowerFullFineXYZ:mask.lowerFullFineXYZ}));
 return {ready:true,collection:{manifest:{fields,extent:fixture.surface.extent}},fieldIndex(id,mask){
  const index=fields.findIndex(f=>f.id===id);if(index<0)return -1;const f=fields[index];
  return f.sourceUrl===mask.url&&f.sourceCompressedSha256===mask.sha256&&f.sourceDecodedSha256===mask.decodedSha256&&f.sourceDecodedBytes===mask.decodedBytes&&['dimensionsXYZ','storageDimensionsXYZ','lowerFullFineXYZ'].every(key=>JSON.stringify(f[key])===JSON.stringify(mask[key]))?index:-1;
 }};
}

function environment(intercept=()=>null){
 const {document,window}=parseHTML(page),fixture=collection(),requests=[],live=new Set(),events=[];
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._fixtureValue??this.querySelector('option')?.value??'';},set(value){this._fixtureValue=String(value);}});
 const names=['document','fetch','location','localStorage','crypto'],previous=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 const response=url=>{assert.equal(url.includes('/reviewed-mask-v32/'),false,'Ready fixture atlas must not fetch production atlas files.');return fixture.bodies.has(url)?new Response(fixture.bodies.get(url)):new Response(JSON.stringify(url.endsWith('/surface-manifest.json')?fixture.surface:fixture.lumen));};
 const fetcher=async(url,options={})=>{url=String(url);requests.push(url);const special=intercept(url,options,fixture,response);return special??response(url);};
 Object.assign(globalThis,{document,fetch:fetcher,location:{href:'https://fixture.invalid/'},localStorage:{getItem:()=>null,setItem(){}}});
 if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});
 const resource=()=>{const r={};live.add(r);return r;},destroy=r=>live.delete(r),glState={active:0x84c0,vao:null,array:null,alignment:4};
 const gl={NO_ERROR:0,MAX_TEXTURE_IMAGE_UNITS:0x8872,MAX_3D_TEXTURE_SIZE:0x8073,ACTIVE_TEXTURE:0x84e0,VERTEX_ARRAY_BINDING:0x85b5,ARRAY_BUFFER_BINDING:0x8894,UNPACK_ALIGNMENT:0x0cf5,ARRAY_BUFFER:0x8892,ELEMENT_ARRAY_BUFFER:0x8893,STATIC_DRAW:0x88e4,FLOAT:0x1406,SHORT:0x1402,UNSIGNED_SHORT:0x1403,UNSIGNED_BYTE:0x1401,TEXTURE0:0x84c0,TEXTURE_3D:0x806f,R8:0x8229,RED:0x1903,
  createVertexArray:resource,createBuffer:resource,createTexture:resource,deleteVertexArray:destroy,deleteBuffer:destroy,deleteTexture:destroy,
  bindVertexArray(value){glState.vao=value;},bindBuffer(target,value){if(target===gl.ARRAY_BUFFER)glState.array=value;},bufferData(){},enableVertexAttribArray(){},disableVertexAttribArray(){},vertexAttribPointer(){},vertexAttrib1f(){},activeTexture(value){glState.active=value;},bindTexture(){},pixelStorei(target,value){if(target===gl.UNPACK_ALIGNMENT)glState.alignment=value;},texImage3D(){},texParameteri(){},getError:()=>0,isContextLost:()=>false,getParameter(p){return ({[this.MAX_TEXTURE_IMAGE_UNITS]:16,[this.MAX_3D_TEXTURE_SIZE]:512,[this.ACTIVE_TEXTURE]:glState.active,[this.VERTEX_ARRAY_BINDING]:glState.vao,[this.ARRAY_BUFFER_BINDING]:glState.array,[this.UNPACK_ALIGNMENT]:glState.alignment})[p]??null;}};
 const renderer={gl,extent:[1,1,1],settings:{mode:0,threshold:.28,cleanupEnabled:true,debrisCleanupEnabled:true,showPlanes:0},data:new Uint8Array([7,124,210]),cap:{data:new Uint8Array([71,190])},
  reviewedMaskAtlas:readyAtlas(fixture),requestRender:reason=>events.push(reason),set(p){Object.assign(this.settings,p);},setLumenCleanupData(data){for(const mask of data.masks)assert.ok(this.reviewedMaskAtlas.fieldIndex('lumen:'+mask.id,mask)>=0);this.lumenCleanup=data;}};
 const pass=renderer.fineSurface={lod:{id:'gentle',decodedSha256:GENTLE},manifest:{threshold:.28,extent:[1,1,1],sourceSpacingUm:79.4},geometrySourceSha256:GENTLE,enabled:true,activeFor:FineSurfacePass.prototype.activeFor};
 const controller=new FineSurfaceController({renderer,donor:{id:'ladaf-2021-17'},mount:document.getElementById('fineSurfaceControls'),autoStart:false});
 return {controller,renderer,pass,fixture,document,window,requests,live,events,response,
  async begin(){await controller.choose('gentle');},
  close(){controller.localRefinement.dispose();controller.lumenCleanup.revision++;controller.lumenCleanup.abort?.abort();for(const n of names){if(previous[n])Object.defineProperty(globalThis,n,previous[n]);else delete globalThis[n];}}};
}

test('three staged regions never announce refinement; a fourth-region failure has visible Retry and retains the complete source view',async()=>{
 const final=deferred();let fail=true;
 const f=environment(url=>url.endsWith('fixture-3.sfr.gz')&&fail?final.promise:null);
 try{
  const source=f.renderer.data.slice(),cap=f.renderer.cap;
  await f.begin();await until(()=>f.controller.localRefinement.staging?.length===3);
  assert.equal(f.controller.localRefinement.current,null);assert.equal(f.controller.localRefinement.active(),false);
  assert.equal(f.controller.refinementNotice.hidden,false);assert.equal(f.controller.refinementNoticeText.textContent,'Loading prepared model…');
  final.resolve(new Response('missing',{status:404}));await until(()=>!!f.controller.localRefinement.error);
  assert.equal(f.controller.refinementNoticeText.textContent,'Prepared model unavailable');assert.equal(f.controller.refinementNoticeRetry.hidden,false);assert.equal(f.controller.refinementRetry.hidden,false);
  assert.equal(f.document.getElementById('viewerSettings').contains(f.controller.refinementNotice),false,'The error remains visible when Detail settings are closed.');
  assert.equal(f.live.size,0,'All staged resources were released on failure.');assert.equal(f.renderer.fineSurface,f.pass);assert.equal(f.controller.badge.hidden,false);
  fail=false;f.controller.refinementNoticeRetry.click();
  assert.equal(f.controller.refinementNoticeText.textContent,'Loading prepared model…','A stale failure must not hide retry progress.');
  await until(()=>f.controller.localRefinement.active());
  assert.equal(f.controller.localRefinement.current.pieces.length,4);assert.equal(f.controller.refinementNoticeText.textContent,'Prepared model ready');assert.equal(f.controller.refinementNotice.hidden,true,'A completed model does not leave a redundant status banner.');assert.equal(f.controller.refinementNoticeRetry.hidden,true);
  assert.equal(f.renderer.fineSurface,f.pass);assert.equal(f.renderer.cap,cap);assert.deepEqual(f.renderer.data,source);
  assert.equal(f.requests.some(url=>url.includes('fine-surface')||url.includes('display-compact')),false,'Retry must not reload the whole heart.');
 }finally{f.close();}
});

test('local completion before late lumen masks stays pending and a failed lumen dependency retries without reloading local surfaces',async()=>{
 const hard=deferred();let fail=true;
 const f=environment(url=>url.endsWith('/lumen-manifest.json')&&fail?hard.promise:null);
 try{
  await f.begin();await until(()=>!!f.controller.localRefinement.current);
  const complete=f.controller.localRefinement.current;
  assert.equal(f.controller.localRefinement.active(),false);assert.equal(f.controller.refinementNoticeText.textContent,'Loading prepared model…');
  hard.resolve(new Response('offline',{status:503}));await until(()=>!!f.controller.lumenCleanup.error);
  assert.equal(f.controller.refinementNoticeText.textContent,'Prepared model unavailable');assert.equal(f.controller.refinementNoticeRetry.hidden,false);
  const surfaceRequests=f.requests.filter(url=>url.endsWith('/surface-manifest.json')).length;
  fail=false;f.controller.refinementRetry.click();await until(()=>f.controller.localRefinement.active());
  assert.equal(f.controller.localRefinement.current,complete);assert.equal(f.requests.filter(url=>url.endsWith('/surface-manifest.json')).length,surfaceRequests);
  assert.equal(f.controller.refinementNoticeText.textContent,'Prepared model ready');assert.equal(f.controller.refinementNotice.hidden,true);
  await f.controller.lumenCleanup.setEnabled(false);assert.equal(f.controller.refinementNoticeText.textContent,'Interior refinement off');
  await f.controller.lumenCleanup.setEnabled(true);assert.equal(f.controller.refinementNoticeText.textContent,'Prepared model ready');assert.equal(f.controller.refinementNotice.hidden,true);
 }finally{f.close();}
});

test('workspace pause and view gates remove the refined claim; returning resumes without changing native priority or source arrays',async()=>{
 const hold=deferred();let first=true;
 const f=environment((url,{signal})=>{
  if(url.endsWith('fixture-3.sfr.gz')&&first){signal.addEventListener('abort',()=>hold.reject(new DOMException('Paused','AbortError')),{once:true});return hold.promise;}
  return null;
 });
 try{
  await f.begin();await until(()=>f.controller.localRefinement.staging?.length===3);
  f.controller.setWorkspaceActive(false);assert.equal(f.controller.refinementNotice.hidden,true);assert.equal(f.controller.localRefinement.current,null);assert.equal(f.live.size,0);
  first=false;f.controller.setWorkspaceActive(true);await until(()=>f.controller.localRefinement.active());
  assert.equal(f.controller.refinementNoticeText.textContent,'Prepared model ready');assert.equal(f.controller.refinementNotice.hidden,true);
  const complete=f.controller.localRefinement.current,source=f.renderer.data.slice(),cap=f.renderer.cap,native={active:()=>true};f.renderer.nativeMainDetail=native;
  f.controller.sync();assert.equal(f.controller.refinementNoticeText.textContent,'Prepared model ready');assert.equal(f.controller.refinementNotice.hidden,true);assert.equal(f.renderer.nativeMainDetail,native);
  f.renderer.settings.debrisCleanupEnabled=false;f.controller.sync();assert.equal(f.controller.refinementNoticeText.textContent,'Interior refinement off');
  f.renderer.settings.debrisCleanupEnabled=true;
  for(const change of [{cleanupEnabled:false},{mode:1},{threshold:.4},{showPlanes:1}]){
   Object.assign(f.renderer.settings,{cleanupEnabled:true,mode:0,threshold:.28,showPlanes:0},change);f.controller.sync();
   assert.equal(f.controller.localRefinement.active(),false);assert.equal(f.controller.refinementNotice.hidden,true);assert.notEqual(f.controller.refinementNoticeText.textContent,'Prepared model ready');
  }
  Object.assign(f.renderer.settings,{cleanupEnabled:true,mode:0,threshold:.28,showPlanes:0});f.pass.lod={...f.pass.lod,id:'detail'};f.controller.sync();assert.equal(f.controller.refinementNotice.hidden,true);
  f.pass.lod={...f.pass.lod,id:'gentle'};f.controller.sync();assert.equal(f.controller.refinementNoticeText.textContent,'Prepared model ready');assert.equal(f.controller.refinementNotice.hidden,true);
  assert.equal(f.controller.localRefinement.current,complete);assert.deepEqual(f.renderer.data,source);assert.equal(f.renderer.cap,cap);assert.equal(f.renderer.nativeMainDetail,native);
 }finally{f.close();}
});
