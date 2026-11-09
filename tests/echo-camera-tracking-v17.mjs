/** Exercise actual module call sites and renderer classification, without a browser. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {EchoModule} from '../public/echo.js';
import {FlowViewsModule} from '../public/flow-views.js';
import {VolumeRenderer} from '../public/renderer.js';

function rendererFixture(){
 const renderer=Object.assign(Object.create(VolumeRenderer.prototype),{
  settings:{mode:0,threshold:.28,clipAxis:1,clipPosition:.5,clipFlip:0,showPlanes:0,cleanupEnabled:true},
  camera:{yaw:.3,pitch:.1,roll:Math.PI,distance:1.65,pan:[0,0,0]},extent:[.9,1,.9],
  viewRevision:0,displayedRevision:-1,autoRotate:false,onChange(){},queueFrame(){this.queued=(this.queued||0)+1;},
 });
 renderer.requestRender('camera');
 return renderer;
}
const world={center:[.02,.01,.03],target:[.02,.01,.03],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.8,height:1};

test('locked Echo scrolling and plane edits keep bounded work while explicit Face plane stays sharp',()=>{
 const renderer=rendererFixture(),echo=Object.assign(Object.create(EchoModule.prototype),{
  renderer,active:true,frames:{a4c:world},longestMm:150,spacingMm:.3176,offsetLimitMm:35,requestId:0,
  state:{preset:'a4c',offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false,lockCamera:true},
  presetTextures:{},textureCache:{pause(){}},cancelFine(){},updateCine(){},updateReadouts(){},updateCorrespondence(){},updateProbe(){},
  queueFinePlane(){},message(){},$(){return {};},samplePlane(){},
 });
 try{
  const initialPan=[...renderer.camera.pan];
  for(let i=0;i<6;i++){
   echo.moveSection(1);
   assert.equal(renderer.cameraQuality,false,'A following camera must not override the section-edit workload.');
   assert.deepEqual(renderer.settings.oblique.center,echo.getPlane().center);
   assert.deepEqual(renderer.camera.pan,echo.getPlane().center);
  }
  assert.notDeepEqual(renderer.camera.pan,initialPan);
  for(const [rotationDeg,tiltDeg] of [[12,0],[12,8],[-20,8]]){
   Object.assign(echo.state,{rotationDeg,tiltDeg});echo.applyPlane();
   assert.equal(renderer.cameraQuality,false,'Automatic angular tracking remains a scene edit.');
  }
  renderer.setCapData({data:new Uint8Array([1]),width:1,height:1,plane:echo.getPlane()});
  assert.equal(renderer.cameraQuality,false,'Late current-plane detail retains the scrub classification.');
  echo.facePlane();
  assert.equal(renderer.cameraQuality,true,'The explicit Face plane command retains native camera quality.');
 }finally{
  clearTimeout(echo.sampleTimer);clearTimeout(echo.prefetchTimer);clearTimeout(renderer.refineTimer);
 }
});

test('historical flow section tracking keeps bounded work without weakening explicit view commands',()=>{
 const renderer=rendererFixture(),preset={id:'rv-inflow',world,cameraDistance:1.5,closeDistance:1.1};
 const flow=Object.assign(Object.create(FlowViewsModule.prototype),{
  renderer,active:true,data:new Uint8Array([1]),longestMm:150,spacingMm:.3176,offsetLimitMm:15,requestId:0,
  state:{offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false,lockCamera:true,view:'overview'},
  preset:()=>preset,updateReadouts(){},message(){},samplePlane(){},
 });
 try{
  for(let i=0;i<6;i++){
   flow.moveSection(1);
   assert.equal(renderer.cameraQuality,false);
   assert.deepEqual(renderer.camera.pan,flow.getPlane().target);
  }
  flow.state.rotationDeg=15;flow.state.tiltDeg=8;flow.applyPlane();
  assert.equal(renderer.cameraQuality,false);
  flow.positionCamera(true);
  assert.equal(renderer.cameraQuality,true);
  assert.equal(renderer.camera.distance,preset.cameraDistance);
 }finally{clearTimeout(flow.sampleTimer);clearTimeout(renderer.refineTimer);}
});
