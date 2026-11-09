import {add,mul,dot,cross,norm} from './planes.js';
import {GeometryCanvas,triangleMesh,createProbeMeshes,probeModelMatrix} from './probe-scene.js';
import {TeeDepthLabels} from './tee-depth-labels.js';
import {depthPointVisible,depthRaster,depthColor,depthTriangle,depthLine,paintDepthRaster} from './tee-software-depth.js';
import {withHeartPriority,contextLabelMetrics,placeContextLabel} from './echo-context-presentation.js';

/** Small illustrative catheter geometry. This overlay intentionally shares
 * the heart camera, but is a positioning guide, not segmented donor anatomy. */
function tube(points,radius,segments=12){
 const clean=points.filter((p,i)=>!i||Math.hypot(...p.map((v,j)=>v-points[i-1][j]))>1e-6),vertices=[],faces=[];
 if(clean.length<2)return new Float32Array();
 let previousSide=null;
 for(let k=0;k<clean.length;k++){
  const tangent=norm(clean[Math.min(k+1,clean.length-1)].map((v,i)=>v-clean[Math.max(0,k-1)][i]));
  // Carry the cross-section along the shaft. Rebuilding it from world-up at
  // every ring flips the tube when a bend crosses that arbitrary axis.
  let side=previousSide?previousSide.map((v,i)=>v-tangent[i]*dot(previousSide,tangent)):cross(tangent,[0,1,0]);
  if(Math.hypot(...side)<1e-3)side=cross(tangent,Math.abs(tangent[0])<.9?[1,0,0]:[0,1,0]);side=norm(side);previousSide=side;
  const n=norm(cross(tangent,side));
  for(let i=0;i<segments;i++){const a=i*2*Math.PI/segments;vertices.push(add(clean[k],add(mul(side,Math.cos(a)*radius),mul(n,Math.sin(a)*radius))));}
 }
 for(let j=0;j<clean.length-1;j++)for(let i=0;i<segments;i++){const a=j*segments+i,b=j*segments+(i+1)%segments;faces.push([a,b,b+segments],[a,b+segments,a+segments]);}
 return triangleMesh(vertices,faces);
}

