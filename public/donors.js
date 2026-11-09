/** Every donor keeps an independent source identity, physical scale and cache. */
import {defaultWindowFor} from './window-presets.js';
import {CLINICAL_PILOTS} from './clinical-sources.js';
function comparisonDonor({id,specimen,age,sex,medicalInfo,summary,datasetId,doi,nativeSpacingUm,nativeDimensions,sourceWindow,displayWindow}) {
  const root='./assets/donors/'+id+'/';
  return Object.freeze({
    id,ready:true,specimen,label:specimen+' · '+age+' · '+sex,
    age,sex,medicalInfo,summary,datasetId,
    datasetUrl:'https://human-organ-atlas.esrf.fr/datasets/'+datasetId,doi,
    nativeSpacingUm,nativeDimensions,sourceWindow,fineSpacingUm:nativeSpacingUm*4,
    originalDisplayWindow:displayWindow,displayWindow:defaultWindowFor({id,displayWindow}),
    manifestUrl:root+'manifest.json',ultraManifestUrl:root+'ultra-sections.json',
    ultraVolumeManifestUrl:root+'ultra-volume.json',cleanupManifestUrl:root+'cleanup/manifest.json',
    anatomyManifestUrl:root+'anatomy/manifest.json?v=donor-regions-v17',echoPlanesUrl:root+'echo-planes.json?v=probe-entry-v14',echoTexturesUrl:root+'echo-textures.json',
    flowViewsUrl:root+'flow-views.json',clinicalPresetsReviewed:false,geometricComparisonOnly:true,
    cacheName:'heart-'+id+'-ultra-v11',volumeCacheName:'heart-'+id+'-volume-v11',
    pauseKey:'heart-'+id+'-collection-paused',
  });
}
export const DONORS = Object.freeze([
  Object.freeze({
    id:'ladaf-2021-17', specimen:'LADAF-2021-17', label:'LADAF-2021-17 · 63 years',
    age:'63 years', medicalInfo:'Adult donor',
    datasetId:'1659197537', datasetUrl:'https://human-organ-atlas.esrf.fr/datasets/1659197537',
    doi:'10.15151/ESRF-DC-1634390196', nativeSpacingUm:19.85, fineSpacingUm:79.4,
    nativeDimensions:[7614,7614,8480],sourceWindow:[14640,23545],
    originalDisplayWindow:{windowEnabled:false,windowLow:0,windowHigh:1,windowGamma:1,capContrast:1.8,cutFaceExposure:1.35},
    displayWindow:defaultWindowFor({id:'ladaf-2021-17'}),
    manifestUrl:'./assets/manifest.json', ultraManifestUrl:'./assets/display-compact-v29/sections-manifest.json',
    ultraVolumeManifestUrl:'./assets/ultra-volume-v7.json', cleanupManifestUrl:'./assets/cleanup/manifest.json',
    anatomyManifestUrl:'./assets/anatomy/manifest.json?v=la-exterior-v17', echoPlanesUrl:'./assets/echo-planes.json?v=echo-correspondence-v11',
    echoTexturesUrl:'./assets/echo-textures.json', flowViewsUrl:'./assets/flow-views-v5.json',
    clinicalPresetsReviewed:false, correspondenceAudit:'echo-v11', cacheName:'heart-ladaf-hosted-ultra-v29', volumeCacheName:'heart-ultra-volume-v7',
    pauseKey:'heart-ultra-collection-v7-paused',
  }),
  comparisonDonor({"id":"s-20-29","specimen":"S-20-29","age":"80 years","sex":"male","medicalInfo":"Acute right-heart failure; pulmonary thromboembolism; COVID-19","summary":"Male \u00b7 preserved whole heart","datasetId":"1773963465","doi":"10.15151/ESRF-DC-1773964017","nativeSpacingUm":19.89,"nativeDimensions":[7639,7639,7771],"sourceWindow":[19300,23000],"displayWindow":{"windowEnabled":true,"windowLow":0.13513513513513514,"windowHigh":0.6216216216216216,"windowGamma":0.9,"capContrast":1,"cutFaceExposure":2.7}}),
  comparisonDonor({"id":"s-20-28","specimen":"S-20-28","age":"84 years","sex":"male","medicalInfo":"Died from COVID-19","summary":"Male \u00b7 preserved whole heart","datasetId":"1966162746","doi":"10.15151/ESRF-DC-1966163810","nativeSpacingUm":19.85,"nativeDimensions":[7613,7613,8128],"sourceWindow":[14938,22708],"displayWindow":{"windowEnabled":true,"windowLow":0.2782496782496782,"windowHigh":0.8445302445302445,"windowGamma":0.9,"capContrast":1,"cutFaceExposure":2.7}}),
]);

export const ALL_SOURCES=Object.freeze([...DONORS,...CLINICAL_PILOTS]);

export function donorFromSearch(search='') {
  const id=new URLSearchParams(search).get('donor');
  return ALL_SOURCES.find(donor=>(donor.id===id || donor.datasetId===id)) || DONORS[0];
}

export function donorUrl(href,id) {
  const donor=ALL_SOURCES.find(item=>item.id===id);
  if(!donor)throw new Error('Unknown donor.');
  const url=new URL(href);url.searchParams.set('donor',donor.id);url.hash='';
  return url;
}

export function spacingLabel(value) {
  return Number(value).toLocaleString('en-US',{maximumFractionDigits:3})+' µm';
}
