/** Small shaded geometry views for probe teaching.
 * The cardiac/TEE instruments are original illustrative meshes. BodyParts3D
 * is a separate licensed reference torso, never registered to a HiP-CT donor.
 * No external rendering library, remote tracking, or full-body scan is loaded.
 */
import {add,mul,dot,cross,norm} from './planes.js';
import {contactFrame,probePhysicalScale,projectProbePoint} from './probe-geometry.js';
import {VolumeRenderer} from './renderer.js';
import {loadEchoAnatomyContext} from './echo-anatomy-context-v2.js';
import {createDonorOverview,loadWholeHeartOverview,donorOverviewPose,donorOverviewSector,donorOverviewCamera} from './probe-overview.js';
import {createSkinContactSurface,raycastSkin} from './probe-skin-contact.js';
import {withHeartPriority} from './echo-context-presentation.js';
import {getDeviceResourcePolicy} from './device-resources.js';
// Only the instrument illustration shrinks. The acoustic origin and all
// physical sampling/contact coordinates remain in the donor's millimetres.
export const PROBE_VISUAL_SCALE=.4;
// The reference body uses millimetres: a roughly 107 mm authored cardiac
// handle reads as an adult instrument here. This is independent of the compact
// middle-column illustration, whose geometry and scale remain unchanged.
export const REFERENCE_PROBE_VISUAL_SCALE=1.2;
export const probeDisplayScale=referenceMm=>probePhysicalScale(referenceMm)*PROBE_VISUAL_SCALE;
// The Labs now show the same life-sized instrument in both linked scenes.
// Echo atlas clearance conventions retain their historical compact scale.
export const labProbeDisplayScale=referenceMm=>probePhysicalScale(referenceMm);
const IDENTITY=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const VERTEX=`attribute vec3 position;attribute vec3 normal;uniform mat4 model;uniform vec3 eye,forward,cameraRight,cameraUp;uniform float referenceMm,aspect;varying vec3 vNormal,vWorld;void main(){vec3 p=(model*vec4(position,1.)).xyz/referenceMm;vec3 q=p-eye;float d=dot(q,forward);gl_Position=vec4(dot(q,cameraRight)/(.32*aspect),dot(q,cameraUp)/.32,1.001*d-.030015,d);vNormal=normalize(mat3(model)*normal);vWorld=p;}`;
const FRAGMENT=`precision highp float;uniform vec4 color;uniform vec3 eye;uniform float gloss;varying vec3 vNormal,vWorld;void main(){vec3 n=normalize(vNormal);if(!gl_FrontFacing)n=-n;vec3 v=normalize(eye-vWorld),l=normalize(vec3(-.35,.65,.85)),fill=normalize(vec3(.7,.2,-.5));float diffuse=max(dot(n,l),0.),soft=max(dot(n,fill),0.);float spec=pow(max(dot(n,normalize(l+v)),0.),32.)*gloss;vec3 rgb=pow(color.rgb,vec3(2.2))*(.42+.47*diffuse+.14*soft)+vec3(spec);gl_FragColor=vec4(pow(clamp(rgb,0.,1.),vec3(1./2.2)),color.a);}`;
// Shared-context geometry uses the heart's exact .01–10 perspective mapping.
// Its VAO and program are independent; it never clears or resizes that canvas.
const SHARED_VERTEX='#version 300 es\n'+VERTEX.replaceAll('attribute ','in ').replaceAll('varying ','out ').replace('1.001*d-.030015','(10.01/9.99)*d-.2/9.99');
const SHARED_FRAGMENT='#version 300 es\n'+FRAGMENT.replace('precision highp float;','precision highp float;out vec4 fragColor;').replaceAll('varying ','in ').replaceAll('gl_FragColor','fragColor');
export const sharedGeometryShaderSources={vertex:SHARED_VERTEX,fragment:SHARED_FRAGMENT};

