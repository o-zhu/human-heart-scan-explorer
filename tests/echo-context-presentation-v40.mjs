import test from 'node:test';
import assert from 'node:assert/strict';
import {withHeartPriority,contextLabelMetrics,placeContextLabel} from '../public/echo-context-presentation.js';
import {depthRaster,depthTriangle,depthLine,depthPointVisible} from '../public/tee-software-depth.js';
import {TteScene} from '../public/tte-atlas-geometry.js';
import {TeeSceneOverlay} from '../public/tee-scene.js';

function depthScope(){
 let range=[0,1],writes=true;const gl={DEPTH_TEST:1,LEQUAL:2,CULL_FACE:3,FRONT:4,BACK:5,
  enable(){},disable(){},depthFunc(){},cullFace(){},depthRange(a,b){range=[a,b];},depthMask(value){writes=value;}};
 return {gl,get range(){return range;},get writes(){return writes;}};
}
test('heart-priority scope changes no allocation or camera and always restores depth state',()=>{
 const state=depthScope();withHeartPriority(state.gl,()=>{assert.deepEqual(state.range,[1,1]);assert.equal(state.writes,false);});
 assert.deepEqual(state.range,[0,1]);assert.equal(state.writes,true);
 assert.throws(()=>withHeartPriority(state.gl,()=>{throw new Error('draw failed');}),/draw failed/);
 assert.deepEqual(state.range,[0,1]);assert.equal(state.writes,true);
});

const basis={eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};
const pose={originMm:[0,0,0],referenceMm:168.0104,instrument:{originMm:[0,0,0],beam:[0,0,-1],right:[1,0,0],normal:[0,1,0]},shaftPoints:[[0,10,0],[0,0,0]]};
test('both real atlas scene methods isolate anatomy priority from the probe depth',()=>{
 for(const kind of ['tte','tee']){
  const state=depthScope(),calls=[],model={meshes:[]},context=[{id:'spine',center:[0,0,0],role:'surface'},{id:'outline',center:[0,0,0],role:'contour'}];
  const view={gl:state.gl,begin(){},draw(mesh){calls.push({id:mesh.id,range:state.range});}};
  if(kind==='tte'){
   TteScene.prototype.draw.call({active:true,params:{pose,contextModel:model,showContext:true,showProbe:true},view,probe:[{id:'probe'}],model,context,labels:{draw(){}}},{basis,width:800,height:600});
  }else{
   TeeSceneOverlay.prototype.drawGeometry.call({sharedDepth:true,view,head:[{id:'probe'}],shaft:{id:'shaft'},key:pose.shaftPoints.flat().map(x=>x.toFixed(5)).join(','),contextMeshes:context,setContext(){}},{basis,width:800,height:600,dpr:1,pose,reference:{referenceMm:168.0104,scale:1},showProbe:true,contextModel:model,showContext:true});
  }
  for(const draw of calls)assert.deepEqual(draw.range,draw.id==='probe'||draw.id==='shaft'?[0,1]:[1,1],kind+' '+draw.id);
  assert.deepEqual(state.range,[0,1]);assert.ok(calls.some(x=>x.id==='spine'));
 }
});

test('software anatomy cannot tint any heart/cap pixel even when in front; cavities and instruments retain their rules',()=>{
 const width=40,height=30,heart=new Float32Array(width*height).fill(Infinity);
 for(let y=5;y<25;y++)for(let x=8;x<32;x++)heart[y*width+x]=2;
 for(let y=12;y<18;y++)for(let x=17;x<23;x++)heart[y*width+x]=Infinity;
 const occlusion={width,height,data:heart,revision:1};
 const draw=(raster,depth)=>{const a={x:0,y:0,depth},b={x:40,y:0,depth},c={x:40,y:30,depth},d={x:0,y:30,depth};depthTriangle(raster,[a,b,c],[240,80,40,.4]);depthTriangle(raster,[a,c,d],[240,80,40,.4]);depthLine(raster,{x:0,y:15,depth},{x:40,y:15,depth},[255,255,255,.7],2);};
 for(const depth of [1,3]){
  const raster=depthRaster(occlusion,width,height,{backgroundOnly:true});draw(raster,depth);
  for(let i=0;i<heart.length;i++)if(Number.isFinite(heart[i]))assert.equal(raster.pixels[i*4+3],0,'accepted heart pixel '+i);
  assert.ok(raster.pixels[(15*width+20)*4+3]>0,'true open cavity');assert.ok(raster.pixels[(15*width+4)*4+3]>0,'outside the heart');
  assert.equal(depthPointVisible(occlusion,{x:12,y:15,depth},width,height,{backgroundOnly:true}),false);
 }
 const instrument=depthRaster(occlusion,width,height);draw(instrument,1);assert.ok(instrument.pixels[(15*width+12)*4+3]>0,'front probe retains real perspective depth');
});

test('labels use readable CSS sizes, responsive touch minimums, and nonoverlapping placement',()=>{
 const small=contextLabelMetrics(320,420,{coarsePointer:false}),touch=contextLabelMetrics(320,420,{coarsePointer:true}),large=contextLabelMetrics(1600,1000,{coarsePointer:false});
 assert.ok(small.fontSize>=12);assert.ok(touch.fontSize>=14);assert.ok(large.fontSize>small.fontSize&&large.fontSize<=15);
 assert.equal(touch.maxPriority,2);assert.equal(large.maxPriority,Infinity);
 const used=[],metrics=contextLabelMetrics(800,600,{coarsePointer:false}),box={width:135,height:metrics.height};
 for(let i=0;i<4;i++){
  const placed=placeContextLabel({x:400+i,y:200+i},box,800,600,used,metrics);if(!placed)continue;
  assert.ok(placed.x>=10&&placed.x+placed.width<=790);assert.ok(placed.y>=10&&placed.y+placed.height<=558);
 }
 assert.ok(used.length>=2);
 for(let i=0;i<used.length;i++)for(let j=i+1;j<used.length;j++){
  const a=used[i],b=used[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
 }
});
