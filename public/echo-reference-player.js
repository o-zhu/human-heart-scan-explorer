/** Selection-scoped source players. A frame load is not evidence that YouTube is ready. */
import {multiplaneIndicatorMarkup,multiplanePoint,multiplaneRange} from './multiplane-indicator.js';
let youtubeAPI;
let nextPlayerId=0;

// Only these source-reviewed, named acquisitions are default replacements for
// their remote examples. A broad short-axis sweep is not a midpapillary view,
// and a normal PLAX loop is not an increased-depth or valve-zoom acquisition.
const localReferenceIds=Object.freeze({
 'tte:plax':'tte-plax','tte:psax_papillary':'tte-psax_papillary',
 'tte:a4c':'tte-a4c','tte:a2c':'tte-a2c','tte:a3c':'tte-a3c','tte:subcostal':'tte-subcostal',
 'tee:me4c':'tee-me4c','tee:melax':'tee-melax','tee:me2c':'tee-me2c','tee:bicaval':'tee-bicaval',
});

/** Select an already hosted, licensed example without relaxing acquisition
 * correspondence or changing a user's explicit selection. Media bytes and
 * attribution remain in the existing, hash-checked media catalog. */
export function localEchoReference(clips,{mode,preset}){
 const id=localReferenceIds[`${mode}:${preset}`];
 return id&&clips.find(clip=>clip.id===id&&clip.mode===mode&&clip.preset===preset&&
  !clip.external&&(!clip.kind||clip.kind==='video')&&clip.mimeType==='video/mp4'&&
  /^\.\/assets\/echo-media-v[67]\/(tte|tee)-[a-z0-9_]+\.mp4$/.test(clip.url||'')&&
  ['CC BY-SA 3.0','CC BY 4.0'].includes(clip.license)&&
  clip.correspondence?.sourceLabelVerified===true&&clip.correspondence.kind==='named-view'&&
  Number.isSafeInteger(clip.bytes)&&clip.bytes>0&&clip.bytes<=4*1024*1024&&/^[a-f0-9]{64}$/.test(clip.sha256||''))||null;
}

export function preferredEchoReference(clips,view){
 return localEchoReference(clips,view)||clips.find(clip=>clip.mode===view.mode&&clip.preset===view.preset)||null;
}

/** Warm only the origins needed by an actually selected YouTube reference.
 * Local-loop visits do not initialize YouTube or download speculative media. */
export function warmYouTubeReference(doc=globalThis.document){
 for(const origin of ['https://www.youtube-nocookie.com','https://www.youtube.com','https://i.ytimg.com']){
  if(doc.head.querySelector(`link[data-echo-preconnect="${origin}"]`))continue;
  const link=doc.createElement('link');link.rel='preconnect';link.href=origin;link.dataset.echoPreconnect=origin;doc.head.append(link);
 }
}

export function loadYouTubeAPI({window:win=globalThis.window,document:doc=globalThis.document}={}){
 if(win?.YT?.Player)return Promise.resolve(win.YT);
 if(youtubeAPI)return youtubeAPI;
 const pending=new Promise((resolve,reject)=>{
  const script=doc.createElement('script'),previous=win.onYouTubeIframeAPIReady;
  let settled=false;
  const finish=error=>{
   if(settled)return;settled=true;clearTimeout(timer);script.onerror=null;
   if(win.onYouTubeIframeAPIReady===ready)win.onYouTubeIframeAPIReady=previous;
   if(error){script.remove();reject(error);}else resolve(win.YT);
  };
  const ready=()=>{try{previous?.();}finally{finish(win.YT?.Player?null:new Error('Source player API unavailable.'));}};
  const timer=setTimeout(()=>finish(new Error('Source player API timed out.')),15000);
  win.onYouTubeIframeAPIReady=ready;script.src='https://www.youtube.com/iframe_api';script.async=true;
  script.onerror=()=>finish(new Error('Source player API could not load.'));
  doc.head.append(script);
 });
 youtubeAPI=pending.catch(error=>{youtubeAPI=null;throw error;});return youtubeAPI;
}

