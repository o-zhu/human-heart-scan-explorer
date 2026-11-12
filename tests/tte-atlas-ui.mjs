/** Real controller/DOM transitions with production camera math. Media, volume
 * transport and canvas are controlled adapters, not a browser rendering test. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {EchoModule} from '../public/echo.js';
import {titleCaseUi} from '../public/ui-text.js';
import {decodeEchoReferenceAnatomy} from '../public/echo-anatomy-context-v2.js';
import {VolumeRenderer} from '../public/renderer.js';
import {TTE_ATLAS_VIEWS as views,TTE_ATLAS_GROUPS as groups} from '../public/tte-atlas-data.js';
const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const {document,window}=parseHTML('<main id="echo"></main>');Object.assign(globalThis,{document,window,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(v){this._value=String(v);}});
window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:640,height:620});
for(const name of ['focus','scrollIntoView','load'])window.HTMLElement.prototype[name]=function(){};
window.HTMLElement.prototype.showModal=function(){this.open=true;};window.HTMLElement.prototype.close=function(){this.open=false;};
window.HTMLElement.prototype.pause=function(){this.paused=true;};
window.YT={Player:class{constructor(){}destroy(){}}};
const context=new Proxy({},{get:()=>()=>{}});window.HTMLCanvasElement.prototype.getContext=function(type){return type==='2d'?context:null;};
const json=name=>JSON.parse(readFileSync(new URL('../public/assets/'+name,import.meta.url)));
globalThis.fetch=async url=>{const name=String(url).split('/').pop();assert.ok(['plane-fit-v2.json','regional-review-v3.json'].includes(name));return {ok:true,json:async()=>json('tee-atlas/'+name)};};
const renderer=Object.assign(Object.create(VolumeRenderer.prototype),{
 canvas:document.createElement('canvas'),settings:{palette:4,threshold:.28,cleanupEnabled:true,capContrast:1.8},extent:[.9,1,.9],camera:{yaw:0,pitch:0,roll:0,distance:1.55,pan:[0,0,0]},
 set(v){Object.assign(this.settings,v);},requestRender(){},onChange(){},clearCapData(){this.cap=null;},setCapData(v){this.cap=v;}
});
const echo=new EchoModule({renderer,mount:document.getElementById('echo'),donor:{id:'ladaf-2021-17',datasetId:'1659197537'}});
echo.referenceAnatomy=await decodeEchoReferenceAnatomy({manifestBytes:readFileSync(new URL('../public/assets/probe-context-v11/manifest.json',import.meta.url)),compressedBytes:readFileSync(new URL('../public/assets/probe-context-v11/torso.bin.gz',import.meta.url))});
await echo.loadPlaneReview();await echo.loadRegionReview();
echo.setFrames(json('echo-planes.json'));echo.setAtlasFlowFrames(json('flow-views-v5.json'));
echo.setVolume(new Uint8Array(1),{dimensions:[475,475,530],spacingUm:317.6});
echo.mediaCatalog={clips:[]};echo.ensureSampler=()=>({sample:async()=>({data:new Uint8Array(16),width:4,height:4})});echo.drawSection=()=>{};echo.message=()=>{};echo.prefetchNeighbors=()=>{};
const event=type=>new window.Event(type,{bubbles:true});
const click=selector=>echo.mount.querySelector(selector).dispatchEvent(event('click'));
const camera=()=>structuredClone(renderer.camera),plane=()=>structuredClone(echo.getPlane());
let checks=0;const passed=name=>{checks++;console.log('PASS '+name);};
try{
 echo.enter();
 assert.equal(echo.active,false,'The default catalogue must not run the comparison');
 assert.equal(echo.referenceGallery.visible,true);assert.equal(echo.mount.querySelector('.echo-workspace').hidden,true);
 assert.equal(echo.mount.querySelectorAll('[data-reference-view]').length,28);
 click('[data-reference-view="a4c"]');assert.equal(echo.active,true);assert.equal(echo.referenceGallery.visible,false);
 passed('Reference Views defaults to the complete grid and starts comparison only after selection');
 assert.equal(echo.mount.querySelector('.echo-heading'),null);assert.equal(echo.$('exit'),null);
 assert.ok(echo.mount.querySelector('.echo-library .echo-library-heading'));
 assert.equal(echo.$('anchor-probe').textContent,'Anchor by Probe View');assert.equal(echo.$('anchor-anatomy').textContent,'Anchor by Anatomy');
 assert.equal(echo.state.alignment,'probe');
 assert.equal(echo.state.mode,'tte');assert.equal(echo.$('atlas-browser').hidden,false);
 assert.equal(echo.$('tte-groups').hidden,false);assert.equal(echo.$('tee-groups').hidden,true);
 for(const g of groups){click(`[data-tte-group="${g.id}"]`);assert.equal(echo.$('presets').querySelectorAll('button').length,g.count);assert.equal(echo.$('presets').querySelectorAll('img').length,g.count);}
 echo.$('search').value='2.10';echo.$('search').dispatchEvent(event('input'));assert.equal(echo.$('presets').querySelectorAll('button').length,2);
 echo.$('search').value='hepatic';echo.$('search').dispatchEvent(event('input'));assert.ok(echo.$('presets').querySelector('[data-preset="subcostal_hepatic"]'));
 echo.$('search').value='no-such-view';echo.$('search').dispatchEvent(event('input'));assert.equal(echo.$('search-empty').hidden,false);
 echo.$('search').value='';echo.$('search').dispatchEvent(event('input'));
 passed('Five groups, all 28 illustrated cards, split-row search and empty results');

 const baseline=new Map();
 for(const v of views){
  echo.selectPreset(v.id);baseline.set(v.id,plane());
  assert.equal(echo.$('active-name').textContent,titleCaseUi(v.name));assert.equal(echo.$('diagram-image').getAttribute('src'),v.illustration);
  assert.equal(echo.$('table-source').getAttribute('href'),v.sourceUrl);
  assert.match(echo.$('view-index').textContent,new RegExp(v.tableRow.replace('.','\\.')));
  assert.equal(echo.tteOverlay.running,true);assert.equal(echo.overlay.running,false);
  assert.equal(echo.tteOverlay.pose,echo.getPlane().acquisitionPose);
  if(!echo.getPlane().preferSourcePlane)assert.ok(echo.tteOverlay.pose.contextFit.markerAgreementDeg<1e-5);
  else assert.equal(echo.getPlane().acquisition.correctionAngleDeg,0,'The reviewed pulmonary-outflow target must retain its physical plane.');
  assert.equal(echo.anatomyContext().provenance.patientRegistered,false);
  assert.equal(echo.$('steer').hidden,true);assert.equal(echo.$('table-source').hidden,false);
 }
 click('[data-echo="next"]');assert.equal(echo.state.preset,views[0].id);click('[data-echo="previous"]');assert.equal(echo.state.preset,views.at(-1).id);
 passed('Every selection loads its own name, illustration, source page and external probe; browse wraps');

 echo.selectPreset('a4c');echo.setAlignment('upright');const upright=camera(),fixed=echo.anatomyContext();
 for(const v of views){echo.selectPreset(v.id);assert.deepEqual(camera(),upright);assert.deepEqual(plane(),baseline.get(v.id));assert.equal(echo.anatomyContext(),fixed);}
 renderer.orbit(14,-9);const explored=camera();echo.selectPreset('plax');assert.deepEqual(camera(),explored);
 echo.$('mpr').dispatchEvent(Object.assign(event('keydown'),{key:'Enter'}));assert.equal(echo.state.alignment,'ultrasound');
 assert.deepEqual(plane(),baseline.get('plax'));
 passed('Upright camera and chest remain fixed across all views; keyboard alignment preserves the CT plane');

 for(const id of ['subcostal_ivc','subcostal_hepatic','ssn_arch']){
  echo.selectPreset(id);assert.equal(echo.$('coverage-badge').hidden,false);assert.equal(renderer.settings.clipAxis,-1);
  assert.equal(echo.mount.querySelector('[data-echo-view="ct"]').disabled,true);echo.setLeftView('ct');assert.equal(echo.state.leftView,'3d');
  assert.equal(echo.tteOverlay.pose.contextFit.outsideScan,true);assert.match(echo.$('correspondence-note').textContent,/outside|absent/i);
 }
 echo.selectPreset('a4c');assert.equal(echo.mount.querySelector('[data-echo-view="ct"]').disabled,false);
 echo.setLeftView('ct');assert.equal(echo.tteOverlay.running,false);assert.equal(echo.$('context-caption').hidden,true);
 echo.setLeftView('3d');assert.equal(echo.tteOverlay.running,true);
 passed('Three extracardiac views suppress unsupported CT; overlay detaches in CT mode');

 echo.restore({preset:'psax',psaxLevel:'mitral'});assert.equal(echo.state.preset,'psax_mitral');assert.equal(echo.atlasGroup,'parasternal-short');
 echo.restore({preset:'psax',psaxLevel:'papillary'});assert.equal(echo.state.preset,'psax_papillary');
 echo.restore({preset:'a4c_rv',alignment:'upright',showContext:false});assert.equal(echo.state.alignment,'upright');assert.equal(echo.tteOverlay.showContext,false);
 assert.ok(echo.$('presets').querySelector('[data-preset="a4c_rv"][aria-pressed="true"]'));
 click('[data-mode="tee"]');assert.equal(echo.state.preset,'me4c');assert.equal(echo.tteOverlay.running,false);assert.equal(echo.overlay.running,true);
 assert.equal(echo.$('tee-groups').hidden,false);assert.equal(echo.$('tte-groups').hidden,true);assert.equal(echo.$('steer').hidden,false);
 click('[data-mode="tte"]');assert.equal(echo.state.preset,'a4c');assert.equal(echo.tteOverlay.running,true);assert.equal(echo.overlay.running,false);
 passed('Legacy short-axis bookmarks migrate; saved view options and TEE round trips retain meaning');

 const source=(id,preset)=>({id,preset,mode:'tte',kind:'image',external:true,url:'https://example.invalid/'+id+'.jpg',sourceUrl:'https://example.invalid/reference',title:id,author:'Fixture',qualityLabel:'Fixture',tableRow:'2.14',correspondence:{sourceLabelVerified:true}});
 echo.setMediaCatalog({clips:[source('four','a4c'),source('two','a2c'),{...source('tee','me4c'),mode:'tee'}]});
 assert.equal(echo.$('cine-select').querySelectorAll('option').length,1);const stale=echo.$('cine-image').onload;
 echo.selectPreset('a2c');assert.equal(echo.$('cine-select').querySelectorAll('option').length,1);stale();assert.notEqual(echo.cineLoadedId,'four');
 echo.$('cine-image').onload();assert.equal(echo.cineLoadedId,'two');
 echo.selectPreset('a3c');assert.equal(echo.$('cine-select').disabled,true);assert.equal(echo.$('cine-select').value,'');assert.equal(echo.$('cine-empty').hidden,false);
 click('[data-echo="diagram-open"]');assert.equal(echo.$('diagram-dialog').open,true);click('[data-echo="diagram-close"]');assert.equal(echo.$('diagram-dialog').open,false);
 passed('Media is scoped to the selected acquisition, rejects stale loads and never substitutes another view');

 echo.selectPreset('a4c');echo.setMediaCatalog({clips:[{...source('embedded','a4c'),kind:'youtube',url:'https://www.youtube-nocookie.com/embed/AbcDef012_-',originalUrl:'https://www.youtube.com/watch?v=AbcDef012_-'}]});
 assert.equal(echo.$('cine-embed').hidden,false);assert.equal(echo.$('rate-label').hidden,true);assert.equal(echo.$('loop-label').hidden,true);
 assert.equal(new URL(echo.$('cine-embed').getAttribute('src')).searchParams.get('autoplay'),'1');
 const priorEmbed=echo.$('cine-embed');echo.selectPreset('a2c');priorEmbed.dispatchEvent(event('load'));assert.notEqual(echo.cineLoadedId,'embedded');assert.notEqual(echo.$('cine-embed'),priorEmbed);
 assert.equal(echo.$('cine-embed').hasAttribute('src'),false);assert.equal(echo.$('cine-embed').hidden,true);
 assert.equal(echo.$('media-open').getAttribute('href'),views.find(v=>v.id==='a2c').sourceUrl);assert.equal(echo.$('media-open').textContent,'Guideline ↗');
 passed('Source-hosted player is explicit, uses native controls and is unloaded on view changes');

 const loads=new Map();echo.mediaCatalog=null;globalThis.fetch=async url=>{const n=loads.get(url)||0;loads.set(url,n+1);const tte=url.includes('/tte-atlas/');return {ok:!tte||n>0,status:tte&&n===0?503:200,json:async()=>({clips:tte?[source('recovered','a2c')]:[]})};};
 await echo.loadMediaCatalog();assert.equal(echo.mediaCatalog.incompleteSources.length,1);
 await echo.loadMediaCatalog();assert.equal(echo.mediaCatalog.incompleteSources.length,0);assert.equal(echo.mediaSelection,'recovered');
 for(const [url,count]of loads)assert.equal(count,url.includes('/tte-atlas/')?2:1,'Only the failed catalog should be retried');
 passed('A transient TTE catalog failure recovers while retaining successfully loaded catalogs');

 click('[data-reference="back"]');assert.equal(echo.active,false);assert.equal(echo.sampler,null);
 assert.equal(echo.overlay.running,false);assert.equal(echo.tteOverlay.running,false);assert.equal(echo.referenceGallery.visible,true);
 assert.equal(echo.mount.querySelector('.echo-workspace').hidden,true);
 click('[data-reference-mode="tee"]');click('[data-reference-level="basic"]');
 const savedGallery=echo.getState();assert.equal(savedGallery.presentation,'gallery');assert.equal(savedGallery.gallery.mode,'tee');
 echo.restore(savedGallery);echo.enter();assert.equal(echo.active,false);assert.equal(echo.referenceGallery.state.mode,'tee');
 assert.equal(echo.mount.querySelectorAll('[data-reference-view]').length,11);
 echo.restore({preset:'a4c',mode:'tte',offsetMm:2});echo.enter();
 assert.equal(echo.active,true);assert.equal(echo.state.preset,'a4c');assert.equal(echo.referenceGallery.visible,false);
 echo.leave();echo.enter();assert.equal(echo.referenceGallery.visible,true);assert.equal(echo.active,false);
 passed('Returning pauses comparison; gallery bookmarks retain filters; legacy links still open detail');
}finally{echo.destroy();}
console.log(`TTE atlas passed ${checks} controller/camera checks.`);