function compile(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'Geometry shader could not compile');return s;}
export class GeometryCanvas{
 constructor(canvas,{gl:sharedGl=null}={}){
  this.canvas=canvas;this.shared=Boolean(sharedGl);const gl=this.gl=sharedGl||canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:false});if(!gl)throw new Error('Shaded geometry requires WebGL.');
  const p=this.program=gl.createProgram(),vs=compile(gl,gl.VERTEX_SHADER,this.shared?SHARED_VERTEX:VERTEX),fs=compile(gl,gl.FRAGMENT_SHADER,this.shared?SHARED_FRAGMENT:FRAGMENT);
  gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error('Geometry program could not link.');
  this.uniforms={};for(const k of ['model','eye','forward','cameraRight','cameraUp','referenceMm','aspect','color','gloss'])this.uniforms[k]=gl.getUniformLocation(p,k);this.position=gl.getAttribLocation(p,'position');this.normal=gl.getAttribLocation(p,'normal');this.buffers=new Set();
  if(this.shared){this.vao=gl.createVertexArray();if(!this.vao)throw new Error('Spatial context storage is unavailable.');}
 }
 upload(vertices,color,alpha=1,gloss=.12){const gl=this.gl,buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);const mesh={buffer,count:vertices.length/6,color,alpha,gloss};this.buffers.add(mesh);return mesh;}
 uploadIndexed(vertices,indices,color,alpha=1,gloss=.12){
  const gl=this.gl;if(!this.shared&&!gl.getExtension('OES_element_index_uint'))throw new Error('Indexed whole-heart rendering is unavailable.');
  const mesh=this.upload(vertices,color,alpha,gloss);try{mesh.index=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh.index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);mesh.indexCount=indices.length;if(gl.getError()!==gl.NO_ERROR)throw new Error('Whole-heart storage is unavailable.');return mesh;}catch(error){this.remove(mesh);throw error;}
 }
 remove(mesh){if(mesh){this.gl.deleteBuffer(mesh.buffer);if(mesh.index)this.gl.deleteBuffer(mesh.index);this.buffers.delete(mesh);}}
 begin(basis,width,height,referenceMm,dpr=1){
  const gl=this.gl,w=this.shared?this.canvas.width:Math.max(1,Math.round(width*dpr)),h=this.shared?this.canvas.height:Math.max(1,Math.round(height*dpr));
  if(this.shared)gl.bindVertexArray(this.vao);
  else {if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);}
  gl.viewport(0,0,w,h);gl.useProgram(this.program);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);gl.uniform3fv(this.uniforms.eye,basis.eye);gl.uniform3fv(this.uniforms.forward,basis.forward);gl.uniform3fv(this.uniforms.cameraRight,basis.right);gl.uniform3fv(this.uniforms.cameraUp,basis.up);gl.uniform1f(this.uniforms.referenceMm,referenceMm);gl.uniform1f(this.uniforms.aspect,width/height);
 }
 draw(mesh,model=IDENTITY){const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);gl.enableVertexAttribArray(this.position);gl.enableVertexAttribArray(this.normal);gl.vertexAttribPointer(this.position,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(this.normal,3,gl.FLOAT,false,24,12);gl.uniformMatrix4fv(this.uniforms.model,false,model);gl.uniform4f(this.uniforms.color,...mesh.color,mesh.alpha);gl.uniform1f(this.uniforms.gloss,mesh.gloss);gl.depthMask(mesh.alpha>.7);if(mesh.index){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh.index);for(let offset=0;offset<mesh.indexCount;offset+=3000000)gl.drawElements(gl.TRIANGLES,Math.min(3000000,mesh.indexCount-offset),gl.UNSIGNED_INT,offset*4);}else gl.drawArrays(gl.TRIANGLES,0,mesh.count);gl.depthMask(true);}
 dispose(){for(const mesh of this.buffers)this.remove(mesh);if(this.vao)this.gl.deleteVertexArray(this.vao);this.gl.deleteProgram(this.program);}
}

