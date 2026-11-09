/** Count actual renderer allocations while traversing the published crop sizes. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {VolumeRenderer} from '../public/renderer.js';
const root=new URL('../',import.meta.url);
const manifests=[
 ['ladaf-2021-17','public/assets/ultra-sections/manifest.json'],
 ['s-20-29','public/assets/donors/s-20-29/ultra-sections.json'],
 ['s-20-28','public/assets/donors/s-20-28/ultra-sections.json']
];
const results=[];
for(const [donor,path] of manifests){
 const manifest=JSON.parse(await readFile(new URL(path,root),'utf8'));
 for(const [axis,items] of Object.entries(manifest.slices))for(const direction of ['forward','reverse']){
  const slices=items.filter(item=>!item.empty).map(item=>({width:item.crop[2],height:item.crop[3]}));
  if(direction==='reverse')slices.reverse();
  let previous,exactAllocations=0,allocations=0,uploads=0,largestRasterBytes=0;
  const renderer=Object.assign(Object.create(VolumeRenderer.prototype),{requestRender(){},capTexture:{},gl:{
   activeTexture(){},bindTexture(){},pixelStorei(){},
   texImage2D(){allocations++;},texSubImage2D(){uploads++;}
  }});
  // The fixture records commands without allocating thousands of full images.
  // Every distinct source object still follows the real upload/size path.
  for(const shape of slices){
   if(!previous||previous.width!==shape.width||previous.height!==shape.height)exactAllocations++;
   renderer.setCapData({...shape,data:{}});renderer.uploadCapData();previous=shape;
   largestRasterBytes=Math.max(largestRasterBytes,shape.width*shape.height);
  }
  assert.equal(uploads,slices.length);assert.ok(allocations<exactAllocations/8);
  results.push({donor,axis,direction,nonemptySlices:slices.length,exactSizeAllocations:exactAllocations,reusableAllocations:allocations,
   reductionPercent:Number((100*(1-allocations/exactAllocations)).toFixed(2)),
   retainedCapacity:[renderer.capTextureWidth,renderer.capTextureHeight],retainedBytes:renderer.capTextureWidth*renderer.capTextureHeight,largestRasterBytes});
 }
}
const total=name=>results.reduce((sum,row)=>sum+row[name],0);
const report={scope:'Actual VolumeRenderer upload allocation commands for complete forward/reverse nonempty orthogonal manifest sequences. Fresh renderer per axis/direction; no network, browser, GPU timing, or FPS claim.',
 sourceSlices:total('nonemptySlices'),exactSizeAllocations:total('exactSizeAllocations'),reusableAllocations:total('reusableAllocations'),
 reductionPercent:Number((100*(1-total('reusableAllocations')/total('exactSizeAllocations'))).toFixed(2)),results};
const out=new URL('docs/renderer-latency-v15/',root);await mkdir(out,{recursive:true});
await writeFile(new URL('cap-storage-counts.json',out),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