export class TeeSceneOverlay{
 constructor(canvas,{renderer=null}={}){
  this.renderer=renderer;this.active=true;this.sharedDepth=Boolean(renderer?.gl&&renderer.setContextLayer);
  // A software heart must supply its own accepted depth field to the software
  // context path. A second independent WebGL canvas would recreate x-ray bleed.
  if(renderer?.backend==='software')throw new Error('Spatial context follows the software heart depth.');
  this.view=new GeometryCanvas(this.sharedDepth?renderer.canvas:canvas,this.sharedDepth?{gl:renderer.gl}:{});
  if(this.sharedDepth){
   this.labels=new TeeDepthLabels(renderer);
   this.layer={draw:frame=>this.drawShared(frame),onError:error=>{this.error=error;this.setActive(false);console.warn('TEE spatial context:',error);}};
  }
  // The generic TEE head is reused without its old fixed shaft. Electronic
  // multiplane rotation must not rotate this mechanical instrument.
  this.head=createProbeMeshes('tee').filter((_,i)=>i!==2).map(m=>this.view.upload(m.vertices,m.color,1,m.gloss));
 }
 setActive(active){
  this.active=Boolean(active);
  if(!this.sharedDepth)return;
  const enabled=this.active&&this.params&&(this.params.showProbe||this.params.showContext);
  if(enabled)this.renderer.setContextLayer(this.layer);
  else if(this.renderer.contextLayer===this.layer)this.renderer.setContextLayer(null);
 }
 setContext(model){
  if(this.contextModel===model)return;
  for(const m of this.contextMeshes||[])this.view.remove(m);
  this.contextModel=model;this.contextMeshes=(model?.meshes||[]).map(m=>({...this.view.upload(m.vertices,m.color,m.alpha,m.gloss),center:m.bounds.center,role:m.role}));
 }
 render(params){
  const {pose,reference,showProbe=true,contextModel=null,showContext=false,probeLabel=''}=params;
  if(this.sharedDepth){
   const key=[showProbe,showContext,reference.referenceMm,probeLabel,...pose.originMm,...pose.instrument.beam,...pose.instrument.right,...pose.instrument.normal,...pose.shaftPoints.flat()].join(',');
   const changed=this.parameterKey!==key||this.params?.contextModel!==contextModel;
   this.parameterKey=key;this.params={...params,showProbe,showContext,probeLabel,contextModel};this.setActive(this.active);
   if(changed&&this.active&&this.renderer.contextLayer===this.layer)this.renderer.requestRender();
   return;
  }
  this.drawGeometry(params);
 }
 drawShared(frame){
  if(!this.active||!this.params)return;
  const params={...this.params,...frame,dpr:1};
  this.drawGeometry(params);
  this.labels.draw({...frame,referenceMm:params.reference.referenceMm,model:params.contextModel,pose:params.pose,showContext:params.showContext,showProbe:params.showProbe,probeLabel:params.probeLabel});
 }
 drawGeometry({basis,width,height,dpr,pose,reference,showProbe=true,contextModel=null,showContext=false}){
  this.view.begin(basis,width,height,reference.referenceMm,dpr);
  if(showProbe){
   const key=pose.shaftPoints.flat().map(x=>x.toFixed(5)).join(',');
   if(this.key!==key){this.view.remove(this.shaft);this.shaft=this.view.upload(tube(pose.shaftPoints,1.8*reference.scale),[.16,.20,.22],1,.14);this.key=key;}
   this.view.draw(this.shaft);
   const model=probeModelMatrix(pose.instrument,.60*reference.scale);
   for(const mesh of this.head)this.view.draw(mesh,model);
  }
  if(showContext&&contextModel){
   this.setContext(contextModel);
   const gl=this.view.gl,depth=m=>dot(m.center,basis.forward),surfaces=this.contextMeshes.filter(m=>m.role!=='contour').sort((a,b)=>depth(b)-depth(a)),contours=this.contextMeshes.filter(m=>m.role==='contour').sort((a,b)=>depth(b)-depth(a));
   // Illustrative anatomy is an automatic cutaway around the actual accepted
   // heart and cap. Probe geometry above retains its physical perspective depth.
   const draw=()=>{
    gl.enable(gl.CULL_FACE);gl.cullFace(gl.FRONT);for(const m of surfaces)this.view.draw(m);
    gl.cullFace(gl.BACK);for(const m of surfaces)this.view.draw(m);
    gl.disable(gl.CULL_FACE);for(const m of contours)this.view.draw(m);
   };
   if(this.sharedDepth)withHeartPriority(gl,draw);else draw();
  }
 }
 dispose(){this.setActive(false);this.labels?.dispose();this.view.dispose();}
}

// The software path uses the same authored surfaces. One weakly-held entry per
// model stores a modest display mesh and the most recent transparent raster;
// probe motion cannot invalidate anatomy when the camera has not changed.
const contextFallbackCache=new WeakMap();
const fallbackLight=norm([-.35,.65,.85]),fallbackFill=norm([.7,.2,-.5]);
const fallbackNow=()=>globalThis.performance?.now?.()??Date.now();

function contextGrid(topology,ringStep=2,columnStep=2){
 const rows=[],columns=[],points=[],faces=[];
 for(let r=0;r<topology.rings;r+=ringStep)rows.push(r);
 if(rows.at(-1)!==topology.rings-1)rows.push(topology.rings-1);
 for(let c=0;c<topology.segments;c+=columnStep)columns.push(c);
 for(const r of rows)for(const c of columns){const i=(r*topology.segments+c)*3;points.push(Array.from(topology.positionsMm.slice(i,i+3)));}
 const count=columns.length,split=topology.joinRing;
 for(let r=0;r<rows.length-1;r++)for(let c=0;c<count;c++){
  const a=r*count+c,b=r*count+(c+1)%count,d=(r+1)*count+(c+1)%count,e=(r+1)*count+c;
  const part=split===undefined?0:rows[r]<split?0:1;faces.push({v:[a,b,e],part},{v:[b,d,e],part});
 }
 const normals=points.map(()=>[0,0,0]);
 for(const face of faces){const [a,b,c]=face.v,n=cross(points[b].map((x,i)=>x-points[a][i]),points[c].map((x,i)=>x-points[a][i]));for(const i of face.v)for(let k=0;k<3;k++)normals[i][k]+=n[k];}
 return {points,normals:normals.map(norm),faces,sourceRows:rows,sourceColumns:columns};
}

