import { NativeEdgeLoader } from './native-edge-loader.js';
import { cycleAmount, deformPoint, fieldGLSL } from './motion-field-v24.js';

const $ = id => document.getElementById(id);
const count = n => new Intl.NumberFormat('en').format(n);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const WORLD_MM = 168.30815;

export const vertexPrefix = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform vec3 uMin,uMax,uCenter,uRight,uUp,uView;
uniform vec2 uPan;
uniform float uSpan,uAspect,uAmount,uTwist;
uniform int uMode;
uniform bool uFloatPosition;
out vec3 vPosition,vNormal;
`;
export const vertexSuffix = `
void main(){
 vec3 source=uFloatPosition?aPosition:mix(uMin,uMax,aPosition);
 vec3 world,n;motion(source,aNormal,world,n);
 vec3 p=world-uCenter;vPosition=world;vNormal=n;
 gl_Position=vec4(2.0*(dot(p,uRight)+uPan.x)/(uSpan*uAspect),2.0*(dot(p,uUp)+uPan.y)/uSpan,-dot(p,uView)/3.0,1.0);
}`;
export const fragment = `#version 300 es
precision highp float;
in vec3 vPosition,vNormal;
uniform vec3 uView,uRight,uUp,uCutAxis,uTint;
uniform float uCutValue;
uniform bool uCutEnabled;
out vec4 outColor;
void main(){
 if(uCutEnabled&&dot(vPosition,uCutAxis)>uCutValue)discard;
 vec3 n=normalize(vNormal);if(dot(n,uView)<0.0)n=-n;
 vec3 l=normalize(uView*.70+uRight*.40+uUp*.65);
 vec3 l2=normalize(uView*.45-uRight*.8+uUp*.15);
 float diffuse=max(dot(n,l),0.0),fill=max(dot(n,l2),0.0);
 float spec=pow(max(dot(n,normalize(l+uView)),0.0),30.0);
 vec3 color=uTint*(.25+.64*diffuse+.17*fill)+vec3(.065)*spec;
 outColor=vec4(pow(color,vec3(1.0/2.2)),1.0);
}`;

export class MotionPane {
  constructor(id, invalidate) {
    this.id = id; this.canvas = $(`${id}Canvas`); this.message = $(`${id}Message`);
    this.meshes = []; this.bytes = 0; this.lost = false; this.invalidate = invalidate;
    this.camera = { yaw: .48, pitch: .20, span: 1.1, center: [0,0,0], pan: [0,0], flip: true };
    this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'high-performance' });
    if (!this.gl) throw new Error('WebGL 2 is required for this interactive experiment. The method and source records remain available below.');
    this.initialize(); this.bind();
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; this.meshes = []; this.bytes = 0; this.setMessage('Graphics memory was released. Reload the page to restore the experiment.'); });
  }
  initialize() {
    const gl = this.gl;
    const compile = (kind, text) => { const shader = gl.createShader(kind); gl.shaderSource(shader, text); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`Surface shader did not compile: ${log}`); } return shader; };
    const vs = compile(gl.VERTEX_SHADER, vertexPrefix + fieldGLSL + vertexSuffix), fs = compile(gl.FRAGMENT_SHADER, fragment);
    const p = gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,fs); gl.linkProgram(p); gl.deleteShader(vs);gl.deleteShader(fs);
    if (!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error('The surface program did not initialize.');
    this.program = p;this.u = {};
    for (const n of ['Min','Max','Center','Right','Up','View','Pan','Span','Aspect','FloatPosition','Mode','Amount','Twist','CutAxis','CutValue','CutEnabled','Tint']) this.u[n] = gl.getUniformLocation(p,`u${n}`);
  }
  setMessage(text) { this.message.textContent = text; this.message.hidden = !text; this.message.classList.toggle('retained', this.meshes.length > 0); }
  upload(decoded, record, stagedBytes = 0) {
    if (this.lost) throw new Error('Graphics context is unavailable.');
    if (!decoded.indexCount) return null;
    const bytes = decoded.vertexCount * (decoded.positionBytes + 6) + decoded.indexCount * 4;
    if (this.bytes + stagedBytes + bytes > 150*1024*1024) throw new Error('This comparison exceeds the graphics memory budget. Select the compact model.');
    const gl = this.gl, float = decoded.positionFormat === 'float32';
    const mesh = { vao:gl.createVertexArray(),buffers:[],count:decoded.indexCount,bytes,float,bounds:record.bounds };
    try {
      gl.bindVertexArray(mesh.vao);
      for (const [slot,offset,length,type,normal] of [[0,decoded.positionOffset,decoded.vertexCount*decoded.positionBytes,float?gl.FLOAT:gl.UNSIGNED_SHORT,!float],[1,decoded.normalOffset,decoded.vertexCount*6,gl.SHORT,true]]) {
        const b = gl.createBuffer();mesh.buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(decoded.buffer,offset,length),gl.STATIC_DRAW);gl.enableVertexAttribArray(slot);gl.vertexAttribPointer(slot,3,type,normal,0,0);
      }
      const b=gl.createBuffer();mesh.buffers.push(b);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array(decoded.buffer,decoded.indexOffset,decoded.indexCount),gl.STATIC_DRAW);
      if (gl.getError()!==gl.NO_ERROR) throw new Error('Surface graphics allocation failed.');
    } catch (e) {this.release(mesh);throw e;} finally {gl.bindVertexArray(null);}
    return mesh;
  }
  release(mesh) {if(!mesh||this.lost)return;for(const b of mesh.buffers)this.gl.deleteBuffer(b);this.gl.deleteVertexArray(mesh.vao);}
  commit(meshes) {for(const mesh of this.meshes)this.release(mesh);this.meshes=meshes.filter(Boolean);this.bytes=this.meshes.reduce((s,m)=>s+m.bytes,0);this.setMessage('');}
  basis() {
    const {yaw,pitch,flip}=this.camera, f=flip?-1:1;
    return {right:[f*Math.cos(yaw),0,-f*Math.sin(yaw)],up:[-f*Math.sin(pitch)*Math.sin(yaw),f*Math.cos(pitch),-f*Math.sin(pitch)*Math.cos(yaw)],view:[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)]};
  }
  draw({amount=0,mode=0,twist=true,cut=null,worldMm=WORLD_MM,follow=false,tint=[.47,.35,.27]}={}) {
    if(this.lost)return;
    const gl=this.gl,rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const dpr=Math.min(window.devicePixelRatio||1,1.5),width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    gl.viewport(0,0,width,height);gl.clearColor(.031,.083,.105,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);
    gl.useProgram(this.program);const u=this.u,b=this.basis(),cam=this.camera;
    gl.uniform3fv(u.Center,follow?deformPoint(cam.center,amount,mode,twist):cam.center);gl.uniform3fv(u.Right,b.right);gl.uniform3fv(u.Up,b.up);gl.uniform3fv(u.View,b.view);gl.uniform2fv(u.Pan,cam.pan);gl.uniform1f(u.Span,cam.span);gl.uniform1f(u.Aspect,width/height);gl.uniform1i(u.Mode,mode);gl.uniform1f(u.Amount,amount);gl.uniform1f(u.Twist,twist?1:0);gl.uniform3fv(u.Tint,tint);
    gl.uniform1i(u.CutEnabled,cut?.axis&&cut.axis!=='none'?1:0);gl.uniform3fv(u.CutAxis,({x:[1,0,0],y:[0,1,0],z:[0,0,1]})[cut?.axis]||[0,0,0]);gl.uniform1f(u.CutValue,cut?.value||0);
    for(const mesh of this.meshes){gl.uniform1i(u.FloatPosition,mesh.float?1:0);gl.uniform3fv(u.Min,mesh.bounds?.min||[0,0,0]);gl.uniform3fv(u.Max,mesh.bounds?.max||[1,1,1]);gl.bindVertexArray(mesh.vao);gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_INT,0);}gl.bindVertexArray(null);
    const target=cam.span*worldMm*60/rect.height,power=10**Math.floor(Math.log10(target)),distance=([1,2,5,10].find(n=>n*power>=target)||10)*power;
    $(`${this.id}Scale`).textContent=distance<1?`${Number((distance*1000).toPrecision(3))} µm`:`${Number(distance.toPrecision(3))} mm`;$(`${this.id}ScaleBar`).style.width=`${distance/(cam.span*worldMm)*rect.height}px`;
  }
  bind() {
    let drag=null;
    this.canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,shift:e.shiftKey};this.canvas.setPointerCapture(e.pointerId);});
    this.canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;if(drag.shift){const s=this.camera.span/this.canvas.clientHeight;this.camera.pan[0]+=dx*s;this.camera.pan[1]-=dy*s;}else{this.camera.yaw-=dx*.008;this.camera.pitch=clamp(this.camera.pitch+dy*.008,-1.45,1.45);}this.invalidate(this.id);});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])this.canvas.addEventListener(name,()=>{drag=null;});
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.camera.span=clamp(this.camera.span*Math.exp(e.deltaY*.001),.003,4);this.invalidate(this.id);},{passive:false});
    this.canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')this.camera.yaw-=.12;if(e.key==='ArrowRight')this.camera.yaw+=.12;if(e.key==='ArrowUp')this.camera.pitch=clamp(this.camera.pitch+.12,-1.45,1.45);if(e.key==='ArrowDown')this.camera.pitch=clamp(this.camera.pitch-.12,-1.45,1.45);if(e.key==='+'||e.key==='=')this.camera.span*=.85;if(e.key==='-')this.camera.span*=1.15;this.invalidate(this.id);}});
  }
}

class Lab {
  constructor() {
    this.mode='donor';this.phase=0;this.playing=false;this.last=0;this.revision=0;this.loadRevision=0;this.frameRevision=0;this.busy=false;this.ready=false;
    this.loader=new NativeEdgeLoader();this.ctLoaders=[new NativeEdgeLoader(),new NativeEdgeLoader()];
    this.left=new MotionPane('left',id=>this.changedCamera(id));this.right=new MotionPane('right',id=>this.changedCamera(id));
    this.bind();this.frame=this.frame.bind(this);requestAnimationFrame(this.frame);new ResizeObserver(()=>this.draw()).observe($('panes'));
  }
  async init() {
    const response=await fetch('/assets/motion-lab-v24/donor.json');if(!response.ok)throw new Error('The specimen record could not load.');this.donor=await response.json();
    await this.loadDonor();
    fetch('/assets/motion-lab-v24/deformation-audit.json').then(r=>r.ok?r.json():null).then(a=>{if(a?.summary)$('auditSummary').textContent=a.summary;}).catch(()=>{});
  }
  changedCamera(id) {if(this.mode==='ct'){const source=id==='left'?this.left:this.right,target=id==='left'?this.right:this.left;target.camera={...source.camera,center:source.camera.center.slice(),pan:source.camera.pan.slice()};}this.draw();}
  setPlaying(value) {this.playing=value;$('play').textContent=value?'Pause':'Play cycle';}
  setStatus(text) {$('status').textContent=text;}
  async stage(loader,pane,record,kind,revision,isCurrent) {
    const stage={meshes:[],bytes:0,triangles:0};
    const callbacks={onPiece:(decoded,index,total)=>{if(!isCurrent(revision))throw new DOMException('Selection changed.','AbortError');if(index!==stage.meshes.length)throw new Error('Surface pieces arrived out of order.');const part=record.parts?.[index]||record;const mesh=pane.upload(decoded,part,stage.bytes);stage.meshes.push(mesh);stage.bytes+=mesh?.bytes||0;stage.triangles+=decoded.indexCount/3;}};
    try {const result=await(kind==='tile'?loader.loadTile({...record,cleanupView:'cleaned'},callbacks):loader.loadOverview(record,callbacks));if(!isCurrent(revision))throw new DOMException('Selection changed.','AbortError');if(stage.meshes.length!==result.pieces)throw new Error('The surface is incomplete.');return stage;}catch(e){for(const m of stage.meshes)pane.release(m);throw e;}
  }
  async loadDonor() {
    const revision=++this.loadRevision,modeRevision=this.revision;this.busy=true;this.ready=false;$('play').disabled=true;
    const quality=$('quality').value,record=this.donor.overviewLods.find(r=>r.id===quality),region=this.donor.regions[Number($('region').value)];
    this.left.setMessage('Opening the detailed display mesh…');this.right.setMessage('Opening native geometry…');
    const valid=r=>r===this.loadRevision&&this.mode==='donor'&&modeRevision===this.revision;
    let leftStage=null,rightStage=null;
    try {
      // The shared worker admits one active decode. The small native region comes first.
      rightStage=await this.stage(this.loader,this.right,region,'tile',revision,valid);
      leftStage=await this.stage(this.loader,this.left,record,'overview',revision,valid);
      if(!valid(revision))throw new DOMException('Selection changed.','AbortError');
      this.left.commit(leftStage.meshes);this.right.commit(rightStage.meshes);leftStage=null;rightStage=null;
      this.donorRegion=region;this.currentQuality=quality;this.currentRegion=Number($('region').value);this.resetCamera();
      $('leftMeta').textContent=`${count(record.triangles)} triangles · 79.4 µm display sampling + existing simplification`;
      $('rightMeta').textContent=`19.85 µm samples · block ${region.xyz.join(' / ')} · ${count(this.right.meshes.reduce((s,m)=>s+m.count/3,0))} triangles`;
      this.ready=true;this.setStatus('Measured geometry is ready. Play applies illustrative motion; Rest geometry restores the fixed specimen exactly.');
    } catch(e) {if(e.name!=='AbortError'){this.left.setMessage(e.message);this.right.setMessage('Previous complete geometry is retained where available.');this.setStatus(e.message);}}
    finally{if(leftStage)for(const m of leftStage.meshes)this.left.release(m);if(rightStage)for(const m of rightStage.meshes)this.right.release(m);if(valid(revision)){this.busy=false;$('play').disabled=!this.ready;this.draw();}}
  }
  async switchMode(mode) {
    if(mode==='ct'){this.setPlaying(false);this.setStatus('The SlicerHeart CT comparison is not included in the public distribution. See docs/open-source/assets.md.');return;}
    if(mode===this.mode)return;this.setPlaying(false);this.revision++;this.frameRevision++;this.loadRevision++;this.loader.cancel('detail');this.loader.cancel('overview');for(const l of this.ctLoaders)l.cancel('overview');this.mode=mode;this.phase=0;this.ready=false;this.busy=false;
    // Clear both panes so an old source never acquires the new source's labels.
    this.left.commit([]);this.right.commit([]);$('donorTab').setAttribute('aria-selected',String(mode==='donor'));$('ctTab').setAttribute('aria-selected',String(mode==='ct'));$('donorControls').hidden=mode!=='donor';$('ctControls').hidden=mode!=='ct';$('panes').classList.toggle('ct',mode==='ct');$('modeBadge').classList.toggle('measured',mode==='ct');
    $('modeBadge').textContent=mode==='ct'?'ACQUIRED CT PHASES':'ILLUSTRATIVE MOTION';$('modeDescription').textContent=mode==='ct'?'Same acquisition · matched threshold and camera · no synthetic intermediate phases':'Measured specimen geometry · synthetic motion · no CT motion registration';
    $('leftTitle').textContent=mode==='ct'?'Current overview sampling':'Detailed whole heart';$('rightTitle').textContent=mode==='ct'?'Native CT sampling':'Native detail, same motion field';$('leftTag').textContent=mode==='ct'?'1.199 × 1.199 × 1.400 mm':'LADAF-2021-17';$('rightTag').textContent=mode==='ct'?'0.600 × 0.600 × 0.700 mm':'NATIVE REGION';$('rightHint').textContent=mode==='ct'?'Cameras are linked for comparison':'Same vertices throughout the cycle';$('rest').textContent=mode==='ct'?'First phase':'Rest geometry';$('phaseLabel').textContent=mode==='ct'?'Acquired phase':'Modeled cycle';
    $('leftMeta').textContent='Loading this experiment…';$('rightMeta').textContent='Loading this experiment…';$('play').disabled=true;
    if(mode==='donor')await this.loadDonor();else{
      const revision=this.revision;
      try{if(!this.ct){const r=await fetch('/assets/motion-lab-v24/native-ct/manifest.json');if(!r.ok)throw new Error('The native CT experiment is not available.');this.ct=await r.json();if(!this.ct.complete)throw new Error('The native CT comparison is still being prepared.');}if(revision!==this.revision)return;this.ctIndex=-1;this.resetCamera();await this.loadCT(0);}catch(e){if(revision===this.revision){this.setStatus(e.message);this.left.setMessage(e.message);this.right.setMessage(e.message);}}
    }
    this.draw();
  }
  async loadCT(index) {
    if(!this.ct||this.mode!=='ct')return;
    const frame=this.ct.frames[index],revision=++this.frameRevision,modeRevision=this.revision;this.busy=true;
    const valid=r=>r===this.frameRevision&&modeRevision===this.revision&&this.mode==='ct';
    this.left.setMessage(`Loading source phase ${frame.phase}…`);this.right.setMessage(`Loading source phase ${frame.phase}…`);
    const records=[frame.overview,frame.native],panes=[this.left,this.right];
    const results=await Promise.allSettled(records.map((r,i)=>this.stage(this.ctLoaders[i],panes[i],{...r,parts:[r]},'overview',revision,valid)));
    if(!valid(revision)){for(let i=0;i<results.length;i++)if(results[i].status==='fulfilled')for(const m of results[i].value.meshes)panes[i].release(m);return;}
    if(results.some(r=>r.status==='rejected')){for(let i=0;i<results.length;i++)if(results[i].status==='fulfilled')for(const m of results[i].value.meshes)panes[i].release(m);const error=results.find(r=>r.status==='rejected').reason;if(error.name!=='AbortError'){this.setPlaying(false);this.setStatus(`Could not load this phase. ${error.message}`);for(const p of panes)p.setMessage('The last complete matched pair remains visible.');}this.busy=false;return;}
    for(let i=0;i<results.length;i++)panes[i].commit(results[i].value.meshes);
    this.ctIndex=index;this.ready=true;this.busy=false;$('play').disabled=false;
    $('leftMeta').textContent=`Source phase ${frame.phase} · ${count(frame.overview.triangles)} triangles`;$('rightMeta').textContent=`Source phase ${frame.phase} · ${count(frame.native.triangles)} triangles`;
    this.setStatus(`${this.ct.frames.length} acquired phases in this pilot. Original spatial samples, fixed intensity threshold; surfaces may include noncardiac structures and imaging artifacts. No clinical chamber segmentation.`);this.draw();
  }
  resetCamera() {
    if(this.mode==='donor'){Object.assign(this.left.camera,{yaw:.48,pitch:.20,span:1.12,center:[0,0,0],pan:[0,0],flip:true});Object.assign(this.right.camera,{yaw:.48,pitch:.20,span:128/8479*1.8,center:this.donorRegion?.center?.slice()||[0,0,0],pan:[0,0],flip:true});}
    else{for(const p of [this.left,this.right])Object.assign(p.camera,{yaw:.38,pitch:.16,span:1.15,center:[0,0,0],pan:[0,0],flip:false});}
    this.draw();
  }
  draw() {
    if(this.mode==='donor'){
      const amount=cycleAmount(this.phase)*Number($('amplitude').value)/100,mode=Number($('model').value),twist=$('twist').checked;
      this.left.draw({amount,mode,twist,cut:{axis:$('cut').value,value:Number($('cutPosition').value)/1000}});this.right.draw({amount,mode,twist,follow:true,tint:[.48,.365,.29]});
      $('phase').value=String(Math.round(this.phase*1000));$('phaseValue').textContent=`${Math.round(this.phase*100)}%`;
    }else{const options={worldMm:this.ct?.worldMm||173.3,tint:[.38,.49,.46]};this.left.draw(options);this.right.draw(options);if(this.ctIndex>=0){$('phase').value=String(Math.round(this.ctIndex/Math.max(1,this.ct.frames.length-1)*1000));$('phaseValue').textContent=String(this.ct.frames[this.ctIndex].phase);}}
  }
  frame(time) {
    const dt=this.last?Math.min(.08,(time-this.last)/1000):0;this.last=time;
    if(this.playing&&this.ready&&!document.hidden){if(this.mode==='donor'){this.phase=(this.phase+dt*Number($('speed').value))%1;this.draw();}else if(!this.busy){this.ctElapsed=(this.ctElapsed||0)+dt;const interval=1/(Number($('speed').value)*Math.max(1,this.ct.frames.length));if(this.ctElapsed>=interval){this.ctElapsed=0;void this.loadCT((this.ctIndex+1)%this.ct.frames.length);}}}
    requestAnimationFrame(this.frame);
  }
  bind() {
    $('donorTab').addEventListener('click',()=>void this.switchMode('donor'));$('ctTab').addEventListener('click',()=>void this.switchMode('ct'));$('play').addEventListener('click',()=>this.setPlaying(!this.playing));$('resetCamera').addEventListener('click',()=>this.resetCamera());
    $('rest').addEventListener('click',()=>{this.setPlaying(false);if(this.mode==='ct')void this.loadCT(0);else{this.phase=0;this.draw();}});
    $('phase').addEventListener('input',()=>{this.setPlaying(false);if(this.mode==='donor'){this.phase=Number($('phase').value)/1000;this.draw();}else if(this.ct){const i=Math.round(Number($('phase').value)/1000*(this.ct.frames.length-1));if(i!==this.ctIndex)void this.loadCT(i);}});
    for(const name of ['model','amplitude','twist','cut','cutPosition'])$(name).addEventListener('input',()=>{$('amplitudeValue').textContent=`${$('amplitude').value}%`;this.draw();});
    for(const name of ['quality','region'])$(name).addEventListener('change',()=>{this.setPlaying(false);void this.loadDonor();});
    document.addEventListener('visibilitychange',()=>{this.last=0;});
  }
}

if(typeof document!=='undefined'&&$('leftCanvas')){
  try{const lab=new Lab();window.heartMotionLab=lab;lab.init().catch(e=>{lab.setStatus(e.message);lab.left.setMessage(e.message);lab.right.setMessage(e.message);});}
  catch(e){$('status').textContent=e.message;$('leftMessage').textContent=e.message;$('rightMessage').textContent=e.message;}
}
