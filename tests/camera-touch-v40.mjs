/** Exercise the actual shared camera handlers without requiring a GPU. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {VolumeRenderer} from '../public/renderer.js';
import {CPUVolumeRenderer} from '../public/cpu-renderer.js';

const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-10,`${message||'value'}: ${actual} vs ${expected}`);
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const sub=(a,b)=>a.map((value,index)=>value-b[index]);

function fixture(Renderer=VolumeRenderer,{width=600,height=500,left=40,top=70,roll=0,pitch=0,yaw=0,distance=2}={}){
 const doc=new EventTarget(),view=new EventTarget(),canvas=new EventTarget(),requests=[],changes=[];
 doc.defaultView=view;doc.hidden=false;
 const captured=new Set(),rect={left,top,width,height};
 Object.assign(canvas,{style:{},ownerDocument:doc,getBoundingClientRect:()=>rect,setPointerCapture:id=>captured.add(id)});
 const renderer=Object.assign(Object.create(Renderer.prototype),{
  canvas,camera:{yaw,pitch,roll,distance,pan:[0,0,0]},settings:{},
  requestRender(kind){requests.push(kind);},queueFrame(){requests.push('frame');},onChange(change){changes.push(change);},
 });
 renderer.bindControls();
 const pointer=(type,id,x,y,extra={})=>{
  const event=new Event(type,{cancelable:true});
  Object.assign(event,{pointerId:id,pointerType:'touch',isPrimary:id===1,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1,...extra});
  canvas.dispatchEvent(event);return event;
 };
 const project=point=>{
  const basis=renderer.basis(),offset=sub(point,basis.eye),depth=dot(offset,basis.forward);
  return {x:rect.left+rect.width/2+dot(offset,basis.right)/depth/.64*rect.height,
   y:rect.top+rect.height/2-dot(offset,basis.up)/depth/.64*rect.height};
 };
 const targetAt=(x,y)=>{
  const basis=renderer.basis(),scale=.64*renderer.camera.distance/rect.height;
  return renderer.camera.pan.map((value,i)=>value+basis.right[i]*(x-left-width/2)*scale-basis.up[i]*(y-top-height/2)*scale);
 };
 return {renderer,canvas,doc,view,rect,pointer,project,targetAt,requests,changes,captured};
}

for(const [name,Renderer]of [['WebGL',VolumeRenderer],['software',CPUVolumeRenderer]]){
 test(`${name}: two-finger translation pans the model by the touch midpoint without rotation or lasting zoom`,()=>{
  const f=fixture(Renderer),camera=structuredClone(f.renderer.camera),target=[0,0,0],before=f.project(target);
  f.pointer('pointerdown',1,200,250);f.pointer('pointerdown',2,400,250);
  f.pointer('pointermove',1,260,285);f.pointer('pointermove',2,460,285);
  const after=f.project(target);
  close(after.x-before.x,60,'horizontal following');close(after.y-before.y,35,'vertical following');
  close(f.renderer.camera.distance,camera.distance,'pure pan preserves zoom');
  for(const key of ['yaw','pitch','roll'])close(f.renderer.camera[key],camera[key],key);
  assert.equal(f.renderer.interacting,true);assert.equal(f.canvas.style.touchAction,'none');
  assert.equal(f.changes.length,2);assert.ok(f.requests.every(kind=>kind==='camera'));
  f.pointer('pointerup',2,460,285);assert.equal(f.renderer.interacting,true);
  f.pointer('pointerup',1,260,285);assert.equal(f.renderer.interacting,false);
 });

 test(`${name}: pinch and pan work together on their first move and retain an off-center anchor`,()=>{
  const f=fixture(Renderer),target=f.targetAt(220,280);
  f.pointer('pointerdown',1,180,280);f.pointer('pointerdown',2,260,280);
  f.pointer('pointermove',1,160,300);
  assert.notEqual(f.renderer.camera.distance,2,'The first pinch movement must not be dropped.');
  f.pointer('pointermove',2,320,300);
  close(f.renderer.camera.distance,1,'80 px to 160 px pinch');
  const after=f.project(target);close(after.x,240,'new midpoint x');close(after.y,300,'new midpoint y');
  close(f.renderer.camera.yaw,0);close(f.renderer.camera.pitch,0);close(f.renderer.camera.roll,0);
 });

 test(`${name}: one finger still orbits, and adding or lifting a finger introduces no jump`,()=>{
  const f=fixture(Renderer);
  f.pointer('pointerdown',1,180,250);f.pointer('pointermove',1,195,260);
  const rotated=structuredClone(f.renderer.camera);assert.notEqual(rotated.yaw,0);assert.notEqual(rotated.pitch,0);
  assert.deepEqual(rotated.pan,[0,0,0]);close(rotated.distance,2);
  f.pointer('pointerdown',2,300,260);assert.deepEqual(f.renderer.camera,rotated);
  f.pointer('pointermove',1,205,260);f.pointer('pointermove',2,310,260);
  for(const key of ['yaw','pitch','roll'])close(f.renderer.camera[key],rotated[key]);
  const beforeRelease=structuredClone(f.renderer.camera);
  f.pointer('pointerup',2,310,260);assert.deepEqual(f.renderer.camera,beforeRelease);
  f.pointer('pointermove',1,205,260);assert.deepEqual(f.renderer.camera,beforeRelease,'A stationary remaining finger does not inherit another contact’s movement.');
  f.pointer('pointermove',1,215,260);assert.notEqual(f.renderer.camera.yaw,beforeRelease.yaw);
 });

 test(`${name}: cancellation, capture loss and backgrounding clear active contacts`,()=>{
  const f=fixture(Renderer);
  for(const end of ['pointercancel','lostpointercapture']){
   f.pointer('pointerdown',1,180,250);f.pointer('pointerdown',2,300,250);
   f.pointer(end,2,300,250);f.pointer(end,1,180,250);
   const before=structuredClone(f.renderer.camera),calls=f.requests.length;
   f.pointer('pointermove',1,10,10);f.pointer('pointerup',1,10,10);
   assert.deepEqual(f.renderer.camera,before);assert.equal(f.requests.length,calls);assert.equal(f.renderer.interacting,false);
  }
  for(const action of [()=>f.view.dispatchEvent(new Event('blur')),()=>{f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));},()=>{f.doc.pointerLockElement={};f.doc.dispatchEvent(new Event('pointerlockchange'));}]){
   f.doc.hidden=false;f.doc.pointerLockElement=null;
   f.pointer('pointerdown',1,180,250);f.pointer('pointerdown',2,300,250);action();
   const before=structuredClone(f.renderer.camera);
   f.pointer('pointermove',1,10,10);f.pointer('pointermove',2,30,10);
   assert.deepEqual(f.renderer.camera,before);assert.equal(f.renderer.interacting,false);
  }
 });

 test(`${name}: tiny spans and third-contact transitions cannot produce invalid zoom or stale jumps`,()=>{
  const f=fixture(Renderer);
  f.pointer('pointerdown',1,200,250);f.pointer('pointerdown',2,200,250);
  f.pointer('pointermove',1,200.1,250);f.pointer('pointermove',2,200.1,250);
  close(f.renderer.camera.distance,2);assert.ok(f.renderer.camera.pan.every(Number.isFinite));
  f.pointer('pointermove',2,300,250);
  const beforeThird=structuredClone(f.renderer.camera);
  f.pointer('pointerdown',3,450,250);f.pointer('pointermove',3,480,250);
  assert.deepEqual(f.renderer.camera,beforeThird,'Extra contacts do not replace the active pair.');
  f.pointer('pointerup',1,200.1,250);
  const beforeNewPair=structuredClone(f.renderer.camera);
  f.pointer('pointermove',3,480,250);assert.deepEqual(f.renderer.camera,beforeNewPair);
  f.pointer('pointermove',3,660,250);close(f.renderer.camera.distance,beforeNewPair.distance/2);
  f.pointer('pointermove',2,NaN,250);assert.ok(f.renderer.camera.pan.every(Number.isFinite));assert.ok(Number.isFinite(f.renderer.camera.distance));
 });

 test(`${name}: wheel zoom and desktop modified-drag pan retain their existing behavior`,()=>{
  const f=fixture(Renderer);
  f.pointer('pointerdown',1,200,250,{pointerType:'mouse',button:2,buttons:2});
  f.pointer('pointermove',1,220,265,{pointerType:'mouse',button:2,buttons:2});
  close(f.renderer.camera.pan[0],-20*2*.0012);close(f.renderer.camera.pan[1],15*2*.0012);
  close(f.renderer.camera.yaw,0);close(f.renderer.camera.pitch,0);
  f.pointer('pointerup',1,220,265,{pointerType:'mouse',button:2});
  const wheel=new Event('wheel',{cancelable:true});wheel.deltaY=-100;f.canvas.dispatchEvent(wheel);
  close(f.renderer.camera.distance,2*Math.exp(-.1));assert.equal(wheel.defaultPrevented,true);
 });
}

test('touch pan uses CSS pane dimensions and camera axes at different sizes and rolls',()=>{
 for(const rect of [{width:360,height:640},{width:1400,height:550}])for(const roll of [0,Math.PI/2,Math.PI]){
  const f=fixture(VolumeRenderer,{...rect,yaw:.4,pitch:-.3,roll}),point=f.targetAt(160,200);
  f.pointer('pointerdown',1,120,200);f.pointer('pointerdown',2,200,200);
  f.pointer('pointermove',1,142,231);f.pointer('pointermove',2,222,231);
  const projected=f.project(point);close(projected.x,182);close(projected.y,231);
 }
});

test('pinch retains current minimum-distance rules, including a focused native region',()=>{
 const f=fixture();
 f.pointer('pointerdown',1,200,250);f.pointer('pointerdown',2,201,250);
 f.pointer('pointermove',2,203,250);f.pointer('pointermove',2,900,250);close(f.renderer.camera.distance,.34);
 f.pointer('pointerup',2,900,250);f.pointer('pointerup',1,200,250);
 f.renderer.nativeMainDetail={hasActiveRegion:()=>true};
 f.pointer('pointerdown',1,200,250);f.pointer('pointerdown',2,203,250);f.pointer('pointermove',2,900,250);
 close(f.renderer.camera.distance,.045);
});