function contextIndexedMesh(mesh){
 const points=[],normals=[],faces=[],indices=new Map(),v=mesh.vertices;
 for(let i=0;i<v.length;i+=18){const face=[];for(let j=0;j<3;j++){
  const at=i+j*6,key=`${v[at]},${v[at+1]},${v[at+2]}`;let index=indices.get(key);
  if(index===undefined){index=points.length;indices.set(key,index);points.push([v[at],v[at+1],v[at+2]]);normals.push([v[at+3],v[at+4],v[at+5]]);}
  face.push(index);
 }faces.push({v:face,part:0});}
 return {points,normals,faces};
}

function prepareContextFallback(model){
 const start=fallbackNow(),sources=new Map(model.meshes.map(m=>[m.id,m])),parts=[],geometries=[];
 const addPart=(id,geometry,part=0)=>{const source=sources.get(id);if(source)parts.push({source,geometry,faces:geometry.faces.filter(f=>f.part===part)});};
 if(model.topology?.gastrointestinal){
  const geometry=contextGrid(model.topology.gastrointestinal);geometries.push(geometry);addPart('esophagus',geometry,0);addPart('stomach',geometry,1);
 }
 if(model.topology?.diaphragm){const geometry=contextGrid(model.topology.diaphragm);geometries.push(geometry);addPart('diaphragm',geometry);}
 for(const source of model.meshes){
  if(source.role==='contour'||parts.some(p=>p.source===source))continue;
  const geometry=contextIndexedMesh(source);geometries.push(geometry);addPart(source.id,geometry);
 }
 return {parts,geometries,geometryBuildMs:fallbackNow()-start,key:null,layer:null,commands:[],stats:{}};
}

function contextProjectionKey(project,model,width,height,ratio){
 const values=[width,height,ratio];
 for(let mask=0;mask<8;mask++){
  const p=project(model.bounds.min.map((v,i)=>(mask>>i)&1?model.bounds.max[i]:v));
  values.push(p?`${p.x.toFixed(5)},${p.y.toFixed(5)},${Number.isFinite(p.depth)?p.depth.toFixed(8):''}`:'behind');
 }
 return values.join('|');
}

function contextShade(source,tone){
 const lighting=.42+(tone+.5)/8*.62;
 const rgb=source.color.map(v=>Math.round(255*Math.pow(Math.min(1,Math.pow(v,2.2)*lighting),1/2.2)));
 return `rgba(${rgb.join(',')},${source.alpha})`;
}

function projectContextFallback(entry,project,model,width,height){
 const start=fallbackNow(),projected=new Map();let projectionCount=0,trianglesDrawn=0;
 for(const geometry of entry.geometries){projected.set(geometry,geometry.points.map(p=>{projectionCount++;return project(p);}));}
 const surfaces=entry.parts.map(part=>({part,depth:project(part.source.bounds.center)?.depth||0})).sort((a,b)=>b.depth-a.depth),commands=[];
 // Back and front passes reproduce the transparent volume impression while
 // only eight tone paths per organ/side are filled, never one fill per face.
 for(const back of [true,false])for(const {part}of surfaces){
  const p=projected.get(part.geometry),buckets=Array.from({length:8},()=>({path:typeof globalThis.Path2D==='function'?new globalThis.Path2D():null,triangles:[],depthTriangles:[]}));
  for(const face of part.faces){
   const [a,b,c]=face.v.map(i=>p[i]);if(!a||!b||!c||![a.x,a.y,b.x,b.y,c.x,c.y].every(Number.isFinite))continue;
   const area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
   if((area>0)!==back||Math.abs(area)<.008||Math.max(a.x,b.x,c.x)<-2||Math.min(a.x,b.x,c.x)>width+2||Math.max(a.y,b.y,c.y)<-2||Math.min(a.y,b.y,c.y)>height+2)continue;
   let n=norm(face.v.reduce((sum,i)=>add(sum,part.geometry.normals[i]),[0,0,0]));if(back)n=mul(n,-1);
   const lighting=.42+.47*Math.max(0,dot(n,fallbackLight))+.14*Math.max(0,dot(n,fallbackFill)),tone=Math.max(0,Math.min(7,Math.floor((lighting-.42)/.62*8))),bucket=buckets[tone];
   if(bucket.path){bucket.path.moveTo(a.x,a.y);bucket.path.lineTo(b.x,b.y);bucket.path.lineTo(c.x,c.y);bucket.path.closePath();}
   else bucket.triangles.push([a.x,a.y,b.x,b.y,c.x,c.y]);
   bucket.depthTriangles.push([a,b,c]);
   bucket.count=(bucket.count||0)+1;trianglesDrawn++;
  }
  for(let tone=0;tone<8;tone++)if(buckets[tone].count)commands.push({...buckets[tone],color:contextShade(part.source,tone),organ:part.source.id,back});
 }
 const contours=[];
 for(const [id,points]of Object.entries(model.contours||{})){
  const path=points.map(p=>{projectionCount++;return project(p);}),closed=id==='hiatus'||id==='diaphragmRim';
  contours.push({path,closed,color:/Curvature/.test(id)?'rgba(207,174,153,.32)':id==='esophagus'?'rgba(194,154,147,.18)':'rgba(145,184,177,.28)'});
 }
 entry.commands=commands;entry.contours=contours;
 entry.stats={geometryBuildMs:entry.geometryBuildMs,preparedVertices:entry.geometries.reduce((n,g)=>n+g.points.length,0),preparedTriangles:entry.parts.reduce((n,p)=>n+p.faces.length,0),projectionCount,trianglesDrawn,fillBatches:commands.length,projectAndBatchMs:fallbackNow()-start};
}

