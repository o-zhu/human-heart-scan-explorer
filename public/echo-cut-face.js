/** A CT viewport crop is not the boundary of the physical 3D cut.
 * Fit a separate raster to the intersection of that same plane and the source
 * box. Neither the acquisition plane nor the CT image's own crop is changed.
 */
const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
const sub=(a,b)=>a.map((value,i)=>value-b[i]);
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);

export function fullEchoCutFacePlane(plane,extent,{paddingWorld=0}={}){
 if(!plane||!['center','right','up'].every(key=>vector(plane[key]))||
    !vector(extent)||!extent.every(value=>value>0)||
    ![plane.width,plane.height].every(value=>Number.isFinite(value)&&value>0))return plane;
 const [r,u]=[plane.right,plane.up];
 const normal=[r[1]*u[2]-r[2]*u[1],r[2]*u[0]-r[0]*u[2],r[0]*u[1]-r[1]*u[0]];
 const length=Math.hypot(...normal);if(length<1e-8)return plane;
 const n=normal.map(value=>value/length),distance=dot(n,plane.center),epsilon=1e-9;
 const corners=Array.from({length:8},(_,bits)=>extent.map((value,axis)=>((bits>>axis)&1? .5:-.5)*value));
 const points=[];
 for(let i=0;i<8;i++)for(let axis=0;axis<3;axis++){
  const j=i^(1<<axis);if(j<i)continue;
  const a=corners[i],b=corners[j],da=dot(n,a)-distance,db=dot(n,b)-distance;
  if(Math.abs(da)<=epsilon)points.push(a);
  if(Math.abs(db)<=epsilon)points.push(b);
  if(da*db<0){const t=da/(da-db);points.push(a.map((value,k)=>value+t*(b[k]-value)));}
 }
 if(!points.length)return plane;
 const uv=points.map(point=>{const delta=sub(point,plane.center);return [dot(delta,r),dot(delta,u)];});
 if(uv.every(([x,y])=>Math.abs(x)<=plane.width/2+epsilon&&Math.abs(y)<=plane.height/2+epsilon))return plane;
 const margin=Math.max(1e-7,Number.isFinite(paddingWorld)?paddingWorld:0);
 const min=[0,1].map(axis=>Math.min(...uv.map(p=>p[axis]))-margin);
 const max=[0,1].map(axis=>Math.max(...uv.map(p=>p[axis]))+margin);
 const mid=min.map((value,i)=>(value+max[i])/2);
 return {center:plane.center.map((value,i)=>value+r[i]*mid[0]+u[i]*mid[1]),
  right:[...r],up:[...u],...(vector(plane.normal)?{normal:[...plane.normal]}:{}),
  width:max[0]-min[0],height:max[1]-min[1]};
}

/** Reject incomplete, stale or relabelled fine pixels before either display. */
export function validateEchoFineSection(result,plane){
 if(result?.complete!==true||!(result.data instanceof Uint8Array)||
    !Number.isSafeInteger(result.width)||!Number.isSafeInteger(result.height)||
    result.width<2||result.height<2||result.width>8192||result.height>8192||
    result.data.length!==result.width*result.height||result.data.length>12*1024*1024||
    !Number.isFinite(result.sourceSpacingUm)||!Number.isFinite(result.spacingUm)||
    !(result.sourceSpacingUm>0)||!(result.spacingUm>0))throw new Error('The fine section is incomplete or exceeds its bounded raster size.');
 const returned=result.plane;
 if(!returned||['center','right','up'].some(axis=>!vector(returned[axis])||returned[axis].some((value,i)=>Math.abs(value-plane[axis][i])>1e-7))||
    ['width','height'].some(axis=>!Number.isFinite(returned[axis])||Math.abs(returned[axis]-plane[axis])>1e-7))throw new Error('The fine section belongs to a different plane or crop.');
 return result;
}
