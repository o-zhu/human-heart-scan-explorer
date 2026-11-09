import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEchoInstrumentClearance,ECHO_TEE_HEAD_RENDER_SCALE} from '../public/echo-instrument-clearance.js';
import {createTeeContextModel} from '../public/tee-context-geometry.js';

function cylinder(scale=1){
 const segments=48,positions=[],indices=[];
 for(const z of [-20,20])for(let i=0;i<segments;i++){const a=i*2*Math.PI/segments;positions.push(10*scale*Math.cos(a),10*scale*Math.sin(a),z*scale);}
 for(let i=0;i<segments;i++){const a=i,b=(i+1)%segments,c=i+segments,d=b+segments;indices.push(a,b,c,b,d,c);}
 return {frame:{scale},topology:{gastrointestinal:{positionsMm:Float32Array.from(positions),indices:Uint32Array.from(indices),rings:2,segments}}};
}
const instrument={originMm:[0,0,0],beam:[0,0,-1],right:[1,0,0],normal:[0,1,0]};

test('cached query preserves fixed topology and uses production head scale',()=>{
 const model=cylinder(),before=Array.from(model.topology.gastrointestinal.positionsMm),q=createEchoInstrumentClearance(model);
 assert.equal(q,createEchoInstrumentClearance({...model}));assert.equal(ECHO_TEE_HEAD_RENDER_SCALE,.60);
 const result=q(instrument,1,{fullReport:true});assert.equal(result.inside,true);assert.equal(result.complete,true);assert.ok(result.clearanceMm>1.8);
 assert.deepEqual(Array.from(model.topology.gastrointestinal.positionsMm),before);
});
test('actual long head is rejected when its center alone would fit',()=>{
 const q=createEchoInstrumentClearance(cylinder()),shifted={...instrument,originMm:[0,5,0]};
 assert.equal(q.point(shifted.originMm).inside,true);
 const quick=q(shifted,1),complete=q(shifted,1,{fullReport:true});
 assert.equal(quick.inside,false);assert.equal(complete.inside,false);assert.ok(quick.testedVertices<quick.totalVertices);
 assert.ok(complete.penetrationMm>2);assert.equal(complete.complete,true);assert.ok(complete.outsideVertices>1);
});
test('wall distance uses real wall rather than artificial query caps',()=>{
 const q=createEchoInstrumentClearance(cylinder());
 const p=q.point([0,0,19.9],{measureClearance:true});assert.equal(p.inside,true);assert.ok(p.clearanceMm>9.9);
 assert.equal(q.point([0,0,25]).inside,false);
});
test('uniform physical scaling preserves classification and scales penetration',()=>{
 const a=createEchoInstrumentClearance(cylinder()),b=createEchoInstrumentClearance(cylinder(2));
 const r1=a({...instrument,originMm:[0,5,0]},1,{fullReport:true}),r2=b({...instrument,originMm:[0,10,0]},2,{fullReport:true});
 assert.equal(r1.inside,r2.inside);assert.ok(Math.abs(r2.penetrationMm-2*r1.penetrationMm)<1e-5);
});
test('shaft radius is checked even when every center point is inside',()=>{
 const q=createEchoInstrumentClearance(cylinder()),points=[[0,0,-20],[9,0,0],[9,0,5]];
 assert.equal(q.point(points[1]).inside,true);assert.equal(q.route(points,1.8).inside,false);
 assert.equal(q.route([[0,0,-20],[0,0,0],[0,0,10]],1.8).inside,true);
});
test('invalid geometry, poses and empty routes fail closed',()=>{
 assert.throws(()=>createEchoInstrumentClearance({}),/gastrointestinal/);
 const q=createEchoInstrumentClearance(cylinder());
 assert.throws(()=>q({...instrument,beam:[0,0,0]}),/orthonormal/);
 assert.throws(()=>q({...instrument,originMm:[0,NaN,0]}),/finite/);
 assert.throws(()=>q(instrument,-1),/positive/);
 assert.throws(()=>q.route([],1),/at least two/);
});
test('real authored GI route and a known straight head are tested without synthetic organ substitutions',()=>{
 const source=JSON.parse(readFileSync(new URL('../public/assets/echo-planes.json',import.meta.url)));
 const frames=Object.fromEntries(Object.entries(source.frames).map(([id,f])=>[id,f.world]));
 const model=createTeeContextModel({frames,referenceMm:168.0104,donorId:'1659197537'}),q=createEchoInstrumentClearance(model);
 const s=model.tractSamples.find(p=>p.level==='me'&&p.radialClearanceHintMm>5);
 assert.ok(s);assert.equal(q.point(s.pointMm,{marginMm:1.8}).fits,true);
 assert.equal(q.metadata.wallTriangles,16128);assert.equal(q.metadata.queryCapTriangles,96);assert.ok(q.metadata.headVertices>300);
 const outside=s.pointMm.map((v,i)=>v+1000*(i===0));assert.equal(q.point(outside).inside,false);
});