function drawContextFallback(ctx,entry){
 ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
 for(const command of entry.commands){ctx.fillStyle=command.color;if(command.path)ctx.fill(command.path);else{
  ctx.beginPath();for(const p of command.triangles){ctx.moveTo(p[0],p[1]);ctx.lineTo(p[2],p[3]);ctx.lineTo(p[4],p[5]);ctx.closePath();}ctx.fill();
 }}
 ctx.lineWidth=1.05;ctx.lineJoin='round';ctx.lineCap='round';
 for(const contour of entry.contours){ctx.strokeStyle=contour.color;ctx.beginPath();let started=false,complete=true;
  for(const p of contour.path){if(!p){started=false;complete=false;continue;}if(started)ctx.lineTo(p.x,p.y);else{ctx.moveTo(p.x,p.y);started=true;}}
  if(contour.closed&&complete)ctx.closePath();ctx.stroke();
 }
 ctx.restore();
}

function makeContextFallbackLayer(ctx,width,height,ratio){
 let canvas;
 try{if(typeof globalThis.OffscreenCanvas==='function')canvas=new globalThis.OffscreenCanvas(Math.ceil(width*ratio),Math.ceil(height*ratio));}catch{}
 if(!canvas){const document=ctx.canvas?.ownerDocument||globalThis.document;if(document?.createElement)canvas=document.createElement('canvas');}
 if(!canvas)return null;
 canvas.width=Math.ceil(width*ratio);canvas.height=Math.ceil(height*ratio);
 const context=canvas.getContext('2d',{alpha:true});return context?{canvas,context,ratio}:null;
}

/** Filled, gently shaded software anatomy from actual model vertices. The
 * parametric display grid retains both GE continuity and the true hiatus.
 * Work is cached by model, camera projection, viewport and raster scale;
 * a steady camera requires eight anchor projections and one drawImage only.
 * Returns inexpensive diagnostics for targeted verification. */
