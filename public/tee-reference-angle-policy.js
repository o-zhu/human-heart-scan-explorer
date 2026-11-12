/** Source-pixel review of all 33 TEE recordings, 2026-11-12.
 * Native scanner graphics always take precedence. Only explicitly reviewed
 * recordings without a native angle receive the labelled REF supplement.
 * Review evidence and source hashes: docs/tee-video-qc-v56/README.md.
 */
const publisherBase='https://ars.els-cdn.com/content/image/1-s2.0-S0894731713005622-mmc';
const publisher=[
 ["me5c","reference",570822],
 ["me4c","native",609025],
 ["mecommissural","native",588092],
 ["me2c","native",572438],
 ["melax","native",601124],
 ["meavlax","native",588155],
 ["meaaolax","native",310001],
 ["meaaosax","native",359646],
 ["merpv","native",668945],
 ["meavsax","native",570294],
 ["mervinout","native",730864],
 ["memodbicaval","reference",304133],
 ["bicaval","native",581237],
 ["mepv","native",259228],
 ["melaa","native",738669],
 ["tgbasalsax","native",707391],
 ["tgpapillary","native",718038],
 ["tgapicalsax","native",662592],
 ["tgrvbasal","native",700399],
 ["tgrvinout","native",526418],
 ["deeptg5c","native",515670],
 ["tg2c","native",681557],
 ["tgrvin","native",549199],
 ["tglax","native",590191],
 ["daosax","native",599931],
 ["daolax","native",588293],
 ["uearchlax","native",395858],
 ["uearchsax","native",517285],
];
const local=[
 ["tee-me4c","me4c",549072,"83eedb22414672a30080f71ccd8ad250a42c84215d54bad99168915277742cc5"],
 ["tee-melax","melax",243634,"82830ac080fca95fd8c3b8232ca22a304c46bd07244f970e92bb7de3086b1cdc"],
 ["tee-me2c","me2c",1137327,"36b240321704d70c870f3d02ffaf10c8e53ec6711ad43a29946a3c9f825bb9c1"],
 ["tee-bicaval","bicaval",625027,"29b51cbdb9e6b64ae36b1b45c8d0a7a5d6351684924d3d362e86eed392cdcf6d"],
 ["tee-tgpapillary","tgpapillary",1435222,"1c34bbee25bbfa03cd8dd6423c16632ea1fb2ce5b6e3614d7422da791beaccff"],
];
export const TEE_MULTIPLANE_SOURCE_REVIEWS=Object.freeze([
 ...publisher.map(([preset,kind,bytes],index)=>Object.freeze({
  id:`ase-2013-tee-${String(index+1).padStart(2,'0')}`,preset,kind,bytes,
  url:`${publisherBase}${index+1}.mp4`,external:true,
  placement:kind==='reference'?'reviewed':null,
 })),
 ...local.map(([id,preset,bytes,sha256])=>Object.freeze({
  id,preset,kind:'reference',bytes,sha256,url:`./assets/echo-media-v7/${id}.mp4`,
  external:false,placement:'corner',
 })),
]);
const byId=new Map(TEE_MULTIPLANE_SOURCE_REVIEWS.map(review=>[review.id,review]));

/** Bind the review to the exact catalog source, not its view name. A replaced
 * or unreviewed source gets no invented annotation until its pixels are reviewed.
 * The player's decoded URL may separately be a verified cache object URL. */
export function reviewedTeeAngleSource(clip){
 if(clip?.mode!=='tee'||(clip.kind&&clip.kind!=='video')||clip.mimeType!=='video/mp4')return null;
 const review=byId.get(clip.id);
 if(!review||clip.preset!==review.preset||clip.url!==review.url||clip.bytes!==review.bytes||!!clip.external!==review.external)return null;
 if(review.sha256&&clip.sha256!==review.sha256)return null;
 return review;
}

