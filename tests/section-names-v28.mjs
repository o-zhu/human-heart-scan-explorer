/** Names are metadata-aware; source indices, data and cut geometry stay fixed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {DONORS} from '../public/donors.js';
import {orthogonalFrame} from '../public/planes.js';
import {nativeToWorld} from '../public/native-edge-loader.js';
import {SurfacePane} from '../public/whole-native.js';
import {SOURCE_AXIS_KEYS,sectionNamingFor,sectionName,sectionLabel,linkedSectionText,anatomicalNamesFromDirections,applySectionNames,updateSectionExpandLabel} from '../public/section-names.js';

const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const [html,app,cmac,slicer]=await Promise.all([
 readFile(new URL('../page.html',import.meta.url),'utf8'),
 readFile(new URL('../public/app.js',import.meta.url),'utf8'),
 readFile(new URL('../public/assets/clinical-v19/cmac/manifest.json',import.meta.url),'utf8').then(JSON.parse),
 readFile(new URL('../public/assets/clinical-v19/slicerheart/manifest.json',import.meta.url),'utf8').then(JSON.parse),
]);
const source={kind:'clinical'},checks=[];

test('LADAF uses reviewed approximate planes while other donors retain neutral names',()=>{
 const naming=sectionNamingFor({source:DONORS[0]});
 assert.deepEqual(naming.names,['Coronal','Sagittal','Axial']);
 assert.equal(naming.basis,'reviewed-specimen');assert.match(naming.note,/approximate/i);assert.match(naming.note,/no patient-position registration/i);
 for(const donor of DONORS.slice(1)){
  const other=sectionNamingFor({source:donor});assert.deepEqual(other.names,['Longitudinal 1','Longitudinal 2','Transverse']);
  assert.match(other.note,/not been reviewed/i);
 }
 assert.deepEqual(SOURCE_AXIS_KEYS,['X','Y','Z']);
 checks.push('LADAF X/Y/Z display as coronal/sagittal/axial with a specimen qualification; other HOA donors retain neutral planes.');
});

test('cMAC whole-heart names follow the physical direction matrix columns',()=>{
 const series=cmac.series.find(s=>s.id==='whole-heart-mri'),snapshot=JSON.stringify(series);
 const naming=sectionNamingFor({source,series});
 assert.deepEqual(naming.names,['Coronal','Axial','Sagittal']);
 assert.equal(naming.basis,'dicom-patient-directions');
 assert.equal(JSON.stringify(series),snapshot);
 checks.push('Actual cMAC DICOM LPS column vectors map source X/Y/Z to coronal/axial/sagittal without altering metadata.');
});

test('all SlicerHeart series follow their NRRD RAS space directions',()=>{
 for(const series of slicer.series){
  const naming=sectionNamingFor({source,series});
  assert.deepEqual(naming.names,['Sagittal','Coronal','Axial']);
  assert.equal(naming.basis,'nrrd-patient-directions');
 }
 checks.push('All three actual SlicerHeart series map source X/Y/Z to sagittal/coronal/axial from per-series RAS directions.');
});

test('oblique cardiac SAX and probe-local ultrasound do not acquire false body-plane labels',()=>{
 const sax=sectionNamingFor({source,series:cmac.series.find(s=>s.id==='cine-sax')});
 assert.deepEqual(sax.names,['Longitudinal 1','Longitudinal 2','Short-axis']);
 const us=cmac.series.find(s=>s.id==='ultrasound');
 assert.deepEqual(us.direction,[[1,0,0],[0,1,0],[0,0,1]]);
 const probe=sectionNamingFor({source,series:us});
 assert.deepEqual(probe.names,['Probe plane 1','Probe plane 2','Probe plane 3']);assert.match(probe.note,/patient orientation is not registered/i);
 assert.deepEqual(sectionNamingFor({source,series:{...us,coordinateSystem:'DICOM LPS'}}).names,probe.names);
 assert.deepEqual(sectionNamingFor({source,series:{...us,modality:'MRI'}}).names,['Source plane 1','Source plane 2','Source plane 3']);
 checks.push('Acquired SAX remains cardiac short-axis; ultrasound remains probe-local even with an identity matrix, and unknown orientation stays neutral.');
});

test('direction naming rejects oblique, degenerate, sheared and invalid grids',()=>{
 assert.deepEqual(anatomicalNamesFromDirections([[0,-2,0],[0,0,3],[-4,0,0]]),['Coronal','Axial','Sagittal']);
 const angle=30*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 for(const directions of [undefined,[[0,0,0],[0,1,0],[0,0,1]],[[1,0,0],[1,0,0],[0,0,1]],[[1,0,0],[.2,1,0],[0,0,1]],[[1,0,0],[0,NaN,0],[0,0,1]],[[c,s,0],[-s,c,0],[0,0,1]]])assert.equal(anatomicalNamesFromDirections(directions),null);
 checks.push('Anatomical naming requires finite, nondegenerate, orthogonal directions within five degrees of distinct cardinal axes.');
});

test('actual page controls, markers and accessibility names change together without changing source IDs',()=>{
 const {document}=parseHTML(html),names=[sectionNamingFor({source:DONORS[0]}),...cmac.series.map(series=>sectionNamingFor({source,series})),...slicer.series.map(series=>sectionNamingFor({source,series}))];
 const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);
 const dataAxes=[...document.querySelectorAll('[data-section-axis]')].map(n=>n.dataset.sectionAxis);
 for(const naming of names){
  applySectionNames(document,naming);
  for(const [axis,key]of SOURCE_AXIS_KEYS.entries()){
   const label=sectionLabel(naming,axis),canvas=document.getElementById('slice'+key),card=canvas.closest('.slice-card');
   assert.equal(card.querySelector('[data-section-name]').textContent,sectionName(naming,axis));
   const expectedSlot={Coronal:'first',Sagittal:'second',Axial:'wide'}[sectionName(naming,axis)]||['first','second','wide'][axis];
   assert.equal(card.dataset.sectionSlot,expectedSlot);
   assert.equal(card.querySelector('.slice-axis-marker').textContent,sectionName(naming,axis));
   assert.ok(canvas.getAttribute('aria-label').startsWith(label));
   assert.equal(document.getElementById('sliceRange'+key).getAttribute('aria-label'),label+' position');
   assert.equal(card.querySelector('[data-section-step="-1"]').getAttribute('aria-label'),'Previous '+label);
   assert.equal(card.querySelector('[data-section-step="1"]').getAttribute('aria-label'),'Next '+label);
   assert.equal(card.querySelector('.slice-activate').title,'Link the 3D cutaway to the '+label);
   const option=document.querySelector('#clipAxis option[value="'+key.toLowerCase()+'"]');assert.ok(option.textContent.startsWith(sectionName(naming,axis).replace('plane','Plane')));
   const expand=card.querySelector('[data-section-expand]');assert.equal(expand.dataset.sectionExpand,key);
   assert.equal(expand.getAttribute('aria-label'),'Enlarge '+label);
   expand.setAttribute('aria-expanded','true');updateSectionExpandLabel(expand);assert.equal(expand.getAttribute('aria-label'),'Show all sections');
   expand.setAttribute('aria-expanded','false');updateSectionExpandLabel(expand);assert.equal(expand.getAttribute('aria-label'),'Enlarge '+label);
  }
  assert.equal(document.getElementById('sectionOrientationNote').textContent,naming.note);
  assert.deepEqual([...document.querySelectorAll('[id]')].map(n=>n.id),ids);
  assert.deepEqual([...document.querySelectorAll('[data-section-axis]')].map(n=>n.dataset.sectionAxis),dataAxes);
 }
 checks.push('Actual page headings, markers, tooltips, sliders, step buttons, clip choices and enlargement accessibility names update together; internal DOM IDs and axis keys stay unchanged.');
});

test('actual reconstruction activation links the same source axis and geometry with the new status name',()=>{
 const code=app.slice(app.indexOf('function activateSection('),app.indexOf('\nfunction unlinkSection('));
 for(let axis=0;axis<3;axis++){
  const {document}=parseHTML(html),naming=sectionNamingFor({source:DONORS[0]}),extent=[.9,1,.9],positions=[.4,.5,.6];
  let aligned;
  const renderer={loaded:true,extent,settings:{},set(patch){Object.assign(this.settings,patch);},alignPlane(...args){aligned=args;},clearCapData(){}};
  const noop=()=>{};
  const context=vm.createContext({document,$:id=>document.getElementById(id),renderer,quickViews:null,activeAxis:-1,slicePositions:positions.slice(),sectionCount:()=>475,orthogonalFrame,slices:[],sectionNaming:naming,sectionLabel,linkedSectionText,
   cancelUltraLoad:noop,applySectionCap:noop,updateUltraFocus:noop,refreshUltraCut:noop,syncControls:noop,queueDetailedSections:noop,setText:(id,value)=>{document.getElementById(id).textContent=value;}});
  vm.runInContext(code,context);context.activateSection(axis,true);
  assert.equal(renderer.settings.clipAxis,axis);assert.equal(renderer.settings.clipFlip,[1,0,1][axis]);
  const position=Math.round(positions[axis]*474)/474,frame=orthogonalFrame(axis,position,extent);
  assert.equal(renderer.settings.clipPosition,position);
  assert.deepEqual(aligned,[frame.normal,frame.up,frame.center]);
  assert.equal(document.getElementById('sectionSyncStatus').textContent,linkedSectionText(naming,axis));
  assert.ok(document.getElementById('volumeCanvas').getAttribute('aria-label').includes(sectionLabel(naming,axis)));
 }
 checks.push('The actual activation function still sets each original clip-axis number, retained side, snapped position and plane geometry; its status and 3D accessibility label use the corresponding anatomical name.');
});

test('background cache and general reconstruction copy use donor-safe section wording',()=>{
 const {document}=parseHTML(html);
 const code=app.slice(app.indexOf('function syncUltraCacheStatus(){'),app.indexOf('\nfunction updateUltraFocus(){'));
 const values={},context=vm.createContext({$:id=>document.getElementById(id),setText:(id,value)=>{values[id]=value;},
  ultraSource:{getStatus:()=>({collection:{complete:true,completedFiles:12,totalFiles:12,completedBytes:1200,totalBytes:1200}})}});
 vm.runInContext(code,context);context.syncUltraCacheStatus();
 assert.equal(values.ultraCollectionLabel,'All Ultra sections are stored on this device');
 assert.equal(document.getElementById('pauseUltraCollection').disabled,true);
 assert.doesNotMatch(document.body.textContent,/\bX\s*[,/×]\s*Y\b/);
 const details=app.match(/^  setText\('datasetDetails'.*$/m)[0];
 for(const donor of DONORS){
  const naming=sectionNamingFor({source:donor}),text={};
  vm.runInNewContext(details,{manifest:{processingSummary:'Measured specimen'},sectionNaming:naming,setText:(id,value)=>{text[id]=value;}});
  assert.ok(text.datasetDetails.includes(naming.note));
  assert.doesNotMatch(text.datasetDetails,/\bX, Y and Z\b/);
 }
 checks.push('The completed Ultra cache status uses all Ultra sections; general reconstruction copy uses the active donor orientation note without raw source-axis labels.');
});

test('saved numeric axes and slice positions restore without a migration',()=>{
 const restore=app.slice(app.indexOf('function restore(){'),app.indexOf('\nasync function main(){'));
 const run=new Function('hash','donor',`
  const location={hash},manifest={levels:{high:{}}},renderer={settings:{},set(p){Object.assign(this.settings,p);}};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),errors=[],toast=e=>errors.push(e);
  let restoredLevel,cutFaceQuality,restoredEcho,restoredEchoCamera,restoredQuickView,restoredProbe,restoredProbeCamera,restoredTee,restoredTeeCamera;
  let activeAxis=-1,slicePositions=[.5,.5,.5];
  ${restore}
  restore();return {settings:renderer.settings,activeAxis,slicePositions,errors};
 `);
 for(let axis=0;axis<3;axis++){
  const slices=[.2,.4,.6],hash='#view='+encodeURIComponent(JSON.stringify({donor:DONORS[0].id,module:'reconstruction',level:'high',slices,settings:{clipAxis:axis,clipPosition:slices[axis],clipFlip:1}}));
  const restored=run(hash,DONORS[0]);assert.deepEqual(restored.errors,[]);assert.equal(restored.activeAxis,axis);assert.equal(restored.settings.clipAxis,axis);assert.deepEqual(restored.slicePositions,slices);
 }
 checks.push('Existing saved numeric axes and slice positions restore unchanged; no URL migration, resampling or reorientation is introduced.');
});

test('auxiliary section labels agree with actual source-axis and world-axis clipping normals',async()=>{
 const pages=await Promise.all(['native-detail','whole-native','motion-lab'].map(async name=>({name,document:parseHTML(await readFile(new URL('../public/'+name+'.html',import.meta.url),'utf8')).document})));
 const nativeCode=await readFile(new URL('../public/native-detail.js',import.meta.url),'utf8'),motionCode=await readFile(new URL('../public/motion-lab-v24.js',import.meta.url),'utf8');
 const nativeManifest=JSON.parse(await readFile(new URL('../public/assets/native-surface-v20/manifest.json',import.meta.url),'utf8'));
 assert.match(nativeManifest.coordinateConvention,/acquisition XYZ maps to renderer \(x,z,-y\)/);
 const center=[3806.5,3806.5,4239.5],origin=nativeToWorld(center),names=['Coronal','Sagittal','Axial'];
 const normals=Object.fromEntries(names.map((name,axis)=>{const p=[...center];p[axis]++;const d=nativeToWorld(p).map((n,i)=>n-origin[i]),length=Math.hypot(...d);return [name,d.map(n=>n/length)];}));
 for(const page of pages){
  const {document}=page,captured={},gl=new Proxy({uniform3fv:(key,value)=>{captured[key]=Array.from(value);},uniform1f:(key,value)=>{captured[key]=value;}},{get:(target,key)=>key in target?target[key]:String(key).toUpperCase()===key?1:()=>{}}),window={devicePixelRatio:1};
  const u=Object.fromEntries(['Min','Max','Center','Right','Up','View','Pan','Span','Aspect','FloatPosition','CutAxis','CutValue','CutSign','CutEnabled','Mode','Amount','Twist','Tint'].map(k=>[k,k]));
  const camera={yaw:0,pitch:0,span:1,center:[0,0,0],pan:[0,0],flip:false};
  const note=document.getElementById('sectionOrientationNote');assert.match(note.textContent,/Approximate anatomical planes/);assert.match(note.textContent,/no patient-position registration/);
  const groups=page.name==='whole-native'?['overviewCutAxis','cutAxis']:[page.name==='motion-lab'?'cut':'cutAxis'];
  let draw;
  if(page.name==='native-detail'){
   const code=nativeCode.slice(0,nativeCode.indexOf('\nlet manifest, panes')).replace(/^import .*;\s*$/gm,'');
   const Pane=new Function('document','window',code+'\nreturn MeshPane;')(document,window),canvas=document.getElementById('referenceCanvas');canvas.getBoundingClientRect=()=>({width:600,height:400});
   const pane={name:'reference',canvas,gl,u,mesh:{lod:{bounds:nativeManifest.bounds},float:true,count:3,vao:{}},program:{}};
   draw=axis=>Pane.prototype.draw.call(pane,camera,{axis,position:.65,flip:false},nativeManifest);
  }else if(page.name==='whole-native'){
   const pane={name:'overview',gl,camera};draw=axis=>SurfacePane.prototype.setUniforms.call(pane,{program:{},uniforms:u},{float:true},1.5,{axis,position:.65,flip:false});
  }else{
   const code=motionCode.slice(0,motionCode.indexOf('\nclass Lab')).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
   const Pane=new Function('document','window',code+'\nreturn MotionPane;')(document,window),canvas=document.getElementById('leftCanvas');canvas.getBoundingClientRect=()=>({width:600,height:400});
   const pane={id:'left',canvas,gl,u,camera,program:{},meshes:[],basis:Pane.prototype.basis};draw=axis=>Pane.prototype.draw.call(pane,{cut:{axis,value:.123},mode:0});
  }
  for(const id of groups){const select=document.getElementById(id);assert.equal(select.getAttribute('aria-describedby'),'sectionOrientationNote');assert.deepEqual([...select.querySelectorAll('option')].map(o=>o.value),['none','x','y','z']);for(const option of select.querySelectorAll('option')){if(option.value==='none')continue;draw(option.value);const name=option.textContent.split(' ')[0],expected=normals[name];assert.ok(expected,option.textContent);assert.ok(Math.abs(captured.CutAxis.reduce((n,x,i)=>n+x*expected[i],0))>.99999,`${page.name}/${option.value}: ${option.textContent} names the wrong physical plane.`);if(page.name==='motion-lab')assert.equal(captured.CutValue,.123);}}
 }
 checks.push('Native study and whole-native source selectors use coronal/sagittal/axial; motion uses coronal/axial/sagittal for its world-axis selector. Actual clipping normals, values and specimen qualifications are verified.');
});

test.after(async()=>{
 if(checks.length!==10)return;
 const out=new URL('../docs/section-names-v28/validation.json',import.meta.url);await mkdir(new URL('.',out),{recursive:true});
 await writeFile(out,JSON.stringify({passed:true,checks,scope:'Actual local metadata, DOM controls and reconstruction source functions in Node/LinkeDOM. Names do not reorient or resample source images. No clinical validation claim.'},null,2)+'\n');
});