export function paintTeeContextFallback(ctx,project,model,width,height,{occlusion=null}={}){
 if(!model?.meshes?.length||width<2||height<2)return null;
 if(occlusion?.pending)return {pending:true};
 let entry=contextFallbackCache.get(model);if(!entry){entry=prepareContextFallback(model);contextFallbackCache.set(model,entry);}
 if(occlusion?.data){
  const key=contextProjectionKey(project,model,width,height,1)+'|depth:'+occlusion.revision,cacheHit=entry.depthKey===key;
  if(!cacheHit){
   projectContextFallback(entry,project,model,width,height);const raster=depthRaster(occlusion,width,height,{backgroundOnly:true});
   for(const command of entry.commands){const color=depthColor(command.color);for(const triangle of command.depthTriangles)depthTriangle(raster,triangle,color);}
   for(const contour of entry.contours){const color=depthColor(contour.color);for(let i=1;i<contour.path.length;i++)depthLine(raster,contour.path[i-1],contour.path[i],color,1.05);if(contour.closed)depthLine(raster,contour.path.at(-1),contour.path[0],color,1.05);}
   entry.depthLayer=paintDepthRaster(ctx,raster,width,height,entry.depthLayer);entry.depthKey=key;
  }else if(entry.depthLayer){ctx.save();ctx.globalAlpha=1;ctx.imageSmoothingEnabled=false;ctx.drawImage(entry.depthLayer,0,0,entry.depthLayer.width,entry.depthLayer.height,0,0,width,height);ctx.restore();}
  return {...entry.stats,cacheHit,rasterCached:!!entry.depthLayer,depthTested:true};
 }
 const transform=ctx.getTransform?.(),dpr=transform?Math.max(Math.hypot(transform.a,transform.b),Math.hypot(transform.c,transform.d)):globalThis.devicePixelRatio||1;
 const ratio=Math.max(.25,Math.min(2,dpr,Math.sqrt(2_000_000/(width*height)))),key=contextProjectionKey(project,model,width,height,ratio),cacheHit=key===entry.key;
 if(!cacheHit){
  projectContextFallback(entry,project,model,width,height);entry.key=key;
  if(!entry.layer||entry.layer.canvas.width!==Math.ceil(width*ratio)||entry.layer.canvas.height!==Math.ceil(height*ratio))entry.layer=makeContextFallbackLayer(ctx,width,height,ratio);
  if(entry.layer){const start=fallbackNow(),layer=entry.layer.context;layer.setTransform(1,0,0,1,0,0);layer.clearRect(0,0,entry.layer.canvas.width,entry.layer.canvas.height);layer.setTransform(ratio,0,0,ratio,0,0);drawContextFallback(layer,entry);entry.stats.rasterBuildMs=fallbackNow()-start;}
 }
 if(entry.layer){ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.drawImage(entry.layer.canvas,0,0,entry.layer.canvas.width,entry.layer.canvas.height,0,0,width,height);ctx.restore();}
 else drawContextFallback(ctx,entry);
 return {...entry.stats,cacheHit,rasterCached:!!entry.layer};
}

/** Small spatial callouts; the translucent model remains a secondary layer. */
export function paintTeeContextLabels(ctx,project,model,width,height,{fallback=false,occlusion=null}={}){
 if(!model)return;
 if(occlusion?.pending)return;
 ctx.save();
 if(fallback)paintTeeContextFallback(ctx,project,model,width,height,{occlusion});
 const used=[],labels=[],leaders=depthRaster(occlusion,width,height,{backgroundOnly:true}),metrics=contextLabelMetrics(width,height);ctx.font=metrics.font;
 for(const item of [...model.labels].sort((a,b)=>a.priority-b.priority)){
  if(item.priority>metrics.maxPriority)continue;
  const p=project(item.pointMm);if(!p||p.x<12||p.x>width-12||p.y<30||p.y>height-40)continue;
  if(!depthPointVisible(occlusion,p,width,height,{backgroundOnly:true}))continue;
  const size=(ctx.measureText(item.text)?.width||item.text.length*metrics.fontSize*.55)+metrics.paddingX*2;
  const box=placeContextLabel(p,{width:size,height:metrics.height},width,height,used,metrics);if(!box)continue;
  const {x,y,right}=box;
  // Software glyphs are painted by Canvas2D. Reject a label box that would
  // cover accepted tissue, while the leader is masked at every heart pixel.
  if(occlusion?.data){
   let clear=true;const x0=Math.max(0,Math.floor(x/width*occlusion.width)),x1=Math.min(occlusion.width-1,Math.ceil((x+size)/width*occlusion.width));
   const y0=Math.max(0,Math.floor(y/height*occlusion.height)),y1=Math.min(occlusion.height-1,Math.ceil((y+metrics.height)/height*occlusion.height));
   for(let yy=y0;yy<=y1&&clear;yy++)for(let xx=x0;xx<=x1;xx++)if(Number.isFinite(occlusion.data[yy*occlusion.width+xx])){clear=false;break;}
   if(!clear){used.pop();continue;}
  }
  labels.push({item,x,y,size});
  const end={x:right?x:x+size,y:y+metrics.height*.5,depth:p.depth};
  if(leaders)depthLine(leaders,p,end,[177,199,190,.38],.8);
  else{ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(end.x,end.y);ctx.strokeStyle='rgba(177,199,190,.38)';ctx.lineWidth=.8;ctx.stroke();}
 }
 if(leaders)paintDepthRaster(ctx,leaders,width,height);
 for(const {item,x,y,size}of labels){ctx.fillStyle='rgba(8,17,17,.82)';ctx.fillRect(x,y,size,metrics.height);ctx.fillStyle=item.id==='stomach'||item.id==='esophagus'?'#d8bdc2':'#bdd6d2';ctx.fillText(item.text,x+metrics.paddingX,y+metrics.paddingY+metrics.fontSize*.83);}
 ctx.restore();
}

