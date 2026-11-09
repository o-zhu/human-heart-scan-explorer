import {titleCaseUi} from '../public/ui-text.js';
// Import-stripping DOM fixtures still use the production display-label helper.
const uiFunction=(...args)=>new Function('titleCaseUi',...args).bind(null,titleCaseUi);
/** Real Appearance events, camera controls and source picking in a DOM fixture. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {DONORS} from '../public/donors.js';
import {VolumeRenderer} from '../public/renderer.js';
import {getWindowPresets,matchWindowPreset} from '../public/window-presets.js';

const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const html=await readFile(new URL('../page.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../public/appearance.js',import.meta.url),'utf8'))
  .replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');

async function fixture(){
  const {document,window}=parseHTML(html),donor=DONORS[0];
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,
    get(){return this._value??this.querySelector('option')?.value??'';},set(value){this._value=String(value);}});
  const labels=[
    {id:0,name:'Unclassified tissue',color:'#eeeeee'},
    {id:1,name:'Left ventricular tissue',color:'#e3a48e',description:'Approximate left ventricular tissue.'},
    {id:2,name:'Right ventricular tissue',color:'#9bbcb1',description:'Approximate right ventricular tissue.'},
  ];
  const annotation={manifest:{datasetId:donor.datasetId,specimen:donor.specimen},labels,
    dimensions:[5,5,5],data:Uint8Array.from({length:125},(_,i)=>[1,1,0,2,2][i%5])};
  let timerId=0,changeCount=0,pickCount=0;const timers=new Map(),renders=[];
  const Controller=uiFunction('document','loadAnatomy','paintSectionPixels','scanActivity',
    'setTimeout','clearTimeout','getWindowPresets','matchWindowPreset',source+'\nreturn AppearanceController;')(
    document,async()=>annotation,()=>{}, {beginForeground:()=>()=>{}},
    callback=>{timers.set(++timerId,callback);return timerId;},id=>timers.delete(id),getWindowPresets,matchWindowPreset);
  const canvas=document.getElementById('volumeCanvas');
  canvas.getBoundingClientRect=()=>({left:10,top:20,width:400,height:400});
  canvas.setPointerCapture=()=>{};
  const renderer=Object.assign(Object.create(VolumeRenderer.prototype),{
    canvas,data:new Uint8Array(125).fill(255),dimensions:[5,5,5],extent:[1,1,1],
    settings:{mode:0,palette:4,threshold:.28,clipAxis:-1,clipFlip:0,cleanupEnabled:false,
      anatomyOpacity:.65,anatomySelected:0,...donor.displayWindow},
    camera:{yaw:0,pitch:0,roll:0,distance:2.5,pan:[0,0,0]},
    requestRender(kind){renders.push(kind);},queueFrame(){renders.push('frame');},onChange(){},
    setAnatomyData(value){this.anatomy=value;},
    inspectAt(x,y){pickCount++;return VolumeRenderer.prototype.inspectAt.call(this,x,y);},
  });
  // Match production ordering: the renderer handles capture/orbit before
  // Appearance receives the same pointer event on the shared canvas.
  renderer.bindControls();
  const appearance=new Controller({renderer,donor,onChange:()=>changeCount++});
  document.querySelector('[data-material="anatomy"]').dispatchEvent(new window.Event('click',{bubbles:true}));
  await appearance.anatomyPromise;timers.clear();changeCount=0;
  const pointer=(type,u=.3,v=.5,options={})=>{
    const {target=canvas,...init}=options,event=new window.Event(type,{bubbles:true,cancelable:true});
    Object.assign(event,{pointerId:1,pointerType:'mouse',isPrimary:true,button:0,
      buttons:type==='pointerup'||type==='pointercancel'?0:1,
      clientX:10+u*400,clientY:20+v*400,...init});
    target.dispatchEvent(event);return event;
  };
  const click=(u=.3,v=.5,options={})=>{pointer('pointerdown',u,v,options);pointer('pointerup',u,v,options);};
  const flush=()=>{for(const [id,callback]of timers){timers.delete(id);callback();}};
  return {document,window,renderer,canvas,appearance,annotation,pointer,click,flush,renders,
    get pickCount(){return pickCount;},get changeCount(){return changeCount;}};
}

function allColors(f,name='Reading the Colors'){
  assert.equal(f.renderer.settings.palette,5);
  assert.equal(f.renderer.settings.anatomySelected,0);
  assert.equal(f.document.getElementById('anatomyAll').getAttribute('aria-pressed'),'true');
  for(const button of f.document.querySelectorAll('[data-label-id]'))assert.equal(button.getAttribute('aria-pressed'),'false');
  assert.equal(f.document.getElementById('anatomySelectionName').textContent,name);
}

test('a real source hit selects a region, a second click deselects it, and a different region becomes selected',async()=>{
  const f=await fixture(),source=f.renderer.data.slice(),labels=f.annotation.data.slice();
  f.click();
  assert.equal(f.renderer.settings.anatomySelected,1);
  assert.equal(f.document.querySelector('[data-label-id="1"]').getAttribute('aria-pressed'),'true');
  assert.equal(f.document.getElementById('anatomyAll').getAttribute('aria-pressed'),'false');
  assert.equal(f.document.getElementById('anatomySelectionName').textContent,'Left Ventricular Tissue');
  f.click();allColors(f);f.flush();assert.equal(f.changeCount,1,'Deselecting refreshes the shared views.');
  f.click();f.click(.7,.5);
  assert.equal(f.renderer.settings.anatomySelected,2);
  assert.equal(f.document.querySelector('[data-label-id="1"]').getAttribute('aria-pressed'),'false');
  assert.equal(f.document.querySelector('[data-label-id="2"]').getAttribute('aria-pressed'),'true');
  assert.equal(f.document.getElementById('anatomySelectionDetail').textContent,'Approximate right ventricular tissue.');
  assert.deepEqual(f.renderer.data,source);assert.deepEqual(f.annotation.data,labels);
});

test('clicking empty space or unclassified measured tissue restores all colors',async()=>{
  const f=await fixture();
  f.click();assert.equal(f.renderer.settings.anatomySelected,1);
  f.click(.99,.01);allColors(f);
  f.click(.7,.5);assert.equal(f.renderer.settings.anatomySelected,2);
  f.click(.5,.5);allColors(f,'Unclassified Tissue');
  assert.equal(f.pickCount,4,'Both deselection cases use the actual source ray picker.');
});

test('camera orbit and pan never pick on release, including a drag that returns to its starting position',async()=>{
  const f=await fixture();f.click();const before=f.pickCount,camera=structuredClone(f.renderer.camera);
  f.pointer('pointerdown');f.pointer('pointermove',.6,.5);f.pointer('pointermove',.3,.5);f.pointer('pointerup');
  assert.equal(f.pickCount,before);assert.equal(f.renderer.settings.anatomySelected,1);
  for(const key of ['yaw','pitch','roll','distance'])assert.ok(Math.abs(f.renderer.camera[key]-camera[key])<1e-12,'This orbit returns to the same view, but still must not become a click.');
  assert.deepEqual(f.renderer.camera.pan,camera.pan);
  f.pointer('pointerdown');f.pointer('pointermove',.7,.5);f.pointer('pointerup',.7,.5);
  assert.equal(f.pickCount,before);assert.equal(f.renderer.settings.anatomySelected,1);
  assert.notEqual(f.renderer.camera.yaw,camera.yaw,'The normal renderer orbit still receives the gesture.');
  for(const options of [{button:2,buttons:2},{button:1,buttons:4},{shiftKey:true}]){
    f.pointer('pointerdown',.3,.5,options);f.pointer('pointermove',.4,.6,options);f.pointer('pointerup',.4,.6,{...options,buttons:0});
  }
  assert.equal(f.pickCount,before);assert.equal(f.renderer.settings.anatomySelected,1);
  assert.ok(f.renders.includes('camera'));
});

test('cumulative and coalesced motion cannot turn into a click while small click jitter is allowed',async()=>{
  const f=await fixture();f.click();const before=f.pickCount;
  f.pointer('pointerdown');f.pointer('pointermove',.31,.5);f.pointer('pointermove',.3,.5);f.pointer('pointerup');
  assert.equal(f.pickCount,before,'Four pixels out and back exceeds the click allowance.');
  f.pointer('pointerdown');
  f.pointer('pointermove',.3,.5,{getCoalescedEvents:()=>[{clientX:142,clientY:220},{clientX:130,clientY:220}]});
  f.pointer('pointerup');assert.equal(f.pickCount,before);
  f.pointer('pointerdown');f.pointer('pointermove',.3025,.5);f.pointer('pointerup',.3025,.5);
  assert.equal(f.pickCount,before+1);allColors(f);
});

test('cancellation, capture loss and stale pointer releases never change the selected region',async()=>{
  const f=await fixture();f.click();const before=f.pickCount;
  for(const type of ['pointercancel','lostpointercapture']){
    f.pointer('pointerdown');f.pointer(type);f.pointer('pointerup');
    assert.equal(f.pickCount,before);assert.equal(f.renderer.settings.anatomySelected,1);
  }
  f.pointer('pointerup');assert.equal(f.pickCount,before,'There is no reusable pointerdown after a release.');
  f.pointer('pointerdown');f.window.dispatchEvent(new f.window.Event('blur'));f.pointer('pointerup');
  assert.equal(f.pickCount,before);
  f.click();allColors(f);assert.equal(f.pickCount,before+1,'A fresh click works after cancellation.');
});

test('multitouch, non-primary contacts and contacts outside the canvas do not deselect',async()=>{
  const f=await fixture();f.click();const before=f.pickCount;
  const first={pointerType:'touch'},second={pointerId:2,pointerType:'touch',isPrimary:false};
  f.pointer('pointerdown',.3,.5,first);f.pointer('pointerdown',.7,.5,second);
  f.pointer('pointerup',.7,.5,second);f.pointer('pointerup',.3,.5,first);
  assert.equal(f.pickCount,before);assert.equal(f.renderer.settings.anatomySelected,1);
  f.pointer('pointerdown',.3,.5,first);f.pointer('pointerdown',.7,.5,{...second,target:f.document.body});
  f.pointer('pointerup',.3,.5,first);f.pointer('pointerup',.7,.5,{...second,target:f.document.body});
  f.click(.3,.5,second);assert.equal(f.pickCount,before);
  f.click(.3,.5,first);allColors(f);assert.equal(f.pickCount,before+1,'An ordinary one-finger tap is still a click.');
});

test('two-finger pan and pinch preserve selection after either finger releases first',async()=>{
 const f=await fixture();f.click();const before=f.pickCount;
 const first={pointerType:'touch'},second={pointerId:2,pointerType:'touch',isPrimary:false};
 for(const primaryFirst of [true,false]){
  const pan=f.renderer.camera.pan.slice(),orientation={yaw:f.renderer.camera.yaw,pitch:f.renderer.camera.pitch,roll:f.renderer.camera.roll};
  f.pointer('pointerdown',.3,.5,first);f.pointer('pointerdown',.7,.5,second);
  f.pointer('pointermove',.35,.6,first);f.pointer('pointermove',.8,.6,second);
  assert.notDeepEqual(f.renderer.camera.pan,pan,'The actual renderer pans during the gesture.');
  for(const key of Object.keys(orientation))assert.equal(f.renderer.camera[key],orientation[key],'Two-finger input does not orbit.');
  for(const which of primaryFirst?[first,second]:[second,first])f.pointer('pointerup',which===first?.35:.8,.6,which);
  assert.equal(f.pickCount,before);assert.equal(f.renderer.settings.anatomySelected,1);
 }
});

test('modified clicks, zoom, cursor capture and another palette leave selection alone',async()=>{
  const f=await fixture();f.click();const before=f.pickCount;
  for(const options of [{button:2,buttons:2},{button:1,buttons:4},{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true}])f.click(.3,.5,options);
  f.pointer('pointerdown');
  const wheel=new f.window.Event('wheel',{bubbles:true,cancelable:true});wheel.deltaY=20;f.canvas.dispatchEvent(wheel);f.pointer('pointerup');
  f.pointer('pointerdown');Object.defineProperty(f.document,'pointerLockElement',{configurable:true,value:f.document.body});
  f.document.dispatchEvent(new f.window.Event('pointerlockchange'));f.pointer('pointerup');
  Object.defineProperty(f.document,'pointerLockElement',{configurable:true,value:null});
  f.renderer.set({palette:4});f.click();
  assert.equal(f.pickCount,before);assert.equal(f.renderer.settings.anatomySelected,1);
});
