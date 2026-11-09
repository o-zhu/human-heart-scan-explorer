import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TTE_ATLAS_VIEWS as views} from '../public/tte-atlas-data.js';
const json=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url)));
test('Every named acquisition has unique model art and its retained original',()=>{
 const p=json('docs/tte-atlas-v1/art-provenance.json');assert.equal(p.assets.length,28);assert.equal(new Set(p.assets.map(a=>a.sha256)).size,28);
 for(const v of views){
  const a=p.assets.find(a=>a.id===v.id);assert.ok(a);assert.equal(a.tool,'image_gen.imagegen');assert.deepEqual(a.dimensions,[640,640]);assert.equal(a.tableRow,v.tableRow);
  const webp=readFileSync(new URL('../'+a.asset,import.meta.url)),png=readFileSync(new URL('../'+a.master,import.meta.url));
  assert.equal(webp.toString('ascii',8,12),'WEBP');assert.equal(createHash('sha256').update(webp).digest('hex'),a.sha256);
  assert.equal(createHash('sha256').update(png).digest('hex'),a.originalSha256);assert.ok(a.originalDimensions.every(n=>n>=1024));
 }
});
test('All 30 guideline acquisitions have independently attributed cine and real sonographic fallback',()=>{
 const catalog=json('public/assets/tte-atlas/media.json');assert.equal(catalog.clips.length,60);assert.equal(new Set(catalog.clips.map(c=>c.id)).size,60);
 const videos=catalog.clips.filter(c=>c.kind==='youtube');assert.equal(videos.length,30);
 assert.deepEqual(videos.map(c=>Number(c.supplementalVideo)).sort((a,b)=>a-b),Array.from({length:30},(_,i)=>39+i));
 for(const v of views){
  const clips=catalog.clips.filter(c=>c.preset===v.id);assert.deepEqual(clips.filter(c=>c.kind==='youtube').map(c=>Number(c.supplementalVideo)),v.videoNumbers);
  for(const c of clips){
   assert.equal(c.mode,'tte');assert.equal(c.tableRow,v.tableRow);assert.equal(c.aseNumber,undefined);assert.equal(c.correspondence.sourceLabelVerified,true);assert.equal(c.correspondence.ctRegistered,false);
   if(c.kind==='youtube'){assert.equal(new URL(c.url).hostname,'www.youtube-nocookie.com');assert.equal(c.verification.oEmbedVerified,true);assert.equal(c.verification.playbackVerified,false);}
   else{assert.equal(c.kind,'image');assert.equal(new URL(c.url).hostname,'i.ytimg.com');assert.equal(c.verification.decodedImage,true);assert.equal(c.verification.visuallyInspected,true);assert.equal(c.verification.httpStatus,200);assert.equal(c.width,480);assert.equal(c.height,360);}
  }
 }
});
