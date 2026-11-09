/** Display-only windowing: renderer agreement, preserved source masks and legacy appearance. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {capColor,windowIntensity,windowParameters,buildAnatomyPalette} from '../public/render-styles.js';
import {paintSectionPixels} from '../public/section-paint.js';
import {paintEchoPreview,EchoModule} from '../public/echo.js';
import {ProbeLabModule} from '../public/probe-lab.js';

const profile={windowEnabled:true,windowLow:(36500-35893)/2641,windowHigh:1,windowGamma:1.1,capContrast:1,palette:4,threshold:.32,cleanupEnabled:true};
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const ramp=Uint8Array.from({length:512},(_,i)=>i%256),snapshot=Uint8Array.from(ramp);

function oldCap(value,contrast,palette){
 const v=clamp((value-.5)*contrast+.48,.025,.96);
 if(palette===3)return mix([.10,.18,.20],[.97,.94,.86],v);
 if(palette===4)return mix([.015,.035,.045],[.98,.96,.88],clamp((value-.48)*contrast*1.12+.58,.015,.98));
 if(palette===5)return mix([.09,.12,.14],[.87,.89,.89],v);
 return (palette===0?[1,.92,.8]:palette===1?[1,.68,.49]:[1,1,1]).map(t=>v*t);
}

test('legacy disabled profiles retain every encoded intensity and palette exactly',()=>{
 for(let palette=0;palette<6;palette++)for(const contrast of [.5,1.8,3])for(let byte=0;byte<256;byte++){
  assert.deepEqual(capColor(byte/255,contrast,palette),oldCap(byte/255,contrast,palette));
  assert.deepEqual(capColor(byte/255,contrast,palette,{...profile,windowEnabled:false}),oldCap(byte/255,contrast,palette));
 }
 for(const palette of [2,3,4]){
  const rgba=paintSectionPixels(ramp,256,2,2,.5,{width:256,height:2},{palette,threshold:.32},null,null);
  for(let i=0;i<ramp.length;i++){
   const value=ramp[i]/255,gray=palette===4?(value<.32?0:clamp((value-.38)*1.8+.55,.05,1)*255):clamp((value-.04)/.86)*255;
   assert.equal(rgba[i*4],new Uint8ClampedArray([gray])[0]);assert.equal(rgba[i*4+1],rgba[i*4]);assert.equal(rgba[i*4+2],rgba[i*4]);
  }
 }
});

test('the new donor window restores distinctions in the previously white myocardial range',()=>{
 const raw=[37534,37727,37894,38149],values=raw.map(v=>Math.round((v-35893)*255/2641)/255);
 const old=values.map(v=>capColor(v,1.8,4)),next=values.map(v=>capColor(v,1,4,profile));
 assert.deepEqual(old[1],old[2]);assert.deepEqual(old[2],old[3],'Original bright transfer loses these distinctions.');
 assert.ok(next.every((c,i)=>i===0||c[0]>next[i-1][0]));
 assert.ok(next[3][0]-next[1][0]>.15,'The fine high-intensity wall range must remain visible.');
 assert.equal(windowIntensity(profile.windowLow,profile),0);assert.equal(windowIntensity(1,profile),1);
 const sanitized=windowParameters({windowLow:1,windowHigh:0,windowGamma:NaN});
 assert.ok(sanitized.windowHigh>sanitized.windowLow);assert.equal(sanitized.windowGamma,1);
});

test('orthogonal and Echo CT pixels use identical enabled windowing for all palettes',()=>{
 const grid={intensity:ramp,support:new Uint8Array(ramp.length).fill(1),labels:new Uint8Array(ramp.length),hasAnatomy:false,width:256,height:2};
 for(let palette=0;palette<6;palette++)for(const capContrast of [.8,1,1.3]){
  const settings={...profile,palette,capContrast};
  const section=paintSectionPixels(ramp,256,2,2,.5,{width:256,height:2},settings,null,null);
  const echo=paintEchoPreview(grid,settings,capContrast,buildAnatomyPalette());
  assert.deepEqual(section,echo,`Palette ${palette}, contrast ${capContrast}`);
  for(let byte=0;byte<256;byte++)if(!byte||(palette===4&&byte/255<settings.threshold))assert.deepEqual([...section.slice(byte*4,byte*4+3)],[0,0,0]);
 }
 assert.deepEqual(ramp,snapshot,'Color transforms must not mutate measured intensities.');
});

test('Probe CT follows the same window while the predicted ultrasound frame stays unchanged',()=>{
 const previous=globalThis.ImageData;globalThis.ImageData=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
 try{
  const output={},canvases=Object.fromEntries(['ct','ultrasound'].map(key=>[key,{getContext(){return {putImageData(image){output[key]=image.data;},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}};}}]));
  const probe={renderer:{settings:profile,extent:[1,1,1]},appearance:null,geometry:{longestMm:50},$:key=>canvases[key],displayedFrame:{width:256,height:2,ct:ramp,ultrasound:Uint8Array.from(ramp,v=>255-v),pose:{},sector:{depthMm:50},state:{depthMm:50}}};
  ProbeLabModule.prototype.paintImages.call(probe);
  const expected=paintEchoPreview({intensity:ramp,support:new Uint8Array(512).fill(1),labels:new Uint8Array(512),hasAnatomy:false},profile,1,buildAnatomyPalette());
  assert.deepEqual(output.ct,expected);
  const unchanged=Uint8ClampedArray.from(output.ultrasound);
  probe.renderer.settings={...profile,windowLow:.4,windowHigh:.95,windowGamma:1.5};ProbeLabModule.prototype.paintImages.call(probe);
  assert.notDeepEqual(output.ct,expected);assert.deepEqual(output.ultrasound,unchanged,'Display window must not change the ultrasound simulation.');
  assert.deepEqual(ramp,snapshot);
 }finally{globalThis.ImageData=previous;}
});

test('windowed anatomy labels and selected-region emphasis agree between section modules',()=>{
 const width=256,height=16,intensity=Uint8Array.from({length:width*height},(_,i)=>i%256),labels=Uint8Array.from({length:width*height},(_,i)=>Math.floor(i/256));
 const legend=buildAnatomyPalette().map((rgb,id)=>({id,color:'#'+rgb.map(c=>Math.round(c*255).toString(16).padStart(2,'0')).join('')}));
 const anatomy={dimensions:[width,height,1],data:labels,labels:legend},grid={intensity,support:new Uint8Array(intensity.length).fill(1),labels,hasAnatomy:true,width,height};
 for(const selected of [0,2]){
  const settings={...profile,palette:5,anatomyOpacity:.65,anatomySelected:selected};
  const section=paintSectionPixels(intensity,width,height,2,.5,{width,height},settings,null,anatomy);
  const echo=paintEchoPreview(grid,settings,1,buildAnatomyPalette(legend));
  assert.deepEqual(section,echo);
 }
});

test('Echo restores donor contrast and keeps user contrast through global window changes',()=>{
 const nodes={material:{querySelector(){return null;}},cleanup:{},'region-legend':{}},renderer={settings:{...profile},set(values){Object.assign(this.settings,values);}};
 const echo=Object.assign(Object.create(EchoModule.prototype),{renderer,state:{contrast:1},donor:{},offsetLimitMm:35,active:false,appearance:null,$:name=>nodes[name],updateUI(){},updateReadouts(){this.readouts=(this.readouts||0)+1;}});
 echo.restore({preset:'a4c'});assert.equal(echo.state.contrast,1);assert.equal(renderer.settings.capContrast,1);
 echo.restore({preset:'a4c',contrast:1.25});renderer.set({windowLow:.3,windowGamma:1.2});echo.updateAppearance();
 assert.equal(echo.state.contrast,1.25);assert.equal(renderer.settings.capContrast,1.25);
 renderer.set({capContrast:.9});echo.updateAppearance();assert.equal(echo.state.contrast,.9);
 echo.restore({preset:'a4c'});assert.equal(echo.state.contrast,.9,'An unrelated state restore must not reinstate the old 1.8 default.');
});

test('software raycaster keeps the same threshold and uses the common cut-face transfer',async()=>{
 const previousMessage=globalThis.onmessage,previousPost=globalThis.postMessage;let resolveFrame,rejectFrame;
 globalThis.onmessage=null;globalThis.postMessage=message=>{if(message.type==='frame')resolveFrame(message);else if(message.type==='error')rejectFrame(new Error(message.message));};
 try{
  await import('../public/cpu-worker.js');const send=data=>globalThis.onmessage({data});
  const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:1,height:1};
  send({type:'load',data:new Uint8Array(8*8*8).buffer,dimensions:[8,8,8]});
  const settings={...profile,mode:0,clipAxis:3,clipFlip:0,showPlanes:0,oblique:plane,quality:'high',opacity:.8};
  const render=async byte=>{
   send({type:'cap',cap:{data:new Uint8Array(4).fill(byte),width:2,height:2,plane}});
   const pending=new Promise((resolve,reject)=>{resolveFrame=resolve;rejectFrame=reject;});
   send({type:'render',id:byte,w:1,h:1,extent:[1,1,1],basis:{eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]},settings,fast:false});
   return [...new Uint8ClampedArray((await pending).pixels)].slice(0,3);
  };
  for(const byte of [100,170,190,220]){
   const pixel=await render(byte),expected=capColor(byte/255,1,4,settings).map(c=>Math.round(Math.pow(c,.89)*255));
   assert.deepEqual(pixel,expected);
  }
  const before=await render(50);settings.windowLow=.6;settings.windowGamma=2;const after=await render(50);
  assert.deepEqual(after,before,'A below-threshold empty sample remains empty after windowing.');
 }finally{globalThis.onmessage=previousMessage;globalThis.postMessage=previousPost;}
});
