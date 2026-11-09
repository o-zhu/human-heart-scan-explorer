/** Exercise the actual render orchestration with a recording WebGL interface. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {VolumeRenderer,volumeShaderSources} from '../public/renderer.js';
const results=[];
function harness({framebufferWorks=true,quality='auto',dpr=1.5}={}){
 const calls=[],draws=[];let currentProgram=null,currentFramebuffer=null,viewport=null,values={};let nextId=1;
 const constants=['TEXTURE0','TEXTURE1','TEXTURE2','TEXTURE3','TEXTURE4','TEXTURE5','TEXTURE_2D','TEXTURE_3D','RGBA8','RGBA','R8','RED','UNSIGNED_BYTE','FRAMEBUFFER','COLOR_ATTACHMENT0','FRAMEBUFFER_COMPLETE','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','LINEAR','CLAMP_TO_EDGE','TRIANGLES','SYNC_GPU_COMMANDS_COMPLETE','TIMEOUT_EXPIRED'];
 const data=Object.fromEntries(constants.map((name,i)=>[name,i+1]));
 const gl=new Proxy({...data,
  createTexture:()=>({texture:nextId++}),createFramebuffer:()=>({framebuffer:nextId++}),
  checkFramebufferStatus:()=>framebufferWorks?data.FRAMEBUFFER_COMPLETE:0,
  useProgram:program=>{currentProgram=program;values={};},
  bindFramebuffer:(target,value)=>{currentFramebuffer=value;},viewport:(...value)=>{viewport=value;},
  drawArrays:()=>draws.push({program:currentProgram,framebuffer:currentFramebuffer,viewport:[...viewport],uniforms:{...values}}),
  clientWaitSync:()=>0,fenceSync:()=>({fence:nextId++}),getParameter:()=>false,
 },{get(target,name){if(name in target)return target[name];return (...args)=>{calls.push({name,args});if(name.startsWith('uniform'))values[args[0]]=args.length===2?args[1]:args.slice(1);};}});
 const canvas={width:0,height:0,dataset:{},getBoundingClientRect:()=>({width:1536,height:960}),toDataURL:()=>`data:image/png;${canvas.width}x${canvas.height}`};
 const renderer=Object.create(VolumeRenderer.prototype);
 Object.assign(renderer,{gl,canvas,loaded:true,program:'volume',compositeProgram:'composite',uniforms:new Proxy({},{get:(_,name)=>name}),compositeUniforms:new Proxy({},{get:(_,name)=>name}),
  settings:{mode:0,palette:4,threshold:.28,opacity:.8,clipAxis:0,clipPosition:.5,clipFlip:0,showPlanes:0,slices:[.5,.5,.5],quality,capContrast:1.8,cleanupEnabled:true,anatomyOpacity:.65,anatomySelected:0,surfaceSmoothing:1},
  camera:{yaw:.3,pitch:.1,roll:Math.PI,distance:1.65,pan:[0,0,0]},extent:[.9,1,.9],dimensions:[475,475,530],
  cap:{data:new Uint8Array(9),width:3,height:3,cleaned:true,plane:{center:[0,0,0],right:[0,0,-1],up:[0,-1,0],width:.9,height:1}},
  cleanup:{dimensions:[238,238,265]},anatomyColors:Array.from({length:16},()=>[.5,.5,.5]),interactionPixels:70000,
  lastInteraction:-1e6,timerExtension:null,gpuQueries:[],autoRotate:false,pending:0});
 globalThis.window={devicePixelRatio:dpr};globalThis.requestAnimationFrame=()=>1;
 return {renderer,canvas,draws,calls,reset(){draws.length=0;calls.length=0;renderer.pending=0;renderer.requestRender();}};
}
function test(name,body){body();results.push({name,passed:true});console.log(`PASS ${name}`);}
test('Orbit, pan and zoom retain the idle drawing-buffer size and the full scene ray grid',()=>{
 const h=harness();h.renderer.render(true);const idle=[h.canvas.width,h.canvas.height];assert.equal(h.draws.length,1);
 for(const motion of ['orbit','pan','zoom']){
  h.reset();h.renderer.interacting=motion!=='zoom';h.renderer.lastInteraction=performance.now();
  if(motion==='orbit')h.renderer.orbit(10,5);if(motion==='pan')h.renderer.camera.pan=[.1,-.1,0];if(motion==='zoom')h.renderer.camera.distance=.8;
  h.renderer.render();assert.deepEqual([h.canvas.width,h.canvas.height],idle);assert.equal(h.draws.length,1);
  const [volume]=h.draws;assert.equal(volume.program,'volume');assert.deepEqual(volume.viewport,[0,0,...idle]);
  assert.equal(volume.uniforms.skipCap,0);assert.equal(volume.framebuffer,null);assert.equal(volume.uniforms.cameraAspect,1.6);
  assert.equal(h.renderer.renderStats.volumePixels,idle[0]*idle[1]);assert.equal(h.renderer.renderStats.cameraQuality,true);
  assert.equal(h.renderer.renderStats.capPixels,idle[0]*idle[1]);assert.equal(h.renderer.renderStats.fullResolutionCap,true);
 }
});
test('Fine cap cleanup provenance is independent of ordinary volume cleanup in both passes',()=>{
 const h=harness();h.renderer.interacting=true;h.renderer.render();
 for(const draw of h.draws){assert.equal(draw.uniforms.capCleaned,1);assert.equal(draw.uniforms.cleanupEnabled,1);assert.equal(draw.uniforms.cleanupReady,1);}
 h.reset();h.renderer.cap.cleaned=false;h.renderer.render();assert(h.draws.every(draw=>draw.uniforms.capCleaned===0));
 assert(volumeShaderSources.volume.includes('if(capReady==0)return density(p);'));
 assert(volumeShaderSources.composite.includes('if(capCleaned==0&&cleanupAt(p)<.5)return 0.;'));
});
test('Motion changes neither threshold, cap contrast, lighting palette nor physical volume sample step',()=>{
 const h=harness();h.renderer.render(true);const idle=h.draws[0].uniforms;h.reset();h.renderer.interacting=true;h.renderer.render();
 for(const draw of h.draws)for(const name of ['palette','threshold','capContrast','stepSize','surfaceSmoothing','opacity'])assert.deepEqual(draw.uniforms[name],idle[name],name);
});
test('Motion target failure falls back to a full-resolution single pass',()=>{
 const h=harness({framebufferWorks:false});h.renderer.render();const idle=[h.canvas.width,h.canvas.height];h.reset();h.renderer.interacting=true;h.renderer.render();
 assert.deepEqual([h.canvas.width,h.canvas.height],idle);assert.equal(h.draws.length,1);assert.equal(h.draws[0].uniforms.skipCap,0);
 assert.equal(h.renderer.renderStats.fullResolutionCap,true);assert.equal(h.renderer.motionTargetUnsupported,true);assert.equal(h.renderer.motionTarget,null);
});
test('Snapshot forces the full-resolution single-pass render even during interaction',()=>{
 const h=harness({quality:'high'});h.renderer.interacting=true;h.renderer.render();assert.equal(h.draws.length,2);const size=[h.canvas.width,h.canvas.height];
 h.reset();const image=h.renderer.snapshot();assert.equal(h.draws.length,1);assert.deepEqual([h.canvas.width,h.canvas.height],size);
 assert.equal(h.renderer.renderStats.volumePixels,h.renderer.renderStats.outputPixels);assert(image.includes(`${size[0]}x${size[1]}`));
});
test('Whole-organ and translucent views retain cheap background rendering without inventing a cap',()=>{
 const h=harness();h.renderer.interacting=true;h.renderer.settings.clipAxis=-1;h.renderer.render();assert.equal(h.renderer.renderStats.capPixels,0);assert.equal(h.draws.length,2);
 h.reset();h.renderer.settings.clipAxis=0;h.renderer.settings.mode=1;h.renderer.render();assert.equal(h.renderer.renderStats.capPixels,0);assert.equal(h.draws.length,2);
});
test('Motion color target is reused rather than accumulating textures on every frame',()=>{
 const h=harness();h.renderer.interacting=true;h.renderer.render();const target=h.renderer.motionTarget;
 h.reset();h.renderer.render();assert.equal(h.renderer.motionTarget,target);assert(!h.calls.some(call=>call.name==='texImage2D'));
 assert.equal(h.renderer.renderStats.targetBytes,target.width*target.height*4);
});
const report={schemaVersion:1,verifiedAt:new Date().toISOString(),passed:results.length,failed:0,
 scope:'Actual VolumeRenderer render path with a recording WebGL interface. Pixel correctness is checked separately by native EGL.',tests:results};
await writeFile(new URL('../docs/renderer-motion-v7-orchestration.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:results.length,failed:0}));
