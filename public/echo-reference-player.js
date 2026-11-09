/** Selection-scoped source players. A frame load is not evidence that YouTube is ready. */
let youtubeAPI;
let nextPlayerId=0;

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
 const frame=placeholder.cloneNode(false);frame.removeAttribute('src');frame.id=`echo-source-player-${++nextPlayerId}`;
 frame.title=`${selected.title}. Independent clinical ultrasound reference.`;
 frame.setAttribute('allow','autoplay; fullscreen; picture-in-picture; encrypted-media');
 frame.setAttribute('referrerpolicy','strict-origin-when-cross-origin');frame.hidden=false;frame.style.opacity='0';
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

/** These source recordings omit a readable acquired-angle display. */
export function supplementalTeeAngle(view){
 if(!['me5c','memodbicaval'].includes(view?.id))return null;
 const [min,max]=view.angleRange||[];
 if(!Number.isFinite(min)||!Number.isFinite(max)||min<0||max>180||min>max)return null;
 const angle=(min+max)/2,radians=angle*Math.PI/180;
 return {label:`${angle}°`,angle,x:64-52*Math.cos(radians),y:34+52*Math.sin(radians),
  explanation:`Representative reference angle: ${angle}° (guideline range ${min}–${max}°). The acquired angle is not displayed in this source clip.`};
}

/** Match the scanner readout without representing a reference as an acquired angle. */
export const referenceAngleMarkup=`<div class="echo-cine-angle" data-echo="cine-angle" role="img" hidden><svg viewBox="0 0 128 104" aria-hidden="true"><text class="echo-angle-end" x="12" y="23" text-anchor="middle">0</text><text class="echo-angle-value" data-echo="cine-angle-value" x="64" y="23" text-anchor="middle"></text><text class="echo-angle-end" x="115" y="23" text-anchor="middle">180</text><path class="echo-angle-arc" d="M12 34H116A52 52 0 0 1 12 34"/><line data-echo="cine-angle-pointer" x1="64" y1="34" x2="12" y2="34"/><circle cx="64" cy="34" r="2.4"/><text class="echo-angle-qualification" x="64" y="102" text-anchor="middle">REF</text></svg></div>`;

/** CSS pixels relative to the player's inner box. sourceWidth/sourceHeight are
 * the browser's display dimensions, including the MP4 pixel aspect ratio, not
 * its encoded raster dimensions. Measure the actual video box: responsive CSS
 * can size it independently of the surrounding screen or --echo-screen-height. */
export function referenceAngleLayout({width,height,sourceWidth,sourceHeight,focusAspect,fullFrame=true,videoRect,objectFit,positionX=.5,positionY=.5}){
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
 const insetX=crop.width*.17,insetY=crop.height*.12;
 const dialWidth=Math.min(160,Math.max(80,crop.width*.16),crop.width*.17);
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
   const key=[!!next.enabled,next.sourceUrl,next.sourceKey,next.focusAspect,!!next.fullFrame].join('|');
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
