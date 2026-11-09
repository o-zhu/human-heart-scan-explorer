/** Display styles only: none of these functions changes the measured volume. */
export const RENDER_STYLES = [
 {id:0,name:'Warm stone'}, {id:1,name:'Terracotta'}, {id:2,name:'Grayscale'},
 {id:3,name:'Porcelain'}, {id:4,name:'Tissue & space'}, {id:5,name:'Anatomy'},
 {id:6,name:'Atlas cinematic'}
];
export const DEFAULT_ANATOMY_COLORS = [
 [0.55,0.60,0.62], [0.89,0.43,0.45], [0.33,0.65,0.90],
 [0.95,0.70,0.42], [0.39,0.78,0.73], [0.77,0.60,0.91], [0.38,0.80,0.88]
];
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};

/** Figure 6A-inspired display colors, not tissue classes or the authors' LUT. */
export function atlasTone(value){
 const v=clamp(value);
 let color=mix([.018,.020,.021],[.31,.095,.080],smooth(.015,.30,v));
 color=mix(color,[.68,.44,.19],smooth(.27,.60,v));
 color=mix(color,[.92,.90,.81],smooth(.52,.87,v));
 return mix(color,[.98,.97,.90],smooth(.87,1,v));
}

/** Display controls are independent of measured density and surface thresholds. */
export const DEFAULT_WINDOW_SETTINGS={windowEnabled:false,windowLow:0,windowHigh:1,windowGamma:1,cutFaceExposure:1};
/** A display gain with a soft shoulder: black and white stay fixed, no added clipping. */
export function cutFaceExposure(settings={}){
 const exposure=settings?.cutFaceExposure;
 return Number.isFinite(exposure)&&exposure>0?clamp(exposure,.5,3):1;
}
export function exposeCutIntensity(value,exposure=1){
 const v=clamp(value),e=Number.isFinite(exposure)&&exposure>0?clamp(exposure,.5,3):1;
 return e===1?v:e*v/(1+(e-1)*v);
}
export function windowParameters(settings={}){
 const low=clamp(Number.isFinite(settings.windowLow)?settings.windowLow:0,0,.9999);
 return {windowEnabled:settings.windowEnabled===true,windowLow:low,
  windowHigh:clamp(Number.isFinite(settings.windowHigh)?settings.windowHigh:1,low+.0001,1),
  windowGamma:clamp(Number.isFinite(settings.windowGamma)?settings.windowGamma:1,.2,4),
  cutFaceExposure:cutFaceExposure(settings)};
}
export function windowIntensity(value,settings={},contrast=settings.capContrast??1){
 const w=windowParameters(settings),q=Math.pow(clamp((value-w.windowLow)/(w.windowHigh-w.windowLow)),w.windowGamma);
 return clamp((q-.5)*(Number.isFinite(contrast)?contrast:1)+.5);
}

export function surfaceColor(value,threshold,palette){
 const t=clamp((value-threshold)*1.9+.22);
 if(palette===1)return mix([.40,.145,.095],[.94,.67,.49],t);
 if(palette===2)return mix([.34,.37,.40],[.92,.94,.95],t);
 if(palette===3)return mix([.66,.73,.73],[.97,.94,.86],.46+.44*t);
 if(palette===4)return mix([.55,.68,.70],[.98,.96,.88],.54+.38*t);
 if(palette===5)return mix([.44,.50,.53],[.85,.87,.85],t);
 if(palette===6){
  const q=clamp((value-threshold)*1.6);
  let color=mix([.27,.065,.060],[.48,.18,.13],smooth(.03,.34,q));
  color=mix(color,[.70,.50,.25],smooth(.30,.66,q));
  return mix(color,[.91,.89,.79],smooth(.63,.93,q));
 }
 return mix([.50,.34,.24],[.96,.84,.68],t);
}

export function capColor(value,contrast=1.8,palette=4,settings=null){
 const windowed=settings?.windowEnabled===true;
 const exposure=cutFaceExposure(settings);
 const v=exposeCutIntensity(windowed?windowIntensity(value,settings,contrast):clamp((value-.5)*contrast+.48,.025,.96),exposure);
 if(palette===3)return mix([.10,.18,.20],[.97,.94,.86],v);
 if(palette===4){const q=windowed?v:exposeCutIntensity(clamp((value-.48)*contrast*1.12+.58,.015,.98),exposure);return mix([.015,.035,.045],[.98,.96,.88],q);}
 if(palette===5)return mix([.09,.12,.14],[.87,.89,.89],v);
 if(palette===6)return atlasTone(v);
 const tint=palette===0?[1,.92,.8]:palette===1?[1,.68,.49]:[1,1,1];
 return tint.map(t=>v*t);
}

export function anatomyColor(base,id,colors=DEFAULT_ANATOMY_COLORS,opacity=.65,selected=0){
 if(selected>0&&id!==selected){const gray=base[0]*.2126+base[1]*.7152+base[2]*.0722;return mix(base,[gray*.50,gray*.55,gray*.59],.8);}
 if(!id||!colors[id])return base;
 const luminance=base[0]*.2126+base[1]*.7152+base[2]*.0722;
 const tinted=colors[id].map(v=>v*(.30+1.02*luminance));
 return mix(base,tinted,clamp(opacity));
}

/** Preserve colored cap highlights without clipping a label channel to white.
 * Scale all channels together so label hue stays fixed. Surface lighting keeps
 * anatomyColor; this shoulder is only for directly displayed CT cut faces.
 */
export function capAnatomyColor(base,id,colors=DEFAULT_ANATOMY_COLORS,opacity=.65,selected=0){
 const color=anatomyColor(base,id,colors,opacity,selected),peak=Math.max(...color);
 if(peak<=.94)return color;
 const headroom=.06,scale=(1-headroom*Math.exp(-(peak-.94)/headroom))/peak;
 return color.map(channel=>channel*scale);
}

/** Accept either a JSON legend or a simple color array. */
export function buildAnatomyPalette(entries){
 const result=Array.from({length:16},(_,i)=>[...(DEFAULT_ANATOMY_COLORS[i]||DEFAULT_ANATOMY_COLORS[0])]);
 if(Array.isArray(entries))entries.forEach((entry,i)=>{
  const id=Array.isArray(entry)?i:entry.id;let color=Array.isArray(entry)?entry:entry.color;
  if(typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color))color=[1,3,5].map(start=>parseInt(color.slice(start,start+2),16)/255);
  if(Number.isInteger(id)&&id>=0&&id<16&&Array.isArray(color)&&color.length===3&&color.every(Number.isFinite))result[id]=color.map(v=>clamp(v));
 });
 return result;
}
