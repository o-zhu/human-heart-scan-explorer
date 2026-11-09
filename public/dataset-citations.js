/**
 * Citation metadata for the five source datasets, independent of scan loading.
 * HOA titles and creator order come from retained ESRF DOI metadata. Clinical
 * references follow the official cMAC challenge and SlicerHeart publisher page;
 * their paper DOIs are deliberately distinguished from dataset DOIs.
 */
import {titleCaseUi} from './ui-text.js';
import {ALL_SOURCES,spacingLabel} from './donors.js';

export const DATASET_CITATIONS=Object.freeze({
 'ladaf-2021-17':Object.freeze({
  label:'LADAF-2021-17',
  citationText:'Brunet J, Cook AC, Walsh CL, et al. (2024). Complete scan at 19.85 µm of the heart of the body donor LADAF-2021-17. European Synchrotron Radiation Facility.',
  doi:'10.15151/ESRF-DC-1634390196',doiLabel:'Dataset DOI',
  sourceUrl:'https://human-organ-atlas.esrf.fr/datasets/1659197537',sourceLabel:'Original scan'
 }),
 's-20-29':Object.freeze({
  label:'S-20-29',
  citationText:'Walsh CL, Brunet J, Berruyer C, et al. (2024). Complete scan at 19.89 µm of the heart of the body donor S-20-29. European Synchrotron Radiation Facility.',
  doi:'10.15151/ESRF-DC-1773964017',doiLabel:'Dataset DOI',
  sourceUrl:'https://human-organ-atlas.esrf.fr/datasets/1773963465',sourceLabel:'Original scan'
 }),
 's-20-28':Object.freeze({
  label:'S-20-28',
  citationText:'Brunet J, Cook AC, Walsh CL, et al. (2024). Overview scan at 19.85 µm of the heart of the body donor S-20-28. European Synchrotron Radiation Facility.',
  doi:'10.15151/ESRF-DC-1966163810',doiLabel:'Dataset DOI',
  sourceUrl:'https://human-organ-atlas.esrf.fr/datasets/1966162746',sourceLabel:'Original scan'
 }),
 'slicerheart-4d':Object.freeze({
  label:'SlicerHeart · Truncal Valve 4D CT',
  citationText:'Lasso A, Herz C, Nam H, et al. (2022). SlicerHeart: An open-source computing platform for cardiac image analysis and modeling. Frontiers in Cardiovascular Medicine 9:886549.',
  doi:'10.3389/fcvm.2022.886549',doiLabel:'Software paper',
  sourceUrl:'https://github.com/SlicerHeart/SlicerHeart/blob/master/ValveAnnulusAnalysis/ValveAnnulusAnalysis.py',sourceLabel:'Sample source'
 }),
 'cmac-case-1':Object.freeze({
  label:'cMAC · volunteer 1 · MRI + 4D echo',
  citationText:'Tobon-Gomez C, De Craene M, McLeod K, et al. (2013). Benchmarking framework for myocardial tracking and deformation algorithms: An open access database. Medical Image Analysis 17(6):632–648.',
  doi:'10.1016/j.media.2013.03.008',doiLabel:'Database paper',
  sourceUrl:'https://www.cardiacatlas.org/motion-tracking-2011-challenge/',sourceLabel:'Challenge data'
 })
});

const tooltipLinks=new WeakMap(),tooltipDocuments=new WeakMap();
function element(document,tag,className,text){
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text)node.textContent=text;
 return node;
}

/** Sourced comparison facts, without loading another donor's scan. */
export function datasetDetails(sourceId){
 const source=ALL_SOURCES.find(item=>item.id===sourceId);
 if(source?.nativeDimensions){
  const extent=source.nativeDimensions.map(size=>(size*source.nativeSpacingUm/1000).toFixed(1)).join(' × ')+' mm';
  return {
   facts:[['Source','Human Organ Atlas · preserved whole heart'],['Donor',[source.age,source.sex].filter(Boolean).join(' · ')],['Reported history',source.medicalInfo],['Native voxel',spacingLabel(source.nativeSpacingUm)],['Ultra sample',spacingLabel(source.fineSpacingUm)],['Scan extent',extent]],
   note:(source.id==='ladaf-2021-17'?'':'Relatively open cavities in the reviewed preserved scan. ')+ 'Scan extent includes surrounding space; it is not chamber volume. These donors are not matched healthy controls.'
  };
 }
 if(sourceId==='slicerheart-4d')return {
  facts:[['Source','SlicerHeart · acquired 4D CT'],['Case','Adolescent with repaired truncus arteriosus; exact age and sex not supplied'],['Native grid','0.600 × 0.600 × 0.700 mm'],['Motion','20 distinct acquired phases; a repeated closing frame is skipped']],
  note:'A congenital-heart-disease example, not a healthy reference. Physical phase times and matched ultrasound are not supplied.'
 };
 if(sourceId==='cmac-case-1')return {
  facts:[['Source','Cardiac Atlas Project · cMAC volunteer 1'],['Case','Healthy-volunteer cohort; individual age and sex not supplied'],['Whole-heart MRI','0.75 × 0.75 × 1.5 mm stored grid; 3 mm slice thickness'],['Motion','30 cine MRI phase slots and 14 measured ultrasound volumes']],
  note:'MRI and ultrasound are separate acquisitions from the same volunteer. They are not spatially registered or synchronized in this viewer.'
 };
 return {facts:[],note:''};
}

/** Details overlay the page rather than taking height from the Echo sidebar.
 * Hover/focus opens them; the separate info button pins them for touch users. */
