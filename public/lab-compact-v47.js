/** Presentation-only compact lab layout. Existing steering controls move intact
 * so pointer capture, keyboard shortcuts and the accepted acquisition pose are
 * shared with the desktop layout. No probe or image state is duplicated here. */
export const LAB_COMPACT_QUERY='(max-width: 1050px), (max-height: 760px), (any-pointer: coarse)';

export function labCompactPolicy({width=Infinity,height=Infinity,coarse=false,anyCoarse=coarse}={}){
 return {compact:width<=1050||height<=760||anyCoarse,single:width<=600,coarse:!!coarse};
}

const touchLabels={
 probe:{KeyQ:'↶ Rotate',KeyW:'↑ Slide',KeyE:'↷ Rotate',KeyA:'← Slide',KeyS:'↓ Slide',KeyD:'→ Slide',KeyI:'↑ Tilt',KeyJ:'← Fan',KeyK:'↓ Tilt',KeyL:'→ Fan',KeyR:'↑ Out',KeyF:'↓ In'},
 tee:{KeyQ:'−° Plane',KeyW:'↓ Advance',KeyE:'+° Plane',KeyA:'↶ Turn',KeyS:'↑ Withdraw',KeyD:'↷ Turn',KeyI:'↑ Anteflex',KeyJ:'← Flex',KeyK:'↓ Retroflex',KeyL:'→ Flex'}
};
const selectValue=(select,value)=>{const option=[...select.options].find(option=>option.value===value);if(option)option.selected=true;};

