/** Source-checkout benchmark: node scripts/benchmark-section-paint-v15.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {paintSectionPixels} from '../public/section-paint.js';
import {DONORS} from '../public/donors.js';

const root=fileURLToPath(new URL('../',import.meta.url)),baselineCommit='b77382f7c400b29c82651d75b32e85c6e6bfbefe';
const read=p=>fs.readFileSync(path.join(root,p)),json=p=>JSON.parse(read(p)),sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const publicPath=url=>'public/'+url.split('?')[0].replace(/^\.\//,'');
const code=execFileSync('git',['show',baselineCommit+':public/section-paint.js'],{cwd:root,encoding:'utf8'}).replace(/from '\.\/([^']+)'/g,(_,name)=>`from '${pathToFileURL(path.join(root,'public',name))}'`);
const {paintSectionPixels:before}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const mask=url=>{const meta=json(publicPath(url));return {...meta,data:new Uint8Array(zlib.gunzipSync(read(publicPath(meta.volumeUrl))))};};
const anatomy=mask(DONORS[0].anatomyManifestUrl);
anatomy.palette=anatomy.labels.map(label=>({id:label.id,color:[1,3,5].map(i=>parseInt(label.color.slice(i,i+2),16)/255)}));
const indices=[331,255,282],results=[];
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {medianMs:sorted[Math.floor(sorted.length/2)],minMs:sorted[0],maxMs:sorted.at(-1),samplesMs:values};};

for(let n=0;n<DONORS.length;n++){
 const donor=DONORS[n],manifest=json(publicPath(donor.ultraManifestUrl)),display=json(publicPath(donor.manifestUrl)),index=indices[n],entry=manifest.slices.y[index];
 const source=n?'data/donors/'+donor.id+'/ultra-sections/'+entry.path:'data/ultra-sections/'+entry.path;
 const encoded=read(source);assert.equal(sha256(encoded),entry.sha256);
 const data=new Uint8Array(execFileSync('python3',['-c','from PIL import Image\nimport sys\nsys.stdout.buffer.write(Image.open(sys.argv[1]).convert("L").tobytes())',path.join(root,source)],{maxBuffer:32*1024*1024}));
 assert.equal(sha256(data),entry.sourceDisplaySha256);
 const section={crop:entry.crop,width:entry.crop[2],height:entry.crop[3],fullWidth:manifest.imageDimensionsXYZ[0],fullHeight:manifest.imageDimensionsXYZ[2]};
 assert.equal(data.length,section.width*section.height);
 const cleanup=mask(donor.cleanupManifestUrl),position=index/(manifest.sliceCounts[1]-1);
 for(const palette of n?[4]:[4,5]){
  const settings={...donor.displayWindow,palette,threshold:display.defaultThreshold,cleanupEnabled:true,anatomySelected:palette===5?2:0,anatomyOpacity:.65};
  const regions=n?null:anatomy,target=new Uint8ClampedArray(data.length*4),args=[data,section.width,section.height,1,position,section,settings,cleanup,regions];
  const expected=before(...args),actual=paintSectionPixels(...args,target);assert.deepEqual(actual,expected);
  for(let i=0;i<5;i++){before(...args);paintSectionPixels(...args,target);}
  const a=[],b=[];
  for(let i=0;i<11;i++)for(const optimized of i%2?[true,false]:[false,true]){
   const started=performance.now();if(optimized)paintSectionPixels(...args,target);else before(...args);
   (optimized?b:a).push(performance.now()-started);
  }
  assert.deepEqual(target,expected);const baseline=stats(a),candidate=stats(b);
  results.push({donor:donor.id,source,axis:'y',index,position,section,pixels:data.length,settings,sourceSha256:entry.sha256,pixelSha256:entry.sourceDisplaySha256,rgbaSha256:sha256(actual),byteExact:true,baseline,candidate,medianSpeedup:baseline.medianMs/candidate.medianMs});
 }
}
const report={baselineCommit,scope:'Native Node CPU painting only; same acquired display bytes, masks and window settings. Excludes image decode, Canvas uploads, WebGL, network and browser input latency.',runtime:{node:process.version,platform:process.platform,architecture:process.arch,cpu:os.cpus()[0].model},warmupCallsPerVersion:5,measuredCallsPerVersion:11,allByteExact:true,results};
const out=path.join(root,'docs/section-paint-v15');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'benchmark.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({donor:r.donor,palette:r.settings.palette,pixels:r.pixels,beforeMs:r.baseline.medianMs,afterMs:r.candidate.medianMs,speedup:r.medianSpeedup,byteExact:r.byteExact})),null,2));