function fallbackHeadFaces(project,pose,scale){
 // A compact solid approximation of the same head: its face remains at the
 // acoustic origin, while the body extends behind it to contain the rear
 // neck. A face-only rectangle leaves a gap in side/oblique software views.
 const {right:r,normal:n,beam:b}=pose.instrument;
 const corners=[0,6].flatMap(z=>[[-3,-7],[3,-7],[3,7],[-3,7]].map(([x,y])=>project(add(pose.originMm,add(add(mul(r,x*scale),mul(n,y*scale)),mul(b,-z*scale))))));
 return [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]].map((indices,i)=>({points:indices.map(j=>corners[j]),color:i===0?[110,124,121,1]:[58,76,77,1]})).filter(face=>face.points.every(Boolean)).sort((a,b)=>b.points.reduce((s,p)=>s+(p.depth||0),0)-a.points.reduce((s,p)=>s+(p.depth||0),0));
}

/** Camera-correct software illustration when the overlay has no WebGL. */
export function paintTeeFallback(ctx,project,pose,scale=1,{occlusion=null}={}){
 if(occlusion?.pending)return;
 if(occlusion?.data){
  const transform=ctx.getTransform?.(),dpr=transform?Math.max(Math.hypot(transform.a,transform.b),Math.hypot(transform.c,transform.d)):globalThis.devicePixelRatio||1;
  const cssWidth=ctx.canvas.width/dpr,cssHeight=ctx.canvas.height/dpr,raster=depthRaster(occlusion,cssWidth,cssHeight),points=pose.shaftPoints.map(project);
  const o=project(pose.originMm),edge=project(add(pose.originMm,mul(pose.instrument.right,3*scale))),width=o&&edge?Math.max(2,Math.min(16,Math.hypot(edge.x-o.x,edge.y-o.y)*1.2)):5;
  for(const [color,thickness]of [[[130,146,142,1],width+1.5],[[38,52,54,1],width],[[82,97,93,1],Math.max(1,width*.25)]])for(let i=1;i<points.length;i++)depthLine(raster,points[i-1],points[i],color,thickness);
  const r=pose.instrument.right;
  for(const {points:corners,color}of fallbackHeadFaces(project,pose,scale)){
   depthTriangle(raster,[corners[0],corners[1],corners[2]],color);depthTriangle(raster,[corners[0],corners[2],corners[3]],color);
   for(let i=0;i<4;i++)depthLine(raster,corners[i],corners[(i+1)%4],[186,198,191,1],1.2);
  }
  depthLine(raster,project(add(pose.originMm,mul(r,-2.4*scale))),project(add(pose.originMm,mul(r,2.4*scale))),[17,30,34,1],Math.max(2,width*.7));
  paintDepthRaster(ctx,raster,cssWidth,cssHeight);return;
 }
 const points=pose.shaftPoints.map(project),draw=(color,width)=>{
  ctx.beginPath();let started=false;for(const p of points){if(!p){started=false;continue;}if(started)ctx.lineTo(p.x,p.y);else{ctx.moveTo(p.x,p.y);started=true;}}
  ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
 };
 const o=project(pose.originMm),edge=project(add(pose.originMm,mul(pose.instrument.right,3*scale)));
 const width=o&&edge?Math.max(2,Math.min(16,Math.hypot(edge.x-o.x,edge.y-o.y)*1.2)):5;
 draw('#82928e',width+1.5);draw('#263436',width);draw('#52615d',Math.max(1,width*.25));
 const r=pose.instrument.right;
 for(const {points:corners,color}of fallbackHeadFaces(project,pose,scale)){
  ctx.beginPath();corners.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
  ctx.fillStyle=`rgb(${color.slice(0,3).join(',')})`;ctx.fill();ctx.strokeStyle='#bac6bf';ctx.lineWidth=1.2;ctx.stroke();
 }
 const a=project(add(pose.originMm,mul(r,-2.4*scale))),z=project(add(pose.originMm,mul(r,2.4*scale)));
 if(a&&z){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(z.x,z.y);ctx.strokeStyle='#111e22';ctx.lineWidth=Math.max(2,width*.7);ctx.stroke();}
}