export function ensureEchoReferenceStyles(doc=globalThis.document){
 if(doc.querySelector('link[data-echo-reference-styles]'))return;
 const link=doc.createElement('link');link.rel='stylesheet';link.href=new URL('./echo-reference-player.css',import.meta.url).href;link.dataset.echoReferenceStyles='';doc.head.append(link);
}

export function youtubeReferenceURL(source,origin=globalThis.location?.origin){
 const url=new URL(source);
 if(url.protocol!=='https:'||url.hostname!=='www.youtube-nocookie.com'||!/^\/embed\/[A-Za-z0-9_-]{11}$/.test(url.pathname))throw new Error('Invalid source player.');
 for(const [key,value] of Object.entries({enablejsapi:'1',autoplay:'1',mute:'1',playsinline:'1',rel:'0',loop:'1',playlist:url.pathname.split('/').at(-1)}))url.searchParams.set(key,value);
 if(origin&&origin!=='null')url.searchParams.set('origin',origin);
 return url.href;
}

/** Replaces the iframe rather than navigating a reused frame through about:blank. */
export function createYouTubeReference({placeholder,selected,isCurrent,onReady,onPlaying,onBuffering,onPaused,onBlocked,onError,apiLoader=loadYouTubeAPI,timeoutMs=18000,playbackTimeoutMs=25000}){
 warmYouTubeReference(placeholder.ownerDocument||globalThis.document);
 const frame=placeholder.cloneNode(false);frame.removeAttribute('src');frame.id=`echo-source-player-${++nextPlayerId}`;
 frame.title=`${selected.title}. Independent clinical ultrasound reference.`;
 frame.setAttribute('allow','autoplay; fullscreen; picture-in-picture; encrypted-media');
 frame.setAttribute('referrerpolicy','strict-origin-when-cross-origin');frame.hidden=false;frame.style.opacity='0';
 // Reserve the same box before iframe/API/style loading and every retry. The
 // remote player must never contribute its intrinsic 300 x 150 size to layout.
 frame.width='640';frame.height='360';
 Object.assign(frame.style,{position:'absolute',inset:'0',width:'100%',height:'100%',minWidth:'0',minHeight:'0',border:'0'});
 frame.src=youtubeReferenceURL(selected.url);
 let disposed=false,failed=false,player=null,ready=false,playbackTimer=null,detached=false,autoplayBlocked=false;
 const current=()=>!disposed&&!failed&&isCurrent();
 const clearPlaybackWait=()=>{clearTimeout(playbackTimer);playbackTimer=null;};
 const detachPlayer=()=>{
  // Stop the media even when the fallback has hidden its iframe. Detach before
  // destroying the API object so its queued callbacks cannot reach a new view.
  if(!detached){detached=true;const empty=frame.cloneNode(false);empty.removeAttribute('src');empty.removeAttribute('id');empty.hidden=true;empty.style.opacity='';frame.replaceWith(empty);}
  const oldPlayer=player;player=null;
  try{oldPlayer?.stopVideo?.();}catch{/* A failed remote player may not answer. */}
  try{oldPlayer?.destroy();}catch{/* The frame may already have been detached. */}
 };
 const fail=()=>{if(!current())return;failed=true;clearTimeout(timer);clearPlaybackWait();detachPlayer();onError();};
 const waitForPlayback=()=>{
  if(!current()||playbackTimer!==null)return;
  playbackTimer=setTimeout(()=>{
   playbackTimer=null;if(!current())return;
   // A pause/cue/end may have reached the player before its event reaches this
   // document. Those intentional idle states must never trigger a failure.
   let state;try{state=player?.getPlayerState?.();}catch{/* Treat an unresponsive active player as stalled. */}
   if([0,1,2,5].includes(state))return;
   fail();
  },playbackTimeoutMs);
 };
 const reveal=()=>{if(!current())return false;clearTimeout(timer);frame.style.opacity='1';if(!ready){ready=true;onReady();}return true;};
 const timer=setTimeout(fail,timeoutMs);
 // The source is already assigned when the new browsing context is attached.
 placeholder.replaceWith(frame);
 Promise.resolve().then(()=>apiLoader()).then(YT=>{
  if(!current())return;
  player=new YT.Player(frame,{events:{
   onReady:event=>{if(!reveal())return;event.target.mute();waitForPlayback();event.target.playVideo();},
   onStateChange:event=>{
    if(!current())return;
    if(event.data===1){autoplayBlocked=false;clearPlaybackWait();reveal();onPlaying?.();}
    else if(event.data===3&&!autoplayBlocked){waitForPlayback();onBuffering?.();}
    else if([0,2,5].includes(event.data)){clearPlaybackWait();if(event.data===2)onPaused?.();}
   },
   onAutoplayBlocked:()=>{if(!current())return;autoplayBlocked=true;clearPlaybackWait();if(reveal())onBlocked?.();},
   onError:fail,
  }});
  if(!current())detachPlayer();
 }).catch(fail);
 return {frame,destroy(){
  if(disposed)return;disposed=true;clearTimeout(timer);clearPlaybackWait();
  // Remove the selected frame before destroying the API player. Never clear src
  // on a live iframe: its queued empty-document load can belong to the next view.
  detachPlayer();
 }};
}

