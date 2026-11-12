import test from 'node:test';
import assert from 'node:assert/strict';
import {EchoModule} from '../public/echo.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const plane={center:[.02,-.04,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.4,height:.36};
const pixels=p=>{
 const width=Math.ceil(p.width*10000/79.4)+1,height=Math.ceil(p.height*10000/79.4)+1;
 return {plane:p,width,height,data:new Uint8Array(width*height).fill(157),complete:true,cleaned:true,sourceSpacingUm:79.4,spacingUm:79.4,preparedReference:true};
};
function fixture(t,{modified=false,cleanup=true,match=true,deferPreview=false,outside=false}={}){
 t.mock.timers.enable({apis:['setTimeout']});t.mock.method(console,'warn',()=>{});
 const elements=new Map(),prepared=[],fine=[],previews=[],caps=[];
 const element=key=>{
  if(!elements.has(key))elements.set(key,{dataset:{},hidden:false,textContent:'',focus(){},scrollIntoView(){},close(){}});
  return elements.get(key);
 };
 const cache={expectedSource:{sourceKey:'source-one'},initCalls:0,pauseCalls:0,
  init:async()=>{cache.initCalls++;},match:()=>match,
  load(request,options){const work=pending();prepared.push({request,options,...work});return work.promise;},pause(){cache.pauseCalls++;}};
 const renderer={extent:[1,1,1],settings:{cleanupEnabled:cleanup},set(values){Object.assign(this.settings,values);},
  clearCapData(){this.cap=null;},setCapData(value){this.cap=value;caps.push(value);},requestRender(){}};
 const echo=Object.assign(Object.create(EchoModule.prototype),{
  donor:{id:'ladaf-2021-17'},longestMm:10,fineSpacingUm:79.4,fineLabel:'79.4 µm',sourceSpacingUm:317.6,
  active:true,requestId:0,renderer,referenceSections:cache,referenceGallery:null,
  state:{mode:'tte',preset:'plax_av',planeReference:'refined',offsetMm:modified?.2:0,rotationDeg:0,tiltDeg:0,flip:false,leftView:'3d',lockCamera:false},
  frames:{plax_av:{...structuredClone(plane),atlasDerived:true,outsideScan:outside},plax_mv:{...structuredClone(plane),center:[-.12,.01,.03],atlasDerived:true}},
  presetTextures:{},textureCache:{pause(){}},
  fineSource:{samplePlane(p,options){const work=pending();fine.push({plane:p,options,...work});return work.promise;}},
  ensureSampler(){return {sample(p){const work=pending();previews.push({plane:p,...work});if(!deferPreview)work.resolve({width:8,height:6,data:new Uint8Array(48).fill(80)});return work.promise;}};},
  anatomyContext:()=>null,updateCine(){},updateCorrespondence(){},updateProbe(){},drawSection(){},clearSection(){},message(){},stopCine(){},
  mount:{querySelector:element},$:element,
 });
 const advance=async ms=>{t.mock.timers.tick(ms);await tick();};
 const start=async()=>{echo.applyPlane(false,true);await advance(25);};
 t.after(()=>echo.leave());return {echo,cache,renderer,element,prepared,fine,previews,caps,advance,start};
}

test('prepared full face and CT load together; face can display first without losing the CT crop',async t=>{
 const f=fixture(t);await f.start();assert.equal(f.prepared.length,2);assert.equal(f.fine.length,0);
 assert.deepEqual(f.prepared.map(x=>x.request.role),['face','ct']);
 const [face,ct]=f.prepared;assert.notDeepEqual(face.request.plane,ct.request.plane);
 face.resolve(pixels(face.request.plane));await tick();
 assert.equal(f.renderer.cap.data,f.echo.cutFaceSample.data);assert.match(f.element('resolution').textContent,/79\.4.*Ultra/);
 const cap=f.renderer.cap,original=structuredClone(f.echo.plane);
 ct.resolve(pixels(ct.request.plane));await tick();
 assert.equal(f.echo.sample.plane,ct.request.plane);assert.equal(f.renderer.cap.data,cap.data);
 assert.deepEqual(f.renderer.settings.oblique,original);assert.equal(f.fine.length,0);
 assert.equal(f.element('resolution').dataset.source,'prepared-reference');assert.equal(f.element('resolution').dataset.faceCoverage,'full');
 assert.equal(f.echo.fineController,null);assert.equal(f.echo.pendingFineToken,null);
});

test('prepared CT alone does not label the larger cut face Ultra',async t=>{
 const f=fixture(t);await f.start();const [face,ct]=f.prepared;
 ct.resolve(pixels(ct.request.plane));await tick();
 assert.match(f.element('resolution').textContent,/Preview/);assert.doesNotMatch(f.element('resolution').textContent,/Ultra/);
 face.resolve(pixels(face.request.plane));await tick();assert.match(f.element('resolution').textContent,/Ultra/);
});

test('late resident preview cannot replace prepared pixels',async t=>{
 const f=fixture(t,{deferPreview:true});await f.start();
 for(const p of f.prepared)p.resolve(pixels(p.request.plane));await tick();
 const ct=f.echo.sample,cap=f.renderer.cap,count=f.caps.length;
 f.previews[0].resolve({width:8,height:6,data:new Uint8Array(48)});await tick();
 assert.equal(f.echo.sample,ct);assert.equal(f.renderer.cap,cap);assert.equal(f.caps.length,count);
});

