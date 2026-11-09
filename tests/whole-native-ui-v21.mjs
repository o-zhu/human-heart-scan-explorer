/** Real page bindings and controller with small GPU/worker fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { NativeEdgeLoader, nativeToWorld } from '../public/native-edge-loader.js';
import { WholeNativeViewer } from '../public/whole-native.js';
import { parseNativeMesh } from '../public/native-mesh-format.js';
import { OVERVIEW_FACE_FILTERS } from '../public/overview-noise-filters.js';

const entry=process.argv[2];
if(!entry)throw new Error('Pass the installed LinkeDOM ESM entry point.');
const {parseHTML}=await import(pathToFileURL(entry));
const html=await readFile(new URL('../public/whole-native.html',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function mesh(triangles = 1) {
  const buffer=new ArrayBuffer(88+triangles*12);
  new Uint32Array(buffer,0,8).set([0x314d4648,1,3,triangles*3,32,68,88,1]);
  new Float32Array(buffer,32,9).set([-.1,-.1,0,.1,-.1,0,0,.1,0]);
  new Int16Array(buffer,68,9).set([0,0,32767,0,0,32767,0,0,32767]);
  const indices=new Uint32Array(buffer,88,triangles*3);
  for(let i=0;i<triangles;i++)indices.set(i%2?[0,2,1]:[0,1,2],i*3);
  return parseNativeMesh(buffer,buffer.byteLength);
}

const nativeResult = mode => ({pieces:8,triangles:mode==='original'?16:8,sourceTriangles:16,
  suppressedTriangles:mode==='original'?0:8,cleanupView:mode,
  cleanup:mode==='original'?null:{removedComponents:2,removedSamples:8}});

async function fixture(t, { overviewParts = 1, pilot = false, qualities = false, overviewLods = null, noWebgl = false, overviewRepair = false } = {}) {
  const {document,window}=parseHTML(html),workers=[],frames=[],draws=[],deleted=[],uniforms=[];
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(value){this._value=String(value);}});
  window.HTMLCanvasElement.prototype.getBoundingClientRect=()=>({width:600,height:400,left:0,top:0});
  window.HTMLCanvasElement.prototype.setPointerCapture=()=>{};
  window.HTMLCanvasElement.prototype.getContext=function(){if(noWebgl)return null;const canvas=this;let serial=0,program;return new Proxy({
    NO_ERROR:0,FRAMEBUFFER_COMPLETE:1,getError:()=>0,getShaderParameter:()=>true,getProgramParameter:()=>true,
    createShader:()=>({}),createProgram:()=>({id:++serial}),createBuffer:()=>({id:++serial}),createVertexArray:()=>({id:++serial}),
    getUniformLocation:(_,name)=>name,useProgram:value=>{program=value;},
    uniform3fv:(name,value)=>uniforms.push({canvas:canvas.id,program,name,value:Array.from(value)}),
    uniform1f:(name,value)=>uniforms.push({canvas:canvas.id,program,name,value}),
    uniform1i:(name,value)=>uniforms.push({canvas:canvas.id,program,name,value}),
    deleteBuffer:buffer=>deleted.push(buffer),drawElements:()=>draws.push(canvas.id),checkFramebufferStatus:()=>1,
    readPixels:(x,y,w,h,format,type,out)=>out.set([4544,4032,4672,1]),
  },{get(target,key){return key in target?target[key]:/^[A-Z_]+$/.test(key)?1:()=>{};}});};
  // The UI fixture partitions 16 original triangles into 8 retained and 8 removed.
  // Actual native labeling and source-count integrity are tested in the worker suite.
  const record=xyz=>({xyz,url:`https://heart.test/${xyz.join('_')}.gz`,sha256:'a'.repeat(64),bytes:100,decodedBytes:200,triangles:16,vertices:24});
  const manifest={schema:'guided-native-v21',complete:pilot,completeScope:pilot?'pilot-only':'whole-plan',dimensionsXYZ:[7614,7614,8480],sourceSpacingUm:19.85,
    tiles:[record([35,31,36]),record([36,31,36]),record([35,30,36])],
    overview:{id:'overview',label:'Whole-heart display overview',triangles:overviewParts,parts:Array.from({length:overviewParts},(_,i)=>({url:`https://heart.test/overview-${i}.gz`,sha256:'b'.repeat(64),compressedBytes:100,decodedBytes:200,triangles:1}))},
    coverage:{plannedBlocks:pilot?3:20,completedBlocks:3,nativeOnlyEdgeVertices:50,blendedEdgeVertices:30,priorOnlyEdgeVertices:20}};
  if(qualities){
    const overview={...manifest.overview,triangles:1500000};
    const detail={...overview,id:'detail',label:'Whole-heart display detail',triangles:2500000,
      parts:overview.parts.map((part,i)=>({...part,url:`detail-${i}.gz`,sha256:'c'.repeat(64)}))};
    manifest.overviewLods=[detail,overview];manifest.overview=detail;
  }
  if(overviewLods){manifest.overviewLods=overviewLods;manifest.overview=overviewLods.find(lod=>lod.id==='overview')||overviewLods[0];}
  const loader=new NativeEdgeLoader({baseUrl:'https://heart.test/whole-native.html',createWorker:()=>{const worker={messages:[],postMessage(data){this.messages.push(data);},terminate(){this.stopped=true;}};workers.push(worker);return worker;}});
  const viewer=new WholeNativeViewer({document,window,loader,requestFrame:fn=>frames.push(fn)});
  // Keep overview-repair tests explicit if its product default changes separately.
  viewer.overviewRepair=overviewRepair;document.getElementById('overviewRepair').checked=overviewRepair;
  t.after(()=>viewer.dispose());
  const emit=data=>workers[0].onmessage({data});
  const activeId=kind=>{assert.equal(loader.active?.kind,kind,`Expected an active ${kind} request.`);return loader.active.id;};
  const boot=viewer.boot();emit({type:'done',id:activeId('manifest'),result:{manifest,baseUrl:'https://heart.test/manifest.json'}});await boot;await settle();
  const piece=async(id,index,total=8,decoded=mesh())=>{assert.equal(loader.active?.id,id,'Fixture pieces must target the active request.');emit({type:'piece',id,index,total,mesh:decoded});await settle();};
  const done=async(id,result)=>{emit({type:'done',id,result});await settle();};
  const complete=async id=>{const mode=loader.active.record.cleanupView??'original';for(let i=0;i<8;i++)await piece(id,i,8,mesh(mode==='original'?2:1));await done(id,nativeResult(mode));};
  const completeOverview=async()=>{const id=activeId('overview'),total=loader.active.record.parts.length;for(let i=0;i<total;i++)await piece(id,i,total);await done(id,{pieces:total,triangles:total});};
  const ready=async()=>{await complete(activeId('tile'));await completeOverview();};
  const draw=()=>{for(const fn of frames.splice(0))fn();};
  const get=id=>document.getElementById(id);
  return {document,window,viewer,loader,workers,emit,piece,done,complete,completeOverview,ready,activeId,draw,draws,deleted,uniforms,get};
}

test('Failed WebGL creation preserves the graphics error when real overview assets exist', {timeout:5000},async t=>{
  const overviewLods=[
    {id:'overview',label:'Whole-heart display overview',triangles:1499999,parts:[{
      url:'https://human-heart-scan-explorer.zhuou557737.chatgpt.site/api/guided-native-v21/overview/whole-overview-0-f4d04fcc0eca1beda15f78794debb84c370b937cb64230a6b33ca583f3a2664e.hfm.gz',
      sha256:'f4d04fcc0eca1beda15f78794debb84c370b937cb64230a6b33ca583f3a2664e',
      compressedBytes:11012293,decodedBytes:24642580,vertices:369031,triangles:1499999
    }]},
    {id:'detail',label:'Whole-heart display detail',triangles:2500000,parts:[{
      url:'https://human-heart-scan-explorer.zhuou557737.chatgpt.site/api/guided-native-v21/overview/whole-detail-0-b690678f8a19fa24e5237e499275e8ac8aa94f1002365d441d6468e0f12cd2ef.hfm.gz',
      sha256:'b690678f8a19fa24e5237e499275e8ac8aa94f1002365d441d6468e0f12cd2ef',
      compressedBytes:19744361,decodedBytes:42582052,vertices:699001,triangles:2500000
    }]}
  ];
  const f=await fixture(t,{overviewLods,noWebgl:true});
  assert.equal(f.viewer.overviewChoices.size,2);
  assert.equal(f.viewer.panes.overview,undefined);assert.equal(f.viewer.panes.detail,undefined);
  for(const id of ['overviewMessage','detailMessage']){
    assert.match(f.get(id).textContent,/WebGL 2 is unavailable/);
    assert.equal(f.get(id).hidden,false);
  }
  assert.doesNotMatch(f.get('overviewMessage').textContent,/not included/);
  assert.equal(f.get('overviewQualityControl').hidden,false);
  assert.equal(f.get('overviewQuality').querySelectorAll('option').length,2);
  assert.equal(f.get('overviewQuality').disabled,true);
  assert.equal(f.get('cleanupView').disabled,true);
  assert.equal(f.get('overviewRepair').disabled,true);
  assert.equal(f.get('coverageMetric').textContent,'3 / 20');
  assert.equal(f.get('nativeMetric').textContent,'50.0% native');
  assert.equal(f.get('regionProgressText').textContent,'Graphics unavailable');
  assert.equal(Number(f.get('regionProgress').value),0);
  assert.deepEqual(f.workers[0].messages.filter(message=>message.type==='load').map(message=>message.kind),['manifest']);
  assert.equal(f.loader.active,null);
  assert.equal(f.loader.pending.size,0);
});

test('The inspector displays native geometry before the overview and commits only complete current regions', {timeout:5000},async t=>{
  const f=await fixture(t);
  assert.match(f.get('coverageStatus').textContent,/incomplete/);assert.equal(f.get('nativeMetric').textContent,'50.0% native');
  assert.equal(f.workers.length,1);const initialId=f.activeId('tile');
  assert.equal(f.loader.pending.get('overview')?.kind,'overview');
  assert.deepEqual(f.workers[0].messages.filter(item=>item.type==='load').map(item=>item.kind),['manifest','tile']);
  await f.piece(initialId,0);assert.match(f.get('detailLabel').textContent,/No region/);assert.equal(f.viewer.panes.detail.meshes.length,0);
  for(let i=1;i<8;i++)await f.piece(initialId,i);await f.done(initialId,{pieces:8,triangles:8});f.draw();
  assert.equal(f.get('detailLabel').textContent,'Displayed block [35, 31, 36]');
  assert.deepEqual(f.viewer.panes.detail.camera.center,nativeToWorld([4544,4032,4672]));
  assert.equal(f.get('triangleMetric').textContent,'8');assert.equal(f.get('regionForm').hasAttribute('aria-busy'),false);
  assert.equal(f.viewer.panes.overview.meshes.length,0);assert.equal(f.viewer.displayedOverview,undefined);
  assert.equal(f.viewer.loading,false);assert.equal(f.viewer.overviewLoading,true);assert.equal(f.loader.active.kind,'overview');
  assert.match(f.get('pageStatus').textContent,/Native region ready/);assert.ok(f.draws.includes('detailCanvas'));
  await f.completeOverview();f.draw();
  assert.ok(f.draws.includes('overviewCanvas'));assert.ok(f.draws.includes('detailCanvas'));
  const firstMeshes=f.viewer.panes.detail.meshes.slice();

  const b=f.viewer.selectRegion([4672,4032,4672]);await settle();const oldId=f.loader.active.id;
  await f.piece(oldId,0);assert.deepEqual(f.viewer.panes.detail.meshes,firstMeshes,'Partial replacement must not replace the current geometry.');
  const c=f.viewer.selectRegion([4544,3904,4672]);await settle();
  assert.match(f.get('detailHeading').textContent,/35, 30, 36/);assert.match(f.get('detailLabel').textContent,/35, 31, 36/);
  assert.equal(f.get('coordinateY').value,'3904');
  f.emit({type:'piece',id:oldId,index:1,total:8,mesh:mesh()});await settle();
  f.emit({type:'done',id:oldId,error:'cancelled',aborted:true});await settle();
  const newId=f.loader.active.id;await f.complete(newId);await b;await c;f.draw();
  assert.equal(f.get('detailLabel').textContent,'Displayed block [35, 30, 36]');
  assert.equal(f.get('markerText').textContent,'Displayed region');

  const failing=f.viewer.selectRegion([4672,4032,4672]);await settle();
  f.emit({type:'done',id:f.loader.active.id,error:'Checksum did not match.'});await failing;
  assert.equal(f.get('detailLabel').textContent,'Displayed block [35, 30, 36]');
  assert.match(f.get('requestError').textContent,/Still displaying block \[35, 30, 36\]/);
  assert.equal(f.get('requestError').hidden,false);assert.equal(f.get('regionForm').hasAttribute('aria-busy'),false);
  f.viewer.dispose();
});

test('Returning to displayed geometry clears pending state; nearest selection and camera independence remain explicit', {timeout:5000},async t=>{
  const f=await fixture(t);await f.ready();
  const next=f.viewer.selectRegion([4672,4032,4672]);await settle();const oldId=f.loader.active.id;
  await f.viewer.selectRegion([4544,4032,4672]);await next;
  assert.equal(f.get('regionForm').hasAttribute('aria-busy'),false);assert.equal(f.get('regionProgressText').textContent,'Region ready');
  f.emit({type:'done',id:oldId,error:'cancelled',aborted:true});await settle();
  for(const id of ['coordinateX','coordinateY','coordinateZ'])f.get(id).value='0';
  f.get('regionForm').dispatchEvent(new f.window.Event('submit',{cancelable:true}));await settle();assert.match(f.get('selectionStatus').textContent,/Nearest available block/);assert.match(f.get('selectionStatus').textContent,/requested block \[0, 0, 0\] is unavailable/);
  await f.complete(f.loader.active.id);
  const overviewYaw=f.viewer.panes.overview.camera.yaw,detailYaw=f.viewer.panes.detail.camera.yaw;
  const event=new f.window.Event('keydown',{cancelable:true});event.key='ArrowLeft';f.get('overviewCanvas').dispatchEvent(event);
  assert.equal(f.viewer.panes.overview.camera.yaw,overviewYaw+.08);assert.equal(f.viewer.panes.detail.camera.yaw,detailYaw);
  f.viewer.dispose();
});

test('Context loss retains the other pane and restores the selected native region without stale uploads', {timeout:5000},async t=>{
  const f=await fixture(t);await f.ready();
  f.get('detailCanvas').dispatchEvent(new f.window.Event('webglcontextlost',{cancelable:true}));
  assert.equal(f.viewer.panes.detail.lost,true);assert.equal(f.viewer.panes.overview.meshes.length,1);assert.match(f.get('pageStatus').textContent,/other view remains/);
  f.get('detailCanvas').dispatchEvent(new f.window.Event('webglcontextrestored'));await settle();
  assert.equal(f.viewer.panes.detail.lost,false);await f.complete(f.loader.active.id);
  assert.equal(f.get('detailLabel').textContent,'Displayed block [35, 31, 36]');assert.equal(f.get('regionProgressText').textContent,'Region ready');
  f.viewer.dispose();
});

test('Multipart overviews commit as a complete set and pilot completion never claims whole-heart coverage', {timeout:5000},async t=>{
  const f=await fixture(t,{overviewParts:2,pilot:true});
  assert.match(f.get('coverageStatus').textContent,/Pilot regions only/);assert.match(f.get('coverageNote').textContent,/incomplete whole-heart/);
  await f.complete(f.activeId('tile'));const initialOverviewId=f.activeId('overview');
  await f.piece(initialOverviewId,0,2);assert.equal(f.viewer.panes.overview.meshes.length,0);
  await f.piece(initialOverviewId,1,2);assert.equal(f.viewer.panes.overview.meshes.length,0);
  await f.done(initialOverviewId,{pieces:2,triangles:2});assert.equal(f.viewer.panes.overview.meshes.length,2);
  const old=f.viewer.panes.overview.meshes.slice();
  const replacement=f.viewer.loadOverview();await settle();const id=f.loader.active.id;
  await f.piece(id,0,2);assert.deepEqual(f.viewer.panes.overview.meshes,old);
  f.emit({type:'done',id,error:'Second overview part did not load.'});await replacement;
  assert.deepEqual(f.viewer.panes.overview.meshes,old);assert.match(f.get('overviewMessage').textContent,/Second overview part/);
  f.viewer.dispose();
});

test('Quality selection defaults to overview and commits labels only with complete current geometry', {timeout:5000},async t=>{
  const f=await fixture(t,{overviewParts:2,qualities:true}),select=f.get('overviewQuality');
  assert.equal(f.get('overviewQualityControl').hidden,false);
  assert.equal(select.querySelectorAll('option').length,2);
  assert.equal(select.value,'overview');assert.equal(f.loader.pending.get('overview')?.record.id,'overview');
  assert.match(select.textContent,/1.5M triangles/);assert.match(select.textContent,/2.5M triangles/);
  await f.ready();
  const old=f.viewer.panes.overview.meshes.slice(),label=f.get('overviewLabel').textContent;
  const overviewCamera=structuredClone(f.viewer.panes.overview.camera),detailCamera=structuredClone(f.viewer.panes.detail.camera);
  assert.match(f.get('overviewDetail').textContent,/1,500,000 overview triangles/);
  const choose=async id=>{select.value=id;select.dispatchEvent(new f.window.Event('change'));await settle();return f.loader.active.id;};
  let id=await choose('detail');assert.equal(f.loader.active.record.parts[0].url,'https://heart.test/detail-0.gz');
  assert.equal(select.getAttribute('aria-busy'),'true');
  await f.piece(id,0,2);assert.deepEqual(f.viewer.panes.overview.meshes,old);assert.equal(f.get('overviewLabel').textContent,label);
  f.emit({type:'done',id,error:'Detail quality checksum did not match.'});await settle();
  assert.deepEqual(f.viewer.panes.overview.meshes,old);assert.equal(f.get('overviewLabel').textContent,label);
  assert.equal(select.value,'overview');assert.equal(select.hasAttribute('aria-busy'),false);
  assert.equal(f.viewer.overviewRetryId,'detail');
  id=await choose('detail');await f.piece(id,0,2);const stale=id;
  select.value='overview';select.dispatchEvent(new f.window.Event('change'));await settle();
  f.emit({type:'done',id:stale,error:'cancelled',aborted:true});await settle();id=f.loader.active.id;
  f.emit({type:'piece',id:stale,index:1,total:2,mesh:mesh()});f.emit({type:'done',id:stale,result:{pieces:2}});await settle();
  assert.deepEqual(f.viewer.panes.overview.meshes,old);assert.equal(f.get('overviewLabel').textContent,label);
  await f.piece(id,0,2);await f.piece(id,1,2);await f.done(id,{pieces:2});
  id=await choose('detail');await f.piece(id,0,2);await f.piece(id,1,2);
  assert.equal(f.get('overviewLabel').textContent,label);assert.equal(f.viewer.displayedOverview.id,'overview');
  await f.done(id,{pieces:2});
  assert.equal(f.viewer.displayedOverview.id,'detail');assert.equal(f.get('overviewLabel').textContent,'Whole-heart display detail');
  assert.match(f.get('overviewDetail').textContent,/2,500,000 overview triangles/);assert.equal(select.value,'detail');
  assert.deepEqual(f.viewer.panes.overview.camera,overviewCamera);assert.deepEqual(f.viewer.panes.detail.camera,detailCamera);
  assert.deepEqual(f.viewer.targetTile.xyz,[35,31,36]);assert.deepEqual(f.viewer.displayedTile.xyz,[35,31,36]);
  f.viewer.dispose();
});

test('Overview sections span source axes, render and pick the same cut, and leave native controls independent', {timeout:5000},async t=>{
  const f=await fixture(t);await f.ready();
  assert.equal(f.get('overviewQualityControl').hidden,true);
  assert.equal(f.get('overviewCutPosition').disabled,true);assert.equal(f.get('overviewFlipSection').disabled,true);
  const change=(id,value,event='change')=>{f.get(id).value=value;f.get(id).dispatchEvent(new f.window.Event(event));};
  change('cutAxis','y');change('cutPosition','20','input');
  const detailCut={...f.viewer.cut},detailCamera=structuredClone(f.viewer.panes.detail.camera);
  change('overviewCutAxis','x');change('overviewCutPosition','75','input');
  f.get('overviewFlipSection').dispatchEvent(new f.window.Event('click'));
  assert.deepEqual(f.viewer.overviewCut,{axis:'x',position:.75,flip:true});assert.deepEqual(f.viewer.cut,detailCut);
  assert.equal(f.get('overviewCutPosition').disabled,false);assert.equal(f.get('overviewFlipSection').getAttribute('aria-pressed'),'true');
  assert.equal(f.get('overviewCutPositionText').textContent,'75%');
  const pane=f.viewer.panes.overview;pane.camera.center=[.2,.3,.4];pane.camera.pan=[.1,-.15];
  f.draw();
  const values=program=>Object.fromEntries(f.uniforms.filter(item=>item.program===program).map(item=>[item.name,item.value]));
  let rendered=values(pane.renderProgram.program);
  assert.equal(rendered.uCutEnabled,1);assert.deepEqual(rendered.uCutAxis,[1,0,0]);assert.equal(rendered.uCutSign,-1);
  assert.equal(rendered.uCutValue,.25*7613/8479);
  pane.pick(300,200,f.viewer.overviewCut);const picked=values(pane.pickProgram.program);
  for(const key of ['uCutEnabled','uCutAxis','uCutSign','uCutValue'])assert.deepEqual(picked[key],rendered[key]);
  for(const [axis,vector,span] of [['x',[1,0,0],7613/8479],['y',[0,0,-1],7613/8479],['z',[0,1,0],1]]){
    for(const position of [0,.5,1]){
      pane.setUniforms(pane.renderProgram,pane.meshes[0],1.5,{axis,position,flip:false});rendered=values(pane.renderProgram.program);
      assert.deepEqual(rendered.uCutAxis,vector);assert.equal(rendered.uCutValue,(position-.5)*span);
    }
  }
  const detail=values(f.viewer.panes.detail.renderProgram.program);
  assert.equal(detail.uCutValue,-detailCamera.center[2]+(.2-.5)*128/8479,'Detail retains the selected region extent and center.');
  let passedCut;
  pane.pick=(x,y,cut)=>{assert.deepEqual([x,y],[300,200]);passedCut=cut;return null;};
  for(const type of ['pointerdown','pointerup']){const event=new f.window.Event(type);Object.assign(event,{clientX:300,clientY:200,pointerId:1,button:0});pane.canvas.dispatchEvent(event);}
  assert.equal(passedCut,f.viewer.overviewCut);assert.deepEqual(f.viewer.panes.detail.camera,detailCamera);assert.deepEqual(f.viewer.cut,detailCut);
  change('overviewCutAxis','none');assert.equal(f.get('overviewCutPosition').disabled,true);assert.equal(f.get('overviewFlipSection').disabled,true);
  assert.deepEqual(f.viewer.cut,detailCut);f.viewer.dispose();
});

test('Native cleanup starts cleaned and Original/Removed changes retain the same-block camera and old labels until all pieces commit', {timeout:5000},async t=>{
  const f=await fixture(t,{overviewRepair:false}),select=f.get('cleanupView');
  assert.equal(f.viewer.cleanupView,'cleaned');assert.equal(select.value,'cleaned');assert.equal(select.disabled,false);
  assert.equal(f.loader.active.record.cleanupView,'cleaned');
  assert.equal(select.querySelector('option[value="cleaned"]').hasAttribute('selected'),true);
  await f.ready();
  assert.equal(f.viewer.displayedCleanupView,'cleaned');assert.match(f.get('detailCleanupLabel').textContent,/Cleaned surface/);
  const camera=f.viewer.panes.detail.camera;
  Object.assign(camera,{yaw:1.07,pitch:-.31,span:.012,pan:[.003,-.002],center:camera.center.map((n,i)=>n+(i+1)*.0001)});
  const detailCamera=structuredClone(camera),overviewCamera=structuredClone(f.viewer.panes.overview.camera);
  const blockKey=f.viewer.displayedTile.key,overviewLoads=f.workers[0].messages.filter(m=>m.type==='load'&&m.kind==='overview').length;
  for(const mode of ['original','removed']){
    const oldMeshes=f.viewer.panes.detail.meshes.slice(),oldMode=f.viewer.displayedCleanupView;
    const labels=Object.fromEntries(['detailLabel','detailDetail','detailCleanupLabel','cleanupStatus'].map(id=>[id,f.get(id).textContent]));
    select.value=mode;select.dispatchEvent(new f.window.Event('change'));await settle();
    const id=f.activeId('tile');assert.equal(f.loader.active.record.cleanupView,mode);
    assert.equal(f.viewer.displayedCleanupView,oldMode);assert.equal(f.get('regionForm').getAttribute('aria-busy'),'true');
    for(let i=0;i<8;i++){
      await f.piece(id,i,8,mesh(mode==='original'?2:1));
      assert.deepEqual(f.viewer.panes.detail.meshes,oldMeshes,'Prepared pieces must remain staged until the complete result.');
      for(const [name,label]of Object.entries(labels))assert.equal(f.get(name).textContent,label,'A pending cleanup must retain the displayed geometry label.');
      assert.deepEqual(camera,detailCamera);
    }
    await f.done(id,nativeResult(mode));
    assert.equal(f.viewer.displayedCleanupView,mode);assert.equal(select.value,mode);
    assert.match(f.get('detailCleanupLabel').textContent,mode==='original'?/Original reconstruction/:/Removed fragments only/);
    assert.equal(f.get('triangleMetric').textContent,mode==='original'?'16':'8');
    assert.equal(f.viewer.displayedTile.key,blockKey);assert.equal(f.viewer.targetTile.key,blockKey);
    assert.deepEqual(camera,detailCamera);assert.deepEqual(f.viewer.panes.overview.camera,overviewCamera);
    assert.equal(f.get('regionForm').hasAttribute('aria-busy'),false);
  }
  assert.equal(f.workers[0].messages.filter(m=>m.type==='load'&&m.kind==='overview').length,overviewLoads,'Native cleanup must not reload the overview.');
});

test('Rapid native cleanup changes coalesce to the latest mode and ignore stale pieces and results', {timeout:5000},async t=>{
  const f=await fixture(t,{overviewRepair:false});await f.ready();
  const select=f.get('cleanupView'),oldMeshes=f.viewer.panes.detail.meshes.slice(),oldLabel=f.get('detailCleanupLabel').textContent;
  Object.assign(f.viewer.panes.detail.camera,{yaw:-.7,span:.01,pan:[.001,.002]});
  const camera=structuredClone(f.viewer.panes.detail.camera);
  const choose=async mode=>{select.value=mode;select.dispatchEvent(new f.window.Event('change'));await settle();};
  await choose('original');const stale=f.activeId('tile');await f.piece(stale,0,8,mesh(2));
  await choose('cleaned');const superseded=f.loader.pending.get('detail').id;
  await choose('removed');const latest=f.loader.pending.get('detail').id;
  assert.notEqual(latest,superseded);assert.equal(f.loader.pending.size,1);
  const acknowledgements=f.workers[0].messages.filter(m=>m.type==='ack'&&m.id===stale).length;
  f.emit({type:'piece',id:stale,index:1,total:8,mesh:mesh(2)});await settle();
  assert.equal(f.workers[0].messages.filter(m=>m.type==='ack'&&m.id===stale).length,acknowledgements);
  assert.deepEqual(f.viewer.panes.detail.meshes,oldMeshes);assert.equal(f.get('detailCleanupLabel').textContent,oldLabel);
  f.emit({type:'done',id:stale,error:'cancelled',aborted:true});await settle();
  assert.equal(f.activeId('tile'),latest);assert.equal(f.loader.active.record.cleanupView,'removed');
  for(const id of [stale,superseded]){
    f.emit({type:'piece',id,index:2,total:8,mesh:mesh(2)});
    f.emit({type:'done',id,result:nativeResult('original')});
  }
  await settle();assert.equal(f.loader.active.id,latest);
  assert.deepEqual(f.viewer.panes.detail.meshes,oldMeshes);assert.equal(f.get('detailCleanupLabel').textContent,oldLabel);
  assert.equal(f.workers[0].messages.some(m=>m.type==='load'&&m.id===superseded),false,'The superseded pending mode must never reach the worker.');
  await f.complete(latest);
  assert.equal(f.viewer.displayedCleanupView,'removed');assert.equal(select.value,'removed');assert.match(f.get('detailCleanupLabel').textContent,/Removed fragments only/);
  f.emit({type:'done',id:stale,result:nativeResult('original')});await settle();
  assert.equal(f.viewer.displayedCleanupView,'removed');assert.deepEqual(f.viewer.panes.detail.camera,camera);
  assert.equal(f.loader.active,null);assert.equal(f.loader.pending.size,0);
});

test('A failed cleanup change restores the selector to the displayed mode and keeps its geometry, camera and labels', {timeout:5000},async t=>{
  const f=await fixture(t,{overviewRepair:false});await f.ready();const select=f.get('cleanupView');
  select.value='original';select.dispatchEvent(new f.window.Event('change'));await settle();await f.complete(f.activeId('tile'));
  const oldMeshes=f.viewer.panes.detail.meshes.slice(),label=f.get('detailCleanupLabel').textContent,status=f.get('cleanupStatus').textContent;
  Object.assign(f.viewer.panes.detail.camera,{yaw:.9,pitch:.14,pan:[-.002,.001],span:.009});
  const camera=structuredClone(f.viewer.panes.detail.camera);
  select.value='removed';select.dispatchEvent(new f.window.Event('change'));await settle();const id=f.activeId('tile');
  await f.piece(id,0);assert.equal(select.value,'removed');assert.equal(f.viewer.displayedCleanupView,'original');
  f.emit({type:'done',id,error:'Cleanup surface checksum did not match.'});await settle();
  assert.equal(select.value,'original');assert.equal(f.viewer.cleanupView,'original');assert.equal(f.viewer.displayedCleanupView,'original');
  assert.deepEqual(f.viewer.panes.detail.meshes,oldMeshes);assert.deepEqual(f.viewer.panes.detail.camera,camera);
  assert.equal(f.get('detailCleanupLabel').textContent,label);assert.equal(f.get('cleanupStatus').textContent,status);
  assert.match(f.get('requestError').textContent,/Cleanup surface checksum did not match/);
  assert.match(f.get('requestError').textContent,/Still displaying block \[35, 31, 36\]/);
  assert.equal(f.get('requestError').hidden,false);assert.equal(select.disabled,false);
  assert.equal(f.get('regionForm').hasAttribute('aria-busy'),false);assert.equal(f.viewer.loading,false);
  assert.equal(f.viewer.detailStage.released,true);assert.equal(f.loader.active,null);
});

test('Overview overlap repair is an independent explicit transaction and failure restores its displayed checkbox state', {timeout:5000},async t=>{
  const filter=OVERVIEW_FACE_FILTERS.find(item=>item.id==='overview');assert.ok(filter);
  const overviewLods=[{id:'overview',label:'Whole-heart display overview',triangles:filter.originalTriangles,parts:[{
    url:filter.sourceUrl,sha256:filter.sourceSha256,decodedSha256:filter.sourceDecodedSha256,
    compressedBytes:100,decodedBytes:200,triangles:filter.originalTriangles,
  }]}];
  const f=await fixture(t,{overviewLods,overviewRepair:false});await f.ready();
  const checkbox=f.get('overviewRepair');assert.equal(checkbox.disabled,false);assert.equal(checkbox.checked,false);
  assert.equal(f.viewer.displayedOverviewRepair,false);assert.equal(f.get('overviewModeLabel').textContent,'Original reference');
  Object.assign(f.viewer.panes.overview.camera,{yaw:-.3,span:.8,pan:[.02,-.03]});
  const overviewCamera=structuredClone(f.viewer.panes.overview.camera),detailCamera=structuredClone(f.viewer.panes.detail.camera);
  const nativeMode=f.viewer.displayedCleanupView,nativeLabel=f.get('detailCleanupLabel').textContent;
  const choose=async enabled=>{checkbox.checked=enabled;checkbox.dispatchEvent(new f.window.Event('change'));await settle();return f.activeId('overview');};
  const originalMeshes=f.viewer.panes.overview.meshes.slice(),originalLabel=f.get('overviewModeLabel').textContent;
  let id=await choose(true);assert.equal(f.loader.active.record.overviewRepair,true);
  assert.equal(f.loader.active.record.parts[0].faceFilter.sourceSha256,filter.sourceSha256);
  await f.piece(id,0,1);assert.deepEqual(f.viewer.panes.overview.meshes,originalMeshes);assert.equal(f.get('overviewModeLabel').textContent,originalLabel);
  await f.done(id,{pieces:1,triangles:filter.retainedTriangles,sourceTriangles:filter.originalTriangles,removedTriangles:filter.removedTriangles,overviewRepair:true});
  assert.equal(f.viewer.displayedOverviewRepair,true);assert.equal(checkbox.checked,true);assert.equal(f.get('overviewModeLabel').textContent,'Overlap repair');
  const repairedMeshes=f.viewer.panes.overview.meshes.slice(),repairedDetail=f.get('overviewDetail').textContent;
  id=await choose(false);assert.equal(f.loader.active.record.overviewRepair,false);await f.piece(id,0,1);
  f.emit({type:'done',id,error:'Original overview did not finish.'});await settle();
  assert.equal(checkbox.checked,true);assert.equal(f.viewer.overviewRepair,true);assert.equal(f.viewer.displayedOverviewRepair,true);
  assert.deepEqual(f.viewer.panes.overview.meshes,repairedMeshes);assert.equal(f.get('overviewDetail').textContent,repairedDetail);assert.equal(f.get('overviewModeLabel').textContent,'Overlap repair');
  id=await choose(false);await f.piece(id,0,1);await f.done(id,{pieces:1,triangles:filter.originalTriangles,sourceTriangles:filter.originalTriangles,removedTriangles:0,overviewRepair:false});
  assert.equal(f.viewer.displayedOverviewRepair,false);assert.equal(checkbox.checked,false);assert.equal(f.get('overviewModeLabel').textContent,'Original reference');
  assert.equal(f.viewer.displayedCleanupView,nativeMode);assert.equal(f.get('detailCleanupLabel').textContent,nativeLabel);
  assert.deepEqual(f.viewer.panes.overview.camera,overviewCamera);assert.deepEqual(f.viewer.panes.detail.camera,detailCamera);
});
