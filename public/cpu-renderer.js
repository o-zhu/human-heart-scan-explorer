import {VolumeRenderer} from './renderer.js';
import {buildAnatomyPalette,DEFAULT_WINDOW_SETTINGS} from './render-styles.js';
import {sameDepthBasis} from './render-depth.js';
export class CPUVolumeRenderer {
 constructor(canvas,onChange=()=>{}){
  this.canvas=canvas;this.onChange=onChange;this.backend='software';this.ctx=canvas.getContext('2d',{alpha:false});
  if(!this.ctx)throw new Error('A graphics canvas is unavailable in this browser. Open the original atlas.');
  this.settings={mode:0,palette:4,threshold:.3,opacity:.8,clipAxis:-1,clipPosition:.5,clipFlip:0,showPlanes:0,slices:[.5,.5,.5],quality:'auto',capContrast:1.8,...DEFAULT_WINDOW_SETTINGS,cleanupEnabled:true,anatomyOpacity:.65,anatomySelected:0,surfaceSmoothing:1};
  this.camera={yaw:.32,pitch:.12,roll:Math.PI,distance:1.65,pan:[0,0,0]};this.extent=[.9,1,.9];this.dimensions=[1,1,1];this.autoRotate=false;
  this.worker=new Worker(new URL('./cpu-worker.js',import.meta.url),{type:'module'});this.busy=false;this.frameId=0;this.interactionPixels=18000;
  this.worker.onmessage=e=>{
   const f=e.data;if(f.type==='error'){this.busy=false;this.onChange({error:'Software rendering could not finish: '+f.message});return;}
   if(f.type!=='frame'||f.id!==this.frameId&&!(f.fast&&this.latestFast&&f.id>(this.displayedId||0)))return;
   this.canvas.width=f.w;this.canvas.height=f.h;this.ctx.putImageData(new ImageData(new Uint8ClampedArray(f.pixels),f.w,f.h),0,0);this.canvas.dataset.rendered='true';this.canvas.dataset.backend='software';this.displayedId=f.id;this.busy=f.id!==this.frameId;
   this.contextFrameRevision=(this.contextFrameRevision||0)+1;
   this.contextDepth=f.depth?{width:f.w,height:f.h,data:new Float32Array(f.depth),basis:f.basis,revision:this.contextFrameRevision}:null;
   if(f.elapsed>0){this.interactionPixels=Math.max(6500,Math.min(28000,f.w*f.h*70/f.elapsed));this.performanceStats={backend:'software',frameMs:f.elapsed,pixels:f.w*f.h,interactionPixels:Math.round(this.interactionPixels),accelerated:Boolean(this.acceleration)};}
   if(this.autoRotate&&!this.busy){this.camera.yaw+=.035;this.requestRender();}
  };
  this.worker.onerror=e=>{this.busy=false;this.onChange({error:'Software rendering could not finish: '+e.message});};
  this.bindControls();this.observer=new ResizeObserver(()=>this.requestRender());this.observer.observe(canvas);
 }
 load(data,meta,acceleration=null){
  this.dimensions=meta.dimensions;this.data=data;this.meta=meta;
  const size=this.dimensions.map((d,i)=>(d-1)*(Array.isArray(meta.spacingUm)?meta.spacingUm[i]:meta.spacingUm)),longest=Math.max(...size);this.extent=[size[0]/longest,size[2]/longest,size[1]/longest];
  this.acceleration=acceleration;this.worker.postMessage({type:'load',data:data.buffer,dimensions:this.dimensions,acceleration});this.loaded=true;this.requestRender();
 }
 requestRender(){if(!this.pending)this.pending=requestAnimationFrame(()=>{this.pending=0;this.render();});clearTimeout(this.refineTimer);this.refineTimer=setTimeout(()=>{this.lastInteraction=0;this.render();},250);}
 render(forceHigh=false){
  if(!this.loaded)return;
  const rect=this.canvas.getBoundingClientRect();if(rect.width<2||rect.height<2)return;
  const fast=!forceHigh&&(this.interacting||this.autoRotate||this.settings.quality==='low'||performance.now()-(this.lastInteraction||0)<170);
  const budget=fast?this.interactionPixels:(this.settings.quality==='high'?420000:230000),ratio=Math.min(1,Math.sqrt(budget/(rect.width*rect.height))),w=Math.max(2,Math.round(rect.width*ratio)),h=Math.max(2,Math.round(rect.height*ratio));
  this.busy=true;this.latestFast=fast;this.worker.postMessage({type:'render',id:++this.frameId,w,h,extent:this.extent,basis:this.basis(),settings:this.settings,fast});
 }
 snapshot(){return this.canvas.toDataURL('image/png');}
 getContextOcclusion(){
  const depth=this.contextDepth;
  if(!depth||this.displayedId!==this.frameId||!sameDepthBasis(depth.basis,this.basis()))return {pending:true,revision:this.contextFrameRevision||0};
  return depth;
 }
 setCapData(cap){this.cap=cap;this.worker.postMessage({type:'cap',cap:{data:cap.data,width:cap.width,height:cap.height,plane:cap.plane,key:cap.key,cleaned:cap.cleaned===true}});this.requestRender();}
 clearCapData(){this.cap=null;this.worker.postMessage({type:'cap',cap:null});this.requestRender();}
 setCleanupData(map){this.cleanup=map;this.worker.postMessage({type:'cleanup',map:map?{data:map.data,dimensions:map.dimensions}:null});this.requestRender();}
 setAnatomyData(map){this.anatomy=map;this.anatomyColors=buildAnatomyPalette(map?.palette||map?.labels);this.worker.postMessage({type:'anatomy',map:map?{data:map.data,dimensions:map.dimensions}:null,colors:this.anatomyColors});this.requestRender();}
}
for(const method of ['basis','minimumCameraDistance','bindControls','set','reset','view','alignPlane','orbit','inspectAt'])CPUVolumeRenderer.prototype[method]=VolumeRenderer.prototype[method];
