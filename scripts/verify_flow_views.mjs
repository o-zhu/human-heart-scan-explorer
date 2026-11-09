import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {flowPlane,FlowViewsModule} from '../public/flow-views.js';
import {dot,cross,worldToSource,sourceToWorld} from '../public/planes.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const metadata=JSON.parse(fs.readFileSync(path.join(root,'public/assets/flow-views-v5.json')));
const extent=[474/529,1,474/529],longestMm=529*.3176;
const near=(a,b,tol=2e-9)=>assert.ok(Math.abs(a-b)<tol,`${a} ≠ ${b}`);
const vectorNear=(a,b)=>a.forEach((v,i)=>near(v,b[i]));
const expected=['rv-inflow','rv-outflow','ra-inflow','ra-outflow','lv-inflow','lv-outflow','la-inflow','la-outflow'];
assert.deepEqual(metadata.presets.map(p=>p.id),expected);
let checks=0,textureBytes=0;
for(const preset of metadata.presets){
 const base=preset.world,original=flowPlane(preset,{offsetMm:0,rotationDeg:0,tiltDeg:0},longestMm);
 for(const key of ['center','right','up','normal','target'])vectorNear(original[key],base[key]);
 for(const [rotationDeg,tiltDeg,offsetMm] of [[0,0,0],[0,0,5],[35,-21,-4],[-60,40,15]]){
  const plane=flowPlane(preset,{rotationDeg,tiltDeg,offsetMm},longestMm);
  for(const axis of ['right','up','normal'])near(Math.hypot(...plane[axis]),1);
  near(dot(plane.right,plane.up),0);near(dot(plane.right,plane.normal),0);near(dot(plane.up,plane.normal),0);
  vectorNear(cross(plane.right,plane.up),plane.normal);
  near(dot(plane.target.map((v,i)=>v-base.target[i]),plane.normal)*longestMm,offsetMm);
  near(dot(plane.center.map((v,i)=>v-plane.target[i]),plane.normal),0);
  const source=worldToSource(plane.target,extent);vectorNear(sourceToWorld(source,extent),plane.target);
  checks++;
 }
 const source=preset.source,texture=preset.texture;
 for(const [column,row] of [[0,0],[texture.width-1,texture.height-1],[Math.floor(texture.width/2),Math.floor(texture.height/2)]]){
  const u=column/(texture.width-1)-.5,v=.5-row/(texture.height-1);
  const wp=base.center.map((x,i)=>x+base.right[i]*u*base.width+base.up[i]*v*base.height);
  const sp=source.center.map((x,i)=>x+source.right[i]*u*source.width+source.up[i]*v*source.height);
  const normalized=sp.map((x,i)=>x/([474,474,529][i]));
  vectorNear(worldToSource(wp,extent),normalized);
 }
 near(source.width*.3176/(texture.width-1),.0794);near(source.height*.3176/(texture.height-1),.0794);
 const image=fs.readFileSync(path.join(root,'public',texture.url.replace(/^\.\//,'')));
 assert.equal(image.length,texture.bytes);assert.equal(crypto.createHash('sha256').update(image).digest('hex'),texture.sha256);
 assert.ok(texture.bytes<1e6);textureBytes+=texture.bytes;
}
// Exercise the real module methods when a user opens Flow before data arrives.
const flow=Object.create(FlowViewsModule.prototype);
Object.assign(flow,{active:true,presets:metadata.presets,state:{preset:'rv-inflow',offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false,lockCamera:true,view:'overview',contrast:1.65,threshold:.28},requestId:0,message(){}});
flow.renderer={settings:{},camera:{distance:1.55,pan:[0,0,0]},set(values){Object.assign(this.settings,values);},clearCapData(){},alignPlane(normal,up,center){this.camera.normal=[...normal];this.camera.up=[...up];this.camera.pan=[...center];}};
flow.applyPlane(true,true);assert.equal(flow.renderer.camera.distance,1.55);
flow.setVolume(new Uint8Array(1),{dimensions:[475,475,530],spacingUm:317.6});clearTimeout(flow.sampleTimer);
assert.equal(flow.renderer.camera.distance,metadata.presets[0].cameraDistance);vectorNear(flow.renderer.camera.pan,metadata.presets[0].world.target);
flow.renderer.camera={distance:.61,pan:[.1,.2,.3],normal:[0,1,0],up:[0,0,1]};const userCamera=structuredClone(flow.renderer.camera);
flow.setVolume(new Uint8Array(2),{dimensions:[475,475,530],spacingUm:317.6});clearTimeout(flow.sampleTimer);
assert.deepEqual(flow.renderer.camera,userCamera,'Background replacement must preserve the active user camera.');
console.log(JSON.stringify({passed:true,presets:8,transformedFrameChecks:checks,allPixelRegistrations:true,allEncodedChecksums:true,firstVolumeInitializesCamera:true,backgroundVolumePreservesCamera:true,totalTextureBytes:textureBytes,largestTextureBytes:Math.max(...metadata.presets.map(p=>p.texture.bytes))}));
