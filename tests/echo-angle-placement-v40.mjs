import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {referenceAngleLayout,createReferenceAnglePlacement,supplementalTeeAngle,referenceAngleMarkup} from '../public/echo-reference-player.js';
import {TEE_ATLAS_VIEWS} from '../public/tee-atlas-data.js';
import {reviewedTeeAngleSource,TEE_MULTIPLANE_SOURCE_REVIEWS} from '../public/tee-reference-angle-policy.js';

const source={sourceWidth:1280,sourceHeight:720,focusAspect:1.4};
const near=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} ≠ ${expected}`);
const nearRect=(actual,expected)=>Object.entries(expected).forEach(([key,value])=>near(actual[key],value));
const catalogs=['tee-atlas/media.json','echo-media-v6.json'].flatMap(path=>JSON.parse(readFileSync(new URL(`../public/assets/${path}`,import.meta.url))).clips.filter(clip=>clip.mode==='tee'));
const supplementalIds=new Set(['ase-2013-tee-01','ase-2013-tee-12','tee-me4c','tee-melax','tee-me2c','tee-bicaval','tee-tgpapillary']);

test('scanner dial stays with the ultrasound content, including source padding and player letterboxing',()=>{
 const native=referenceAngleLayout({...source,width:1280,height:720});
 nearRect(native.crop,{left:136,top:0,width:1008,height:720});
 near(native.left,307.36);near(native.top,86.4);
 const square=referenceAngleLayout({...source,width:600,height:600});
 nearRect(square.frame,{left:0,top:131.25,width:600,height:337.5});
 nearRect(square.crop,{left:63.75,top:131.25,width:472.5,height:337.5});
 near(square.left,144.075);near(square.top,171.75);
 assert.ok(square.top>square.frame.top,'The readout belongs inside the video, not in the top black letterbox.');
});

test('Full Frame and Fit Ultrasound keep the same placement relative to the central image crop',()=>{
 for(const [width,height] of [[814,691],[600,600],[360,640],[1200,380],[240,260]]){
  for(const fullFrame of [true,false]){
   const layout=referenceAngleLayout({...source,width,height,fullFrame});
   near((layout.left-layout.crop.left)/layout.crop.width,.17);
   near((layout.top-layout.crop.top)/layout.crop.height,.12);
   assert.ok(layout.left+layout.width<layout.crop.left+layout.crop.width*.5,'The dial stays left of the sector apex, even in a tiny pane.');
   assert.ok(layout.top+layout.width*104/128<=layout.crop.top+layout.crop.height);
   assert.ok(layout.width<=160);
  }
 }
});

test('both framing modes leave the scanner settings column and central sector apex uncovered',()=>{
 for(const [width,height] of [[1280,720],[814,691],[600,600],[360,640],[240,260]])for(const fullFrame of [true,false]){
  const layout=referenceAngleLayout({...source,width,height,fullFrame});
  const x=(layout.left-layout.crop.left)/layout.crop.width,y=(layout.top-layout.crop.top)/layout.crop.height;
  assert.ok(x>=.16,'The dial must clear the FR/depth/2D column in the modified-bicaval source.');
  assert.ok(y>=.11,'Use the native readout row below the top scanner header.');
  assert.ok(x+layout.width/layout.crop.width<=.451,'Even the minimum-size dial must stop short of the central sector apex.');
 }
});

test('unavailable source dimensions wait for metadata rather than placing an arbitrary corner overlay',()=>{
 assert.equal(referenceAngleLayout({...source,width:0,height:600}),null);
 assert.equal(referenceAngleLayout({...source,width:600,height:600,sourceWidth:0}),null);
 assert.equal(referenceAngleLayout({...source,width:600,height:NaN}),null);
 const noCrop=referenceAngleLayout({...source,width:600,height:600,focusAspect:NaN});
 assert.deepEqual(noCrop.crop,noCrop.frame);
});

test('all 33 reviewed sources retain native readouts or receive one of exactly seven labelled supplements',()=>{
 assert.equal(catalogs.length,33);assert.equal(new Set(catalogs.map(clip=>clip.id)).size,33);
 assert.equal(TEE_MULTIPLANE_SOURCE_REVIEWS.length,33);
 const found=[];let native=0;
 for(const clip of catalogs){
  const view=TEE_ATLAS_VIEWS.find(view=>view.id===clip.preset),review=reviewedTeeAngleSource(clip),dial=supplementalTeeAngle(view,clip);
  assert.ok(review,`${clip.id}: catalog source has an exact pixel-review record`);
  if(!supplementalIds.has(clip.id)){
   native++;assert.equal(review.kind,'native');assert.equal(dial,null,`${clip.id}: do not duplicate a baked-in readout`);continue;
  }
  found.push(clip.id);assert.equal(review.kind,'reference');assert.ok(dial,clip.id);
  const [min,max]=view.angleRange,range=`${min===max?min:`${min}–${max}`}°`,angle=(min+max)/2;
  assert.equal(dial.label,`${angle}°`);assert.equal(dial.angle,angle);
  assert.match(dial.explanation,/Reference angle:/);assert.ok(dial.explanation.includes(range));assert.match(dial.explanation,/representative view angle, not a measured angle from this recording/);
  assert.equal(dial.placement,clip.external?'reviewed':'corner');
  // SVG coordinates are deliberately rounded to four decimal places.
  near(Math.hypot(dial.x-64,dial.y-34),52,1e-4);
 }
 assert.equal(native,26);assert.deepEqual(new Set(found),supplementalIds);
 assert.match(referenceAngleMarkup,/role="img"/);assert.match(referenceAngleMarkup,/>REF<\/text>/);
});

test('replaced, unreviewed, mismatched and modified sources cannot inherit an angle review',()=>{
 for(const id of ['ase-2013-tee-01','ase-2013-tee-03','tee-me4c']){
  const clip=catalogs.find(clip=>clip.id===id),view=TEE_ATLAS_VIEWS.find(view=>view.id===clip.preset);
  for(const patch of [{id:'unreviewed-reference'},{url:clip.url+'?replacement=1'},{preset:'not-this-view'},{bytes:clip.bytes+1},{bytes:undefined},{external:!clip.external},{mode:'tte'},{kind:'image'},{mimeType:'application/octet-stream'}]){
   const replacement={...clip,...patch};assert.equal(reviewedTeeAngleSource(replacement),null,`${id}: ${JSON.stringify(patch)}`);assert.equal(supplementalTeeAngle(view,replacement),null);
  }
 }
 const local=catalogs.find(clip=>clip.id==='tee-me4c'),view=TEE_ATLAS_VIEWS.find(view=>view.id===local.preset);
 for(const sha256 of [undefined,'0'.repeat(64)])assert.equal(reviewedTeeAngleSource({...local,sha256}),null,'A local hash change invalidates source-pixel review');
 assert.equal(supplementalTeeAngle({...view,id:'me2c'},local),null,'A valid source cannot label another view');
 assert.equal(supplementalTeeAngle({...view,mode:'tte'},local),null);
 assert.equal(supplementalTeeAngle({...view,angleRange:[80,20]},local),null);
 assert.equal(supplementalTeeAngle(view),null,'The view name alone is not source evidence');
});

test('one bounded observer follows pane and video resize and metadata, then disconnects on disposal',()=>{
 let callback,disconnected=false,reads=0,framed=false;const observed=[];
 class ResizeObserver{constructor(fn){callback=fn;}observe(node){observed.push(node);}disconnect(){disconnected=true;}}
 const screen={clientWidth:600,clientHeight:600,getBoundingClientRect(){reads++;return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}};
 const properties={},indicator={style:{visibility:'hidden',setProperty(name,value){properties[name]=value;}}};
 const sourceUrl='https://publisher.example/movie.mp4';
 const listeners=new Map(),video={videoWidth:0,videoHeight:0,readyState:0,currentSrc:sourceUrl,getAttribute(){return sourceUrl;},getBoundingClientRect(){const width=framed?Math.min(screen.clientWidth,screen.clientHeight*1.4):screen.clientWidth,height=framed?width/1.4:screen.clientHeight;return {left:(screen.clientWidth-width)/2,top:(screen.clientHeight-height)/2,width,height};},addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}};
 const placement=createReferenceAnglePlacement({screen,indicator,video,window:{ResizeObserver}});
 assert.deepEqual(observed,[screen,video]);assert.deepEqual([...listeners.keys()].sort(),['emptied','error','loadedmetadata','loadstart','resize']);
 placement.update({enabled:true,sourceUrl,focusAspect:1.4,fullFrame:true});assert.equal(indicator.style.visibility,'hidden');
 video.readyState=1;video.videoWidth=1280;video.videoHeight=720;listeners.get('loadedmetadata')();
 assert.equal(indicator.style.visibility,'visible');assert.equal(properties['--echo-angle-top'],'171.75px');
 const readyReads=reads;placement.update({enabled:true,sourceUrl,focusAspect:1.4,fullFrame:true});assert.equal(reads,readyReads,'Ordinary CT/plane updates do not reread layout.');
 screen.clientWidth=360;screen.clientHeight=640;callback();assert.equal(properties['--echo-angle-left'],'86.445px');
 framed=true;placement.update({enabled:true,sourceUrl,focusAspect:1.4,fullFrame:false});assert.notEqual(properties['--echo-angle-left'],'86.445px');
 placement.destroy();assert.equal(disconnected,true);assert.equal(listeners.size,0);
 const disposedReads=reads;callback();placement.update({enabled:true,...source});assert.equal(reads,disposedReads);
});
