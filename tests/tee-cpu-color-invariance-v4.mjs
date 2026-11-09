import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {clipPlane} from '../public/planes.js';
import * as styles from '../public/render-styles.js';
import {buildAcceleration,validAcceleration} from '../public/render-v5-acceleration.js';

// A new occlusion-depth channel must not alter existing software heart pixels,
// including accumulating volume mode with the three measured plane overlays.
const baseline='5ee02eb261e372b1e864a282434939d92ea6c391';
const old=execFileSync('git',['show',`${baseline}:public/cpu-worker.js`],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
const current=readFileSync(new URL('../public/cpu-worker.js',import.meta.url),'utf8');
const contexts=[old,current].map(source=>{
 const context=vm.createContext({clipPlane,...styles,buildAcceleration,validAcceleration,performance,setTimeout,Float32Array,Uint8Array,Uint8ClampedArray,onmessage:null,postMessage(){}});
 vm.runInContext(source.replace(/^import .*;\n/gm,''),context);return context;
});
const n=32,data=new Uint8Array(n*n*n);
for(let z=3;z<29;z++)for(let y=4;y<28;y++)for(let x=3;x<29;x++)if(!(x>=13&&x<19&&z>=13&&z<19))data[x+n*(y+n*z)]=Math.round(140+80*y/(n-1));
const basis={eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};
for(const context of contexts)context.onmessage({data:{type:'load',data:data.buffer,dimensions:[n,n,n]}});
let checked=0;
for(const mode of [0,1,2])for(const showPlanes of [0,1]){
 const settings={mode,palette:4,quality:'auto',threshold:.3,opacity:.8,clipAxis:-1,showPlanes,cleanupEnabled:false,capContrast:1.8,slices:[.5,.5,.5]};
 const frames=[];for(const context of contexts){context.job={w:33,h:33,extent:[1,1,1],basis,settings,fast:false};frames.push(await vm.runInContext('render(job,()=>false)',context));}
 const before=frames[0],after=frames[1];
 assert.deepEqual(Array.from(after.pixels),Array.from(before),`Source pixels changed for mode ${mode}, showPlanes ${showPlanes}.`);
 assert.equal(after.depths.length,33*33);assert.ok(after.depths.some(Number.isFinite));checked++;
}
console.log(`PASS ${checked} actual CPU worker fixtures retain byte-identical source RGBA versus ${baseline.slice(0,7)} while returning occlusion depth.`);
