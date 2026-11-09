import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EchoModule,ECHO_PRESETS} from '../public/echo.js';
import {ECHO_REFERENCE_CHECKS,isEchoPlaneModified,orientEchoPlaneForDisplay,orientEchoPreparedPixels,echoDisplayFacing,describeEchoCorrespondence} from '../public/echo-correspondence.js';
import {add,mul,dot,cross,norm} from '../public/planes.js';

const manifest=JSON.parse(readFileSync(new URL('../public/assets/echo-planes.json',import.meta.url)));
const catalog=JSON.parse(readFileSync(new URL('../public/assets/echo-media-v6.json',import.meta.url)));
const textures=JSON.parse(readFileSync(new URL('../public/assets/echo-textures.json',import.meta.url))).textures;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8,`${a} != ${b}`));
const position=(p,x,y,w,h)=>add(p.center,add(mul(p.right,(x/(w-1)-.5)*p.width),mul(p.up,(.5-y/(h-1))*p.height)));
const scalar=p=>Math.round(120+31*p[0]+47*p[1]+19*p[2]);
const sample=(p,w=11,h=7)=>({width:w,height:h,data:Uint8Array.from({length:w*h},(_,i)=>scalar(position(p,i%w,Math.floor(i/w),w,h)))});

for(const [key,frame] of Object.entries(manifest.frames)) {
 test(`${key}: prepared pixels, streamed basis and 3D cap preserve each measured source position`,()=>{
  const base=frame.world,options={mirrorX:frame.displayMirrorX===true,rotate180:frame.displayRotate180===true};
  const display=orientEchoPlaneForDisplay(base,options),original=sample(base),prepared=orientEchoPreparedPixels(original,options),reformatted=sample(display);
  // A fine-volume worker and the loaded-volume worker both receive this same
  // display basis. Their physical pixel positions must match the permuted preset.
  assert.deepEqual(prepared.data,reformatted.data);
  assert.deepEqual(original.data,sample(base).data,'immutable source pixels changed');
  near(display.normal,base.normal);near(display.center,base.center);
  for(let y=0;y<prepared.height;y++)for(let x=0;x<prepared.width;x++){
   const p=position(display,x,y,prepared.width,prepared.height),delta=add(p,mul(display.center,-1));
   const capX=Math.round((dot(delta,display.right)/display.width+.5)*(prepared.width-1));
   const capY=Math.round((.5-dot(delta,display.up)/display.height)*(prepared.height-1));
   assert.equal(prepared.data[capY*prepared.width+capX],scalar(p),'cap texture and CT slice disagree');
  }
  for(const flip of [false,true]){
   const facing=echoDisplayFacing(display,flip),retainedNormal=mul(display.normal,facing.clipFlip?-1:1);
   near(facing.normal,retainedNormal);
   near(norm(cross(display.up,facing.normal)),mul(display.right,flip?-1:1));
  }
 });
}

test('orientation corrections keep physical offsets and rotation / tilt controls consistent',()=>{
 const frame=manifest.frames.me4c;
 const echo=Object.create(EchoModule.prototype);
 Object.assign(echo,{frames:{me4c:{...frame.world,displayMirrorX:true}},longestMm:168.0104,state:{preset:'me4c',offsetMm:4.2,rotationDeg:17,tiltDeg:-8}});
 const corrected=echo.getPlane();echo.frames.me4c.displayMirrorX=false;const original=echo.getPlane();
 near(corrected.center,original.center);near(corrected.normal,original.normal);near(corrected.up,original.up);near(corrected.right,mul(original.right,-1));
 echo.state.offsetMm=0;const zero=echo.getPlane();near(add(original.center,mul(zero.center,-1)),mul(original.normal,4.2/168.0104));
});