export function attachDatasetCitation(document,link,sourceId){
 const citation=DATASET_CITATIONS[sourceId];
 if(!citation)return;
 let tooltip=link.querySelector('.dataset-citation-tooltip');
 if(!tooltip){
  tooltip=element(document,'span','dataset-citation-tooltip');
  const baseId='dataset-citation-tooltip-'+sourceId;
  let id=baseId,index=1;
  while(document.getElementById(id))id=baseId+'-'+(++index);
  tooltip.id=id;tooltip.setAttribute('role','tooltip');link.append(tooltip);
 }
 const details=datasetDetails(sourceId);const source=ALL_SOURCES.find(item=>item.id===sourceId);
 const facts=details.facts,note=source?.ready===false?source.unavailableReason+' '+details.note:details.note;
 const rows=element(document,'span','dataset-detail-facts');
 for(const [label,value]of facts){
  const row=element(document,'span','dataset-detail-row');
  row.append(element(document,'b',null,label),element(document,'span',null,value));rows.append(row);
 }
 tooltip.replaceChildren(element(document,'strong','dataset-detail-title',citation.label),rows,
  element(document,'span','dataset-detail-note',note),
  element(document,'span','dataset-detail-citation',citation.citationText+' '+citation.doiLabel+': '+citation.doi+'.'));
 const descriptions=new Set((link.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));
 descriptions.add(tooltip.id);
 link.setAttribute('aria-describedby',[...descriptions].join(' '));
 // A custom tooltip handles both focus and hover without a competing native one.
 link.removeAttribute('title');
 if(tooltipLinks.has(link))return;
 let wrapper=link.parentElement;
 if(!wrapper.classList.contains('dataset-choice')){
  wrapper=element(document,'span','dataset-choice');link.before(wrapper);wrapper.append(link);
 }
 const button=element(document,'button','dataset-info-button','i');button.type='button';
 button.setAttribute('aria-label','Details about '+citation.label);button.setAttribute('aria-controls',tooltip.id);button.setAttribute('aria-expanded','false');wrapper.append(button);
 tooltip.hidden=true;
 const view=document.defaultView;
 let pinned=false,hovered=false,closeTimer;
 const position=()=>{
  const rect=link.getBoundingClientRect?.();if(!rect)return;
  const width=Math.min(390,Math.max(200,(view?.innerWidth||800)-32));
  const left=Math.max(16,Math.min(rect.left,(view?.innerWidth||800)-width-16));
  const top=Math.max(8,Math.min(rect.bottom+7,(view?.innerHeight||800)-180));
  tooltip.style.width=width+'px';tooltip.style.left=left+'px';tooltip.style.top=top+'px';
  tooltip.style.maxHeight=Math.max(150,(view?.innerHeight||800)-top-16)+'px';
 };
 const close=(dismissed=false)=>{
  clearTimeout(closeTimer);pinned=false;tooltip.hidden=true;button.setAttribute('aria-expanded','false');
  if(dismissed)link.dataset.citationDismissed='true';
 };
 const show=()=>{
  clearTimeout(closeTimer);link.removeAttribute('data-citation-dismissed');
  for(const state of tooltipDocuments.get(document)?.states||[])if(state.link!==link)state.close();
  position();tooltip.hidden=false;button.setAttribute('aria-expanded','true');
 };
 const scheduleClose=()=>{
  clearTimeout(closeTimer);closeTimer=setTimeout(()=>{
   if(!pinned&&!hovered&&!wrapper.contains(document.activeElement))close();
  },120);
 };
 wrapper.addEventListener('pointerenter',()=>{hovered=true;show();});
 wrapper.addEventListener('pointerleave',()=>{hovered=false;scheduleClose();});
 link.addEventListener('pointerenter',show);link.addEventListener('focus',show);
 link.addEventListener('blur',scheduleClose);button.addEventListener('focus',show);button.addEventListener('blur',scheduleClose);
 button.addEventListener('click',event=>{event.preventDefault();if(pinned)close(true);else{show();pinned=true;}});
 const state={link,wrapper,tooltip,close,position};tooltipLinks.set(link,state);
 if(!tooltipDocuments.has(document)){
  const registry={states:[]};tooltipDocuments.set(document,registry);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')for(const item of registry.states)item.close(true);});
  document.addEventListener('pointerdown',event=>{for(const item of registry.states)if(!item.wrapper.contains(event.target))item.close();});
  const reposition=()=>{for(const item of registry.states)if(!item.tooltip.hidden)item.position();};
  view?.addEventListener?.('resize',reposition);view?.addEventListener?.('scroll',reposition,true);
 }
 tooltipDocuments.get(document).states.push(state);
}

/** Render all sources together; no scan data or network request is needed. */
export function renderDatasetCitations(document){
 const mount=document.getElementById('datasetCitations');
 if(!mount)return;
 const heading=element(document,'h2',null,'Dataset Citations');
 heading.id='datasetCitationsTitle';
 mount.setAttribute('aria-labelledby',heading.id);
 const list=element(document,'ol','dataset-citations-list');
 for(const [id,citation]of Object.entries(DATASET_CITATIONS)){
  const item=element(document,'li','dataset-citation');
  item.dataset.citationSource=id;
  const links=element(document,'div','dataset-citation-links');
  const doi=element(document,'a',null,titleCaseUi(citation.doiLabel)+' · '+citation.doi);
  doi.href='https://doi.org/'+citation.doi;
  const source=element(document,'a',null,titleCaseUi(citation.sourceLabel));
  source.href=citation.sourceUrl;
  for(const link of [doi,source]){link.target='_blank';link.rel='noopener noreferrer';links.append(link);}
  item.append(element(document,'h3',null,titleCaseUi(citation.label)),element(document,'p','dataset-citation-text',citation.citationText),links);
  list.append(item);
 }
 mount.replaceChildren(heading,list);
}
