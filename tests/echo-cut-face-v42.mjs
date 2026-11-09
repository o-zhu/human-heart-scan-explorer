/** Focused whole-cut regression checks using actual Echo lifecycle methods.
 * Browser/GPU appearance is covered by separate native and visual evidence.
 * Only external services, DOM/canvas sinks and time are controlled here; the
 * production plane, cap, CT painting, cancellation, CPU and picking code runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {EchoModule} from '../public/echo.js';
import {fullEchoCutFacePlane,validateEchoFineSection} from '../public/echo-cut-face.js';
import {CPUVolumeRenderer} from '../public/cpu-renderer.js';
import {pickVolume} from '../public/volume-picking.js';
import {clipPlane} from '../public/planes.js';
import * as styles from '../public/render-styles.js';
import {buildAcceleration,validAcceleration} from '../public/render-v5-acceleration.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const roi={center:[.08,-.04,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.40,height:.36};
const fineSpacingUm=79.4,sourceSpacingUm=317.6,longestMm=10;
function fineFrame(request,overrides={}){
 const plane=structuredClone(request.plane||request),width=Math.ceil(plane.width*longestMm*1000/fineSpacingUm)+1,height=Math.ceil(plane.height*longestMm*1000/fineSpacingUm)+1;
 return {data:Uint8Array.from({length:width*height},(_,i)=>70+(i*17%150)),width,height,plane,
  spacingUm:fineSpacingUm,sourceSpacingUm:fineSpacingUm,complete:true,cleaned:true,...overrides};
}
const coarseFrame=()=>({data:Uint8Array.from({length:48},(_,i)=>90+i),width:8,height:6});

function fixture(t,{prepared=false,deferCoarse=false,plane=roi,modified=false,cleanup=true}={}){
 t.mock.timers.enable({apis:['setTimeout']});
 const fineRequests=[],coarseRequests=[],caps=[],painted=[],warnings=[];
 t.mock.method(console,'warn',(...args)=>warnings.push(args));
 const oldImageData=globalThis.ImageData;
 globalThis.ImageData=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
 t.after(()=>{if(oldImageData===undefined)delete globalThis.ImageData;else globalThis.ImageData=oldImageData;});
 const elements=new Map(),context={putImageData(image){painted.push(image);},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}};
 const element=key=>{
  if(!elements.has(key))elements.set(key,{dataset:{},hidden:false,textContent:'',width:0,height:0,clientWidth:640,clientHeight:560,
   classList:{toggle(){}},setAttribute(k,v){this[k]=String(v);},getAttribute(k){return this[k];},getContext:()=>context,close(){}});
  return elements.get(key);
 };
 const viewButtons=['3d','ct'].map(view=>Object.assign(element('view-'+view),{dataset:{echoView:view}}));
 const renderer={extent:[1,1,1],settings:{...styles.DEFAULT_WINDOW_SETTINGS,palette:4,threshold:.28,cleanupEnabled:cleanup,capContrast:1.8},
  camera:{distance:1.55},canvas:{getBoundingClientRect:()=>({width:640,height:560})},alignPlane(){},set(values){Object.assign(this.settings,values);},requestRender(){},
  clearCapData(){this.cap=null;},setCapData(cap){this.cap=cap;caps.push(cap);}};
 const echo=Object.assign(Object.create(EchoModule.prototype),{
  active:false,destroyed:false,requestId:0,renderer,donor:{},sourceSpacingUm,fineSpacingUm,fineLabel:'79.4 µm',longestMm,
  state:{preset:'plax_av',mode:'tte',offsetMm:modified?0.2:0,rotationDeg:0,tiltDeg:0,flip:false,lockCamera:false,leftView:'3d',ctNative:false},
  frames:{plax_av:{...structuredClone(plane),atlasDerived:!prepared},plax_mv:{...structuredClone(plane),center:[-.06,.03,.10],atlasDerived:true}},
  presetTextures:prepared?{plax_av:{url:'./controlled-prepared.webp'}}:{},
  fineSource:{samplePlane(p,options){const pending=deferred();fineRequests.push({plane:p,options,...pending});return pending.promise;}},
  textureCache:{pause(){},peek(){return prepared?fineFrame(plane,{ultra:true,encodedBytes:1024}):null;}},
  loadPresetTexture:async()=>null,prefetchNeighbors(){},anatomyContext:()=>null,
  updateCine(){},updateCorrespondence(){},updateProbe(){},updateUI(){},updateAppearance(){},loadMediaCatalog(){},stopCine(){},
  mount:{hidden:true,querySelector(selector){return element(selector);},querySelectorAll(){return viewButtons;}},
  $:element,
  ensureSampler(){return {sample(p,options){const pending=deferred();coarseRequests.push({plane:p,options,...pending});if(!deferCoarse)pending.resolve(coarseFrame());return pending.promise;}};},
 });
 t.after(()=>echo.leave());
 const advance=async ms=>{t.mock.timers.tick(ms);await tick();};
 const start=async()=>{echo.enter();await advance(25);await advance(135);};
 const finishRoi=async(value)=>{const request=fineRequests[0];request.resolve(value||fineFrame(request));await tick();return request;};
 return {echo,renderer,element,fineRequests,coarseRequests,caps,painted,warnings,advance,start,finishRoi};
}

test('complete cut rectangle preserves a shifted/reflected ROI and the physical plane',()=>{
 const plane={...structuredClone(roi),right:[-1,0,0],up:[0,-1,0]},snapshot=structuredClone(plane);
 const face=fullEchoCutFacePlane(plane,[1,1,.8],{paddingWorld:.002});
 assert.deepEqual(plane,snapshot,'The original CT crop must be immutable.');
 assert.deepEqual(face.right,plane.right);assert.deepEqual(face.up,plane.up);assert.deepEqual(face.normal,plane.normal);
 assert.ok(Math.abs(face.center[2]-plane.center[2])<1e-12);
 for(const x of [-.5,.5])for(const y of [-.5,.5]){
  assert.ok(Math.abs((x-face.center[0])*face.right[0])<face.width/2);
  assert.ok(Math.abs((y-face.center[1])*face.up[1])<face.height/2);
 }
 const broad={...roi,width:1.4,height:1.4};
 assert.equal(fullEchoCutFacePlane(broad,[1,1,1]),broad,'An already complete crop needs no second raster.');
});

test('actual Echo lifecycle refines a separate full face while CT pixels and crop stay unchanged',async t=>{
 const f=fixture(t);await f.start();
 assert.equal(f.fineRequests.length,1);const request=f.fineRequests[0],accepted=f.echo.plane,face=f.echo.cutFacePlane;
 assert.notEqual(face,accepted);assert.equal(f.renderer.settings.oblique,accepted);
 assert.equal(request.plane,accepted);assert.equal(request.options.exactRaster,true);
 assert.equal(request.options.spacingUm,fineSpacingUm);assert.equal(request.options.persistSection,true);
 assert.match(f.element('resolution').textContent,/317\.6.*Preview/);
 f.echo.setLeftView('ct');assert.match(f.element('resolution').textContent,/Preview.*refining/);
 assert.equal(f.element('retry-detail').hidden,true);f.echo.setLeftView('3d');
 const pixels=fineFrame(request);await f.finishRoi(pixels);
 assert.equal(f.fineRequests.length,2);const full=f.fineRequests[1],ct=f.echo.sample;
 assert.equal(full.plane,face);assert.equal(full.options.exactRaster,true);assert.equal(full.options.persistSection,true);
 assert.equal(full.options.signal,request.options.signal,'The same controller must cancel both phases.');
 assert.match(f.element('resolution').textContent,/317\.6.*Preview/);
 assert.doesNotMatch(f.element('resolution').textContent,/Ultra/,'A fine crop alone is not a complete Ultra face.');
 f.echo.setLeftView('ct');
 const initialPaint=f.painted.at(-1),initialCanvas=[f.element('mpr').width,f.element('mpr').height],ctHash=Buffer.from(ct.data).toString('hex');
 assert.match(f.element('resolution').textContent,/79\.4.*Ultra/,'The measured CT crop has already completed.');
 assert.doesNotMatch(f.element('resolution').textContent,/refining/,'A separate full-face request must not make the completed CT crop appear pending.');
 full.resolve(fineFrame(full));await tick();
 assert.equal(f.echo.sample,ct);assert.equal(f.echo.sample.plane,accepted);
 assert.equal(Buffer.from(ct.data).toString('hex'),ctHash);assert.deepEqual([f.element('mpr').width,f.element('mpr').height],initialCanvas);
 assert.equal(f.painted.at(-1),initialPaint,'Full-face completion must not repaint the CT canvas with a larger crop.');
 assert.equal(f.renderer.cap.plane,face);assert.equal(f.renderer.cap.data,f.echo.cutFaceSample.data);
 assert.equal(f.renderer.settings.oblique,accepted,'The clipping plane still belongs to the original acquisition.');
 f.echo.setLeftView('3d');assert.match(f.element('resolution').textContent,/79\.4.*Ultra/);
 assert.equal(f.element('resolution').dataset.faceCoverage,'full');assert.equal(f.element('retry-detail').hidden,true);
});

test('cached prepared crop remains Preview until its separate complete face arrives',async t=>{
 const f=fixture(t,{prepared:true});f.echo.enter();
 const ct=f.echo.sample;assert.equal(ct.ultra,true);assert.equal(f.coarseRequests.length,0);
 assert.match(f.element('resolution').textContent,/317\.6.*Preview/);assert.doesNotMatch(f.element('resolution').textContent,/Ultra/);
 await f.advance(160);assert.equal(f.fineRequests.length,1);
 const full=f.fineRequests[0];assert.equal(full.plane,f.echo.cutFacePlane);assert.equal(full.options.exactRaster,true);
 full.resolve(fineFrame(full));await tick();
 assert.equal(f.echo.sample,ct);assert.match(f.element('resolution').textContent,/79\.4.*Ultra/);
});

test('an already complete ROI avoids a duplicate full-face request',async t=>{
 const f=fixture(t,{plane:{...roi,width:1.4,height:1.4}});await f.start();
 assert.equal(f.echo.cutFacePlane,f.echo.plane);await f.finishRoi();
 assert.equal(f.fineRequests.length,1);assert.match(f.element('resolution').textContent,/79\.4.*Ultra/);
});

test('adjusted planes request exact ROI and face rasters without persisting an arbitrary view',async t=>{
 const f=fixture(t,{modified:true});await f.start();await f.finishRoi();
 for(const request of f.fineRequests){assert.equal(request.options.exactRaster,true);assert.equal(request.options.persistSection,false);}
 assert.equal(f.fineRequests.length,2);
});

test('a late current-plane coarse sample cannot replace either completed fine raster',async t=>{
 const f=fixture(t,{deferCoarse:true});await f.start();assert.equal(f.coarseRequests.length,1);
 await f.finishRoi();const full=f.fineRequests[1];full.resolve(fineFrame(full));await tick();
 const ct=f.echo.sample,cap=f.renderer.cap,count=f.caps.length;
 f.coarseRequests[0].resolve(coarseFrame());await tick();
 assert.equal(f.echo.sample,ct);assert.equal(f.renderer.cap,cap);assert.equal(f.caps.length,count);
});

test('changing views aborts old fine/face work and ignores late fine and coarse responses',async t=>{
 const f=fixture(t,{deferCoarse:true});await f.start();await f.finishRoi();
 const staleFace=f.fineRequests[1],oldToken=f.echo.requestId;
 f.echo.state.preset='plax_mv';f.echo.applyPlane(false,true);
 assert.equal(staleFace.options.signal.aborted,true);assert.ok(f.echo.requestId>oldToken);
 await f.advance(160);const newRoi=f.fineRequests[2];assert.notDeepEqual(newRoi.plane.center,staleFace.plane.center);
 newRoi.resolve(fineFrame(newRoi));await tick();const newFace=f.fineRequests[3];newFace.resolve(fineFrame(newFace));await tick();
 const currentCap=f.renderer.cap,currentCt=f.echo.sample,count=f.caps.length;
 staleFace.resolve(fineFrame(staleFace));f.coarseRequests[0].resolve(coarseFrame());await tick();
 assert.equal(f.coarseRequests.length,2,'The coalesced current preview runs only after the old one returns.');
 f.coarseRequests[1].resolve(coarseFrame());await tick();
 assert.equal(f.renderer.cap,currentCap);assert.equal(f.echo.sample,currentCt);assert.equal(f.caps.length,count);
 assert.equal(f.element('retry-detail').hidden,true);
});

test('an obsolete ROI completion cannot install stale pixels or launch its own full-face request',async t=>{
 const f=fixture(t);await f.start();const staleRoi=f.fineRequests[0];
 f.echo.state.preset='plax_mv';f.echo.applyPlane(false,true);assert.equal(staleRoi.options.signal.aborted,true);
 await f.advance(160);const currentRoi=f.fineRequests[1];currentRoi.resolve(fineFrame(currentRoi));await tick();
 const full=f.fineRequests[2],cap=f.renderer.cap,ct=f.echo.sample,count=f.caps.length;
 staleRoi.resolve(fineFrame(staleRoi));await tick();
 assert.equal(f.fineRequests.length,3);assert.equal(f.renderer.cap,cap);assert.equal(f.echo.sample,ct);assert.equal(f.caps.length,count);
 full.resolve(fineFrame(full));await tick();assert.equal(f.renderer.cap.plane,full.plane);
});

test('leaving cancels full-face sampling; a late response cannot revive a hidden view',async t=>{
 const f=fixture(t);await f.start();await f.finishRoi();const late=f.fineRequests[1],count=f.caps.length;
 f.echo.leave();assert.equal(late.options.signal.aborted,true);assert.equal(f.renderer.cap,null);
 late.resolve(fineFrame(late));await tick();assert.equal(f.caps.length,count);assert.equal(f.echo.cutFaceSample,null);
 f.echo.enter();await f.advance(160);assert.equal(f.fineRequests.length,3,'Re-entry starts fresh work.');
 assert.match(f.element('resolution').textContent,/Preview/);assert.equal(f.element('retry-detail').hidden,true);
});

const invalidFrames={
 incomplete:request=>fineFrame(request,{complete:false}),
 relabelled:request=>{const frame=fineFrame(request);frame.plane={...frame.plane,width:frame.plane.width+.01};return frame;},
 malformed:request=>fineFrame(request,{data:new Uint8Array(3)}),
};
for(const [name,makeInvalid] of Object.entries(invalidFrames))for(const phase of ['ROI','face']){
 test(`${phase} rejects ${name} fine frames and leaves a clearly labelled Preview with retry`,async t=>{
  const f=fixture(t);await f.start();if(phase==='face')await f.finishRoi();
  const request=f.fineRequests.at(-1),priorCap=f.renderer.cap,priorCt=f.echo.sample,count=f.caps.length;
  request.resolve(makeInvalid(request));await tick();
  assert.equal(f.renderer.cap,priorCap);assert.equal(f.echo.sample,priorCt);assert.equal(f.caps.length,count);
  assert.equal(f.echo.cutFaceSample,null);assert.match(f.element('resolution').textContent,/Preview.*detail unavailable/);
  assert.doesNotMatch(f.element('resolution').textContent,/Ultra/);assert.equal(f.element('retry-detail').hidden,false);
  assert.equal(f.warnings.length,1);assert.equal(f.echo.fineController,null);
  f.echo.setLeftView('ct');
  if(phase==='ROI'){
   assert.match(f.element('resolution').textContent,/Preview.*detail unavailable/);
   assert.equal(f.element('retry-detail').hidden,false,'A failed CT section needs a visible retry.');
  }else{
   assert.match(f.element('resolution').textContent,/Ultra/);
   assert.doesNotMatch(f.element('resolution').textContent,/unavailable|refining/);
   assert.equal(f.element('retry-detail').hidden,true,'A face-only failure must not imply that the completed CT image failed.');
  }
 });
}

test('full-face network failure preserves the current source and a retry can complete successfully',async t=>{
 const f=fixture(t);await f.start();await f.finishRoi();const failed=f.fineRequests[1],oldCap=f.renderer.cap;
 failed.reject(new Error('Controlled transport failure'));await tick();
 assert.equal(f.renderer.cap,oldCap);assert.match(f.element('resolution').textContent,/Preview.*detail unavailable/);
 assert.equal(f.element('retry-detail').hidden,false);
 const token=f.echo.requestId;f.echo.applyPlane(false,true);assert.ok(f.echo.requestId>token);
 await f.advance(160);assert.equal(f.element('retry-detail').hidden,true);
 const newRoi=f.fineRequests[2];newRoi.resolve(fineFrame(newRoi));await tick();
 const newFace=f.fineRequests[3];newFace.resolve(fineFrame(newFace));await tick();
 assert.match(f.element('resolution').textContent,/Ultra/);assert.doesNotMatch(f.element('resolution').textContent,/unavailable|Preview/);
 assert.equal(f.element('retry-detail').hidden,true);assert.equal(f.echo.faceError,false);
});

test('original-volume comparison never starts cleaned fine sampling',async t=>{
 const f=fixture(t,{cleanup:false});await f.start();
 assert.equal(f.fineRequests.length,0);assert.equal(f.renderer.cap.cleaned,false);
 assert.match(f.element('resolution').textContent,/317\.6.*Preview/);
});

test('fine validation rejects excessive dimensions, invalid spacing and a moved plane',()=>{
 const valid=fineFrame(roi);assert.equal(validateEchoFineSection(valid,roi),valid);
 for(const result of [
  {...valid,width:8193},
  {...valid,height:8193},
  {...valid,sourceSpacingUm:NaN},
  {...valid,spacingUm:0},
  {...valid,plane:{...valid.plane,center:[roi.center[0],roi.center[1],.1]}},
 ])assert.throws(()=>validateEchoFineSection(result,roi));
});

const cpuSource=readFileSync(new URL('../public/cpu-worker.js',import.meta.url),'utf8');
function cpuFixture({x=.30,blocked=false,cleaned=false,cleanupEnabled=true,inside=false}={}){
 const context=vm.createContext({clipPlane,...styles,buildAcceleration,validAcceleration,performance,setTimeout,
  Float32Array,Uint8Array,Uint8ClampedArray,onmessage:null,postMessage(){}});
 vm.runInContext(cpuSource.replace(/^import .*;\n/gm,''),context,{filename:'public/cpu-worker.js'});
 const n=9,data=new Uint8Array(n**3).fill(180),cleanup={data:new Uint8Array(n**3).fill(blocked?0:255),dimensions:[n,n,n]};
 const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.2,height:.2};
 const cap={data:new Uint8Array(4).fill(inside?220:20),width:2,height:2,plane,key:'controlled',cleaned};
 const point=[inside?0:x,0,0],basis={eye:[point[0],0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};
 const settings={...styles.DEFAULT_WINDOW_SETTINGS,mode:0,palette:4,quality:'auto',threshold:.28,opacity:.8,
  clipAxis:3,clipFlip:0,oblique:plane,showPlanes:0,cleanupEnabled,capContrast:1.8,slices:[.5,.5,.5]};
 context.onmessage({data:{type:'load',data:data.buffer,dimensions:[n,n,n]}});
 context.onmessage({data:{type:'cleanup',map:cleanup}});
 const messages=[],receiver={worker:{postMessage(message){messages.push(message);context.onmessage({data:message});}},requestRender(){}};
 CPUVolumeRenderer.prototype.setCapData.call(receiver,cap);
 const renderer={data,dimensions:[n,n,n],extent:[1,1,1],settings,cap:receiver.cap,cleanup,basis:()=>basis,
  canvas:{getBoundingClientRect:()=>({width:1,height:1})}};
 context.job={w:1,h:1,extent:[1,1,1],basis,settings,fast:false};context.point=point;
 return {context,messages,renderer,cap};
}

for(const scenario of [
 {name:'outside crop uses resident density',expected:180/255,cutFace:true},
 {name:'outside crop retains coarse support even for a cleaned image',blocked:true,cleaned:true,expected:0,cutFace:false},
 {name:'outside crop respects original-volume cleanup-off comparison',blocked:true,cleaned:true,cleanupEnabled:false,expected:180/255,cutFace:true},
 {name:'inside a cleaned prepared cap retains valid pixels rejected by coarse support',inside:true,blocked:true,cleaned:true,expected:220/255,cutFace:true},
 {name:'inside an uncleaned cap still applies coarse support',inside:true,blocked:true,cleaned:false,expected:0,cutFace:false},
]){
 test(`actual CPU worker and picking agree: ${scenario.name}`,async()=>{
  const f=cpuFixture(scenario),frame=await vm.runInContext('render(job,()=>false)',f.context);
  const density=vm.runInContext('capSample(point,job.extent)',f.context),picked=pickVolume(f.renderer,.5,.5);
  assert.equal(f.messages[0].cap.cleaned,scenario.cleaned===true,'CPUVolumeRenderer must forward cleaned provenance.');
  assert.ok(Math.abs(density-scenario.expected)<1e-12);
  if(scenario.cutFace){
   assert.equal(picked.cutFace,true);assert.ok(Math.abs(picked.value-scenario.expected)<1e-12);
   assert.ok(Math.abs(picked.world[2])<1e-12);assert.equal(frame.depths[0],2,'CPU output must hit the physical cap, not a later mesh surface.');
   assert.ok(frame.pixels[0]>100);
  }else{
   assert.equal(picked,null);assert.equal(frame.depths[0],Infinity);
  }
 });
}
