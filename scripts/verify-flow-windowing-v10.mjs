import assert from 'node:assert/strict';
import fs from 'node:fs';
import {FlowViewsModule,paintFlowSection} from '../public/flow-views.js';
import {paintEchoPreview} from '../public/echo.js';
import {capColor} from '../public/render-styles.js';

const grid={intensity:Uint8Array.from({length:256},(_,i)=>i),support:new Uint8Array(256).fill(1),labels:new Uint8Array(256),hasAnatomy:false};
const settings={palette:4,threshold:.64,capContrast:.9,windowEnabled:true,windowLow:.57,windowHigh:.94,windowGamma:1.2,cleanupEnabled:true};
const flow=paintFlowSection(grid,settings,settings.capContrast,[]),echo=paintEchoPreview(grid,settings,settings.capContrast,[]);
assert.deepEqual(flow,echo,'Flow and echo must apply the same window to the same measured values');
for(let value=0;value<256;value++){
 const expected=new Uint8ClampedArray(4),color=value&&value/255>=settings.threshold?capColor(value/255,settings.capContrast,settings.palette,settings):[0,0,0];
 for(let c=0;c<3;c++)expected[c]=Math.pow(Math.max(0,color[c]),.89)*255;
 expected[3]=255;assert.deepEqual(flow.slice(value*4,value*4+4),expected);
}

// Minimal host elements exercise the module's actual state transitions, without
// a WebGL context or a duplicate implementation of its appearance policy.
const nodes=new Map();
const element=()=>({classList:{add(){},toggle(){}},addEventListener(){},setAttribute(){},querySelector(){return this;},querySelectorAll(){return [];},value:'',textContent:'',innerHTML:'',checked:false,disabled:false});
const mount=element();mount.querySelector=selector=>{if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);};
const renderer={settings:{...settings},set(patch){Object.assign(this.settings,patch);},clearCapData(){},camera:{distance:1},alignPlane(){}};
const module=new FlowViewsModule({renderer,mount,donor:{geometricComparisonOnly:true,specimen:'Windowing test'}});
assert.equal(module.state.threshold,.64);assert.equal(module.state.contrast,.9);
module.reset();assert.equal(renderer.settings.threshold,.64);assert.equal(renderer.settings.capContrast,.9);
module.restore({preset:'rv-outflow'});assert.equal(module.state.threshold,.64);assert.equal(module.state.contrast,.9);
module.restore({threshold:.81,contrast:1.1});assert.equal(renderer.settings.threshold,.81);assert.equal(renderer.settings.capContrast,1.1);
renderer.set({threshold:.73,capContrast:.85});module.updateAppearance();assert.equal(module.state.threshold,.73);assert.equal(module.state.contrast,.85);
module.restore({preset:'rv-inflow'});module.data=new Uint8Array([100]);module.longestMm=80;
module.presets=[{id:'rv-inflow',world:{center:[0,0,0],target:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:1,height:1}}];
module.active=true;module.applyPlane(false,false,true);clearTimeout(module.sampleTimer);module.active=false;
assert.equal(renderer.settings.threshold,.73);assert.equal(renderer.settings.capContrast,.85);
assert.equal(nodes.get('[data-flow="material"]').disabled,true,'Anatomy colors are unavailable for geometric comparisons');
const report={passed:true,comparedIntensityValues:256,flowMatchesEcho:true,flowMatchesWindowedCPU:true,
 constructorInheritsAppearance:true,resetPreservesAppearance:true,restoreWithoutAppearancePreservesDonor:true,
 explicitAppearanceRestoreWorks:true,globalAppearanceUpdatesControls:true,planeChangesPreserveAppearance:true,
 thresholdsAboveFiftyPercentSupported:true,unassignedAnatomyDisabled:true};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
