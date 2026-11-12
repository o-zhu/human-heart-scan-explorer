/** Small presentation records only. Never retain a second mesh or source array. */
import {sameDepthBasis} from './render-depth.js';

const identities=new WeakMap();let nextIdentity=1;
const identity=value=>{
 if(!value||typeof value!=='object')return value??null;
 if(!identities.has(value))identities.set(value,nextIdentity++);
 return identities.get(value);
};
const copyBasis=b=>Object.freeze(Object.fromEntries(['eye','forward','right','up'].map(key=>[key,Object.freeze([...b[key]])])));
const physicalSizes=meta=>meta?.dimensions?.map((n,i)=>(n-1)*(Array.isArray(meta.spacingUm)?meta.spacingUm[i]:meta.spacingUm)/1000)||[];

export function measurementSourceKey(renderer){
 const m=renderer.meta;
 return String(renderer.measurementSourceKey||m?.donorId||m?.specimen||m?.datasetId||m?.sourceUrl||'physical:'+physicalSizes(m).map(n=>Number(n.toFixed(7))).join(','));
}

export function measurementStateKey(renderer){
 return JSON.stringify([
  renderer.settings,renderer.extent,renderer.dimensions,measurementSourceKey(renderer),
  ...[renderer.meta,renderer.data,renderer.texture,renderer.cap,renderer.cleanup,renderer.lumenCleanup,
   renderer.reviewedMaskAtlas,renderer.coronaryField,renderer.fineSurface,
   renderer.localSurfaceRefinement?.current,renderer.nativeMainDetail?.state?.current].map(identity),
  renderer.fineSurface?.enabled,renderer.localSurfaceRefinement?.enabled,renderer.nativeMainDetail?.visible,
 ]);
}

/** CPU workers capture this at submission; WebGL captures synchronously at presentation. */
export function createMeasurementFrame(renderer,{basis,width,height,aspect,kind,sceneWidth=width,sceneHeight=height,composite=false,frameRevision=renderer.viewRevision||0,depthTexture=null,surface=null}={}){
 const rect=renderer.canvas.getBoundingClientRect();
 return {
  frameRevision,sourceKey:measurementSourceKey(renderer),stateKey:measurementStateKey(renderer),
  basis:copyBasis(basis),aspect,width,height,sceneWidth,sceneHeight,composite,kind,
  cssWidth:rect.width,cssHeight:rect.height,extent:Object.freeze([...renderer.extent]),
  meta:renderer.meta,mode:renderer.settings.mode,showPlanes:renderer.settings.showPlanes,
  depthTexture,surface,
 };
}

/** Run after a completed presentation and before advancing an automatic camera. */
export function presentMeasurementFrame(renderer,frame){
 const snapshot=frame?Object.freeze({...frame,frameSerial:renderer.measurementFrameSerial=(renderer.measurementFrameSerial||0)+1}):null;
 renderer.presentedMeasurementFrame=snapshot;
 // An optional overlay must never take away a successfully presented heart.
 try{renderer.onMeasurementFrame?.(snapshot);}catch{}
 for(const notify of renderer.measurementFrameWaiters||[])notify(snapshot);
 return snapshot;
}

export function measurementFrameCurrent(renderer,frame){
 if(!frame||renderer.presentedMeasurementFrame!==frame||!renderer.loaded||frame.mode!==0||frame.showPlanes||renderer.gl?.isContextLost?.())return false;
 if(frame.sourceKey!==measurementSourceKey(renderer)||frame.stateKey!==measurementStateKey(renderer))return false;
 const rect=renderer.canvas.getBoundingClientRect();
 if(rect.width<2||rect.height<2||Math.abs(rect.width-frame.cssWidth)>.01||Math.abs(rect.height-frame.cssHeight)>.01||renderer.canvas.width!==frame.width||renderer.canvas.height!==frame.height)return false;
 // Auto-rotation advances the next camera after presentation. Its displayed
 // depth still belongs to this stored basis, never to that future camera.
 if(!renderer.autoRotate&&!sameDepthBasis(frame.basis,renderer.basis()))return false;
 if(frame.kind==='fine'&&(!frame.depthTexture||!frame.surface?.target||renderer.fineSurface!==frame.surface||!frame.surface?.activeFor(renderer)||frame.surface.target.depthTexture!==frame.depthTexture||frame.surface.target.width!==frame.width||frame.surface.target.height!==frame.height))return false;
 return true;
}
