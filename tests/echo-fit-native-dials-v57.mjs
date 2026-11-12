/** Source-pixel bounds from v56, checked against current Fit geometry.
 * This is an analytical crop guard, not a new visual or clinical review. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {referenceAngleLayout,supplementalTeeAngle} from '../public/echo-reference-player.js';
import {TEE_ATLAS_VIEWS} from '../public/tee-atlas-data.js';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const clips=read('../public/assets/tee-atlas/media.json').clips;
const reviews=read('../docs/tee-video-qc-v56/source-review.json').sources;

test('Fit Ultrasound retains every reviewed native TEE dial within the visible crop',()=>{
 const native=reviews.filter(source=>source.uiPolicy.kind==='retain-native');
 assert.equal(native.length,26);
 for(const source of native){
  const clip=clips.find(clip=>clip.id===source.clipId);
  assert.equal(clip.url,source.sourceUrl,`${source.clipId}: review belongs to this source`);
  assert.equal(clip.bytes,source.bytes,`${source.clipId}: source size remains reviewed`);
  assert.equal(supplementalTeeAngle(TEE_ATLAS_VIEWS.find(view=>view.id===clip.preset),clip),null,'No duplicate dial on a native source');
  const [left,top,right,bottom]=source.nativeDisplay.bboxNormalizedLTRB;
  for(const [width,height] of [[320,260],[640,480],[1200,380]]){
   const layout=referenceAngleLayout({width,height,sourceWidth:source.encoding.displayWidthExact,sourceHeight:source.encoding.displayHeight,focusAspect:clip.focusAspect,fullFrame:false});
   assert.ok(layout,`${source.clipId}: valid Fit geometry at ${width}×${height}`);
   const {frame,crop}=layout;
   const actual=[frame.left+left*frame.width,frame.top+top*frame.height,frame.left+right*frame.width,frame.top+bottom*frame.height];
   assert.ok(actual[0]>=crop.left&&actual[1]>=crop.top&&actual[2]<=crop.left+crop.width&&actual[3]<=crop.top+crop.height,`${source.clipId}: native display stays inside Fit at ${width}×${height}`);
  }
 }
});