test('legacy measured levels retain separate reviews and every new atlas view has target checks',()=>{
 const keys=ECHO_PRESETS.flatMap(p=>p.id==='psax'?['psax_papillary','psax_mitral']:[p.id]);
 for(const key of keys)assert.ok(ECHO_REFERENCE_CHECKS[key],`${key} needs clinical target checks`);
 for(const key of Object.keys(manifest.frames)){
  assert.ok(keys.includes(key),'Every original measured view remains selectable');
  assert.ok(ECHO_REFERENCE_CHECKS[key]);assert.ok(textures[key]);
  const review=manifest.correspondence.views[key];assert.ok(review);assert.equal(review.clinicallyValidated,false);
  const result=describeEchoCorrespondence({key,review,clip:catalog.clips.find(c=>c.preset===key)});
  assert.equal(result.clinicallyValidated,false);assert.match(result.status,/Partial|unverified/);
 }
 assert.equal(catalog.clips.length,12);
 for(const clip of catalog.clips){assert.equal(clip.correspondence.sourceLabelVerified,true);assert.equal(clip.correspondence.ctRegistered,false);assert.equal(clip.correspondence.evidenceUrl,clip.sourceUrl);}
});

test('sweep, broader TG reference, missing AV-SAX and user-selected different views cannot claim an exact match',()=>{
 const describe=(key,clipKey=key)=>describeEchoCorrespondence({key,review:manifest.correspondence.views[key],clip:catalog.clips.find(c=>c.preset===clipKey)});
 assert.equal(describe('psax_mitral').movieStatus,'Changing-plane recording');
 assert.equal(describe('tgpapillary').movieStatus,'Broader view reference');
 assert.equal(describe('meavsax').movieStatus,'No matching recording');
 assert.equal(describe('a4c','a2c').movieStatus,'Different reference view');
 const geometric=describeEchoCorrespondence({key:'a4c',review:manifest.correspondence.views.a4c,geometric:true});
 assert.match(geometric.status,/unverified/);
 assert.deepEqual(geometric.required,[],'Geometric donors do not inherit a clinical landmark checklist.');
 assert.match(geometric.check,/not been assigned/);
 assert.equal(describeEchoCorrespondence({key:'a4c',review:manifest.correspondence.views.a4c,modified:true}).status,'CT plane adjusted');
});

test('moving a plane bypasses the prepared preset and discards a late old texture',async()=>{
 let resolvePrepared;const prepared=new Promise(resolve=>resolvePrepared=resolve);
 const shown=[],queued=[],elements=new Map();let loadCalls=0,peekCalls=0;
 const frame=manifest.frames.me4c,echo=Object.create(EchoModule.prototype);
 Object.assign(echo,{active:true,frames:{me4c:{...frame.world,displayMirrorX:true}},requestId:0,longestMm:168.0104,
  state:{preset:'me4c',offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false,lockCamera:false},
  presetTextures:{me4c:{url:'me4c.webp'}},fineSource:{samplePlane(){}},fineLabel:'79.4 µm',
  renderer:{settings:{cleanupEnabled:true},set(){},clearCapData(){}},
  textureCache:{peek(){peekCalls++;return null;},pause(){}},loadPresetTexture(){loadCalls++;return prepared;},
  queueFinePlane(p,t,k){queued.push({p,t,k});},cancelFine(){},updateCine(){},updateCorrespondence(){},message(){},samplePlane(){},prefetchNeighbors(){},
  showSample(s){shown.push(s);},$:key=>{if(!elements.has(key))elements.set(key,{});return elements.get(key);}});
 echo.applyPlane();clearTimeout(echo.sampleTimer);const firstPlane=echo.plane;
 echo.state.offsetMm=.3176;assert.equal(isEchoPlaneModified(echo.state),true);echo.applyPlane();clearTimeout(echo.sampleTimer);
 assert.equal(loadCalls,1);assert.equal(peekCalls,1);assert.equal(queued.length,1);
 assert.notDeepEqual(queued[0].p.center,firstPlane.center);
 resolvePrepared(sample(firstPlane));await tick();assert.equal(shown.length,0,'stale exact texture replaced an adjusted section');
});
