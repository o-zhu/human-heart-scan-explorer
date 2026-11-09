/** Package selected built-in image-model results without changing their art.
 * Usage: node scripts/tte-atlas-v1/import-art.mjs <manifest.json> [...] */
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TTE_ATLAS_VIEWS as views} from '../../public/tte-atlas-data.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const records=process.argv.slice(2).flatMap(path=>{const x=JSON.parse(readFileSync(path));return Array.isArray(x)?x:x.assets;});
if(records.length!==views.length||new Set(records.map(r=>r.id)).size!==views.length)throw new Error('Supply exactly one selected generation for each of the 28 views.');
const art='public/assets/tte-atlas/art-v1',masters='docs/tte-atlas-v1/art-masters',revisions='docs/tte-atlas-v1/art-revisions';
for(const path of [art,masters,revisions])mkdirSync(path,{recursive:true});
const assets=views.map(v=>{
 const r=records.find(r=>r.id===v.id);if(!r||r.tool!=='image_gen.imagegen'||!r.prompt)throw new Error('Missing built-in image generation provenance: '+v.id);
 const png=readFileSync(r.source),webp=readFileSync(r.webp);
 if(png.toString('hex',0,8)!=='89504e470d0a1a0a'||webp.toString('ascii',8,12)!=='WEBP')throw new Error('Unexpected image format: '+v.id);
 const originalDimensions=[png.readUInt32BE(16),png.readUInt32BE(20)],master=`${masters}/${v.id}.png`,asset=`${art}/${v.id}.webp`;
 copyFileSync(r.source,master);copyFileSync(r.webp,asset);
 let revision;
 if(r.supersededVariant){
  const old=r.supersededVariant,oldPng=`${revisions}/${v.id}-initial.png`,oldWebp=`${revisions}/${v.id}-initial.webp`;
  copyFileSync(old.source,oldPng);copyFileSync(old.webp,oldWebp);
  revision={reason:r.revisionReason,referenceImage:oldWebp,initialMaster:oldPng,initialPrompt:old.prompt,initialMasterSha256:hash(readFileSync(old.source))};
 }
 return {id:v.id,tableRow:v.tableRow,tool:r.tool,role:r.role,prompt:r.prompt,promptSha256:hash(r.prompt),master,originalDimensions,originalSha256:hash(png),asset,dimensions:r.dimensions,bytes:webp.length,sha256:hash(webp),...(revision?{revision}:{})};
});
const provenance={version:1,date:'2026-11-07',generator:'ChatGPT Image via image_gen.imagegen',purpose:'Conceptual navigation artwork. Precise acquisition guidance is supplied independently from ASE Table 2; these images are not diagnostic ultrasound or acquired donor anatomy.',packaging:'Selected original PNGs retained without edits. WebPs use 640px dimensions, Lanczos resampling and quality 90 encoding; no local artistic alteration.',assets};
writeFileSync('docs/tte-atlas-v1/art-provenance.json',JSON.stringify(provenance,null,2)+'\n');
writeFileSync(`${art}/manifest.json`,JSON.stringify({version:1,generator:provenance.generator,purpose:provenance.purpose,assets:assets.map(({id,tableRow,tool,asset,dimensions,bytes,sha256,promptSha256})=>({id,tableRow,tool,asset,dimensions,bytes,sha256,promptSha256}))},null,2)+'\n');
console.log(JSON.stringify({icons:assets.length,webpBytes:assets.reduce((n,a)=>n+a.bytes,0),mastersRetained:true}));
