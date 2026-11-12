import {titleCaseUi} from './ui-text.js';
import {teeIllustrationAngleMarkup} from './multiplane-indicator.js';

// TTE is a project teaching selection. TEE follows the eleven views in the
// ASE/SCA 2013 basic perioperative consensus; neither is a complete examination.
export const BASIC_REFERENCE_IDS = Object.freeze({
  tte: Object.freeze(['plax','psax_av','psax_mitral','psax_papillary','a4c','a5c','a2c','a3c','subcostal','subcostal_ivc']),
  tee: Object.freeze(['me4c','me2c','melax','meaaolax','meaaosax','meavsax','mervinout','bicaval','tgpapillary','daosax','daolax'])
});
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const normal = value => String(value).toLowerCase().replace(/[–—-]/g,' ');

export function filterReferenceViews(presets, {mode='tte', level='advanced', group='all', search=''}={}) {
  const terms=normal(search).trim().split(/\s+/).filter(Boolean);
  return presets.filter(view => view.mode===mode &&
    (level!=='basic'||BASIC_REFERENCE_IDS[mode]?.includes(view.id)) &&
    (group==='all'||view.group===group) &&
    terms.every(term=>normal(`${view.code} ${view.name} ${view.shortName||''} ${view.tableRow||''} ${(view.anatomy||[]).join(' ')}`).includes(term)));
}

export function referenceGalleryTemplate(){return `
 <section class="reference-gallery" data-reference="gallery" aria-labelledby="referenceGalleryTitle">
  <header class="reference-gallery-header">
   <div><h2 id="referenceGalleryTitle">Reference Views</h2><p>Choose a view to compare its anatomy and ultrasound.</p></div>
   <div class="reference-gallery-actions"><button type="button" class="reference-fullscreen-exit" data-reference="fullscreen-exit">Exit Fullscreen</button><div class="reference-level" role="group" aria-label="Reference view level">
    <button type="button" data-reference-level="basic" aria-pressed="false">Basic</button>
    <button type="button" data-reference-level="advanced" aria-pressed="true">Advanced</button>
   </div></div>
  </header>
  <div class="reference-gallery-tools">
   <div class="reference-modalities" role="group" aria-label="Reference view approach">
    <button type="button" data-reference-mode="tte" aria-pressed="true"><strong>TTE</strong><span>Transthoracic</span></button>
    <button type="button" data-reference-mode="tee" aria-pressed="false"><strong>TEE</strong><span>Transesophageal</span></button>
   </div>
   <label class="reference-search"><span class="sr-only">Search reference views</span><input type="search" data-reference="search" placeholder="Search views, chambers, or valves…" autocomplete="off"></label>
  </div>
  <div class="reference-groups" data-reference="groups" role="group" aria-label="Filter by acoustic window"></div>
  <div class="reference-gallery-summary"><p data-reference="count" role="status" aria-live="polite"></p><span data-reference="scope">Complete reference catalogue</span></div>
  <div class="reference-gallery-results" data-reference="results"></div>
  <div class="reference-empty" data-reference="empty" hidden><h3>No matching views</h3><p>Try a chamber, valve, or view abbreviation.</p><button type="button" data-reference="clear">Clear filters</button></div>
  <footer class="reference-gallery-footer">
   <p>Labelled teaching schematics · select a card to open the interactive comparison.</p>
   <details><summary>Labels &amp; reference sources</summary><p>LA / RA: left / right atrium · LV / RV: left / right ventricle · Ao: aorta · MV / TV: mitral / tricuspid valve · AV: aortic valve · PV: pulmonary valve in outflow views, pulmonary vein in venous views · PA: pulmonary artery · RPA / LPA: right / left pulmonary artery · IVC / SVC: inferior / superior vena cava · HV: hepatic vein · LAA: left atrial appendage · CS: coronary sinus.</p><p>Pulmonary vein labels identify side and level (e.g. RSPV, LUPV), or use Sup PV / Inf PV for superior / inferior veins. RCC / LCC / NCC: right / left / noncoronary aortic cusp. AAo / DAo: ascending / descending aorta.</p><p>Illustrations are simplified anatomical teaching guides, not patient images. Basic TTE is a selected introductory set; Basic TEE follows the eleven consensus basic perioperative views. A selection of views is not a complete examination.</p><div><a href="https://www.asecho.org/wp-content/uploads/2019/01/2019_Comprehensive-TTE.pdf" target="_blank" rel="noopener">ASE TTE · 2019</a><a href="https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf" target="_blank" rel="noopener">ASE / SCA TEE · 2013</a><a href="https://www.asecho.org/wp-content/uploads/2013/05/Basic-Perioperative-TEE-Exam.pdf" target="_blank" rel="noopener">Basic perioperative TEE</a></div></details>
  </footer>
 </section>
 <span class="reference-detail-navigation" data-reference="detail-navigation" hidden><button type="button" data-reference="back" aria-label="All Reference Views" title="Return to all reference views"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5-7 7 7 7M3 12h18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><span>All Reference Views</span></button></span>`;}

