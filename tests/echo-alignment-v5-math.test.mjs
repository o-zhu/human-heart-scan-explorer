import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePlanePose,minimumCenterPreservingCorrection} from '../scripts/echo-alignment-v5/audit.mjs';
import {closestPointOnTriangle,evaluateSkinContact} from '../scripts/echo-alignment-v5/surface-checks.mjs';

const plane={center:[0,0,0],normal:[0,0,1],right:[1,0,0],up:[0,1,0],width:2,height:2};
const pose={originMm:[0,1,0],beam:[0,-1,0],right:[1,0,0],normal:[0,0,1],targetMm:[0,0,0],sectorDepthMm:2};
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} differs from ${b}`);

test('shared exact plane admits all fan vertices and forward target',()=>{
 const m=evaluatePlanePose(plane,pose,1);
 assert.equal(m.coplanar,true);near(m.maxFanVertexResidualMm,0);near(m.beamTargetMissMm,0);near(m.beamTargetForwardMm,1);
});
test('parallel displaced fan fails even with identical normals',()=>{
 const m=evaluatePlanePose(plane,{...pose,originMm:[0,1,5]},1);
 assert.equal(m.coplanar,false);near(m.originPlaneResidualMm,5);near(m.sectorPlaneAngleDeg,0);near(m.maxFanVertexResidualMm,5);
});
test('aiming at the CT center alone does not make fan and CT plane coplanar',()=>{
 const s=Math.SQRT1_2,m=evaluatePlanePose(plane,{...pose,originMm:[0,1,1],beam:[0,-s,-s],normal:[0,-s,s]},1);
 near(m.beamTargetMissMm,0);near(m.sectorPlaneAngleDeg,45);near(m.originPlaneResidualMm,1);assert.equal(m.coplanar,false);
});
test('origin on CT plane alone does not authorize a rolled fan',()=>{
 const s=Math.SQRT1_2,m=evaluatePlanePose(plane,{...pose,right:[s,0,s],normal:[-s,0,s]},1);
 near(m.originPlaneResidualMm,0);near(m.sectorPlaneAngleDeg,45);assert.ok(m.maxFanVertexResidualMm>.5);assert.equal(m.coplanar,false);
});
test('a central beam target can differ from the CT rectangle center while the ROI stays in the fan',()=>{
 const a=20*Math.PI/180,beam=[Math.sin(a),-Math.cos(a),0],right=[Math.cos(a),Math.sin(a),0];
 const m=evaluatePlanePose(plane,{...pose,beam,right,targetMm:beam.map((v,i)=>pose.originMm[i]+v*1.5)},1);
 assert.equal(m.coplanar,true);near(m.beamTargetMissMm,0);near(m.roiCenterAngleFromBeamDeg,20);assert.equal(m.roiCenterWithinSector,true);
});
test('coplanarity does not excuse a fan that misses the CT region of interest',()=>{
 const a=50*Math.PI/180,beam=[Math.sin(a),-Math.cos(a),0],right=[Math.cos(a),Math.sin(a),0];
 const m=evaluatePlanePose(plane,{...pose,beam,right,targetMm:beam.map((v,i)=>pose.originMm[i]+v)},1);
 assert.equal(m.coplanar,true);near(m.beamTargetMissMm,0);assert.equal(m.roiCenterWithinSector,false);
});
test('normal polarity and in-plane mirror remain presentation-only',()=>{
 const opposite=evaluatePlanePose({...plane,normal:[0,0,-1]},pose,1);
 const mirrored=evaluatePlanePose({...plane,right:[-1,0,0]},pose,1);
 assert.equal(opposite.coplanar,true);assert.equal(mirrored.coplanar,true);
 near(opposite.displayedBasisHandedness,-1);near(mirrored.displayedBasisHandedness,-1);near(mirrored.sectorVsDisplayedRightDeg,180);
});
test('outside-scan placeholders are not scored as acquired CT agreement',()=>{
 const m=evaluatePlanePose(plane,{...pose,originMm:[10,10,10]},1,{outside:true});
 assert.equal(m.ctComparisonApplicable,false);assert.equal(m.coplanar,false);assert.equal(m.originPlaneResidualMm,undefined);near(m.placeholderPlaneDiagnostics.originPlaneResidualMm,10);
});
test('scale is physical millimetres and known 45 degree correction retains center and origin',()=>{
 const c=minimumCenterPreservingCorrection(plane,[0,1,1],100);
 near(c.angleDeg,45);near(c.normal[1]+c.normal[2],0);near(Math.hypot(...c.normal),1);
 const m=evaluatePlanePose({...plane,center:[0,0,.1]},{...pose,originMm:[0,1,10]},100);
 near(m.originPlaneResidualMm,0);
});
test('degenerate/nonfinite acquisition data fails explicitly',()=>{
 assert.throws(()=>evaluatePlanePose(plane,{...pose,beam:[0,0,0]},1),/nonzero/);
 assert.throws(()=>evaluatePlanePose(plane,{...pose,originMm:[NaN,0,0]},1),/finite/);
 assert.throws(()=>evaluatePlanePose(plane,pose,0),/positive/);
});
test('triangle distances cover interior, edge and vertex independently of pose solver',()=>{
 const a=[0,0,0],b=[2,0,0],c=[0,2,0];
 assert.deepEqual(closestPointOnTriangle([.5,.5,7],a,b,c).point,[.5,.5,0]);
 assert.deepEqual(closestPointOnTriangle([1,2,0],a,b,c).point,[.5,1.5,0]);
 assert.deepEqual(closestPointOnTriangle([-1,-1,0],a,b,c).point,[0,0,0]);
});
test('skin check distinguishes true contact, floating probe, wrong window and outward beam',()=>{
 const vertices=Float32Array.from([0,0,0,0,0,1,2,0,0,0,0,1,0,2,0,0,0,1]);
 const model={bodyTransform:{originMm:[0,0,0],scale:1,referenceOriginMm:[0,0,0],left:[1,0,0],superior:[0,1,0],anterior:[0,0,1]},
  skinSurface:{vertices,referenceVertices:vertices},bodyWindows:{test:{referenceBounds:{min:[0,0,-1],max:[2,2,1]}}}};
 const p={originMm:[.5,.5,0],beam:[0,0,-1]};
 const contact=evaluateSkinContact(p,model,'test');assert.equal(contact.contact,true);assert.equal(contact.withinFixedWindow,true);assert.equal(contact.inwardBeam,true);
 const floating=evaluateSkinContact({...p,originMm:[.5,.5,.01]},model,'test');assert.equal(floating.contact,false);near(floating.surfaceDistanceMm,.01);
 assert.equal(evaluateSkinContact(p,model,'missing').withinFixedWindow,false);
 assert.equal(evaluateSkinContact({...p,beam:[0,0,1]},model,'test').inwardBeam,false);
});
