import test from 'node:test';
import assert from 'node:assert/strict';
import {SurfaceLoadProgress,renderSurfaceLoadProgress} from '../public/surface-load-progress.js';
const approximately=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} should equal ${expected}`);

test('32 interleaved transfer, decode, hash and upload blocks retain one stage and monotonic determinate progress',()=>{
 const operation=new SurfaceLoadProgress(),states=[operation.begin(7,'Ultra-High Fidelity')];
 for(let part=0;part<32;part++){
  states.push(operation.update({phase:'download',stage:'download',loadedBytes:(part+1)*4e6,totalBytes:128e6},7));
  states.push(operation.update({phase:'decode',stage:'inflate',loadedBytes:(part+1)*4e6,totalBytes:128e6,decodedBytes:1e6,decodedTotalBytes:12e6},7));
  // Existing bounded hashing reports generic verify-surface even for a single
  // block. It must not announce final verification 32 times.
  states.push(operation.update({phase:'decode',stage:'verify-surface',loadedBytes:12e6,totalBytes:12e6},7));
  states.push(operation.update({phase:'decode',stage:'decode-block',loadedBytes:(part+1)*4e6,totalBytes:128e6},7));
  states.push(operation.update({phase:'upload',stage:'upload-block',uploadedBytes:(part+1)*10e6,totalUploadBytes:320e6},7));
 }
 assert.equal(new Set(states.map(state=>state.label)).size,1);
 assert.equal(new Set(states.map(state=>state.announcement)).size,1);
 assert.ok(states.every((state,index)=>Number.isFinite(state.value)&&state.value>=(states[index-1]?.value??0)&&state.value<1));
 approximately(states.at(-1).value,.78);assert.equal(states.at(-1).detail,'128.0 of 128.0 MB · prepared 100%');
});

test('download, verification and first draw are distinct; only an explicit complete event reaches one',()=>{
 const operation=new SurfaceLoadProgress();operation.begin(3,'Ultra-High Fidelity');
 assert.equal(operation.update({phase:'download',loadedBytes:8,totalBytes:8},3).value,.7);
 approximately(operation.update({phase:'decode',stage:'verify-final',loadedBytes:8,totalBytes:16},3).value,.82);
 assert.equal(operation.setStage('debris',{},3).value,.86);
 assert.equal(operation.setStage('masks',{},3).value,.88);
 approximately(operation.setStage('interiors',{fraction:.5},3).value,.935);
 assert.equal(operation.setStage('graphics',{fraction:1},3).value,.99);
 assert.equal(operation.setStage('first-frame',{},3).value,.99);
 assert.equal(operation.complete(3).value,1);
});

test('part restarts, a larger fallback and late phase updates cannot rewind the bar',()=>{
 const operation=new SurfaceLoadProgress();operation.begin(4,'Ultra-High Fidelity');
 const partial=operation.update({phase:'download',loadedBytes:80e6,totalBytes:128e6},4);
 const retransmitted=operation.update({phase:'download',loadedBytes:16e6,totalBytes:128e6},4);
 assert.equal(retransmitted.value,partial.value);assert.equal(retransmitted.detail,partial.detail);
 const fallback=operation.update({phase:'download',loadedBytes:1e6,totalBytes:227e6},4);
 assert.equal(fallback.value,partial.value);assert.equal(fallback.detail,'1.0 of 227.0 MB');
 const later=operation.setStage('interiors',{},4);
 assert.equal(operation.update({phase:'download',loadedBytes:227e6,totalBytes:227e6},4).label,later.label);
 assert.equal(operation.setStage('masks',{},4).value,later.value);
});

test('stale jobs, cancellation and retries cannot write into another operation',()=>{
 const operation=new SurfaceLoadProgress();operation.begin(1,'Compact Detail');
 operation.update({phase:'download',loadedBytes:10,totalBytes:10},1);
 const replacement=operation.begin(2,'Ultra-High Fidelity');
 assert.equal(replacement.value,0);
 assert.equal(operation.update({phase:'download',loadedBytes:10,totalBytes:10},1),null);
 assert.equal(operation.complete(1),null);assert.equal(operation.snapshot().value,0);
 operation.end(2);assert.equal(operation.update({phase:'download',loadedBytes:10,totalBytes:10},2),null);
 assert.equal(operation.snapshot(),null);
 assert.equal(operation.begin(3,'Ultra-High Fidelity').value,0);
});

test('workspace and background pauses preserve progress and resume the same real stage',()=>{
 const operation=new SurfaceLoadProgress();operation.begin(8,'Ultra-High Fidelity');
 operation.setStage('graphics',{fraction:.5},8);const before=operation.snapshot();
 const paused=operation.setPaused(true,8);assert.equal(paused.value,before.value);assert.match(paused.label,/paused/);
 assert.equal(paused.stage,'graphics');
 const resumed=operation.setPaused(false,8);assert.equal(resumed.value,before.value);assert.equal(resumed.label,before.label);
 assert.equal(resumed.revision,8);
});

test('invalid or unknown counters cannot complete, regress or corrupt progress',()=>{
 const operation=new SurfaceLoadProgress();operation.begin(1,'Ultra-High Fidelity');
 for(const message of [{phase:'download',loadedBytes:NaN,totalBytes:100},{phase:'download',loadedBytes:20,totalBytes:0},{phase:'download',loadedBytes:-1,totalBytes:100},{phase:'download',loadedBytes:Infinity,totalBytes:100},{uploadedBytes:20,totalUploadBytes:0}])assert.equal(operation.update(message,1).value,0);
 assert.equal(operation.setStage('unknown',{},1),null);
 assert.equal(operation.setStage('graphics',{fraction:Infinity},1).value,.96);
 assert.ok(operation.setStage('graphics',{fraction:100},1).value<1);
});

function node(){
 const attributes=new Map();let text='',writes=0;
 return {dataset:{},hidden:true,get textContent(){return text;},set textContent(value){text=value;writes++;},get writes(){return writes;},getAttribute:name=>attributes.get(name)??null,setAttribute:(name,value)=>attributes.set(name,String(value))};
}
test('the same progress node stays determinate and visible, with live announcements only at stage boundaries',()=>{
 const elements=Object.fromEntries(['panel','progress','status','stageText','detailText','announcement'].map(name=>[name,node()]));
 const original=elements.progress,operation=new SurfaceLoadProgress();renderSurfaceLoadProgress(elements,operation.begin(6,'Ultra-High Fidelity'));
 const firstAnnouncements=elements.announcement.writes;
 for(let i=1;i<=50;i++)renderSurfaceLoadProgress(elements,operation.update({phase:'download',loadedBytes:i,totalBytes:50},6));
 assert.equal(elements.progress,original);assert.equal(elements.progress.hidden,false);
 assert.notEqual(elements.progress.getAttribute('value'),null);assert.equal(elements.announcement.writes,firstAnnouncements);
 renderSurfaceLoadProgress(elements,operation.setStage('graphics',{},6));
 assert.equal(elements.progress.hidden,false);assert.notEqual(elements.progress.getAttribute('value'),null);
 assert.equal(elements.announcement.writes,firstAnnouncements+1);
 assert.equal(elements.stageText.textContent,'Preparing graphics');assert.equal(elements.progress.getAttribute('aria-label'),'Surface loading progress');
 assert.match(elements.progress.getAttribute('aria-valuetext'),/Preparing graphics/);
});

test('v52 reconnect notices preserve measured progress and clear only with received bytes',()=>{
 const operation=new SurfaceLoadProgress();operation.begin(9,'Ultra-High Fidelity');
 const previous=operation.update({phase:'download',loadedBytes:35_451_886,totalBytes:131_645_142},9);
 const retry=operation.update({phase:'download',stage:'reconnect',retryAttempt:1,maxRetries:3},9);
 assert.equal(retry.value,previous.value);assert.match(retry.label,/Reconnecting/);assert.match(retry.detail,/Retry 1 of 3/);
 assert.equal(operation.loadedBytes,35_451_886);
 const otherWork=operation.update({phase:'decode',stage:'verify-surface',loadedBytes:1,totalBytes:2},9);
 assert.equal(otherWork.label,retry.label,'Processing does not pretend a broken transfer resumed.');
 const paused=operation.setPaused(true,9);assert.match(paused.label,/paused/);assert.equal(paused.value,previous.value);
 assert.match(operation.setPaused(false,9).label,/Reconnecting/);
 const recovered=operation.update({phase:'download',stage:'download',loadedBytes:35_452_886,totalBytes:131_645_142},9);
 assert.match(recovered.label,/Loading and preparing/);assert.ok(recovered.value>=previous.value);
 operation.setStage('interiors',{},9);
 assert.match(operation.update({stage:'reconnect',retryAttempt:3,maxRetries:3},9).label,/interior/,'Late transfer notices cannot replace later stages.');
});

test('v52 preparation advances visibly while downloaded megabytes remain at a block boundary',()=>{
 const operation=new SurfaceLoadProgress();operation.begin(10,'Ultra-High Fidelity');
 operation.update({phase:'download',loadedBytes:35_451_886,totalBytes:131_645_142},10);
 const a=operation.update({uploadedBytes:40_000_000,totalUploadBytes:437_470_488},10);
 const b=operation.update({uploadedBytes:44_000_000,totalUploadBytes:437_470_488},10);
 assert.equal(a.label,b.label);assert.equal(a.announcement,b.announcement);
 assert.match(a.detail,/35\.5 of 131\.6 MB · prepared 9%/);
 assert.match(b.detail,/35\.5 of 131\.6 MB · prepared 10%/);assert.ok(b.value>a.value);
});

test('v53 staged acquisition stays Downloading until its verified barrier, then preparation advances independently',()=>{
 const operation=new SurfaceLoadProgress();operation.begin(11,'Ultra-High Fidelity');
 operation.update({phase:'download',stage:'download-start',sequential:true},11);
 const values=[];
 for(let part=1;part<=32;part++){
  const state=operation.update({phase:'download',stage:'download',loadedBytes:part*4e6,totalBytes:128e6},11);
  assert.equal(state.label,'Downloading surface');assert.doesNotMatch(state.detail,/prepared/);values.push(state.value);
 }
 assert.equal(operation.snapshot().stage,'transfer','Received bytes alone do not prove that all files have been verified and closed.');
 const prepared=operation.update({phase:'decode',stage:'download-complete',sequential:true,downloadedBytes:128e6,downloadTotalBytes:128e6},11);
 assert.equal(prepared.stage,'prepare');assert.equal(prepared.label,'Preparing surface');assert.equal(prepared.detail,'0% prepared');
 const advanced=operation.update({uploadedBytes:44,totalUploadBytes:100},11);
 assert.equal(advanced.label,'Preparing surface');assert.equal(advanced.detail,'44% prepared');values.push(prepared.value,advanced.value);
 assert.ok(values.every((value,i)=>value>=(values[i-1]??0)));
 operation.setPaused(true,11);assert.match(operation.snapshot().label,/paused/);
 assert.equal(operation.setPaused(false,11).label,'Preparing surface');
 assert.equal(operation.update({phase:'download',stage:'reconnect',retryAttempt:1,maxRetries:3},11).label,'Preparing surface');
 assert.equal(operation.update({phase:'decode',stage:'verify-final',final:true},11).label,'Checking surface');
 assert.equal(operation.update({stage:'download-start',sequential:true},11).label,'Checking surface');
});

test('v53 unavailable staging retains honest serial progress and malformed barriers cannot advance a phase',()=>{
 const operation=new SurfaceLoadProgress();operation.begin(12,'Ultra-High Fidelity');
 operation.update({stage:'download-start',sequential:true},12);
 operation.update({phase:'download',loadedBytes:35_451_886,totalBytes:131_645_142},12);
 for(const counters of [{downloadedBytes:1,downloadTotalBytes:2},{downloadedBytes:Infinity,downloadTotalBytes:Infinity},{downloadedBytes:0,downloadTotalBytes:0}]){
  assert.equal(operation.update({stage:'download-complete',sequential:true,...counters},12).stage,'transfer');
 }
 const value=operation.snapshot().value;
 const fallback=operation.update({stage:'streaming-fallback',sequential:false},12);
 assert.equal(fallback.stage,'transfer');assert.equal(fallback.label,'Loading and preparing surface');assert.equal(fallback.value,value);
 const progress=operation.update({phase:'download',loadedBytes:35_451_886,totalBytes:131_645_142,uploadedBytes:10,totalUploadBytes:100},12);
 assert.match(progress.detail,/35\.5 of 131\.6 MB · prepared 10%/);
 assert.ok(progress.value>=value);
});

test('v53 deliberate original-transport fallback can restart its phase without resetting the bar',()=>{
 const operation=new SurfaceLoadProgress();operation.begin(13,'Ultra-High Fidelity');
 operation.update({stage:'download-start',sequential:true},13);
 operation.update({stage:'download-complete',sequential:true,downloadedBytes:100,downloadTotalBytes:100},13);
 operation.update({uploadedBytes:80,totalUploadBytes:100},13);
 const old=operation.snapshot();const fallback=operation.restartTransfer(13);
 assert.equal(fallback.stage,'transfer');assert.equal(fallback.value,old.value);assert.equal(fallback.detail,'The current view stays usable');
 assert.equal(operation.update({phase:'download',loadedBytes:1,totalBytes:227},13).value,old.value);
 assert.equal(operation.restartTransfer(12),null);
});

test('v53 a lost staged part has an explicit recovery state without rewinding the preparation phase',()=>{
 const operation=new SurfaceLoadProgress();operation.begin(14,'Ultra-High Fidelity');
 operation.update({stage:'download-start',sequential:true},14);
 operation.update({stage:'download-complete',sequential:true,downloadedBytes:100,downloadTotalBytes:100},14);
 const prepared=operation.update({uploadedBytes:40,totalUploadBytes:100},14);
 const restoring=operation.update({stage:'streaming-fallback',sequential:false},14);
 assert.equal(restoring.label,'Restoring surface data');assert.equal(restoring.stage,'prepare');assert.equal(restoring.value,prepared.value);
 const retry=operation.update({stage:'reconnect',retryAttempt:2,maxRetries:3},14);
 assert.equal(retry.label,'Reconnecting download…');assert.match(retry.detail,/Retry 2 of 3/);assert.equal(retry.value,prepared.value);
 operation.update({uploadedBytes:40,totalUploadBytes:100},14);assert.equal(operation.snapshot().label,'Reconnecting download…','A duplicate upload count is not resumed preparation.');
 const resumed=operation.update({uploadedBytes:45,totalUploadBytes:100},14);
 assert.equal(resumed.label,'Preparing surface');assert.equal(resumed.detail,'45% prepared');assert.ok(resumed.value>prepared.value);
});

test('v53 every missing staged part exposes recovery after preparation has resumed',()=>{
 const operation=new SurfaceLoadProgress();operation.begin(15,'Ultra-High Fidelity');
 operation.update({stage:'download-start',sequential:true},15);
 operation.update({stage:'download-complete',sequential:true,downloadedBytes:100,downloadTotalBytes:100},15);
 for(const uploaded of [20,40,60]){
  const before=operation.update({uploadedBytes:uploaded,totalUploadBytes:100},15);
  assert.equal(before.label,'Preparing surface');
  const restoring=operation.update({phase:'download',stage:'restore-start',sequential:false},15);
  assert.equal(restoring.label,'Restoring surface data');assert.equal(restoring.value,before.value);
  const reconnect=operation.update({stage:'reconnect',retryAttempt:1,maxRetries:3},15);
  assert.equal(reconnect.label,'Reconnecting download…');assert.equal(reconnect.stage,'prepare');
  assert.match(operation.setPaused(true,15).label,/paused/);
  assert.equal(operation.setPaused(false,15).label,'Reconnecting download…');
 }
 operation.setStage('verify',{},15);
 assert.equal(operation.update({stage:'restore-start',sequential:false},15).label,'Checking surface');
 assert.equal(operation.update({stage:'reconnect',retryAttempt:1,maxRetries:3},15).label,'Checking surface');
});