/** Build shared-vertex normals before expanding triangles for the tiny renderer. */
export function triangleMesh(vertices,faces){
 const normals=vertices.map(()=>[0,0,0]);for(const [a,b,c] of faces){const x=vertices[b].map((v,i)=>v-vertices[a][i]),y=vertices[c].map((v,i)=>v-vertices[a][i]),n=cross(x,y);for(const k of [a,b,c])for(let i=0;i<3;i++)normals[k][i]+=n[i];}
 const ns=normals.map(n=>Math.hypot(...n)>1e-10?norm(n):[0,0,1]),result=new Float32Array(faces.length*18);let at=0;for(const f of faces)for(const k of f){result.set(vertices[k],at);result.set(ns[k],at+3);at+=6;}return result;
}
const power=(x,p)=>Math.sign(x)*Math.abs(x)**p;
function loft(rings,segments=40,exponent=3.6){
 const v=[],f=[];for(const [z,rx,ry,cx=0,cy=0] of rings)for(let i=0;i<segments;i++){const a=i*2*Math.PI/segments;v.push([cx+rx*power(Math.cos(a),2/exponent),cy+ry*power(Math.sin(a),2/exponent),z]);}
 for(let j=0;j<rings.length-1;j++)for(let i=0;i<segments;i++){const a=j*segments+i,b=j*segments+(i+1)%segments,c=b+segments,d=a+segments;f.push([a,b,c],[a,c,d]);}
 for(const [row,reverse] of [[0,true],[rings.length-1,false]]){const [z,,,cx=0,cy=0]=rings[row],middle=v.push([cx,cy,z])-1;for(let i=0;i<segments;i++){const a=row*segments+i,b=row*segments+(i+1)%segments;f.push(reverse?[middle,b,a]:[middle,a,b]);}}
 return triangleMesh(v,f);
}
function ellipsoid(center,radii,rings=12,segments=24){const v=[],f=[];for(let j=0;j<=rings;j++){const t=j*Math.PI/rings;for(let i=0;i<segments;i++){const a=i*2*Math.PI/segments;v.push([center[0]+radii[0]*Math.sin(t)*Math.cos(a),center[1]+radii[1]*Math.sin(t)*Math.sin(a),center[2]+radii[2]*Math.cos(t)]);}}for(let j=0;j<rings;j++)for(let i=0;i<segments;i++){const a=j*segments+i,b=j*segments+(i+1)%segments;f.push([a,b,b+segments],[a,b+segments,a+segments]);}return triangleMesh(v,f);}
function tube(points,radius=2.6,segments=12){const v=[],f=[];for(let k=0;k<points.length;k++){const tangent=norm((points[Math.min(k+1,points.length-1)]).map((a,i)=>a-points[Math.max(0,k-1)][i]));let side=cross(tangent,[0,1,0]);if(Math.hypot(...side)<1e-3)side=cross(tangent,[1,0,0]);side=norm(side);const n=norm(cross(tangent,side)),r=typeof radius==='function'?radius(k):radius;for(let i=0;i<segments;i++){const a=i*2*Math.PI/segments;v.push(add(points[k],add(mul(side,Math.cos(a)*r),mul(n,Math.sin(a)*r))));}}for(let j=0;j<points.length-1;j++)for(let i=0;i<segments;i++){const a=j*segments+i,b=j*segments+(i+1)%segments;f.push([a,b,b+segments],[a,b+segments,a+segments]);}return triangleMesh(v,f);}

/** Original illustrative phased-array and TEE meshes, explicitly not vendor CAD. */
export function createProbeMeshes(kind='phased'){
 const dark=[.12,.16,.18],shell=[.75,.79,.78],accent=[.88,.47,.30];
 if(kind==='tee')return [
  {vertices:loft([[.5,4.5,12],[2,5.1,13],[5,5.4,13.5],[8,4.6,12],[10,3.4,10]],40,3.4),color:dark,gloss:.18},
  {vertices:loft([[.05,3.8,8.7],[.7,4.3,9.2]],36,3.5),color:[.34,.39,.41],gloss:.3},
  {vertices:tube(Array.from({length:35},(_,i)=>{const t=i/34;return [3*t*t,11+72*t,6+14*t*t];}),i=>i<10?3.5+Math.sin(i*Math.PI)*.3:3.6,16),color:dark,gloss:.1},
  {vertices:ellipsoid([-4.9,-6,5],[.6,1.6,1.2],8,16),color:accent,gloss:.2}
 ];
 const grip=[[0,9,5.3],[1,9.6,5.8],[3,10.5,6.3],[7,11.8,7.6],[12,13,8.7],[20,14.7,10.2],[30,15.4,11],[42,14.6,10.8],[55,12.6,9.8],[68,10.2,8],[78,8,6.8],[85,6.3,5.5],[89,5.3,4.8]];
 return [
  {vertices:loft(grip,48,3.4),color:shell,gloss:.20},
  {vertices:loft([[-.4,8.9,5.2],[.2,9.3,5.6],[1.4,9.5,5.7]],48,3.8),color:[.16,.21,.24],gloss:.28},
  {vertices:loft([[9.3,12.4,8.1],[10.2,12.6,8.25]],48,3.4),color:[.29,.37,.39],gloss:.1},
  {vertices:ellipsoid([0,-10.3,43],[6.4,1.25,18],14,28),color:[.48,.58,.60],gloss:.08},
  {vertices:ellipsoid([0,10.3,43],[6.4,1.25,18],14,28),color:[.48,.58,.60],gloss:.08},
  {vertices:ellipsoid([-12.8,0,12.2],[1.3,2.7,2.3],10,20),color:accent,gloss:.16},
  {vertices:loft(Array.from({length:27},(_,i)=>{const z=88+i*.85,r=4.9-i*.057+(i%3===1?.6:0);return[z,r,r*.94];}),24,2.2),color:dark,gloss:.08},
  {vertices:tube(Array.from({length:30},(_,i)=>{const t=i/29;return[35*t*t,7*t*t,110+57*t-12*t*t];}),2.7,14),color:[.24,.30,.31],gloss:.16}
 ];
}

