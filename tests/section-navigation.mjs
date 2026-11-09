/** Real reconstruction event handlers on the real page; transport and GPU are fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import * as sectionNames from '../public/section-names.js';
import {DONORS,ALL_SOURCES,donorFromSearch,donorUrl,spacingLabel} from '../public/donors.js';
import {orthogonalFrame} from '../public/planes.js';
import {croppedSectionFrame} from '../public/section-layout.js';

if(!process.argv[2])throw new Error('Pass the installed LinkeDOM ESM entry point.');
const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const html=await readFile(new URL('../page.html',import.meta.url),'utf8');
const app=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/\nmain\(\);\s*$/,'');
const dimensions=[475,475,530],keys=['X','Y','Z'];

function fixture(){
 const {document,window}=parseHTML(html),pending=[],frames=[];let timerId=0;
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._testValue??this.querySelector('option')?.value??'';},set(value){this._testValue=String(value);}});
 window.HTMLCanvasElement.prototype.setPointerCapture=()=>{};
 const renderer={loaded:true,backend:'webgl2',extent:[.9,1,.9],settings:{mode:0,palette:0,threshold:.3,opacity:.8,clipAxis:-1,clipPosition:.5,clipFlip:0,quality:'auto'},
  set(patch){Object.assign(this.settings,patch);},alignPlane(){},clearCapData(){this.cap=null;},setCapData(cap){this.cap=cap;}};
 class SectionDetail{
  manifest={sliceCounts:dimensions,spacingUm:158.8};
  cached(){return null;}
  index(axis,position){return Math.round(position*(dimensions[axis]-1));}
  load(axis,index){return new Promise(resolve=>pending.push({axis,index,resolve:()=>resolve({axis,index,key:axis+':'+index,width:2,height:2,data:new Uint8Array(4).fill(180),spacingUm:158.8})}));}
 }
 const dependencies={...sectionNames,document,window,fixtureRenderer:renderer,dimensions,
  location:{search:'?donor=ladaf-2021-17'},DONORS,ALL_SOURCES,donorFromSearch,donorUrl,spacingLabel,orthogonalFrame,croppedSectionFrame,
  PALETTE_KEYS:['ivory','copper','grayscale','porcelain','contrast','anatomy'],scanActivity:{getState:()=>({allowLocalPrefetch:true})},
  HostedSectionStore:class{},UltraVolumeSource:class{},VolumeLoader:class{},ResidentSectionSource:class{},SectionDetail,
  ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},setTimeout:()=>++timerId,clearTimeout:()=>{}};
 const setup=`
  renderer=fixtureRenderer;volumeMeta={dimensions,spacingUm:317.6};manifest={levels:{high:volumeMeta}};currentLevel='high';cutFaceQuality='detail';
  slices=['X','Y','Z'].map((key,axis)=>new SliceView($('slice'+key),axis));
  bind();syncControls();
  return {get activeAxis(){return activeAxis;},get positions(){return [...slicePositions];},refreshDetailedSections};
 `;
 const api=new Function(...Object.keys(dependencies),app+setup)(...Object.values(dependencies));
 const trigger=(selector,type,properties={})=>{
  const node=document.querySelector(selector);assert.ok(node,selector);
  const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,properties);node.dispatchEvent(event);return event;
 };
 const assertActive=axis=>{
  assert.equal(api.activeAxis,axis);assert.equal(renderer.settings.clipAxis,axis);
  assert.equal(document.querySelectorAll('.slice-card.linked').length,axis<0?0:1);
  for(const [i,key]of keys.entries()){
   const card=document.getElementById('slice'+key).closest('.slice-card');
   assert.equal(card.classList.contains('linked'),i===axis,key+' active card');
   assert.equal(card.querySelector('.slice-activate').getAttribute('aria-pressed'),String(i===axis),key+' accessible active state');
  }
 };
 return {document,renderer,api,pending,trigger,assertActive};
}

test('all three reconstruction sections transfer active feedback on wheel, range, keys, buttons and touch',()=>{
 const f=fixture();f.assertActive(-1);
 for(const [axis,key]of keys.entries()){
  const before=f.api.positions[axis];f.trigger('#slice'+key,'wheel',{deltaY:80});f.assertActive(axis);
  assert.ok(f.api.positions[axis]>before);
  assert.equal(f.document.getElementById('slice'+key).closest('.slice-card').classList.contains('browsed'),true);
 }
 for(const [axis,key]of keys.entries()){
  f.document.getElementById('sliceRange'+key).value='.63';f.trigger('#sliceRange'+key,'input');f.assertActive(axis);
 }
 f.trigger('#sliceY','keydown',{key:'ArrowDown'});f.assertActive(1);
 f.trigger('[data-section-axis="X"][data-section-step="1"]','click');f.assertActive(0);
 f.trigger('.axis-z .slice-activate','click');f.assertActive(2);
 f.trigger('#sliceY','pointerdown',{pointerType:'touch',pointerId:1,clientY:120});
 f.trigger('#sliceY','pointermove',{pointerType:'touch',pointerId:1,clientY:92});f.assertActive(1);
 f.trigger('#sliceY','pointerup');
 f.trigger('#sliceX','pointerdown',{pointerType:'mouse',pointerId:2});f.assertActive(0);
 f.trigger('#sliceX','pointerup');
 f.trigger('#sliceZ','keydown',{key:'Enter'});f.assertActive(2);
 f.trigger('#presetWhole','click');f.assertActive(-1);
});

test('enlargement links its visible section and closing it preserves that link',()=>{
 const f=fixture();f.trigger('#sliceX','wheel',{deltaY:50});f.assertActive(0);
 f.trigger('[data-section-expand="Y"]','click');f.assertActive(1);
 assert.equal(f.document.querySelector('.slice-card.expanded').dataset.axis,'y');
 assert.equal(f.document.querySelector('[data-section-expand="Y"]').getAttribute('aria-label'),'Show all sections');
 f.trigger('#sliceY','wheel',{deltaY:-50});f.assertActive(1);
 f.trigger('[data-section-expand="Y"]','click');f.assertActive(1);
 assert.equal(f.document.querySelectorAll('.slice-card.expanded').length,0);
 f.trigger('#sliceZ','wheel',{deltaY:50});f.assertActive(2);
});

test('the compact section workspace retains all three cards without an extra navigation panel',()=>{
 const f=fixture();
 assert.equal(f.document.querySelector('.section-bar'),null);
 assert.equal(f.document.querySelector('[data-section-jump]'),null);
 assert.deepEqual([...f.document.querySelectorAll('.slice-card')].map(card=>card.dataset.sectionSlot),['first','second','wide']);
 assert.equal(f.document.querySelectorAll('.slice-scroll-cue .mouse-cue').length,3);
 assert.ok([...f.document.querySelectorAll('.slice-scroll-cue .mouse-cue')].every(node=>node.textContent==='Scroll Here'));
 f.trigger('[data-section-expand="Y"]','click');f.assertActive(1);
 f.trigger('[data-section-expand="Y"]','click');
 assert.equal(f.document.querySelector('.slice-card.expanded'),null);
 assert.equal(f.document.querySelector('.slice-grid').classList.contains('has-expanded'),false);
 const before=f.api.positions[2];f.trigger('#sliceZ','wheel',{deltaY:80});
 assert.ok(f.api.positions[2]>before);f.assertActive(2);
});

test('ignored wheel gestures and a late inactive-axis detail cannot steal the active cutaway',async()=>{
 const f=fixture();f.trigger('#sliceX','wheel',{deltaY:40});f.assertActive(0);
 const oldLoads=f.api.refreshDetailedSections();
 assert.equal(f.pending.length,3);
 f.trigger('#sliceY','wheel',{deltaY:40});f.assertActive(1);
 f.trigger('#sliceX','wheel',{deltaY:0});f.assertActive(1);
 const pinch=f.trigger('#sliceX','wheel',{deltaY:30,ctrlKey:true});
 assert.equal(pinch.defaultPrevented,false);f.assertActive(1);
 f.trigger('#sliceZ','wheel',{deltaY:30,shiftKey:true});f.assertActive(1);
 f.pending.find(item=>item.axis===0).resolve();await new Promise(resolve=>setImmediate(resolve));
 f.assertActive(1);assert.equal(f.renderer.cap,null);
 for(const item of f.pending.filter(item=>item.axis!==0))item.resolve();await oldLoads;
 f.assertActive(1);
 assert.match(f.document.getElementById('sectionSyncStatus').textContent,/Sagittal/);
});
