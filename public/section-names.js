/** Display names only. Source-axis numbers, sampling and saved views stay fixed. */
export const SOURCE_AXIS_KEYS=Object.freeze(['X','Y','Z']);
const profile=(names,basis,note)=>Object.freeze({names:Object.freeze(names),basis,note});
const SPECIMEN=profile(['Coronal','Sagittal','Axial'],'reviewed-specimen',
 'Approximate anatomical planes for this specimen; no patient-position registration.');
const UNREVIEWED=profile(['Longitudinal 1','Longitudinal 2','Transverse'],'unreviewed-specimen',
 'Specimen planes; anatomical orientation has not been reviewed for this donor.');
const SOURCE=profile(['Source plane 1','Source plane 2','Source plane 3'],'unregistered-source',
 'Stored source planes; anatomical orientation is unavailable.');
const PROBE=profile(['Probe plane 1','Probe plane 2','Probe plane 3'],'probe-local',
 'Probe-local planes; patient orientation is not registered.');
const SAX=profile(['Longitudinal 1','Longitudinal 2','Short-axis'],'acquired-cardiac-short-axis',
 'Acquired cardiac short-axis stack; the longitudinal views are perpendicular to it.');
const validMatrix=m=>Array.isArray(m)&&m.length===3&&m.every(row=>Array.isArray(row)&&row.length===3&&row.every(Number.isFinite));

/** Vectors are source-axis directions in LPS or RAS physical coordinates.
 * Both conventions have left/right, anterior/posterior, superior/inferior as
 * coordinates 0,1,2. Plane names do not depend on the sign of their normal.
 * Only nearly cardinal, orthogonal grids receive unqualified anatomical names.
 */
export function anatomicalNamesFromDirections(vectors){
 if(!validMatrix(vectors))return null;
 const lengths=vectors.map(v=>Math.hypot(...v));if(lengths.some(n=>n<1e-8))return null;
 const unit=vectors.map((v,i)=>v.map(x=>x/lengths[i]));
 for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(Math.abs(unit[i].reduce((n,x,k)=>n+x*unit[j][k],0))>.001)return null;
 const axes=unit.map(v=>v.map(Math.abs).indexOf(Math.max(...v.map(Math.abs))));
 if(new Set(axes).size!==3||unit.some((v,i)=>Math.abs(v[axes[i]])<Math.cos(5*Math.PI/180)))return null;
 return axes.map(axis=>['Sagittal','Coronal','Axial'][axis]);
}

export function sectionNamingFor({source,series}={}){
 if(series){
  // An identity matrix in a probe-local grid is not patient orientation.
  if(series.modality==='US')return PROBE;
  if(series.modality==='MRI'&&series.coordinateSystem==='DICOM LPS'&&/^(?:c)?SAX$/i.test(series.sourceHeader?.seriesDescription||''))return SAX;
  let vectors,basis;
  if(series.coordinateSystem==='DICOM LPS'&&validMatrix(series.direction)){
   // prepare-cmac-v19 stores physical basis vectors in matrix columns.
   vectors=SOURCE_AXIS_KEYS.map((_,axis)=>series.direction.map(row=>row[axis]));basis='dicom-patient-directions';
  }else if(series.geometry?.space==='right-anterior-superior'&&validMatrix(series.geometry.directionsRAS)){
   // NRRD space directions are a list of vectors, one per source axis.
   vectors=series.geometry.directionsRAS;basis='nrrd-patient-directions';
  }
  const names=anatomicalNamesFromDirections(vectors);
  return names?profile(names,basis,'Anatomical names follow the recorded scan orientation; images retain their stored orientation.'):SOURCE;
 }
 if(source?.kind==='clinical')return SOURCE;
 return source?.id==='ladaf-2021-17'?SPECIMEN:UNREVIEWED;
}

export const sectionName=(naming,axis)=>naming.names[axis]||'Source plane';
export const sectionLabel=(naming,axis)=>{
 const name=sectionName(naming,axis);return /plane \d$/.test(name)?name:name+' section';
};
export const linkedSectionText=(naming,axis)=>sectionName(naming,axis)+' is linked to the 3D cutaway';

export function updateSectionExpandLabel(control){
 const expanded=control.getAttribute('aria-expanded')==='true';
 control.setAttribute('aria-label',expanded?'Show all sections':'Enlarge '+(control.dataset.sectionLabel||'section'));
 const text=control.querySelector('span');if(text)text.textContent=expanded?'All Sections':'Enlarge';
}

/** Apply names together whenever a donor or clinical series becomes active. */
export function applySectionNames(root,naming){
 const byId=id=>root.getElementById(id);
 for(const [axis,key]of SOURCE_AXIS_KEYS.entries()){
  const name=sectionName(naming,axis),label=sectionLabel(naming,axis);
  const canvas=byId('slice'+key),card=canvas?.closest('.slice-card');
  const namedSlot={Coronal:'first',Sagittal:'second',Axial:'wide'};
  if(card)card.dataset.sectionSlot=namedSlot[name]||['first','second','wide'][axis];
  const heading=card?.querySelector('[data-section-name]');if(heading)heading.textContent=name;
  const activate=card?.querySelector('.slice-activate');
  activate?.setAttribute('title','Link the 3D cutaway to the '+label);
  const marker=card?.querySelector('.slice-axis-marker');if(marker){marker.textContent=name;marker.title=naming.note;}
  canvas?.setAttribute('aria-label',label+'. Scroll to move the 3D cutaway, or use arrow keys. Enter faces this section.');
  byId('sliceRange'+key)?.setAttribute('aria-label',label+' position');
  card?.querySelectorAll('[data-section-step]').forEach(button=>button.setAttribute('aria-label',(Number(button.dataset.sectionStep)<0?'Previous ':'Next ')+label));
  const expand=card?.querySelector('[data-section-expand]');if(expand){expand.dataset.sectionLabel=label;updateSectionExpandLabel(expand);}
  const option=root.querySelector('#clipAxis option[value="'+key.toLowerCase()+'"]');
  if(option)option.textContent=/plane \d$/.test(name)?name.replace('plane','Plane'):name+' Plane';
 }
 const note=byId('sectionOrientationNote');if(note)note.textContent=naming.note;
}
