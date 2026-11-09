/** Production templates and resize/visibility/fullscreen controller in LinkeDOM.
 * Rectangles are controlled inputs; this is not a browser pixel-layout test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {EchoModule} from '../public/echo.js';
import {ProbeLabModule} from '../public/probe-lab.js';
import {TeeLabModule} from '../public/tee-lab.js';
import {availableWorkspaceHeight,fitComparisonWorkspaces} from '../public/workspace-layout-v35.js';

const {parseHTML}=await import(pathToFileURL(process.argv[2]||'/tmp/heart-review-test-deps/node_modules/linkedom/esm/index.js'));
const html=await readFile(new URL('../page.html',import.meta.url),'utf8');
function productionDocument(){
 const {document,window}=parseHTML(html);
 for(const [id,Module] of [['echoPanel',EchoModule],['probePanel',ProbeLabModule],['teePanel',TeeLabModule]]){
  document.getElementById(id).innerHTML=Module.prototype.template.call({fineLabel:'79.4 µm'});
 }
 return {document,window};
}

test('Echo camera anchors sit beside CT Slice, with one real canvas mount and complete evidence controls',()=>{
 const {document}=productionDocument(),echo=document.getElementById('echoPanel');
 const ct=echo.querySelector('[data-echo-view="ct"]'),probe=echo.querySelector('[data-echo="anchor-probe"]'),anatomy=echo.querySelector('[data-echo="anchor-anatomy"]');
 assert.equal(probe.closest('.echo-toolbar-content'),ct.closest('.echo-toolbar-content'));
 assert.equal(anatomy.closest('.echo-toolbar-content'),ct.closest('.echo-toolbar-content'));
 assert.equal(ct.closest('.echo-left-switch').nextElementSibling,probe.parentElement);
 assert.equal(echo.querySelector('.echo-active-view').contains(probe),false);
 assert.equal(echo.querySelectorAll('#echoViewportMount').length,1);
 assert.equal(echo.querySelectorAll('.echo-comparison-screen').length,2);
 for(const key of ['ct-correspondence','correspondence-note','fit-review','context-visible','probe-visible','sector-visible','cine-source','cine-license','reference-note'])assert.ok(echo.querySelector(`[data-echo="${key}"]`),key);
 const model=echo.querySelector('.echo-model-details'),source=echo.querySelector('.echo-cine-credit');
 assert.equal(model.hasAttribute('open'),false);assert.equal(source.hasAttribute('open'),false);
 assert.ok(model.contains(echo.querySelector('[data-echo="correspondence-note"]')));
 assert.ok(source.contains(echo.querySelector('[data-echo="reference-note"]')));
 for(const key of ['resolution','retry-detail','context-alert','cine-status','cine-visible-source'])assert.equal(echo.querySelector(`[data-echo="${key}"]`).closest('details'),null,`${key} must remain outside closed disclosures`);
});

test('TTE starts precede the left anatomy and keyboard; TEE starts retain their 3D overlay and both panes stay intact',()=>{
 const {document}=productionDocument();
 for(const [id,mountId,attribute] of [['probePanel','probeViewportMount','data-probe-preset'],['teePanel','teeViewportMount','data-tee-preset']]){
  const panel=document.getElementById(id),mount=panel.querySelector(`#${mountId}`),presets=[...panel.querySelectorAll(`[${attribute}]`)];
  const presetHost=id==='probePanel'?panel.querySelector('.probe-body-context'):mount;
  assert.equal(presets.length,4);assert.ok(presets.every(node=>presetHost.contains(node)));
  assert.ok(presets.every(node=>node.closest('[role="group"]')?.getAttribute('aria-labelledby')));
  assert.equal(panel.querySelector('.probe-heading'),null);assert.equal(panel.querySelector('.tee-atlas-link'),null);
  assert.equal(panel.querySelectorAll('.probe-view-pair > *').length,2);
  assert.equal(panel.querySelector('.probe-view-pair > :first-child'),mount);
  for(const key of ['frame-state','fine-status','resolution','sampling','scene-mesh','guide','ultrasound','ct','cutaway','flip'])assert.equal(panel.querySelectorAll(`[data-probe="${key}"]`).length,1,key);
  assert.equal(panel.querySelector('.probe-controls-panel').contains(mount),false);
 }
 const probe=document.getElementById('probePanel'),chest=probe.querySelector('.probe-body-context');
 const starts=chest.querySelector('.workspace-starting-views'),torso=chest.querySelector('.probe-torso-wrap'),keyboard=chest.querySelector('.probe-keyboard-console');
 const children=[...chest.children];assert.ok(children.indexOf(starts)<children.indexOf(torso));assert.ok(children.indexOf(torso)<children.indexOf(keyboard));
 assert.equal(probe.querySelector('h2'),null);assert.equal(probe.querySelector('.probe-workspace').getAttribute('aria-label'),'TTE Lab');
 assert.equal(probe.querySelector('#probeViewportMount .workspace-starting-views'),null);
 assert.equal(keyboard.closest('details'),null);assert.equal(keyboard.querySelectorAll('[data-probe-key]').length,12);
 assert.equal(document.querySelectorAll('#teePanel [data-tee="atlas"]').length,1);
 assert.equal(document.querySelectorAll('#teePanel [data-probe="exit"]').length,1);
 const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);assert.equal(new Set(ids).size,ids.length);
});

function fixture(){
 const {document,window:domWindow}=productionDocument(),frames=new Map(),resizes=[],mutations=[];let seq=0;
 const view={Event:domWindow.Event,innerHeight:900,innerWidth:1440,scrollY:0,addEventListener:domWindow.addEventListener.bind(domWindow),removeEventListener:domWindow.removeEventListener.bind(domWindow),dispatchEvent:domWindow.dispatchEvent.bind(domWindow)};
 view.requestAnimationFrame=fn=>{frames.set(++seq,fn);return seq;};view.cancelAnimationFrame=id=>frames.delete(id);
 view.ResizeObserver=class{constructor(fn){this.fn=fn;this.nodes=[];resizes.push(this);}observe(node){this.nodes.push(node);}disconnect(){this.nodes=[];}};
 view.MutationObserver=class{constructor(fn){this.fn=fn;this.nodes=[];mutations.push(this);}observe(node,options){this.nodes.push({node,options});}disconnect(){this.nodes=[];}};
 const echo=document.getElementById('echoPanel'),probe=document.getElementById('probePanel'),tee=document.getElementById('teePanel');
 const top={echoPanel:220,probePanel:220,teePanel:220};let toolbarHeight=98;
 const rect=(topValue=0,height=28)=>({top:topValue-view.scrollY,height,width:600,left:0});
 for(const panel of [echo,probe,tee]){
  for(const node of panel.querySelectorAll('*'))node.getBoundingClientRect=()=>rect();
  panel.getBoundingClientRect=()=>rect(top[panel.id]);
  for(const node of panel.querySelectorAll('.probe-workspace,.tee-workspace'))node.getBoundingClientRect=()=>rect(top[panel.id]);
  const comparison=panel.querySelector('.probe-comparison');if(comparison)comparison.getBoundingClientRect=()=>rect(top[panel.id]+12);
 }
 for(const node of echo.querySelectorAll('.echo-toolbar-content'))node.getBoundingClientRect=()=>rect(0,toolbarHeight);
 for(const node of echo.querySelectorAll('.echo-comparison-screen'))node.getBoundingClientRect=()=>rect(top.echoPanel+90+parseInt(echo.style.getPropertyValue('--echo-toolbar-height')||98));
 for(const node of echo.querySelectorAll('.echo-mpr-caption,.echo-cine-playback'))node.getBoundingClientRect=()=>rect(0,44);
 echo.hidden=false;probe.hidden=false;tee.hidden=false;
 const untouched=document.getElementById('reconstructionWorkspace');untouched.style.setProperty('--reconstruction-height','555px');
 const stop=fitComparisonWorkspaces(document,view);
 const flush=()=>{for(const [id,fn]of [...frames]){frames.delete(id);fn();}};
 const resize=node=>{for(const observer of resizes)if(observer.nodes.includes(node))observer.fn([{target:node}]);flush();};
 const mutate=(node,type='attributes')=>{for(const observer of mutations)if(observer.nodes.some(item=>item.node===node&&item.options[type]))observer.fn([{target:node,type}]);flush();};
 return {document,view,echo,probe,tee,top,stop,flush,resize,mutate,mutations,resizes,frames,setToolbarHeight(value){toolbarHeight=value;},value(node,key){return parseInt(node.style.getPropertyValue(key));}};
}

test('Desktop and laptop room is computed from the actual header, with no thousand-pixel minimum',()=>{
 for(const [height,top]of [[768,220],[900,270],[1080,240],[1440,260]]){
  const room=availableWorkspaceHeight(height,top);assert.equal(top+room+12,height);assert.ok(room>=380);
 }
 const f=fixture();f.flush();assert.equal(f.value(f.probe,'--lab-workspace-height'),668);assert.equal(f.value(f.tee,'--lab-workspace-height'),668);
 assert.equal(f.value(f.echo,'--echo-screen-height'),428);assert.equal(f.value(f.echo,'--echo-toolbar-height'),98);
 assert.equal(f.document.getElementById('reconstructionWorkspace').style.getPropertyValue('--reconstruction-height'),'555px');
 f.stop();
});

test('Toolbar wrapping resizes both Echo images equally and releases space when controls fit one row',()=>{
 const f=fixture();f.flush();const toolbar=f.echo.querySelector('.echo-toolbar-content');
 f.setToolbarHeight(148);f.resize(toolbar);assert.equal(f.value(f.echo,'--echo-toolbar-height'),148);assert.equal(f.value(f.echo,'--echo-screen-height'),378);
 f.setToolbarHeight(48);f.resize(toolbar);assert.equal(f.value(f.echo,'--echo-toolbar-height'),48);assert.equal(f.value(f.echo,'--echo-screen-height'),478);
 f.stop();
});

test('Document scrolling cannot grow the canvases; header changes and returning to a hidden module can',()=>{
 const f=fixture();f.flush();const header=f.document.querySelector('.dataset-browser');
 f.view.scrollY=180;f.resize(header);assert.equal(f.value(f.probe,'--lab-workspace-height'),668);assert.equal(f.value(f.echo,'--echo-screen-height'),428);
 f.probe.hidden=true;f.top.probePanel=290;f.mutate(f.probe);assert.equal(f.value(f.probe,'--lab-workspace-height'),668);
 f.probe.hidden=false;f.mutate(f.probe);assert.equal(f.value(f.probe,'--lab-workspace-height'),598);
 f.stop();f.top.probePanel=300;f.view.dispatchEvent(new f.view.Event('resize'));f.flush();assert.equal(f.value(f.probe,'--lab-workspace-height'),598);
});

test('Fullscreen uses viewport coordinates and tablet layouts reserve space for the pair before the console',()=>{
 const f=fixture();f.flush();f.document.fullscreenElement=f.tee;f.top.teePanel=0;
 f.document.dispatchEvent(new f.view.Event('fullscreenchange'));f.flush();assert.equal(f.value(f.tee,'--lab-workspace-height'),888);
 f.document.fullscreenElement=null;f.top.teePanel=220;f.view.innerWidth=1024;
 f.view.dispatchEvent(new f.view.Event('resize'));f.flush();assert.equal(f.value(f.tee,'--lab-workspace-height'),656);
 f.view.innerWidth=700;f.view.dispatchEvent(new f.view.Event('resize'));f.flush();
 // LinkeDOM returns undefined for a removed property; browsers return ''.
 // Verify that the desktop size declaration is absent rather than its sentinel.
 assert.doesNotMatch(f.echo.getAttribute('style')||'',/(?:^|;)\s*--echo-screen-height\s*:/);
 f.stop();
});

test('Per-frame status text is not observed for mutations and module insertion is',()=>{
 const f=fixture();f.flush();
 for(const observer of f.mutations)for(const {options}of observer.nodes){assert.equal(options.subtree,undefined);assert.equal(options.characterData,undefined);}
 const status=f.probe.querySelector('[data-probe="frame-state"]');status.textContent='Live Preview';f.mutate(status,'childList');assert.equal(f.frames.size,0);
 assert.ok(f.mutations.some(observer=>observer.nodes.some(({node,options})=>node===f.probe&&options.childList)));
 f.stop();
});
