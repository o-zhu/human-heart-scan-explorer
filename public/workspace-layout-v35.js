/** Fit only Echo/TTE/TEE to the space below the actual page header. */
export function availableWorkspaceHeight(viewportHeight, documentTop, {minimum=380,bottom=12}={}){
 const height=Number.isFinite(viewportHeight)&&viewportHeight>0?viewportHeight:800;
 const top=Number.isFinite(documentTop)?Math.max(0,documentTop):240;
 return Math.max(minimum,Math.floor(height-top-bottom));
}

// Browser chrome and the on-screen keyboard can shorten the usable viewport.
// Pinch zoom must not resize the underlying canvases or reset their cameras.
export function comparisonViewportHeight(view){
 const visual=view.visualViewport;
 return visual&&(!visual.scale||visual.scale===1)&&visual.height>0
  ?Math.min(view.innerHeight||visual.height,visual.height):view.innerHeight;
}

export function fitComparisonWorkspaces(root=document,view=window){
 const panels=['echoPanel','probePanel','teePanel'].map(id=>root.getElementById(id)).filter(Boolean);
 if(!panels.length)return ()=>{};
 const watched=new Set();let queued=0,stopped=false;
 const visible=node=>node&&!node.closest('[hidden]')&&!node.closest('details:not([open])');
 const height=node=>visible(node)?node.getBoundingClientRect().height:0;
 const setPixels=(node,key,value)=>{
  const next=`${Math.ceil(value)}px`;
  if(node.style.getPropertyValue(key)!==next)node.style.setProperty(key,next);
 };
 const update=()=>{
  queued=0;if(stopped)return;
  const full=root.fullscreenElement||root.webkitFullscreenElement;
  const viewportHeight=comparisonViewportHeight(view);
  for(const panel of panels){
   if(!visible(panel))continue;
   const inFullscreen=full&&(full===panel||full.contains(panel));
   // Use document coordinates so scrolling the page cannot grow the canvases.
   const documentTop=node=>node.getBoundingClientRect().top+(inFullscreen?0:(view.scrollY||0));
   if(panel.id==='echoPanel'){
    const compact=panel.classList.contains('echo-compact');
    const toolbars=[...panel.querySelectorAll('.echo-toolbar-content')].filter(visible);
    if(!compact&&!toolbars.length)continue;
    setPixels(panel,'--echo-toolbar-height',compact?0:Math.max(48,...toolbars.map(height)));
    const outsideScreen=node=>!node.closest('.echo-comparison-screen');
    const headings=[...panel.querySelectorAll('.echo-scene-heading > *, .echo-cine > .echo-section-heading > *')].filter(node=>visible(node)&&outsideScreen(node));
    setPixels(panel,'--echo-pane-heading-height',Math.max(compact?0:28,...headings.map(height)));
    setPixels(panel,'--workspace-available-height',availableWorkspaceHeight(viewportHeight,documentTop(panel),{minimum:compact?180:380}));
    if(!compact&&view.innerWidth<=900){panel.style.removeProperty('--echo-screen-height');continue;}
    const screens=[...panel.querySelectorAll('.echo-comparison-screen')].filter(visible);
    if(!screens.length)continue;
    if(compact){
     // Settings and Browse are overlays: opening them cannot shrink the scene.
     // Count only the visible pane's caption/source/status, never its hidden
     // partner or the media loader inside the permanently reserved status row.
     const panes=screens.map(screen=>screen.closest('.echo-view-column,.echo-cine'));
     const tails=panes.map(pane=>{
      const rows=[...pane.querySelectorAll('.echo-mpr-caption,.echo-context-alert,.echo-cine-source-line,.echo-cine-angle-note,.echo-cine-status-slot')].filter(node=>visible(node)&&outsideScreen(node));
      return rows.reduce((sum,row)=>sum+height(row)+4,0);
     });
     const stacked=screens.length>1&&(panel.classList.contains('echo-phone')||view.innerWidth<=900&&view.innerHeight>view.innerWidth);
     if(stacked){
      // Base this on the FIRST screen only. The second screen's top contains
      // the current first-screen height, which would create a resize feedback
      // loop and progressively collapse a stacked pair.
      const heading=panes[1].querySelector('.echo-section-heading,.echo-scene-heading');
      const headingHeight=heading&&outsideScreen(heading)?height(heading):0;
      const secondHeading=headingHeight?headingHeight+4:0;
      const reserve=tails.reduce((sum,value)=>sum+value,0)+secondHeading+7+22;
      setPixels(panel,'--echo-screen-height',Math.max(180,Math.floor((viewportHeight-documentTop(screens[0])-reserve)/screens.length)));
     }else{
      setPixels(panel,'--echo-screen-height',availableWorkspaceHeight(viewportHeight,Math.max(...screens.map(documentTop)),{minimum:160,bottom:Math.max(0,...tails)+22}));
     }
     continue;
    }
    const below=[...panel.querySelectorAll('.echo-mpr-caption,.echo-cine-playback')].filter(visible);
    const statusSlot=panel.querySelector('.echo-cine-status-slot'),loading=panel.querySelector('.echo-cine-loading');
    // The fixed slot stays in layout when its loading/playback contents hide.
    // Measuring the inner loader would shrink/grow both canvases on every
    // remote buffering event even though the actual reserved row is unchanged.
    const statusReserve=visible(statusSlot)?height(statusSlot)+8:visible(loading)?height(loading)+8:0;
    const reserve=Math.max(44,...below.map(node=>node.getBoundingClientRect().height))+statusReserve+20;
    setPixels(panel,'--echo-screen-height',availableWorkspaceHeight(viewportHeight,Math.max(...screens.map(documentTop)),{minimum:280,bottom:reserve}));
   }else{
    const workspace=panel.querySelector('.probe-workspace,.tee-workspace');
    if(!workspace)continue;
    // At tablet widths the reference torso/console follows the pair below it.
    const compact=panel.classList.contains('lab-compact');
    const target=!compact&&view.innerWidth<=1050?panel.querySelector('.probe-comparison'):workspace;
    // The compact workspace owns both the visual and its bounded steering dock.
    setPixels(panel,'--lab-workspace-height',availableWorkspaceHeight(viewportHeight,documentTop(target),{minimum:compact?230:380}));
   }
  }
 };
 const schedule=()=>{if(!queued&&!stopped)queued=view.requestAnimationFrame(update);};
 const resize=typeof view.ResizeObserver==='function'?new view.ResizeObserver(schedule):null;
 const observe=()=>{
  const selectors='.topbar,.dataset-browser,.workspace-tabs,.clinical-series-bar,'+
   '#echoPanel .echo-active-view,#echoPanel .echo-toolbar-content,#echoPanel .echo-scene-heading > *,#echoPanel .echo-cine > .echo-section-heading > *,#echoPanel .echo-mpr-caption,#echoPanel .echo-context-alert,#echoPanel .echo-cine-playback,#echoPanel .echo-cine-status-slot,#echoPanel .echo-cine-loading,#echoPanel .echo-cine-source-line,#echoPanel .echo-cine-angle-note,#echoPanel .echo-compact-navigation,#echoPanel .echo-compact-view-switch,.lab-compact-toolbar,.lab-compact-dock,'+
   '#probePanel .probe-primary-actions,#probePanel .probe-comparison-headings,#probePanel .probe-comparison-footers,#teePanel .probe-comparison-headings,#teePanel .probe-comparison-footers';
  for(const node of root.querySelectorAll(selectors)){
   if(node.matches('.echo-cine-loading')&&node.closest('.echo-cine-status-slot'))continue;
   if(!watched.has(node)){watched.add(node);resize?.observe(node);}
  }
  schedule();
 };
 const mutation=typeof view.MutationObserver==='function'?new view.MutationObserver(observe):null;
 for(const panel of panels){
  // Watch module creation and visibility, not every frame's status text.
  mutation?.observe(panel,{childList:true,attributes:true,attributeFilter:['hidden','class','data-echo-visible-pane','data-lab-view']});
 }
 const parent=panels[0].parentElement;
 if(parent)mutation?.observe(parent,{childList:true});
 view.addEventListener('resize',schedule);
 view.visualViewport?.addEventListener?.('resize',schedule);
 root.addEventListener('labcompactlayoutchange',observe);
 root.addEventListener('fullscreenchange',schedule);root.addEventListener('webkitfullscreenchange',schedule);
 root.fonts?.ready?.then(schedule);
 observe();
 return ()=>{stopped=true;if(queued)view.cancelAnimationFrame(queued);resize?.disconnect();mutation?.disconnect();view.removeEventListener('resize',schedule);view.visualViewport?.removeEventListener?.('resize',schedule);root.removeEventListener('labcompactlayoutchange',observe);root.removeEventListener('fullscreenchange',schedule);root.removeEventListener('webkitfullscreenchange',schedule);};
}

if(typeof document!=='undefined'&&typeof window!=='undefined')fitComparisonWorkspaces();
