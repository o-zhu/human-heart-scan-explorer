import {titleCaseUi} from '../public/ui-text.js';
// Import-stripping DOM fixtures still use the production display-label helper.
const uiFunction=(...args)=>new Function('titleCaseUi',...args).bind(null,titleCaseUi);
/** Native asset/decoder/scheduling checks. No browser or network interaction. */
import test from 'node:test';
import * as sectionNames from '../public/section-names.js';
// This fixture strips imports; preserve the real section-name dependency.
const fixtureFunction=(...args)=>uiFunction(...Object.keys(sectionNames),...args).bind(null,...Object.values(sectionNames));
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {ClinicalFrameStore,validateClinicalManifest,snapSectionPosition} from '../public/clinical-data.js';
import {getDeviceResourcePolicy} from '../public/device-resources.js';
import {ResidentSectionSource} from '../public/resident-sections.js';
import {orthogonalFrame} from '../public/planes.js';

const root=new URL('../',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(await readFile(new URL('public/assets/clinical-v19/cmac/manifest.json',root),'utf8'));
const slicerManifest=JSON.parse(await readFile(new URL('public/assets/clinical-v19/slicerheart/manifest.json',root),'utf8'));
const workerSource=await readFile(new URL('public/clinical-volume-worker.js',root),'utf8');

test('all measured cMAC frame files match declared dimensions, checksums and totals',async()=>{
 assert.equal(validateClinicalManifest(manifest),manifest);
 let compressed=0,decoded=0,count=0;
 for(const series of manifest.series){
  assert.deepEqual(series.frames.map(frame=>frame.index),Array.from({length:series.frames.length},(_,i)=>i));
  for(const frame of series.frames){
   const bytes=await readFile(new URL('public'+frame.url,root));
   assert.equal(bytes.length,frame.compressedBytes,frame.url);
   assert.equal(sha(bytes),frame.sha256,frame.url);
   const raw=gunzipSync(bytes);
   assert.equal(raw.length,series.dimensions.reduce((a,b)=>a*b,1),frame.url);
   assert.equal(raw.length,frame.decodedBytes,frame.url);
   assert.equal(sha(raw),frame.decodedSha256,frame.url);
   compressed+=bytes.length;decoded+=raw.length;count++;
  }
 }
 assert.equal(count,45);assert.equal(compressed,manifest.compressedBytes);assert.equal(decoded,manifest.decodedBytesAllFrames);
 assert(compressed<60_000_000,'Native pilot should stay within the measured 60 MB transfer budget.');
});

test('native physical geometry, crop and pairing remain explicit',()=>{
 const whole=manifest.series.find(series=>series.id==='whole-heart-mri');
 const us=manifest.series.find(series=>series.id==='ultrasound');
 const cine=manifest.series.find(series=>series.id==='cine-sax');
 assert.deepEqual(whole.spacingMm,[.75,.75,1.5]);assert.equal(whole.sourceHeader.sliceThicknessMm,3);
 assert.deepEqual(whole.crop.sourceSpatialHeader.dimensions,[400,400,95]);
 const offset=whole.crop.lowerInclusiveXYZ,original=whole.crop.sourceSpatialHeader.indexToPhysicalMm;
 for(let row=0;row<3;row++){
  const expected=original[row][3]+offset.reduce((sum,value,col)=>sum+original[row][col]*value,0);
  assert(Math.abs(whole.originMm[row]-expected)<1e-7,'Crop origin must follow the native affine.');
  for(let col=0;col<3;col++)assert.equal(whole.indexToPhysicalMm[row][col],original[row][col]);
 }
 assert.deepEqual(us.dimensions,[208,224,208]);assert.deepEqual(us.spacingMm,[.658114,.667832,.580462]);
 assert.equal(us.frames.length,14);assert.equal(us.frameIntervalMs,47.2885);
 assert.equal(cine.frames.length,30);assert(Math.abs(cine.spacingMm[2]-8)<1e-5);
 assert.notEqual(whole.sourceHeader.frameOfReferenceHash,cine.sourceHeader.frameOfReferenceHash);
 assert.equal(manifest.pairing.sameVolunteer,true);assert.equal(manifest.pairing.spatiallyRegisteredInViewer,false);
 assert.equal(manifest.pairing.temporallySynchronizedInViewer,false);
 assert.equal(manifest.pairing.documentedReferenceFrames.ultrasound.endSystole,6);
 assert.equal(manifest.pairing.documentedReferenceFrames.cineSax.endSystole,10);
 assert(cine.frames.some(frame=>frame.triggerTimeRangeMs[1]>frame.triggerTimeRangeMs[0]),'Slice timing variation must remain visible.');
});

test('all SlicerHeart pilot files match their checksums and preserve the 20-volume measured loop',async()=>{
 assert.equal(validateClinicalManifest(slicerManifest),slicerManifest);
 const files=new Map();
 for(const series of slicerManifest.series){
  assert.equal(series.spatialResampling,series.id==='overview');
  for(const frame of series.frames){
   if(files.has(frame.url)){assert.equal(files.get(frame.url).sha256,frame.sha256);continue;}
   const bytes=await readFile(new URL('public'+frame.url,root)),raw=gunzipSync(bytes);
   assert.equal(bytes.length,frame.compressedBytes,frame.url);assert.equal(sha(bytes),frame.sha256,frame.url);
   assert.equal(raw.length,series.dimensions.reduce((a,b)=>a*b,1),frame.url);
   assert.equal(raw.length,frame.decodedBytes,frame.url);assert.equal(sha(raw),frame.decodedSha256,frame.url);
   files.set(frame.url,frame);
  }
  if(!series.staticReference){
   assert.equal(series.frames.length,21);assert.equal(series.playbackFrameCount,20);
   assert.equal(series.frames[20].url,series.frames[0].url);assert.equal(series.frames[20].sha256,series.frames[0].sha256);
   assert.equal(series.physicalPhaseTimesKnown,false);assert.equal(series.temporalInterpolation,false);
  }
 }
 assert.equal(files.size,41);assert.equal([...files.values()].reduce((sum,f)=>sum+f.compressedBytes,0),slicerManifest.totalUniqueCompressedBytes);
});

test('SlicerHeart overview and native crops retain declared acquired-coordinate support',()=>{
 const source=slicerManifest.source;
 const overview=slicerManifest.series.find(s=>s.id==='overview'),native=slicerManifest.series.find(s=>s.id==='native-reference');
 assert.deepEqual(overview.sourceCrop.physicalSupportRASmm,native.sourceCrop.physicalSupportRASmm);
 for(const series of slicerManifest.series){
  const stride=series.id==='overview'?2:1;
  for(let axis=0;axis<3;axis++){
   const bounds=series.sourceCrop.boundsXYZ[axis],spacing=source.spacingMm[axis];
   assert.equal(series.dimensions[axis]*stride,bounds[1]-bounds[0]);
   assert(Math.abs(series.spacingMm[axis]-spacing*stride)<1e-12);
   const origin=source.originRASmm[axis]+(bounds[0]+(stride-1)/2)*spacing;
   assert(Math.abs(series.geometry.originRASmm[axis]-origin)<1e-9);
  }
 }
 assert.equal(slicerManifest.healthyReference,false);assert.equal(slicerManifest.pairedUltrasoundIdentified,false);
 assert.match(slicerManifest.clinicalContext,/repaired truncus arteriosus/);
});

test('even-sized native sections snap to measured planes instead of averaging neighboring voxels',()=>{
 for(const count of [14,95,208,224,256]){
  let p=snapSectionPosition(.5,count),index=Math.round(p*(count-1));
  assert(Math.abs(p*(count-1)-index)<1e-10);
  for(let i=0;i<10;i++){p=snapSectionPosition(p+1/(count-1),count);index=Math.min(count-1,index+1);assert(Math.abs(p*(count-1)-index)<1e-10);}
  assert.equal(snapSectionPosition(-1,count),0);assert.equal(snapSectionPosition(2,count),1);
 }
 const sections=new ResidentSectionSource(),data=new Uint8Array(2*4*2);
 for(let z=0;z<2;z++)for(let y=0;y<4;y++)for(let x=0;x<2;x++)data[x+2*(y+4*z)]=y*50;
 sections.setVolume(data,{dimensions:[2,4,2],spacingUm:[1,1,1]});
 assert.deepEqual([...sections.get(1,snapSectionPosition(.5,4)).data],[100,100,100,100]);
 assert.deepEqual([...sections.get(1,.5).data],[75,75,75,75],'Unsnapped midpoint would mix measured planes.');
 sections.dispose();
});

function frame(index,size=8){
 const bytes=Uint8Array.from({length:size},(_,i)=>(index*19+i)%256),compressed=gzipSync(bytes,{mtime:0});
 return {index,url:'/fixture/frame-'+index+'.u8.gz',decodedBytes:bytes.length,compressedBytes:compressed.length,sha256:sha(compressed),decodedSha256:sha(bytes),bytes,compressed};
}
async function decode(f,{mutate,responseOk=true}={}){
 const messages=[],body=mutate?mutate(f.compressed):f.compressed;
 const self={postMessage:message=>messages.push(message)};
 vm.runInNewContext(workerSource,{self,fetch:async()=>new Response(body,{status:responseOk?200:503}),crypto:webcrypto,Uint8Array,Array,Response,Blob,DecompressionStream});
 await self.onmessage({data:f});return messages[0];
}
test('actual frame worker decodes measured bytes and rejects corrupted or truncated input',async()=>{
 const f=frame(1),result=await decode(f);assert.deepEqual(new Uint8Array(result.buffer),f.bytes);
 assert.match((await decode(f,{mutate:bytes=>Buffer.from(bytes).fill(0,12,13)})).error,/checksum/i);
 assert.match((await decode({...f,decodedBytes:f.decodedBytes+1})).error,/dimensions/i);
 assert.match((await decode(f,{responseOk:false})).error,/503/);
});

function storeFixture(maxBytes=32,resourcePolicy){
 const workers=[];
 const store=new ClinicalFrameStore({maxBytes,resourcePolicy,workerFactory:()=>{
  const worker={terminated:false,postMessage(message){this.message=message;},terminate(){this.terminated=true;},finish(bytes){this.onmessage({data:{buffer:Uint8Array.from(bytes).buffer}});}};
  workers.push(worker);return worker;
 }});
 return {store,workers};
}
test('current phase preempts neighbor preparation and requests share one decoder',async()=>{
 const {store,workers}=storeFixture(),neighbor=frame(1),current=frame(2);
 const first=store.load(neighbor,{priority:false});const firstResult=first.catch(error=>error.name);
 const selected=store.load(current);assert.equal(workers[0].terminated,true);assert.equal(workers.length,2);
 assert.equal(store.load(current),selected,'Identical active selection must reuse its promise.');
 workers[1].finish(current.bytes);assert.deepEqual(await selected,current.bytes);assert.equal(await firstResult,'AbortError');
 assert.equal(store.cached(current).byteLength,8);store.dispose();
});
test('late worker messages cannot repopulate a disposed frame store',async()=>{
 const {store,workers}=storeFixture(),f=frame(3),pending=store.load(f).catch(error=>error.name);
 store.dispose();workers[0].finish(f.bytes);assert.equal(await pending,'AbortError');
 assert.equal(store.cache.size,0);assert.equal(store.cacheBytes,0);
});
test('rapid foreground phase changes coalesce instead of downloading stale queued phases',async()=>{
 const {store,workers}=storeFixture(),a=frame(1),b=frame(2),c=frame(3);
 const pa=store.load(a).catch(error=>error.name),pb=store.load(b).catch(error=>error.name),pc=store.load(c).catch(error=>error.name);
 const latestWorker=workers.at(-1);
 if(latestWorker.message.sha256===a.sha256)latestWorker.finish(a.bytes);
 assert.equal(workers.at(-1).message.sha256,c.sha256,'The newest selected phase must be next, not an obsolete phase.');
 workers.at(-1).finish(c.bytes);assert.deepEqual(await pc,c.bytes);
 store.dispose();await Promise.all([pa,pb]);
});
test('decoded frame LRU keeps memory bounded without changing retained samples',async()=>{
 const {store,workers}=storeFixture(16),frames=[frame(0),frame(1),frame(2)];
 for(const f of frames){const pending=store.load(f);workers.at(-1).finish(f.bytes);await pending;}
 assert.equal(store.cacheBytes,16);assert.equal(store.cached(frames[0]),null);assert.deepEqual(store.cached(frames[2]),frames[2].bytes);
 store.dispose();
});

test('mobile clinical playback warms one affordable neighbor without preparing the full cine',async()=>{
 const policy=getDeviceResourcePolicy({navigator:{userAgent:'iPhone',platform:'iPhone'}});
 assert.equal(new ClinicalFrameStore({resourcePolicy:policy}).maxBytes,64*1024*1024);
 const {store,workers}=storeFixture(16,policy),frames=[frame(0),frame(1),frame(2),frame(3)];
 store.warm({frames},0);assert.equal(workers.length,1);assert.equal(workers[0].message.sha256,frames[1].sha256);
 workers[0].finish(frames[1].bytes);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(workers.length,1);assert.equal(store.cacheBytes,8);
 store.warm({frames:frames.map(f=>({...f,decodedBytes:12}))},1);
 assert.equal(workers.length,1,'A neighbor too large to share the cache with the active phase should not be warmed.');
 store.dispose();
});

test('an oversized selected clinical frame is displayed unchanged without retaining an oversized cache entry',async()=>{
 const {store,workers}=storeFixture(8),f=frame(4,16),pending=store.load(f);
 workers[0].finish(f.bytes);assert.deepEqual(await pending,f.bytes);
 assert.equal(store.cacheBytes,0);assert.equal(store.cache.size,0);store.dispose();
});

const domEntry=process.argv[2];
test('actual clinical boot and paired echo transition work with native phase fixtures',{skip:!domEntry},async()=>{
 const {parseHTML}=await import(pathToFileURL(domEntry));
 const html=await readFile(new URL('page.html',root),'utf8');
 const {document,window}=parseHTML(html),draws=[],loads=[],timers=[];
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._testValue??this.querySelector('option[selected]')?.value??this.querySelector('option')?.value??'';},set(value){this._testValue=String(value);}});
 window.HTMLCanvasElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:400,height:300});
 window.HTMLCanvasElement.prototype.getContext=function(){
  const canvas=this;
  return {fillRect(){},save(){},restore(){},translate(){},scale(x,y){draws.push({id:canvas.id,flip:y===-1});},drawImage(...args){draws.push({id:canvas.id,args});},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){},putImageData(){},createImageData(width,height){return {data:new Uint8ClampedArray(width*height*4),width,height};}};
 };
 const fixture=structuredClone(manifest);
 for(const series of fixture.series){series.dimensions=[4,4,4];series.frames=series.frames.slice(0,series.modality==='US'?2:1).map(frame=>({...frame,decodedBytes:64}));}
 const source={kind:'clinical',id:'cmac-v1',specimen:'cMAC volunteer 1',label:'cMAC volunteer 1',manifestUrl:'/fixture/manifest.json',datasetUrl:manifest.source.url};
 class MockRenderer{
  constructor(canvas){this.canvas=canvas;this.settings={palette:4,clipAxis:-1,mode:0,threshold:.2};this.extent=[1,1,1];this.camera={yaw:0,pitch:0,roll:0,distance:1,pan:[0,0,0]};}
  load(data,meta){assert.equal(data.length,meta.dimensions.reduce((a,b)=>a*b,1));this.loaded=true;this.meta=meta;}
  set(values){Object.assign(this.settings,values);}clearCapData(){}reset(){}requestRender(){}alignPlane(){}view(){}
 }
 class MockAppearance{
  constructor({renderer}){this.renderer=renderer;}setWindowProfile(profile){this.renderer.set(profile);}sync(){}changed(){}
  paintSection(canvas,data,width,height){canvas.width=width;canvas.height=height;return canvas;}
 }
 class MockStore{
  constructor(){this.cache=new Map();}cached(frame){return this.cache.get(frame.url)||null;}
  async load(frame){const cached=this.cached(frame);if(cached)return cached;loads.push(frame.url);const data=Uint8Array.from({length:frame.decodedBytes},(_,i)=>(i+frame.index*40)%256);this.cache.set(frame.url,data);return data;}warm(){}dispose(){}
 }
 const fetcher=async url=>{assert.equal(url,source.manifestUrl);return new Response(JSON.stringify(fixture));};
 const code=(await readFile(new URL('public/clinical-app.js',root),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
 const boot=fixtureFunction('document','VolumeRenderer','AppearanceController','ResidentSectionSource','orthogonalFrame','ClinicalFrameStore','validateClinicalManifest','snapSectionPosition','donorUrl','fetch','location','ResizeObserver','requestAnimationFrame','setTimeout','clearTimeout','PALETTE_KEYS',code+'\nreturn bootClinicalPilot;')(
  document,MockRenderer,MockAppearance,ResidentSectionSource,orthogonalFrame,MockStore,validateClinicalManifest,snapSectionPosition,
  input=>new URL(input),fetcher,{href:'https://fixture.invalid/',hash:''},class{observe(){}},fn=>{queueMicrotask(fn);return 1;},fn=>{timers.push(fn);return timers.length;},()=>{},['ivory','copper','grayscale','porcelain','contrast','anatomy']);
 const api=await boot(source,{sources:[source]});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(document.getElementById('loading').hidden,true);assert.equal(api.renderer.loaded,true);
 assert.equal(loads.length,1,'Only the chosen volume should gate the first usable view.');
 assert.equal(document.getElementById('probeTab').hidden,true);assert.equal(document.getElementById('echoTab').hidden,false);
 assert(document.getElementById('aboutDialog').textContent.includes('Tobon-Gomez'));
 await api.chooseSeries('ultrasound');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(api.renderer.settings.palette,2);assert.equal(api.renderer.settings.clipPosition,snapSectionPosition(.5,4));
 assert(draws.some(draw=>draw.id==='sliceY'&&draw.flip),'Native US cards should have conventional apex-up orientation.');
 document.getElementById('echoTab').dispatchEvent(new window.Event('click'));
 for(let i=0;i<20&&!document.getElementById('clinicalPairNote')?.textContent;i++)await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setImmediate(resolve));
 assert(document.getElementById('reconstructionWorkspace').classList.contains('clinical-paired'));
 assert(document.getElementById('clinicalPairNote').textContent.includes('not spatially registered or phase-synchronized'));
 assert(loads.some(url=>url.includes('/ultrasound/')));
 assert.notEqual(document.getElementById('clinicalSeries').value,'ultrasound','Pair mode should place MRI beside ultrasound.');
 document.getElementById('reconstructionTab').dispatchEvent(new window.Event('click'));
 assert.equal(document.getElementById('pairedClinicalEcho').hidden,true);
});
