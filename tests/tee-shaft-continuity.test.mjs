import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTeeReference,teePathFrame,teePose,teeShaftAttachment} from '../public/tee-geometry.js';
import {createTeeContextModel} from '../public/tee-context-geometry.js';
import {TeeSceneOverlay,paintTeeFallback} from '../public/tee-scene.js';
import {probeModelMatrix} from '../public/probe-scene.js';
import {dot,cross,norm} from '../public/planes.js';

const raw=JSON.parse(readFileSync(new URL('../public/assets/echo-planes.json',import.meta.url)));
const frames=Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,f.world]));
const context=createTeeContextModel({frames,referenceMm:168.0104,donorId:'1659197537'});
const reference=createTeeReference(frames,168.0104,context),fallback=createTeeReference(frames,168.0104);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const near=(a,b,tolerance=1e-11)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<tolerance,`${a} != ${b}`));
const turns=points=>{const directions=points.slice(1).map((p,i)=>norm(sub(p,points[i])));return directions.slice(1).map((v,i)=>Math.acos(Math.max(-1,Math.min(1,dot(v,directions[i]))))*180/Math.PI);};
const screenshotState={insertionCm:33.8,shaftRotationDeg:-9,anteflexDeg:-21.5,lateralFlexDeg:-12,multiplaneDeg:0};

// Independent numerical snapshots from the pre-fix production pose. The
// illustration may change without moving the accepted acoustic acquisition.
test('reported default and combined-flexion extreme retain their acoustic coordinates',()=>{
 for(const fixture of [
  {state:screenshotState,origin:[50.514134504988945,-52.589530659177804,-17.48587974885085],beam:[-.4771909378101036,.872676280259085,.10356118358285096],right:[.4019817756284637,.32154912666838026,-.8573312144098042],normal:[-.7814726232789613,-.36748097775526967,-.5042402899942938],shaft:[.7814726232789613,.36748097775526967,.5042402899942938]},
  {state:{insertionCm:45,shaftRotationDeg:180,anteflexDeg:90,lateralFlexDeg:60,multiplaneDeg:120},origin:[70.83657334956848,41.47422014612102,1.0058550032595517],beam:[-.25629265925247907,-.8355984174580159,.4858902731635527],right:[-.9665455605304107,.22684281594739827,-.11971639934448827],normal:[-.0101858839698446,-.500317520775271,-.8657820893117615],shaft:[.8319600673494834,-.4466104016640807,-.3292136015739507]}
 ]){
  const pose=teePose(fixture.state,reference);
  near(pose.originMm,fixture.origin);near(pose.beam,fixture.beam);near(pose.right,fixture.right);near(pose.normal,fixture.normal);near(pose.instrument.shaft,fixture.shaft);
 }
});

test('the reported default no longer has a right-angle shaft dogleg',()=>{
 const pose=teePose(screenshotState,reference),maximum=Math.max(...turns(pose.shaftPoints));
 // Pre-fix production maximum was 95.64394997871491 degrees; the routed
 // production centerline measures 3.631030852285085 degrees at this pose.
 assert.ok(maximum<4,`Default centerline turn ${maximum} degrees`);
 assert.ok(Math.abs(maximum-3.631030852285085)<1e-8);
});

function drawnShaft(pose,ref=reference){
 const view={begin(){},remove(){},draw(){},upload(vertices){return {vertices};}},overlay={view,head:[]};
 TeeSceneOverlay.prototype.drawGeometry.call(overlay,{basis:{},width:640,height:480,dpr:1,pose,reference:ref});
 return overlay.shaft.vertices;
}

function assertMesh(vertices){
 assert.ok(vertices.length>0);assert.equal(vertices.length%18,0);
 for(let i=0;i<vertices.length;i+=18){
  const a=Array.from(vertices.slice(i,i+3)),b=Array.from(vertices.slice(i+6,i+9)),c=Array.from(vertices.slice(i+12,i+15));
  assert.ok(Math.hypot(...cross(sub(b,a),sub(c,a)))>1e-8,'Every production shaft triangle has positive area.');
  for(let j=0;j<18;j+=6){
   assert.ok(Array.from(vertices.slice(i+j,i+j+6)).every(Number.isFinite));
   assert.ok(Math.abs(Math.hypot(...vertices.slice(i+j+3,i+j+6))-1)<1e-5,'Shaft normals remain finite unit vectors.');
  }
 }
}