test('a failed prepared face falls back to exact fine sampling without resampling the ready CT crop',async t=>{
 const f=fixture(t);await f.start();const [face,ct]=f.prepared;
 ct.resolve(pixels(ct.request.plane));face.reject(new Error('network unavailable'));await tick();await f.advance(160);
 assert.equal(f.fine.length,1);assert.equal(f.fine[0].plane,f.echo.cutFacePlane);assert.equal(f.fine[0].options.exactRaster,true);
 const saved=f.echo.sample;f.fine[0].resolve(pixels(f.fine[0].plane));await tick();
 assert.equal(f.echo.sample,saved);assert.equal(f.element('retry-detail').hidden,true);assert.match(f.element('resolution').textContent,/Ultra/);
});

test('a failed CT crop can recover without replacing or resampling a ready full face',async t=>{
 const f=fixture(t);await f.start();const [face,ct]=f.prepared;
 face.resolve(pixels(face.request.plane));ct.reject(new Error('corrupt pixels'));await tick();await f.advance(160);
 assert.equal(f.fine.length,1);assert.equal(f.fine[0].plane,f.echo.plane);const data=f.renderer.cap.data;
 f.fine[0].resolve(pixels(f.fine[0].plane));await tick();
 assert.equal(f.fine.length,1);assert.equal(f.renderer.cap.data,data);assert.equal(f.echo.cutFaceSample.preparedReference,true);
});

test('a moved view cancels both prepared requests and rejects late completions',async t=>{
 const f=fixture(t);await f.start();const old=[...f.prepared];
 f.echo.state.preset='plax_mv';f.echo.applyPlane(false,true);assert.equal(old[0].options.signal.aborted,true);await f.advance(25);
 const fresh=f.prepared.slice(2);for(const p of fresh)p.resolve(pixels(p.request.plane));await tick();
 const ct=f.echo.sample,cap=f.renderer.cap,count=f.caps.length;
 for(const p of old)p.resolve(pixels(p.request.plane));await tick();
 assert.equal(f.echo.sample,ct);assert.equal(f.renderer.cap,cap);assert.equal(f.caps.length,count);assert.equal(f.fine.length,0);
});

test('an exact-geometry cache miss uses the existing measured fine path',async t=>{
 const f=fixture(t,{match:false});await f.start();await f.advance(160);
 assert.equal(f.prepared.length,0);assert.equal(f.fine.length,1);assert.equal(f.fine[0].options.exactRaster,true);
});

test('failed prepared lookup and fine fallback settle both pending indicators',async t=>{
 const f=fixture(t,{match:false});await f.start();
 assert.equal(f.echo.facePendingToken,null,'Prepared face work has settled before the fine CT fallback begins.');
 await f.advance(160);assert.equal(f.fine.length,1);
 f.fine[0].reject(new Error('fine source unavailable'));await tick();
 assert.equal(f.echo.pendingFineToken,null);assert.equal(f.echo.facePendingToken,null);assert.equal(f.echo.fineController,null);
 assert.equal(f.element('retry-detail').hidden,false);assert.match(f.element('resolution').textContent,/Preview.*detail unavailable/);
 assert.doesNotMatch(f.element('resolution').textContent,/refining/);
});

test('a failed CT fallback retains the ready full face without a stale refining label',async t=>{
 const f=fixture(t);await f.start();const [face,ct]=f.prepared;
 face.resolve(pixels(face.request.plane));ct.reject(new Error('prepared crop unavailable'));await tick();
 const cap=f.renderer.cap;await f.advance(160);assert.equal(f.fine.length,1);
 f.fine[0].reject(new Error('fine source unavailable'));await tick();
 assert.equal(f.renderer.cap,cap);assert.equal(f.echo.cutFaceSample.preparedReference,true);
 assert.equal(f.echo.pendingFineToken,null);assert.equal(f.echo.facePendingToken,null);assert.equal(f.echo.fineController,null);
 assert.match(f.element('resolution').textContent,/Ultra.*detail unavailable/);assert.doesNotMatch(f.element('resolution').textContent,/refining/);
 assert.equal(f.element('retry-detail').hidden,false);
});

for(const options of [{modified:true},{cleanup:false},{outside:true}])test(`prepared default sections are not reused for ${Object.keys(options)[0]}`,async t=>{
 const f=fixture(t,options);await f.start();await f.advance(160);assert.equal(f.cache.initCalls,0);assert.equal(f.prepared.length,0);
 if(options.modified)assert.equal(f.fine.length,1);else assert.equal(f.fine.length,0);
 if(options.outside)assert.match(f.element('resolution').textContent,/outside scan/);
});

test('a prepared response with a displaced plane is rejected before display',async t=>{
 const f=fixture(t);await f.start();const [face,ct]=f.prepared;
 const wrong={...face.request.plane,center:[.25,0,.5]};face.resolve(pixels(wrong));ct.resolve(pixels(ct.request.plane));await tick();await f.advance(160);
 assert.equal(f.echo.cutFaceSample,null);assert.equal(f.fine.length,1);assert.match(f.element('resolution').textContent,/Preview/);
});
