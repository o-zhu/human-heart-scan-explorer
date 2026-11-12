import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {ProbeLabModule} from '../public/probe-lab.js';
import {TeeLabModule} from '../public/tee-lab.js';
import {labCompactPolicy} from '../public/lab-compact-v47.js';

// The actual lab templates, listeners and responsive relocation run here.
// LinkeDOM does not supply layout or WebGL; browser geometry QA is separate.
const domPath=process.argv.find(value=>value.startsWith('--dom='))?.slice(6)||process.env.HEART_DOM_MODULE||'/tmp/heart-v47-test-deps/node_modules/linkedom/esm/index.js';
const {parseHTML}=await import(pathToFileURL(domPath));
const globals=['document','window','innerWidth','innerHeight','matchMedia','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'];
const original=Object.fromEntries(globals.map(key=>[key,globalThis[key]]));
let fixture;
const pick=(select,value)=>{[...select.options].find(option=>option.value===value).selected=true;};

function environment({tee=false,width=390,height=844,coarse=true,anyCoarse=coarse,donor={}}={}){
 const kind=tee?'tee':'probe';
 const {document,window}=parseHTML(`<html><body><section id="${kind}Panel"></section></body></html>`);
 Object.assign(globalThis,{document,window,ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
 Object.defineProperty(document,'activeElement',{configurable:true,writable:true,value:document.body});
 Object.defineProperty(document,'hidden',{configurable:true,writable:true,value:false});
 Object.defineProperty(document,'pointerLockElement',{configurable:true,writable:true,value:null});
 window.innerWidth=width;window.innerHeight=height;
 const media=new Map();
 window.matchMedia=query=>{
  if(!media.has(query))media.set(query,{matches:query==='(pointer: coarse)'?coarse:query==='(any-pointer: coarse)'?anyCoarse:width<=1050||height<=760||anyCoarse,addEventListener(){},removeEventListener(){}});
  return media.get(query);
 };
 const event=(type,properties={})=>{const e=new window.Event(type,{bubbles:true,cancelable:true});for(const[key,value]of Object.entries(properties))Object.defineProperty(e,key,{value});return e;};
 window.HTMLElement.prototype.focus=function(){const previous=document.activeElement;if(previous===this)return;document.activeElement=this;previous?.dispatchEvent(event('focusout',{relatedTarget:this}));this.dispatchEvent(event('focusin',{relatedTarget:previous}));};
 const captures=new Map();
 window.HTMLElement.prototype.setPointerCapture=function(id){captures.set(id,this);};
 window.HTMLElement.prototype.releasePointerCapture=function(id){captures.delete(id);};
 const renderer={settings:{palette:4},clearCapData(){}};
 const frame={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1]};
 const frames=tee?null:Object.fromEntries(['a4c','plax','psax_papillary','me4c'].map(id=>[id,{...frame}]));
 const module=new (tee?TeeLabModule:ProbeLabModule)({mount:document.querySelector(`#${kind}Panel`),renderer,frames,donor});
 module.active=true;module.lastTick=0;module.drawGuide=()=>{};module.orientCamera=()=>{};module.invalidatePending=()=>{};
 module.poseChanged=()=>{module.ensureOrigin();module.updateUI();};
 const key=code=>module.mount.querySelector(`[data-${kind}-key="${code}"]`);
 const pointer=(target,type,id=1)=>target.dispatchEvent(event(type,{pointerId:id,button:0}));
 const resize=(w,h,{primary=coarse,any=anyCoarse}={})=>{window.innerWidth=w;window.innerHeight=h;media.get('(pointer: coarse)').matches=primary;media.get('(any-pointer: coarse)').matches=any;window.dispatchEvent(event('resize'));};
 return fixture={module,document,window,event,key,pointer,captures,resize,kind};
}

test.afterEach(()=>{
 fixture?.module.leave();fixture?.module.compactLayout.destroy();fixture=null;
 for(const[key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});

test('phones, narrow windows, short windows and touch-capable iPads qualify independently',()=>{
 for(const sample of [{width:390,height:844},{width:1024,height:1366},{width:1440,height:700},{width:1366,height:1024,coarse:true},{width:1366,height:1024,coarse:false,anyCoarse:true}])assert.equal(labCompactPolicy(sample).compact,true);
 assert.equal(labCompactPolicy({width:1440,height:900}).compact,false);
 assert.equal(labCompactPolicy({width:600,height:1000}).single,true);
 assert.equal(labCompactPolicy({width:601,height:1000}).single,false);
 assert.equal(labCompactPolicy({width:1366,height:1024,coarse:false,anyCoarse:true}).coarse,false,'A trackpad keeps key hints while touch capability still gets compact layout.');
});

for(const tee of [false,true])test(`${tee?'TEE':'TTE'} opens phone visuals first with one original, accessible control set`,()=>{
 const f=environment({tee}),m=f.module,layout=m.compactLayout,dock=m.mount.querySelector('.lab-compact-dock'),toolbar=m.mount.querySelector('.lab-compact-toolbar');
 assert.equal(layout.compact,true);assert.equal(layout.view,'scene');assert.equal(layout.controlsOpen,false);assert.equal(dock.hidden,true);assert.equal(toolbar.hidden,false);
 assert.equal(toolbar.nextElementSibling,m.mount.querySelector('.probe-workspace,.tee-workspace'));
 assert.equal(dock.contains(f.key('KeyW')),true);assert.equal(m.mount.querySelectorAll(`[data-${f.kind}-key="KeyW"]`).length,1);
 assert.ok(f.key('KeyW').getAttribute('aria-label').length>6);assert.equal(f.key('KeyW').getAttribute('aria-keyshortcuts'),'W');assert.ok(f.key('KeyW').querySelector('.lab-touch-key').textContent.length>3);
 assert.equal(!!toolbar.querySelector('option[value="chest"]'),!tee);
 assert.equal(m.mount.querySelector('.workspace-method-note').hasAttribute('open'),false);
 const ids=[...m.mount.querySelectorAll('[id]')].map(node=>node.id);assert.equal(new Set(ids).size,ids.length);
});

for(const tee of [false,true])test(`${tee?'TEE':'TTE'} moved touch controls steer, release capture when closed, and keep keyboard available`,()=>{
 const f=environment({tee}),m=f.module,layout=m.compactLayout;
 layout.setControlsOpen(true);const key=f.key('KeyE'),before=tee?m.state.multiplaneDeg:m.state.rollDeg;
 f.pointer(key,'pointerdown',41);assert.equal(f.captures.get(41),key);assert.equal(m.pointerControls.size,1);assert.ok((tee?m.state.multiplaneDeg:m.state.rollDeg)>before);
 layout.setControlsOpen(false);assert.equal(m.pointerControls.size,0);assert.equal(f.captures.size,0);assert.equal(f.document.activeElement,m.mount.querySelector('.lab-controls-toggle'));
 const stopped=tee?m.state.multiplaneDeg:m.state.rollDeg;m.tick(m.lastTick+40);assert.equal(tee?m.state.multiplaneDeg:m.state.rollDeg,stopped);
 f.document.dispatchEvent(f.event('keydown',{code:'KeyE'}));assert.ok((tee?m.state.multiplaneDeg:m.state.rollDeg)>stopped,'The closed drawer does not disarm page-level keyboard control.');
 f.document.dispatchEvent(f.event('keyup',{code:'KeyE'}));
});

for(const tee of [false,true])test(`${tee?'TEE':'TTE'} native presets share reviewed labels and selection with desktop controls`,()=>{
 const f=environment({tee,donor:{clinicalPresetsReviewed:false}}),m=f.module,select=m.mount.querySelector('[data-lab-compact="preset"]'),buttons=[...m.mount.querySelectorAll(`[data-${f.kind}-preset]`)];
 assert.equal(select.options.length,buttons.length);
 for(const button of buttons){const label=button.querySelector(`[data-${f.kind}-preset-label]`).textContent;assert.ok([...select.options].find(option=>option.value===button.dataset[`${f.kind}Preset`]).textContent.startsWith(label));}
 const id=buttons[1].dataset[`${f.kind}Preset`];pick(select,id);select.dispatchEvent(f.event('change'));
 assert.equal(tee?m.state.teePreset:m.state.preset,id);assert.equal(buttons[1].getAttribute('aria-pressed'),'true');assert.equal(select.value,id);
 buttons[0].dispatchEvent(f.event('click'));assert.equal(select.value,buttons[0].dataset[`${f.kind}Preset`]);
});

for(const tee of [false,true])test(`${tee?'TEE':'TTE'} opening Steer preserves the chosen paired or single visual and probe pose`,()=>{
 const f=environment({tee}),m=f.module,layout=m.compactLayout,select=m.mount.querySelector('[data-lab-compact="view"]');
 const originalPose=JSON.stringify(m.state);
 for(const pane of ['both','image','scene',...(tee?[]:['chest'])]){
  pick(select,pane);select.dispatchEvent(f.event('change'));
  layout.setControlsOpen(true);
  assert.equal(layout.view,pane);assert.equal(select.value,pane);
  assert.equal(m.mount.classList.contains('lab-controls-open'),true);
  f.resize(820,1180);assert.equal(layout.view,pane);assert.equal(layout.controlsOpen,true);
  layout.setControlsOpen(false);assert.equal(layout.view,pane);
  assert.equal(m.mount.classList.contains('lab-controls-open'),false);
  f.resize(390,844);assert.equal(layout.view,pane);
  assert.equal(JSON.stringify(m.state),originalPose,'Presentation must not reset the accepted acquisition or its parameters.');
 }
});

for(const tee of [false,true])test(`${tee?'TEE':'TTE'} breakpoint transitions restore the same nodes and stop hidden holds`,()=>{
 const f=environment({tee,width:1440,height:1000,coarse:false}),m=f.module,key=f.key('KeyW'),group=m.mount.querySelector(tee?'.tee-hand-controls':'.probe-keyboard-console'),parent=group.parentNode,next=group.nextSibling;
 assert.equal(m.compactLayout.compact,false);key.focus();
 f.resize(390,844,{primary:true,any:true});assert.equal(m.compactLayout.compact,true);assert.equal(m.compactLayout.view,'scene');assert.equal(f.document.activeElement,m.mount.querySelector('.lab-controls-toggle'));
 m.compactLayout.setControlsOpen(true);f.pointer(key,'pointerdown',13);assert.equal(m.pointerControls.size,1);
 f.resize(1440,1000,{primary:false,any:false});assert.equal(m.compactLayout.compact,false);assert.equal(m.pointerControls.size,0);assert.equal(f.captures.size,0);assert.equal(group.parentNode,parent);assert.equal(group.nextSibling,next);assert.equal(f.key('KeyW'),key);
 const state=JSON.stringify(m.state);m.compactLayout.setPane('image',{user:true});f.resize(390,844,{primary:true,any:true});assert.equal(m.compactLayout.view,'image');assert.equal(JSON.stringify(m.state),state,'Presentation changes do not create a second probe pose.');
});

test('wide iPad with a trackpad stays compact and exposes both synchronized visuals',()=>{
 const f=environment({tee:true,width:1366,height:1024,coarse:false,anyCoarse:true});
 assert.equal(f.module.compactLayout.compact,true);assert.equal(f.module.compactLayout.view,'both');assert.equal(f.module.mount.classList.contains('lab-touch'),false);
 const angles=f.module.mount.querySelector('.tee-mechanical-controls');assert.ok(angles.closest('.lab-compact-adjustments'));assert.equal(angles.closest('details').hasAttribute('open'),false);
 f.module.compactLayout.setControlsOpen(true);const range=angles.querySelector('[data-tee-range="multiplaneDeg"]');range.value='37';range.dispatchEvent(f.event('input'));assert.equal(f.module.state.multiplaneDeg,37);
});

test('compact Chest renders the accepted pose even when the main 3D canvas has no dimensions',()=>{
 const f=environment(),m=f.module;let rendered;
 m.geometry={longestMm:160};m.frameForState=()=>null;
 const acceptedPose={originMm:[1,2,3],right:[1,0,0],up:[0,1,0],beam:[0,0,1]},acceptedState={...m.state,tiltDeg:12};
 m.displayedFrame={pose:acceptedPose,state:acceptedState,poseRevision:7};m.displayedId=3;m.state.tiltDeg=24;m.poseRevision=9;
 m.torsoView={revision:1,render:value=>{rendered=value;},setActive(){}};
 m.renderer.canvas={getBoundingClientRect(){throw Error('A hidden main canvas must not gate the Chest panel.');}};
 m.compactLayout.setPane('chest',{emit:false});m.guideKey='';ProbeLabModule.prototype.drawGuide.call(m);
 assert.equal(rendered.pose,acceptedPose);assert.equal(rendered.state,acceptedState);assert.equal(rendered.referenceMm,160);
});
