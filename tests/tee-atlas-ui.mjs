/** Real module DOM and event lifecycle with controlled media/canvas adapters.
 * This verifies state, not browser rendering or clinical image correspondence. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {EchoModule} from '../public/echo.js';
import {titleCaseUi} from '../public/ui-text.js';
import {decodeEchoReferenceAnatomy} from '../public/echo-anatomy-context-v2.js';
import {TEE_ATLAS_VIEWS as views} from '../public/tee-atlas-data.js';
const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const {document,window}=parseHTML('<main id="echo"></main>');Object.assign(globalThis,{document,window,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(v){this._value=String(v);}});
window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:640,height:620});
window.HTMLElement.prototype.focus=function(){};window.HTMLElement.prototype.scrollIntoView=function(){};
window.HTMLElement.prototype.showModal=function(){this.open=true;};window.HTMLElement.prototype.close=function(){this.open=false;};
window.HTMLElement.prototype.pause=function(){this.paused=true;};window.HTMLElement.prototype.load=function(){};
window.HTMLElement.prototype.play=function(){return Promise.resolve();};
const context=new Proxy({},{get:()=>()=>{}});window.HTMLCanvasElement.prototype.getContext=function(type){return type==='2d'?context:null;};
const json=name=>JSON.parse(readFileSync(new URL('../public/assets/'+name,import.meta.url)));
globalThis.fetch=async url=>{const name=String(url).split('/').pop();assert.ok(['plane-fit-v2.json','regional-review-v3.json'].includes(name));return {ok:true,json:async()=>json('tee-atlas/'+name)};};
let steer=0;const caps=[];
const renderer={canvas:document.createElement('canvas'),settings:{palette:4,threshold:.28,cleanupEnabled:true,capContrast:1.8},extent:[.9,1,.9],camera:{yaw:0,pitch:0,roll:0,distance:1.55,pan:[0,0,0]},set(v){Object.assign(this.settings,v);},requestRender(){},clearCapData(){},setCapData(v){caps.push(v);},alignPlane(){},basis(){return{eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};}};
const echo=new EchoModule({renderer,mount:document.getElementById('echo'),onSteer:()=>steer++,donor:{id:'ladaf-2021-17',datasetId:'1659197537'}});
echo.referenceAnatomy=await decodeEchoReferenceAnatomy({manifestBytes:readFileSync(new URL('../public/assets/probe-context-v11/manifest.json',import.meta.url)),compressedBytes:readFileSync(new URL('../public/assets/probe-context-v11/torso.bin.gz',import.meta.url))});
await echo.loadPlaneReview();
await echo.loadRegionReview();
echo.setFrames(json('echo-planes.json'));echo.setAtlasFlowFrames(json('flow-views-v5.json'));
echo.setVolume(new Uint8Array(1),{dimensions:[475,475,530],spacingUm:317.6});
echo.mediaCatalog={clips:[]};echo.ensureSampler=()=>({sample:async()=>({data:new Uint8Array(16),width:4,height:4})});echo.drawSection=()=>{};echo.message=()=>{};echo.prefetchNeighbors=()=>{};
echo.enter();
echo.openReferenceView('a4c');
const event=type=>new window.Event(type,{bubbles:true});
const click=selector=>echo.mount.querySelector(selector).dispatchEvent(event('click'));
click('[data-mode="tee"]');
assert.equal(echo.state.preset,'me4c');assert.equal(echo.$('presets').querySelectorAll('button').length,15);
assert.equal(echo.$('presets').querySelectorAll('img').length,15);assert.equal(echo.$('atlas-browser').hidden,false);
assert.equal(echo.mount.querySelector('.echo-detail-fold').hasAttribute('open'),false);
click('[data-tee-group="tg"]');assert.equal(echo.$('presets').querySelectorAll('button').length,9);
click('[data-tee-group="aortic"]');assert.equal(echo.$('presets').querySelectorAll('button').length,4);
echo.$('search').value='papillary';echo.$('search').dispatchEvent(event('input'));assert.ok(echo.$('presets').querySelector('[data-preset="tgpapillary"]'));
echo.$('search').value='no-such-view';echo.$('search').dispatchEvent(event('input'));assert.equal(echo.$('search-empty').hidden,false);
echo.$('search').value='';echo.$('search').dispatchEvent(event('input'));
let acceptedPoses=0,unavailablePoses=0;
for(const v of views){
 echo.selectPreset(v.id);assert.equal(echo.$('active-name').textContent,titleCaseUi(v.name));assert.equal(echo.$('diagram-image').getAttribute('src'),v.illustration||v.diagram);assert.equal(echo.$('target-angle').textContent,v.angles);
 const plane=echo.getPlane();assert.ok(plane);assert.equal(echo.overlay.running,true);assert.equal(echo.overlay.plane,plane);assert.equal(echo.overlay.showContext,true);
 if(plane.acquisitionPose){
  acceptedPoses++;assert.equal(echo.overlay.pose,plane.acquisitionPose);assert.equal(echo.overlay.showProbe,true);assert.equal(echo.overlay.showSector,true);
 }else{
  // v73 already retains the source plane when no contained instrument pose is
  // accepted. The overlay may keep a reference-tract estimate for context, but
  // that estimate must never be displayed as a probe/sector for the CT plane.
  unavailablePoses++;assert.equal(plane.acquisitionUnavailable,true);assert.equal(plane.acquisition.sourcePlaneRetained,true);
  assert.equal(echo.overlay.showProbe,false);assert.equal(echo.overlay.showSector,false);
  assert.ok(echo.overlay.pose);assert.equal(echo.overlay.pose.contextFit.registered,false);assert.equal(echo.overlay.pose.contextFit.clinicalDepthMeasured,false);
  assert.ok(echo.overlay.pose.originMm.every(Number.isFinite));assert.equal(echo.$('probe-fit-note').dataset.estimated,'true');
  assert.ok(echo.$('probe-fit-note').textContent.includes(plane.acquisition.reason));
 }
 if(plane.acquisitionUnavailable&&!plane.outsideScan){
  assert.equal(echo.$('correspondence-note').textContent,plane.acquisition.reason);
  assert.match(echo.$('ct-correspondence').textContent,/source target retained.*probe fit unavailable/i);
  assert.equal(echo.$('fit-summary').textContent,echo.regionReview.views[v.id].summary,'Retained-source views keep their anatomical review in Model Details');
 }else if(!plane.acquisition.adjusted||plane.outsideScan)assert.equal(echo.$('correspondence-note').textContent,echo.regionReview.views[v.id].summary);else{assert.equal(echo.currentRegionalEvidence(),null);assert.match(echo.$('correspondence-note').textContent,/share one plane/);}
}
assert.ok(acceptedPoses>0&&unavailablePoses>0,'Both accepted instruments and retained-source/no-probe views must be exercised');
assert.equal(echo.state.preset,views[27].id);click('[data-echo="next"]');assert.equal(echo.state.preset,views[0].id);click('[data-echo="previous"]');assert.equal(echo.state.preset,views[27].id);
assert.equal(renderer.settings.clipAxis,-1);assert.equal(echo.sample,null);assert.equal(echo.$('coverage-badge').hidden,false);assert.equal(echo.mount.querySelector('[data-echo-view="ct"]').disabled,true);
echo.setLeftView('ct');assert.equal(echo.state.leftView,'3d');
echo.selectPreset('me4c');assert.equal(echo.mount.querySelector('[data-echo-view="ct"]').disabled,false);
assert.equal(echo.$('fit-bar').hidden,false);assert.equal(echo.$('fit-status').textContent,'Regional match reviewed');
const reviewed=structuredClone(echo.getPlane()),fixedContext=echo.anatomyContext(),oldRequest=echo.requestId,controller=new AbortController();
echo.sample={data:new Uint8Array([99])};echo.fineController=controller;echo.state.offsetMm=5;
click('[data-echo-fit="previous"]');
assert.equal(controller.signal.aborted,true);assert.ok(echo.requestId>oldRequest);assert.equal(echo.sample,null);assert.equal(echo.state.offsetMm,0);
assert.equal(echo.state.planeReference,'previous');assert.equal(echo.$('fit-status').textContent,'Previous plane');
assert.match(echo.$('fit-summary').textContent,/previous plane/i);assert.equal(echo.currentRegionalEvidence(),null);
const previous=structuredClone(echo.getPlane());assert.notDeepEqual(previous,reviewed);
click('[data-echo-fit="refined"]');assert.deepEqual(echo.getPlane(),reviewed);assert.equal(echo.anatomyContext(),fixedContext,'Review comparison cannot move contextual anatomy');
click('[data-echo-fit="previous"]');assert.deepEqual(echo.getPlane(),previous);click('[data-echo-fit="refined"]');
echo.$('context-visible').checked=false;echo.$('context-visible').dispatchEvent(event('change'));assert.equal(echo.overlay.showContext,false);assert.equal(echo.$('context-caption').hidden,true);
click('[data-echo="anchor-anatomy"]');assert.equal(echo.state.showContext,true);assert.equal(echo.$('context-caption').hidden,false);
echo.setLeftView('ct');assert.equal(echo.overlay.running,false);assert.equal(echo.$('context-caption').hidden,true);assert.equal(echo.$('probe-fit-note').hidden,true);
echo.setLeftView('3d');assert.equal(echo.overlay.running,true);assert.equal(echo.$('context-caption').hidden,false);
echo.restore({preset:'tg2c',mode:'tee'});assert.equal(echo.atlasGroup,'tg');assert.equal(echo.state.preset,'tg2c');assert.ok(echo.$('presets').querySelector('[data-preset="tg2c"][aria-pressed="true"]'),'A restored atlas view must be visible and selected in its own group');
echo.sample={data:new Uint8Array([99])};echo.previewGrid={};echo.selectPreset(views[6].id);assert.equal(echo.sample,null,'A changed view cannot retain a prior CT image while loading');assert.equal(echo.previewGrid,null);assert.equal(echo.$('resolution').textContent,'Preparing CT section…');assert.equal(echo.$('mpr').getAttribute('aria-label'),'CT section loading for the selected view.');echo.state.offsetMm=3;echo.updateCorrespondence();assert.equal(echo.$('ct-correspondence').textContent,'CT Plane Adjusted');assert.match(echo.$('fit-summary').textContent,/current plane has been adjusted/i);assert.equal(echo.currentRegionalEvidence(),null);echo.reset();
renderer.settings.anatomySelected=1;echo.selectPreset('mervinout');assert.equal(renderer.settings.anatomySelected,0,'A fresh RV preset must clear stale LV emphasis');
renderer.settings.anatomySelected=2;echo.restore({preset:'mervinout',mode:'tee',planeReference:'refined'});assert.equal(renderer.settings.anatomySelected,2,'Restoring a saved pose preserves its deliberate emphasis');
click('[data-echo="region-toggle"]');assert.equal(renderer.settings.palette,5);assert.equal(renderer.settings.anatomySelected,0);click('[data-echo="region-toggle"]');assert.equal(renderer.settings.palette,4);
echo.selectPreset('tgpapillary');assert.equal(echo.$('ct-correspondence').textContent,'Partial CT Target');assert.match(echo.$('correspondence-note').textContent,/belong to RV/);assert.match(echo.$('correspondence-note').textContent,/paired LV papillary muscles are not confirmed/);
echo.selectPreset('bicaval');if(echo.getPlane().acquisition.adjusted){assert.equal(echo.$('ct-correspondence').textContent,'Probe-Constrained CT Plane');assert.equal(echo.currentRegionalEvidence(),null);}else{assert.equal(echo.$('ct-correspondence').textContent,'Named Target Unconfirmed');assert.match(echo.$('correspondence-note').textContent,/not a confirmed bicaval view/);}
click('[data-echo-fit="previous"]');echo.selectPreset('mervinout');assert.equal(echo.state.planeReference,'refined','A fresh preset selects its current reviewed default');
echo.$('probe-visible').checked=false;echo.$('probe-visible').dispatchEvent(event('change'));assert.equal(echo.overlay.showProbe,false);
click('[data-echo="diagram-open"]');assert.equal(echo.$('diagram-dialog').open,true);click('[data-echo="diagram-close"]');assert.equal(echo.$('diagram-dialog').open,false);
click('[data-echo="steer"]');assert.equal(steer,1);
const source=id=>({id,preset:id,mode:'tee',kind:'image',url:'https://example.invalid/'+id+'.jpg',sourceUrl:'https://example.invalid/reference',title:id,author:'Fixture',qualityLabel:'Fixture image',correspondence:{sourceLabelVerified:true}});
echo.selectPreset('me4c');echo.setMediaCatalog({clips:[source('me4c'),source('me2c')]});const oldLoad=echo.$('cine-image').onload;
echo.selectPreset('me2c');oldLoad();assert.notEqual(echo.cineLoadedId,'me4c');echo.$('cine-image').onload();assert.equal(echo.cineLoadedId,'me2c');
assert.equal(echo.$('cine-select').querySelectorAll('option').length,1,'TEE choices remain scoped to the selected view');assert.equal(echo.$('rate-label').hidden,true);
echo.$('cine-image').onerror();assert.equal(echo.$('cine-retry').hidden,false);assert.equal(echo.$('cine-empty').hidden,false);
click('[data-echo="cine-retry"]');assert.equal(echo.$('cine-image').hidden,false);
echo.setMediaCatalog({clips:[{...source('me2c'),kind:'video',external:true,aseNumber:4,focusAspect:1.4}]});
assert.equal(echo.$('cine-video').classList.contains('is-framed'),false);
click('[data-echo="cine-fit"]');assert.equal(echo.$('cine-video').classList.contains('is-framed'),true);assert.equal(echo.$('cine-fit').textContent,'Full Frame');
click('[data-echo="cine-fit"]');assert.equal(echo.$('cine-video').classList.contains('is-framed'),false);
click('[data-mode="tte"]');assert.equal(echo.state.preset,'a4c');assert.equal(echo.overlay.running,false);assert.equal(echo.tteOverlay.running,true);assert.equal(echo.$('atlas-browser').hidden,false);assert.equal(echo.$('presets').querySelectorAll('button').length,10);
echo.leave();echo.destroy();
console.log('TEE atlas DOM checks passed: all 28 selections; reviewed/previous reversible comparison and stale-work cancellation; fixed anatomy context and CT visibility; group/search navigation; wraparound; probe/sector state; outside-scan CT guard; dialog; crosslink; still-image selection, stale-event rejection and retry; TTE restoration.');
