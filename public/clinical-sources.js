/** Acquired clinical pilots are kept separate from preserved HOA donor metadata. */
export const CLINICAL_PILOTS=Object.freeze([
 Object.freeze({id:'cmac-case-1',kind:'clinical',ready:false,unavailableReason:"This dataset is not included in the public distribution. See docs/open-source/assets.md for asset setup and the source permission requirements.",specimen:'cMAC · volunteer 1',label:'cMAC · volunteer 1 · MRI + 4D echo',
  datasetUrl:'https://www.cardiacatlas.org/motion-tracking-2011-challenge/',manifestUrl:'./assets/clinical-v19/cmac/manifest.json'}),
 Object.freeze({id:'slicerheart-4d',kind:'clinical',ready:false,unavailableReason:"This dataset is not included in the public distribution. See docs/open-source/assets.md for asset setup and the source permission requirements.",specimen:'SlicerHeart · 4D CT',label:'SlicerHeart · 4D cardiac CT',
  datasetUrl:'https://github.com/SlicerHeart/SlicerHeart',manifestUrl:'./assets/clinical-v19/slicerheart/manifest.json'})
]);
