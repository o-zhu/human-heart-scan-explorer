/** Main context integration checks. Real pinned anatomy is decoded; GL calls
 * are a resource-boundary fixture, not a GPU or clinical validation claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {ReconstructionAnatomyContext} from '../public/reconstruction-anatomy-context.js';
import {VolumeRenderer} from '../public/renderer.js';
import {CPUVolumeRenderer} from '../public/cpu-renderer.js';
import {DONORS} from '../public/donors.js';
import {volumeGeometry} from '../public/probe-geometry.js';
import {createTeeContextModel} from '../public/tee-context-geometry.js';
import {createEchoAnatomyContext,loadEchoReferenceAnatomy} from '../public/echo-anatomy-context-v2.js';

const domPath=process.argv.find(value=>value.startsWith('--dom='))?.slice(6)||process.env.HEART_DOM_MODULE;
if(!domPath)throw new Error('Set HEART_DOM_MODULE to an installed LinkeDOM ESM entry.');
const {parseHTML}=await import(pathToFileURL(domPath));
const publicRoot=new URL('../public/',import.meta.url);
const html=await readFile(new URL('../page.html',import.meta.url),'utf8');
const metadata={dimensions:[121,81,161],spacingUm:[1000,1000,1000]};
const globals=['document','window','fetch','Worker','ResizeObserver','ImageData','OffscreenCanvas','requestAnimationFrame','cancelAnimationFrame'];
const previous=Object.fromEntries(globals.map(key=>[key,globalThis[key]]));
const active=[];
const fetchCalls=[];
let transport=async url=>new Response(await readFile(new URL(url,publicRoot)));
const fetchImpl=async url=>{fetchCalls.push(String(url));return transport(url);};
globalThis.fetch=fetchImpl;

function graphics(){
 const calls={uploads:[],deletedBuffers:[],draws:[],depthRanges:[]};let serial=0;
 const methods={
  createProgram:()=>({program:++serial}),createShader:()=>({shader:++serial}),
  createBuffer:()=>({buffer:++serial}),createTexture:()=>({texture:++serial}),createVertexArray:()=>({vao:++serial}),
  getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:(_p,name)=>name==='position'?0:1,
  getUniformLocation:(_p,name)=>({name}),getError:()=>0,
  bufferData:(target,data,usage)=>calls.uploads.push({target,bytes:data.byteLength,usage}),
  deleteBuffer:buffer=>calls.deletedBuffers.push(buffer),
  drawArrays:(...args)=>calls.draws.push(args),depthRange:(...args)=>calls.depthRanges.push(args),
 };
 return {calls,gl:new Proxy(methods,{get(object,key){if(key in object)return object[key];if(key==='NO_ERROR')return 0;if(/^[A-Z0-9_]+$/.test(key))return key;return ()=>{};}})};
}

function environment(donor=DONORS[0]){
 const {document,window}=parseHTML(html);Object.assign(globalThis,{document,window});
 const canvas=document.getElementById('volumeCanvas');canvas.width=800;canvas.height=600;
 canvas.getBoundingClientRect=()=>({width:800,height:600,left:0,top:0});
 const {gl,calls}=graphics(),events={renders:0,notices:[],layers:[]};
 const renderer={canvas,gl,backend:'webgl2',loaded:true,meta:metadata,renderProfile:'reconstruction',
  settings:{mode:0,clipAxis:3,clipFlip:1,clipPosition:.4,oblique:{center:[.1,.2,.3],normal:[0,0,1],up:[0,1,0],right:[1,0,0]}},
  camera:{yaw:.32,pitch:.12,roll:Math.PI,distance:1.65,pan:[.08,-.02,.12]},autoRotate:true,
  contextLayer:null,requestRender(){events.renders++;},onChange(){},createProgram(){return gl.createProgram();},
  setContextLayer(layer){this.contextLayer=layer;events.layers.push(layer);this.requestRender();},
  alignPlane:VolumeRenderer.prototype.alignPlane,basis:VolumeRenderer.prototype.basis,
 };
 const controller=new ReconstructionAnatomyContext({renderer,donor,root:document,toast:message=>events.notices.push(message)});
 active.push(controller);return {controller,renderer,document,window,calls,events};
}

async function until(predicate,message){
 for(let i=0;i<100;i++){if(predicate())return;await delay(10);}
 assert.fail(message);
}

test.afterEach(()=>{
 for(const controller of active.splice(0))controller.destroy();
 for(const key of globals.filter(key=>key!=='fetch')){if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];}
});
test.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});

test('a cancelled pending download cannot move the camera; a failed shared load remains retryable',async()=>{
 const {controller:c,renderer:r,document,events}=environment();
 const camera=structuredClone(r.camera),settings=structuredClone(r.settings);
 let release;const gate=new Promise(resolve=>{release=resolve;});
 transport=async()=>{await gate;throw new Error('Controlled reference transfer failure');};
 const first=c.toggle();await until(()=>fetchCalls.length===2,'Reference requests did not start.');
 assert.equal(document.getElementById('anatomyContext').getAttribute('aria-busy'),'true');
 await c.toggle();assert.equal(c.enabled,false);assert.equal(r.contextLayer,null);
 const second=c.toggle();release();await Promise.all([first,second]);
 assert.equal(c.enabled,false);assert.equal(r.contextLayer,null);assert.deepEqual(r.camera,camera);
 assert.deepEqual(r.settings,settings);assert.equal(events.notices.length,1);
 assert.match(document.getElementById('anatomyContext').getAttribute('aria-label'),/Retry/i);
 transport=async url=>new Response(await readFile(new URL(url,publicRoot)));
 assert.equal(await c.toggle(),true);assert.ok(r.contextLayer);
 assert.equal(fetchCalls.length,4);assert.deepEqual(r.settings,settings);
 assert.notDeepEqual(r.camera,camera);assert.equal(r.autoRotate,false);
 await c.toggle();assert.deepEqual(r.camera,camera);assert.equal(r.autoRotate,true);
 assert.equal(document.getElementById('anatomyContext').getAttribute('aria-pressed'),'false');
});

for(const donor of DONORS){
 test(`${donor.id}: main context preserves the exact TEE GI and fitted skeleton at the source scale`,async()=>{
  const {controller:c,renderer:r,calls}=environment(donor),settings=structuredClone(r.settings);
  await c.toggle();const layer=r.contextLayer;assert.ok(layer);
  const referenceMm=volumeGeometry(metadata).longestMm,referenceAnatomy=await loadEchoReferenceAnatomy();
  const base=createTeeContextModel({referenceMm,donorId:donor.datasetId||donor.id});
  const fitted=createEchoAnatomyContext({baseModel:base,referenceAnatomy});
  const expected=[...base.meshes,...fitted.meshes.filter(mesh=>mesh.id==='bodyparts3d-bones'||mesh.id==='bodyparts3d-spine')];
  assert.equal(layer.model.referenceMm,referenceMm);
  assert.deepEqual(layer.model.meshes.map(mesh=>mesh.id),expected.map(mesh=>mesh.id));
  for(const mesh of expected){const actual=layer.model.meshes.find(item=>item.id===mesh.id);assert.deepEqual(actual.vertices,mesh.vertices);assert.deepEqual(actual.bounds,mesh.bounds);}
  assert.equal(layer.model.meshes.some(mesh=>/skin|reference-heart/.test(mesh.id)),false);
  assert.equal(layer.model.frame.patientOrientationValidated,false);
  assert.deepEqual(r.settings,settings);
  const uploads=calls.uploads.length,requests=fetchCalls.length,camera=structuredClone(r.camera);
  r.camera.yaw+=.4;const orbited=structuredClone(r.camera);
  layer.draw({renderer:r,gl:r.gl,basis:r.basis(),width:800,height:600,pixelWidth:800,pixelHeight:600,aspect:4/3});
  assert.ok(calls.draws.length>0);assert.deepEqual(calls.depthRanges.at(-1),[0,1]);
  assert.deepEqual(r.camera,orbited);assert.deepEqual(r.settings,settings);
  await c.toggle();await c.toggle();assert.equal(r.contextLayer,layer);
  assert.equal(calls.uploads.length,uploads);assert.equal(fetchCalls.length,requests);
  assert.deepEqual(r.camera,camera);
 });
}

test('source upgrades reuse equal-scale context, replace obsolete buffers, and preserve the cut plane',async()=>{
 const {controller:c,renderer:r,calls}=environment(),settings=structuredClone(r.settings);
 await c.toggle();const first=r.contextLayer;
 c.setVolume(null,{dimensions:[241,161,321],spacingUm:500});
 assert.equal(r.contextLayer,first);assert.equal(calls.deletedBuffers.length,0);
 c.setVolume(null,{dimensions:[241,161,331],spacingUm:500});
 await until(()=>r.contextLayer&&r.contextLayer!==first,'The replacement source scale did not install.');
 assert.equal(r.contextLayer.model.referenceMm,165);assert.ok(calls.deletedBuffers.length>0);
 assert.deepEqual(r.settings,settings);assert.equal(c.enabled,true);
});

test('leaving Reconstruction preserves the other workspace layer and the main-context preference',async()=>{
 const {controller:c,renderer:r}=environment();await c.toggle();const own=r.contextLayer;
 const camera=structuredClone(r.camera);c.setWorkspaceActive(false);
 assert.equal(c.enabled,true);assert.equal(r.contextLayer,null);assert.deepEqual(r.camera,camera);
 const foreign={draw(){}};r.setContextLayer(foreign);
 c.setVolume(null,{dimensions:[241,161,331],spacingUm:500});
 await delay(0);assert.equal(r.contextLayer,foreign);assert.deepEqual(r.camera,camera);
 c.setWorkspaceActive(false);assert.equal(r.contextLayer,foreign);
 // The application's normal transition first lets the other workspace leave.
 r.setContextLayer(null);c.setWorkspaceActive(true);
 await until(()=>r.contextLayer&&r.contextLayer!==foreign,'Main context did not resume.');
 assert.notEqual(r.contextLayer,own);assert.equal(c.enabled,true);assert.deepEqual(r.camera,camera);
});

test('a pending enable followed immediately by a different source cannot install stale geometry',async()=>{
 const {controller:c,renderer:r}=environment();
 const first=c.toggle();c.setVolume(null,{dimensions:[241,161,351],spacingUm:500});
 await first;await until(()=>r.contextLayer,'Current source context did not install.');
 assert.equal(r.contextLayer.model.referenceMm,175);assert.equal(c.enabled,true);
});

test('unsupported donors do not silently inherit a preserved-heart context',async()=>{
 const {controller:c,renderer:r,document}=environment({id:'clinical-pilot',kind:'clinical'});
 const camera=structuredClone(r.camera),count=fetchCalls.length;
 assert.equal(document.getElementById('anatomyContext').disabled,true);
 assert.equal(await c.toggle(),false);assert.equal(fetchCalls.length,count);
 assert.equal(r.contextLayer,null);assert.deepEqual(r.camera,camera);
});

function softwareEnvironment(){
 const {document,window}=parseHTML(html);Object.assign(globalThis,{document,window});
 const images=[],composites=[],labels=[],rectangles=[];
 const contextFor=canvas=>({canvas,
  save(){},restore(){},setTransform(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){},clearRect(){},
  measureText:text=>({width:text.length*7}),
  createImageData:(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}),
  putImageData(image){this.image=image;images.push(image);},
  drawImage(source){composites.push(new Uint8ClampedArray(source.getContext('2d').image.data));},
  fillRect:(...args)=>rectangles.push(args),fillText:(...args)=>labels.push(args),
 });
 class PixelCanvas{constructor(width,height){this.width=width;this.height=height;this.ctx=contextFor(this);}getContext(){return this.ctx;}}
 globalThis.OffscreenCanvas=PixelCanvas;
 globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
 globalThis.Worker=class{postMessage(){}terminate(){}};
 globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 const canvas=document.getElementById('volumeCanvas'),ctx=contextFor(canvas);
 canvas.getContext=()=>ctx;canvas.getBoundingClientRect=()=>({width:800,height:600,left:0,top:0});
 const renderer=new CPUVolumeRenderer(canvas);let renders=0;renderer.requestRender=()=>{renders++;};
 renderer.loaded=true;renderer.meta=metadata;
 return {document,renderer,images,composites,labels,rectangles,get renders(){return renders;}};
}

test('software context receives only the accepted image depth and its own camera basis',()=>{
 const env=softwareEnvironment(),r=env.renderer,draws=[],errors=[];
 const layer={draw:frame=>draws.push(frame),onError:error=>errors.push(error)};
 r.setContextLayer(layer);const requested=env.renders;r.setContextLayer(layer);assert.equal(env.renders,requested);
 r.frameId=5;r.displayedId=2;r.latestFast=true;
 const acceptedBasis=r.basis();r.camera.yaw+=1.2;
 const frame={type:'frame',id:4,fast:true,w:8,h:6,pixels:new Uint8ClampedArray(8*6*4).buffer,
  depth:new Float32Array(8*6).fill(Infinity).buffer,basis:acceptedBasis,elapsed:0};
 r.worker.onmessage({data:frame});assert.equal(draws.length,1);
 assert.equal(draws[0].basis,acceptedBasis);assert.notDeepEqual(draws[0].basis,r.basis());
 assert.equal(draws[0].occlusion,r.contextDepth);assert.equal(draws[0].cssWidth,800);assert.equal(draws[0].width,8);
 assert.equal(r.displayedId,4);
 r.worker.onmessage({data:{...frame,id:3}});assert.equal(draws.length,1);
 r.worker.onmessage({data:{...frame,id:5,depth:null}});assert.equal(draws.length,1);
 r.worker.onmessage({data:{...frame,id:5,depth:new Float32Array(5).buffer}});assert.equal(draws.length,1);
 r.setContextLayer(null);r.worker.onmessage({data:{...frame,id:5}});assert.equal(draws.length,1);assert.equal(errors.length,0);
});

test('software anatomy is masked at every accepted heart pixel and remains tied to that frame while the camera advances',async()=>{
 const env=softwareEnvironment(),r=env.renderer;
 const controller=new ReconstructionAnatomyContext({renderer:r,donor:DONORS[0],root:env.document});active.push(controller);
 const before=structuredClone(r.camera),settings=structuredClone(r.settings);
 assert.equal(await controller.toggle(),true);assert.ok(r.contextLayer);
 const acceptedBasis=r.basis(),w=160,h=120;
 const frame={type:'frame',id:1,w,h,basis:acceptedBasis,elapsed:0,pixels:new Uint8ClampedArray(w*h*4).buffer,
  depth:new Float32Array(w*h).fill(Infinity).buffer};
 r.frameId=1;r.worker.onmessage({data:frame});
 const first=new Uint8ClampedArray(env.composites[0]);assert.ok(first.some((value,index)=>index%4===3&&value>0));
 const count=env.composites.length;r.camera.yaw+=1.1;
 r.frameId=2;r.worker.onmessage({data:{...frame,id:2}});
 assert.deepEqual(env.composites[count],first,'An accepted frame must not use the newer controls camera.');
 env.composites.length=0;env.labels.length=0;env.rectangles.length=0;
 r.frameId=3;r.worker.onmessage({data:{...frame,id:3,depth:new Float32Array(w*h).fill(2).buffer}});
 assert.ok(env.composites.length>0);
 for(const pixels of env.composites)assert.equal(pixels.some((value,index)=>index%4===3&&value>0),false);
 assert.equal(env.labels.length,0);assert.equal(env.rectangles.length,0);
 assert.deepEqual(r.settings,settings);await controller.toggle();assert.deepEqual(r.camera,before);
});
