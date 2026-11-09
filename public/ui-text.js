/** Consistent display labels without changing scientific metadata or units. */
const smallWords=new Set(['a','an','and','as','at','by','for','from','in','of','on','or','the','to','with']);
const units=new Set(['µm','μm','mm','cm','nm','ms','s','fps','kB','KB','MB','GB','Hz','kHz','MHz','dB']);
const acronyms=new Map(['ct','mri','tte','tee','rv','lv','ra','la','hu','ase','sca'].map(word=>[word,word.toUpperCase()]));

export function titleCaseUi(value){
 let index=0;
 return String(value??'').replace(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu,word=>{
  const first=index++===0,lower=word.toLowerCase();
  if(units.has(word))return word;
  if(acronyms.has(lower))return acronyms.get(lower);
  if(!first&&smallWords.has(lower))return lower;
  // Keep established mixed-case names such as SlicerHeart, HiP-CT and cMAC.
  if(/[A-Z]/.test(word.slice(1)))return word;
  return word.charAt(0).toUpperCase()+word.slice(1);
 });
}
