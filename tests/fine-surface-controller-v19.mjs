/** Optional fine-mesh lifecycle checks. No browser, network, asset decode or GPU. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {FineSurfacePass,FineSurfaceController,compactSurfaceEnabled} from '../public/fine-surface.js';
import {getDeviceResourcePolicy} from '../public/device-resources.js';
import {ActiveLoadWatchdog} from '../public/load-watchdog.js';
import {ScanActivity} from '../public/download-priority.js';

const domPath=process.argv[2];if(!domPath)throw new Error('Pass the installed LinkeDOM ESM entry point.');
const {parseHTML}=await import(pathToFileURL(domPath));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick();if(i%10===9)await new Promise(resolve=>setTimeout(resolve,1));}throw new Error('Expected lifecycle state was not reached.');}
const pageMarkup=readFileSync(new URL('../page.html',import.meta.url),'utf8');
const manifest={donorId:'ladaf-2021-17',sourceSpacingUm:79.4,extent:[1,1,1],threshold:.28,bounds:{min:[-.5,-.5,-.5],max:[.5,.5,.5]},
 lods:['balanced','detail'].map(id=>({id,label:id,triangles:1,vertices:2,url:'/fixture/'+id+'.hfm.gz',sha256:'a'.repeat(64),decodedBytes:68,compressedBytes:32}))};
const gentleManifest={...manifest,lods:[{...manifest.lods[0],id:'gentle',label:'Ultra-High Fidelity',url:'/fixture/gentle.hfm.gz'}]};
const decoded=()=>({buffer:new ArrayBuffer(68),vertexCount:2,indexCount:3,positionOffset:32,normalOffset:44,indexOffset:56});
const gentleProfileUrl=compactSurfaceEnabled?'./assets/display-compact-v29/surface-manifest.json':'./assets/fine-surface-v23/manifest.json';
const isSurfaceManifest=url=>String(url).includes('fine-surface')||String(url).includes('display-compact-v29/surface-manifest');

function gpu({failProgram=0,nullTexture=false,manualFences=false}={}){
 const live=new Set(),deleted=[],state={vao:null,contextLost:false,manualFences},events=[],fences=[];let sequence=0,programs=0;
 const resource=kind=>{const r={kind,id:++sequence};live.add(r);return r;};
 const destroy=r=>{if(r){live.delete(r);deleted.push(r);}};
 const gl={NO_ERROR:0,UNSIGNED_BYTE:5121,UNSIGNED_SHORT:5123,SHORT:5122,UNSIGNED_INT:5125,ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,STATIC_DRAW:35044,TEXTURE_2D:3553,
  SYNC_GPU_COMMANDS_COMPLETE:37143,ALREADY_SIGNALED:37146,CONDITION_SATISFIED:37148,TIMEOUT_EXPIRED:37147,WAIT_FAILED:37149,
  TEXTURE_MIN_FILTER:10241,TEXTURE_MAG_FILTER:10240,TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243,NEAREST:9728,CLAMP_TO_EDGE:33071,
  createVertexArray:()=>resource('vao'),bindVertexArray:vao=>{state.vao=vao;},createBuffer:()=>resource('buffer'),bindBuffer(){},bufferData(target,data){events.push({type:'bufferData',target,bytes:typeof data==='number'?data:data.byteLength});},bufferSubData(target,offset,data){events.push({type:'bufferSubData',target,offset,bytes:data.byteLength});},enableVertexAttribArray(){},vertexAttribPointer(){},
  fenceSync(){const fence=resource('sync');fence.signaled=!state.manualFences;fences.push(fence);return fence;},clientWaitSync:fence=>state.contextLost?37149:fence.signaled?37148:37147,deleteSync:destroy,flush(){events.push({type:'flush'});},isContextLost:()=>state.contextLost,
  getUniformLocation:(program,name)=>({program,name}),getError:()=>0,
  createTexture:()=>nullTexture?null:resource('texture'),createFramebuffer:()=>resource('framebuffer'),createRenderbuffer:()=>resource('renderbuffer'),bindTexture(){},texParameteri(){},
  deleteBuffer:destroy,deleteVertexArray:destroy,deleteProgram:destroy,deleteTexture:destroy,deleteFramebuffer:destroy,deleteRenderbuffer:destroy};
 const renderer={gl,uniforms:{volume:null},extent:[1,1,1],settings:{mode:0,threshold:.28,cleanupEnabled:true,showPlanes:0},
  data:new Uint8Array([3,19,126,252]),cap:{data:new Uint8Array([19,126]),width:2,height:1},
  createProgram(){if(++programs===failProgram)throw new Error('Fixture program allocation failed');return resource('program');},
  requestRender(reason){events.push({type:'render',reason});},set(patch){Object.assign(this.settings,patch);events.push({type:'settings',patch:{...patch}});}};
 return {renderer,live,deleted,state,events,fences,releaseFences(){for(const fence of fences)fence.signaled=true;}};
}

function environment(options={}){
 const {document,window}=parseHTML(pageMarkup);
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._testValue??this.querySelector('option')?.value??'';},set(value){this._testValue=String(value);}});
 const names=['document','fetch','Worker','location','localStorage','requestAnimationFrame'],previous=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const workers=[],notifications=[],fetches=[],preferences=options.preferences||new Map();
 Object.assign(globalThis,{localStorage:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value))},document,location:{href:options.url||'https://fixture.invalid/'},fetch:async url=>{
  fetches.push(url);if(options.fetch)return options.fetch(url);
  return new Response(JSON.stringify((String(url).includes('fine-surface-v23')||String(url).includes('display-compact-v29/surface-manifest'))?(options.gentleManifest||gentleManifest):(options.manifest||manifest)));
 },
  Worker:class{constructor(){this.messages=[];workers.push(this);}postMessage(message){if(options.failPostMessage)throw new Error('Fixture worker message failed');this.message=message;this.messages.push(message);}terminate(){this.terminated=true;}finish(message){this.onmessage({data:message});}}});
 if(options.requestAnimationFrame)globalThis.requestAnimationFrame=options.requestAnimationFrame;
 const context=gpu(options),mount=document.getElementById('fineSurfaceControls');
 context.renderer.canvas=document.getElementById('volumeCanvas');
 Object.assign(context.renderer.settings,options.settings);
 if(options.reconstructionHidden)document.getElementById('reconstructionPanel').hidden=true;
 mount.dataset.gentleReady=String(options.gentleReady!==false);
 if(options.downloadMb!==undefined)mount.dataset.gentleDownloadMb=String(options.downloadMb);
 document.getElementById('resolutionLabel').textContent='317.6 µm · 475 × 475 × 530';
 if(options.noGL)context.renderer.gl=null;
 const controller=new FineSurfaceController({renderer:context.renderer,donor:{id:options.donorId||'ladaf-2021-17'},mount,toast:message=>notifications.push(message),autoStart:options.autoStart??false,debrisLoader:options.debrisLoader||(async()=>null),streamDebrisLoader:options.streamDebrisLoader,resourcePolicy:options.resourcePolicy,watchdogFactory:options.watchdogFactory,activity:options.activity,stagingCleanup:options.stagingCleanup});
 // This suite isolates model selection/commit. Exact prepared-mask bytes and
 // graphics bindings are exercised by the reviewed-mask atlas integration suite.
 if(controller.localRefinement){
  controller.lumenCleanup.toggle.checked=true;context.renderer.lumenCleanup={fixture:true};
  context.renderer.settings.lumenCleanupEnabled=true;
  controller.localRefinement.ensure=options.ensureLocal||(async()=>{controller.localRefinement.current={manifest:{extent:[1,1,1]},pieces:[]};});
  controller.localRefinement.active=()=>!!controller.localRefinement.current&&context.renderer.fineSurface?.lod.id==='gentle'&&controller.workspaceActive;
 }
 const choose=id=>{controller.select.value=id;return controller.choose(id);};
 return {...context,controller,document,window,workers,notifications,fetches,preferences,choose,
  close(){controller.disconnectLifecycle?.();controller.revision++;controller.loadAbort?.abort();controller.loadWatchdog?.close();context.renderer.fineSurface?.dispose?.();for(const name of names){if(previous[name])Object.defineProperty(globalThis,name,previous[name]);else delete globalThis[name];}}};
}

// Padded HFM layout selects the >64 MiB controller pathway without allocating a
// full model. Actual bounded decoding/source hashes are covered by worker tests.
const streamedSourceSha='d'.repeat(64),streamedBytes=64*1024*1024+68;
const streamedLayout={vertexCount:2,indexCount:3,positionOffset:64*1024*1024+32,normalOffset:64*1024*1024+44,indexOffset:64*1024*1024+56,geometrySourceSha256:streamedSourceSha};
const streamedManifest=(compact=false)=>({...gentleManifest,lods:[{...gentleManifest.lods[0],decodedBytes:streamedBytes,decodedSha256:streamedSourceSha,...(compact?{compactTransport:{assetBaseUrl:'/api/display-compact-v29/mesh/',parts:[],decodedBytes:streamedBytes,decodedSha256:streamedSourceSha,sourceDecodedSha256:streamedSourceSha}}:{})}]});
const streamCleanup=async()=>({flags:new Uint8Array([0,0]),report:{fixture:true}});
function streamEnvironment(options={}){return environment({gentleManifest:streamedManifest(),streamDebrisLoader:streamCleanup,...options});}
function streamStarted(worker){return worker.messages.find(message=>message.type==='surface-ack'&&message.sequence===0);}
function streamAck(worker,sequence){return worker.messages.find(message=>message.type==='surface-ack'&&message.sequence===sequence);}
async function sendStreamStart(f,worker=f.workers.at(-1)){
 worker.finish({type:'surface-start',sequence:0,expectedBytes:streamedBytes,layout:streamedLayout});await until(()=>streamStarted(worker));
}
async function sendStreamGeometry(f,worker=f.workers.at(-1)){
 await sendStreamStart(f,worker);
 for(const [index,kind,values]of [[1,'position',new Uint16Array([0,0,0,65535,65535,65535])],[2,'normal',new Int16Array([0,0,32767,0,0,32767])],[3,'index',new Uint32Array([0,1,0])]]){
  worker.finish({type:'surface-chunk',sequence:index,kind,byteOffset:0,buffer:values.buffer});await until(()=>streamAck(worker,index));
 }
}
function sendStreamComplete(worker,patch={}){worker.finish({type:'surface-complete',vertexCount:2,indexCount:3,geometrySourceSha256:streamedSourceSha,debrisValidated:true,debrisFlags:new Uint8Array([0,0]),...patch});}
async function presentStreamedSurface(f){
 await until(()=>f.renderer.fineSurface?.lod.id==='gentle');const pass=f.renderer.fineSurface;
 assert.equal(typeof pass.onPresented,'function');const presented=pass.onPresented;pass.onPresented=null;presented();return pass;
}
function retainedCompact(f){const pass=new FineSurfacePass(f.renderer,decoded(),manifest,manifest.lods.find(lod=>lod.id==='detail'));f.renderer.fineSurface=pass;f.controller.sync();return pass;}

test('v47 desktop-identified iPad migrates legacy forced detail and progressively attempts complete Ultra',async()=>{
 const resourcePolicy=getDeviceResourcePolicy({navigator:{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',platform:'MacIntel',maxTouchPoints:5}});
 const preferences=new Map([['heart-explorer:surface:v25:ladaf-2021-17','gentle'],['heart-explorer:surface:mobile:v43:ladaf-2021-17','detail']]);
 const f=environment({resourcePolicy,preferences,autoStart:true});try{
  await until(()=>f.workers.length===1);
  assert.equal(f.controller.select.value,'detail');
  assert.equal(f.workers[0].message.url,'https://fixture.invalid/fixture/detail.hfm.gz');
  assert.ok(!f.fetches.some(url=>/display-compact|fine-surface-v23|cleanup-v30|reviewed-mask/.test(String(url))));
  assert.equal(f.controller.gentleOption.disabled,false);
  assert.equal(f.controller.gentleButton.querySelector('strong').textContent,'Ultra-High Fidelity');
  assert.equal(f.controller.compactButton.hidden,false);
  f.workers[0].finish(decoded());await f.controller.ready;
  assert.equal(f.renderer.fineSurface.lod.id,'detail');
  assert.equal(f.controller.localRefinement.current,null);
  assert.equal(preferences.get('heart-explorer:surface:v25:ladaf-2021-17'),'gentle','Automatic device adaptation preserves the saved desktop preference.');
  assert.equal(preferences.get(f.controller.preferenceKey),'auto','Only ambiguous legacy mobile intent is migrated; new choices use the v47 key.');
  const compact=f.renderer.fineSurface;
  await until(()=>f.workers.length===2);assert.equal(f.workers[1].message.url,'https://fixture.invalid/fixture/gentle.hfm.gz');
  assert.equal(f.workers[1].message.surfaceLookahead,false);assert.equal(f.workers[1].message.boundedSurfaceHash,true);assert.equal(f.renderer.fineSurface,compact);
  f.workers[1].finish(decoded());await f.controller.upgradeReady;
  assert.equal(f.renderer.fineSurface.lod.id,'gentle');assert.ok(f.controller.localRefinement.current);assert.match(f.controller.badge.textContent,/Ultra-High Fidelity/);
 }finally{f.close();}
});

test('v48 explicit Ultra on phones and known low-memory devices uses the acknowledged stream instead of a full CPU result',async()=>{
 for(const navigator of [{userAgent:'iPhone',platform:'iPhone'},{userAgent:'Android Mobile',deviceMemory:2},{userAgent:'Desktop',deviceMemory:4}]){
  const resourcePolicy=getDeviceResourcePolicy({navigator}),f=streamEnvironment({resourcePolicy});try{
   const pending=f.choose('gentle');await until(()=>f.workers.length===1);
   assert.equal(f.workers[0].message.expectedBytes,streamedBytes);assert.equal(f.workers[0].message.surfaceLookahead,false);assert.equal(f.workers[0].message.streamSurface,true);
   await sendStreamGeometry(f);sendStreamComplete(f.workers[0]);await presentStreamedSurface(f);await pending;
   assert.equal(f.renderer.fineSurface.lod.id,'gentle');assert.ok(f.controller.localRefinement.current);
   assert.equal(f.renderer.fineSurface.streamGeometry.ready,true);assert.ok(f.events.filter(event=>event.type==='bufferData').every(event=>event.bytes<1024));
   assert.equal(f.preferences.get(f.controller.preferenceKey),'gentle');
  }finally{f.close();}
 }
});

test('v47 legacy mobile volume stays opted out and new explicit compact choices override migration on later visits',async()=>{
 const resourcePolicy=getDeviceResourcePolicy({navigator:{userAgent:'iPhone',platform:'iPhone'}}),old='heart-explorer:surface:mobile:v43:ladaf-2021-17',current='heart-explorer:surface:mobile:v47:ladaf-2021-17';
 for(const [legacy,newValue,expected]of [['volume',undefined,'volume'],['detail','detail','detail'],['balanced','balanced','balanced'],['detail','volume','volume']]){
  const preferences=new Map([[old,legacy]]);if(newValue)preferences.set(current,newValue);
  const f=environment({resourcePolicy,preferences,autoStart:true});try{
   if(expected==='volume'){await f.controller.ready;assert.equal(f.workers.length,0);}
   else{await until(()=>f.workers.length===1);assert.equal(f.controller.select.value,expected);f.workers[0].finish(decoded());await f.controller.ready;}
   await tick();assert.equal(f.controller.upgradeReady,undefined);assert.equal(preferences.get(current),newValue||'volume');
   assert.equal(preferences.get(old),legacy,'Legacy provenance remains intact.');
  }finally{f.close();}
 }
});

test('v47 known low-memory mobile fresh visits and legacy balanced choices both attempt Ultra after the balanced intermediate',async()=>{
 const resourcePolicy=getDeviceResourcePolicy({navigator:{userAgent:'Android Mobile',deviceMemory:2,hardwareConcurrency:4}});
 for(const legacy of [undefined,'balanced']){
  const preferences=new Map(legacy?[['heart-explorer:surface:mobile:v43:ladaf-2021-17',legacy]]:[]),f=environment({resourcePolicy,preferences,autoStart:true});try{
   await until(()=>f.workers.length===1);assert.equal(f.controller.select.value,'balanced');f.workers[0].finish(decoded());await f.controller.ready;
   const compact=f.renderer.fineSurface;await until(()=>f.workers.length===2);assert.equal(f.controller.select.value,'gentle');assert.equal(f.renderer.fineSurface,compact);
   f.workers[1].finish(decoded());await f.controller.upgradeReady;assert.equal(f.renderer.fineSurface.lod.id,'gentle');
  }finally{f.close();}
 }
});

test('v47 recovery keeps the smaller cleaned pathway and saved Ultra intent without an automatic retry loop',async()=>{
 const resourcePolicy=getDeviceResourcePolicy({navigator:{userAgent:'iPhone'},recovery:true}),preferences=new Map([['heart-explorer:surface:mobile:v47:ladaf-2021-17','gentle']]);
 const f=environment({resourcePolicy,preferences,autoStart:true});try{
  await until(()=>f.workers.length===1);assert.equal(f.controller.select.value,'balanced');f.workers[0].finish(decoded());await f.controller.ready;await tick();
  assert.equal(f.workers.length,1);assert.equal(f.controller.upgradeReady,undefined);assert.equal(f.renderer.fineSurface.lod.id,'balanced');
  assert.equal(f.preferences.get(f.controller.preferenceKey),'gentle');assert.match(f.controller.gentleOption.textContent,/recovery mode/);
 }finally{f.close();}
});

test('v47 a complete sparse atlas is accepted while four-field cleanup is upgraded before any Ultra commit',async()=>{
 for(const count of [4,8]){
  const f=environment({resourcePolicy:getDeviceResourcePolicy({navigator:{userAgent:'iPhone'}})});let upgrades=0;
  f.renderer.lumenCleanup={sparseAtlas:{manifest:{fields:new Array(count)}}};
  f.controller.lumenCleanup.setEnabled=async()=>{upgrades++;f.renderer.lumenCleanup={sparseAtlas:{manifest:{fields:new Array(8)}}};};
  try{
   const pending=f.choose('gentle');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await pending;
   assert.equal(upgrades,count===4?1:0);assert.equal(f.renderer.fineSurface.lod.id,'gentle');assert.ok(f.controller.localRefinement.current);
  }finally{f.close();}
 }
});

test('v47 lab priority pauses full reviewed cleanup and resumes the same decoded Ultra over the cleaned intermediate',async()=>{
 const f=environment({resourcePolicy:getDeviceResourcePolicy({navigator:{userAgent:'iPhone'}}),autoStart:true}),signals=[];
 try{
  await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await f.controller.ready;const compact=f.renderer.fineSurface;
  f.renderer.lumenCleanup={sparseAtlas:{manifest:{fields:new Array(4)}}};
  f.controller.lumenCleanup.setEnabled=async(_enabled,{signal})=>{
   signals.push(signal);
   if(signals.length===1){await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return;}
   f.renderer.lumenCleanup={sparseAtlas:{manifest:{fields:new Array(8)}}};
  };
  await until(()=>f.workers.length===2);f.workers[1].finish(decoded());await until(()=>signals.length===1);
  f.controller.setWorkspaceActive(false);await until(()=>f.controller.workspaceWaiters.size===1);
  assert.equal(signals[0].aborted,true);assert.equal(f.renderer.fineSurface,compact);assert.equal(compact.enabled,true);assert.equal(f.controller.localRefinement.current,null);
  f.controller.setWorkspaceActive(true);await f.controller.upgradeReady;
  assert.equal(signals.length,2);assert.equal(f.workers.length,2);assert.equal(f.renderer.fineSurface.lod.id,'gentle');assert.equal(f.controller.finalCleanupAbort,null);
 }finally{f.close();}
});

test('v47 failed full cleanup leaves the actual compact cavity cleanup active and accurately labeled',async()=>{
 const f=environment({resourcePolicy:getDeviceResourcePolicy({navigator:{userAgent:'iPhone'}}),autoStart:true});
 try{
  await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await f.controller.ready;const compact=f.renderer.fineSurface;
  f.renderer.lumenCleanup={sparseAtlas:{manifest:{fields:new Array(4)}}};f.renderer.reviewedMaskAtlas={ready:true};
  f.controller.lumenCleanup.setEnabled=async()=>{f.controller.lumenCleanup.error='Fixture full atlas unavailable';};
  await until(()=>f.workers.length===2);f.workers[1].finish(decoded());await f.controller.upgradeReady;
  assert.equal(f.renderer.fineSurface,compact);assert.equal(f.renderer.settings.lumenCleanupEnabled,true);assert.equal(f.controller.lumenCleanup.compact,true);
  assert.equal(f.controller.refinementNotice.dataset.state,'active');assert.match(f.controller.refinementStatus.textContent,/masks are active on the smaller surface/);
  assert.equal(f.controller.retrySurface,'gentle');assert.match(f.controller.status.textContent,/Fixture full atlas unavailable/);assert.match(f.controller.badge.textContent,/Mobile Detail/);
 }finally{f.close();}
});

test('a failed installed mesh releases its graphics allocations before falling back to the volume',async()=>{
 const f=environment();try{
  const source=f.renderer.data,pending=f.choose('detail');await until(()=>f.workers.length===1);
  f.workers[0].finish(decoded());await pending;assert.ok(f.live.size>0);
  f.renderer.fineSurface.onError(new Error('The graphics device ran out of memory.'));
  assert.equal(f.renderer.fineSurface,null);assert.equal(f.live.size,0);
  assert.equal(f.controller.select.value,'volume');assert.equal(f.renderer.data,source);
  assert.match(f.controller.status.textContent,/Interactive Volume remains available/);
 }finally{f.close();}
});

test('switching back to the volume cancels preparation and ignores a late worker result',async()=>{
 const f=environment();try{
  const pending=f.choose('balanced');await until(()=>f.workers.length===1);
  await f.choose('volume');assert.equal(f.workers[0].terminated,true);
  f.workers[0].finish(decoded());await pending;
  assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);
  assert.match(f.controller.status.textContent,/Interactive Volume/);
 }finally{f.close();}
});

test('only the latest surface selection reaches the GPU and measured arrays remain unchanged',async()=>{
 const f=environment();try{
  const source=f.renderer.data.slice(),cap=f.renderer.cap,first=f.choose('balanced');await until(()=>f.workers.length===1);
  const next=f.choose('detail');await until(()=>f.workers.length===2);
  f.workers[0].finish(decoded());await first;assert.equal(f.live.size,0);
  f.workers[1].finish(decoded());await next;
  assert.equal(f.renderer.fineSurface.lod.id,'detail');assert.deepEqual(f.renderer.data,source);assert.equal(f.renderer.cap,cap);
  assert.equal(f.state.vao,null,'The scalar renderer retains its default screen-quad VAO.');
 }finally{f.close();}
});

test('late preparation must preserve settings changed after the surface selection',async()=>{
 const f=environment();try{
  const pending=f.choose('balanced');await until(()=>f.workers.length===1);
  const latest={mode:1,threshold:.42,cleanupEnabled:false,showPlanes:1};f.renderer.set(latest);
  f.workers[0].finish(decoded());await pending;
  for(const [key,value]of Object.entries(latest))assert.equal(f.renderer.settings[key],value,key+' reflects the newest user choice.');
  assert.equal(f.renderer.fineSurface.activeFor(f.renderer),false);
 }finally{f.close();}
});

test('a failed optional replacement retains the prior complete geometry and source',async()=>{
 const f=environment();try{
  f.renderer.fineSurface=new FineSurfacePass(f.renderer,decoded(),manifest,manifest.lods[0]);
  const pending=f.choose('detail');await until(()=>f.workers.length===1);const before=f.events.length;
  f.workers[0].finish({error:'Fixture download interrupted'});await pending;
  assert.equal(f.renderer.fineSurface.enabled,true);assert.equal(f.controller.select.value,'balanced');assert.match(f.controller.status.textContent,/Fixture download interrupted/);
  assert(f.events.slice(before).some(event=>event.type==='render'),'The fallback must schedule a repaint instead of leaving the old mesh image visible.');
 }finally{f.close();}
});

test('the high-fidelity model is committed only after its prepared interiors are ready',async()=>{
 let release;
 const f=environment({ensureLocal:()=>new Promise(resolve=>{release=()=>{f.controller.localRefinement.current={manifest:{extent:[1,1,1]},pieces:[]};resolve();};})});
 try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);
  f.workers[0].finish(decoded());await until(()=>typeof release==='function');
  assert.equal(f.renderer.fineSurface,undefined,'A partial base surface must not become the active model.');
  assert.equal(f.controller.badge.hidden,true);
  assert.match(f.controller.status.textContent,/finalized interior model/);
  release();await pending;
  assert.equal(f.renderer.fineSurface.lod.id,'gentle');
  assert.equal(f.controller.refinementNotice.hidden,true,'Successful completion does not leave a redundant refinement banner.');
 }finally{f.close();}
});

test('failed prepared interiors retain the usable volume and report the actual loading error',async()=>{
 const f=environment({ensureLocal:async()=>{f.controller.localRefinement.error='Fixture prepared model could not be loaded';}});
 try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);
  f.workers[0].finish(decoded());await pending;
  assert.equal(f.renderer.fineSurface,undefined);
  assert.equal(f.controller.badge.hidden,true);
  assert.equal(f.controller.select.value,'volume');
  assert.match(f.controller.status.textContent,/Fixture prepared model could not be loaded/);
  assert.equal(f.controller.refinementNotice.hidden,true);
 }finally{f.close();}
});

test('canceling while prepared interiors load cannot install a late high-fidelity model',async()=>{
 let release;
 const f=environment({ensureLocal:()=>new Promise(resolve=>{release=resolve;})});
 try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);
  f.workers[0].finish(decoded());await until(()=>typeof release==='function');
  await f.choose('volume');release();await pending;
  assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.controller.select.value,'volume');
  assert.equal(f.live.size,0);
 }finally{f.close();}
});

test('a partial constructor failure releases its already-created GPU resources',()=>{
 const f=gpu({failProgram:2});
 assert.throws(()=>new FineSurfacePass(f.renderer,decoded(),manifest,manifest.lods[0]),/allocation/);
 assert.equal(f.live.size,0,'The first compiled program must be released when the second fails.');
 assert.equal(f.state.vao,null);
});

test('failed optional target allocation does not install a partially allocated surface',()=>{
 const f=gpu({nullTexture:true});
 assert.throws(()=>new FineSurfacePass(f.renderer,decoded(),manifest,manifest.lods[0]),/allocation|target|surface|retain/i);
 assert.equal(f.live.size,0);assert.equal(f.state.vao,null);
});

test('an incompatible resident extent or scalar display mode cannot activate the fixed mesh',()=>{
 const f=gpu(),pass=new FineSurfacePass(f.renderer,decoded(),manifest,manifest.lods[0]);try{
  assert.equal(pass.activeFor(f.renderer),true);
  f.renderer.extent=[1,.99,1];assert.equal(pass.activeFor(f.renderer),false);
  f.renderer.extent=[1,1,1];
  for(const patch of [{threshold:.31},{mode:1},{cleanupEnabled:false},{showPlanes:1}]){
   f.renderer.settings={mode:0,threshold:.28,cleanupEnabled:true,showPlanes:0,...patch};assert.equal(pass.activeFor(f.renderer),false);
  }
 }finally{pass.dispose();}assert.equal(f.live.size,0);
});

test('opening settings itself does not download while automatic startup is disabled',async()=>{
 const f=environment({downloadMb:224.5});try{
  const settings=f.document.getElementById('viewerSettings'),shortcut=f.document.getElementById('openReconstructionDetail');
  assert.equal(settings.hasAttribute('open'),false);assert.equal(shortcut.hidden,false);
  assert.equal(f.controller.select.value,'volume');assert.equal(f.fetches.length,0);assert.equal(f.workers.length,0);
  assert.equal(f.controller.downloadSize.hidden,false);assert.equal(f.controller.downloadSize.textContent,'224.5 MB download','The static size is visible before any request.');
  assert.equal(settings.querySelector('.settings-grid>section').id,'fineSurfaceControls','The requested detail choice is first in Settings.');
  assert(f.controller.select.closest('details.fine-surface-comparison'),'Earlier surfaces stay in the comparison disclosure.');
  let focused=false,scrolled=false;
  f.controller.gentleButton.focus=()=>{focused=true;};f.controller.mount.scrollIntoView=()=>{scrolled=true;};
  shortcut.click();await tick();
  assert.equal(settings.open,true);assert.equal(shortcut.getAttribute('aria-expanded'),'true');assert(focused&&scrolled);
  assert.equal(f.fetches.length,0);assert.equal(f.workers.length,0);
  const nativeLink=f.controller.mount.querySelector('.native-detail-link');assert.equal(nativeLink.getAttribute('href'),'./whole-native.html');assert.match(nativeLink.textContent,/19.85 µm/);
 }finally{f.close();}
});

test('Detail exits fullscreen before opening Settings outside the workspace',async()=>{
 for(const prefixed of [false,true]){const f=environment();try{
  const settings=f.document.getElementById('viewerSettings'),workspace=f.document.getElementById('reconstructionWorkspace');
  assert.equal(workspace.contains(settings),false);
  f.document[prefixed?'webkitFullscreenElement':'fullscreenElement']=workspace;
  let release;f.document[prefixed?'webkitExitFullscreen':'exitFullscreen']=()=>new Promise(resolve=>{release=resolve;});
  const pending=f.controller.openSettings();
  assert.equal(settings.hasAttribute('open'),false);assert.equal(typeof release,'function');
  release();await pending;assert.equal(settings.open,true);assert.equal(f.fetches.length,0);
 }finally{f.close();}}
});

test('no-WebGL fallback keeps native navigation and disables fine-surface downloads',async()=>{
 const f=environment({noGL:true});try{
  assert.equal(f.controller.mount.hidden,false);assert.equal(f.controller.gentleButton.disabled,true);assert.equal(f.controller.select.disabled,true);
  assert(f.controller.mount.querySelector('.native-detail-link'));
  await f.controller.choose('gentle');await f.controller.choose('detail');
  assert.equal(f.controller.select.value,'volume');assert.equal(f.fetches.length,0);assert.equal(f.workers.length,0);assert.equal(f.live.size,0);
  assert.match(f.controller.status.textContent,/WebGL 2/);
 }finally{f.close();}
});

test('a different donor never presents or requests the LADAF fine surfaces',async()=>{
 const f=environment({donorId:'s-20-29'});try{
  assert.equal(f.controller.mount.hidden,true);assert.equal(f.controller.select,undefined);
  assert.equal(f.document.getElementById('openReconstructionDetail').hidden,true);
  await f.controller.choose('gentle');assert.equal(f.fetches.length,0);assert.equal(f.workers.length,0);
 }finally{f.close();}
});

test('gentle and polished requests keep their own metadata through a late response',async()=>{
 let releaseOld;
 const f=environment({fetch:url=>String(url).includes('v19')?new Promise(resolve=>{releaseOld=resolve;}):new Response(JSON.stringify(gentleManifest))});try{
  const old=f.choose('detail');await until(()=>typeof releaseOld==='function');
  const latest=f.choose('gentle');await until(()=>f.workers.length===1);
  assert.equal(f.workers[0].message.url,'https://fixture.invalid/fixture/gentle.hfm.gz');
  f.workers[0].finish(decoded());await latest;
  releaseOld(new Response(JSON.stringify(manifest)));await old;
  assert.equal(f.renderer.fineSurface.lod.id,'gentle');assert.deepEqual(f.renderer.fineSurface.manifest,gentleManifest);
  assert.deepEqual(f.fetches.filter(isSurfaceManifest),['./assets/fine-surface-v19/manifest.json',gentleProfileUrl]);
  assert.equal(f.workers.length,1,'The superseded metadata must not start a decoder.');
 }finally{f.close();}
});

test('the active source label tracks committed geometry and restores the current volume label',async()=>{
 const f=environment();try{
  const resolution=f.document.getElementById('resolutionLabel'),gentle=f.choose('gentle');await until(()=>f.workers.length===1);
  f.workers[0].finish(decoded());await gentle;
  assert.equal(resolution.hidden,true);assert.match(f.controller.badge.textContent,/Ultra-High Fidelity · 79.4 µm source/);
  assert.match(f.controller.baseVolumeNote.textContent,/Base volume: 317.6 µm/);
  const oldPass=f.renderer.fineSurface,next=f.choose('detail');await until(()=>f.workers.length===2);
  assert.equal(f.renderer.fineSurface,oldPass);assert.match(f.controller.badge.textContent,/Ultra-High Fidelity/,'A pending selection cannot relabel the current mesh.');
  f.workers[1].finish(decoded());await next;
  assert.match(f.controller.badge.textContent,/Compact Detail/);
  f.renderer.settings.mode=1;f.controller.sync();assert.equal(resolution.hidden,false);assert.equal(f.controller.badge.hidden,true);
  f.renderer.settings.mode=0;f.controller.sync();assert.equal(resolution.hidden,true);
  resolution.textContent='635.2 µm · preview';await f.choose('volume');
  assert.equal(resolution.hidden,false);assert.equal(resolution.textContent,'635.2 µm · preview');assert.equal(f.controller.badge.hidden,true);
  assert.match(f.controller.baseVolumeNote.textContent,/Base volume: 635.2 µm/);
 }finally{f.close();}
});

test('returning to a retained gentle mesh avoids another download and leaves scan arrays untouched',async()=>{
 const f=environment();try{
  const source=f.renderer.data.slice(),cap=f.renderer.cap,first=f.choose('gentle');await until(()=>f.workers.length===1);
  f.workers[0].finish(decoded());await first;const pass=f.renderer.fineSurface;
  await f.choose('volume');assert.equal(pass.enabled,false);await f.choose('gentle');
  assert.equal(f.renderer.fineSurface,pass);assert.equal(pass.enabled,true);assert.equal(f.workers.length,1);assert.equal(f.fetches.filter(isSurfaceManifest).length,1);
  assert.deepEqual(f.renderer.data,source);assert.equal(f.renderer.cap,cap);
  assert.equal(f.controller.gentleButton.getAttribute('aria-pressed'),'true');
 }finally{f.close();}
});

test('static publishing gate disables the new surface without a startup metadata request',async()=>{
 const f=environment({gentleReady:false});try{
  assert.equal(f.controller.gentleButton.disabled,true);assert.equal(f.controller.gentleOption.disabled,true);
  assert.match(f.controller.gentleButton.textContent,/being prepared/);
  await f.controller.choose('gentle');assert.equal(f.fetches.length,0);assert.equal(f.workers.length,0);
  const comparison=f.choose('detail');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await comparison;
  assert.equal(f.renderer.fineSurface.lod.id,'detail','The gate does not block previously published surfaces.');
 }finally{f.close();}
});

test('unavailable gentle metadata retains the working surface and starts no new worker',async()=>{
 const f=environment({gentleManifest:{available:false}});try{
  const old=f.choose('detail');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await old;
  const pass=f.renderer.fineSurface;await f.choose('gentle');
  assert.equal(f.renderer.fineSurface,pass);assert.equal(pass.enabled,true);assert.equal(f.workers.length,1);
  assert.equal(f.controller.select.value,'detail');assert.equal(f.controller.gentleButton.disabled,true);
  assert.match(f.controller.status.textContent,/being prepared/);
 }finally{f.close();}
});

test('multipart metadata forwards immutable part checksums and totals to the decoder',async()=>{
 const lod={...gentleManifest.lods[0],url:undefined,decodedSha256:'d'.repeat(64),parts:[{url:'./assets/gentle.part0',sha256:'b'.repeat(64),compressedBytes:16},{url:'https://cdn.invalid/gentle.part1',sha256:'c'.repeat(64),compressedBytes:16}]};
 const f=environment({gentleManifest:{...gentleManifest,lods:[lod]}});try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);const message=f.workers[0].message;
  assert.equal(message.url,undefined);assert.deepEqual(message.parts,lod.parts.map((part,i)=>({...part,url:i===0?'https://fixture.invalid/assets/gentle.part0':part.url})));
  assert.equal(message.sha256,lod.sha256);assert.equal(message.compressedBytes,32);assert.equal(message.expectedBytes,68);assert.equal(message.decodedSha256,lod.decodedSha256);
  f.workers[0].finish(decoded());await pending;assert.equal(f.renderer.fineSurface.lod.id,'gentle');
 }finally{f.close();}
});

test('download progress cannot install partial geometry or relabel a superseding request',async()=>{
 const f=environment();try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);const worker=f.workers[0];
  worker.finish({type:'progress',phase:'download',loadedBytes:16000000,totalBytes:48000000});
  assert.equal(worker.terminated,undefined);assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);
  assert.match(f.controller.status.textContent,/16.0 of 48.0 MB/);
  worker.finish({type:'progress',phase:'decode',loadedBytes:32,totalBytes:32});
  assert.equal(worker.terminated,undefined);assert.match(f.controller.loadStatus.textContent,/Loading and preparing surface/);
  assert.match(f.controller.loadStatus.textContent,/16.0 of 48.0 MB/);
  assert.notEqual(f.controller.loadProgress.getAttribute('value'),null);
  await f.choose('volume');const afterCancel=f.controller.status.textContent;
  worker.finish({type:'progress',phase:'download',loadedBytes:32000000,totalBytes:48000000});await pending;
  assert.equal(f.controller.status.textContent,afterCancel);assert.equal(f.renderer.fineSurface,undefined);
 }finally{f.close();}
});

test('invalid transport metadata and failed worker dispatch leave no live decoder',async()=>{
 const badManifest={...gentleManifest,lods:[{...gentleManifest.lods[0],parts:[{url:'http://['}]}]};
 for(const options of [{gentleManifest:badManifest},{failPostMessage:true}]){
  const f=environment(options);try{
   await f.choose('gentle');
   assert.equal(f.controller.worker,null);assert.equal(f.controller.select.value,'volume');assert.equal(f.controller.loading,false);
   assert(f.workers.every(worker=>worker.terminated));assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);
  }finally{f.close();}
 }
});

test('fresh startup loads Compact Detail behind the usable volume without changing restored settings',async()=>{
 const f=environment({autoStart:true,downloadMb:227.9});try{
  const restored={mode:1,threshold:.42,cleanupEnabled:false,showPlanes:1};f.renderer.set(restored);
  assert.equal(f.workers.length,0,'First usable view precedes optional work.');
  await until(()=>f.workers.length===1);
  assert.equal(f.controller.select.value,'detail');assert.equal(f.controller.loadPanel.hidden,false);
  assert.match(f.controller.loadTitle.textContent,/Compact Detail/);
  assert.equal(f.fetches.some(url=>url===gentleProfileUrl),false,'Fresh startup must not request the full Ultra manifest.');
  assert.match(f.controller.loadSource.textContent,/Showing: Interactive Volume/);
  const worker=f.workers[0];worker.finish({type:'progress',phase:'download',loadedBytes:16e6,totalBytes:48e6});
  assert.match(f.controller.loadStatus.textContent,/16.0 of 48.0 MB/);assert.ok(Math.abs(f.controller.loadProgress.value-.7/3)<1e-12);
  f.renderer.set({mode:2});worker.finish(decoded());await f.controller.ready;
  assert.equal(f.renderer.settings.mode,2,'A later module switch survives completion.');
  for(const key of ['threshold','cleanupEnabled','showPlanes'])assert.equal(f.renderer.settings[key],restored[key]);
  assert.equal(f.renderer.fineSurface.lod.id,'detail');assert.equal(f.renderer.fineSurface.activeFor(f.renderer),false);
  assert.equal(f.controller.loadPanel.hidden,true);assert.equal(f.controller.badge.hidden,true);
  assert.equal(f.renderer.settings.debrisCleanupEnabled,true);
 }finally{f.close();}
});

test('an explicit selection cancels the queued automatic default and persists across startup',async()=>{
 const preferences=new Map();let f=environment({autoStart:true,preferences});try{
  await f.choose('volume');await f.controller.ready;
  assert.equal(f.workers.length,0);assert.equal(f.fetches.length,0);
  assert.equal(preferences.get(f.controller.preferenceKey),'volume');
 }finally{f.close();}
 f=environment({autoStart:true,preferences});try{
  await f.controller.ready;assert.equal(f.controller.select.value,'volume');assert.equal(f.fetches.length,0);
  const reset=f.controller.resetDefaults();await until(()=>f.workers.length===1);
  f.workers[0].finish(decoded());await reset;
  assert.equal(f.renderer.fineSurface.lod.id,'detail');assert.equal(preferences.get(f.controller.preferenceKey),'auto');
  const retained=f.renderer.fineSurface;await f.choose('volume');await f.controller.resetDefaults();
  assert.equal(f.renderer.fineSurface,retained);assert.equal(retained.enabled,true);assert.equal(f.workers.length,1);
 }finally{f.close();}
});

test('the viewport cancellation button stops automatic loading without installing a late result',async()=>{
 const f=environment({autoStart:true});try{
  await until(()=>f.workers.length===1);const worker=f.workers[0];
  f.controller.loadPanel.querySelector('button').click();worker.finish(decoded());await f.controller.ready;
  assert.equal(worker.terminated,true);assert.equal(f.renderer.fineSurface,undefined);
  assert.equal(f.controller.loadPanel.hidden,true);assert.equal(f.controller.select.value,'volume');
  assert.equal(f.preferences.get(f.controller.preferenceKey),'volume');
 }finally{f.close();}
});

test('a verified debris attribute is committed before activation and comparison restores original components',async()=>{
 let releaseFilter,observed;
 const f=environment({debrisLoader:(lod,data,options)=>{observed={lod,data,options};return new Promise(resolve=>{releaseFilter=resolve;});}});try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await until(()=>releaseFilter);
  assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);assert.equal(f.controller.loading,true);
  observed.data.debrisReport={removedTriangles:1,removedComponents:1};releaseFilter(new Uint8Array([255,255]));await pending;
  const pass=f.renderer.fineSurface;assert.equal(pass.hasDebrisMask,true);assert.deepEqual(pass.debrisReport,observed.data.debrisReport);
  assert.equal(f.controller.debrisToggle.disabled,false);assert.equal(f.controller.debrisToggle.checked,true);
  f.controller.debrisToggle.checked=false;f.controller.debrisToggle.dispatchEvent(new f.window.Event('change'));
  assert.equal(f.renderer.settings.debrisCleanupEnabled,false);assert.equal(f.renderer.fineSurface,pass);
  assert.match(f.controller.debrisStatus.textContent,/Original detached components are visible/);
  f.controller.debrisToggle.checked=true;f.controller.debrisToggle.dispatchEvent(new f.window.Event('change'));
  assert.equal(f.renderer.settings.debrisCleanupEnabled,true);assert.equal(f.workers.length,1);
 }finally{f.close();}
});

test('cleanup failure keeps the usable volume instead of publishing an unfinished fine surface',async()=>{
 const f=environment({debrisLoader:async()=>{throw new Error('Fixture checksum mismatch');}});try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await pending;
  assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.controller.select.value,'volume');
  assert.equal(f.controller.badge.hidden,true);assert.equal(f.controller.debrisToggle.disabled,true);
  assert.match(f.controller.status.textContent,/prepared surface cleanup could not be loaded/);assert.match(f.controller.status.textContent,/Fixture checksum mismatch/);
  f.controller.sync();assert.equal(f.controller.loadPanel.hidden,false);assert.match(f.controller.loadStatus.textContent,/Fixture checksum mismatch/);
  await f.choose('volume');assert.equal(f.controller.loadPanel.hidden,true);
 }finally{f.close();}
});

test('cancelling while debris verification waits aborts transport and cannot commit a stale surface',async()=>{
 let releaseFilter,signal;
 const f=environment({debrisLoader:(_lod,_data,options)=>{signal=options.signal;return new Promise(resolve=>{releaseFilter=resolve;});}});try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await until(()=>releaseFilter);
  await f.choose('volume');assert.equal(signal.aborted,true);
  releaseFilter(new Uint8Array([0,0]));await pending;
  assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);assert.equal(f.controller.select.value,'volume');
 }finally{f.close();}
});

test('a worker completed immediately before a workspace switch cannot start cleanup or GPU installation',async()=>{
 let cleanupCalls=0,settled=false;
 const f=environment({debrisLoader:async()=>{cleanupCalls++;return new Uint8Array([0,0]);}});try{
  const pending=f.choose('gentle').then(()=>{settled=true;});await until(()=>f.workers.length===1);
  f.workers[0].finish(decoded());f.controller.setWorkspaceActive(false);
  await until(()=>f.controller.workspaceWaiters.size===1);
  assert.equal(settled,false);assert.equal(cleanupCalls,0);assert.equal(f.live.size,0);
  assert.equal(f.controller.loadPanel.hidden,true);assert.equal(f.renderer.fineSurface,undefined);
  f.controller.setWorkspaceActive(true);await pending;
  assert.equal(cleanupCalls,1);assert.equal(f.workers.length,1);assert.equal(f.renderer.fineSurface.lod.id,'gentle');
  assert.equal(f.controller.workspaceWaiters.size,0);
 }finally{f.close();}
});

test('completed cleanup remains in memory when priority changes before its GPU installation',async()=>{
 let cleanupCalls=0;
 const f=environment({debrisLoader:()=>({then(resolve){
  cleanupCalls++;resolve(new Uint8Array([0,0]));
  queueMicrotask(()=>f.controller.setWorkspaceActive(false));
 }})});try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());
  await until(()=>f.controller.workspaceWaiters.size===1);
  assert.equal(f.controller.debrisAbort,null,'Cleanup has finished before this workspace change.');
  assert.equal(f.live.size,0);assert.equal(f.renderer.fineSurface,undefined);assert.equal(cleanupCalls,1);
  f.controller.setWorkspaceActive(true);await pending;
  assert.equal(cleanupCalls,1,'The verified flags are retained instead of fetched again.');
  assert.equal(f.renderer.fineSurface.hasDebrisMask,true);assert.equal(f.controller.workspaceWaiters.size,0);
 }finally{f.close();}
});

test('leaving during cleanup aborts that transfer and resumes without another geometry download',async()=>{
 let cleanupCalls=0,firstSignal;
 const f=environment({debrisLoader:(_lod,_data,{signal})=>{
  if(++cleanupCalls===1){firstSignal=signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Paused','AbortError')),{once:true}));}
  return Promise.resolve(new Uint8Array([0,0]));
 }});try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await until(()=>firstSignal);
  f.controller.setWorkspaceActive(false);await until(()=>f.controller.workspaceWaiters.size===1);
  assert.equal(firstSignal.aborted,true);assert.equal(cleanupCalls,1);assert.equal(f.live.size,0);
  f.controller.setWorkspaceActive(true);await pending;
  assert.equal(cleanupCalls,2);assert.equal(f.workers.length,1);assert.equal(f.renderer.fineSurface.hasDebrisMask,true);
  assert.equal(f.renderer.fineSurface.cleanupWarning,null);assert.equal(f.controller.workspaceWaiters.size,0);
 }finally{f.close();}
});

test('canceling a workspace-paused selection releases its waiters and never resurrects it',async()=>{
 let cleanupCalls=0;
 const f=environment({debrisLoader:async()=>{cleanupCalls++;return null;}});try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());f.controller.setWorkspaceActive(false);
  await until(()=>f.controller.workspaceWaiters.size===1);await f.choose('volume');await pending;
  assert.equal(f.controller.workspaceWaiters.size,0);assert.equal(f.controller.loading,false);
  f.controller.setWorkspaceActive(true);await tick();
  assert.equal(cleanupCalls,0);assert.equal(f.live.size,0);assert.equal(f.renderer.fineSurface,undefined);
  assert.equal(f.controller.select.value,'volume');assert.deepEqual(f.notifications,[]);
 }finally{f.close();}
});

test('fresh default at the real 0.32 volume threshold activates Compact Detail at its fixed 0.28 threshold',async()=>{
 const f=environment({autoStart:true});try{
  f.renderer.settings.threshold=.32;
  await until(()=>f.workers.length===1);
  assert.equal(f.renderer.settings.threshold,.28);assert.equal(f.controller.selectedThreshold,.28);
  f.workers[0].finish(decoded());await f.controller.ready;
  assert.equal(f.renderer.fineSurface.activeFor(f.renderer),true);
  assert.equal(f.controller.badge.hidden,false);assert.match(f.controller.badge.textContent,/Compact Detail/);
  await f.choose('volume');assert.equal(f.controller.selectedThreshold,null);
 }finally{f.close();}
});

test('automatic startup preserves a bookmarked 0.32 threshold and an already-open module',async()=>{
 for(const saved of ['bookmark','module']){
  const f=environment({autoStart:true});try{
   f.renderer.settings.threshold=.32;
   if(saved==='bookmark')globalThis.location.href='https://fixture.invalid/#view=%7B%7D';
   else f.document.getElementById('reconstructionPanel').hidden=true;
   await until(()=>f.workers.length===1);assert.equal(f.renderer.settings.threshold,.32);
   f.workers[0].finish(decoded());await f.controller.ready;
   assert.equal(f.renderer.settings.threshold,.32);assert.equal(f.renderer.fineSurface.activeFor(f.renderer),false);
  }finally{f.close();}
 }
});

test('the dedicated reset restores the compact startup while camera integrations can retain the selected threshold',async()=>{
 const f=environment();try{
  await f.choose('volume');f.renderer.set({threshold:.42,mode:1,debrisCleanupEnabled:false});
  f.controller.mount.querySelector('.fine-detail-reset').click();await until(()=>f.workers.length===1);
  assert.equal(f.controller.selectedThreshold,.28);assert.equal(f.renderer.settings.threshold,.28);
  assert.equal(f.renderer.settings.mode,0);assert.equal(f.renderer.settings.debrisCleanupEnabled,true);
  f.workers[0].finish(decoded());await until(()=>!f.controller.loading);
  assert.equal(f.renderer.fineSurface.activeFor(f.renderer),true);
  assert.equal(f.preferences.get(f.controller.preferenceKey),'auto');
  assert(f.document.getElementById('nativeMainDetailMount'));
 }finally{f.close();}
});

test('compact transport keeps worker-verified geometry identity through GPU installation',async()=>{
 const compact={assetBaseUrl:'/api/display-compact-v29/mesh/',parts:[{path:'positions-00000000.hfc.gz',sha256:'b'.repeat(64),compressedBytes:16}],decodedBytes:68,decodedSha256:'c'.repeat(64)};
 const compactManifest={...gentleManifest,lods:[{...gentleManifest.lods[0],url:undefined,parts:undefined,compactTransport:compact,decodedSha256:compact.decodedSha256}]};
 const f=environment({gentleManifest:compactManifest});try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);
  assert.equal(f.workers[0].message.compact.parts[0].url,'https://fixture.invalid/api/display-compact-v29/mesh/positions-00000000.hfc.gz');
  const verified='175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae';
  f.workers[0].finish({...decoded(),geometrySourceSha256:verified});await pending;
  assert.equal(f.renderer.fineSurface.geometrySourceSha256,verified);
 }finally{f.close();}
});

test('a failed compact transport falls back to preserved original HFM without resetting newer view settings',async()=>{
 const compact={assetBaseUrl:'/api/display-compact-v29/mesh/',parts:[],decodedBytes:68,decodedSha256:'c'.repeat(64)};
 const compactManifest={...gentleManifest,lods:[{...gentleManifest.lods[0],compactTransport:compact,decodedSha256:compact.decodedSha256}]};
 const f=environment({gentleManifest:compactManifest});try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);
  f.controller.manifests.set('./assets/fine-surface-v23/manifest.json',Promise.resolve(gentleManifest));
  f.renderer.set({threshold:.43,mode:1});
  f.workers[0].finish({error:'Compact decoder unavailable'});await until(()=>f.workers.length===2);
  assert.equal(f.workers[1].message.compact,undefined);
  assert.equal(f.workers[1].message.url,'https://fixture.invalid/fixture/gentle.hfm.gz');
  f.workers[1].finish(decoded());await pending;
  assert.equal(f.renderer.settings.threshold,.43);assert.equal(f.renderer.settings.mode,1);
  assert.equal(f.renderer.fineSurface.lod.compactTransport,undefined);
 }finally{f.close();}
});

test('v47 an allocation or worker failure retains the mobile intermediate without retrying the larger source transport',async()=>{
 for(const fail of [worker=>worker.finish({error:'Array buffer allocation failed',resourceFailure:true}),worker=>worker.onerror(),worker=>worker.onmessageerror()]){
  const compact={assetBaseUrl:'/api/display-compact-v29/mesh/',parts:[],decodedBytes:68,decodedSha256:'c'.repeat(64)},compactManifest={...gentleManifest,lods:[{...gentleManifest.lods[0],compactTransport:compact,decodedSha256:compact.decodedSha256}]};
  const f=environment({resourcePolicy:getDeviceResourcePolicy({navigator:{userAgent:'iPhone'}}),gentleManifest:compactManifest,autoStart:true});try{
   await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await f.controller.ready;const intermediate=f.renderer.fineSurface,allocations=f.live.size;
   await until(()=>f.workers.length===2);fail(f.workers[1]);await f.controller.upgradeReady;
   assert.equal(f.workers.length,2);assert.equal(f.fetches.some(url=>url==='./assets/fine-surface-v23/manifest.json'),false);
   assert.equal(f.renderer.fineSurface,intermediate);assert.equal(f.live.size,allocations);assert.equal(f.controller.retrySurface,'gentle');assert.equal(f.controller.loadRetry.hidden,false);
  }finally{f.close();}
 }
});

test('cancelling during a lab-paused compact fallback cannot restart the original download',async()=>{
 const compact={assetBaseUrl:'/api/display-compact-v29/mesh/',parts:[],decodedBytes:68,decodedSha256:'c'.repeat(64)};
 const compactManifest={...gentleManifest,lods:[{...gentleManifest.lods[0],compactTransport:compact,decodedSha256:compact.decodedSha256}]};
 const f=environment({gentleManifest:compactManifest});try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);
  f.controller.setWorkspaceActive(false);
  f.workers[0].finish({error:'Compact transport interrupted'});
  await until(()=>f.controller.workspaceWaiters.size===1);
  await f.choose('volume');await pending;
  f.controller.setWorkspaceActive(true);await tick();
  assert.equal(f.workers.length,1);assert.equal(f.live.size,0);
  assert.equal(f.controller.select.value,'volume');assert.equal(f.controller.workspaceWaiters.size,0);
 }finally{f.close();}
});

function mobileCleanupEnvironment(options={}){
 const f=environment({resourcePolicy:getDeviceResourcePolicy({navigator:{userAgent:'iPhone',platform:'iPhone'}}),...options}),lumen=f.controller.lumenCleanup;
 lumen.toggle.disabled=false;lumen.toggle.checked=true;lumen.error=null;
 f.renderer.lumenCleanup=null;f.renderer.settings.lumenCleanupEnabled=false;
 f.controller.localRefinement.ensure=()=>{throw new Error('Mobile cleanup must not prepare the desktop replacement surfaces.');};
 const installed=()=>{lumen.toggle.checked=true;lumen.error=null;lumen.loading=false;f.renderer.lumenCleanup={sparseAtlas:{fixture:true}};f.renderer.reviewedMaskAtlas={ready:true};f.renderer.settings.lumenCleanupEnabled=true;};
 return {...f,lumen,installed};
}

test('Mobile Detail waits for reviewed cavity cleanup before committing its surface and retains masks in Echo',async()=>{
 const f=mobileCleanupEnvironment();let release,calls=0;
 f.lumen.setEnabled=async()=>{calls++;f.lumen.loading=true;await new Promise(resolve=>{release=resolve;});f.installed();};
 try{
  const pending=f.choose('detail');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await until(()=>release);
  assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);assert.match(f.controller.status.textContent,/reviewed cavity cleanup/);
  release();await pending;assert.equal(f.renderer.fineSurface.lod.id,'detail');assert.equal(f.controller.localRefinement.current,null);
  assert.equal(f.controller.refinementNotice.dataset.state,'active');assert.equal(f.controller.refinementNotice.hidden,true);
  const masks=f.renderer.lumenCleanup;f.controller.setWorkspaceActive(false);
  assert.equal(f.renderer.lumenCleanup,masks);assert.equal(f.renderer.settings.lumenCleanupEnabled,true);assert.equal(f.controller.refinementNotice.dataset.state,'active');
  f.controller.setWorkspaceActive(true);assert.equal(calls,1);assert.equal(f.workers.length,1);
 }finally{f.close();}
});

test('failed mobile cavity cleanup cannot publish an unclean prepared surface and a surface retry retries cleanup',async()=>{
 const f=mobileCleanupEnvironment();let calls=0;
 f.lumen.setEnabled=async()=>{if(++calls===1){f.lumen.error='Reviewed cavity checksum failed';f.lumen.toggle.checked=false;}else f.installed();};
 try{
  const first=f.choose('detail');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await first;
  assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);assert.match(f.controller.status.textContent,/Reviewed cavity checksum failed/);
  const retry=f.choose('detail');await until(()=>f.workers.length===2);f.workers[1].finish(decoded());await retry;
  assert.equal(calls,2);assert.equal(f.renderer.fineSurface.lod.id,'detail');assert.equal(f.renderer.settings.lumenCleanupEnabled,true);assert.equal(f.lumen.error,null);
 }finally{f.close();}
});

test('cancelling mobile cleanup before its surface commit aborts the request and ignores late completion',async()=>{
 const f=mobileCleanupEnvironment();let release,signal;
 f.lumen.setEnabled=async(_enabled,options)=>{signal=options.signal;await new Promise(resolve=>{release=resolve;});if(!signal.aborted)f.installed();};
 try{
  const pending=f.choose('detail');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await until(()=>release);
  await f.choose('volume');assert.equal(signal.aborted,true);release();await pending;
  assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.controller.select.value,'volume');assert.equal(f.live.size,0);assert.equal(f.controller.localRefinement.current,null);
 }finally{f.close();}
});

test('turning cleanup off during a workspace pause remains off when Mobile Detail resumes',async()=>{
 const f=mobileCleanupEnvironment();let calls=0,signal;
 f.lumen.setEnabled=async(_enabled,options)=>{calls++;signal=options.signal;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));};
 try{
  const pending=f.choose('detail');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await until(()=>signal);
  f.controller.setWorkspaceActive(false);await until(()=>f.controller.workspaceWaiters.size===1);
  f.lumen.toggle.checked=false;f.lumen.error=null;f.controller.setWorkspaceActive(true);await pending;
  assert.equal(calls,1);assert.equal(f.lumen.toggle.checked,false);assert.equal(f.renderer.settings.lumenCleanupEnabled,false);assert.equal(f.renderer.fineSurface.lod.id,'detail');
  assert.equal(f.controller.refinementNotice.dataset.state,'off');assert.equal(f.workers.length,1);
 }finally{f.close();}
});

test('mobile surface preparation follows a superseding explicit cleanup enable instead of reporting a false failure',async()=>{
 const f=mobileCleanupEnvironment(),operations=[];
 f.lumen.updateEnabled=async function(){const revision=++this.revision;this.toggle.checked=true;this.loading=true;await new Promise(resolve=>operations.push(()=>{if(revision===this.revision)f.installed();resolve();}));};
 try{
  const pending=f.choose('detail');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await until(()=>operations.length===1);
  const newer=f.lumen.setEnabled(true);assert.equal(operations.length,2);operations[0]();await tick();
  assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.controller.loading,true);assert.equal(f.lumen.error,null);
  operations[1]();await newer;await pending;assert.equal(f.renderer.fineSurface.lod.id,'detail');assert.equal(f.renderer.settings.lumenCleanupEnabled,true);
 }finally{f.close();}
});

test('a workspace change after mobile preparation resolves still blocks GPU installation until return',async()=>{
 const f=mobileCleanupEnvironment(),wait=f.controller.waitForWorkspace.bind(f.controller);let prepared=false,switched=false;
 f.controller.prepareMobileCleanup=async()=>{prepared=true;return true;};
 f.controller.waitForWorkspace=async(...args)=>{await wait(...args);if(prepared&&!switched){switched=true;queueMicrotask(()=>f.controller.setWorkspaceActive(false));}};
 try{
  const pending=f.choose('detail');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await until(()=>f.controller.workspaceWaiters.size===1);
  assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);
  f.controller.setWorkspaceActive(true);await pending;assert.equal(f.renderer.fineSurface.lod.id,'detail');assert.equal(f.workers.length,1);
 }finally{f.close();}
});

test('phone startup replaces the legacy volume default with an actually cleaned Mobile Detail surface',async()=>{
 for(const navigator of [
  {userAgent:'iPhone',platform:'iPhone'},
  {userAgent:'Mozilla/5.0 Macintosh',platform:'MacIntel',maxTouchPoints:5},
  {userAgent:'Android Mobile',deviceMemory:2},
 ]){
  const resourcePolicy=getDeviceResourcePolicy({navigator});
  const preferences=new Map([['heart-explorer:surface:v25:ladaf-2021-17','volume']]);
  const f=mobileCleanupEnvironment({resourcePolicy,preferences,autoStart:true,settings:{threshold:.32}});let release,cleanupCalls=0;
  f.lumen.setEnabled=async()=>{cleanupCalls++;await new Promise(resolve=>{release=resolve;});f.installed();};
  try{
   await until(()=>f.workers.length===1);
   assert.equal(f.controller.select.value,resourcePolicy.startupSurface);
   assert.equal(f.workers[0].message.url,'https://fixture.invalid/fixture/'+resourcePolicy.startupSurface+'.hfm.gz');
   assert.equal(f.renderer.settings.threshold,.28);
   f.workers[0].finish(decoded());await until(()=>release);
   assert.equal(f.renderer.fineSurface,undefined,'The smaller surface must wait for its cleanup too.');
   release();await f.controller.ready;
   assert.equal(cleanupCalls,1);assert.equal(f.renderer.fineSurface.activeFor(f.renderer),true);
   assert.equal(f.controller.compactButton.getAttribute('aria-pressed'),'true');
   assert.match(f.controller.badge.textContent,/Mobile Detail/);
   assert.equal(f.controller.refinementNotice.dataset.state,'active');
   assert.equal(f.controller.localRefinement.current,null);
   assert.equal(preferences.get('heart-explorer:surface:v25:ladaf-2021-17'),'volume');
  }finally{f.close();}
 }
});

test('a new explicit mobile choice persists separately without changing the desktop preference',async()=>{
 const resourcePolicy=getDeviceResourcePolicy({navigator:{userAgent:'iPhone',platform:'iPhone'}});
 const preferences=new Map([['heart-explorer:surface:v25:ladaf-2021-17','gentle']]);
 let f=environment({resourcePolicy,preferences,autoStart:true});
 try{
  await f.choose('volume');await f.controller.ready;
  assert.equal(f.workers.length,0);
  assert.equal(preferences.get(f.controller.preferenceKey),'volume');
  assert.equal(preferences.get('heart-explorer:surface:v25:ladaf-2021-17'),'gentle');
 }finally{f.close();}
 f=environment({resourcePolicy,preferences,autoStart:true});
 try{await f.controller.ready;assert.equal(f.controller.select.value,'volume');assert.equal(f.workers.length,0);}
 finally{f.close();}
});

test('the mobile default migration does not reset a low-memory desktop choice',async()=>{
 const resourcePolicy=getDeviceResourcePolicy({navigator:{userAgent:'Desktop',deviceMemory:2}});
 const preferences=new Map([['heart-explorer:surface:v25:ladaf-2021-17','volume']]);
 const f=environment({resourcePolicy,preferences,autoStart:true,settings:{threshold:.32}});
 try{
  await f.controller.ready;assert.equal(f.controller.select.value,'volume');assert.equal(f.workers.length,0);
  assert.equal(f.renderer.settings.threshold,.32);assert.equal(f.controller.preferenceKey,'heart-explorer:surface:v25:ladaf-2021-17');
 }finally{f.close();}
});

test('a mobile controller initialized in Echo or a Lab activates its untouched default on returning to Reconstruction',async()=>{
 const f=mobileCleanupEnvironment({autoStart:true,reconstructionHidden:true,settings:{threshold:.32}});let cleanupCalls=0;
 f.lumen.setEnabled=async()=>{cleanupCalls++;f.installed();};
 try{
  await until(()=>f.workers.length===1);assert.equal(f.workers[0].message.paused,true);
  assert.equal(f.renderer.settings.threshold,.32,'The lab keeps its own threshold.');
  f.renderer.set({threshold:.41});f.workers[0].finish(decoded());await until(()=>f.controller.workspaceWaiters.size===1);
  assert.equal(cleanupCalls,0);assert.equal(f.renderer.fineSurface,undefined);
  // app.switchTab restores the saved Reconstruction settings before signaling
  // the workspace change and unhides the panel afterward.
  f.renderer.set({threshold:.32});f.controller.setWorkspaceActive(true);
  f.document.getElementById('reconstructionPanel').hidden=false;
  await f.controller.ready;
  assert.equal(f.renderer.settings.threshold,.28);assert.equal(f.renderer.fineSurface.activeFor(f.renderer),true);
  assert.equal(cleanupCalls,1);assert.equal(f.workers.length,1);
  f.renderer.set({threshold:.37});f.controller.setWorkspaceActive(false);f.controller.setWorkspaceActive(true);
  assert.equal(f.renderer.settings.threshold,.37,'Default normalization happens only once.');
 }finally{f.close();}
});

test('returning to Reconstruction never normalizes a bookmarked or customized mobile view',async()=>{
 for(const options of [
  {url:'https://fixture.invalid/#view=%7B%7D',settings:{threshold:.32}},
  {settings:{threshold:.41}},
  {settings:{threshold:.32,mode:1}},
  {settings:{threshold:.32,cleanupEnabled:false}},
  {settings:{threshold:.32,showPlanes:1}},
 ]){
  const f=mobileCleanupEnvironment({autoStart:true,reconstructionHidden:true,...options});
  f.lumen.setEnabled=async()=>f.installed();
  try{
   await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await until(()=>f.controller.workspaceWaiters.size===1);
   f.controller.setWorkspaceActive(true);await f.controller.ready;
   for(const [key,value]of Object.entries(options.settings))assert.equal(f.renderer.settings[key],value);
   assert.equal(f.renderer.fineSurface.activeFor(f.renderer),false);
  }finally{f.close();}
 }
});

test('an explicit volume choice cancels the deferred mobile default before a Lab return',async()=>{
 const f=mobileCleanupEnvironment({autoStart:true,reconstructionHidden:true,settings:{threshold:.32}});
 try{
  await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await until(()=>f.controller.workspaceWaiters.size===1);
  await f.choose('volume');await f.controller.ready;f.controller.setWorkspaceActive(true);
  assert.equal(f.renderer.settings.threshold,.32);assert.equal(f.renderer.fineSurface,undefined);
  assert.equal(f.controller.select.value,'volume');assert.equal(f.workers.length,1);
 }finally{f.close();}
});

function surfaceWatchdogFixture(){
 let time=0,serial=0;const timers=new Map(),watchdogs=[],activity=[];
 const watchdogFactory=options=>{
  const watchdog=new ActiveLoadWatchdog({...options,idleMs:50,totalMs:300,now:()=>time,schedule:(fn,delay)=>{const id=++serial;timers.set(id,{fn,at:time+delay});return id;},cancel:id=>timers.delete(id)});
  const setActive=watchdog.setActive.bind(watchdog);watchdog.setActive=active=>{activity.push(active);setActive(active);};watchdogs.push(watchdog);return watchdog;
 };
 return {watchdogFactory,timers,watchdogs,activity,advance(ms){
  const target=time+ms;let count=0;
  for(;;){const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;assert.ok(++count<10000);const [id,timer]=next;timers.delete(id);time=timer.at;timer.fn();}
  time=target;
 }};
}
const unresolved=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function assertSurfaceTimedOut(f,time,id){
 assert.equal(f.controller.loading,false);assert.equal(f.controller.mount.getAttribute('aria-busy'),'false');assert.equal(f.controller.loadAbort,null);assert.equal(f.controller.loadWatchdog,null);assert.equal(f.controller.worker,null);
 assert.equal(f.controller.retrySurface,id);assert.equal(f.controller.loadRetry.hidden,false);assert.equal(f.controller.loadProgress.hidden,true);assert.equal(time.timers.size,0);
 assert.match(f.controller.status.textContent,/stopped responding/);
}

test('v45 a hung manifest settles on timeout, retains the complete current surface and exposes a working retry',async()=>{
 const time=surfaceWatchdogFixture(),blocked=unresolved();let requests=0;
 const f=environment({watchdogFactory:time.watchdogFactory,fetch:()=>++requests===1?blocked.promise:Promise.resolve(new Response(JSON.stringify(manifest)))});
 try{
  const retained=f.renderer.fineSurface=new FineSurfacePass(f.renderer,decoded(),manifest,manifest.lods[0]),allocations=f.live.size,source=f.renderer.data,cap=f.renderer.cap;
  const pending=f.choose('detail');await until(()=>requests===1);time.advance(50);await pending;
  assertSurfaceTimedOut(f,time,'detail');assert.equal(f.renderer.fineSurface,retained);assert.equal(retained.enabled,true);assert.equal(f.controller.select.value,'balanced');assert.equal(f.live.size,allocations);assert.equal(f.renderer.data,source);assert.equal(f.renderer.cap,cap);
  f.controller.loadRetry.click();await until(()=>f.workers.length===1);assert.equal(requests,2,'Retry fetches a fresh manifest instead of awaiting the stalled promise.');
  time.advance(40);blocked.resolve(new Response(JSON.stringify(gentleManifest)));await tick();assert.equal(f.renderer.fineSurface,retained);
  time.advance(10);await until(()=>!f.controller.loading);
  assertSurfaceTimedOut(f,time,'detail');assert.equal(f.workers[0].terminated,true,'Old response bytes must not extend the newer worker deadline.');
  f.controller.loadRetry.click();await until(()=>f.workers.length===2);
  f.workers[1].finish(decoded());await until(()=>!f.controller.loading);assert.equal(f.renderer.fineSurface.lod.id,'detail');assert.equal(f.controller.loadRetry.hidden,true);assert.equal(time.timers.size,0);
 }finally{f.close();}
});

test('v45 a stalled surface worker is terminated and cannot publish or relabel a late result',async()=>{
 const time=surfaceWatchdogFixture(),f=environment({watchdogFactory:time.watchdogFactory});
 try{
  const source=f.renderer.data,pending=f.choose('detail');await until(()=>f.workers.length===1);const worker=f.workers[0];
  time.advance(50);await pending;assertSurfaceTimedOut(f,time,'detail');assert.equal(worker.terminated,true);assert.equal(f.live.size,0);assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.renderer.data,source);
  const status=f.controller.status.textContent;worker.finish({type:'progress',phase:'download',loadedBytes:32,totalBytes:32});worker.finish(decoded());await tick();
  assert.equal(f.controller.status.textContent,status);assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);
 }finally{f.close();}
});

test('v48 a full download keeps one determinate progress bar during interior preparation and a stuck interior cannot install partial geometry',async()=>{
 const time=surfaceWatchdogFixture(),blocked=unresolved();let requested=false,signal;
 const f=environment({watchdogFactory:time.watchdogFactory,ensureLocal:options=>{requested=true;signal=options.signal;f.controller.localRefinement.loading=blocked.promise;return blocked.promise;}});
 try{
  // LinkeDOM does not reflect HTMLProgressElement.value into its attribute.
  // Reflect that browser property to exercise the real determinate attribute.
  const progress=f.controller.loadProgress;Object.defineProperty(progress,'value',{configurable:true,get(){return Number(this.getAttribute('value')||0);},set(value){this.setAttribute('value',String(value));}});
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);
  f.workers[0].finish({type:'progress',phase:'download',loadedBytes:32,totalBytes:32});assert.equal(progress.getAttribute('value'),'0.7');
  f.workers[0].finish(decoded());await until(()=>requested);assert.equal(progress.hasAttribute('value'),true);assert.equal(progress.value,.91);assert.match(progress.getAttribute('aria-valuetext'),/interior surfaces/);assert.match(f.controller.status.textContent,/finalized interior model/);
  assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);time.advance(50);await pending;
  assertSurfaceTimedOut(f,time,'gentle');assert.equal(signal.aborted,true);assert.equal(f.controller.localRefinement.loading,null);assert.equal(f.controller.localRefinement.current,null);assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);assert.equal(f.controller.loadCompact.hidden,false);
  blocked.resolve();await tick();assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);
 }finally{f.close();}
});

test('v45 a debris loader that ignores cancellation cannot leave surface preparation busy',async()=>{
 const time=surfaceWatchdogFixture(),blocked=unresolved();let signal;
 const f=environment({watchdogFactory:time.watchdogFactory,debrisLoader:(_lod,_data,options)=>{signal=options.signal;return blocked.promise;}});
 try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await until(()=>signal);
  time.advance(50);await pending;assertSurfaceTimedOut(f,time,'gentle');assert.equal(signal.aborted,true);assert.equal(f.controller.debrisAbort,null);assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);
  blocked.resolve(new Uint8Array([255,255]));await tick();assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);
 }finally{f.close();}
});

test('v45 timed-out reviewed cleanup settles the surface and clears its child loading state',async()=>{
 const time=surfaceWatchdogFixture(),blocked=unresolved(),f=mobileCleanupEnvironment({watchdogFactory:time.watchdogFactory});let requested;
 f.lumen.fetcher=(url,options)=>{requested={url,signal:options.signal};return blocked.promise;};
 try{
  const pending=f.choose('detail');await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await until(()=>requested);
  assert.equal(f.lumen.loading,true);assert.equal(f.live.size,0);time.advance(50);await pending;
  assertSurfaceTimedOut(f,time,'detail');assert.equal(requested.signal.aborted,true);assert.equal(f.controller.mobileCleanupAbort,null);assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);
  assert.equal(f.lumen.loading,false,'A stalled cleanup must not leave the refinement UI in loading state.');assert.equal(f.lumen.mount.getAttribute('aria-busy'),'false');
  blocked.resolve(new Response('{}',{status:503}));await tick();assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.live.size,0);
 }finally{blocked.resolve(new Response('{}',{status:503}));await tick();f.close();}
});

test('v45 switching into a lab pauses the actual watchdog and returning resumes the same decoded surface',async()=>{
 const time=surfaceWatchdogFixture(),f=environment({watchdogFactory:time.watchdogFactory});
 try{
  const pending=f.choose('detail');await until(()=>f.workers.length===1);time.advance(20);f.controller.setWorkspaceActive(false);
  assert.equal(time.watchdogs[0].active,false);assert.equal(time.timers.size,0);time.advance(600000);
  f.workers[0].finish(decoded());await until(()=>f.controller.workspaceWaiters.size===1);assert.equal(f.controller.loading,true);assert.equal(f.live.size,0);time.advance(600000);
  f.controller.setWorkspaceActive(true);assert.equal(time.watchdogs[0].active,true);await pending;
  assert.deepEqual(time.activity,[true,false,true]);assert.equal(f.renderer.fineSurface.lod.id,'detail');assert.equal(f.workers.length,1);assert.equal(f.controller.workspaceWaiters.size,0);assert.equal(time.timers.size,0);
 }finally{f.close();}
});

test('v46 a saved desktop Ultra preference starts compact then automatically upgrades',async()=>{
 const resourcePolicy=getDeviceResourcePolicy({navigator:{userAgent:'Desktop',deviceMemory:16,hardwareConcurrency:8}}),preferences=new Map([['heart-explorer:surface:v25:ladaf-2021-17','gentle']]);
 const f=environment({resourcePolicy,preferences,autoStart:true});
 try{
  assert.equal(f.controller.startupSurface,'detail');await until(()=>f.workers.length===1);assert.equal(f.controller.select.value,'detail');assert.equal(f.workers[0].message.url,'https://fixture.invalid/fixture/detail.hfm.gz');
  f.workers[0].finish(decoded());await f.controller.ready;const compact=f.renderer.fineSurface;assert.equal(compact.lod.id,'detail');
  await until(()=>f.workers.length===2);assert.equal(f.controller.select.value,'gentle');assert.equal(f.workers[1].message.url,'https://fixture.invalid/fixture/gentle.hfm.gz');assert.equal(f.renderer.fineSurface,compact);assert.equal(compact.enabled,true);
  f.workers[1].finish(decoded());await f.controller.upgradeReady;assert.equal(f.renderer.fineSurface.lod.id,'gentle');assert.ok(f.controller.localRefinement.current);assert.equal(preferences.get(f.controller.preferenceKey),'gentle');
 }finally{f.close();}
});

test('v46 a fresh desktop waits for compact reviewed cleanup before starting the full interior model',async()=>{
 const resourcePolicy=getDeviceResourcePolicy({navigator:{userAgent:'Desktop',deviceMemory:16,hardwareConcurrency:8}}),f=mobileCleanupEnvironment({resourcePolicy,autoStart:true,settings:{threshold:.32}});let release,calls=0;
 f.lumen.setEnabled=async()=>{calls++;await new Promise(resolve=>{release=resolve;});f.installed();};
 try{
  await until(()=>f.workers.length===1);assert.equal(f.controller.select.value,'detail');assert.equal(f.controller.lumenCleanup.compact,true);assert.equal(f.workers[0].message.url,'https://fixture.invalid/fixture/detail.hfm.gz');
  f.workers[0].finish(decoded());await until(()=>release);assert.equal(f.live.size,0);assert.equal(f.renderer.fineSurface,undefined);assert.equal(f.controller.localRefinement.current,null);
  assert.equal(f.fetches.some(url=>url===gentleProfileUrl||/fine-surface-v23|local-surface-refinement|cleanup-v30/.test(String(url))),false);
  release();await f.controller.ready;assert.equal(calls,1);assert.equal(f.renderer.fineSurface.lod.id,'detail');assert.equal(f.renderer.fineSurface.activeFor(f.renderer),true);assert.equal(f.renderer.settings.lumenCleanupEnabled,true);assert.equal(f.controller.refinementNotice.dataset.state,'active');assert.equal(f.controller.localRefinement.current,null);
 }finally{f.close();}
});

test('v46 a fresh default reaches Ultra automatically while the complete compact view remains visible',async()=>{
 let releaseInterior;
 const resourcePolicy=getDeviceResourcePolicy({navigator:{userAgent:'Desktop',deviceMemory:8,hardwareConcurrency:8}});
 const f=environment({autoStart:true,resourcePolicy,ensureLocal:()=>new Promise(resolve=>{releaseInterior=()=>{f.controller.localRefinement.current={manifest:{extent:[1,1,1]},pieces:[]};resolve();};})});
 try{
  await until(()=>f.workers.length===1);assert.equal(f.workers[0].message.url,'https://fixture.invalid/fixture/detail.hfm.gz');
  f.workers[0].finish(decoded());await f.controller.ready;const first=f.renderer.fineSurface;
  assert.equal(first.lod.id,'detail');assert.equal(f.controller.localRefinement.current,null);
  await until(()=>f.workers.length===2);assert.equal(f.controller.select.value,'gentle');
  assert.equal(f.workers[1].message.surfaceLookahead,true);assert.equal(f.renderer.fineSurface,first);assert.match(f.controller.loadSource.textContent,/Compact Detail/);
  f.workers[1].finish(decoded());await until(()=>releaseInterior);assert.equal(f.renderer.fineSurface,first);assert.equal(first.enabled,true);
  releaseInterior();await f.controller.upgradeReady;
  assert.equal(f.renderer.fineSurface.lod.id,'gentle');assert.equal(first.enabled,true,'The small fallback stays alive until the first complete Ultra draw.');
  f.renderer.fineSurface.onPresented();assert.equal(first.enabled,false);assert.equal(f.renderer.fineSurface.fallbackSurface,null);assert.match(f.controller.badge.textContent,/Ultra-High Fidelity/);
  assert.equal(f.preferences.get(f.controller.preferenceKey),undefined,'An automatic upgrade is not written as explicit user intent.');
 }finally{f.close();}
});

test('v46 choosing Compact Detail or volume after the first stage cancels the queued upgrade',async()=>{
 for(const choice of ['detail','volume']){
  const f=environment({autoStart:true});try{
   await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await f.controller.ready;
   await f.choose(choice);await f.controller.upgradeReady;
   assert.equal(f.workers.length,1);assert.equal(f.controller.select.value,choice);assert.equal(f.preferences.get(f.controller.preferenceKey),choice);
  }finally{f.close();}
 }
});

test('v46 a failed automatic Ultra upgrade retains compact geometry and exposes a bounded retry',async()=>{
 const f=environment({autoStart:true});try{
  await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await f.controller.ready;const first=f.renderer.fineSurface;
  await until(()=>f.workers.length===2);f.workers[1].finish({error:'Fixture Ultra transfer failed'});await f.controller.upgradeReady;
  assert.equal(f.renderer.fineSurface,first);assert.equal(first.enabled,true);assert.equal(f.controller.select.value,'detail');assert.equal(f.controller.retrySurface,'gentle');
  assert.equal(f.controller.loadRetry.hidden,false);assert.match(f.controller.status.textContent,/Fixture Ultra transfer failed/);
 }finally{f.close();}
});

test('v46 explicit saved smaller surface remains authoritative across fresh startup',async()=>{
 const preferences=new Map([['heart-explorer:surface:v25:ladaf-2021-17','balanced']]),f=environment({autoStart:true,preferences});
 try{
  await until(()=>f.workers.length===1);assert.equal(f.controller.select.value,'balanced');f.workers[0].finish(decoded());await f.controller.ready;await tick();
  assert.equal(f.workers.length,1);assert.equal(f.controller.upgradeReady,undefined);assert.equal(f.renderer.fineSurface.lod.id,'balanced');
 }finally{f.close();}
});

test('v46 first-draw Ultra failure restores the retained compact surface and releases Ultra allocations',async()=>{
 const f=environment({autoStart:true});try{
  await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await f.controller.ready;
  const compact=f.renderer.fineSurface,smallAllocations=f.live.size;
  await until(()=>f.workers.length===2);f.workers[1].finish(decoded());await f.controller.upgradeReady;
  const ultra=f.renderer.fineSurface;assert.equal(ultra.fallbackSurface,compact);assert.ok(f.live.size>smallAllocations);
  ultra.onError(new Error('Fixture first Ultra draw failed'));
  assert.equal(ultra.enabled,false);assert.equal(f.renderer.fineSurface,compact);assert.equal(compact.enabled,true);assert.equal(f.live.size,smallAllocations);
  assert.equal(f.controller.select.value,'detail');assert.equal(f.controller.retrySurface,'gentle');assert.match(f.controller.status.textContent,/Compact Detail remains available/);
 }finally{f.close();}
});

test('v46 browser startup gives Compact two real animation-frame opportunities before starting Ultra',async()=>{
 const frames=[],f=environment({autoStart:true,requestAnimationFrame:callback=>{frames.push(callback);return frames.length;}});
 try{
  await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await f.controller.ready;
  assert.equal(f.renderer.fineSurface.lod.id,'detail');assert.equal(frames.length,1);assert.equal(f.workers.length,1);
  frames.shift()();await tick();assert.equal(frames.length,1);assert.equal(f.workers.length,1);
  frames.shift()();await until(()=>f.workers.length===2);assert.equal(f.controller.select.value,'gentle');
  f.workers[1].finish(decoded());await f.controller.upgradeReady;assert.equal(f.renderer.fineSurface.lod.id,'gentle');
 }finally{f.close();}
});

test('v46 a choice between the two browser paint opportunities cancels automatic upgrading',async()=>{
 const frames=[],f=environment({autoStart:true,requestAnimationFrame:callback=>{frames.push(callback);return frames.length;}});
 try{
  await until(()=>f.workers.length===1);f.workers[0].finish(decoded());await f.controller.ready;
  frames.shift()();assert.equal(frames.length,1);await f.choose('detail');
  frames.shift()();await f.controller.upgradeReady;
  assert.equal(f.workers.length,1);assert.equal(f.renderer.fineSurface.lod.id,'detail');assert.equal(f.preferences.get(f.controller.preferenceKey),'detail');
 }finally{f.close();}
});

test('v48 visibility suspension pauses the same worker and active-time budget until the page is visible',async()=>{
 const time=surfaceWatchdogFixture(),f=environment({watchdogFactory:time.watchdogFactory});let visibility='visible';
 Object.defineProperty(f.document,'visibilityState',{configurable:true,get:()=>visibility});
 try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);const worker=f.workers[0],revision=f.controller.revision;
  worker.finish({type:'progress',phase:'download',loadedBytes:16,totalBytes:32});const value=f.controller.loadProgress.value;
  time.advance(20);visibility='hidden';f.document.dispatchEvent(new f.window.Event('visibilitychange'));
  assert.equal(f.controller.workspaceRequested,true);assert.equal(f.controller.workspaceActive,false);assert.equal(time.watchdogs[0].active,false);
  assert.deepEqual(worker.message,{type:'workspace-priority',paused:true});assert.equal(f.controller.loadPanel.hidden,true);
  time.advance(5000);assert.equal(f.controller.loading,true);assert.equal(worker.terminated,undefined);
  visibility='visible';f.document.dispatchEvent(new f.window.Event('visibilitychange'));
  assert.equal(f.controller.workspaceActive,true);assert.equal(time.watchdogs[0].active,true);assert.equal(f.controller.loadProgress.value,value);
  assert.equal(f.controller.revision,revision);assert.equal(f.workers.length,1);assert.deepEqual(worker.message,{type:'workspace-priority',paused:false});
  worker.finish(decoded());await pending;assert.equal(f.renderer.fineSurface.lod.id,'gentle');assert.equal(time.timers.size,0);
 }finally{f.controller.disconnectLifecycle();f.close();}
});

test('v48 page-cache restore cannot override the selected lab or begin a second Ultra job',async()=>{
 const time=surfaceWatchdogFixture(),f=environment({watchdogFactory:time.watchdogFactory});let visibility='visible';
 Object.defineProperty(f.document,'visibilityState',{configurable:true,get:()=>visibility});
 try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);const worker=f.workers[0],revision=f.controller.revision;
  f.window.dispatchEvent(new f.window.Event('pagehide'));assert.equal(f.controller.workspaceActive,false);
  f.document.dispatchEvent(new f.window.Event('visibilitychange'));assert.equal(f.controller.workspaceActive,false,'Visible alone does not override page-cache suspension.');
  f.controller.setWorkspaceActive(false);f.window.dispatchEvent(new f.window.Event('pageshow'));
  assert.equal(f.controller.workspaceRequested,false);assert.equal(f.controller.workspaceActive,false);assert.equal(time.watchdogs[0].active,false);
  time.advance(1000);assert.equal(f.controller.loading,true);assert.equal(f.workers.length,1);
  f.controller.setWorkspaceActive(true);assert.equal(f.controller.workspaceActive,true);assert.equal(f.controller.revision,revision);
  worker.finish(decoded());await pending;assert.equal(f.renderer.fineSurface.lod.id,'gentle');assert.equal(f.workers.length,1);
 }finally{f.controller.disconnectLifecycle();f.close();}
});

test('v48 a completed decode waits without GPU preparation while hidden and resumes without downloading again',async()=>{
 const time=surfaceWatchdogFixture(),f=environment({watchdogFactory:time.watchdogFactory});let visibility='visible';
 Object.defineProperty(f.document,'visibilityState',{configurable:true,get:()=>visibility});
 try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);
  visibility='hidden';f.document.dispatchEvent(new f.window.Event('visibilitychange'));f.workers[0].finish(decoded());
  await until(()=>f.controller.workspaceWaiters.size===1);assert.equal(f.live.size,0);assert.equal(f.renderer.fineSurface,undefined);
  time.advance(5000);assert.equal(f.controller.loading,true);assert.equal(f.controller.retrySurface,null);
  visibility='visible';f.document.dispatchEvent(new f.window.Event('visibilitychange'));await pending;
  assert.equal(f.renderer.fineSurface.lod.id,'gentle');assert.equal(f.workers.length,1);assert.equal(time.timers.size,0);
 }finally{f.controller.disconnectLifecycle();f.close();}
});

test('v48 cancellation while the page is suspended never resurrects loading on restore',async()=>{
 const f=environment();let visibility='visible';
 Object.defineProperty(f.document,'visibilityState',{configurable:true,get:()=>visibility});
 try{
  const pending=f.choose('gentle');await until(()=>f.workers.length===1);const worker=f.workers[0];
  visibility='hidden';f.document.dispatchEvent(new f.window.Event('visibilitychange'));await f.choose('volume');await pending;
  visibility='visible';f.document.dispatchEvent(new f.window.Event('visibilitychange'));f.window.dispatchEvent(new f.window.Event('pageshow'));
  worker.finish({type:'progress',phase:'download',loadedBytes:32,totalBytes:32});worker.finish(decoded());await tick();
  assert.equal(f.controller.loading,false);assert.equal(f.controller.select.value,'volume');assert.equal(f.controller.loadPanel.hidden,true);
  assert.equal(f.workers.length,1);assert.equal(f.live.size,0);assert.equal(f.renderer.fineSurface,undefined);
 }finally{f.controller.disconnectLifecycle();f.close();}
});

test('v48 a streamed chunk is acknowledged only after its GPU fence and workspace gate complete',async()=>{
 const f=streamEnvironment({manualFences:true});try{
  const compact=retainedCompact(f),baseline=f.live.size,pending=f.choose('gentle');await until(()=>f.workers.length===1);const worker=f.workers[0];
  await sendStreamStart(f,worker);const message={type:'surface-chunk',sequence:1,kind:'position',byteOffset:0,buffer:new ArrayBuffer(12)};worker.finish(message);
  await until(()=>f.fences.length===1);assert.equal(streamAck(worker,1),undefined);assert.equal(f.renderer.fineSurface,compact);assert.equal(compact.enabled,true);
  f.controller.setWorkspaceActive(false);f.releaseFences();await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(streamAck(worker,1),undefined,'A signaled GPU fence cannot override foreground lab priority.');
  f.controller.setWorkspaceActive(true);await until(()=>streamAck(worker,1));
  assert.equal(worker.messages.filter(item=>item.type==='surface-ack'&&item.sequence===1).length,1);assert.equal(message.buffer,null,'The main-thread chunk reference is released before the next acknowledgement.');
  await f.choose('volume');await pending;assert.equal(f.renderer.fineSurface,compact);assert.equal(compact.enabled,false);assert.equal(f.live.size,baseline);
 }finally{f.close();}
});

test('v48 streamed Ultra keeps the same loading bar and compact fallback until its first GPU presentation finishes',async()=>{
 const f=streamEnvironment();try{
  const compact=retainedCompact(f),pending=f.choose('gentle');await until(()=>f.workers.length===1);const progress=f.controller.loadProgress;
  await sendStreamGeometry(f);sendStreamComplete(f.workers[0]);await until(()=>f.renderer.fineSurface?.lod.id==='gentle');const ultra=f.renderer.fineSurface;
  assert.equal(f.controller.loading,true);assert.equal(f.controller.loadPanel.hidden,false);assert.equal(f.controller.loadProgress,progress);assert.equal(progress.hidden,false);assert.equal(progress.value,.99);
  assert.equal(ultra.fallbackSurface,compact);assert.equal(compact.enabled,true);
  f.state.manualFences=true;const fenceCount=f.fences.length;await presentStreamedSurface(f);await until(()=>f.fences.length===fenceCount+1);
  assert.equal(f.controller.loading,true);assert.equal(progress.hidden,false);assert.equal(ultra.fallbackSurface,compact);
  f.releaseFences();await pending;
  assert.equal(f.controller.loading,false);assert.equal(f.controller.loadPanel.hidden,true);assert.equal(progress.value,1);assert.equal(ultra.fallbackSurface,null);assert.equal(compact.enabled,false);
 }finally{f.close();}
});

test('v48 a fully transferred base cannot replace compact before all requested interior preparation completes',async()=>{
 const blocked=unresolved();let requested=false;
 const f=streamEnvironment({ensureLocal:async({signal})=>{requested=true;await blocked.promise;if(!signal.aborted)f.controller.localRefinement.current={manifest:{extent:[1,1,1]},pieces:[]};}});
 try{
  const compact=retainedCompact(f),pending=f.choose('gentle');await until(()=>f.workers.length===1);await sendStreamGeometry(f);sendStreamComplete(f.workers[0]);await until(()=>requested);
  assert.equal(f.renderer.fineSurface,compact);assert.equal(compact.enabled,true);assert.equal(f.controller.loading,true);assert.equal(f.controller.loadProgress.value,.91);
  assert.match(f.controller.loadStatus.textContent,/Preparing interior surfaces/);assert.equal(f.controller.refinementNotice.hidden,true,'Only one preparation panel is visible.');
  blocked.resolve();await presentStreamedSurface(f);await pending;assert.equal(f.renderer.fineSurface.lod.id,'gentle');assert.equal(compact.enabled,false);
 }finally{blocked.resolve();f.close();}
});

test('v48 cancellation during streamed cleanup releases its staged buffers and cannot publish a late interior result',async()=>{
 const blocked=unresolved();let requested=false;
 const f=streamEnvironment({ensureLocal:async({signal})=>{requested=true;await blocked.promise;if(!signal.aborted)f.controller.localRefinement.current={manifest:{extent:[1,1,1]},pieces:[]};}});
 try{
  const compact=retainedCompact(f),baseline=f.live.size,pending=f.choose('gentle');await until(()=>f.workers.length===1);await sendStreamGeometry(f);sendStreamComplete(f.workers[0]);await until(()=>requested);
  await f.choose('volume');await pending;assert.equal(f.renderer.fineSurface,compact);assert.equal(f.live.size,baseline);assert.equal(f.controller.select.value,'volume');
  blocked.resolve();await tick();assert.equal(f.renderer.fineSurface,compact);assert.equal(f.controller.loading,false);assert.equal(f.controller.localRefinement.current,null);assert.equal(f.live.size,baseline);
 }finally{blocked.resolve();f.close();}
});

test('v48 cancellation before the first streamed frame releases complete interior graphics, restores compact and ignores a late presentation',async()=>{
 const f=streamEnvironment();try{
  const compact=retainedCompact(f),baseline=f.live.size,pending=f.choose('gentle');await until(()=>f.workers.length===1);await sendStreamGeometry(f);sendStreamComplete(f.workers[0]);await until(()=>f.renderer.fineSurface?.lod.id==='gentle');
  const ultra=f.renderer.fineSurface,late=ultra.onPresented,masks=f.renderer.lumenCleanup;
  const interiorPieces=Array.from({length:4},()=>({vao:f.renderer.gl.createVertexArray(),buffers:Array.from({length:3},()=>f.renderer.gl.createBuffer())}));
  f.controller.localRefinement.current.pieces=interiorPieces;
  const interiorResources=interiorPieces.flatMap(piece=>[piece.vao,...piece.buffers]);assert.ok(interiorResources.every(resource=>f.live.has(resource)));
  await f.choose('volume');await pending;
  assert.equal(f.renderer.fineSurface,compact);assert.equal(compact.enabled,false);assert.equal(ultra.enabled,false);assert.equal(f.live.size,baseline);assert.equal(f.controller.loading,false);
  assert.equal(f.controller.localRefinement.current,null);assert.ok(interiorResources.every(resource=>!f.live.has(resource)&&f.deleted.includes(resource)));
  assert.equal(f.renderer.lumenCleanup,masks,'The compact fallback keeps its working reviewed masks.');assert.equal(f.controller.lumenCleanup.compact,true);
  late();await tick();await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(f.renderer.fineSurface,compact);assert.equal(f.controller.select.value,'volume');assert.equal(f.controller.loadPanel.hidden,true);assert.equal(f.live.size,baseline);
 }finally{f.close();}
});

test('v48 context loss during a streamed upload aborts promptly without downloading the larger original again',async()=>{
 const f=streamEnvironment({manualFences:true,gentleManifest:streamedManifest(true)});try{
  const compact=retainedCompact(f),baseline=f.live.size,pending=f.choose('gentle');await until(()=>f.workers.length===1);const worker=f.workers[0];await sendStreamStart(f);
  worker.finish({type:'surface-chunk',sequence:1,kind:'position',byteOffset:0,buffer:new ArrayBuffer(12)});await until(()=>f.fences.length===1);
  f.state.contextLost=true;f.renderer.canvas.dispatchEvent(new f.window.Event('webglcontextlost'));await pending;
  assert.equal(worker.terminated,true);assert.equal(f.controller.loading,false);assert.equal(f.controller.worker,null);assert.equal(f.workers.length,1);
  assert.equal(f.fetches.some(url=>url==='./assets/fine-surface-v23/manifest.json'),false);assert.equal(f.controller.retrySurface,null);assert.match(f.controller.status.textContent,/Reload to restore/);
  assert.equal(f.renderer.fineSurface,compact);assert.equal(f.live.size,baseline);assert.equal(streamAck(worker,1),undefined);
 }finally{f.close();}
});

test('v48 corrupt completion or incomplete stream data never installs a surface and releases staged graphics',async()=>{
 for(const corruptIdentity of [false,true]){
  const f=streamEnvironment();try{
   const compact=retainedCompact(f),baseline=f.live.size,pending=f.choose('gentle');await until(()=>f.workers.length===1);
   if(corruptIdentity)await sendStreamGeometry(f);else await sendStreamStart(f);
   sendStreamComplete(f.workers[0],corruptIdentity?{geometrySourceSha256:'e'.repeat(64)}:{});await pending;
   assert.equal(f.renderer.fineSurface,compact);assert.equal(compact.enabled,true);assert.equal(f.live.size,baseline);assert.equal(f.controller.loading,false);assert.equal(f.controller.retrySurface,'gentle');
   assert.match(f.controller.status.textContent,/not verified|has not arrived/);
  }finally{f.close();}
 }
});

test('v48 a worker that sends another chunk before GPU acknowledgement is rejected without a partial model',async()=>{
 const f=streamEnvironment({manualFences:true});try{
  const compact=retainedCompact(f),baseline=f.live.size,pending=f.choose('gentle');await until(()=>f.workers.length===1);const worker=f.workers[0];await sendStreamStart(f);
  worker.finish({type:'surface-chunk',sequence:1,kind:'position',byteOffset:0,buffer:new ArrayBuffer(12)});await until(()=>f.fences.length===1);
  worker.finish({type:'surface-chunk',sequence:2,kind:'normal',byteOffset:0,buffer:new ArrayBuffer(12)});await pending;
  assert.equal(worker.terminated,true);assert.equal(streamAck(worker,1),undefined);assert.equal(streamAck(worker,2),undefined);assert.equal(f.renderer.fineSurface,compact);assert.equal(f.live.size,baseline);
  assert.match(f.controller.status.textContent,/before their graphics acknowledgement/);
 }finally{f.close();}
});

test('v48 a stale worker stream cannot allocate or acknowledge into a newer choice',async()=>{
 const f=streamEnvironment();try{
  const compact=retainedCompact(f),baseline=f.live.size,oldPending=f.choose('gentle');await until(()=>f.workers.length===1);const old=f.workers[0];await sendStreamStart(f,old);
  await f.choose('volume');await oldPending;const pending=f.choose('gentle');await until(()=>f.workers.length===2);const current=f.workers[1];
  old.finish({type:'surface-chunk',sequence:1,kind:'position',byteOffset:0,buffer:new ArrayBuffer(12)});sendStreamComplete(old);await tick();
  assert.equal(f.controller.worker,current);assert.equal(f.renderer.fineSurface,compact);assert.equal(f.live.size,baseline);assert.equal(streamAck(old,1),undefined);
  await f.choose('volume');await pending;assert.equal(f.renderer.fineSurface,compact);assert.equal(f.live.size,baseline);
 }finally{f.close();}
});

test('v48 a view change before the first streamed frame retains the verified surface without a timeout and later proves its presentation',async()=>{
 const time=surfaceWatchdogFixture(),f=streamEnvironment({watchdogFactory:time.watchdogFactory});try{
  const compact=retainedCompact(f),pending=f.choose('gentle');await until(()=>f.workers.length===1);await sendStreamGeometry(f);sendStreamComplete(f.workers[0]);await until(()=>f.renderer.fineSurface?.lod.id==='gentle');const ultra=f.renderer.fineSurface;
  assert.equal(f.controller.loading,true);f.renderer.set({mode:1});f.controller.sync();await pending;
  assert.equal(f.controller.loading,false);assert.equal(f.controller.loadPanel.hidden,true);assert.equal(f.controller.retrySurface,null);assert.equal(ultra.enabled,true);assert.equal(ultra.activeFor(f.renderer),false);assert.equal(ultra.fallbackSurface,compact);
  time.advance(5000);assert.equal(f.controller.retrySurface,null);assert.equal(f.workers.length,1);
  await f.choose('gentle');assert.equal(f.renderer.fineSurface,ultra);assert.equal(ultra.activeFor(f.renderer),true);await presentStreamedSurface(f);await until(()=>ultra.fallbackSurface===null);
  assert.equal(compact.enabled,false);assert.equal(f.controller.select.value,'gentle');assert.equal(f.workers.length,1);
 }finally{f.close();}
});

test('v48 a failed first streamed draw restores compact and clears pending progress',async()=>{
 const f=streamEnvironment();try{
  const compact=retainedCompact(f),baseline=f.live.size,pending=f.choose('gentle');await until(()=>f.workers.length===1);await sendStreamGeometry(f);sendStreamComplete(f.workers[0]);await until(()=>f.renderer.fineSurface?.lod.id==='gentle');
  f.renderer.fineSurface.onError(new Error('Fixture streamed first draw failed'));await pending;
  assert.equal(f.renderer.fineSurface,compact);assert.equal(compact.enabled,true);assert.equal(f.controller.loading,false);assert.equal(f.live.size,baseline);assert.equal(f.controller.retrySurface,'gentle');assert.match(f.controller.status.textContent,/Fixture streamed first draw failed/);
 }finally{f.close();}
});

test('v48 streamed cleanup allocation failures retain compact without retrying the larger original transport',async()=>{
 for(const error of [new RangeError('Invalid typed array length'),new Error('Array buffer allocation failed')]){
  let attempts=0;const f=streamEnvironment({gentleManifest:streamedManifest(true),streamDebrisLoader:async()=>{attempts++;throw error;}});
  try{
   const compact=retainedCompact(f),baseline=f.live.size;await f.choose('gentle');
   assert.equal(attempts,1);assert.equal(f.workers.length,0);assert.equal(f.controller.loading,false);assert.equal(f.controller.retrySurface,'gentle');
   assert.equal(f.fetches.some(url=>url==='./assets/fine-surface-v23/manifest.json'),false);assert.equal(f.renderer.fineSurface,compact);assert.equal(compact.enabled,true);assert.equal(f.live.size,baseline);
   assert.match(f.controller.status.textContent,/Invalid typed array length|Array buffer allocation failed/);
  }finally{f.close();}
 }
});

test('v52 exhausted network recovery retains Compact and never starts the larger legacy transport',async()=>{
 for(const streamed of [false,true]){
  const compact={assetBaseUrl:'/api/display-compact-v29/mesh/',parts:[],decodedBytes:68,decodedSha256:'c'.repeat(64)};
  const source=streamed?streamedManifest(true):{...gentleManifest,lods:[{...gentleManifest.lods[0],compactTransport:compact,decodedSha256:compact.decodedSha256}]};
  const f=environment({gentleManifest:source,streamDebrisLoader:streamCleanup});
  try{
   const retained=retainedCompact(f),baseline=f.live.size,pending=f.choose('gentle');await until(()=>f.workers.length===1);
   if(streamed)await sendStreamStart(f);
   f.workers[0].finish({error:'The surface connection was interrupted after 3 recovery attempts.',networkFailure:true});await pending;
   assert.equal(f.workers.length,1);assert.equal(f.fetches.includes('./assets/fine-surface-v23/manifest.json'),false);
   assert.equal(f.renderer.fineSurface,retained);assert.equal(retained.enabled,true);assert.equal(f.live.size,baseline);
   assert.equal(f.controller.loading,false);assert.equal(f.controller.retrySurface,'gentle');assert.equal(f.controller.loadRetry.hidden,false);
   assert.match(f.controller.status.textContent,/connection was interrupted/);
  }finally{f.close();}
 }
});

test('v52 retry announcements cannot keep a stalled worker alive indefinitely',async()=>{
 const time=surfaceWatchdogFixture(),f=environment({watchdogFactory:time.watchdogFactory});
 try{
  const pending=f.choose('detail');await until(()=>f.workers.length===1);
  time.advance(20);f.workers[0].finish({type:'progress',phase:'download',stage:'reconnect',retryAttempt:1,maxRetries:3});
  assert.match(f.controller.loadStageText.textContent,/Reconnecting/);
  time.advance(20);f.workers[0].finish({type:'progress',phase:'download',stage:'reconnect',retryAttempt:2,maxRetries:3});
  time.advance(20);await pending;
  assertSurfaceTimedOut(f,time,'detail');assert.equal(f.workers[0].terminated,true);
 }finally{f.close();}
});

test('v52 foreground surface loading yields the background download budget on pause, cancellation, failure and success',async()=>{
 for(const finish of ['cancel','fail','complete']){
  const activity=new ScanActivity({ready:true,idleMs:0,prefetchIdleMs:0}),f=environment({activity});
  try{
   assert.equal(activity.getState().allowBackground,true);
   const pending=f.choose('detail');await until(()=>f.workers.length===1);
   assert.equal(activity.getState().allowBackground,false);assert.equal(activity.getState().foregroundCount,1);
   f.controller.sync();assert.equal(activity.getState().foregroundCount,1,'UI refreshes must not accumulate priority leases.');
   f.controller.setWorkspaceActive(false);assert.equal(activity.getState().foregroundCount,0);
   f.controller.setWorkspaceActive(true);assert.equal(activity.getState().foregroundCount,1);
   if(finish==='cancel')await f.choose('volume');
   else if(finish==='fail')f.workers[0].finish({error:'Connection interrupted',networkFailure:true});
   else f.workers[0].finish(decoded());
   await pending;
   assert.equal(activity.getState().foregroundCount,0);assert.equal(activity.getState().allowBackground,true);
  }finally{f.close();activity.dispose();}
 }
});

test('v53 staging cleanup is scoped to each terminated job and never blocks cancellation',async()=>{
 const cleaned=[],cleanupOptions=[],blocked=unresolved();const f=streamEnvironment({stagingCleanup:(id,options)=>{cleaned.push(id);cleanupOptions.push(options);return blocked.promise;}});
 try{
  retainedCompact(f);const first=f.choose('gentle');await until(()=>f.workers.length===1);
  const one=f.workers[0].message.stagingId;assert.match(one,/^[a-zA-Z0-9_-]{1,100}$/);
  await f.choose('volume');await first;await until(()=>cleaned.length===1);assert.deepEqual(cleaned,[one]);assert.deepEqual(cleanupOptions,[{afterTermination:true}]);
  const second=f.choose('gentle');await until(()=>f.workers.length===2);const two=f.workers[1].message.stagingId;assert.notEqual(two,one);
  f.workers[0].finish({type:'progress',stage:'download-complete',sequential:true,downloadedBytes:10,downloadTotalBytes:10});
  assert.equal(f.controller.loadOperation.snapshot().stage,'transfer');
  await f.choose('volume');await second;await until(()=>cleaned.length===2);assert.deepEqual(cleaned,[one,two]);assert.deepEqual(cleanupOptions,[{afterTermination:true},{afterTermination:true}]);
 }finally{blocked.resolve(false);f.close();}
});

test('v53 completed worker staging is cleaned while the full-model and first-frame gates still hold',async()=>{
 const cleaned=[],f=streamEnvironment({stagingCleanup:id=>{cleaned.push(id);throw new Error('Fixture optional cleanup unavailable');}});
 try{
  const compact=retainedCompact(f),pending=f.choose('gentle');await until(()=>f.workers.length===1);const worker=f.workers[0],id=worker.message.stagingId;
  worker.finish({type:'progress',stage:'download-start',phase:'download',sequential:true});assert.equal(f.controller.loadStageText.textContent,'Downloading surface');
  worker.finish({type:'progress',stage:'download-complete',phase:'decode',sequential:true,downloadedBytes:128,downloadTotalBytes:128});assert.equal(f.controller.loadStageText.textContent,'Preparing surface');
  assert.equal(f.renderer.fineSurface,compact);assert.equal(f.live.size>0,true);
  await sendStreamGeometry(f);sendStreamComplete(worker);await until(()=>f.renderer.fineSurface?.lod.id==='gentle');await until(()=>cleaned.length===1);
  assert.deepEqual(cleaned,[id]);assert.equal(f.controller.loading,true);assert.equal(f.renderer.fineSurface.fallbackSurface,compact);
  await presentStreamedSurface(f);await pending;assert.equal(f.controller.loading,false);assert.equal(f.controller.retrySurface,null);assert.deepEqual(cleaned,[id]);
 }finally{f.close();}
});