/** A single, raised indicator on the image-left flank of the reference probe.
 * Keep the shared/middle instrument byte-for-byte unchanged. The dark bezel,
 * amber insert and pale centre are one directional mark, not opposite marks.
 */
export function createReferenceProbeMeshes(kind='phased'){
 const meshes=createProbeMeshes(kind),tee=kind==='tee',index=tee?3:5;
 const center=tee?[-5.8,-6,5]:[-14,0,14],radii=tee?[.8,2.8,2.4]:[1.3,4.4,5.8];
 meshes.splice(index,1,
  {vertices:ellipsoid(center,radii,10,24),color:[.10,.16,.18],gloss:.12,role:'indicator'},
  {vertices:ellipsoid(add(center,[-.55,0,0]),radii.map((v,i)=>v*(i===0?.85:.73)),10,24),color:[1,.65,.24],gloss:.2,role:'indicator'},
  {vertices:ellipsoid(add(center,[-1,0,0]),tee?[.26,.8,.7]:[.35,1.3,2.1],8,16),color:[1,.94,.76],gloss:.12,role:'indicator'}
 );
 return meshes;
}

/** Local -X is -pose.right: the same side as the image's orientation dot. */
export function probeIndicatorPosition(pose,kind='phased',scale=1,reference=false){
 const p=reference?(kind==='tee'?[-6.9,-6,5]:[-15.3,0,14]):(kind==='tee'?[-4.9,-6,5]:[-12.8,0,12.2]);
 return add(pose.originMm,add(add(mul(pose.right,p[0]*scale),mul(pose.normal,p[1]*scale)),mul(pose.beam,-p[2]*scale)));
}

export function probeModelMatrix(pose,scale=1){const r=mul(pose.right,scale),n=mul(pose.normal,scale),out=mul(pose.beam,-scale),p=pose.originMm;return new Float32Array([...r,0,...n,0,...out,0,...p,1]);}
export function createContactMesh(surface){
 const v=[],f=[],radial=12,around=64;
 if(surface.kind==='skin'){
  v.push(contactFrame(surface,0,0).pointMm);for(let j=1;j<=radial;j++)for(let i=0;i<around;i++){const a=i*2*Math.PI/around;v.push(contactFrame(surface,surface.limitU*j/radial*Math.cos(a),surface.limitV*j/radial*Math.sin(a)).pointMm);}
  for(let i=0;i<around;i++)f.push([0,1+i,1+(i+1)%around]);for(let j=0;j<radial-1;j++)for(let i=0;i<around;i++){const a=1+j*around+i,b=1+j*around+(i+1)%around;f.push([a,b,b+around],[a,b+around,a+around]);}
 }else{const nx=24,ny=20;for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++)v.push(contactFrame(surface,-surface.limitU+2*surface.limitU*i/nx,-surface.limitV+2*surface.limitV*j/ny).pointMm);for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i,b=a+1;f.push([a,b,b+nx+1],[a,b+nx+1,a+nx+1]);}}
 return triangleMesh(v,f);
}