test('full insertion range and combined control extremes have smooth necks and nondegenerate production meshes',()=>{
 for(const ref of [reference,fallback])for(const insertionCm of [ref.minInsertionCm,33.8,35,45,ref.maxInsertionCm])for(const shaftRotationDeg of [-180,-90,0,90,180])for(const anteflexDeg of [-65,0,90])for(const lateralFlexDeg of [-60,0,60]){
  const state={insertionCm,shaftRotationDeg,anteflexDeg,lateralFlexDeg,multiplaneDeg:0},pose=teePose(state,ref),points=pose.shaftPoints;
  for(let i=1;i<points.length;i++)assert.ok(Math.hypot(...sub(points[i],points[i-1]))>1e-6);
  assert.ok(Math.max(...turns(points.slice(-50)))<20,`Distal join bends too sharply: ${JSON.stringify(state)}`);
  near(norm(sub(points.at(-1),points.at(-2))),pose.instrument.shaft);
  near(points.at(-1),teeShaftAttachment(pose.instrument,ref.scale));
  // Transform the real head's original local neck anchor independently.
  const matrix=probeModelMatrix(pose.instrument,.60*ref.scale);
  near(points.at(-1),[0,1,2].map(i=>matrix[12+i]+11*matrix[4+i]+6*matrix[8+i]),1e-5);
  assertMesh(drawnShaft(pose,ref));
 }
});

test('shallow source-only entry extends proximally instead of folding back onto the head',()=>{
 for(const insertionCm of [fallback.minInsertionCm,fallback.minInsertionCm+1,fallback.minInsertionCm+2,fallback.minInsertionCm+3]){
  const pose=teePose({insertionCm,shaftRotationDeg:0,anteflexDeg:0,lateralFlexDeg:0,multiplaneDeg:0},fallback),shaft=teePathFrame(fallback,insertionCm).shaft;
  for(let i=1;i<pose.shaftPoints.length;i++)assert.ok(dot(sub(pose.shaftPoints[i],pose.shaftPoints[i-1]),shaft)>0,'Shallow straight entry advances continuously toward the head.');
 }
});

test('world-axis crossings do not collapse or flip production tube rings',()=>{
 const pose=teePose(screenshotState,reference);
 for(const points of [
  [[0,0,0],[0,0,1],[1,0,0],[2,0,1]],
  Array.from({length:41},(_,i)=>{const t=(i-20)/10;return [.05*t*t,t,0];})
 ])assertMesh(drawnShaft({...pose,shaftPoints:points}));
});

test('electronic rotation cannot change the visual shaft or the mechanical head',()=>{
 const zero=teePose(screenshotState,reference);
 for(const multiplaneDeg of [45,90,120,180]){
  const pose=teePose({...screenshotState,multiplaneDeg},reference);
  assert.deepEqual(pose.shaftPoints,zero.shaftPoints);assert.deepEqual(pose.instrument,zero.instrument);
 }
});

test('both software branches connect the rear neck with a solid head in side view',()=>{
 const instrument={originMm:[0,0,0],right:[1,0,0],normal:[0,1,0],beam:[0,0,-1],shaft:[0,-1,0]};
 const project=p=>({x:32+2*p[1],y:32+2*p[2],depth:100+p[0]});
 const contains=(polygon,x,y)=>{let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
 for(const rearAttachment of [true,false]){
  const end=rearAttachment?teeShaftAttachment(instrument):instrument.originMm,pose={originMm:instrument.originMm,instrument,shaftPoints:[[0,20,end[2]],end]};
  for(const depthEnabled of [false,true]){
   let path=[],image=null;const fills=[];
   const surface={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),setTransform(){},putImageData(value){image=value;}};
   const ctx={canvas:{width:64,height:64,ownerDocument:{createElement:()=>({width:64,height:64,getContext:()=>surface})}},getTransform:()=>({a:1,b:0,c:0,d:1}),beginPath(){path=[];},moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},closePath(){},stroke(){},fill(){fills.push(path);},save(){},restore(){},drawImage(){}};
   const occlusion=depthEnabled?{width:64,height:64,data:new Float32Array(64*64).fill(Infinity)}:null;
   paintTeeFallback(ctx,project,pose,1,{occlusion});
   // This side-view point lies between the acoustic face and rear neck;
   // the old zero-thickness head left it unpainted in both fallback paths.
   if(depthEnabled)assert.ok(image?.data[(36*64+44)*4+3]>0,'Depth-aware head fills the rear attachment gap.');
   else assert.ok(fills.some(p=>contains(p,44.5,36.5)),'Canvas head fills the rear attachment gap.');
  }
 }
});
