/** Production templates and resize/visibility/fullscreen controller in LinkeDOM.
 * Rectangles are controlled inputs; this is not a browser pixel-layout test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {EchoModule} from '../public/echo.js';
import {ProbeLabModule} from '../public/probe-lab.js';
import {TeeLabModule} from '../public/tee-lab.js';
import {availableWorkspaceHeight,comparisonViewportHeight,fitComparisonWorkspaces} from '../public/workspace-layout-v35.js';

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
 assert.ok(model.contains(echo.querySelector('[data-echo="resolution"]')),'Resolution diagnostics belong in optional model details.');
 for(const key of ['retry-detail','context-alert','cine-status','cine-visible-source'])assert.equal(echo.querySelector(`[data-echo="${key}"]`).closest('details'),null,`${key} must remain outside closed disclosures`);
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

function fixture({legacyMediaStatus=false}={}){
 const {document,window:domWindow}=productionDocument(),frames=new Map(),resizes=[],mutations=[];let seq=0;
 if(legacyMediaStatus){const slot=document.querySelector('.echo-cine-status-slot');slot.replaceWith(slot.firstElementChild);}
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
 for(const node of echo.querySelectorAll('.echo-cine-status-slot'))node.getBoundingClientRect=()=>rect(0,36);
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
 assert.equal(f.value(f.echo,'--echo-screen-height'),384);assert.equal(f.value(f.echo,'--echo-toolbar-height'),98);
 assert.equal(f.document.getElementById('reconstructionWorkspace').style.getPropertyValue('--reconstruction-height'),'555px');
 f.stop();
});

test('Toolbar wrapping resizes both Echo images equally and releases space when controls fit one row',()=>{
 const f=fixture();f.flush();const toolbar=f.echo.querySelector('.echo-toolbar-content');
 f.setToolbarHeight(148);f.resize(toolbar);assert.equal(f.value(f.echo,'--echo-toolbar-height'),148);assert.equal(f.value(f.echo,'--echo-screen-height'),334);
 f.setToolbarHeight(48);f.resize(toolbar);assert.equal(f.value(f.echo,'--echo-toolbar-height'),48);assert.equal(f.value(f.echo,'--echo-screen-height'),434);
 f.stop();
});

test('Document scrolling cannot grow the canvases; header changes and returning to a hidden module can',()=>{
 const f=fixture();f.flush();const header=f.document.querySelector('.dataset-browser');
 f.view.scrollY=180;f.resize(header);assert.equal(f.value(f.probe,'--lab-workspace-height'),668);assert.equal(f.value(f.echo,'--echo-screen-height'),384);
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

test('v46 actual workspace fitting reserves the same media status space during initial/load/play/buffer/retry',()=>{
 const f=fixture();f.flush();
 const slot=f.echo.querySelector('.echo-cine-status-slot'),loading=f.echo.querySelector('.echo-cine-loading');
 assert.ok(f.resizes.some(observer=>observer.nodes.includes(slot)),'The production observer watches the reserved slot.');
 assert.equal(f.resizes.some(observer=>observer.nodes.includes(loading)),false,'Inner status visibility cannot trigger canvas resizing.');
 const initial=f.value(f.echo,'--echo-screen-height');
 for(const [state,hidden,height]of [['initial',true,0],['loading',false,36],['playing',true,0],['buffering',false,60],['retry',false,96]]){
  loading.hidden=hidden;loading.getBoundingClientRect=()=>({top:0,height,width:600,left:0});
  // Recalculate using the real layout controller even if an unrelated resize
  // arrives in the same turn as a source-player state change.
  f.resize(slot);
  assert.equal(f.value(f.echo,'--echo-screen-height'),initial,state);
  assert.equal(f.value(f.echo,'--echo-toolbar-height'),98,state);
  assert.equal(f.value(f.probe,'--lab-workspace-height'),668,state);
 }
 f.stop();
});

test('v46 an older Echo template without a reserved slot retains its visible-loader fallback',()=>{
 const f=fixture({legacyMediaStatus:true});f.flush();
 const loading=f.echo.querySelector('.echo-cine-loading');
 assert.ok(f.resizes.some(observer=>observer.nodes.includes(loading)));
 assert.equal(f.value(f.echo,'--echo-screen-height'),428);
 loading.hidden=false;f.resize(loading);assert.equal(f.value(f.echo,'--echo-screen-height'),392);
 loading.hidden=true;f.resize(loading);assert.equal(f.value(f.echo,'--echo-screen-height'),428);
 f.stop();
});

test('v47 a single compact Echo pane uses the room freed by its hidden partner and overlay controls',()=>{
 const f=fixture();f.echo.classList.add('echo-compact','echo-phone');f.view.innerWidth=390;f.view.innerHeight=844;f.top.echoPanel=100;
 const anatomy=f.echo.querySelector('.echo-view-column'),cine=f.echo.querySelector('.echo-cine');cine.hidden=true;
 const settings=f.document.createElement('section');settings.className='echo-compact-settings';settings.hidden=true;f.echo.append(settings);
 for(const toolbar of f.echo.querySelectorAll('.echo-panel-toolbar'))settings.append(toolbar);
 anatomy.querySelector('.echo-mpr-caption').getBoundingClientRect=()=>({top:0,height:32,width:300});
 f.flush();const initial=f.value(f.echo,'--echo-screen-height');
 assert.equal(f.value(f.echo,'--echo-toolbar-height'),0);assert.equal(initial,596);
 // Settings is a floating disclosure, so its tall controls never reserve scene height.
 settings.hidden=false;f.setToolbarHeight(480);f.resize(f.echo.querySelector('.echo-toolbar-content'));
 assert.equal(f.value(f.echo,'--echo-screen-height'),initial);assert.equal(f.value(f.echo,'--echo-toolbar-height'),0);
 f.stop();
});

test('v47 stacked compact Echo views do not feed their current canvas heights back into fitting',()=>{
 const f=fixture();f.echo.classList.add('echo-compact','echo-phone');f.view.innerWidth=390;f.view.innerHeight=844;
 const screens=[...f.echo.querySelectorAll('.echo-comparison-screen')];
 screens[0].getBoundingClientRect=()=>({top:240-f.view.scrollY,height:f.value(f.echo,'--echo-screen-height')||400,width:359});
 screens[1].getBoundingClientRect=()=>({top:327+(f.value(f.echo,'--echo-screen-height')||400)-f.view.scrollY,height:f.value(f.echo,'--echo-screen-height')||400,width:359});
 f.echo.querySelector('.echo-cine-source-line').getBoundingClientRect=()=>({top:0,height:30,width:359});
 const slot=f.echo.querySelector('.echo-cine-status-slot');slot.getBoundingClientRect=()=>({top:0,height:44,width:359});
 f.flush();assert.equal(f.value(f.echo,'--echo-screen-height'),206);
 for(let i=0;i<5;i++){f.view.scrollY=i*40;f.resize(slot);assert.equal(f.value(f.echo,'--echo-screen-height'),206);}
 const loader=f.echo.querySelector('.echo-cine-loading');loader.hidden=false;loader.getBoundingClientRect=()=>({top:0,height:180,width:359});f.resize(slot);
 assert.equal(f.value(f.echo,'--echo-screen-height'),206,'inner loading text cannot grow the fixed status reservation');f.stop();
});

test('v47 portrait tablets fit two broad stacked Echo panes instead of narrow tall columns',()=>{
 const f=fixture();f.echo.classList.add('echo-compact');f.view.innerWidth=820;f.view.innerHeight=1180;
 const screens=[...f.echo.querySelectorAll('.echo-comparison-screen')];
 screens[0].getBoundingClientRect=()=>({top:190,height:f.value(f.echo,'--echo-screen-height')||400,width:789});
 screens[1].getBoundingClientRect=()=>({top:277+(f.value(f.echo,'--echo-screen-height')||400),height:f.value(f.echo,'--echo-screen-height')||400,width:789});
 f.echo.querySelector('.echo-cine-source-line').getBoundingClientRect=()=>({top:0,height:30,width:789});
 const slot=f.echo.querySelector('.echo-cine-status-slot');slot.getBoundingClientRect=()=>({top:0,height:44,width:789});
 f.flush();assert.equal(f.value(f.echo,'--echo-screen-height'),399);
 for(let i=0;i<3;i++){f.resize(slot);assert.equal(f.value(f.echo,'--echo-screen-height'),399);}
 f.stop();
});

// Reparent the actual template nodes exactly as compact Echo does. Screen
// rectangles depend on their prior fitted height, exposing resize feedback;
// a metadata-only mock would not catch double-counting the nested overlays.
function compactEchoOverlayFixture({width=390,height=844,screenTop=180}={}){
 const f=fixture();f.echo.classList.add('echo-compact');if(width<=600)f.echo.classList.add('echo-phone');
 f.view.innerWidth=width;f.view.innerHeight=height;
 const anatomy=f.echo.querySelector('.echo-view-column'),cine=f.echo.querySelector('.echo-cine');
 const screens=[anatomy.querySelector('.echo-comparison-screen'),cine.querySelector('.echo-comparison-screen')];
 const headings=[anatomy.querySelector('.echo-scene-heading'),cine.querySelector('.echo-section-heading')];
 const caption=anatomy.querySelector('.echo-mpr-caption'),slot=cine.querySelector('.echo-cine-status-slot');
 screens[0].append(headings[0],caption);screens[1].append(headings[1],slot);
 const settings=f.document.createElement('section');settings.className='echo-compact-settings';settings.hidden=true;f.echo.append(settings);
 for(const node of f.echo.querySelectorAll('.echo-panel-toolbar,.echo-model-details'))settings.append(node);
 const alert=anatomy.querySelector('.echo-context-alert');alert.hidden=true;
 const angle=cine.querySelector('.echo-cine-angle-note');angle.hidden=true;
 const rect=(top,height)=>({top:top-f.view.scrollY,height,width:width-24,left:0});
 const screenHeight=()=>f.value(f.echo,'--echo-screen-height')||400;
 screens[0].getBoundingClientRect=()=>rect(screenTop,screenHeight());
 screens[1].getBoundingClientRect=()=>rect(screenTop+(!anatomy.hidden&&(f.echo.classList.contains('echo-phone')||f.view.innerWidth<=900&&f.view.innerHeight>f.view.innerWidth)?screenHeight()+7:0),screenHeight());
 cine.querySelector('.echo-cine-source-line').getBoundingClientRect=()=>rect(0,30);
 return {...f,anatomy,cine,screens,headings,caption,slot,settings,alert};
}

test('v49 in-screen Echo headings and media status do not reduce or feed back into Both and single-pane sizing',()=>{
 const f=compactEchoOverlayFixture();f.flush();
 assert.equal(f.value(f.echo,'--echo-pane-heading-height'),0);
 assert.equal(f.value(f.echo,'--echo-toolbar-height'),0);
 assert.equal(f.value(f.echo,'--echo-screen-height'),300,'Only the outside source line and pair gap reserve height.');
 const loader=f.echo.querySelector('.echo-cine-loading');
 for(const [state,hidden,innerHeight]of [['initial',true,0],['loading',false,44],['playing',true,0],['retry',false,96]]){
  loader.hidden=hidden;loader.getBoundingClientRect=()=>({top:0,height:innerHeight,width:300});
  for(const heading of f.headings)heading.getBoundingClientRect=()=>({top:0,height:80,width:300});
  f.caption.getBoundingClientRect=()=>({top:0,height:90,width:300});
  f.view.scrollY+=45;f.resize(f.slot);
  assert.equal(f.value(f.echo,'--echo-screen-height'),300,state);
 }
 f.settings.hidden=false;f.setToolbarHeight(480);f.resize(f.echo.querySelector('.echo-toolbar-content'));
 assert.equal(f.value(f.echo,'--echo-screen-height'),300,'Opening floating settings cannot shrink the pair.');
 f.cine.hidden=true;f.echo.dataset.echoVisiblePane='anatomy';f.mutate(f.echo);
 assert.equal(f.value(f.echo,'--echo-screen-height'),642,'Anatomy uses the full available height without hidden-partner reserves.');
 f.anatomy.hidden=true;f.cine.hidden=false;f.echo.dataset.echoVisiblePane='ultrasound';f.mutate(f.echo);
 assert.equal(f.value(f.echo,'--echo-screen-height'),608,'A single ultrasound pane retains its outside source attribution.');
 f.anatomy.hidden=false;f.echo.dataset.echoVisiblePane='both';f.mutate(f.echo);
 for(let i=0;i<4;i++){f.resize(f.slot);assert.equal(f.value(f.echo,'--echo-screen-height'),300,'Returning to Both does not inherit a single-pane height.');}
 f.stop();
});

test('v49 landscape Echo reserves outside attribution and critical alerts while inside overlays stay stable on resize',()=>{
 const f=compactEchoOverlayFixture({width:844,height:390,screenTop:104});f.flush();
 assert.equal(f.value(f.echo,'--echo-screen-height'),230);
 const loader=f.echo.querySelector('.echo-cine-loading');loader.hidden=false;loader.getBoundingClientRect=()=>({top:0,height:120,width:380});
 f.settings.hidden=false;f.setToolbarHeight(500);f.resize(f.slot);
 assert.equal(f.value(f.echo,'--echo-screen-height'),230,'Media retry actions and open settings stay within their overlays.');
 f.alert.hidden=false;f.alert.getBoundingClientRect=()=>({top:0,height:44,width:380});f.resize(f.alert);
 assert.equal(f.value(f.echo,'--echo-screen-height'),216,'A real outside anatomy alert still has room.');
 f.alert.hidden=true;f.view.innerHeight=520;f.view.dispatchEvent(new f.view.Event('resize'));f.flush();
 assert.equal(f.value(f.echo,'--echo-screen-height'),360);
 for(let i=0;i<3;i++){f.view.scrollY+=50;f.resize(f.slot);assert.equal(f.value(f.echo,'--echo-screen-height'),360);}
 f.stop();
});

test('v47 compact labs fit their complete workspace, including an open steering dock and short landscape',()=>{
 const f=fixture();f.view.innerWidth=820;f.view.innerHeight=768;f.probe.classList.add('lab-compact');
 const dock=f.document.createElement('section');dock.className='lab-compact-dock';f.probe.querySelector('.probe-workspace').append(dock);
 f.document.dispatchEvent(new f.view.Event('labcompactlayoutchange'));f.flush();
 assert.equal(f.value(f.probe,'--lab-workspace-height'),536);
 assert.ok(f.resizes.some(observer=>observer.nodes.includes(dock)));
 dock.hidden=false;f.probe.classList.add('lab-controls-open');f.resize(dock);assert.equal(f.value(f.probe,'--lab-workspace-height'),536);
 f.view.innerHeight=390;f.view.dispatchEvent(new f.view.Event('resize'));f.flush();assert.equal(f.value(f.probe,'--lab-workspace-height'),230);
 f.stop();
});

test('v47 visual viewport keyboard changes fit available room without changing geometry on pinch zoom',()=>{
 assert.equal(comparisonViewportHeight({innerHeight:844,visualViewport:{height:510,scale:1}}),510);
 assert.equal(comparisonViewportHeight({innerHeight:844,visualViewport:{height:510,scale:1.5}}),844);
 const f=fixture();f.probe.classList.add('lab-compact');f.view.visualViewport={height:600,scale:1};f.flush();
 assert.equal(f.value(f.probe,'--lab-workspace-height'),368);
 f.view.visualViewport.scale=2;f.view.dispatchEvent(new f.view.Event('resize'));f.flush();assert.equal(f.value(f.probe,'--lab-workspace-height'),668);f.stop();
});
