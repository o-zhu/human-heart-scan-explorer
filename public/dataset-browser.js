import {ALL_SOURCES,donorFromSearch,donorUrl} from './donors.js';
import {attachDatasetCitation,renderDatasetCitations} from './dataset-citations.js';

/** Navigation stays usable while the selected scan is still preparing. */
export function initializeDatasetBrowser(document,location){
 const current=donorFromSearch(location.search||'');
 for(const link of document.querySelectorAll('[data-source-link]')){
  const source=ALL_SOURCES.find(item=>item.id===link.dataset.sourceLink);
  if(!source)continue;
  // Preserve the source-navigation contract: retain other
  // query parameters, but never transplant a saved view between datasets.
  link.href=donorUrl(location.href,source.id).href;
  if(source.id===current.id)link.setAttribute('aria-current','page');
  else link.removeAttribute('aria-current');
  link.setAttribute('aria-label',source.label+(source.id===current.id?' · current heart':' · open this heart'));
  if(source.ready===false){
   link.dataset.availability='not-included';
   const subtitle=link.querySelector('span');if(subtitle)subtitle.textContent='Not included · source details';
   link.setAttribute('aria-label',source.label+' · dataset not included; open asset setup notice');
  }
  attachDatasetCitation(document,link,source.id);
 }
 renderDatasetCitations(document);
}

if(typeof document!=='undefined'&&typeof location!=='undefined')initializeDatasetBrowser(document,location);
