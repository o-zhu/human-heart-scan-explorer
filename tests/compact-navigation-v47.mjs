import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {initializeDatasetBrowser} from '../public/dataset-browser.js';
import {initializeCompactNavigation} from '../public/compact-navigation-v47.js';

const {parseHTML}=await import(pathToFileURL(process.argv[2]||'/tmp/heart-review-test-deps/node_modules/linkedom/esm/index.js'));
const html=await readFile(new URL('../page.html',import.meta.url),'utf8');
function fixture(){
 const {document,window}=parseHTML(html);
 initializeDatasetBrowser(document,{href:'https://heart.example/?donor=s-20-29&review=1#old-view',search:'?donor=s-20-29&review=1'});
 return {document,window,button:document.querySelector('#compactDonorPicker'),bar:document.querySelector('.dataset-browser')};
}

test('compact donor disclosure reuses all source links and preserves exact current donor semantics',()=>{
 const f=fixture(),links=[...f.bar.querySelectorAll('[data-source-link]')];
 assert.equal(f.document.body.classList.contains('compact-navigation-ready'),true,'Compact source navigation is available on Reconstruction as soon as its disclosure works.');
 assert.equal(links.length,5);assert.equal(f.button.querySelector('.compact-donor-name').textContent,'S-20-29');
 assert.match(f.button.getAttribute('aria-label'),/S-20-29.*current heart/);
 assert.equal(f.document.getElementById(f.button.getAttribute('aria-controls')),f.bar.querySelector('.dataset-shortcuts'));
 for(const link of links){const url=new URL(link.href);assert.equal(url.searchParams.get('review'),'1');assert.equal(url.hash,'');}
 f.button.click();assert.equal(f.button.getAttribute('aria-expanded'),'true');
 links[0].dispatchEvent(new f.window.Event('click',{bubbles:true}));
 assert.equal(f.button.getAttribute('aria-expanded'),'false');assert.deepEqual([...f.bar.querySelectorAll('[data-source-link]')],links);
});

test('a missing donor disclosure keeps the ordinary source navigation available',()=>{
 const {document}=parseHTML(html);
 document.querySelector('.topbar .brand').remove();
 assert.equal(initializeCompactNavigation(document),null);
 assert.equal(document.body.classList.contains('compact-navigation-ready'),false);
 assert.equal(document.querySelectorAll('[data-source-link]').length,5);
});

test('Escape, outside pointer and a viewport resize dismiss the existing donor menu without duplicating it',()=>{
 const f=fixture();let focused=false;f.button.focus=()=>{focused=true;};
 f.button.click();const escape=new f.window.Event('keydown',{bubbles:true,cancelable:true});Object.defineProperty(escape,'key',{value:'Escape'});f.document.dispatchEvent(escape);
 assert.equal(f.button.getAttribute('aria-expanded'),'false');assert.equal(focused,true);
 f.button.click();f.document.body.dispatchEvent(new f.window.Event('pointerdown',{bubbles:true}));assert.equal(f.button.getAttribute('aria-expanded'),'false');
 f.button.click();f.window.dispatchEvent(new f.window.Event('resize'));assert.equal(f.button.getAttribute('aria-expanded'),'false');
 assert.equal(initializeCompactNavigation(f.document),f.button);assert.equal(f.document.querySelectorAll('#compactDonorPicker').length,1);
});

test('short workspace labels keep full accessible names and original tab relationships',()=>{
 const f=fixture();
 for(const [id,label,target]of [['reconstructionTab','3D Reconstruction','reconstructionPanel'],['echoTab','Echo Windows','echoPanel'],['probeTab','TTE Lab','probePanel'],['teeTab','TEE Lab','teePanel']]){
  const tab=f.document.getElementById(id);assert.equal(tab.getAttribute('aria-label'),label);assert.equal(tab.getAttribute('aria-controls'),target);assert.equal(tab.querySelector('.workspace-tab-label-full').textContent,label);assert.equal(tab.querySelector('.workspace-tab-label-short').getAttribute('aria-hidden'),'true');
 }
 assert.equal(f.document.getElementById('aboutButton').getAttribute('aria-label'),'About the Scan');
 assert.equal(f.document.getElementById('shareView').getAttribute('aria-label'),'Share View');
});