export function createCompactLabLayout(module,{view=window}={}){
 const mount=module.mount,doc=mount.ownerDocument,tee=!!mount.querySelector('.tee-workspace'),kind=tee?'tee':'probe';
 const workspace=mount.querySelector('.probe-workspace,.tee-workspace');
 if(!workspace)return null;
 const presets=[...mount.querySelectorAll(`[data-${kind}-preset]`)];
 const toolbar=doc.createElement('div');toolbar.className='lab-compact-toolbar';toolbar.hidden=true;
 toolbar.innerHTML=`<label class="lab-compact-preset"><span class="lab-sr-only">Starting view</span><select data-lab-compact="preset" aria-label="Starting view"></select></label><label class="lab-compact-view"><span class="lab-sr-only">Visible panels</span><select data-lab-compact="view" aria-label="Visible panels"><option value="scene">3D Heart</option><option value="image">Image</option><option value="both">Both</option>${tee?'':'<option value="chest">Chest</option>'}</select></label><button type="button" class="lab-controls-toggle" aria-expanded="false" aria-controls="${kind}CompactControlsV47" aria-label="Show probe controls">Steer <span aria-hidden="true">⌄</span></button>`;
 const dock=doc.createElement('section');dock.id=`${kind}CompactControlsV47`;dock.className='lab-compact-dock';dock.hidden=true;dock.setAttribute('aria-label',`${tee?'TEE':'TTE'} probe controls`);
 dock.innerHTML='<div class="lab-compact-steering"></div><p class="lab-steer-hint">Tap to step · Hold to steer</p><details class="lab-compact-adjustments"><summary>Depth &amp; Angles</summary><div></div></details><details class="lab-compact-view-options"><summary>View Options</summary><div></div></details>';
 workspace.before(toolbar);workspace.append(dock);
 const presetSelect=toolbar.querySelector('[data-lab-compact="preset"]'),viewSelect=toolbar.querySelector('[data-lab-compact="view"]'),toggle=toolbar.querySelector('button');
 const steering=dock.querySelector('.lab-compact-steering'),adjustments=dock.querySelector('.lab-compact-adjustments'),more=dock.querySelector('.lab-compact-view-options > div');
 adjustments.hidden=!tee;
 const choices=presets.map(button=>{const option=doc.createElement('option');option.value=button.dataset[`${kind}Preset`];presetSelect.append(option);return {button,option};});
 const moved=[];
 let compact=false,pane=null,chosenPane=false,controlsOpen=false;
 const media=view.matchMedia?.(LAB_COMPACT_QUERY),touchMedia=view.matchMedia?.('(pointer: coarse)'),anyTouchMedia=view.matchMedia?.('(any-pointer: coarse)');
 for(const button of mount.querySelectorAll(`[data-${kind}-key]`)){
  const text=touchLabels[kind][button.dataset[`${kind}Key`]];
  if(!text)continue;
  const label=doc.createElement('span');label.className='lab-touch-key';label.setAttribute('aria-hidden','true');
  const split=text.indexOf(' '),icon=doc.createElement('b'),word=doc.createElement('span');icon.textContent=text.slice(0,split);word.textContent=text.slice(split+1);label.append(icon,word);button.append(label);
 }
 const move=(selector,destination)=>{
  const node=mount.querySelector(selector);if(!node)return;
  const marker=doc.createComment('compact lab: original control position');node.before(marker);moved.push({node,marker});destination.append(node);
 };
 const release=()=>module.releaseControl?.();
 const notify=()=>{
  module.guideKey='';
  // A pane switch can change canvas dimensions without resizing the page.
  // ResizeObserver handles the actual renderer; this wakes the guide/context.
  if(module.active)module.drawGuide?.();
  mount.dispatchEvent(new view.CustomEvent('labcompactlayoutchange',{bubbles:true}));
 };
 const setControlsOpen=(open,{focus=false,emit=true}={})=>{
  const next=compact&&!!open;
  if(controlsOpen&&!next)release();
  controlsOpen=next;dock.hidden=!next;toggle.setAttribute('aria-expanded',String(next));toggle.setAttribute('aria-label',`${next?'Hide':'Show'} probe controls`);mount.classList.toggle('lab-controls-open',next);
  if(compact&&(focus||(!next&&dock.contains(doc.activeElement))))toggle.focus?.({preventScroll:true});
  if(emit)notify();
 };
 const setPane=(next,{user=false,emit=true}={})=>{
  if(!['scene','image','both',...(tee?[]:['chest'])].includes(next))return;
  if(user)chosenPane=true;
  if(pane!==next)release();
  pane=next;mount.dataset.labView=next;selectValue(viewSelect,next);
  if(emit)notify();
 };
 const sync=()=>{
  for(const {button,option}of choices){
   const label=button.querySelector(`[data-${kind}-preset-label]`)?.textContent?.trim()||button.textContent.trim();
   const angle=tee?button.querySelector('.probe-preset-number')?.textContent?.trim():'';
   const text=label+(angle?` · ${angle}`:'');
   if(option.textContent!==text)option.textContent=text;
   if(button.getAttribute('aria-pressed')==='true'&&presetSelect.value!==option.value)selectValue(presetSelect,option.value);
  }
 };
 const refresh=()=>{
  const policy=labCompactPolicy({width:Number(view.innerWidth)||Infinity,height:Number(view.innerHeight)||Infinity,coarse:!!touchMedia?.matches,anyCoarse:!!(anyTouchMedia?.matches||touchMedia?.matches)});
  mount.classList.toggle('lab-touch',policy.coarse);
  const next=policy.compact,previousPane=pane,focused=doc.activeElement;
  if(!chosenPane)setPane(policy.single?'scene':'both',{emit:false});
  if(next===compact){if(compact&&pane!==previousPane)notify();return;}
  release();compact=next;mount.classList.toggle('lab-compact',next);toolbar.hidden=!next;
  if(next){
   if(tee){
    move('.tee-console-heading',steering);move('.tee-reset',steering);move('.tee-hand-controls',steering);
    move('.tee-depth-readout',adjustments.lastElementChild);move('.tee-mechanical-controls',adjustments.lastElementChild);
    move('.tee-keyboard',more);move('.tee-workspace-links',more);
   }else{
    move('.probe-keyboard-console',steering);move('.probe-primary-actions',more);
   }
   move('.probe-view-actions',more);
  }else{
   for(const {node,marker}of moved.splice(0).reverse()){marker.replaceWith(node);}
   for(const details of dock.querySelectorAll('details[open]'))details.removeAttribute('open');
  }
  setControlsOpen(false,{emit:false});sync();
  if(next&&dock.contains(focused))toggle.focus?.({preventScroll:true});
  else if(!next&&toolbar.contains(focused)){
   const preset=presets.find(button=>button.getAttribute('aria-pressed')==='true')||presets[0];
   // The shared 3D controls may still hold TEE presets in their closed menu.
   const target=preset?.closest('[hidden]')?mount.querySelector('.probe-viewport-mount'):preset;
   target?.focus?.({preventScroll:true});
  }
  notify();
 };
 presetSelect.addEventListener('change',()=>{release();module.selectPreset(presetSelect.value);sync();});
 viewSelect.addEventListener('change',()=>setPane(viewSelect.value,{user:true}));
 toggle.addEventListener('click',()=>setControlsOpen(!controlsOpen));
 dock.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();setControlsOpen(false,{focus:true});}});
 // Prevent a hidden held control from continuing if a nested fold is closed.
 dock.addEventListener('toggle',()=>{release();notify();},true);
 view.addEventListener('resize',refresh);
 media?.addEventListener?.('change',refresh);touchMedia?.addEventListener?.('change',refresh);
 sync();refresh();
 return {
  sync,refresh,setPane,setControlsOpen,
  get compact(){return compact;},get view(){return pane;},get controlsOpen(){return controlsOpen;},
  destroy(){
   release();view.removeEventListener('resize',refresh);media?.removeEventListener?.('change',refresh);touchMedia?.removeEventListener?.('change',refresh);
   for(const {node,marker}of moved.splice(0).reverse())marker.replaceWith(node);
   toolbar.remove();dock.remove();mount.classList.remove('lab-compact','lab-touch','lab-controls-open');delete mount.dataset.labView;
  }
 };
}
