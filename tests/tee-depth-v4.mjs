import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {VolumeRenderer} from '../public/renderer.js';
import {CPUVolumeRenderer} from '../public/cpu-renderer.js';
import {TeeSceneOverlay} from '../public/tee-scene.js';
import {depthRaster,depthTriangle,depthLine,depthPointVisible} from '../public/tee-software-depth.js';
import {sceneWindowDepth} from '../public/render-depth.js';
import {clipPlane} from '../public/planes.js';
import * as styles from '../public/render-styles.js';
import {buildAcceleration,validAcceleration} from '../public/render-v5-acceleration.js';

const basis={eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};
function graphics(){
 let next=0,currentTexture=null,currentFramebuffer=null,currentVao=null,requests=0;
 const calls=[],checks=[],constants={},attachments=new Map(),storage=new Map();
 const core={
  createTexture:()=>({type:'texture',id:++next}),createFramebuffer:()=>({type:'framebuffer',id:++next}),createBuffer:()=>({type:'buffer',id:++next}),
  createProgram:()=>({type:'program',id:++next}),createShader:()=>({type:'shader',id:++next}),createVertexArray:()=>({type:'vao',id:++next}),
  getUniformLocation:(_,key)=>key,getAttribLocation:(_,key)=>key==='position'?0:1,getShaderParameter:()=>true,getProgramParameter:()=>true,
  bindTexture(_,texture){currentTexture=texture;},bindFramebuffer(_,framebuffer){currentFramebuffer=framebuffer;},bindVertexArray(vao){currentVao=vao;calls.push(['vao',vao]);},
  texImage2D(_target,_level,_format,width,height){storage.set(currentTexture,{width,height});},
  framebufferTexture2D(_target,attachment,_textureTarget,texture){if(!attachments.has(currentFramebuffer))attachments.set(currentFramebuffer,new Map());attachments.get(currentFramebuffer).set(attachment,texture);},
  checkFramebufferStatus(){
   const a=attachments.get(currentFramebuffer),color=storage.get(a?.get(gl.COLOR_ATTACHMENT0)),depth=storage.get(a?.get(gl.DEPTH_ATTACHMENT));
   const complete=!!color&&(!depth||color.width===depth.width&&color.height===depth.height);checks.push({complete,color:{...color},depth:depth&&{...depth}});return complete?gl.FRAMEBUFFER_COMPLETE:0;
  },
  vertexAttribPointer(...args){calls.push(['attribute',currentVao,...args]);},drawArrays(...args){calls.push(['draw',currentVao,...args]);},
 };
 const gl=new Proxy(core,{get(target,key){if(key in target)return target[key];if(/^[A-Z\d_]+$/.test(key))return constants[key]??=++next;return (...args)=>calls.push([key,...args]);}});
 const canvas={width:800,height:600,getBoundingClientRect:()=>({width:800,height:600})};
 const renderer=Object.assign(Object.create(VolumeRenderer.prototype),{gl,canvas,requestRender:()=>{requests++;}});
 return {gl,renderer,canvas,calls,checks,attachments,storage,requests:()=>requests,vao:()=>currentVao};
}

test('perspective depth uses the same near/far interval as the real fine mesh',()=>{
 assert.ok(Math.abs(sceneWindowDepth(.01))<1e-12);assert.ok(Math.abs(sceneWindowDepth(10)-1)<1e-12);
 for(const depth of [.1,.5,1,2,5])assert.ok(Math.abs(sceneWindowDepth(depth)-((10.01/9.99*depth-.2/9.99)/depth*.5+.5))<1e-12);
});

test('a late context activation and viewport resize attach matching scene-depth storage before completeness checks',()=>{
 const h=graphics(),r=h.renderer;
 assert.equal(r.ensureMotionTarget(80,60),true);assert.equal(r.motionTarget.depthTexture,undefined);
 r.setContextLayer({draw(){}});assert.equal(r.ensureMotionTarget(80,60),true);
 const depth=r.motionTarget.depthTexture;assert.ok(depth);
 assert.equal(h.attachments.get(r.motionTarget.framebuffer).get(h.gl.DEPTH_ATTACHMENT),depth);
 assert.equal(r.ensureMotionTarget(150,100),true);assert.equal(r.motionTarget.depthTexture,depth);
 assert.deepEqual(h.storage.get(depth),{width:150,height:100});assert.ok(h.checks.every(x=>x.complete));
 assert.equal(r.ensureRefinementTarget(120,90),true);assert.equal(r.ensureRefinementTarget(90,120),true);
 assert.ok(h.checks.every(x=>x.complete));assert.equal(r.motionTargetUnsupported,undefined);assert.equal(r.refinementTargetUnsupported,undefined);
 r.setContextLayer(null);assert.equal(r.ensureMotionTarget(200,150),true);assert.equal(r.ensureRefinementTarget(180,110),true);
 assert.deepEqual(h.storage.get(depth),{width:200,height:150});assert.ok(h.checks.every(x=>x.complete),'Disabling context must not leave an old-size depth attachment behind after resize.');
});

