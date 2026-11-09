/** Contact geometry, fine-plane sampling and actual-module v7 integration.
 * No browser automation. The DOM permission boundary is mocked explicitly.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {add,mul,dot} from '../public/planes.js';
import {ProbeLabModule} from '../public/probe-lab.js';
import {VolumeRenderer} from '../public/renderer.js';
import {PROBE_PRESETS,sanitizeProbeState,volumeGeometry,probePose,probeCapPlane,probeContactSurface,contactCoordinates,contactFrame,contactSurfaceLines,moveProbeState,steerProbe,setProbeContactLocked,sectorPoint} from '../public/probe-geometry.js';
import {validFineProbeSlice,createProbePlaneSampler,computeProbeFrame} from '../public/probe-acoustics.js';
import {finePlaneKey} from '../public/ultra-volume-core.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.argv.find(v=>v.startsWith('--out='))?.slice(6)||'/workspace/data/probe-v7';
await mkdir(output,{recursive:true});
const frames=JSON.parse(await readFile(path.join(root,'public/assets/echo-planes.json'),'utf8')).frames;
const meta=JSON.parse(await readFile(path.join(root,'public/assets/manifest.json'),'utf8')).levels.high,geometry=volumeGeometry(meta);
const prepared=JSON.parse(await readFile(path.join(root,'public/assets/ultra-volume-v7.json'),'utf8')).preparedPlanes;
const defaults=JSON.parse(await readFile(path.join(root,'docs/probe-v7-default-planes.json'),'utf8')).presets;
const report={schemaVersion:1,checks:[],sourceFrames:[],limits:['DOM cursor capture is mocked; real browser permission and visual layout are not verified.','CPU sampling timings are not browser frame rates.','The contact surfaces and acoustic properties are educational proxies.']};
const near=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,`${a} differs from ${b}`),vec=(a,b,eps)=>a.forEach((v,i)=>near(v,b[i],eps));
const test=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
const initial=preset=>sanitizeProbeState({preset:preset.id,contactLocked:true,contactPositionMm:[0,0],depthMm:preset.depthMm,angleDeg:preset.angleDeg});

await test('Fresh sessions lock contact; legacy free-pose bookmarks preserve their position',()=>{
 assert.equal(sanitizeProbeState().contactLocked,true);assert.equal(sanitizeProbeState({originMm:[1,2,3]}).contactLocked,false);
 assert.equal(sanitizeProbeState({imageMode:'ct',interactionMode:'orbit'}).imageMode,'ct');
});
await test('All four locked defaults match the exact prepared 79.4 µm planes',()=>{
 for(const preset of PROBE_PRESETS){const f=frames[preset.frame].world,p=probePose(initial(preset),f),plane=probeCapPlane(p,geometry),expected=defaults[preset.id];
  vec(p.originMm,expected.pose.originMm);for(const k of ['right','beam','normal'])vec(p[k],expected.pose[k]);
  assert.equal(finePlaneKey(plane),finePlaneKey(prepared.find(p=>p.id===preset.id).plane));
 }
});
await test('TTE skin and TEE esophageal wall are distinct synthetic contact surfaces',()=>{
 for(const preset of PROBE_PRESETS){const surface=probeContactSurface(preset.id,frames[preset.frame].world);assert.equal(surface.kind,preset.id==='atrial'?'esophageal':'skin');
  const mesh=contactSurfaceLines(surface);assert.ok(mesh.outline.length>=60);assert.ok(mesh.lines.length>10);
  for(const p of [...mesh.outline,...mesh.lines.flat()]){
   const d=p.map((v,i)=>v-surface.centerMm[i]),u=dot(d,surface.right),v=dot(d,surface.axis),depth=dot(d,surface.inward);
   if(surface.kind==='skin')near(depth,u*u/(2*surface.radiusU)+v*v/(2*surface.radiusV),1e-6);
   else near(Math.hypot(u,surface.radius-depth),surface.radius,1e-6);
  }
 }
});
await test('Repeated WASD travel remains on each bounded surface with an inward beam',()=>{
 for(const preset of PROBE_PRESETS){const f=frames[preset.frame].world,surface=probeContactSurface(preset.id,f);let s=initial(preset);
  for(let i=0;i<500;i++){
   s=moveProbeState(s,f,{lateral:Math.cos(i*.19),advance:Math.sin(i*.11),elevation:1},2);
   s=steerProbe(s,{sweep:Math.sin(i)*4,tilt:Math.cos(i)*3,roll:.7});
   const p=probePose(s,f),uv=contactCoordinates(s,surface),c=contactFrame(surface,...uv);vec(p.originMm,c.pointMm);
   assert.ok(Math.abs(uv[0])<=surface.limitU+1e-8&&Math.abs(uv[1])<=surface.limitV+1e-8);if(surface.kind==='skin')assert.ok(Math.hypot(uv[0]/surface.limitU,uv[1]/surface.limitV)<=1+1e-8);
   assert.ok(dot(p.beam,c.inward)>.16);near(dot(p.right,p.beam),0);near(Math.hypot(...p.normal),1);
  }
 }
});
await test('Steering and depth changes preserve contact; off-surface motion requires unlocking',()=>{
 const f=frames.a4c.world,s=initial(PROBE_PRESETS[0]),p=probePose(s,f);
 vec(probePose(steerProbe(s,{sweep:40,tilt:-25,roll:72}),f).originMm,p.originMm);
 vec(probePose({...s,depthMm:190},f).originMm,p.originMm);
 vec(probePose(moveProbeState(s,f,{elevation:1},15),f).originMm,p.originMm);
 const moved=moveProbeState(s,f,{lateral:1,advance:1},12),before=probePose(moved,f),free=setProbeContactLocked(moved,f,false),after=probePose(free,f);
 vec(after.originMm,before.originMm);vec(after.beam,before.beam);vec(after.right,before.right);
 const lifted=moveProbeState(free,f,{elevation:1},5);near(Math.hypot(...lifted.originMm.map((v,i)=>v-free.originMm[i])),5);
 const relocked=setProbeContactLocked(lifted,f,true),surface=probeContactSurface('apical',f);vec(probePose(relocked,f).originMm,contactFrame(surface,...relocked.contactPositionMm).pointMm);
});

const testMeta={dimensions:[65,65,65],spacingUm:1000},testGeometry=volumeGeometry(testMeta);
const testFrame={center:[0,0,0],right:[1,0,0],up:[0,0,-1],normal:[0,1,0]};
const testState=sanitizeProbeState({originMm:[0,0,-40],contactLocked:false,depthMm:80,angleDeg:72}),testPose=probePose(testState,testFrame),testPlane=probeCapPlane(testPose,testGeometry);
const image=new Uint8Array(257*257);for(let y=0;y<257;y++)for(let x=0;x<257;x++){const r=Math.hypot(x-128,y-128);image[x+257*y]=r>40&&r<90?180:0;}
const fine={data:image,width:257,height:257,plane:testPlane,sourceSpacingUm:79.4,spacingUm:251,spacingUmXY:[251,251],complete:true,cleaned:true,source:'Synthetic test phantom sampled to a measured-plane contract'};
const emptyVolume={data:new Uint8Array(65**3),dimensions:testMeta.dimensions,meta:testMeta,geometry:testGeometry};
const fineRequest={id:1,version:1,poseRevision:3,refinementToken:7,pose:testPose,state:testState,fast:false,fineSlice:fine,width:160,beams:72,samples:200};
let fineResult;
await test('Incomplete, coarse and nonmatching planes cannot receive a fine label',()=>{
 assert.ok(validFineProbeSlice(fine,testPlane));assert.equal(validFineProbeSlice({...fine,complete:false},testPlane),false);
 assert.equal(validFineProbeSlice({...fine,sourceSpacingUm:317.6},testPlane),false);
 assert.equal(validFineProbeSlice({...fine,plane:{...testPlane,center:add(testPlane.center,mul(testPlane.normal,.01))}},testPlane),false);
 assert.equal(validFineProbeSlice({...fine,data:new Uint8Array(3)},testPlane),false);
});
await test('Fine cap, CT fan and ultrasound derive from fine input even when coarse volume is empty',async()=>{
 const hash=createHash('sha256').update(image).digest('hex');fineResult=await computeProbeFrame(emptyVolume,fineRequest);
 assert.equal(fineResult.cap,fine.data);assert.equal(fineResult.capWidth,257);assert.equal(fineResult.fine,true);assert.equal(fineResult.capCleaned,true);assert.equal(fineResult.capSpacingUm,251);assert.equal(fineResult.stats.sourceSpacingUm,79.4);
 assert.ok(fineResult.ct.some(v=>v>100));assert.ok(fineResult.ultrasound.some(v=>v>50));assert.equal(fineResult.refinementToken,7);assert.equal(fineResult.poseRevision,3);
 assert.equal(createHash('sha256').update(image).digest('hex'),hash);
 const sampler=createProbePlaneSampler(fine,emptyVolume);
 for(let y=0;y<fineResult.height;y+=13)for(let x=0;x<fineResult.width;x+=11){const p=sectorPoint(testPose,testState,x/(fineResult.width-1),y/(fineResult.height-1));assert.equal(fineResult.ct[x+y*fineResult.width],p.inside&&p.depthMm>=.3?Math.round(sampler(...p.pointMm)):0);}
 assert.equal(sampler(0,8,0),0,'A 2D source must not be used off its plane.');
});
await test('Cleaned fine planes bypass coarse support without disabling original-volume cleanup',async()=>{
 const source={...emptyVolume,support:{data:new Uint8Array(65**3),dimensions:testMeta.dimensions}};
 const cleaned=await computeProbeFrame(source,fineRequest);assert.equal(cleaned.capCleaned,true);assert.deepEqual(cleaned.ct,fineResult.ct);assert.deepEqual(cleaned.ultrasound,fineResult.ultrasound);
 const uncleaned=await computeProbeFrame(source,{...fineRequest,fineSlice:{...fine,cleaned:false}});assert.equal(uncleaned.capCleaned,false);assert.ok(uncleaned.ct.every(v=>v===0));assert.ok(uncleaned.ultrasound.every(v=>v===0));
 const original=await computeProbeFrame(source,{...fineRequest,fineSlice:undefined});assert.equal(original.capCleaned,false);assert.ok(original.ct.every(v=>v===0));
});
await test('Fine simulation is deterministic and cooperatively cancellable',async()=>{
 const again=await computeProbeFrame(emptyVolume,{...fineRequest,id:2});assert.deepEqual(again.ultrasound,fineResult.ultrasound);
 let count=0;const cancelled=await computeProbeFrame(emptyVolume,{...fineRequest,beams:320,samples:1400},{yieldFn:async()=>{count++;},cancelled:()=>count>0});assert.equal(cancelled,null);assert.equal(count,1);
});
await test('Increasing radial resolution does not accumulate extra artificial acoustic shadow',async()=>{
 const layers=new Uint8Array(513*513);
 for(let y=0;y<513;y++)for(let x=0;x<513;x++)layers[x+y*513]=Math.round(150+26*Math.sin(y/512*Math.PI*14));
 const slice={...fine,data:layers,width:513,height:513};
 const low=await computeProbeFrame(emptyVolume,{...fineRequest,fineSlice:slice,samples:400});
 const high=await computeProbeFrame(emptyVolume,{...fineRequest,fineSlice:slice,samples:1400});
 const sum=image=>{let total=0,count=0;for(let y=Math.round(image.height*.45);y<Math.round(image.height*.75);y++)for(let x=Math.round(image.width*.40);x<Math.round(image.width*.60);x++){total+=image.ultrasound[x+y*image.width];count++;}return total/count;};
 const coarseMean=sum(low),fineMean=sum(high);
 assert.ok(coarseMean>30&&fineMean>30,'A dense specimen must retain visible deep tissue.');
 assert.ok(Math.abs(fineMean-coarseMean)<8,`Resolution changed deep intensity: ${coarseMean} to ${fineMean}`);
 report.acousticResolution={coarseSamples:400,fineSamples:1400,coarseDeepMean:coarseMean,fineDeepMean:fineMean};
});
await test('Real worker transfers only its fine-plane clone and preserves source-cache ownership',async()=>{
 const url=pathToFileURL(path.join(root,'public/probe-acoustics-worker.js')).href;
 const code=`import {parentPort} from 'node:worker_threads'; globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)}; await import(${JSON.stringify(url)}); parentPort.on('message',data=>self.onmessage({data})); parentPort.postMessage({type:'ready'});`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)),{type:'module'}),queue=[];let error;
 worker.on('message',m=>queue.push(m));worker.on('error',e=>{error=e;});
 const waitFor=predicate=>new Promise((resolve,reject)=>{const start=Date.now();const poll=()=>{if(error)return reject(error);const m=queue.find(predicate);if(m)return resolve(m);if(Date.now()-start>15000)return reject(new Error('Fine worker timeout'));setTimeout(poll,5);};poll();});
 try{await waitFor(m=>m.type==='ready');worker.postMessage({type:'load',data:emptyVolume.data,meta:testMeta,version:1});await waitFor(m=>m.type==='loaded');worker.postMessage({...fineRequest,type:'sample'});const result=await waitFor(m=>m.type==='frame');assert.equal(image.byteLength,257*257);assert.deepEqual(result.cap,image);assert.notEqual(result.cap.buffer,image.buffer);assert.deepEqual(result.ultrasound,fineResult.ultrasound);}finally{await worker.terminate();}
});

// Exact production guide paths can be inspected alongside native EGL output.
function guideEvidence(state,pose){
 const parts=[];let current='',dash=[];const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 // SVG 1.1 renderers do not all accept Canvas-style rgba() color strings.
 const paint=(name,value)=>{const match=/^rgba\((\d+),(\d+),(\d+),([.\d]+)\)$/.exec(value);return match?`${name}="rgb(${match[1]},${match[2]},${match[3]})" ${name}-opacity="${match[4]}"`:`${name}="${esc(value)}"`;};
 const context={fillStyle:'#000',strokeStyle:'#fff',lineWidth:1,font:'10px monospace',setTransform(){},clearRect(){parts.length=0;},beginPath(){current='';},moveTo(x,y){current+=`M${x.toFixed(3)} ${y.toFixed(3)} `;},lineTo(x,y){current+=`L${x.toFixed(3)} ${y.toFixed(3)} `;},closePath(){current+='Z ';},setLineDash(values){dash=values;},arc(x,y,r){current+=`M${x-r} ${y} a${r},${r} 0 1,0 ${2*r},0 a${r},${r} 0 1,0 ${-2*r},0 `;},fill(){parts.push(`<path d="${current}" ${paint('fill',this.fillStyle)}/>`);},stroke(){parts.push(`<path d="${current}" fill="none" ${paint('stroke',this.strokeStyle)} stroke-width="${this.lineWidth}"${dash.length?` stroke-dasharray="${dash.join(' ')}"`:''}/>`);},fillText(text,x,y){parts.push(`<text x="${x}" y="${y}" ${paint('fill',this.fillStyle)} font-family="monospace" font-size="${parseFloat(this.font)}">${esc(text)}</text>`);}};
 const rect={left:0,top:0,width:680,height:650},canvas={style:{},getBoundingClientRect:()=>rect,getContext:()=>context};
 const renderer=Object.create(VolumeRenderer.prototype);Object.assign(renderer,{canvas,camera:{yaw:0,pitch:0,roll:0,distance:2,pan:[0,0,0]},requestRender(){},onChange(){}});
 const module=Object.create(ProbeLabModule.prototype);Object.assign(module,{active:true,state,frames:Object.fromEntries(Object.entries(frames).map(([k,v])=>[k,v.world])),geometry,renderer,mount:{querySelector:()=>({getBoundingClientRect:()=>rect})},$(){return canvas;},displayedFrame:{pose,state},displayedId:1});
 module.orientCamera('explore');return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="680" height="650" viewBox="0 0 680 650">${parts.join('')}</svg>`,camera:renderer.camera,basis:renderer.basis()};
}

if(process.argv.includes('--source')){
 const cleanupMeta=JSON.parse(await readFile(path.join(root,'public/assets/cleanup/manifest.json'),'utf8')),support={data:new Uint8Array(gunzipSync(await readFile(path.join(root,'public',cleanupMeta.volumeUrl)))),dimensions:cleanupMeta.dimensions};
 for(const preset of PROBE_PRESETS){
  const record=prepared.find(r=>r.id===preset.id),rawPath=path.join(output,preset.id+'-fine.raw');
  execFileSync('python',['-c','from PIL import Image;import sys;im=Image.open(sys.argv[1]).convert("L");open(sys.argv[2],"wb").write(im.tobytes())',path.join(root,'public',record.url),rawPath]);
  const data=new Uint8Array(await readFile(rawPath));assert.equal(createHash('sha256').update(data).digest('hex'),record.pixelSha256);
  const s=initial(preset),p=probePose(s,frames[preset.frame].world),fineSlice={...record,data,complete:true,spacingUm:79.4,source:'Measured 79.4 µm prepared plane'},source={data:new Uint8Array(1),meta,dimensions:meta.dimensions,geometry,support};
  const result=await computeProbeFrame(source,{id:1,version:1,pose:p,state:s,fast:false,fineSlice});assert.ok(result.stats.tissueFraction>.01);assert.equal(result.cap,data);
  for(const [kind,bytes] of [['ct',result.ct],['us',result.ultrasound]])await writeFile(path.join(output,preset.id+'-'+kind+'.pgm'),Buffer.concat([Buffer.from(`P5\n${result.width} ${result.height}\n255\n`),Buffer.from(bytes)]));
  const visual=guideEvidence(s,p);await writeFile(path.join(output,preset.id+'-guide.svg'),visual.svg);await writeFile(path.join(output,preset.id+'-scene.json'),JSON.stringify({plane:result.plane,state:s,pose:p,camera:visual.camera,basis:visual.basis,texture:record},null,2));
  const stat={preset:preset.id,...result.stats,capWidth:result.capWidth,capHeight:result.capHeight,imageWidth:result.width,imageHeight:result.height,encodedBytes:record.bytes};report.sourceFrames.push(stat);console.log('SOURCE',JSON.stringify(stat));
 }
 report.checks.push('All four exact fine source textures pass their pixel hashes and produce coherent measured/simulated views');
}

const domArg=process.argv.find(v=>v.startsWith('--dom='))?.slice(6),domPath=domArg||'/workspace/data/heart-ui-test-v5/node_modules/linkedom/esm/index.js';
if(existsSync(domPath)){
 const {parseHTML}=await import(pathToFileURL(domPath));const {document,window}=parseHTML('<!doctype html><html><body><section id="mount"></section></body></html>');
 Object.assign(globalThis,{document,window});Object.defineProperty(document,'activeElement',{configurable:true,writable:true,value:document.body});Object.defineProperty(document,'pointerLockElement',{configurable:true,writable:true,value:null});
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(v){this._value=String(v);}});
 window.HTMLElement.prototype.focus=function(){document.activeElement=this;};window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:680,height:650});
 const context=new Proxy({putImageData(){},setTransform(){}},{get:(obj,k)=>k in obj?obj[k]:(()=>{})});window.HTMLCanvasElement.prototype.getContext=()=>context;
 globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 const rafs=new Map(),timers=new Map();let serial=0;globalThis.requestAnimationFrame=fn=>{const id=++serial;rafs.set(id,fn);return id;};globalThis.cancelAnimationFrame=id=>rafs.delete(id);globalThis.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 const workers=[];globalThis.Worker=class{constructor(){this.messages=[];workers.push(this);}postMessage(message,transfer=[]){this.messages.push({message,transfer});}terminate(){this.terminated=true;}};
 document.exitPointerLock=()=>{document.pointerLockElement=null;document.dispatchEvent(new window.Event('pointerlockchange'));};
 const renderer={canvas:document.createElement('canvas'),settings:{palette:4,threshold:.28,cleanupEnabled:true,capContrast:1.8},camera:{yaw:0,pitch:0,roll:0,distance:2,pan:[0,0,0]},uploads:0,set(v){Object.assign(this.settings,v);},requestRender(){},clearCapData(){this.cap=null;},setCapData(cap){this.cap=cap;this.uploads++;},alignPlane(n,u,c){this.camera.pan=c;},basis(){return {eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};}};
 const calls=[],fineSource={samplePlane(plane,options){return new Promise((resolve,reject)=>calls.push({plane,options,resolve,reject}));}};
 const module=new ProbeLabModule({renderer,mount:document.getElementById('mount'),frames,fineSource}),viewport=module.mount.querySelector('#probeViewportMount');viewport.append(renderer.canvas);
 let lockRequests=0;viewport.requestPointerLock=()=>{lockRequests++;document.pointerLockElement=viewport;document.dispatchEvent(new window.Event('pointerlockchange'));return Promise.resolve();};
 module.setVolume(new Uint8Array(1),meta);await module.enter();
 await test('Actual module starts on contact with two visual siblings and an optional CT image',()=>{
  assert.equal(module.state.contactLocked,true);assert.equal(lockRequests,0);const pair=module.mount.querySelector('.probe-view-pair');assert.equal(pair.children.length,2);assert.equal(pair.children[0].id,'probeViewportMount');assert.ok(pair.children[1].classList.contains('probe-image-panel'));assert.equal(module.$('ct-figure').hidden,true);assert.equal(module.$('ultrasound-figure').hidden,false);
 });
 await test('Clicking the visual captures immediately; Escape unlocks; explicit orbit mode does not capture',async()=>{
  renderer.canvas.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));await Promise.resolve();assert.equal(lockRequests,1);assert.equal(module.isLocked(),true);assert.match(module.$('lock-badge').textContent,/Press Esc to release control/);
  module.keyDown({code:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(module.isLocked(),false);
  module.setInteractionMode('orbit');renderer.canvas.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));assert.equal(lockRequests,1);module.setInteractionMode('probe');
 });
 await test('Contact movement and image toggling preserve a serializable physical state',()=>{
  const p=module.getPose();module.state=moveProbeState(module.state,module.frameForState(),{advance:1,lateral:1},8);module.poseChanged();const moved=module.getPose();assert.ok(Math.hypot(...moved.originMm.map((v,i)=>v-p.originMm[i]))>7.9);vec(moved.originMm,contactFrame(probeContactSurface('apical',frames.a4c.world),...module.state.contactPositionMm).pointMm);
  module.state.imageMode='ct';module.updateUI();assert.equal(module.$('ct-figure').hidden,false);assert.equal(module.$('ultrasound-figure').hidden,true);assert.match(module.$('image-title').textContent,/Measured CT/);const saved=module.getState();module.restore(saved);assert.deepEqual(module.getState(),saved);
 });
 let fineJob;
 await test('Fine-source completion posts a cloned plane without labeling the coarse preview Ultra',async()=>{
  module.requestFrame(false);const call=calls.at(-1);assert.ok(call);assert.equal(call.options.spacingUm,79.4);assert.ok(!module.$('resolution').textContent.includes('Ultra'));
  const pixels=new Uint8Array(64*64);pixels.fill(160);call.resolve({data:pixels,width:64,height:64,plane:call.plane,spacingUm:79.4,sourceSpacingUm:79.4,complete:true,cleaned:true});await Promise.resolve();await Promise.resolve();
  const job=workers.at(-1).messages.at(-1);fineJob=job.message;assert.ok(fineJob.fineSlice);assert.equal(job.transfer.length,0);assert.equal(pixels.byteLength,4096);assert.ok(!module.$('resolution').textContent.includes('Ultra'));
  const result={...fineJob,fine:true,cap:pixels,capWidth:64,capHeight:64,capCleaned:true,capSpacingUm:79.4,plane:call.plane,ct:new Uint8Array(16),ultrasound:new Uint8Array(16),width:4,height:4,sector:{depthMm:module.state.depthMm,widthMm:150},stats:{sourceSpacingUm:79.4,tissueFraction:.5}};
  module.acceptFrame(result);assert.match(module.$('resolution').textContent,/79.4.*Ultra/);assert.equal(renderer.cap.data,pixels);assert.equal(renderer.cap.cleaned,true);assert.equal(renderer.cap.spacingUm,79.4);assert.equal(module.$('ct').width,4);assert.equal(module.$('ultrasound').width,4);
 });
 await test('Fine source sampled to a coarser plane is labeled Fine with actual output spacing',()=>{
  module.acceptFrame({...module.displayedFrame,id:++module.sequence,capSpacingUm:251});assert.equal(module.$('frame-state').textContent,'Fine plane');assert.match(module.$('resolution').textContent,/79.4.*251.0.*Fine/);assert.ok(!module.$('resolution').textContent.includes('Ultra'));assert.equal(renderer.cap.spacingUm,251);assert.equal(renderer.cap.cleaned,true);
 });
 await test('Motion aborts fine downloads and rejects a stale fine result without erasing the current image',()=>{
  module.requestFrame(false);const call=calls.at(-1),before=renderer.uploads;module.mouseMove(7,3);assert.equal(call.options.signal.aborted,true);
  module.acceptFrame({...module.displayedFrame,id:module.sequence+10,refinementToken:fineJob.refinementToken});assert.equal(renderer.uploads,before);assert.ok(renderer.cap);
 });
 await test('Fine sampling requires Clean scan and module exit aborts work and releases control',()=>{
  renderer.settings.cleanupEnabled=false;module.updateAppearance();const n=calls.length;module.requestFrame(false);assert.equal(calls.length,n);
  renderer.settings.cleanupEnabled=true;module.updateAppearance();module.requestFrame(false);const call=calls.at(-1);module.leave();assert.equal(call.options.signal.aborted,true);assert.equal(module.keys.size,0);assert.equal(module.sampleTimer,0);assert.equal(rafs.size,0);assert.equal(workers.at(-1).terminated,true);
 });
}else report.limits.push('The optional actual-module DOM tests were skipped because linkedom was unavailable.');

await writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${report.checks.length} v7 checks passed.`);
