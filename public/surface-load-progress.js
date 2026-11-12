// One operation owns the surface toast. Per-block download, verification and
// upload events may interleave; none of them may reset its bar or replace it
// with an indeterminate animation. These weights describe completed work, not
// elapsed time or a promise about how long the remaining work will take.
const stages = Object.freeze({
 transfer: {order:0, start:0, end:.78, label:'Loading and preparing surface'},
 prepare: {order:.5, start:.70, end:.78, label:'Preparing surface'},
 verify: {order:1, start:.78, end:.86, label:'Checking surface'},
 debris: {order:2, start:.86, end:.88, label:'Preparing surface cleanup'},
 masks: {order:3, start:.88, end:.91, label:'Preparing reviewed cleanup'},
 interiors: {order:4, start:.91, end:.96, label:'Preparing interior surfaces'},
 graphics: {order:5, start:.96, end:.99, label:'Preparing graphics'},
 'first-frame': {order:6, start:.99, end:.995, label:'Opening the complete model'},
 complete: {order:7, start:1, end:1, label:'Surface ready'},
});
const fraction = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
const bytes = value => Number.isFinite(value) && value >= 0 ? value : null;

/** UI-only state: never authorizes installing geometry or completing a job. */
export class SurfaceLoadProgress {
 constructor(){ this.revision=null; this.active=false; }
 begin(revision, label){
  this.revision=revision;this.label=label;this.active=true;this.stage='transfer';
  this.value=0;this.downloadFraction=0;this.uploadFraction=0;
  this.loadedBytes=0;this.totalBytes=0;this.paused=false;this.detail=null;this.recovery=null;this.sequential=false;this.restoringPart=false;
  return this.snapshot();
 }
 current(revision){return this.active&&revision===this.revision;}
 restartTransfer(revision=this.revision){
  if(!this.current(revision))return null;
  // A deliberate fallback is a new transport attempt, not a stale progress
  // callback. Its label may restart; the operation's determinate bar may not.
  this.stage='transfer';this.sequential=false;this.recovery=null;this.detail=null;this.restoringPart=false;
  this.loadedBytes=0;this.totalBytes=0;this.downloadFraction=0;this.uploadFraction=0;
  return this.snapshot();
 }
 update(message={}, revision=this.revision){
  if(!this.current(revision))return null;
  if(this.stage==='transfer'&&message.stage==='download-start'&&message.sequential===true){this.sequential=true;this.recovery=null;}
  if(this.stage==='transfer'&&message.stage==='streaming-fallback'&&message.sequential===false){this.sequential=false;this.recovery=null;}
  if(this.stage==='prepare'&&(message.stage==='streaming-fallback'||message.stage==='restore-start')&&message.sequential===false){this.restoringPart=true;this.recovery=null;}
  if(message.stage==='reconnect'){
   if((this.stage==='transfer'||this.stage==='prepare'&&this.restoringPart)&&Number.isInteger(message.retryAttempt)&&message.retryAttempt>0&&Number.isInteger(message.maxRetries)&&message.maxRetries>=message.retryAttempt)
    this.recovery={attempt:message.retryAttempt,maximum:message.maxRetries};
   return this.snapshot();
  }
  // Hash progress also uses loadedBytes, but those are decoded bytes. Treat
  // them as download bytes only when their phase or explicit field says so.
  const loaded=bytes(message.downloadedBytes??(message.phase==='download'?message.loadedBytes:undefined));
  const total=bytes(message.downloadTotalBytes??(message.phase==='download'?message.totalBytes:undefined));
  if(loaded!==null&&total!==null&&total>0){
   if(loaded>0)this.recovery=null;
   this.loadedBytes=total===this.totalBytes?Math.max(this.loadedBytes,Math.min(loaded,total)):Math.min(loaded,total);this.totalBytes=total;
   this.downloadFraction=Math.max(this.downloadFraction,this.loadedBytes/total);
  }
  const previousUpload=this.uploadFraction,uploaded=bytes(message.uploadedBytes),uploadTotal=bytes(message.totalUploadBytes);
  if(uploaded!==null&&uploadTotal!==null&&uploadTotal>0)this.uploadFraction=Math.max(this.uploadFraction,Math.min(1,uploaded/uploadTotal));
  if(this.stage==='prepare'&&this.uploadFraction>previousUpload){this.restoringPart=false;this.recovery=null;}
  // Download progress accounts for most transfer work. A streamed GPU upload
  // has its own measured contribution and cannot make the bar run backwards
  // when the next compressed block starts or a transport fallback restarts.
  if(this.stage==='transfer')this.value=Math.max(this.value,.70*this.downloadFraction+(this.sequential?0:.08*this.uploadFraction));
  if(this.stage==='prepare')this.value=Math.max(this.value,.70+.08*this.uploadFraction);
  // Only the worker's completed staging barrier can separate acquisition from
  // preparation. A byte counter reaching its total alone is not that proof.
  if(this.stage==='transfer'&&this.sequential&&message.stage==='download-complete'&&message.sequential===true&&loaded!==null&&total>0&&loaded===total)
   return this.setStage('prepare',{fraction:this.uploadFraction},revision);
  if(message.stage==='verify-final'||message.final===true){
   const progress=fraction(message.fraction??(message.totalBytes>0?message.loadedBytes/message.totalBytes:undefined));
   return this.setStage('verify',progress===null?{}:{fraction:progress},revision);
  }
  return this.snapshot();
 }
 setStage(stage, details={}, revision=this.revision){
  if(!this.current(revision)||!Object.hasOwn(stages,stage))return null;
  const next=stages[stage],previous=stages[this.stage];
  // A completed older phase can arrive while a newer one is already running.
  // Its bytes remain useful for diagnostics, but it cannot change the toast.
  if(next.order<previous.order)return this.snapshot();
  if(stage!==this.stage){this.detail=null;this.recovery=null;this.restoringPart=false;}
  this.stage=stage;
  if(typeof details.detail==='string')this.detail=details.detail;
  const measured=fraction(details.fraction);
  this.value=Math.max(this.value,next.start+(measured??0)*(next.end-next.start));
  return this.snapshot();
 }
 setPaused(paused,revision=this.revision){
  if(!this.current(revision))return null;
  this.paused=!!paused;return this.snapshot();
 }
 complete(revision=this.revision){return this.setStage('complete',{},revision);}
 end(revision=this.revision){if(this.current(revision))this.active=false;}
 snapshot(){
  if(!this.active)return null;
  const reconnecting=(this.stage==='transfer'||this.stage==='prepare'&&this.restoringPart)&&this.recovery;
  const label=this.paused?'Surface preparation paused':reconnecting?'Reconnecting download…':this.stage==='prepare'&&this.restoringPart?'Restoring surface data':this.stage==='transfer'&&this.sequential?'Downloading surface':stages[this.stage].label;
  const detail=this.paused?'Resume in Reconstruction':reconnecting?
   'Retry '+this.recovery.attempt+' of '+this.recovery.maximum+' · progress retained':this.detail??(
   this.stage==='transfer'&&this.totalBytes>0?
    (this.loadedBytes/1e6).toFixed(1)+' of '+(this.totalBytes/1e6).toFixed(1)+' MB'+(!this.sequential&&this.uploadFraction>0?' · prepared '+Math.floor(this.uploadFraction*100)+'%':''):
    this.stage==='prepare'?Math.floor(this.uploadFraction*100)+'% prepared':
    this.stage==='complete'?'The prepared surface is ready':'The current view stays usable');
  return {revision:this.revision,target:this.label,stage:this.stage,paused:this.paused,value:this.value,label,detail,
   announcement:label+(this.stage==='complete'?'. The prepared surface is ready.':'. The current view stays usable.')};
 }
}

/** Update existing nodes only: the live announcement changes once per stage. */
export function renderSurfaceLoadProgress({panel,progress,status,stageText,detailText,announcement},state){
 if(!state)return;
 panel.dataset.loadStage=state.stage;panel.dataset.loading='true';
 status.dataset.stage=state.stage;
 if(stageText.textContent!==state.label)stageText.textContent=state.label;
 if(detailText.textContent!==state.detail)detailText.textContent=state.detail;
 const value=String(state.value);
 if(progress.getAttribute('value')!==value){progress.value=state.value;progress.setAttribute('value',value);}
 progress.hidden=false;progress.setAttribute('aria-label','Surface loading progress');
 progress.setAttribute('aria-valuetext',state.label+'. '+state.detail);
 if(announcement.textContent!==state.announcement)announcement.textContent=state.announcement;
}
