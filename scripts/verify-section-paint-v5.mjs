import fs from 'node:fs';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {paintSectionPixels} from '../public/section-paint.js';
import {sectionLayout} from '../public/section-layout.js';
const root=new URL('../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const old=execFileSync('git',['show','80da2af755769720d666d4d611de78bc93624fc4:public/appearance.js'],{encoding:'utf8'}).replace(/^import .*;$/gm,'').replaceAll('export ','');
// Compile the retained baseline into the same realm for a fair V8 timing comparison.
const Old=new Function('sectionLayout','document',old+'\n;return AppearanceController;')(sectionLayout,{});
const am=json('public/assets/anatomy/manifest.json'),cm=json('public/assets/cleanup/manifest.json');
const anatomy={...am,labels:am.labels,data:new Uint8Array(zlib.gunzipSync(read('public/assets/anatomy/labels.raw.gz')))};
const cleanup={dimensions:cm.dimensions,data:new Uint8Array(zlib.gunzipSync(read('public/'+cm.volumeUrl)))};
const manifest=json('public/assets/ultra-sections/manifest.json'),entry=manifest.slices.x[237];
const data=new Uint8Array(fs.readFileSync('/workspace/data/root-v5/x237.raw'));
const width=1141,height=1841,section={width,height,fullWidth:1897,fullHeight:2117,crop:[458,66,width,height]};
const colors=new Map(am.labels.map(l=>[l.id,[1,3,5].map(i=>parseInt(l.color.slice(i,i+2),16))]));
const results=[];
for(const axis of [0,1,2])for(const palette of [3,4,5]){
 const s={palette,cleanupEnabled:true,threshold:.32,anatomySelected:palette===5?2:0,anatomyOpacity:.65};let output;
 const context={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:image=>output=image.data};
 const canvas={getContext:()=>context};const controller={renderer:{settings:s},cleanup,anatomy,colors,sample:Old.prototype.sample};
 const begin=performance.now();Old.prototype.paintSection.call(controller,canvas,data,width,height,axis,.5,section);const oldMs=performance.now()-begin;
 const next=performance.now();const candidate=paintSectionPixels(data,width,height,axis,.5,section,s,cleanup,anatomy);const newMs=performance.now()-next;
 let mismatches=0,max=0;for(let i=0;i<output.length;i++)if(output[i]!==candidate[i]){mismatches++;max=Math.max(max,Math.abs(output[i]-candidate[i]));}
 if(mismatches)throw new Error(`Section color regression axis${axis} palette${palette}: ${mismatches} channels, max${max}`);
 results.push({axis,palette,pixels:width*height,oldMilliseconds:oldMs,newMilliseconds:newMs,speedup:oldMs/newMs,identical:true});
}
const result={source:'Actual2.1MP X237 texture; test orientations exercise all coordinate-index mappings against previous renderer',cases:results,allIdentical:true};
fs.writeFileSync(new URL('docs/section-paint-benchmark-v5.json',root),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({allIdentical:true,cases:results.length,medianSpeedup:results.map(r=>r.speedup).sort((a,b)=>a-b)[4],newMilliseconds:results.map(r=>Math.round(r.newMilliseconds))}));
