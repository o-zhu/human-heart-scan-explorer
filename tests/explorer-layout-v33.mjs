import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {reconstructionHeight,fitExplorerWorkspace} from '../public/explorer-layout.js';
const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const html=await readFile(new URL('../page.html',import.meta.url),'utf8');

function fixture(){
 const {document,window:domWindow}=parseHTML(html),frames=new Map(),resizeObservers=[],mutationObservers=[];let top=244,nextId=0;
 // LinkeDOM supplies MutationObserver through a Window proxy; use an explicit
 // view adapter so observer notifications match their actual subscriptions.
 const window={Event:domWindow.Event,addEventListener:domWindow.addEventListener.bind(domWindow),removeEventListener:domWindow.removeEventListener.bind(domWindow),dispatchEvent:domWindow.dispatchEvent.bind(domWindow)};
 window.innerHeight=900;window.scrollY=0;
 window.requestAnimationFrame=fn=>{const id=++nextId;frames.set(id,fn);return id;};
 window.cancelAnimationFrame=id=>frames.delete(id);
 window.ResizeObserver=class{constructor(fn){this.fn=fn;this.nodes=[];resizeObservers.push(this);}observe(node){this.nodes.push(node);}disconnect(){this.nodes=[];}};
 window.MutationObserver=class{constructor(fn){this.fn=fn;this.subscriptions=[];mutationObservers.push(this);}observe(node,options){this.subscriptions.push({node,options});}disconnect(){this.subscriptions=[];}};
 const workspace=document.getElementById('reconstructionWorkspace');
 workspace.getBoundingClientRect=()=>({top:top-window.scrollY});
 const stop=fitExplorerWorkspace(document,window);
 const flush=()=>{for(const [id,fn]of [...frames]){frames.delete(id);fn();}};
 const notifyResize=node=>{for(const observer of resizeObservers){if(observer.nodes.includes(node))observer.fn([{target:node}]);}flush();};
 const notifyMutation=(node,type='childList')=>{
  for(const observer of mutationObservers){
   if(observer.subscriptions.some(subscription=>subscription.node===node&&subscription.options[type]))observer.fn([{target:node,type}]);
  }
  flush();
 };
 return {document,window,workspace,stop,flush,notifyResize,notifyMutation,setTop(value){top=value;},height:()=>Number.parseInt(workspace.style.getPropertyValue('--reconstruction-height'))};
}

test('normal desktop heights fit all section rows below the actual header',()=>{
 for(const [height,top]of [[768,230],[900,280],[1080,244],[1440,260]]){
  const panel=reconstructionHeight(height,top);
  assert.ok(panel>=420);assert.equal(top+panel+16,height);
 }
 assert.equal(reconstructionHeight(900,244,{fullscreen:true}),872);
});

test('workspace resizing follows headers and viewport, without changing as the document scrolls',()=>{
 const f=fixture();f.flush();assert.equal(f.height(),640);
 const header=f.document.querySelector('.dataset-browser');
 f.window.scrollY=200;f.notifyResize(header);assert.equal(f.height(),640);
 f.setTop(300);f.notifyResize(header);assert.equal(f.height(),584);
 f.window.innerHeight=1080;f.window.dispatchEvent(new f.window.Event('resize'));f.flush();assert.equal(f.height(),764);
 f.stop();
});

test('clinical header insertion and workspace return recalculate available room',()=>{
 const f=fixture();f.flush();
 const bar=f.document.createElement('div');bar.className='clinical-series-bar';
 const panel=f.document.getElementById('reconstructionPanel');panel.before(bar);
 f.setTop(360);f.notifyMutation(panel.parentElement);assert.equal(f.height(),524);
 // The inserted sibling must join the resize observer: opening its details
 // changes available room without another insertion or a window resize.
 f.setTop(390);f.notifyResize(bar);assert.equal(f.height(),494);
 panel.hidden=true;f.setTop(420);f.notifyMutation(panel,'attributes');assert.equal(f.height(),494);
 panel.hidden=false;f.notifyMutation(panel,'attributes');assert.equal(f.height(),464);
 f.stop();f.setTop(200);f.window.dispatchEvent(new f.window.Event('resize'));f.flush();assert.equal(f.height(),464);
});
