// Focused checks for the coupled scan / cut-plane coordinate contract.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {orthogonalFrame,sourceToWorld,worldToSource,dot,cross,clipPlane} from '../public/planes.js';
import {VolumeRenderer} from '../public/renderer.js';
import {EchoModule} from '../public/echo.js';
import {croppedSectionFrame,sectionImageRect,sectionLayout} from '../public/section-layout.js';
const root=new URL('../',import.meta.url),extent=[474/529,1,474/529];
const near=(a,b,epsilon=1e-7)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
for(const source of [[0,0,0],[1,1,1],[.13,.71,.44]])worldToSource(sourceToWorld(source,extent),extent).forEach((v,i)=>near(v,source[i]));
for(let axis=0;axis<3;axis++){
 const frame=orthogonalFrame(axis,.61,extent);
 const camera={camera:{distance:1.55},requestRender(){},onChange(){}};
 VolumeRenderer.prototype.alignPlane.call(camera,frame.normal,frame.up,frame.center);
 const basis=VolumeRenderer.prototype.basis.call(camera);
 near(dot(basis.up,frame.up),1);near(dot(basis.right,frame.right),1);near(dot(basis.forward,frame.normal),-1);
 const plane=clipPlane({clipAxis:axis,clipPosition:.61,clipFlip:[1,0,1][axis]},extent);
 near(dot(plane.normal,frame.normal),1);near(dot(plane.normal,frame.center),plane.distance);
 // Asymmetric off-center crops must not resize the anatomy or shift the clipping plane.
 const ultra={width:601,height:801,fullWidth:1897,fullHeight:axis===2?1897:2117,crop:[520,410,601,801]};
 const crop=croppedSectionFrame(frame,ultra),rect=sectionImageRect(ultra),layout=sectionLayout(ultra);
 for(const [col,row] of [[0,0],[600,800],[73,317]]){
  const u=(520+col)/(ultra.fullWidth-1),v=(410+row)/(ultra.fullHeight-1);
  const src=axis===0?[.61,u,v]:axis===1?[u,.61,v]:[u,v,.61],expected=sourceToWorld(src,extent);
  const actual=crop.center.map((c,i)=>c+crop.right[i]*(col/600-.5)*crop.width+crop.up[i]*(.5-row/800)*crop.height);
  actual.forEach((p,i)=>near(p,expected[i]));
  near(rect.x+(col+.5)/ultra.width*rect.width,u);near(rect.y+(row+.5)/ultra.height*rect.height,v);
  near((layout.x+col)*layout.stepU,u);near((layout.y+row)*layout.stepV,v);
 }
 const detail={width:301,height:401,fullWidth:949,fullHeight:(ultra.fullHeight+1)/2,crop:[260,205,301,401]};
 const detailFrame=croppedSectionFrame(frame,detail);
 detailFrame.center.forEach((p,i)=>near(p,crop.center[i]));near(detailFrame.width,crop.width);near(detailFrame.height,crop.height);
 const empty=croppedSectionFrame(frame,{width:1,height:1,fullWidth:1897,fullHeight:2117,crop:[0,0,1,1]});
 assert.ok(empty.width>0&&empty.height>0&&empty.center.every(Number.isFinite));
}
const frames=JSON.parse(fs.readFileSync(new URL('public/assets/echo-planes.json',root),'utf8')).frames;
const rolled={camera:{yaw:.2,pitch:.15,roll:Math.PI/2,distance:1.5,pan:[0,0,0]},basis:VolumeRenderer.prototype.basis};
const before=rolled.basis();VolumeRenderer.prototype.orbit.call(rolled,20,0);const after=rolled.basis();
near(Math.acos(dot(before.forward,after.forward)),.16);near(dot(after.right,after.up),0);
assert.equal(Object.keys(frames).length,13);
for(const [id,value] of Object.entries(frames)){
 const p=value.world;for(const v of [p.normal,p.right,p.up])near(Math.hypot(...v),1);
 near(dot(p.right,p.up),0);near(dot(cross(p.right,p.up),p.normal),1);
 const echo={state:{preset:id,offsetMm:17,rotationDeg:39,tiltDeg:-23},frames:{[id]:p},longestMm:168.0104,frameKey:()=>id};
 const adjusted=EchoModule.prototype.getPlane.call(echo);
 near(Math.hypot(...adjusted.center.map((x,i)=>x-p.center[i]))*echo.longestMm,17,1e-6);
 near(dot(cross(adjusted.right,adjusted.up),adjusted.normal),1);
}
// An asymmetric measured-value phantom detects axis swaps and vertical flips in MPR.
let result;const context={Uint8Array,Math,onmessage:null,postMessage:m=>{result=m;}};
vm.runInNewContext(fs.readFileSync(new URL('public/mpr-worker.js',root),'utf8'),context);
const phantom=new Uint8Array(125);for(let z=0;z<5;z++)for(let y=0;y<5;y++)for(let x=0;x<5;x++)phantom[x+5*(y+5*z)]=20*x+5*y+2*z;
context.onmessage({data:{type:'load',data:phantom,dimensions:[5,5,5],extent:[1,1,1]}});
context.onmessage({data:{type:'sample',id:1,width:5,height:5,plane:orthogonalFrame(2,.5,[1,1,1])}});
for(let y=0;y<5;y++)for(let x=0;x<5;x++)assert.equal(result.data[x+5*y],20*x+5*y+4);
console.log('PASS: source/world round trips; X/Y/Z crop, canvas, annotation and cut-plane alignment; exact Ultra/detail registration; empty crops; 13 oblique bases; physical offsets; and MPR pixel orientation.');
