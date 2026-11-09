import {projectProbePoint} from './probe-geometry.js';
import {sceneWindowDepth} from './render-depth.js';
import {withHeartPriority,contextLabelMetrics,placeContextLabel} from './echo-context-presentation.js';

const vertex=`#version 300 es
layout(location=0) in vec3 screenPosition;
layout(location=1) in vec2 texcoord;
out vec2 uv;
void main(){gl_Position=vec4(screenPosition,1.);uv=texcoord;}`;
const fragment=`#version 300 es
precision highp float;uniform sampler2D labels;in vec2 uv;out vec4 fragColor;
void main(){fragColor=texture(labels,uv);if(fragColor.a<.005)discard;}`;

/** Screen-readable callouts rendered into the same depth buffer as their
 * anatomical anchors. Even the thin leaders are hidden behind heart tissue. */
export class TeeDepthLabels{
 constructor(renderer){
  this.gl=renderer.gl;this.program=renderer.createProgram(vertex,fragment);
  const gl=this.gl;this.vao=gl.createVertexArray();this.buffer=gl.createBuffer();this.texture=gl.createTexture();
  if(!this.vao||!this.buffer||!this.texture)throw new Error('Spatial label storage is unavailable.');
  this.sampler=gl.getUniformLocation(this.program,'labels');
  gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
  for(const [at,size,offset]of [[0,3,0],[1,2,12]]){gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,gl.FLOAT,false,20,offset);}
  gl.bindVertexArray(null);
  gl.activeTexture(gl.TEXTURE0+15);gl.bindTexture(gl.TEXTURE_2D,this.texture);
  for(const [k,v]of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);
 }
 atlas(items,metrics){
  const key=[metrics.fontSize,...items.map(x=>`${x.id}:${x.text}`)].join('|');if(this.key===key)return true;
  const row=metrics.height*2+8;
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(512,Math.max(64,items.length*row+8)):globalThis.document?.createElement('canvas');
  if(!canvas)return false;
  canvas.width=512;canvas.height=Math.max(64,items.length*row+8);const ctx=canvas.getContext('2d');if(!ctx)return false;
  ctx.font=`${metrics.fontSize*2}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;ctx.textBaseline='alphabetic';this.entries=new Map();
  items.forEach((item,i)=>{
   const width=Math.min(502,Math.ceil(ctx.measureText(item.text).width)+metrics.paddingX*4),top=i*row,height=metrics.height*2;
   ctx.fillStyle='rgba(8,17,17,.82)';ctx.fillRect(2,top+2,width,height);
   ctx.fillStyle=item.id==='stomach'||item.id==='esophagus'?'#d8bdc2':item.id==='probe'?'#edc1a3':'#bdd6d2';ctx.fillText(item.text,2+metrics.paddingX*2,top+2+(metrics.paddingY+metrics.fontSize*.83)*2);
   this.entries.set(item.id,{width:width/2,height:metrics.height,u0:2/canvas.width,u1:(2+width)/canvas.width,v0:(top+2)/canvas.height,v1:(top+2+height)/canvas.height});
  });
  // An isolated solid texel supplies the antialiased leader's material.
  ctx.fillStyle='rgba(177,199,190,.38)';ctx.fillRect(0,canvas.height-4,4,4);this.lineUv=[1.5/canvas.width,(canvas.height-2)/canvas.height];
  const gl=this.gl;gl.activeTexture(gl.TEXTURE0+15);gl.bindTexture(gl.TEXTURE_2D,this.texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);this.key=key;return true;
 }
 draw({basis,width,height,referenceMm,model,pose,showContext,showProbe,probeLabel}){
  const items=[...(showContext&&model?model.labels:[])];
  if(showProbe&&pose)items.push({id:'probe',text:probeLabel||'Estimated TEE probe',pointMm:pose.originMm,priority:0});
  const metrics=contextLabelMetrics(width,height);
  if(!items.length||!this.atlas(items,metrics))return;
  const positions=[],used=[];
  const vertexAt=(x,y,depth,u,v)=>positions.push(x/width*2-1,1-y/height*2,sceneWindowDepth(depth)*2-1,u,v);
  const quad=(corners,depth,uv)=>{for(const i of [0,1,2,0,2,3])vertexAt(...corners[i],depth,...uv[i]);};
  for(const item of items.sort((a,b)=>a.priority-b.priority)){
   if(item.priority>metrics.maxPriority)continue;
   const p=projectProbePoint(item.pointMm.map(v=>v/referenceMm),basis,width,height);
   if(!p||p.depth<=.01||p.depth>=10||p.x<12||p.x>width-12||p.y<30||p.y>height-40)continue;
   const entry=this.entries.get(item.id),box=placeContextLabel(p,entry,width,height,used,metrics);if(!box)continue;
   const {x,y,right}=box;
   const end=[right?x:x+entry.width,y+entry.height*.5],dx=end[0]-p.x,dy=end[1]-p.y,length=Math.max(.001,Math.hypot(dx,dy)),ox=-dy/length*.45,oy=dx/length*.45;
   quad([[p.x+ox,p.y+oy],[end[0]+ox,end[1]+oy],[end[0]-ox,end[1]-oy],[p.x-ox,p.y-oy]],p.depth,Array(4).fill(this.lineUv));
   quad([[x,y],[x+entry.width,y],[x+entry.width,y+entry.height],[x,y+entry.height]],p.depth,[[entry.u0,entry.v0],[entry.u1,entry.v0],[entry.u1,entry.v1],[entry.u0,entry.v1]]);
  }
  if(!positions.length)return;
  const gl=this.gl;gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(positions),gl.DYNAMIC_DRAW);
  gl.activeTexture(gl.TEXTURE0+15);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(this.sampler,15);
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(false);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  withHeartPriority(gl,()=>gl.drawArrays(gl.TRIANGLES,0,positions.length/5));gl.depthMask(true);gl.bindVertexArray(null);
 }
 dispose(){const gl=this.gl;gl.deleteBuffer(this.buffer);gl.deleteVertexArray(this.vao);gl.deleteTexture(this.texture);gl.deleteProgram(this.program);}
}
