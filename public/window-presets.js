/** Display-only starting points, selected from measured multi-plane comparisons.
 * Normalized endpoints use the immutable sourceWindow encoding of each donor.
 * Neither a preset nor a manual adjustment changes density, geometry or labels.
 */
const FIELDS=['windowEnabled','windowLow','windowHigh','windowGamma','capContrast','cutFaceExposure'];
const BASE={windowEnabled:false,windowLow:0,windowHigh:1,windowGamma:1,capContrast:1.8,cutFaceExposure:1};

// [normalized black, normalized white, gamma, contrast, brightness]
// See docs/windowing-v18 for measured sections, parameter sensitivity and
// retained-tone/contrast tradeoffs. These are starting points, not a universal
// fidelity optimum. Values align with the existing slider increments.
const PROFILES={
 'ladaf-2021-17':{
  balanced:[.276,.883,.90,1,3],
  contrast:[.344,.787,1.00,1,3]
 },
 's-20-29':{
  balanced:[.081,.703,.90,1,3],
  contrast:[.162,.568,.85,1,3]
 },
 's-20-28':{
  balanced:[.253,.902,.90,1,3],
  contrast:[.330,.761,.95,1,3]
 }
};

function settingsFor(values){
 const [windowLow,windowHigh,windowGamma,capContrast,cutFaceExposure]=values;
 return {windowEnabled:true,windowLow,windowHigh,windowGamma,capContrast,cutFaceExposure};
}

export function getWindowPresets(donor={}){
 const original=Object.fromEntries(FIELDS.map(key=>[key,(donor.originalDisplayWindow||donor.displayWindow)?.[key]??BASE[key]]));
 const choices=[];
 const profile=PROFILES[donor.id];
 if(profile){
  choices.push({id:'balanced',label:'Balanced Detail',description:'Bright tissue with a broader range of visible shades. A starting point for inspecting fine structure.',settings:settingsFor(profile.balanced)});
  choices.push({id:'contrast',label:'Strong Contrast',description:'The default: clear tissue–space separation with a gentle midtone lift. Subtle bright and dark differences may be less visible.',settings:settingsFor(profile.contrast)});
 }
 choices.push({id:'original',label:'Original',description:'Restore this donor’s original brightness and intensity window.',settings:original});
 return choices;
}

/** Fresh views and Reset use Strong; explicit saved/custom values stay intact. */
export function defaultWindowFor(donor={}){
 return PROFILES[donor.id]?settingsFor(PROFILES[donor.id].contrast):{...BASE,...donor.displayWindow};
}

export function matchWindowPreset(donor={},settings={}){
 for(const preset of getWindowPresets(donor)){
  const matches=FIELDS.every(key=>{
   const actual=settings[key]??BASE[key],expected=preset.settings[key];
   if(key==='windowEnabled')return actual===expected;
   const tolerance=(key==='windowLow'||key==='windowHigh') ? 0.00050001 : 0.00001;
   return Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance;
  });
  if(matches)return preset.id;
 }
 return 'custom';
}
