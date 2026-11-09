/** Real controller + DOM/data fixtures. No browser or GPU claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {QuickViews} from '../public/quick-views.js';
import {DONORS} from '../public/donors.js';
import {validateMainViewReview,MAIN_VIEW_REVIEW_VERSION} from '../public/main-view-review.js';
const {parseHTML}=await import(pathToFileURL(process.argv[2]||'/workspace/data/heart-ui-test-v11/node_modules/linkedom/esm/index.js'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{resolve,reject,promise};};
const original=JSON.parse(await readFile(new URL('../public/assets/flow-views-v5.json',import.meta.url),'utf8'));
const reviewed=validateMainViewReview(JSON.parse(await readFile(new URL('../public/assets/main-view-qc-v3.json',import.meta.url),'utf8')));
function fixture({donor=DONORS[0],metadata=original,delayedMetadata=false,reviewLoader=null}={}){
 const {document,window}=parseHTML('<html><body><div id="quick"></div></body></html>');
 globalThis.document=document;globalThis.window=window;
 const fetches=[],jobs=[],caps=[],cameraCalls=[],metaWait=deferred(),savedFetch=globalThis.fetch;
 globalThis.fetch=async url=>{fetches.push(url);if(delayedMetadata)return metaWait.promise;return Response.json(metadata);};
 const renderer={loaded:true,settings:{cleanupEnabled:true,palette:4},extent:[.9,1,.9],camera:{distance:2,pan:[0,0,0]},
  set(values){Object.assign(this.settings,values);},clearCapData(){this.cap=null;},setCapData(cap){caps.push(cap);this.cap=cap;},
  alignPlane(normal,up,target){cameraCalls.push({normal,up,target,distance:this.camera.distance});}};
 const cache={load(item){const job={item,...deferred()};jobs.push(job);return job.promise;},pause(){},destroy(){}};
 const views=new QuickViews({renderer,mount:document.getElementById('quick'),donor,textureCache:cache,reviewLoader});
 views.setVolume(new Uint8Array(8),{dimensions:[475,475,530],spacingUm:317.6});
 const finish=index=>jobs[index].resolve({data:new Uint8Array([0,120,190,255]),width:2,height:2,spacingUm:donor.fineSpacingUm,ultra:true,cleaned:true});
 return{views,renderer,fetches,jobs,caps,cameraCalls,metaWait,document,finish,close(){views.destroy();globalThis.fetch=savedFetch;}};
}
test('two visible rows expose eight measured presets and default to Close-up without eager requests',async()=>{
 const e=fixture();try{
  assert.equal(e.fetches.length,0);assert.equal(e.document.querySelectorAll('[data-quick-preset]').length,8);
  assert.equal(e.document.querySelectorAll('.quick-view-row').length,2);
  assert.equal(e.document.querySelectorAll('.quick-view-primary>[data-quick-preset]').length,4);
  assert.equal(e.document.querySelectorAll('.quick-view-secondary>[data-quick-preset]').length,4);
  assert.equal(e.document.querySelector('details'),null);
  assert.equal(e.document.querySelector('[data-quick-view="overview"], [data-quick-view="section"], [data-quick-reference], .quick-view-review'),null);
  assert.deepEqual([...e.document.querySelectorAll('.quick-view-actions button')].map(button=>button.textContent),['Close-up','Flip','Region Colors']);
  const selected=e.views.select('rv-inflow');await tick();assert.deepEqual(e.fetches,[DONORS[0].flowViewsUrl]);assert.equal(e.jobs.length,1);
  e.finish(0);await selected;
  assert.equal(e.renderer.settings.clipAxis,3);assert.equal(e.renderer.cap.spacingUm,79.4);
  assert.equal(e.views.state.preset,'rv-inflow');assert.equal(e.views.mount.querySelector('[data-quick-preset="rv-inflow"]').getAttribute('aria-pressed'),'true');
  assert.equal(e.views.state.view,'close');assert.equal(e.views.mount.querySelector('[data-quick-view="close"]').getAttribute('aria-pressed'),'true');
  assert.equal(e.renderer.camera.distance,original.presets.find(p=>p.id==='rv-inflow').closeDistance);
 }finally{e.close();}
});
test('an exposed second-row button activates its measured view and Close-up restores the camera without resampling',async()=>{
 const e=fixture();try{
  const button=e.views.mount.querySelector('.quick-view-secondary [data-quick-preset="ra-inflow"]');
  assert.equal(button.closest('details, [hidden]'),null);
  button.click();await tick();assert.equal(e.views.state.preset,'ra-inflow');assert.equal(e.jobs.length,1);
  e.finish(0);await tick();
  const source=original.presets.find(p=>p.id==='ra-inflow'),cap=e.renderer.cap,plane=e.views.plane;
  assert.equal(e.renderer.camera.distance,source.closeDistance);assert.equal(button.getAttribute('aria-pressed'),'true');
  e.renderer.camera.distance=3;e.renderer.camera.pan=[.2,.3,.1];
  e.views.mount.querySelector('[data-quick-view="close"]').click();
  assert.equal(e.renderer.camera.distance,source.closeDistance);assert.equal(e.renderer.cap,cap);assert.equal(e.views.plane,plane);assert.equal(e.jobs.length,1);
  const reset=e.views.reset();await tick();e.finish(1);await reset;
  assert.equal(e.views.state.view,'close');assert.equal(e.renderer.camera.distance,source.closeDistance);
 }finally{e.close();}
});
test('a late earlier texture cannot replace the newly chosen view',async()=>{
 const e=fixture();try{
  const a=e.views.select('rv-inflow');await tick();const b=e.views.select('lv-outflow');await tick();
  e.finish(1);await b;const cap=e.renderer.cap;e.finish(0);await a;
  assert.equal(e.renderer.cap,cap);assert.match(cap.key,/lv-outflow/);assert.equal(e.caps.length,1);
 }finally{e.close();}
});
test('selecting an orthogonal section cancels pending metadata without taking the clip back',async()=>{
 const e=fixture({delayedMetadata:true});try{
  const pending=e.views.select('rv-inflow');e.views.deactivate();e.renderer.settings.clipAxis=1;
  e.metaWait.resolve(Response.json(original));await pending;
  assert.equal(e.renderer.settings.clipAxis,1);assert.equal(e.jobs.length,0);assert.equal(e.views.getState(),null);
 }finally{e.close();}
});
test('leaving reconstruction prevents late cap writes; returning preserves the user camera',async()=>{
 const e=fixture();try{
  const selected=e.views.select('ra-outflow');await tick();e.views.suspend();e.renderer.settings.clipAxis=3;e.renderer.camera.distance=.44;
  e.finish(0);await selected;assert.equal(e.caps.length,0);
  const cameraCalls=e.cameraCalls.length,resumed=e.views.resume();await tick();e.finish(1);await resumed;
  assert.equal(e.renderer.camera.distance,.44);assert.equal(e.cameraCalls.length,cameraCalls);
  assert.equal(e.renderer.cap.spacingUm,79.4);assert.equal(e.views.state.flip,true);
 }finally{e.close();}
});
test('volume refinement replaces sampling data without resetting an active camera',async()=>{
 const e=fixture();try{
  const first=e.views.select('lv-inflow');await tick();e.finish(0);await first;
  e.renderer.camera.distance=.39;const count=e.cameraCalls.length;
  e.views.setVolume(new Uint8Array(8),{dimensions:[475,475,530],spacingUm:317.6});await tick();e.finish(1);await tick();
  assert.equal(e.renderer.camera.distance,.39);assert.equal(e.cameraCalls.length,count);assert.equal(e.caps.length,2);
  e.views.flip();assert.equal(e.renderer.settings.clipFlip,1);assert.equal(e.jobs.length,2,'Flipping must reuse the same measured pixels.');
 }finally{e.close();}
});
test('legacy chamber bookmarks restore inside reconstruction with their recorded camera',async()=>{
 const e=fixture();try{
  e.renderer.camera.distance=.67;const loaded=e.views.restore({preset:'la-outflow',view:'section',flip:true});await tick();e.finish(0);await loaded;
  assert.equal(e.renderer.camera.distance,.67);assert.equal(e.views.state.view,'section');assert.equal(e.renderer.settings.clipFlip,1);
  assert.equal(e.cameraCalls.length,0);assert.equal(e.views.getState().preset,'la-outflow');
  assert.equal(e.views.mount.querySelector('[data-quick-view="close"]').getAttribute('aria-pressed'),'false');
  const cap=e.renderer.cap;e.views.mount.querySelector('[data-quick-view="close"]').click();
  assert.equal(e.views.state.view,'close');assert.equal(e.renderer.camera.distance,original.presets.find(p=>p.id==='la-outflow').closeDistance);
  assert.equal(e.renderer.cap,cap);assert.equal(e.jobs.length,1);
 }finally{e.close();}
});
test('each comparison donor uses its own geometric names and source textures',async()=>{
 for(const donor of DONORS.slice(1)){
  const metadata=JSON.parse(await readFile(new URL('../public/'+donor.flowViewsUrl.replace('./',''),import.meta.url),'utf8'));
  const e=fixture({donor,metadata});try{
   assert.doesNotMatch(e.views.mount.textContent,/\b(?:RV|LV|RA|LA)\b/);
   const loaded=e.views.select('rv-inflow');await tick();assert.ok(e.jobs[0].item.url.includes('/'+donor.id+'/'));e.finish(0);await loaded;
   for(const button of e.views.mount.querySelectorAll('[data-quick-preset]'))assert.match(button.getAttribute('aria-label'),/section/i);
  }finally{e.close();}
 }
});
test('the first selected frame rejects metadata from another donor',async()=>{
 const e=fixture({metadata:{...original,datasetId:'other'}});try{
  await e.views.select('rv-inflow');assert.equal(e.jobs.length,0);assert.equal(e.caps.length,0);assert.match(e.views.mount.textContent,/unavailable/i);
 }finally{e.close();}
});

test('reviewed RV outflow samples its new plane and never requests old prepared pixels',async()=>{
 const e=fixture({reviewLoader:async()=>reviewed});try{
  const sampled=[];e.views.sampler={sample:async plane=>{sampled.push(plane);return {data:new Uint8Array([10,20,30,40]),width:2,height:2};},destroy(){}};
  e.renderer.settings.anatomySelected=1;
  await e.views.select('rv-outflow');
  assert.equal(e.jobs.length,0);assert.equal(sampled.length,1);assert.equal(e.renderer.settings.anatomySelected,0);
  assert.ok(e.renderer.cap.plane.center.every((x,i)=>Math.abs(x-reviewed.views['rv-outflow'].world.center[i])<1e-12));
  assert.equal(e.views.getState().reviewVersion,MAIN_VIEW_REVIEW_VERSION);
  assert.equal(e.views.mount.querySelector('.quick-view-review'),null);
  assert.equal(e.views.state.view,'close');assert.equal(e.renderer.camera.distance,reviewed.views['rv-outflow'].closeDistance);
  assert.match(e.views.mount.querySelector('.quick-view-status').title,/RV|ventric/i);
  const startingPalette=e.renderer.settings.palette;e.views.toggleRegions();assert.equal(e.renderer.settings.palette,5);e.views.toggleRegions();assert.equal(e.renderer.settings.palette,startingPalette);
 }finally{e.close();}
});

test('old bookmarks keep the previous physical raster and deliberately selected region',async()=>{
 const e=fixture({reviewLoader:async()=>reviewed});try{
  e.renderer.settings.anatomySelected=2;e.renderer.camera.distance=.71;
  const restored=e.views.restore({preset:'rv-outflow',view:'section'});await tick();e.finish(0);await restored;
  assert.equal(e.views.getState().reviewVersion,'previous');assert.equal(e.renderer.settings.anatomySelected,2);assert.equal(e.renderer.camera.distance,.71);
  assert.ok(e.renderer.cap.plane.center.every((x,i)=>Math.abs(x-original.presets.find(p=>p.id==='rv-outflow').world.center[i])<1e-12));
  assert.equal(e.views.mount.querySelector('[data-quick-review-state]'),null);
 }finally{e.close();}
});

test('review download failure records the actual previous plane in shared state',async()=>{
 const e=fixture({reviewLoader:async()=>{throw new Error('Fixture catalog unavailable');}});try{
  const chosen=e.views.select('rv-outflow');await tick();e.finish(0);await chosen;
  assert.equal(e.views.getState().reviewVersion,'previous');assert.match(e.views.mount.textContent,/Original plane \(review unavailable\)/);
 }finally{e.close();}
});

test('a returned fine raster from another plane cannot replace the current source section',async()=>{
 const e=fixture({reviewLoader:async()=>reviewed});try{
  e.views.sampler={sample:async()=>({data:new Uint8Array([1,2,3,4]),width:2,height:2}),destroy(){}};
  e.views.fineSource={samplePlane:async(plane,options)=>{assert.equal(options.exactRaster,true);return {complete:true,data:new Uint8Array([9,9,9,9]),width:2,height:2,spacingUm:79.4,plane:{...plane,center:plane.center.map((x,i)=>x+(i===0?.01:0))}};}};
  await e.views.select('rv-outflow');
  assert.equal(e.caps.length,1);assert.deepEqual([...e.renderer.cap.data],[1,2,3,4]);assert.match(e.views.mount.textContent,/fine detail unavailable/);
 }finally{e.close();}
});
