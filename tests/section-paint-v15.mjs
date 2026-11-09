/** Native CT pixels must survive the packed, reusable section painter exactly. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {paintSectionPixels} from '../public/section-paint.js';
import {AppearanceController} from '../public/appearance.js';
import {capColor,capAnatomyColor,buildAnatomyPalette,cutFaceExposure,exposeCutIntensity} from '../public/render-styles.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const base={palette:4,threshold:.28,cleanupEnabled:true,windowEnabled:false,windowLow:.1,windowHigh:.8,windowGamma:.9,capContrast:1.8,cutFaceExposure:1.35,anatomyOpacity:.65,anatomySelected:0};
const labels=[{id:0,color:'#788b82'},{id:1,color:'#e7a89d'},{id:2,color:'#8dbfdc'},{id:4,color:'#b8a1d3'}];
const makeMap=(dimensions,fn)=>({dimensions,data:Uint8Array.from({length:dimensions.reduce((a,b)=>a*b,1)},(_,i)=>fn(i%dimensions[0],Math.floor(i/dimensions[0])%dimensions[1],Math.floor(i/(dimensions[0]*dimensions[1]))))});
const cleanup=makeMap([7,9,11],(x,y,z)=>(x+2*y+3*z)%5!==0?1:0);
const anatomy={...makeMap([11,7,5],(x,y,z)=>[0,1,2,4,255][(3*x+y+2*z)%5]),labels};

// Deliberately scalar: independent XYZ sampling, with no projected rows, spans,
// packed words or color cache. Existing transfer tests cover the shared style math.
function scalarReference(data,width,height,axis,position,section,settings,clean,regions){
 const out=new Uint8ClampedArray(width*height*4),colors=buildAnatomyPalette(regions?.palette||regions?.labels);
 const sample=(map,xyz)=>{const [nx,ny,nz]=map.dimensions,[x,y,z]=xyz.map((v,i)=>Math.round(clamp(v,0,1)*(map.dimensions[i]-1)));return map.data[x+nx*(y+ny*z)];};
 const cut=section.crop??[0,0],uAxis=axis===0?1:0,vAxis=axis===2?1:2;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,j=i*4,xyz=[0,0,0];xyz[axis]=position;
  // Preserve the existing reciprocal-multiply rounding at half-voxel boundaries.
  xyz[uAxis]=(cut[0]+x)*(1/Math.max(1,(section.fullWidth??width)-1));
  xyz[vAxis]=(cut[1]+y)*(1/Math.max(1,(section.fullHeight??height)-1));
  out[j+3]=255;if(clean&&settings.cleanupEnabled!==false&&!sample(clean,xyz))continue;
  const byte=data[i],value=byte/255,hasRegions=settings.palette===5&&!!regions;
  let id=hasRegions?sample(regions,xyz):0;
  if(id>Math.max(1,...(regions?.labels||[]).map(label=>label.id)))id=0;
  if(settings.windowEnabled===true){
   let color=byte&&!(settings.palette===4&&value<settings.threshold)?capColor(value,settings.capContrast??1,settings.palette,settings):[0,0,0];
   if(hasRegions&&value>settings.threshold)color=capAnatomyColor(color,id,colors,settings.anatomyOpacity??.65,settings.anatomySelected||0);
   for(let c=0;c<3;c++)out[j+c]=Math.pow(Math.max(0,color[c]),.89)*255;
  }else{
   let gray=clamp((value-.04)/.86,0,1)*255;
   if(settings.palette===4)gray=value<settings.threshold?0:clamp((value-.38)*1.8+.55,.05,1)*255;
   if(cutFaceExposure(settings)!==1)gray=exposeCutIntensity(gray/255,cutFaceExposure(settings))*255;
   let color=[gray,gray,gray];
   if(hasRegions&&gray>1&&value>settings.threshold){
    const label=regions.labels.find(label=>label.id===id),selected=settings.anatomySelected||0;
    if(label){
     const active=!selected||selected===id,alpha=(settings.anatomyOpacity??.65)*(active?1:.18),scale=.35+.65*gray/255,shade=active?1:.45;
     color=[1,3,5].map(n=>(gray*(1-alpha)+parseInt(label.color.slice(n,n+2),16)*scale*alpha)*shade);
    }else if(selected)color=color.map(v=>v*.4);
   }
   out.set(color,j);
  }
 }
 return out;
}

test('full native pixels and projected support/labels agree on cropped X/Y/Z planes',()=>{
 let cases=0;
 for(const [width,height,crop,fullWidth,fullHeight]of [[37,29,null,37,29],[31,23,[8,4,31,23],57,49],[1,1,null,1,1]]){
  const data=Uint8Array.from({length:width*height},(_,i)=>(i*71+Math.floor(i/width)*31)%256),before=Uint8Array.from(data);
  const section={width,height,fullWidth,fullHeight,...(crop?{crop}:{})};
  for(const axis of [0,1,2])for(const position of [-.1,.37,1.1])for(const palette of [2,4,5])for(const windowEnabled of [false,true])for(const mask of [null,cleanup]){
   const settings={...base,palette,windowEnabled,anatomySelected:cases%2?2:0},target=new Uint8ClampedArray(width*height*4).fill(231);
   const actual=paintSectionPixels(data,width,height,axis,position,section,settings,mask,anatomy,target);
   assert.equal(actual,target);
   assert.deepEqual(actual,scalarReference(data,width,height,axis,position,section,settings,mask,anatomy),`case ${cases}: axis ${axis}, palette ${palette}, position ${position}`);cases++;
  }
  assert.deepEqual(data,before,'Input CT bytes are read-only.');
 }
 assert.equal(cases,324);
});

test('reused RGBA storage overwrites masked tissue and accepts aligned subarrays safely',()=>{
 const width=16,height=4,data=new Uint8Array(width*height).fill(180),section={width,height},target=new Uint8ClampedArray(new ArrayBuffer(width*height*4+8),4,width*height*4);
 const mask={dimensions:[1,1,1],data:new Uint8Array([1])};
 assert.equal(paintSectionPixels(data,width,height,2,.5,section,base,mask,null,target),target);
 assert.ok(target.some((value,i)=>i%4<3&&value>0));mask.data[0]=0;
 paintSectionPixels(data,width,height,2,.5,section,base,mask,null,target);
 for(let i=0;i<target.length;i+=4)assert.deepEqual([...target.subarray(i,i+4)],[0,0,0,255]);
 const unaligned=new Uint8ClampedArray(new ArrayBuffer(target.length+1),1,target.length);
 assert.notEqual(paintSectionPixels(data,width,height,2,.5,section,base,null,null,unaligned),unaligned);
 assert.equal(paintSectionPixels(data,width,height,2,.5,section,base,null,null,new Uint8ClampedArray(4)).length,target.length);
});

test('cached palettes respond to window, threshold, selection and in-place label changes',()=>{
 const width=256,height=2,data=Uint8Array.from({length:width*height},(_,i)=>i%256),section={width,height},regions={...anatomy,labels:structuredClone(labels)};
 const changes=[{}, {cutFaceExposure:2.7}, {threshold:.6}, {windowEnabled:true}, {windowHigh:.6}, {windowLow:.3}, {windowGamma:1.8}, {capContrast:.8}, {anatomySelected:2}, {anatomyOpacity:.9}, {windowEnabled:false}];
 const settings={...base,palette:5};
 for(const change of changes){
  Object.assign(settings,change);
  assert.deepEqual(paintSectionPixels(data,width,height,2,.5,section,settings,null,regions),scalarReference(data,width,height,2,.5,section,settings,null,regions));
 }
 regions.labels[2].color='#ef7612';
 assert.deepEqual(paintSectionPixels(data,width,height,2,.5,section,settings,null,regions),scalarReference(data,width,height,2,.5,section,settings,null,regions));
 settings.windowEnabled=true;regions.palette=regions.labels.map(label=>({id:label.id,color:[1,3,5].map(n=>parseInt(label.color.slice(n,n+2),16)/255)}));
 for(let i=0;i<2;i++){
  assert.deepEqual(paintSectionPixels(data,width,height,2,.5,section,settings,null,regions),scalarReference(data,width,height,2,.5,section,settings,null,regions));
  regions.palette[2].color=[.2,.7,.4];
 }
});

test('the canvas painter reuses ImageData and avoids same-size canvas resets',()=>{
 const saved=globalThis.ImageData;let allocations=0,width=8,height=4,resets=0,contextGets=0;const uploads=[];
 globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});allocations++;}};
 const context={putImageData(image){uploads.push(image);}};
 const canvas={get width(){return width;},set width(v){width=v;resets++;},get height(){return height;},set height(v){height=v;resets++;},getContext(){contextGets++;return context;}};
 const controller={renderer:{settings:{...base}},cleanup:null,anatomy:null};
 try{
  const paint=(value,w=8,h=4)=>AppearanceController.prototype.paintSection.call(controller,canvas,new Uint8Array(w*h).fill(value),w,h,2,.5);
  assert.equal(paint(150),canvas);const first=Uint8ClampedArray.from(uploads[0].data);paint(200);
  assert.equal(resets,0);assert.equal(allocations,1);assert.equal(contextGets,1);assert.equal(uploads[0],uploads[1]);
  assert.notDeepEqual(uploads[1].data,first,'A reused ImageData contains the new section.');
  paint(0,10,6);assert.equal(resets,2);assert.equal(allocations,2);assert.equal(uploads[2].data.length,10*6*4);
  assert.notEqual(uploads[2],uploads[1]);
 }finally{globalThis.ImageData=saved;}
});

test('alternating crop shapes share bounded backing storage without stale pixels',()=>{
 const saved=globalThis.ImageData;globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
 let output;const canvas={width:0,height:0,getContext:()=>({putImageData(image){output=image;}})},controller={renderer:{settings:{...base}},cleanup,anatomy};
 let backing,highWater=0;
 try{
  for(const [i,[width,height]]of [[8,4],[10,6],[5,12],[200,100],[7,9],[10,6]].entries()){
   const data=Uint8Array.from({length:width*height},(_,n)=>(n*71+i*31)%256),section={width,height},settings={...base,palette:[4,2,5][i%3],cleanupEnabled:i%2===0,windowEnabled:i%2!==0};
   controller.renderer.settings=settings;
   AppearanceController.prototype.paintSection.call(controller,canvas,data,width,height,1,.37,section);
   assert.equal(canvas.width,width);assert.equal(canvas.height,height);assert.equal(output.width,width);assert.equal(output.height,height);
   assert.equal(output.data.byteLength,width*height*4,'Only the exact crop view is uploaded.');
   assert.deepEqual(output.data,scalarReference(data,width,height,1,.37,section,settings,cleanup,anatomy));
   const required=width*height*4;
   if(backing&&required<=backing.byteLength)assert.equal(output.data.buffer,backing,'A smaller or differently shaped crop reuses existing storage.');
   else if(backing)assert.notEqual(output.data.buffer,backing,'Growth allocates a replacement, without retaining prior buffers.');
   highWater=Math.max(highWater,required);backing=output.data.buffer;
   assert.ok(backing.byteLength>=highWater&&backing.byteLength<highWater+65536,'At most one 64 KiB block beyond the largest encountered crop.');
  }
 }finally{globalThis.ImageData=saved;}
});
