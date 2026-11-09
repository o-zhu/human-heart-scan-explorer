import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildAcceleration,validAcceleration} from '../public/render-v5-acceleration.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=process.argv[2]||'/workspace/data/heart-render-v5';fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(out,'original-u8.npy'));
const start=10+source.readUInt16LE(8),data=new Uint8Array(source.buffer,source.byteOffset+start,119581250);
const sourceHash=createHash('sha256').update(data).digest('hex');
const dimensions=[475,475,530],acceleration=buildAcceleration(data,dimensions);
assert(validAcceleration(acceleration,dimensions));assert.equal(acceleration.maxima.length,241200);
fs.writeFileSync(path.join(out,'maxima.raw'),acceleration.maxima);
fs.writeFileSync(path.join(out,'maxima.json'),JSON.stringify({...acceleration,maxima:undefined},null,2));
let seed=14567891;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const at=(x,y,z)=>data[x+475*(y+475*z)];
function tri(x,y,z){const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),jx=Math.min(ix+1,474),jy=Math.min(iy+1,474),jz=Math.min(iz+1,529),a=x-ix,b=y-iy,c=z-iz;return ((at(ix,iy,iz)*(1-a)+at(jx,iy,iz)*a)*(1-b)+(at(ix,jy,iz)*(1-a)+at(jx,jy,iz)*a)*b)*(1-c)+((at(ix,iy,jz)*(1-a)+at(jx,iy,jz)*a)*(1-b)+(at(ix,jy,jz)*(1-a)+at(jx,jy,jz)*a)*b)*c;}
for(let i=0;i<100000;i++){
 const q=dimensions.map((d,j)=>i<5000?Math.min(d-1,Math.floor(random()*((d-1)/8))*8+(i%2?1e-7:-1e-7)):random()*(d-1)).map(v=>Math.max(0,v));
 const p=q.map((v,j)=>Math.min(acceleration.dimensions[j]-1,Math.floor(v/8)));
 const max=acceleration.maxima[p[0]+60*(p[1]+60*p[2])];assert(tri(...q)<=max+1e-8,'Macrocell must bound interpolation, including its boundary');
}
const norm=a=>{const d=Math.hypot(...a);return a.map(v=>v/d);},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const offset=norm([-1,-.07,.35]),forward=offset.map(v=>-v),right=norm(cross(forward,[0,1,0])).map(v=>-v),up=cross(right,forward),eye=offset.map((v,i)=>v*1.1+[0,-.14,0][i]);
const extent=[474/529,1,474/529],basis={eye,forward,right,up};
const cleanup={data:new Uint8Array(zlib.gunzipSync(fs.readFileSync(root+'/public/assets/cleanup/heart-support.raw.gz'))),dimensions:[238,238,265]};
let resolveFrame,rejectFrame;globalThis.onmessage=null;globalThis.postMessage=m=>{if(m.type==='frame')resolveFrame?.(m);if(m.type==='error')rejectFrame?.(new Error(m.message));};
await import('../public/cpu-worker.js');const send=data=>globalThis.onmessage({data});
send({type:'load',data:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),dimensions,acceleration});send({type:'cleanup',map:cleanup});
const settings={mode:0,palette:4,threshold:.28,opacity:.8,clipAxis:0,clipPosition:.5,clipFlip:1,showPlanes:0,slices:[.5,.5,.5],quality:'auto',capContrast:1.8,cleanupEnabled:true,anatomyOpacity:.65,anatomySelected:0,surfaceSmoothing:1};
let id=0;async function frame(extra={},fast=false,w=160,h=136){const wait=new Promise((yes,no)=>{resolveFrame=yes;rejectFrame=no;});send({type:'render',id:++id,w,h,extent,basis,settings:{...settings,...extra},fast});return await wait;}
const frames=[];
for(const [accelerated,fast]of[[false,false],[true,false],[true,true]]){const f=await frame({accelerationEnabled:accelerated},fast);const bytes=new Uint8Array(f.pixels);frames.push(bytes);console.log(JSON.stringify({test:'CPU same-grid render',accelerated,fast,elapsedMs:f.elapsed}));}
assert.deepEqual(frames[0],frames[1],'Skipping must retain every surface sample');assert.deepEqual(frames[1],frames[2],'Motion must not change lighting or surface quality at a fixed pixel grid');
const colours=[];for(let mode=0;mode<3;mode++){const f=await frame({surfaceSmoothing:mode},false);const bytes=new Uint8Array(f.pixels);colours.push(bytes);fs.writeFileSync(path.join(out,'cpu-smoothing-'+mode+'.rgba'),bytes);}
assert.notDeepEqual(colours[0],colours[1]);assert.notDeepEqual(colours[1],colours[2]);
// A long refinement is superseded by a later interaction request at worker yields.
const queued=new Promise((yes,no)=>{resolveFrame=yes;rejectFrame=no;});
send({type:'render',id:++id,w:500,h:425,extent,basis,settings,fast:false});
const latest=++id;setTimeout(()=>send({type:'render',id:latest,w:96,h:82,extent,basis,settings,fast:true}),2);
const latestFrame=await queued;assert.equal(latestFrame.id,latest,'Stale full-resolution work should be cancelled');
assert.equal(createHash('sha256').update(data).digest('hex'),sourceHash,'Source pixels must be immutable');
const report={macrocellDimensions:acceleration.dimensions,macrocellBytes:acceleration.maxima.length,buildMs:acceleration.buildMs,interpolationBoundTests:100000,sourceUnchanged:true,emptySpaceSameGridPixelEquality:true,motionSameGridPixelEquality:true,staleRefinementCancelled:true,sourceHash};
fs.writeFileSync(path.join(out,'cpu-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
