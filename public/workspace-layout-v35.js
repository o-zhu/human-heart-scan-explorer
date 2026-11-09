/** Fit only Echo/TTE/TEE to the space below the actual page header. */
export function availableWorkspaceHeight(viewportHeight, documentTop, {minimum=380,bottom=12}={}){
 const height=Number.isFinite(viewportHeight)&&viewportHeight>0?viewportHeight:800;
 const top=Number.isFinite(documentTop)?Math.max(0,documentTop):240;
 return Math.max(minimum,Math.floor(height-top-bottom));
}

export function fitComparisonWorkspaces(root=document,view=window){
 const panels=['echoPanel','probePanel','teePanel'].map(id=>root.getElementById(id)).filter(Boolean);
 if(!panels.length)return ()=>{};
 const watched=new Set();let queued=0,stopped=false;
 const visible=node=>node&&!node.closest('[hidden]');
 const setPixels=(node,key,value)=>{
  const next=`${Math.ceil(value)}px`;
  if(node.style.getPropertyValue(key)!==next)node.style.setProperty(key,next);
 };
 const update=()=>{
  queued=0;if(stopped)return;
  const full=root.fullscreenElement||root.webkitFullscreenElement;
  for(const panel of panels){
   if(!visible(panel))continue;
   const inFullscreen=full&&(full===panel||full.contains(panel));
   // Use document coordinates so scrolling the page cannot grow the canvases.
   const documentTop=node=>node.getBoundingClientRect().top+(inFullscreen?0:(view.scrollY||0));
   if(panel.id==='echoPanel'){
    const toolbars=[...panel.querySelectorAll('.echo-toolbar-content')];
    if(!toolbars.length)continue;
    setPixels(panel,'--echo-toolbar-height',Math.max(48,...toolbars.map(node=>node.getBoundingClientRect().height)));
    const headings=[...panel.querySelectorAll('.echo-scene-heading > *, .echo-cine > .echo-section-heading > *')];
    setPixels(panel,'--echo-pane-heading-height',Math.max(28,...headings.map(node=>node.getBoundingClientRect().height)));
    setPixels(panel,'--workspace-available-height',availableWorkspaceHeight(view.innerHeight,documentTop(panel)));
    if(view.innerWidth<=900){panel.style.removeProperty('--echo-screen-height');continue;}
    const screens=[...panel.querySelectorAll('.echo-comparison-screen')];
    if(screens.length!==2)continue;
    const below=[...panel.querySelectorAll('.echo-mpr-caption,.echo-cine-playback')];
    const loading=panel.querySelector('.echo-cine-loading');
    const reserve=Math.max(44,...below.map(node=>node.getBoundingClientRect().height))+(visible(loading)?loading.getBoundingClientRect().height+8:0)+20;
    setPixels(panel,'--echo-screen-height',availableWorkspaceHeight(view.innerHeight,Math.max(...screens.map(documentTop)),{minimum:280,bottom:reserve}));
   }else{
    const workspace=panel.querySelector('.probe-workspace,.tee-workspace');
    if(!workspace)continue;
    // At tablet widths the reference torso/console follows the pair below it.
    const target=view.innerWidth<=1050?panel.querySelector('.probe-comparison'):workspace;
    setPixels(panel,'--lab-workspace-height',availableWorkspaceHeight(view.innerHeight,documentTop(target),{minimum:380}));
   }
  }
 };
 const schedule=()=>{if(!queued&&!stopped)queued=view.requestAnimationFrame(update);};
 const resize=typeof view.ResizeObserver==='function'?new view.ResizeObserver(schedule):null;
 const observe=()=>{
  const selectors='.topbar,.dataset-browser,.workspace-tabs,.clinical-series-bar,'+
   '#echoPanel .echo-active-view,#echoPanel .echo-toolbar-content,#echoPanel .echo-scene-heading > *,#echoPanel .echo-cine > .echo-section-heading > *,#echoPanel .echo-mpr-caption,#echoPanel .echo-cine-playback,#echoPanel .echo-cine-loading,'+
   '#probePanel .probe-primary-actions,#probePanel .probe-comparison-headings,#probePanel .probe-comparison-footers,#teePanel .probe-comparison-headings,#teePanel .probe-comparison-footers';
  for(const node of root.querySelectorAll(selectors)){if(!watched.has(node)){watched.add(node);resize?.observe(node);}}
  schedule();
 };
 const mutation=typeof view.MutationObserver==='function'?new view.MutationObserver(observe):null;
 for(const panel of panels){
  // Watch module creation and visibility, not every frame's status text.
  mutation?.observe(panel,{childList:true,attributes:true,attributeFilter:['hidden','class']});
 }
 const parent=panels[0].parentElement;
 if(parent)mutation?.observe(parent,{childList:true});
 view.addEventListener('resize',schedule);
 root.addEventListener('fullscreenchange',schedule);root.addEventListener('webkitfullscreenchange',schedule);
 root.fonts?.ready?.then(schedule);
 observe();
 return ()=>{stopped=true;if(queued)view.cancelAnimationFrame(queued);resize?.disconnect();mutation?.disconnect();view.removeEventListener('resize',schedule);root.removeEventListener('fullscreenchange',schedule);root.removeEventListener('webkitfullscreenchange',schedule);};
}

if(typeof document!=='undefined'&&typeof window!=='undefined')fitComparisonWorkspaces();
