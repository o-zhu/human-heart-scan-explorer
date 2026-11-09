/** A camera preference only. It never changes a CT plane, retained half or pixels. */
export const TEE_ALIGNMENT_STORAGE_KEY='heart-explorer.tee-alignment.v1';
export function normalizeTeeAlignment(value){return value==='upright'?'upright':value==='probe'?'probe':'ultrasound';}
export function readTeeAlignment(){
 try{const value=globalThis.localStorage?.getItem(TEE_ALIGNMENT_STORAGE_KEY);return value==null?'probe':normalizeTeeAlignment(value);}
 catch{return 'probe';}
}
export function rememberTeeAlignment(value){
 const alignment=normalizeTeeAlignment(value);
 try{globalThis.localStorage?.setItem(TEE_ALIGNMENT_STORAGE_KEY,alignment);}catch{}
 return alignment;
}
