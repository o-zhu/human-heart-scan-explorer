/** Exact display geometry for the TEE gauge; no clinical/image validation. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {formatMultiplaneAngle,multiplanePoint,multiplaneRange,multiplaneRangePath,multiplaneIndicatorMarkup,teeIllustrationAngleMarkup} from '../public/multiplane-indicator.js';
import {TEE_ATLAS_VIEWS} from '../public/tee-atlas-data.js';
import {TTE_ATLAS_VIEWS} from '../public/tte-atlas-data.js';

test('scanner convention is 0 left, 90 down, and 180 right around one fixed center',()=>{
 assert.deepEqual(multiplanePoint(0),{x:12,y:34});
 assert.deepEqual(multiplanePoint(90),{x:64,y:86});
 assert.deepEqual(multiplanePoint(180),{x:116,y:34});
 const low=multiplanePoint(5),high=multiplanePoint(175);
 assert.ok(low.x<64&&low.y>34);assert.ok(high.x>64&&high.y>34);
 assert.ok(Math.abs(low.x+high.x-128)<1e-4);assert.equal(low.y,high.y);
});

test('numeric readouts remain finite and bounded for edge or unavailable input',()=>{
 for(const value of [undefined,NaN,Infinity,-20]){
  assert.equal(formatMultiplaneAngle(value),'0°');assert.deepEqual(multiplanePoint(value),multiplanePoint(0));
 }
 assert.equal(formatMultiplaneAngle(200),'180°');
 assert.equal(formatMultiplaneAngle(90.25),'90.3°');
 assert.equal(formatMultiplaneAngle('125'),'125°');
});

test('range validation accepts exact endpoints and rejects malformed or reversed intervals',()=>{
 for(const range of [[0,0],[0,180],[90,110],[180,180]]){
  assert.deepEqual(multiplaneRange(range),range);
  assert.notEqual(multiplaneRange(range),range,'Callers cannot mutate the source range through a returned alias');
  assert.ok(multiplaneRangePath(range));assert.doesNotMatch(multiplaneRangePath(range),/NaN|Infinity|undefined/);
 }
 for(const range of [null,[],[1],[1,2,3],[-1,10],[20,181],[80,20],[NaN,10],['0',10]]){
  assert.equal(multiplaneRange(range),null);assert.equal(multiplaneRangePath(range),'');
 }
});

test('a zero-width pulmonary-vein range remains an exact radial mark, not a widened interval',()=>{
 const view=TEE_ATLAS_VIEWS.find(view=>view.id==='merpv');
 assert.deepEqual(view.angleRange,[0,0]);
 assert.equal(multiplaneRangePath(view.angleRange),'M64 34L12 34');
 const markup=teeIllustrationAngleMarkup(view);
 assert.match(markup,/typical multiplane range 0° to 0°/);
 assert.match(markup,/class="multiplane-range"[^>]*d="M64 34L12 34"/);
});

test('every TEE artwork receives its own valid range and TTE receives no multiplane badge',()=>{
 assert.equal(TEE_ATLAS_VIEWS.length,28);
 for(const view of TEE_ATLAS_VIEWS){
  assert.ok(multiplaneRange(view.angleRange),view.id);
  const markup=teeIllustrationAngleMarkup(view,{className:'fixture-angle'});
  assert.match(markup,/multiplane-indicator-range fixture-angle/);
  assert.ok(markup.includes(multiplaneRangePath(view.angleRange)),view.id);
  assert.ok(markup.includes(`range ${view.angleRange[0]}° to ${view.angleRange[1]}°`),view.id);
 }
 for(const view of TTE_ATLAS_VIEWS)assert.equal(teeIllustrationAngleMarkup(view),'',view.id);
 assert.equal(teeIllustrationAngleMarkup({mode:'tee',angleRange:[30,10]}),'');
});

test('live and reference labels remain distinct, accessible, and safely escaped',()=>{
 const ref=multiplaneIndicatorMarkup({angle:45,label:'REF'}),sim=multiplaneIndicatorMarkup({angle:90,label:'SIM'});
 assert.match(ref,/aria-label="Reference multiplane angle 45°"/);assert.match(ref,/>REF<\/text>/);
 assert.match(sim,/aria-label="Simulated multiplane angle 90°"/);assert.match(sim,/>SIM<\/text>/);
 const escaped=multiplaneIndicatorMarkup({ariaLabel:'<value> "angle" & range',className:'sample" data-bad="x'});
 assert.match(escaped,/&lt;value&gt; &quot;angle&quot; &amp; range/);assert.doesNotMatch(escaped,/ data-bad="x"/);
});
