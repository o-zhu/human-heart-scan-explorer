import assert from 'node:assert/strict';
import test from 'node:test';
import {referenceAngleLayout,createReferenceAnglePlacement,supplementalTeeAngle,referenceAngleMarkup} from '../public/echo-reference-player.js';
import {TEE_ATLAS_VIEWS} from '../public/tee-atlas-data.js';

const source={sourceWidth:1280,sourceHeight:720,focusAspect:1.4};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} ≠ ${expected}`);
const nearRect=(actual,expected)=>Object.entries(expected).forEach(([key,value])=>near(actual[key],value));

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

test('representative reference values retain guideline ranges in the explanation; only missing readouts receive a dial',()=>{
 for(const [id,range,angle] of [['me5c','0–10°',5],['memodbicaval','50–70°',60]]){
  const dial=supplementalTeeAngle(TEE_ATLAS_VIEWS.find(view=>view.id===id));
  assert.equal(dial.label,`${angle}°`);assert.equal(dial.angle,angle);
  assert.match(dial.explanation,/Representative reference angle/);assert.ok(dial.explanation.includes(`guideline range ${range}`));assert.match(dial.explanation,/acquired angle is not displayed/);
  near(Math.hypot(dial.x-64,dial.y-34),52);
 }
 for(const view of TEE_ATLAS_VIEWS.filter(view=>!['me5c','memodbicaval'].includes(view.id)))assert.equal(supplementalTeeAngle(view),null);
 assert.match(referenceAngleMarkup,/role="img"/);assert.match(referenceAngleMarkup,/>REF<\/text>/);
 assert.equal(supplementalTeeAngle({id:'me5c',angleRange:[80,20]}),null);
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