export class ProbeSceneOverlay{
 constructor(canvas,{renderer=null}={}){
  this.renderer=renderer;this.active=true;this.sharedDepth=Boolean(renderer?.gl&&renderer.setContextLayer);
  this.view=new GeometryCanvas(this.sharedDepth?renderer.canvas:canvas,this.sharedDepth?{gl:renderer.gl}:{});this.meshes={};for(const [kind,key]of[['phased','skin'],['tee','esophageal']])this.meshes[key]=createProbeMeshes(kind).map(m=>this.view.upload(m.vertices,m.color,1,m.gloss));
  if(this.sharedDepth)this.layer={draw:frame=>this.drawGeometry({...this.params,...frame,dpr:1}),onError:()=>{this.failed=true;this.setActive(false);}};
 }
 setActive(active){this.active=!!active&&!this.failed;if(!this.sharedDepth)return;if(this.active&&this.params)this.renderer.setContextLayer(this.layer);else if(this.renderer.contextLayer===this.layer)this.renderer.setContextLayer(null);}
 render(params){
  if(this.failed)return;
  if(!this.sharedDepth)return this.drawGeometry(params);
  const key=JSON.stringify([params.pose,params.showSurface,params.showProbe,params.referenceMm]),changed=key!==this.parameterKey||this.params?.contextModel!==params.contextModel;
  this.params=params;this.parameterKey=key;this.setActive(this.active);if(changed&&this.active)this.renderer.requestRender();
 }
 drawGeometry({basis,width,height,dpr,pose,state,surface,referenceMm,contextModel=null,showSurface=true,showProbe=true}){
  this.view.begin(basis,width,height,referenceMm,dpr);
  if(showSurface&&surface?.kind==='body-skin'&&contextModel&&this.sharedDepth){
   if(this.contextModel!==contextModel){for(const mesh of this.contextMeshes||[])this.view.remove(mesh);this.contextModel=contextModel;this.contextMeshes=contextModel.meshes.map(mesh=>this.view.upload(mesh.vertices,mesh.color,mesh.id==='bodyparts3d-skin'?.055:mesh.alpha,mesh.gloss));}
   withHeartPriority(this.view.gl,()=>{for(const mesh of this.contextMeshes)this.view.draw(mesh);});
  }else if(surface&&surface.kind!=='body-skin'&&showSurface){const key=JSON.stringify(surface);if(key!==this.surfaceKey){this.view.remove(this.surfaceMesh);this.surfaceMesh=this.view.upload(createContactMesh(surface),surface.kind==='skin'?[.63,.40,.28]:[.53,.30,.38],.22,.07);this.surfaceKey=key;}this.view.draw(this.surfaceMesh);}
  if(showProbe){const model=probeModelMatrix(pose,labProbeDisplayScale(referenceMm));for(const mesh of this.meshes[surface?.kind==='esophageal'?'esophageal':'skin'])this.view.draw(mesh,model);}
 }
}

function cameraBasis(eye,target,referenceMm){const forward=norm(target.map((v,i)=>v-eye[i])),right=norm(cross(forward,[0,1,0])),up=norm(cross(right,forward));return{eye:mul(eye,1/referenceMm),forward,right,up};}
/** Fit the rib cage in the independent reference pane at every aspect ratio.
 * Skin beyond the shoulders can continue offscreen as a contextual backdrop.
 * This camera never changes the measured heart camera or probe pose.
 */
export function referenceTorsoCamera(mode,aspect,bounds){
 const low=bounds?.min||[-146,-213,-116],high=bounds?.max||[145,151,100],target=low.map((x,i)=>(x+high[i])/2);
 const away=norm(mode==='front'?[0,.025,1]:[.5,.11,.866]),forward=mul(away,-1),right=norm(cross(forward,[0,1,0])),up=norm(cross(right,forward));
 const ratio=Math.max(.1,Number(aspect)||1);let distance=500;
 for(let mask=0;mask<8;mask++){
  const q=low.map((x,i)=>((mask>>i)&1?high[i]:x)-target[i]),z=dot(q,forward);
  distance=Math.max(distance,Math.abs(dot(q,right))*1.08/(.32*ratio)-z,Math.abs(dot(q,up))*1.08/.32-z);
 }
 return cameraBasis(add(target,mul(away,distance)),target,400);
}
function referenceBounds(meshes,buffer){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const m of meshes){if(m.name==='skin')continue;const a=new Float32Array(buffer,m.offset,m.count*6);for(let j=0;j<a.length;j+=6)for(let i=0;i<3;i++){min[i]=Math.min(min[i],a[j+i]);max[i]=Math.max(max[i],a[j+i]);}}
 return{min,max};
}
function interpolateHeight(grid,x,y){const u=Math.max(0,Math.min(grid.width-1.001,(x-grid.xRange[0])/(grid.xRange[1]-grid.xRange[0])*(grid.width-1))),v=Math.max(0,Math.min(grid.height-1.001,(y-grid.yRange[0])/(grid.yRange[1]-grid.yRange[0])*(grid.height-1))),i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j,q=[grid.values[j*grid.width+i],grid.values[j*grid.width+i+1],grid.values[(j+1)*grid.width+i],grid.values[(j+1)*grid.width+i+1]];if(q.some(x=>!Number.isFinite(x)))return null;return q[0]*(1-a)*(1-b)+q[1]*a*(1-b)+q[2]*(1-a)*b+q[3]*a*b;}
export function referenceTorsoPose(state,manifest,surface,sourcePose){
 // Retained export for older review tools. The active overview now shares the
 // donor world: its pose is no longer re-aimed at a separate reference heart.
 return donorOverviewPose(sourcePose);
}

