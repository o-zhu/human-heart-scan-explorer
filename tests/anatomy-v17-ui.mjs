import {titleCaseUi} from '../public/ui-text.js';
// Import-stripping DOM fixtures still use the production display-label helper.
const uiFunction=(...args)=>new Function('titleCaseUi',...args).bind(null,titleCaseUi);
/** Actual palette controls and source-specific lazy label loading; no browser claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {DONORS} from '../public/donors.js';
import {loadAnatomy} from '../public/anatomy-data.js';
import {getWindowPresets,matchWindowPreset} from '../public/window-presets.js';

const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const html=await readFile(new URL('../page.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../public/appearance.js',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const requests=[];
globalThis.fetch=async url=>{
  const name=String(url).split(/[?#]/,1)[0];
  assert.match(name,/^\.\/assets\//,'Anatomy stays within the selected local source assets.');
  requests.push(String(url));
  return new Response(await readFile(new URL('../public/'+name.slice(2),import.meta.url)));
};

function fixture(donor,loader=loadAnatomy){
  const {document,window}=parseHTML(html);
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(value){this._value=String(value);}});
  const Controller=uiFunction('document','loadAnatomy','paintSectionPixels','scanActivity','setTimeout','clearTimeout','getWindowPresets','matchWindowPreset',source+'\nreturn AppearanceController;')(
    document,loader,()=>{}, {beginForeground:()=>()=>{}},()=>1,()=>{},getWindowPresets,matchWindowPreset);
  const renderer={settings:{palette:4,threshold:.28,anatomyOpacity:.65,anatomySelected:0,...donor.displayWindow},
    canvas:document.getElementById('volumeCanvas'),set(patch){Object.assign(this.settings,patch);},setAnatomyData(data){this.anatomy=data;}};
  const appearance=new Controller({renderer,donor});
  const click=element=>element.dispatchEvent(new window.Event('click',{bubbles:true}));
  return {document,renderer,appearance,click};
}

for(const donor of DONORS)test(donor.specimen+' lazily loads its own regions through the real Color controls',async()=>{
  const before=requests.length;
  const f=fixture(donor);
  assert.equal(requests.length,before,'Creating the viewer must not load segmentation before it is requested.');
  assert.equal(f.renderer.settings.palette,4,'Tissue / space remains the default.');
  const color=f.document.querySelector('[data-material="anatomy"]');
  assert.ok(color&&!color.disabled);
  assert.equal(f.document.getElementById('anatomyToggle').disabled,false);
  f.click(color);
  await f.appearance.anatomyPromise;
  assert.ok(f.renderer.anatomy,'The requested overlay is installed.');
  const {manifest,labels}=f.renderer.anatomy;
  assert.equal(manifest.specimen,donor.specimen);
  assert.match(manifest.datasetUrl,new RegExp('/datasets/'+donor.datasetId+'$'));
  assert.equal(f.renderer.settings.palette,5);
  assert.match(f.document.getElementById('displayModeBadge').textContent,/Approximate/);
  assert.ok(requests.slice(before).every(url=>url.includes(donor.id==='ladaf-2021-17'?'/assets/anatomy/':'/assets/donors/'+donor.id+'/anatomy/')),'No other donor assets may be requested.');
  for(const label of labels.filter(item=>item.id)){
    const button=f.document.querySelector('[data-label-id="'+label.id+'"]');
    assert.ok(button&&button.textContent.includes(titleCaseUi(label.name)));
    f.click(button);
    assert.equal(f.renderer.settings.anatomySelected,label.id,'Selecting '+label.name+' emphasizes its own ID.');
  }
  const loaded=requests.length;
  await f.appearance.ensureAnatomy();
  assert.equal(requests.length,loaded,'Palette revisits reuse the accepted donor labels.');
});

test('a wrong-donor annotation is rejected before it reaches the renderer',async()=>{
  const correct=await loadAnatomy(DONORS[0].anatomyManifestUrl);
  const f=fixture(DONORS[1],async()=>correct);
  const warn=console.warn;console.warn=()=>{};
  try{await f.appearance.ensureAnatomy();}finally{console.warn=warn;}
  assert.equal(f.renderer.anatomy,undefined);
  assert.equal(f.appearance.anatomy,undefined);
  assert.match(f.document.getElementById('anatomyLoadStatus').textContent,/could not load/);
});

test('source regions do not turn S-donor geometric presets into validated echo windows',async()=>{
  for(const donor of DONORS.filter(d=>d.id.startsWith('s-'))){
    assert.ok(donor.anatomyManifestUrl);
    assert.equal(donor.geometricComparisonOnly,true);
    assert.equal(donor.clinicalPresetsReviewed,false);
    for(const file of ['echo-planes.json','flow-views.json']){
      const meta=JSON.parse(await readFile(new URL('../public/assets/donors/'+donor.id+'/'+file,import.meta.url),'utf8'));
      assert.equal(meta.datasetId,donor.datasetId);
      assert.equal(meta.anatomicIdentityAssigned,false,'Preset identity is independent of tissue region labels.');
    }
  }
});
