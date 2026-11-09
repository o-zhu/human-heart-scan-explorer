/**
 * Immediate, registered sections from the volume already resident in memory.
 *
 * This is a display-resolution preview, not an Ultra image. Sampling uses the
 * requested plane in the original volume coordinates; no old section is moved
 * onto a new plane. The caller applies the usual shared CT color/window transfer.
 */
export class ResidentSectionSource {
 constructor({maxBytes=4*1024*1024,perAxis=2}={}){
  this.maxBytes=Math.max(0,Number.isFinite(maxBytes)?maxBytes:4*1024*1024);
  this.perAxis=Math.max(0,Math.floor(Number.isFinite(perAxis)?perAxis:2));
  this.cache=new Map();this.cacheBytes=0;this.generation=0;
 }
 setVolume(data,meta){
  if(data===this.data&&meta===this.meta)return;
  if(data!=null){
   const dimensions=meta?.dimensions;
   if(!(data instanceof Uint8Array)||!Array.isArray(dimensions)||dimensions.length!==3||
     dimensions.some(n=>!Number.isInteger(n)||n<1)||data.length!==dimensions.reduce((a,b)=>a*b,1)){
    throw new TypeError('Resident sections require the complete declared Uint8 scan volume.');
   }
  }
  this.data=data??null;this.meta=data?meta:null;this.generation++;
  this.cache.clear();this.cacheBytes=0;
 }
 get(axis,position,index){
  if(!this.data||!this.meta)return null;
  if(!Number.isInteger(axis)||axis<0||axis>2||!Number.isFinite(position))throw new RangeError('Invalid resident section plane.');
  const p=Math.max(0,Math.min(1,position)),dimensions=this.meta.dimensions;
  const sectionIndex=index??Math.round(p*(dimensions[axis]-1));
  if(!Number.isInteger(sectionIndex)||sectionIndex<0)throw new RangeError('Invalid resident section index.');
  const key=`resident:${this.generation}:${axis}:${p}:${sectionIndex}`;
  const cached=this.cache.get(key);
  if(cached){this.cache.delete(key);this.cache.set(key,cached);return cached;}
  const [nx,ny,nz]=dimensions,width=axis===0?ny:nx,height=axis===2?ny:nz;
  const data=new Uint8Array(width*height),plane=nx*ny,source=this.data;
  let coordinate=p*(dimensions[axis]-1);
  // Arithmetic such as (i / (n - 1)) * (n - 1) can miss an integer by an
  // insignificant floating-point remainder. Preserve the exact source plane.
  const integer=Math.round(coordinate);if(Math.abs(coordinate-integer)<1e-10)coordinate=integer;
  const lower=Math.floor(coordinate),upper=Math.min(dimensions[axis]-1,lower+1),fraction=coordinate-lower;
  if(axis===2){
   const start=lower*plane,other=upper*plane;
   if(!fraction||lower===upper)data.set(source.subarray(start,start+plane));
   else for(let i=0;i<data.length;i++)data[i]=Math.round(source[start+i]+fraction*(source[other+i]-source[start+i]));
  }else if(axis===1){
   for(let z=0;z<nz;z++){
    const start=z*plane+lower*nx,other=z*plane+upper*nx,row=z*nx;
    if(!fraction||lower===upper)data.set(source.subarray(start,start+nx),row);
    else for(let x=0;x<nx;x++)data[row+x]=Math.round(source[start+x]+fraction*(source[other+x]-source[start+x]));
   }
  }else{
   if(!fraction||lower===upper){
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)data[z*ny+y]=source[z*plane+y*nx+lower];
   }else{
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){
     const start=z*plane+y*nx;
     data[z*ny+y]=Math.round(source[start+lower]+fraction*(source[start+upper]-source[start+lower]));
    }
   }
  }
  const spacing=Array.isArray(this.meta.spacingUm)?this.meta.spacingUm:[this.meta.spacingUm,this.meta.spacingUm,this.meta.spacingUm];
  const inPlaneSpacingUm=[spacing[axis===0?1:0],spacing[axis===2?1:2]];
  const result={key,axis,index:sectionIndex,position:p,data,width,height,
   fullWidth:width,fullHeight:height,crop:[0,0,width,height],
   spacingUm:Math.max(...inPlaneSpacingUm),inPlaneSpacingUm,normalSpacingUm:spacing[axis],
   resident:true,preview:true,cleaned:false,
   source:'Resident measured scan volume',sampling:'Native in-plane pixels; linear interpolation along the section axis'};
  // Published arrays are immutable by convention. Recycling a buffer still
  // referenced by a queued GPU upload or a CT card would corrupt that frame.
  // Reuse exact cached sections instead, retaining at most two per axis.
  if(this.perAxis&&data.byteLength<=this.maxBytes){
   this.cache.set(key,result);this.cacheBytes+=data.byteLength;
   let axisCount=0;for(const item of this.cache.values())if(item.axis===axis)axisCount++;
   for(const [oldKey,item] of this.cache){
    if(axisCount<=this.perAxis)break;
    if(item.axis===axis){this.cache.delete(oldKey);this.cacheBytes-=item.data.byteLength;axisCount--;}
   }
   while(this.cacheBytes>this.maxBytes){
    const first=this.cache.keys().next().value,item=this.cache.get(first);
    this.cache.delete(first);this.cacheBytes-=item.data.byteLength;
   }
  }
  return result;
 }
 dispose(){this.setVolume(null,null);}
}