export class ReferenceTorsoView{
 constructor(canvas,{onStatus=()=>{},onIndicator=()=>{},onCameraChange=()=>{},onContact=()=>{}}={}){
  this.canvas=canvas;this.onStatus=onStatus;this.onIndicator=onIndicator;this.onCameraChange=onCameraChange;this.onContact=onContact;this.view=new GeometryCanvas(canvas);this.cameraMode='oblique';this.camera={yaw:0,pitch:0,roll:0,distance:2,pan:[0,0,0]};this.revision=0;this.active=true;this.probe={};
  for(const k of ['phased','tee'])this.probe[k]=createReferenceProbeMeshes(k).map(m=>this.view.upload(m.vertices,m.color,1,m.gloss));
  this.pointerIds=new Set();
  canvas.addEventListener('pointerdown',event=>{
   if(!this.active){event.stopImmediatePropagation();return;}this.pointerIds.add(event.pointerId);canvas.focus?.({preventScroll:true});
   if(this.placementMode&&event.button===0){
    event.preventDefault();event.stopImmediatePropagation();
    if(this.pointerIds.size>1){this.placingId=null;this.placementCancelled=true;}
    else if(!this.placementCancelled){this.placingId=event.pointerId;this.placementStart=[event.clientX,event.clientY];this.placementMoved=false;}
    canvas.setPointerCapture?.(event.pointerId);
   }
  });
  canvas.addEventListener('pointermove',event=>{
   if(!this.placementMode)return;event.stopImmediatePropagation();
   if(this.placingId===event.pointerId&&!this.placementCancelled&&Math.hypot(event.clientX-this.placementStart[0],event.clientY-this.placementStart[1])>4){event.preventDefault();this.placementMoved=true;this.pickContact(event.clientX,event.clientY);}
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{
   if(!this.placementMode)return;event.stopImmediatePropagation();
   if(name==='pointerup'&&this.placingId===event.pointerId&&!this.placementCancelled&&!this.placementMoved)this.pickContact(event.clientX,event.clientY);
   this.pointerIds.delete(event.pointerId);if(this.placingId===event.pointerId)this.placingId=null;if(!this.pointerIds.size)this.placementCancelled=false;
   try{canvas.releasePointerCapture?.(event.pointerId);}catch{}
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>this.pointerIds.delete(event.pointerId));
  // Reuse the main view's established single-/two-contact gestures and capture
  // cancellation, but keep this camera independent from the scan/probe state.
  this.onChange=()=>{this.cameraMode='manual';this.onCameraChange(null);};
  canvas.addEventListener('keydown',event=>{if(/^(Arrow(Left|Right|Up|Down)|\+|=|-)$/.test(event.key))this.onChange();});
  this.bindControls();
 }
 basis(){return VolumeRenderer.prototype.basis.call(this);}
 orbit(dx,dy){return VolumeRenderer.prototype.orbit.call(this,dx,dy);}
 minimumCameraDistance(){return Math.max(.045,Math.min(.2,this.camera.distance));}
 bindControls(){return VolumeRenderer.prototype.bindControls.call(this);}
 setPlacementMode(enabled){this.placementMode=!!enabled;this.placingId=null;this.placementCancelled=false;this.canvas.style.cursor=this.placementMode?'crosshair':'';}
 pickContact(clientX,clientY){
  if(!this.model||!this.cameraReady)return null;
  const rect=this.canvas.getBoundingClientRect(),x=2*(clientX-rect.left)/rect.width-1,y=1-2*(clientY-rect.top)/rect.height,b=this.basis(),direction=norm(add(b.forward,add(mul(b.right,x*.32*rect.width/rect.height),mul(b.up,y*.32)))),hit=raycastSkin(createSkinContactSurface(this.model),mul(b.eye,this.normalizationMm),direction);
  if(hit)this.onContact(hit);return hit;
 }
 reset(){this.setView('oblique');}
 setActive(active){
  this.active=!!active;
  if(!active){
   for(const pointerId of [...this.pointerIds]){
    const event=new Event('pointercancel');Object.defineProperty(event,'pointerId',{value:pointerId});this.canvas.dispatchEvent(event);
    try{this.canvas.releasePointerCapture?.(pointerId);}catch{}
   }
   cancelAnimationFrame(this.raf);this.raf=0;
   if(this.loadingSource){this.sourceAbort?.abort();this.sourceData=null;}
  }else{if(this.sourceFailed){this.sourceData=null;this.sourceFailed=false;}this.requestRender();}
 }
 invalidateSource(){this.sourceAbort?.abort();this.sourceData=null;this.sourceMeta=null;this.sourceThreshold=null;}
 requestRender(){
  this.revision++;if(!this.active||this.raf||!this.lastFrame)return;
  this.raf=requestAnimationFrame(()=>{this.raf=0;if(this.active&&this.lastFrame)this.render(this.lastFrame);});
 }
 async load({data,meta,frames,donorId,threshold=.28}={}){return this.setSource({data,meta,frames,donorId,threshold});}
 async setSource({data,meta,frames,donorId,threshold=.28}={}){
  if(!this.active){this.invalidateSource();return this;}
  if(!data||!meta)return this;
  if(data===this.sourceData&&meta===this.sourceMeta&&threshold===this.sourceThreshold)return this;
  this.sourceData=data;this.sourceMeta=meta;this.sourceThreshold=threshold;
  this.sourceAbort?.abort();const controller=this.sourceAbort=new AbortController(),sequence=this.sourceSequence=(this.sourceSequence||0)+1;
  this.loadingSource=true;this.sourceFailed=false;
  this.onStatus(this.model?'Loading whole heart…':'Loading linked chest…');
  try{
   const referenceMm=Math.max(...meta.dimensions.map((n,i)=>(n-1)*(Array.isArray(meta.spacingUm)?meta.spacingUm[i]:meta.spacingUm)/1000));
   let overview;
   try{overview=await loadWholeHeartOverview(donorId,referenceMm,{signal:controller.signal});}catch(error){if(controller.signal.aborted)throw error;overview=await createDonorOverview(data,meta,{threshold,maxGrid:getDeviceResourcePolicy().constrained?32:40,signal:controller.signal});overview.fallbackReason=error.message;}
   const model=this.model&&this.model.referenceMm===overview.referenceMm&&this.model.frame.donorId===donorId?this.model:await loadEchoAnatomyContext({frames,donorId,referenceMm:overview.referenceMm,signal:controller.signal});
   if(controller.signal.aborted||sequence!==this.sourceSequence)return this;
   const staged=[];let heart;
   try{
    // The generic BodyParts3D heart is deliberately absent from this model.
    if(model!==this.model)for(const mesh of model.meshes){const alpha=mesh.id==='bodyparts3d-skin'?.035:mesh.id==='bodyparts3d-bones'?.3:mesh.id==='bodyparts3d-spine'?.22:mesh.alpha;staged.push({...this.view.upload(mesh.vertices,mesh.color,alpha,mesh.gloss),id:mesh.id});}
    if(overview.indices){
     try{heart=this.view.uploadIndexed(overview.vertices,overview.indices,[.77,.78,.64],1,.08);}
     catch(error){overview=await createDonorOverview(data,meta,{threshold,maxGrid:getDeviceResourcePolicy().constrained?32:40,signal:controller.signal});overview.fallbackReason=error.message;}
    }
    if(!heart)heart=this.view.upload(overview.vertices,[.77,.78,.64],1,.08);
    if(controller.signal.aborted||sequence!==this.sourceSequence){for(const mesh of staged)this.view.remove(mesh);this.view.remove(heart);return this;}
   }catch(error){for(const mesh of staged)this.view.remove(mesh);this.view.remove(heart);throw error;}
   const previous=this.heartMesh;this.heartMesh=heart;this.view.remove(previous);this.heartBounds=overview.bounds;
   if(model!==this.model){for(const mesh of this.meshes||[])this.view.remove(mesh);this.meshes=staged;this.model=model;}
   this.overview={...overview,vertices:undefined,indices:undefined};this.onStatus(overview.fallbackReason?'Preview outline · whole-heart surface unavailable':'');
   if(!this.cameraReady)this.setView('oblique');else if(this.cameraMode!=='manual')this.setView(this.cameraMode);
   this.requestRender();return this;
  }catch(error){
   if(controller.signal.aborted||sequence!==this.sourceSequence)return this;
   this.sourceFailed=true;this.onStatus('Linked chest unavailable. Main scan remains usable.');throw error;
  }finally{if(sequence===this.sourceSequence)this.loadingSource=false;}
 }
 setView(name){
  this.cameraMode=name==='front'?'front':'oblique';if(!this.model)return;
  const basis=donorOverviewCamera(this.model,(this.canvas.clientWidth||320)/(this.canvas.clientHeight||500),this.cameraMode,this.heartBounds);
  this.normalizationMm=basis.referenceMm;this.camera.pan=[...basis.target];this.camera.distance=basis.distance;
  // alignPlane already computes yaw/pitch/roll from the exact anatomical basis.
  const notify=this.onChange;this.onChange=()=>{};VolumeRenderer.prototype.alignPlane.call(this,mul(basis.forward,-1),basis.up,basis.target);this.onChange=notify;
  this.cameraReady=true;this.lastAspect=(this.canvas.clientWidth||320)/(this.canvas.clientHeight||500);this.onCameraChange(this.cameraMode);this.requestRender();
 }
 render(frame){
  this.lastFrame=frame;if(!this.model||!this.cameraReady)return;
  const {pose:sourcePose,state}=frame,w=this.canvas.clientWidth||320,h=this.canvas.clientHeight||500,aspect=w/h;
  if(this.cameraMode!=='manual'&&Math.abs(aspect-this.lastAspect)>1e-3)this.setView(this.cameraMode);
  const basis=this.basis(),pose=donorOverviewPose(sourcePose),referenceMm=this.normalizationMm,physicalReference=this.model.referenceMm;
  this.view.begin(basis,w,h,referenceMm,Math.min(globalThis.devicePixelRatio||1,1.5));
  if(this.heartMesh)this.view.draw(this.heartMesh);
  // Same heart-priority rule as Echo Windows: context can occupy only clear
  // donor pixels, even when a rib lies physically in front of the heart.
  const gl=this.view.gl;gl.depthRange(1,1);try{for(const mesh of this.meshes||[])this.view.draw(mesh);}finally{gl.depthRange(0,1);}
  if(pose){
   const key=JSON.stringify([pose.originMm,pose.right,pose.beam,state.depthMm,state.angleDeg]);
   if(key!==this.sectorKey){
    const points=donorOverviewSector(pose,state),faces=Array.from({length:points.length-2},(_,i)=>[0,i+1,i+2]);
    this.view.remove(this.sectorMesh);this.view.remove(this.sectorEdge);
    this.sectorMesh=this.view.upload(triangleMesh(points,faces),[.44,.8,.69],.09,0);
    this.sectorEdge=this.view.upload(tube([...points,points[0]],physicalReference*.0013,6),[.53,.85,.75],.9,.02);this.sectorKey=key;
   }
   this.view.draw(this.sectorMesh);this.view.draw(this.sectorEdge);
   const scale=labProbeDisplayScale(physicalReference),model=probeModelMatrix(pose,scale);for(const mesh of this.probe[state.preset==='atrial'?'tee':'phased'])this.view.draw(mesh,model);
   const point=probeIndicatorPosition(pose,state.preset==='atrial'?'tee':'phased',scale,true),projected=projectProbePoint(mul(point,1/referenceMm),basis,w,h);
   this.onIndicator(projected?{...projected,width:w,height:h,farSide:dot(mul(pose.right,-1),basis.eye.map((v,i)=>v*referenceMm-point[i]))<0}:null);
  }else this.onIndicator(null);
 }
}

const fallbackMeshes=new Map();
/** Preserve a visible instrument in the application's software-renderer path. */
export function paintProbeFallback(ctx,project,pose,kind='phased',scale=1){
 if(!fallbackMeshes.has(kind))fallbackMeshes.set(kind,createProbeMeshes(kind));const faces=[],light=norm([-.35,.65,.85]);
 const world=p=>add(pose.originMm,add(add(mul(pose.right,p[0]*scale),mul(pose.normal,p[1]*scale)),mul(pose.beam,-p[2]*scale)));
 for(const mesh of fallbackMeshes.get(kind)){const a=mesh.vertices;for(let i=0;i<a.length;i+=18){const points=[0,6,12].map(k=>project(world(a.subarray(i+k,i+k+3))));if(points.some(x=>!x))continue;const ln=[a[i+3]+a[i+9]+a[i+15],a[i+4]+a[i+10]+a[i+16],a[i+5]+a[i+11]+a[i+17]],n=norm(add(add(mul(pose.right,ln[0]),mul(pose.normal,ln[1])),mul(pose.beam,-ln[2]))),shade=.50+.45*Math.abs(dot(n,light));faces.push({points,depth:points.reduce((s,p)=>s+p.depth,0)/3,color:mesh.color.map(v=>Math.round(Math.min(1,v*Math.pow(shade,1/2.2))*255))});}}
 faces.sort((a,b)=>b.depth-a.depth);for(const f of faces){ctx.beginPath();ctx.moveTo(f.points[0].x,f.points[0].y);ctx.lineTo(f.points[1].x,f.points[1].y);ctx.lineTo(f.points[2].x,f.points[2].y);ctx.closePath();ctx.fillStyle=`rgb(${f.color.join(',')})`;ctx.fill();}
}
