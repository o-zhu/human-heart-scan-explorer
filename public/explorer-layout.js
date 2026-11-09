/** Fit the compact reconstruction to the space below the actual header. */
export function reconstructionHeight(viewportHeight, documentTop, {fullscreen=false}={}){
 const height=Number.isFinite(viewportHeight)&&viewportHeight>0?viewportHeight:800;
 const top=Number.isFinite(documentTop)?Math.max(0,documentTop):244;
 return Math.max(420,Math.floor(height-(fullscreen?28:top+16)));
}

export function fitExplorerWorkspace(root=document,view=window){
 const workspace=root.getElementById('reconstructionWorkspace');
 if(!workspace)return ()=>{};
 let queued=0,stopped=false;
 const watched=new Set();
 const update=()=>{
  queued=0;if(stopped||workspace.closest('[hidden]'))return;
  const fullscreen=(root.fullscreenElement||root.webkitFullscreenElement)===workspace;
  const top=workspace.getBoundingClientRect().top+(view.scrollY||0);
  // Changing only height avoids changing the observed header elements.
  const next=reconstructionHeight(view.innerHeight,top,{fullscreen})+'px';
  if(workspace.style.getPropertyValue('--reconstruction-height')!==next)workspace.style.setProperty('--reconstruction-height',next);
 };
 const schedule=()=>{if(!queued&&!stopped)queued=view.requestAnimationFrame(update);};
 const resize=typeof view.ResizeObserver==='function'?new view.ResizeObserver(schedule):null;
 const observe=()=>{
  for(const node of root.querySelectorAll('.topbar,.dataset-browser,.workspace-tabs,.clinical-series-bar')){
   if(!watched.has(node)){watched.add(node);resize?.observe(node);}
  }
  schedule();
 };
 const mutation=typeof view.MutationObserver==='function'?new view.MutationObserver(observe):null;
 const panel=root.getElementById('reconstructionPanel');
 if(panel){
  mutation?.observe(panel,{attributes:true,attributeFilter:['hidden']});
  // Clinical series controls are inserted before the panel, not inside it.
  if(panel.parentElement)mutation?.observe(panel.parentElement,{childList:true});
 }
 view.addEventListener('resize',schedule);
 root.addEventListener('fullscreenchange',schedule);root.addEventListener('webkitfullscreenchange',schedule);
 observe();
 return ()=>{stopped=true;if(queued)view.cancelAnimationFrame(queued);resize?.disconnect();mutation?.disconnect();view.removeEventListener('resize',schedule);root.removeEventListener('fullscreenchange',schedule);root.removeEventListener('webkitfullscreenchange',schedule);};
}

if(typeof document!=='undefined'&&typeof window!=='undefined')fitExplorerWorkspace();
