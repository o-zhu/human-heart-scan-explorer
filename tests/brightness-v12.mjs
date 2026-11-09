/** Display-only brightness must agree across CT views without changing acquisition data. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {capColor,anatomyColor,capAnatomyColor,cutFaceExposure,exposeCutIntensity,windowIntensity,windowParameters,buildAnatomyPalette} from '../public/render-styles.js';
import {paintSectionPixels} from '../public/section-paint.js';
import {paintEchoPreview} from '../public/echo.js';
import {ProbeLabModule} from '../public/probe-lab.js';

const profiles=[
 {id:'ladaf-2021-17',windowEnabled:false,windowLow:0,windowHigh:1,windowGamma:1,capContrast:1.8,threshold:.28,cutFaceExposure:1.15},
 {id:'s-20-29',windowEnabled:true,windowLow:500/3700,windowHigh:2300/3700,windowGamma:.9,capContrast:1,threshold:600/3700,cutFaceExposure:1.8},
 {id:'s-20-28',windowEnabled:true,windowLow:2162/7770,windowHigh:6562/7770,windowGamma:.9,capContrast:1,threshold:.32972972972972975,cutFaceExposure:1.8},
];
const ramp=Uint8Array.from({length:512},(_,i)=>i%256);
const grid={intensity:ramp,support:new Uint8Array(512).fill(1),labels:new Uint8Array(512),hasAnatomy:false,width:256,height:2};

test('exposure keeps endpoints, intensity order and the complete identity transfer',()=>{
 for(const exposure of [.5,1,1.15,1.8,3]){
  assert.equal(exposeCutIntensity(0,exposure),0);assert.equal(exposeCutIntensity(1,exposure),1);
  let previous=-1;
  for(let i=0;i<=4096;i++){
   const value=i/4096,mapped=exposeCutIntensity(value,exposure);
   assert.ok(mapped>previous,'No flat intensity bands or new clipping inside the display range.');
   if(exposure===1)assert.equal(mapped,value);
   if(exposure>1)assert.ok(mapped>=value);
   previous=mapped;
  }
 }
 for(const bad of [undefined,NaN,Infinity,-3,0,'2'])assert.equal(cutFaceExposure({cutFaceExposure:bad}),1);
 assert.equal(cutFaceExposure({cutFaceExposure:.1}),.5);assert.equal(cutFaceExposure({cutFaceExposure:20}),3);
 assert.equal(windowParameters({cutFaceExposure:1.8}).cutFaceExposure,1.8);
 for(const profile of profiles)for(let byte=0;byte<256;byte++)assert.equal(windowIntensity(byte/255,profile),windowIntensity(byte/255,{...profile,cutFaceExposure:1}),'Acquisition window and threshold inputs stay independent of exposure.');
});

test('the higher brightness keeps CT backgrounds and source bytes unchanged',()=>{
 const before=Uint8Array.from(ramp);
 for(const profile of profiles){
  const settings={...profile,palette:4};
  const old=paintEchoPreview(grid,{...settings,cutFaceExposure:1},settings.capContrast,buildAnatomyPalette());
  const next=paintEchoPreview(grid,settings,settings.capContrast,buildAnatomyPalette());
  let brighter=0;
  for(let i=0;i<ramp.length;i++){
   const j=i*4;
   if(ramp[i]/255<profile.threshold)assert.deepEqual([...next.slice(j,j+3)],[0,0,0]);
   for(let c=0;c<3;c++){assert.ok(next[j+c]>=old[j+c]);if(next[j+c]>old[j+c])brighter++;}
   assert.equal(next[j+3],old[j+3]);
  }
  assert.ok(brighter>150,profile.id+' must brighten a meaningful range of tissue values.');
 }
 assert.deepEqual(ramp,before);
});

test('windowed orthogonal, Echo and Probe CT agree with unchanged simulated ultrasound',()=>{
 const previous=globalThis.ImageData;
 globalThis.ImageData=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
 try{
  const output={},canvases=Object.fromEntries(['ct','ultrasound'].map(key=>[key,{getContext(){return {putImageData(image){output[key]=image.data;},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}};}}]));
  const probe={renderer:{settings:{},extent:[1,1,1]},appearance:null,geometry:{longestMm:50},$:key=>canvases[key],displayedFrame:{width:256,height:2,ct:ramp,ultrasound:Uint8Array.from(ramp,v=>255-v),pose:{},sector:{depthMm:50},state:{depthMm:50}}};
  let unchanged;
  for(const profile of profiles)for(let palette=0;palette<6;palette++)for(const exposure of [1,profile.cutFaceExposure,3]){
   const settings={...profile,palette,cutFaceExposure:exposure};probe.renderer.settings=settings;
   ProbeLabModule.prototype.paintImages.call(probe);
   const echo=paintEchoPreview(grid,settings,settings.capContrast,buildAnatomyPalette());
   assert.deepEqual(output.ct,echo,profile.id+' Probe/Echo palette '+palette);
   if(profile.windowEnabled){
    const section=paintSectionPixels(ramp,256,2,2,.5,{width:256,height:2},settings,null,null);
    assert.deepEqual(section,echo,profile.id+' section/Echo palette '+palette);
   }
   if(unchanged)assert.deepEqual(output.ultrasound,unchanged,'CT appearance must not change the ultrasound frame.');
   unchanged=Uint8ClampedArray.from(output.ultrasound);
  }
 }finally{globalThis.ImageData=previous;}
});

test('anatomy selection and labels remain registered while brightness changes',()=>{
 const width=256,height=7,intensity=Uint8Array.from({length:width*height},(_,i)=>i%256),labels=Uint8Array.from({length:width*height},(_,i)=>Math.floor(i/256));
 const snapshot=Uint8Array.from(labels),legend=buildAnatomyPalette().map((rgb,id)=>({id,color:'#'+rgb.map(c=>Math.round(c*255).toString(16).padStart(2,'0')).join('')}));
 const anatomy={dimensions:[width,height,1],data:labels,labels:legend},sectionGrid={intensity,support:new Uint8Array(intensity.length).fill(1),labels,hasAnatomy:true,width,height};
 for(const profile of profiles.filter(p=>p.windowEnabled))for(const selected of [0,1,2]){
  const settings={...profile,palette:5,anatomyOpacity:.65,anatomySelected:selected};
  const section=paintSectionPixels(intensity,width,height,2,.5,{width,height},settings,null,anatomy);
  const echo=paintEchoPreview(sectionGrid,settings,settings.capContrast,buildAnatomyPalette(legend));
  assert.deepEqual(section,echo);
 }
 assert.deepEqual(labels,snapshot);
});

test('colored cap highlights keep hue and stay below clipping at every donor brightness',()=>{
 const colors=buildAnatomyPalette();
 for(const profile of profiles)for(const exposure of [1,profile.cutFaceExposure,3])for(let id=1;id<=6;id++)for(let byte=0;byte<256;byte++){
  const base=capColor(byte/255,profile.capContrast,5,{...profile,cutFaceExposure:exposure});
  const plain=anatomyColor(base,id,colors),safe=capAnatomyColor(base,id,colors);
  assert.ok(safe.every(c=>c>=0&&c<1));
  for(let c=1;c<3;c++)assert.ok(Math.abs(safe[c]/safe[0]-plain[c]/plain[0])<1e-12,'RGB ratios must preserve the label hue.');
  if(Math.max(...plain)<=.94)assert.deepEqual(safe,plain,'No change below the highlight shoulder.');
 }
});

test('software raycaster cap agrees with shared brightness and keeps empty space unchanged',async()=>{
 const previousMessage=globalThis.onmessage,previousPost=globalThis.postMessage;let resolveFrame,rejectFrame;
 globalThis.onmessage=null;globalThis.postMessage=message=>{if(message.type==='frame')resolveFrame(message);else if(message.type==='error')rejectFrame(new Error(message.message));};
 try{
  await import('../public/cpu-worker.js');const send=data=>globalThis.onmessage({data});
  const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:1,height:1};
  send({type:'load',data:new Uint8Array(512).buffer,dimensions:[8,8,8]});
  const render=async(byte,settings)=>{
   send({type:'cap',cap:{data:new Uint8Array(4).fill(byte),width:2,height:2,plane}});
   const pending=new Promise((resolve,reject)=>{resolveFrame=resolve;rejectFrame=reject;});
   send({type:'render',id:byte,w:1,h:1,extent:[1,1,1],basis:{eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]},settings:{...settings,mode:0,clipAxis:3,clipFlip:0,showPlanes:0,oblique:plane,quality:'high',opacity:.8},fast:false});
   return [...new Uint8ClampedArray((await pending).pixels)].slice(0,3);
  };
  for(const profile of profiles)for(const palette of [2,4,5]){
   const settings={...profile,palette};
   for(const byte of [110,150,190,225])assert.deepEqual(await render(byte,settings),capColor(byte/255,settings.capContrast,palette,settings).map(c=>Math.round(Math.pow(c,.89)*255)));
   assert.deepEqual(await render(0,settings),await render(0,{...settings,cutFaceExposure:1}));
  }
  for(const id of [1,2,3,4,5,6]){
   const colors=buildAnatomyPalette();
   send({type:'anatomy',map:{dimensions:[1,1,1],data:new Uint8Array([id])},colors});
   for(const profile of profiles){
    const settings={...profile,palette:5,anatomyOpacity:.65};
    for(const byte of [120,190,240])assert.deepEqual(await render(byte,settings),capAnatomyColor(capColor(byte/255,settings.capContrast,5,settings),id,colors,.65,0).map(c=>Math.round(Math.pow(c,.89)*255)));
   }
  }
 }finally{globalThis.onmessage=previousMessage;globalThis.postMessage=previousPost;}
});