/** Every TEE view has a numeric reference. A guideline midpoint is not a
 * measured acquisition angle and must remain explicitly labelled REF. */
export function supplementalTeeAngle(view){
 const range=multiplaneRange(view?.angleRange);if(!range||view?.mode==='tte')return null;
 const [min,max]=range,angle=(min+max)/2,point=multiplanePoint(angle);
 return {label:`${angle}°`,angle,...point,range,
  explanation:`Reference angle: ${angle}° (guideline range ${min===max?min:`${min}–${max}`}°). REF is a representative view angle, not a measured angle from this recording.`};
}

/** Match the scanner readout without representing a reference as an acquired angle. */
export const referenceAngleMarkup=`<div class="echo-cine-angle" data-echo="cine-angle" hidden>${multiplaneIndicatorMarkup({label:'REF'})
 .replace('data-multiplane="value"','data-multiplane="value" data-echo="cine-angle-value"')
 .replace('data-multiplane="pointer"','data-multiplane="pointer" data-echo="cine-angle-pointer"')}</div>`;

/** CSS pixels relative to the player's inner box. sourceWidth/sourceHeight are
 * the browser's display dimensions, including the MP4 pixel aspect ratio, not
 * its encoded raster dimensions. Measure the actual video box: responsive CSS
 * can size it independently of the surrounding screen or --echo-screen-height. */