test('shared context lifecycle never redraws from an independent camera loop and restores the source VAO',()=>{
 const h=graphics(),r=h.renderer,scene=new TeeSceneOverlay({}, {renderer:r});
 const pose={originMm:[0,0,0],instrument:{originMm:[0,0,0],beam:[0,0,-1],right:[1,0,0],normal:[0,1,0]},shaftPoints:[[0,20,0],[0,10,0],[0,0,0]]};
 const params={basis,width:800,height:600,dpr:1,pose,reference:{referenceMm:150,scale:1},showProbe:true,showContext:false};
 assert.equal(scene.sharedDepth,true);assert.equal(scene.view.canvas,r.canvas);
 scene.render(params);assert.equal(r.contextLayer,scene.layer);const requests=h.requests();
 scene.render({...params,basis:{...basis,eye:[0,0,3]}});assert.equal(h.requests(),requests,'Camera frames come from the heart renderer, not a second overlay render loop.');
 r.drawContextLayer(800,600,basis,4/3);assert.ok(h.calls.some(x=>x[0]==='draw'));assert.equal(h.vao(),null);
 assert.ok(h.calls.filter(x=>x[0]==='attribute').every(x=>x[1]!==null),'The heart fullscreen triangle VAO must stay untouched.');
 scene.setActive(false);assert.equal(r.contextLayer,null);const stopped=h.requests();scene.render(params);assert.equal(h.requests(),stopped);
 scene.setActive(true);assert.equal(r.contextLayer,scene.layer);scene.dispose();assert.equal(r.contextLayer,null);
});

test('software anatomy and thin contours are blocked per heart pixel while front geometry and cavities remain visible',()=>{
 const width=40,height=30,data=new Float32Array(width*height).fill(Infinity);
 for(let y=5;y<25;y++)for(let x=8;x<32;x++)data[y*width+x]=2;
 for(let y=12;y<18;y++)for(let x=17;x<23;x++)data[y*width+x]=Infinity;
 const occlusion={width,height,data,revision:1},r=depthRaster(occlusion,width,height),quad=d=>[{x:0,y:0,depth:d},{x:40,y:0,depth:d},{x:40,y:30,depth:d},{x:0,y:30,depth:d}];
 const draw=(target,d)=>{const q=quad(d);depthTriangle(target,[q[0],q[1],q[2]],[240,80,40,.2]);depthTriangle(target,[q[0],q[2],q[3]],[240,80,40,.2]);};
 draw(r,3);depthLine(r,{x:0,y:15,depth:3},{x:40,y:15,depth:3},[255,255,255,.7],2);
 assert.equal(r.pixels[(15*width+12)*4+3],0);assert.ok(r.pixels[(15*width+20)*4+3]>0);assert.ok(r.pixels[(15*width+4)*4+3]>0);
 const front=depthRaster(occlusion,width,height);draw(front,1);assert.ok(front.pixels[(15*width+12)*4+3]>0);
 assert.equal(depthPointVisible(occlusion,{x:12,y:15,depth:3},width,height),false);assert.equal(depthPointVisible(occlusion,{x:20,y:15,depth:3},width,height),true);
 assert.equal(depthRaster({pending:true},width,height),null);
});

test('software occlusion accepts only the same displayed source frame and camera basis',()=>{
 const r=Object.assign(Object.create(CPUVolumeRenderer.prototype),{basis:()=>basis,displayedId:7,frameId:7,contextFrameRevision:4,contextDepth:{width:2,height:2,data:new Float32Array(4),basis,revision:4}});
 assert.equal(r.getContextOcclusion(),r.contextDepth);r.frameId=8;assert.equal(r.getContextOcclusion().pending,true);r.frameId=7;
 r.basis=()=>({...basis,eye:[0,0,3]});assert.equal(r.getContextOcclusion().pending,true);
 assert.equal(VolumeRenderer.prototype.getContextOcclusion.call({}).unavailable,true,'An unavailable shared GPU pass must never fall back to x-ray anatomy.');
});

test('the actual CPU worker returns source-hit and exact cap depths, with open rays left unoccluded',async()=>{
 const source=(await readFile(new URL('../public/cpu-worker.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const context=vm.createContext({clipPlane,...styles,buildAcceleration,validAcceleration,performance,setTimeout,Float32Array,Uint8Array,Uint8ClampedArray,onmessage:null,postMessage(){}});
 vm.runInContext(source,context);const n=32,data=new Uint8Array(n*n*n);
 for(let z=4;z<28;z++)for(let y=8;y<24;y++)for(let x=4;x<28;x++)if(!(x>=13&&x<19&&z>=13&&z<19))data[x+n*(y+n*z)]=180;
 context.onmessage({data:{type:'load',data:data.buffer,dimensions:[n,n,n]}});
 const settings={mode:0,palette:4,quality:'auto',threshold:.3,opacity:.8,clipAxis:-1,showPlanes:0,cleanupEnabled:false,capContrast:1.8,slices:[.5,.5,.5]};
 context.job={w:33,h:33,extent:[1,1,1],basis,settings,fast:false};
 const whole=await vm.runInContext('render(job,()=>false)',context);assert.equal(whole.depths.length,33*33);assert.equal(whole.depths[16*33+16],Infinity);
 assert.ok(whole.depths[16*33+10]>1.7&&whole.depths[16*33+10]<1.9);assert.equal(whole.depths[0],Infinity);
 const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:1,height:1};
 context.onmessage({data:{type:'cap',cap:{data:new Uint8Array(81).fill(180),width:9,height:9,plane}}});context.job={...context.job,settings:{...settings,clipAxis:3,oblique:plane}};
 const cap=await vm.runInContext('render(job,()=>false)',context);assert.ok(Math.abs(cap.depths[16*33+16]-2)<1e-6,'The fine cap fills only its exact requested plane, not a coarse surface depth.');
});
