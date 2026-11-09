import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runAudit} from '../scripts/echo-donor-qc-v6/audit.mjs';
import {EchoModule} from '../public/echo.js';
import {validateTeeRegionalReview,reviewedTeeEvidence} from '../public/tee-view-review.js';

let report,defaults;
before(async()=>{
 report=await runAudit({includeAdjustments:false,includeDonors:false,includePrevious:true});
 defaults=report.rows.filter(r=>r.planeReference==='refined');
});

test('all112 primary current/previous defaults keep their CT; only target-losing TG RV poses are withheld',()=>{
 assert.equal(report.sourceStable,true,`Concurrent source changes: ${report.sourceChangedDuringAudit.join(', ')}`);
 assert.equal(defaults.length,56);assert.equal(defaults.filter(r=>r.metrics.ctComparisonApplicable).length,49);
 assert.equal(report.rows.length,112);
 for(const r of report.rows){
  assert.equal(r.handoff.consistent,true,r.id);
  if(!r.metrics.poseAvailable){
   assert.equal(r.id,'tgrvinout');assert.equal(r.plane.acquisition.sourcePlaneRetained,true);
   assert.equal(r.handoff.unavailableOverlayHidden,true);assert.equal(r.handoff.unavailableContextPreserved,true);
   assert.match(r.fit.reason,/preserves this source section/);continue;
  }
  if(r.metrics.ctComparisonApplicable){assert.equal(r.metrics.coplanar,true,r.id);assert.equal(r.metrics.roiCenterWithinSector,true,r.id);assert.ok(r.metrics.beamTargetMissMm<=1e-5,r.id);}
 }
});
test('TTE defaults use actual skin contact, inward beam and declared marker direction',()=>{
 for(const r of defaults.filter(r=>r.mode==='tte')){
  assert.equal(r.skin.contact,true,r.id);assert.equal(r.skin.withinFixedWindow,true,r.id);assert.equal(r.skin.inwardBeam,true,r.id);
  const m=r.metrics.outsideScan?r.metrics.placeholderPlaneDiagnostics:r.metrics;
  if(!r.plane.preferSourcePlane)assert.ok(m.markerReferenceAngleDeg<=1e-4,r.id);
  assert.ok(m.markerReportedAngleDeg<=1e-4,r.id);
 }
});
test('depth/zoom families retain parent acoustic origin, beam and plane',()=>{
 const families=report.zoomFamilies.filter(r=>r.planeReference==='refined');assert.equal(families.length,7);
 for(const family of families)assert.equal(family.consistent,true,family.id);
});
test('apical roll views share contact/beam and A5C/CS tilt in opposite directions',()=>{
 const relations=report.apicalFamilies.filter(r=>r.planeReference==='refined');assert.equal(relations.length,8);
 for(const relation of relations)assert.equal(relation.consistent,true,relation.id);
 const two=relations.find(r=>r.id==='a2c'),three=relations.find(r=>r.id==='a3c');
 assert.ok(Math.abs(two.markerRollDeg+60)<1e-4);assert.ok(Math.abs(three.markerRollDeg+120)<1e-4);
});
test('declared source-guided apical/AV points lie in the accepted planes and scan sectors',()=>{
 const checks=report.landmarkChecks.filter(r=>r.planeReference==='refined'&&r.required);assert.ok(checks.length>=17);
 for(const check of checks)assert.equal(check.consistent,true,`${check.id}: ${check.label}`);
 const deep=checks.filter(r=>r.id==='deeptg5c');assert.deepEqual(deep.map(r=>r.label).sort(),['aorticRoot','apex']);
});
test('seven extracardiac targets have no CT cut or cap agreement claim',()=>{
 const outside=defaults.filter(r=>r.metrics.outsideScan);assert.equal(outside.length,7);
 for(const r of outside){assert.equal(r.handoff.clipEnabled,false,r.id);assert.equal(r.metrics.ctComparisonApplicable,false,r.id);assert.equal(r.metrics.originPlaneResidualMm,undefined,r.id);}
});
test('changed default section bypasses original prepared texture in actual controller',()=>{
 const rows=defaults.filter(r=>r.metrics.ctComparisonApplicable&&r.plane.acquisition?.adjusted);assert.ok(rows.length>10);
 for(const r of rows){
  const nodes=new Map(),queued=[];
  const echo=Object.assign(Object.create(EchoModule.prototype),{
   active:true,state:{preset:r.id,offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false},requestId:0,
   frames:{[r.id]:{outsideScan:false,atlasDerived:false}},presetTextures:{[r.id]:{url:'/audit-never-request-original-texture.png'}},
   renderer:{settings:{cleanupEnabled:true},set(s){Object.assign(this.settings,s);},clearCapData(){}},
   textureCache:{pause(){},peek(){throw new Error(`Reused old prepared pixels for ${r.id}`);}},
   getPlane(){return r.plane;},cancelFine(){},clearSection(){},updateCine(){},updateCorrespondence(){},updateProbe(){},message(){},
   queueFinePlane(plane){queued.push(plane);},
   $(id){if(!nodes.has(id))nodes.set(id,{textContent:'',dataset:{}});return nodes.get(id);}
  });
  try{echo.applyPlane(false,true);assert.equal(queued[0],r.plane,r.id);assert.equal(echo.renderer.settings.oblique,r.plane,r.id);}
  finally{clearTimeout(echo.sampleTimer);clearTimeout(echo.prefetchTimer);}
 }
});
test('new source reformats do not inherit old exact-frame regional evidence',()=>{
 const catalog=validateTeeRegionalReview(JSON.parse(readFileSync(new URL('../public/assets/tee-atlas/regional-review-v3.json',import.meta.url))));
 const changed=defaults.filter(r=>r.mode==='tee'&&r.metrics.ctComparisonApplicable&&r.plane.acquisition?.adjusted);assert.ok(changed.length>5);
 for(const r of changed){
  const evidence=reviewedTeeEvidence(catalog,{id:r.id,donor:{datasetId:'1659197537'},state:{mode:'tee',planeReference:'refined',offsetMm:0,rotationDeg:0,tiltDeg:0},plane:r.plane});
  assert.equal(evidence,null,r.id);
 }
});
test('unavailable pose keeps fixed anatomy visible and suppresses the previous probe and sector',()=>{
 const valid=defaults.find(r=>r.id==='me4c'),nodes=new Map();let installed=0;
 const overlay={running:true,pose:{originMm:[999,999,999]},stop(){this.running=false;},start(){this.running=true;},set(params){Object.assign(this,params);installed++;}};
 const echo=Object.assign(Object.create(EchoModule.prototype),{
  active:true,state:{mode:'tee',preset:'me4c',leftView:'3d',showProbe:true,showSector:true,showContext:true},frames:{me4c:{outsideScan:false}},overlay,tteOverlay:{stop(){}},
  getPlane(){return {...valid.plane,acquisitionPose:undefined,acquisitionUnavailable:true};},anatomyContext(){return {referenceAnatomy:{}};},
  $(id){if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',dataset:{}});return nodes.get(id);}
 });
 echo.updateProbe();assert.equal(overlay.running,true);assert.equal(installed,1);
 assert.equal(overlay.showProbe,false);assert.equal(overlay.showSector,false);assert.equal(overlay.showContext,true);
 assert.match(nodes.get('probe-fit-note').textContent,/No contained probe pose/);
});
