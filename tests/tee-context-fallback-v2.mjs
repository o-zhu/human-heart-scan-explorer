import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {createTeeContextModel,teeContextCamera,teeContextToLocal} from '../public/tee-context-geometry.js';
import {paintTeeContextFallback,paintTeeContextLabels} from '../public/tee-scene.js';
import {projectProbePoint} from '../public/probe-geometry.js';

const original={Path2D:globalThis.Path2D,OffscreenCanvas:globalThis.OffscreenCanvas};
class RecordedPath{
 constructor(){this.commands=[];}
 moveTo(x,y){this.commands.push(['M',x,y]);}lineTo(x,y){this.commands.push(['L',x,y]);}closePath(){this.commands.push(['Z']);}
}
class RecordedContext{
 constructor(canvas){this.canvas=canvas;this.fills=[];this.strokes=[];this.images=[];this.path=new RecordedPath();}
 save(){}restore(){}setTransform(){}clearRect(){this.fills=[];this.strokes=[];}getTransform(){return {a:1,b:0,c:0,d:1};}
 beginPath(){this.path=new RecordedPath();}moveTo(x,y){this.path.moveTo(x,y);}lineTo(x,y){this.path.lineTo(x,y);}closePath(){this.path.closePath();}
 fill(path=this.path){this.fills.push({path,color:this.fillStyle});}stroke(){this.strokes.push({path:this.path,color:this.strokeStyle,width:this.lineWidth});}
 drawImage(...args){this.images.push(args);}fillRect(){}fillText(){}measureText(text){return {width:text.length*5.5};}
}
class RecordedCanvas{
 constructor(width,height){this.width=width;this.height=height;this.ctx=new RecordedContext(this);}
 getContext(type){assert.equal(type,'2d');return this.ctx;}
}
globalThis.Path2D=RecordedPath;globalThis.OffscreenCanvas=RecordedCanvas;
const model=createTeeContextModel(),canvas=new RecordedCanvas(800,800),ctx=canvas.ctx,basis=teeContextCamera(model,1);
let calls=0;
const project=p=>{calls++;return projectProbePoint(p.map(v=>v/model.referenceMm),basis,800,800);};
const hash=()=>createHash('sha256').update(Buffer.concat(model.meshes.map(m=>Buffer.from(m.vertices.buffer)))).digest('hex'),before=hash();
const report={scope:'Production software-context geometry, projection, batched canvas commands and cache behavior. Timings measure JavaScript/recording-context work, not browser raster paint or frame rate.',checks:[]};
let first,layer;

test('actual organ surfaces receive bounded shaded fills and all original contours survive',()=>{
 first=paintTeeContextFallback(ctx,project,model,800,800);layer=ctx.images.at(-1)[0].ctx;
 assert.equal(first.preparedTriangles,8544);assert.ok(first.preparedVertices<5000);assert.ok(first.trianglesDrawn>7000);
 assert.ok(first.fillBatches>16&&first.fillBatches<=64);assert.equal(layer.fills.length,first.fillBatches);assert.equal(layer.strokes.length,Object.keys(model.contours).length);
 assert.ok(layer.fills.some(f=>f.color.endsWith(',0.13)')),'Esophageal fill missing.');assert.ok(layer.fills.some(f=>f.color.endsWith(',0.11)')),'Gastric fill missing.');assert.ok(layer.fills.some(f=>f.color.endsWith(',0.075)')),'Diaphragm/tendon fill missing.');
 assert.equal(first.cacheHit,false);assert.equal(first.rasterCached,true);assert.ok(calls<6000);
 report.initialFrame=first;report.initialProjectionCalls=calls;report.checks.push('Actual esophagus, stomach, diaphragm and tendon geometry generates shaded fills in at most 64 batches; all contour paths are retained.');
});

test('shared GE boundary remains coincident in both software organ fills',()=>{
 const sets=Object.fromEntries([['esophagus',',0.13)'],['stomach',',0.11)']].map(([id,alpha])=>[id,new Set(layer.fills.filter(f=>f.color.endsWith(alpha)).flatMap(f=>f.path.commands.filter(c=>c.length===3).map(c=>`${c[1].toFixed(5)},${c[2].toFixed(5)}`)))]));
 const t=model.topology.gastrointestinal;
 for(let j=0;j<t.segments;j+=2){const i=(t.joinRing*t.segments+j)*3,p=project(Array.from(t.positionsMm.slice(i,i+3))),key=`${p.x.toFixed(5)},${p.y.toFixed(5)}`;assert.ok(sets.esophagus.has(key)&&sets.stomach.has(key),'A retained GE junction vertex is not shared by both fills.');}
 report.checks.push('All 24 retained GE junction vertices appear at exactly identical projected coordinates in esophageal and gastric fill paths.');
});