export function referenceAngleLayout({width,height,sourceWidth,sourceHeight,focusAspect,fullFrame=true,videoRect,objectFit,positionX=.5,positionY=.5,placement='reviewed'}){
 if(![width,height,sourceWidth,sourceHeight].every(value=>Number.isFinite(value)&&value>0))return null;
 const sourceAspect=sourceWidth/sourceHeight;
 const focused=Number.isFinite(focusAspect)&&focusAspect>=1&&focusAspect<=2?focusAspect:sourceAspect;
 const fit=(aspect,box)=>{
  const w=Math.min(box.width,box.height*aspect),h=w/aspect;
  return {left:box.left+(box.width-w)/2,top:box.top+(box.height-h)/2,width:w,height:h};
 };
 const box=videoRect||fit(fullFrame?sourceAspect:focused,{left:0,top:0,width,height});
 if(![box.left,box.top,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0)return null;
 const mode=objectFit||(fullFrame?'contain':'cover');
 const scale=mode==='cover'?Math.max(box.width/sourceWidth,box.height/sourceHeight):Math.min(box.width/sourceWidth,box.height/sourceHeight);
 const frameWidth=mode==='fill'?box.width:sourceWidth*scale,frameHeight=mode==='fill'?box.height:sourceHeight*scale;
 const frame={left:box.left+(box.width-frameWidth)*positionX,top:box.top+(box.height-frameHeight)*positionY,width:frameWidth,height:frameHeight};
 const crop=fit(focused,frame);
 // Source-reviewed clear area: below the modified-bicaval header, to the right
 // of its FR/depth/2D column, and left of the sector. The size cap is in image
 // space as well as CSS pixels, so a small full-frame video cannot grow a dial
 // over the scanner settings or heart merely to satisfy a CSS minimum size.
 const corner=placement==='corner';
 const insetX=crop.width*(corner?.025:.17),insetY=crop.height*(corner?.025:.12);
 const dialWidth=corner?Math.min(100,crop.width*.16):Math.min(160,Math.max(80,crop.width*.16),crop.width*.17);
 const left=crop.left+insetX,top=crop.top+insetY;
 // Do not move a clipped dial into unreviewed anatomy to keep it on screen.
 const visible={left:Math.max(0,box.left),top:Math.max(0,box.top),right:Math.min(width,box.left+box.width),bottom:Math.min(height,box.top+box.height)};
 if(left<visible.left||top<visible.top||left+dialWidth>visible.right||top+dialWidth*104/128>visible.bottom)return null;
 return {left,top,width:dialWidth,frame,crop};
}

function objectPosition(value){
 const parts=String(value||'50% 50%').trim().split(/\s+/),keywords={left:0,top:0,center:.5,right:1,bottom:1};
 const fraction=part=>part in keywords?keywords[part]:/^-?[\d.]+%$/.test(part)?Number.parseFloat(part)/100:.5;
 return [fraction(parts[0]),fraction(parts[1]||'50%')];
}

/** One bounded observer for the pane and its video; no per-frame media work.
 * Metadata belongs to the selected source only. Coded catalog dimensions are
 * deliberately not a fallback: both supplemental clips have non-square pixels. */
export function createReferenceAnglePlacement({screen,indicator,video,window:win=globalThis.window}){
 let state=null,stateKey='',disposed=false;
 const absolute=value=>{try{return new URL(value,video.ownerDocument?.baseURI||globalThis.location?.href).href;}catch{return value;}};
 const measure=()=>{
  if(disposed)return;
  const source=state?.sourceUrl&&absolute(state.sourceUrl);
  if(!state?.enabled||video.hidden||video.error||video.readyState<1||!source||absolute(video.currentSrc)!==source||absolute(video.getAttribute('src'))!==source){indicator.style.visibility='hidden';return;}
  const size=screen.getBoundingClientRect?.(),rect=video.getBoundingClientRect?.();
  if(!size||!rect){indicator.style.visibility='hidden';return;}
  const style=win?.getComputedStyle?.(video),[positionX,positionY]=objectPosition(style?.objectPosition);
  const layout=referenceAngleLayout({...state,
   width:screen.clientWidth||size.width,height:screen.clientHeight||size.height,
   sourceWidth:video.videoWidth,sourceHeight:video.videoHeight,
   videoRect:{left:rect.left-size.left-(screen.clientLeft||0),top:rect.top-size.top-(screen.clientTop||0),width:rect.width,height:rect.height},
   objectFit:style?.objectFit,positionX,positionY});
  indicator.style.visibility=layout?'visible':'hidden';
  if(!layout)return;
  for(const name of ['left','top','width'])indicator.style.setProperty(`--echo-angle-${name}`,`${Number(layout[name].toFixed(3))}px`);
 };
 const Observer=win?.ResizeObserver||globalThis.ResizeObserver;
 const observer=typeof Observer==='function'?new Observer(measure):null;
 observer?.observe(screen);observer?.observe(video);
 if(!observer)win?.addEventListener?.('resize',measure);
 const events=['loadedmetadata','resize','emptied','loadstart','error'];
 for(const event of events)video.addEventListener(event,measure);
 return {
  update(next){
   const key=[!!next.enabled,next.sourceUrl,next.sourceKey,next.focusAspect,!!next.fullFrame,next.placement].join('|');
   if(disposed||(key===stateKey&&indicator.style.visibility!=='hidden'))return;
   state=next;stateKey=key;measure();
  },
  destroy(){
   if(disposed)return;disposed=true;observer?.disconnect();
   if(!observer)win?.removeEventListener?.('resize',measure);
   for(const event of events)video.removeEventListener(event,measure);
  },
 };
}
