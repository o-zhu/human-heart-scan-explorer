/** Presentation-only priority for illustrative anatomy. The accepted heart/cap
 * already writes depth < 1; empty rays retain 1. Mapping context to that clear
 * depth suppresses both foreground haze and rear anatomy over tissue, without
 * changing any mesh, source coordinate, clipping plane or depth allocation.
 * Instrument geometry keeps the ordinary perspective depth outside this scope.
 */
export function withHeartPriority(gl,draw){
 gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthRange(1,1);gl.depthMask(false);
 try{return draw();}
 finally{gl.depthRange(0,1);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);}
}

/** CSS-pixel sizes: a high-DPI screen must not make annotation text smaller.
 * A small touch pane gets fewer callouts, not unreadably tiny type. */
export function contextLabelMetrics(width,height,{coarsePointer=globalThis.matchMedia?.('(pointer: coarse)')?.matches===true}={}){
 const short=Math.max(1,Math.min(Number(width)||1,Number(height)||1));
 const fontSize=Math.round(Math.max(coarsePointer?14:12,Math.min(15,11+short/180))*2)/2;
 return {fontSize,paddingX:5,paddingY:3,height:Math.ceil(fontSize+6),gap:8,leaderGap:18,
  maxPriority:width<450||height<330?2:Infinity,
  font:`${fontSize}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`};
}

/** Shared collision-aware placement for the GPU and software annotation paths. */
export function placeContextLabel(point,box,width,height,used,metrics){
 const {gap,leaderGap}=metrics,pad=10;
 if(!point||point.x<pad||point.x>width-pad||point.y<18||point.y>height-24||box.width>width-2*pad)return null;
 const preferRight=point.x<width*.5;
 for(const right of [preferRight,!preferRight])for(const shift of [-box.height-9,10,-2*box.height-17]){
  const x=Math.max(pad,Math.min(width-box.width-pad,point.x+(right?leaderGap:-box.width-leaderGap)));
  const y=Math.max(pad,Math.min(height-box.height-42,point.y+shift));
  if(used.some(q=>x<q.x+q.width+gap&&x+box.width+gap>q.x&&y<q.y+q.height+gap&&y+box.height+gap>q.y))continue;
  const placed={x,y,width:box.width,height:box.height,right};used.push(placed);return placed;
 }
 return null;
}
