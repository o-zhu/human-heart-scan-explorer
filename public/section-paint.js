import {sectionLayout} from './section-layout.js';
import {capColor,capAnatomyColor,buildAnatomyPalette,cutFaceExposure,exposeCutIntensity} from './render-styles.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const black=new Uint32Array(Uint8ClampedArray.of(0,0,0,255).buffer)[0];
const colorCache=[];

function projection(map,axis,position,layout,width,height){
 if(!map)return null;
 const dimensions=map.dimensions,strides=[1,dimensions[0],dimensions[0]*dimensions[1]],uAxis=axis===0?1:0,vAxis=axis===2?1:2;
 const columns=new Uint32Array(width),rows=new Uint32Array(height);
 for(let x=0;x<width;x++)columns[x]=Math.round(clamp((layout.x+x)*layout.stepU,0,1)*(dimensions[uAxis]-1))*strides[uAxis];
 for(let y=0;y<height;y++)rows[y]=Math.round(clamp((layout.y+y)*layout.stepV,0,1)*(dimensions[vAxis]-1))*strides[vAxis];
 return {columns,rows,base:Math.round(clamp(position,0,1)*(dimensions[axis]-1))*strides[axis],data:map.data};
}

function colorLookup(settings,anatomy,hasRegions){
 // LUTs depend on display settings and label colors, not the selected slice.
 // Keep a few recent palettes; never retain a per-slice RGBA collection.
 const labels=hasRegions?anatomy?.labels||[]:[],key=JSON.stringify([
  settings.palette,settings.windowEnabled,settings.windowLow,settings.windowHigh,settings.windowGamma,
  settings.capContrast,settings.cutFaceExposure,settings.threshold,settings.anatomySelected,settings.anatomyOpacity,
  hasRegions,labels.map(label=>[label.id,label.color]),hasRegions?anatomy?.palette:null
 ]);
 const at=colorCache.findIndex(entry=>entry.key===key);
 if(at>=0){const [entry]=colorCache.splice(at,1);colorCache.push(entry);return entry;}
 const colors=new Map();for(const label of labels)colors.set(label.id,[1,3,5].map(i=>parseInt(label.color.slice(i,i+2),16)));
 const windowColors=settings.windowEnabled===true?buildAnatomyPalette(anatomy?.palette||anatomy?.labels):null;
 const labelCount=Math.max(1,...colors.keys())+1,lut=new Uint8ClampedArray(labelCount*256*4),threshold=settings.threshold,selected=settings.anatomySelected||0,exposure=cutFaceExposure(settings);
 for(let id=0;id<labelCount;id++)for(let byte=0;byte<256;byte++){
  const value=byte/255;
  if(settings.windowEnabled===true||settings.palette===6){
   let color=byte&&!((settings.palette===4||settings.palette===6)&&value<threshold)?capColor(value,settings.capContrast??1,settings.palette,settings):[0,0,0];
   if(hasRegions&&value>threshold)color=capAnatomyColor(color,id,windowColors,settings.anatomyOpacity??.65,selected);
   const j=(id*256+byte)*4;for(let c=0;c<3;c++)lut[j+c]=Math.pow(Math.max(0,color[c]),.89)*255;lut[j+3]=255;continue;
  }
  let gray=clamp((value-.04)/.86,0,1)*255;
  if(settings.palette===4)gray=value<threshold?0:clamp((value-.38)*1.8+.55,.05,1)*255;
  if(exposure!==1)gray=exposeCutIntensity(gray/255,exposure)*255;
  let red=gray,green=gray,blue=gray;
  if(hasRegions&&gray>1&&value>threshold){
   const color=colors.get(id);
   if(color){const active=!selected||selected===id,alpha=(settings.anatomyOpacity??.65)*(active?1:.18),scale=.35+.65*gray/255,shade=active?1:.45;
    red=(gray*(1-alpha)+color[0]*scale*alpha)*shade;green=(gray*(1-alpha)+color[1]*scale*alpha)*shade;blue=(gray*(1-alpha)+color[2]*scale*alpha)*shade;
   }else if(selected){red*=.4;green*=.4;blue*=.4;}
  }
  const j=(id*256+byte)*4;lut[j]=red;lut[j+1]=green;lut[j+2]=blue;lut[j+3]=255;
 }
 const entry={key,labelCount,words:new Uint32Array(lut.buffer)};colorCache.push(entry);if(colorCache.length>8)colorCache.shift();return entry;
}

/** Exact native pixels; an optional aligned RGBA target avoids per-scroll allocations. */
export function paintSectionPixels(data,width,height,axis,position,section,settings,cleanup,anatomy,target=null){
 const layout=sectionLayout(section),clean=projection(settings.cleanupEnabled!==false?cleanup:null,axis,position,layout,width,height);
 const region=projection(settings.palette===5?anatomy:null,axis,position,layout,width,height);
 const {words:lut,labelCount}=colorLookup(settings,anatomy,!!region),length=width*height*4;
 const out=target instanceof Uint8ClampedArray&&target.length===length&&target.byteOffset%4===0?target:new Uint8ClampedArray(length);
 const pixels=new Uint32Array(out.buffer,out.byteOffset,out.length/4);
 // The LUT and output use the same native word order, so this is also correct
 // on a big-endian runtime. Opaque black overwrites reused targets outside support.
 if(!region&&!clean){for(let i=0;i<data.length;i++)pixels[i]=lut[data[i]];return out;}
 // A native image has several fine pixels per cleanup/label voxel. Form exact
 // spans at those projected voxel boundaries and reuse them for repeated rows.
 // This removes millions of redundant mask lookups without resampling the CT.
 const columns=[];
 for(let x=0;x<width;){
  const cleanColumn=clean?.columns[x]??0,regionColumn=region?.columns[x]??0;let end=x+1;
  while(end<width&&(!clean||clean.columns[end]===cleanColumn)&&(!region||region.columns[end]===regionColumn))end++;
  columns.push({end,cleanColumn,regionColumn});x=end;
 }
 const ends=new Uint32Array(columns.length),offsets=new Int32Array(columns.length);let count=0,lastClean=-1,lastRegion=-1;
 for(let y=0;y<height;y++){
  const row=y*width,cleanRow=clean?clean.base+clean.rows[y]:0,regionRow=region?region.base+region.rows[y]:0;
  if(cleanRow!==lastClean||regionRow!==lastRegion){
   count=0;
   for(const column of columns){
    const visible=!clean||clean.data[cleanRow+column.cleanColumn],label=region?region.data[regionRow+column.regionColumn]:0;
    const offset=visible?(label<labelCount?label:0)*256:-1;
    if(count&&offsets[count-1]===offset)ends[count-1]=column.end;
    else{ends[count]=column.end;offsets[count]=offset;count++;}
   }
   lastClean=cleanRow;lastRegion=regionRow;
  }
  let start=row;
  for(let run=0;run<count;run++){
   const end=row+ends[run],offset=offsets[run];
   if(offset<0)pixels.fill(black,start,end);
   else for(let i=start;i<end;i++)pixels[i]=lut[offset+data[i]];
   start=end;
  }
 }
 return out;
}