test('the actual hiatus remains open, without generic ellipse or hole-filling triangles',()=>{
 const dia=model.meshes.find(m=>m.id==='diaphragm'),only={...model,meshes:[dia],topology:{diaphragm:model.topology.diaphragm},contours:{},labels:[]},c=new RecordedCanvas(400,400).ctx;
 const p=q=>{const v=teeContextToLocal(q,model.frame);return {x:200+v[0],y:200+v[2],depth:500-v[1]};};
 paintTeeContextFallback(c,p,only,400,400);const fills=c.images.at(-1)[0].ctx.fills,center=[212,171];
 const sign=(p,a,b)=>(p[0]-b[0])*(a[1]-b[1])-(a[0]-b[0])*(p[1]-b[1]);
 let triangles=0;
 for(const fill of fills){let vertices=[];for(const command of fill.path.commands){if(command.length===3)vertices.push(command.slice(1));else{
  assert.equal(vertices.length,3);const signs=[sign(center,vertices[0],vertices[1]),sign(center,vertices[1],vertices[2]),sign(center,vertices[2],vertices[0])];
  assert.ok(signs.some(x=>x<0)&&signs.some(x=>x>0),'A software triangle fills the esophageal hiatus.');triangles++;vertices=[];
 }}}
 assert.ok(triangles>2000);report.checks.push('Top-down diaphragm rendering contains no triangle over the true hiatus center; its annular topology survives display-grid reduction.');
});

test('an unchanged camera performs eight anchor projections and one image composite, with no new path work',()=>{
 calls=0;const initialFills=layer.fills.length,beforeImages=ctx.images.length;
 const result=paintTeeContextFallback(ctx,p=>project(p),model,800,800);
 assert.equal(result.cacheHit,true);assert.equal(calls,8);assert.equal(layer.fills.length,initialFills);assert.equal(ctx.images.length,beforeImages+1);
 const times=[];for(let i=0;i<100;i++){const start=performance.now();paintTeeContextFallback(ctx,project,model,800,800);times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);report.cachedCallMedianMs=times[50];report.cachedCallP95Ms=times[95];
 report.checks.push('A fresh projection closure with identical camera reuses one transparent raster; cached calls only project eight bounds anchors and composite once.');
});

test('camera and viewport changes invalidate projection while leaving original model buffers untouched',()=>{
 const reverse=teeContextCamera(model,1,model.frame.posterior),back=p=>projectProbePoint(p.map(v=>v/model.referenceMm),reverse,800,800);
 assert.equal(paintTeeContextFallback(ctx,back,model,800,800).cacheHit,false);
 assert.equal(paintTeeContextFallback(ctx,back,model,800,800).cacheHit,true);
 assert.equal(paintTeeContextFallback(ctx,back,model,700,800).cacheHit,false);
 assert.equal(hash(),before);report.checks.push('Camera/viewport changes regenerate the software layer; all full-resolution model buffers remain byte-identical.');
});

test('no-OffscreenCanvas and no-Path2D environments still receive batched filled anatomy through the existing caller',()=>{
 globalThis.OffscreenCanvas=undefined;globalThis.Path2D=undefined;
 const c=new RecordedContext({}),copy={...model};paintTeeContextLabels(c,project,copy,800,800,{fallback:true});
 assert.ok(c.fills.length>16&&c.fills.length<=64);assert.equal(c.images.length,0);assert.ok(c.strokes.length>=Object.keys(model.contours).length);
 report.checks.push('The existing paintTeeContextLabels fallback call receives filled organs even without offscreen-canvas or Path2D support.');
 globalThis.Path2D=RecordedPath;globalThis.OffscreenCanvas=RecordedCanvas;
});

test.after(async()=>{
 Object.assign(globalThis,original);
 const out='docs/tee-context-v2/software-fallback-verification.json';await writeFile(out,JSON.stringify(report,null,2)+'\n');
 const path=p=>p.commands.map(c=>c.join(' ')).join(' '),body=[...layer.fills.map(f=>`<path d="${path(f.path)}" fill="${f.color}"/>`),...layer.strokes.map(s=>`<path d="${path(s.path)}" fill="none" stroke="${s.color}" stroke-width="${s.width}"/>`)];
 await mkdir('/tmp/tee-context-v2',{recursive:true});await writeFile('/tmp/tee-context-v2/software-fallback.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="#081115"/>${body.join('')}</svg>`);
});
