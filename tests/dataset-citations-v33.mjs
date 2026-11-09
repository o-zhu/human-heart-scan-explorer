import {titleCaseUi} from '../public/ui-text.js';
/** Citation identity and accessible navigation checks; no scan/GPU/network work. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ALL_SOURCES,DONORS} from '../public/donors.js';
import {DATASET_CITATIONS,datasetDetails} from '../public/dataset-citations.js';
import {initializeDatasetBrowser} from '../public/dataset-browser.js';

const entry=process.argv[2];
if(!entry)throw new Error('Pass the installed LinkeDOM ESM entry point.');
const {parseHTML}=await import(pathToFileURL(entry));
const root=new URL('../',import.meta.url);
function fixture(id='slicerheart-4d'){
 const markup=ALL_SOURCES.map(source=>`<a data-source-link="${source.id}" href="?donor=${source.id}" title="Old navigation hint"><strong>${source.specimen}</strong></a>`).join('');
 const {document,window}=parseHTML('<html><body><nav class="dataset-shortcuts">'+markup+'</nav><p id="existingHint">Choose a heart</p><section id="datasetCitations"></section></body></html>');
 document.querySelector('[data-source-link]').setAttribute('aria-describedby','existingHint');
 const href='https://fixture.invalid/?donor='+id+'&context=review#view=other-heart';
 const location={href,search:new URL(href).search};
 initializeDatasetBrowser(document,location);
 return {document,window,location};
}

test('every active source has its own verified citation and the exact HOA dataset DOI/title',async()=>{
 assert.deepEqual(Object.keys(DATASET_CITATIONS).sort(),ALL_SOURCES.map(source=>source.id).sort());
 for(const donor of DONORS){
  const path=donor.id==='ladaf-2021-17'?'docs/source-metadata.json':'docs/donors/'+donor.id+'/source-metadata.json';
  const metadata=JSON.parse(await readFile(new URL(path,root),'utf8'));
  const citation=DATASET_CITATIONS[donor.id];
  assert.equal(citation.doi,metadata.doi);
  assert.equal(citation.doi,donor.doi);
  assert.equal(citation.sourceUrl,donor.datasetUrl);
  assert(citation.citationText.includes(metadata.DOI_title.replace(' um',' µm')));
  const firstAuthor=metadata.DOI_users.split(';')[0].split(',')[1].trim();
  assert(citation.citationText.startsWith(firstAuthor+' '));
  assert.equal(citation.doiLabel,'Dataset DOI');
 }
 const slicer=DATASET_CITATIONS['slicerheart-4d'],cmac=DATASET_CITATIONS['cmac-case-1'];
 assert.match(slicer.label,/Truncal Valve 4D CT/);
 assert.match(slicer.citationText,/^Lasso A, Herz C, Nam H/);
 assert.equal(slicer.doi,'10.3389/fcvm.2022.886549');
 assert.equal(slicer.doiLabel,'Software paper','The software paper is not a sample-specific dataset DOI.');
 assert.match(cmac.label,/volunteer 1/);
 assert.equal(cmac.doi,'10.1016/j.media.2013.03.008');
 assert.equal(cmac.doiLabel,'Database paper');
});

test('citation tooltips preserve navigation, concise names, and existing descriptions',()=>{
 const {document,location}=fixture();
 for(const link of document.querySelectorAll('[data-source-link]')){
  const id=link.dataset.sourceLink,citation=DATASET_CITATIONS[id],tooltip=link.querySelector('[role="tooltip"]');
  const destination=new URL(link.href);
  assert.equal(destination.searchParams.get('donor'),id);
  assert.equal(destination.searchParams.get('context'),'review');
  assert.equal(destination.hash,'');
  assert.equal(link.getAttribute('aria-current')==='page',id==='slicerheart-4d');
  assert(tooltip);
  assert.equal(document.getElementById(tooltip.id),tooltip);
  assert(link.getAttribute('aria-describedby').split(/\s+/).includes(tooltip.id));
  assert(tooltip.textContent.includes(citation.citationText));
  assert(tooltip.textContent.includes(citation.doi));
  assert(!link.getAttribute('aria-label').includes(citation.citationText));
  assert.equal(link.hasAttribute('title'),false,'Avoid two simultaneous hover tooltips.');
  assert.equal(link.querySelectorAll('a').length,0,'A navigation link cannot contain a second link.');
 }
 assert(document.querySelector('[data-source-link]').getAttribute('aria-describedby').includes('existingHint'));
 initializeDatasetBrowser(document,location);
 assert.equal(document.querySelectorAll('.dataset-citation-tooltip').length,5);
 assert.equal(new Set([...document.querySelectorAll('.dataset-citation-tooltip')].map(node=>node.id)).size,5);
});

test('Escape dismisses a hovered citation and fresh pointer/focus entry makes it available again',()=>{
 const {document,window}=fixture(),link=document.querySelector('[data-source-link]');
 const escape=()=>{const event=new window.Event('keydown',{bubbles:true});event.key='Escape';document.dispatchEvent(event);};
 escape();assert.equal(link.dataset.citationDismissed,'true');
 link.dispatchEvent(new window.Event('pointerenter'));assert.equal(link.hasAttribute('data-citation-dismissed'),false);
 escape();link.dispatchEvent(new window.Event('focus'));assert.equal(link.hasAttribute('data-citation-dismissed'),false);
});

test('the footer shows all five source citations with paper/dataset identity and usable original-source links',()=>{
 const {document,location}=fixture('cmac-case-1');
 const mount=document.getElementById('datasetCitations');
 assert.equal(document.getElementById(mount.getAttribute('aria-labelledby')).textContent,'Dataset Citations');
 for(const [id,citation]of Object.entries(DATASET_CITATIONS)){
  const item=mount.querySelector('[data-citation-source="'+id+'"]');
  assert.equal(item.querySelector('h3').textContent,titleCaseUi(citation.label));
  assert.equal(item.querySelector('.dataset-citation-text').textContent,citation.citationText);
  const links=[...item.querySelectorAll('a')];
  assert.equal(links[0].href,'https://doi.org/'+citation.doi);
  assert(links[0].textContent.startsWith(titleCaseUi(citation.doiLabel)));
  assert.equal(links[1].href,citation.sourceUrl);
  for(const link of links){assert.equal(new URL(link.href).protocol,'https:');assert.equal(link.rel,'noopener noreferrer');}
 }
 initializeDatasetBrowser(document,location);
 assert.equal(mount.querySelectorAll('h2').length,1);
 assert.equal(mount.querySelectorAll('.dataset-citation').length,5);
});


test('each donor popup carries the exact comparison facts without loading scan assets',()=>{
 const {document}=fixture();
 for(const donor of DONORS){
  const tooltip=document.querySelector(`[data-source-link="${donor.id}"] [role="tooltip"]`);
  const facts=Object.fromEntries(datasetDetails(donor.id).facts);
  assert.equal(facts['Scan extent'],donor.nativeDimensions.map(size=>(size*donor.nativeSpacingUm/1000).toFixed(1)).join(' × ')+' mm');
  assert.equal(facts['Reported history'],donor.medicalInfo);
  assert(tooltip.textContent.includes(donor.age));
  assert(tooltip.textContent.includes(String(donor.fineSpacingUm)));
  assert.match(tooltip.textContent,/not chamber volume/);
 }
 assert.match(datasetDetails('cmac-case-1').note,/not spatially registered or synchronized/);
 assert.match(datasetDetails('slicerheart-4d').note,/not a healthy reference/);
});

test('touch details remain separate from navigation, can pin and close, and stay in the viewport',()=>{
 const {document,window}=fixture(),link=document.querySelector('[data-source-link]');
 window.innerWidth=375;window.innerHeight=667;
 link.getBoundingClientRect=()=>({left:230,top:120,bottom:184,width:140,height:64});
 const wrapper=link.parentElement,button=wrapper.querySelector('button'),tooltip=link.querySelector('[role="tooltip"]');
 const href=link.href;
 assert.equal(button.closest('a'),null);assert.equal(button.getAttribute('aria-controls'),tooltip.id);
 assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(tooltip.hidden,true);
 button.dispatchEvent(new window.Event('focus'));
 button.dispatchEvent(new window.Event('click',{bubbles:true}));
 assert.equal(tooltip.hidden,false);assert.equal(button.getAttribute('aria-expanded'),'true');
 assert.equal(link.href,href);assert.equal(tooltip.style.left,'16px');assert.equal(tooltip.style.width,'343px');
 assert.equal(tooltip.style.top,'191px');assert.equal(tooltip.style.maxHeight,'460px');
 button.dispatchEvent(new window.Event('click',{bubbles:true}));
 assert.equal(tooltip.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'false');
 button.dispatchEvent(new window.Event('click',{bubbles:true}));
 const event=new window.Event('keydown',{bubbles:true});event.key='Escape';document.dispatchEvent(event);
 assert.equal(tooltip.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'false');
});

test('only one popup is open and outside pointer input dismisses pinned details',()=>{
 const {document,window}=fixture(),buttons=[...document.querySelectorAll('.dataset-info-button')];
 buttons[0].dispatchEvent(new window.Event('click',{bubbles:true}));
 assert.equal(document.querySelectorAll('[role="tooltip"]:not([hidden])').length,1);
 buttons[1].dispatchEvent(new window.Event('click',{bubbles:true}));
 assert.equal(buttons[0].getAttribute('aria-expanded'),'false');
 assert.equal(document.querySelectorAll('[role="tooltip"]:not([hidden])').length,1);
 document.body.dispatchEvent(new window.Event('pointerdown',{bubbles:true}));
 assert.equal(document.querySelectorAll('[role="tooltip"]:not([hidden])').length,0);
});