export function mountReferenceGallery({mount,presets,groups,onSelect,onBack}) {
  const find=name=>mount.querySelector(`[data-reference="${name}"]`);
  const gallery=find('gallery'),results=find('results'),workspace=mount.querySelector('.echo-workspace');
  // Keep return navigation in the existing view heading. The compact layout
  // hides that heading, so its toolbar gets an equivalent, separately labelled
  // control. Neither control creates another row above the workspace.
  const navigation=find('detail-navigation'),heading=mount.querySelector('.echo-active-view > div');
  if(heading)heading.prepend(navigation);
  const compactNavigation=mount.querySelector('[data-echo="compact-navigation"]');
  const compactBack=compactNavigation?find('back').cloneNode(true):null;
  if(compactBack){
    compactBack.dataset.reference='back-compact';compactBack.classList.add('reference-back-compact');
    compactBack.querySelector('span').textContent='All views';compactNavigation.prepend(compactBack);
  }
  const state={mode:'tte',level:'advanced',group:'all',search:''};
  const removers=[];
  let selectedId=null,scrollY=0,panelScrollTop=0;
  const listen=(node,event,fn)=>{node.addEventListener(event,fn);removers.push(()=>node.removeEventListener(event,fn));};
  const render=()=>{
    const eligible=filterReferenceViews(presets,{...state,group:'all',search:''});
    const views=filterReferenceViews(presets,state);
    const availableGroups=groups[state.mode].filter(group=>eligible.some(view=>view.group===group.id));
    find('groups').innerHTML=[{id:'all',name:'All Views'},...availableGroups].map(group=>`<button type="button" data-reference-group="${group.id}" aria-pressed="${state.group===group.id}">${escapeHTML(titleCaseUi(group.name))}</button>`).join('');
    for(const button of mount.querySelectorAll('[data-reference-level]'))button.setAttribute('aria-pressed',String(button.dataset.referenceLevel===state.level));
    for(const button of mount.querySelectorAll('[data-reference-mode]'))button.setAttribute('aria-pressed',String(button.dataset.referenceMode===state.mode));
    find('count').textContent=`${views.length} ${state.mode.toUpperCase()} ${views.length===1?'view':'views'}`;
    find('scope').textContent=state.level==='advanced'?'Complete reference catalogue':state.mode==='tee'?'11 basic perioperative views':'10 introductory views';
    find('search').placeholder=`Search ${state.mode.toUpperCase()} views, chambers, or valves…`;
    results.innerHTML=availableGroups.map(group=>{
      const members=views.filter(view=>view.group===group.id);if(!members.length)return '';
      return `<section class="reference-view-group" aria-labelledby="reference-group-${group.id}"><h3 id="reference-group-${group.id}">${escapeHTML(titleCaseUi(group.name))}<span>${members.length}</span></h3><div class="reference-card-grid">${members.map(view=>{
        const title=titleCaseUi(view.shortName||view.name),meta=state.mode==='tee'?view.angles:`ASE ${view.tableRow}`;
        return `<button class="reference-card" type="button" data-reference-view="${view.id}" aria-label="Open ${escapeHTML(titleCaseUi(view.name))}"><span class="reference-card-image"><img src="${escapeHTML(view.thumbnail||view.illustration||view.diagram)}" ${view.thumbnail?`srcset="${escapeHTML(view.thumbnail)} 384w, ${escapeHTML(view.illustration)} 960w" sizes="(max-width: 600px) 44vw, (max-width: 1000px) 29vw, 220px"`:''} width="384" height="384" alt="${escapeHTML(`${titleCaseUi(view.name)}: ${(view.iconLabels||view.anatomy||[]).join(', ')}`)}" loading="lazy" decoding="async">${teeIllustrationAngleMarkup(view,{className:'reference-card-angle'})}</span><span class="reference-card-copy"><span class="reference-card-code">${escapeHTML(view.code)}<span>${escapeHTML(meta||'')}</span></span><span class="reference-card-name">${escapeHTML(title)}</span></span></button>`;
      }).join('')}</div></section>`;
    }).join('');
    find('empty').hidden=views.length!==0;
  };
  listen(find('groups'),'click',event=>{const button=event.target.closest('[data-reference-group]');if(!button)return;state.group=button.dataset.referenceGroup;render();find('groups').querySelector(`[data-reference-group="${state.group}"]`)?.focus({preventScroll:true});});
  listen(find('search'),'input',()=>{state.search=find('search').value;render();});
  for(const button of mount.querySelectorAll('[data-reference-level]'))listen(button,'click',()=>{state.level=button.dataset.referenceLevel;state.group='all';render();});
  for(const button of mount.querySelectorAll('[data-reference-mode]'))listen(button,'click',()=>{state.mode=button.dataset.referenceMode;state.group='all';state.search='';find('search').value='';render();});
  listen(find('clear'),'click',()=>{state.search='';state.group='all';find('search').value='';render();find('search').focus();});
  listen(results,'click',event=>{const button=event.target.closest('[data-reference-view]');if(!button)return;selectedId=button.dataset.referenceView;scrollY=mount.ownerDocument.defaultView?.scrollY||0;panelScrollTop=mount.scrollTop||0;onSelect(selectedId);});
  listen(find('back'),'click',()=>onBack());
  if(compactBack)listen(compactBack,'click',()=>onBack());
  listen(find('fullscreen-exit'),'click',()=>{const doc=mount.ownerDocument,exit=doc.exitFullscreen||doc.webkitExitFullscreen;if(exit)Promise.resolve(exit.call(doc)).catch(()=>{find('count').textContent='Use your browser’s exit control to leave fullscreen.';});});
  render();
  return {
    get state(){return {...state};},
    get visible(){return !gallery.hidden;},
    restore(saved={}){
      state.mode=groups[saved.mode]?saved.mode:'tte';state.level=saved.level==='basic'?'basic':'advanced';
      state.group=groups[state.mode].some(group=>group.id===saved.group)?saved.group:'all';
      if(state.group!=='all'&&!filterReferenceViews(presets,{...state,search:''}).length)state.group='all';
      state.search=typeof saved.search==='string'?saved.search.slice(0,160):'';find('search').value=state.search;render();
    },
    show({mode=state.mode,focus=false}={}){
      if(mode!==state.mode){state.mode=mode;state.group='all';state.search='';find('search').value='';render();}
      gallery.hidden=false;workspace.hidden=true;find('detail-navigation').hidden=true;mount.classList.add('reference-gallery-open');
      if(focus){mount.scrollTop=panelScrollTop;mount.ownerDocument.defaultView?.scrollTo?.({top:scrollY,behavior:'instant'});(results.querySelector(`[data-reference-view="${selectedId}"]`)||find('search')).focus({preventScroll:true});}
    },
    hide(){gallery.hidden=true;workspace.hidden=false;find('detail-navigation').hidden=false;mount.classList.remove('reference-gallery-open');},
    destroy(){for(const remove of removers)remove();compactBack?.remove();}
  };
}
