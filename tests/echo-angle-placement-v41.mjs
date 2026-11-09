/** Regression for the publisher MP4s' non-square pixels. The source-space
 * clear rectangles were checked across all decoded source frames; see
 * docs/echo-mobile-v41/angle-placement.md. No browser or playback is mocked
 * as clinical validation here. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {referenceAngleLayout,createReferenceAnglePlacement} from '../public/echo-reference-player.js';

const near=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
const clips=[
 {id:'me5c',width:1552,height:720,clear:{left:365,top:86,right:507,bottom:226}},
 {id:'memodbicaval',width:1867,height:720,clear:{left:411,top:86,right:530,bottom:226}},
];
const layoutFor=(clip,options)=>referenceAngleLayout({sourceWidth:clip.width,sourceHeight:clip.height,focusAspect:1.4,...options});

test('modified-bicaval Full Frame includes the real pixel aspect ratio and its letterboxing',()=>{
 const pane={width:528.34375,height:393},clip=clips[1];
 const layout=layoutFor(clip,{...pane,videoRect:{left:0,top:0,...pane},objectFit:'contain'});
 near(layout.frame.height,pane.width*720/1867);
 near(layout.frame.top,(pane.height-layout.frame.height)/2);
 const headerBottom=layout.frame.top+72/720*layout.frame.height;
 const settingsRight=layout.frame.left+385/1280*layout.frame.width;
 assert.ok(layout.top>headerBottom,'The dial starts below the original blue scanner header.');
 assert.ok(layout.left>settingsRight,'The dial starts to the right of the scanner settings.');
 const wrong=referenceAngleLayout({...pane,sourceWidth:1280,sourceHeight:720,focusAspect:1.4});
 assert.ok(wrong.top<headerBottom,'This fixture reproduces the prior encoded-width/letterbox mistake.');
});

test('all pane sizes and both framing modes keep the entire dial in source-reviewed black pixels',()=>{
 for(const clip of clips)for(const [width,height] of [[240,260],[360,640],[528.34375,393],[814,691],[1280,720],[1920,1080],[1200,380]])for(const fullFrame of [true,false]){
  const w=fullFrame?width:Math.min(width,height*1.4),h=fullFrame?height:w/1.4;
  const videoRect={left:(width-w)/2,top:(height-h)/2,width:w,height:h};
  const layout=layoutFor(clip,{width,height,fullFrame,videoRect,objectFit:fullFrame?'contain':'cover'});
  assert.ok(layout,`${clip.id}: ${width} × ${height}, full=${fullFrame}`);
  const x=(layout.left-layout.frame.left)/layout.frame.width*1280;
  const y=(layout.top-layout.frame.top)/layout.frame.height*720;
  const right=x+layout.width/layout.frame.width*1280;
  const bottom=y+layout.width*104/128/layout.frame.height*720;
  assert.ok(x>=clip.clear.left&&right<=clip.clear.right,`Source horizontal bounds ${x}–${right}`);
  assert.ok(y>=clip.clear.top&&bottom<=clip.clear.bottom,`Source vertical bounds ${y}–${bottom}`);
  assert.ok(layout.width<=160);
 }
});

test('measured video geometry wins over a surrounding pane with a different CSS size',()=>{
 const clip=clips[1],videoRect={left:55,top:40,width:280,height:200};
 const layout=layoutFor(clip,{width:390,height:450,videoRect,fullFrame:false,objectFit:'cover'});
 near(layout.crop.left,55);near(layout.crop.top,40);near(layout.crop.width,280);near(layout.crop.height,200);
 near(layout.left,55+280*.17);near(layout.top,40+200*.12);
 const moved=layoutFor(clip,{width:500,height:600,videoRect:{...videoRect,left:85,top:100},fullFrame:false,objectFit:'cover'});
 near(moved.left-layout.left,30);near(moved.top-layout.top,60);
 const clipped=layoutFor(clip,{width:390,height:450,videoRect,fullFrame:false,objectFit:'cover',positionX:1});
 assert.equal(clipped,null,'An unexpectedly clipped source slot is hidden, not relocated over unreviewed content.');
});

function fixture(){
 let callback,reads=0,disconnected=false;const observed=[],listeners=new Map(),styles={objectFit:'contain',objectPosition:'50% 50%'};
 class ResizeObserver{constructor(fn){callback=fn;}observe(node){observed.push(node);}disconnect(){disconnected=true;}}
 const screen={clientWidth:528,clientHeight:393,clientLeft:1,clientTop:1,getBoundingClientRect(){reads++;return {left:400.25,top:81.75,width:530,height:395};}};
 const video={hidden:false,error:null,readyState:1,videoWidth:1552,videoHeight:720,currentSrc:'https://publisher.example/one.mp4',src:'https://publisher.example/one.mp4',rect:{left:401.25,top:82.75,width:528,height:393},getAttribute(name){return name==='src'?this.src:null;},getBoundingClientRect(){reads++;return this.rect;},addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}};
 const properties={},indicator={style:{visibility:'hidden',setProperty(name,value){properties[name]=value;}}};
 const placement=createReferenceAnglePlacement({screen,indicator,video,window:{ResizeObserver,getComputedStyle:()=>styles}});
 return {placement,screen,video,properties,indicator,listeners,styles,observed,resize:()=>callback(),reads:()=>reads,disconnected:()=>disconnected};
}

test('only matching decoded metadata can position a newly selected source',()=>{
 const f=fixture(),state={enabled:true,sourceUrl:f.video.src,sourceKey:'one',focusAspect:1.4,fullFrame:true,sourceWidth:1280,sourceHeight:720};
 f.placement.update(state);assert.equal(f.indicator.style.visibility,'visible');
 const first=f.properties['--echo-angle-left'];
 const next={...state,sourceUrl:'https://publisher.example/twelve.mp4',sourceKey:'twelve'};
 f.placement.update(next);assert.equal(f.indicator.style.visibility,'hidden');
 f.video.src=next.sourceUrl;f.listeners.get('loadedmetadata')();
 assert.equal(f.indicator.style.visibility,'hidden','Queued old metadata cannot borrow the new src attribute.');
 f.video.currentSrc=next.sourceUrl;f.video.readyState=0;f.listeners.get('loadstart')();
 assert.equal(f.indicator.style.visibility,'hidden','Old intrinsic dimensions are unusable before replacement metadata.');
 f.video.readyState=1;f.video.videoWidth=1867;f.listeners.get('loadedmetadata')();
 assert.equal(f.indicator.style.visibility,'visible');assert.notEqual(f.properties['--echo-angle-left'],first);
 const expected=layoutFor(clips[1],{width:528,height:393,videoRect:{left:0,top:0,width:528,height:393}});
 near(Number.parseFloat(f.properties['--echo-angle-left']),expected.left,.001);
 near(Number.parseFloat(f.properties['--echo-angle-top']),expected.top,.001);
 const reads=f.reads();f.placement.update(next);assert.equal(f.reads(),reads,'Ordinary CT updates do not measure layout.');
 f.video.readyState=0;f.listeners.get('emptied')();assert.equal(f.indicator.style.visibility,'hidden');
 f.video.readyState=1;f.video.error={code:3};f.listeners.get('error')();assert.equal(f.indicator.style.visibility,'hidden');
 f.placement.destroy();
});

test('video-only CSS resize and framing changes update placement; disposal removes bounded observers',()=>{
 const f=fixture(),state={enabled:true,sourceUrl:f.video.src,sourceKey:'one',focusAspect:1.4,fullFrame:true};
 f.placement.update(state);const fullTop=f.properties['--echo-angle-top'];
 f.video.rect={left:450.25,top:100.75,width:420,height:300};f.styles.objectFit='cover';
 f.placement.update({...state,fullFrame:false});
 assert.notEqual(f.properties['--echo-angle-top'],fullTop);
 near(Number.parseFloat(f.properties['--echo-angle-top']),18+300*.12,.001);
 const before=Number.parseFloat(f.properties['--echo-angle-top']);
 f.video.rect={...f.video.rect,top:f.video.rect.top+30};f.resize();
 near(Number.parseFloat(f.properties['--echo-angle-top'])-before,30,.001);
 assert.deepEqual(f.observed,[f.screen,f.video]);
 f.placement.update({...state,enabled:false});assert.equal(f.indicator.style.visibility,'hidden');
 f.placement.destroy();assert.equal(f.disconnected(),true);assert.equal(f.listeners.size,0);
 const reads=f.reads();f.resize();f.placement.update(state);assert.equal(f.reads(),reads);
});
