"""Reproduce the v5 anatomy candidates and package the reviewed hybrid.

Inputs are the measured s4 scan and the versioned v4 regional annotations. The
s3 scan produces review images. No scan intensities are altered.
"""
from pathlib import Path
import argparse,gzip,hashlib,importlib.util,json,subprocess,sys
import numpy as np

ROOT=Path(__file__).resolve().parents[1]

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--volume',type=Path,required=True,help='Original s4 uint16 NPY, ZYX')
    p.add_argument('--work-dir',type=Path,required=True)
    p.add_argument('--review-volume',type=Path,help='Original s3 uint16 NPY for review figures')
    p.add_argument('--output',type=Path,default=ROOT/'public/assets/anatomy')
    p.add_argument('--package-only',action='store_true',help='Package already reviewed candidate files in --work-dir')
    a=p.parse_args()
    if not a.package_only and not a.review_volume:
        p.error('--review-volume is required to review a new candidate before packaging')
    w=a.work_dir;w.mkdir(parents=True,exist_ok=True)
    baseline=ROOT/'docs/anatomy/v4-reference';meta=json.loads((baseline/'manifest.json').read_text())
    original=gzip.decompress((baseline/'labels.raw.gz').read_bytes())
    assert hashlib.sha256(original).hexdigest()==meta['sha256']
    if not a.package_only:
        spec=importlib.util.spec_from_file_location('prior_anatomy',ROOT/'scripts/prepare_anatomy.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
        base.load_working_volume(a.volume,w)
        np.save(w/'v4-labels.npy',np.frombuffer(original,np.uint8).reshape(meta['dimensions'][::-1]))
        subprocess.run([sys.executable,str(ROOT/'scripts/anatomy-v5-methods.py'),'--work',str(w),'--working-volume',str(w/'working-volume.npy')],check=True)
        if a.review_volume:subprocess.run([sys.executable,str(ROOT/'scripts/anatomy-v5-review.py'),'--work',str(w),'--working-volume',str(w/'working-volume.npy'),'--source-s3',str(a.review_volume)],check=True)
    validation=json.loads((w/'candidate-validation.json').read_text())
    for group,counts in validation['methods']['hybrid']['landmarkChecks'].items():
        if counts['matched']!=counts['total']:raise ValueError(f'Candidate has a remaining regression in {group}; review before packaging.')
    labels=np.load(w/'candidate-hybrid.npy');assert labels.dtype==np.uint8 and tuple(labels.shape)==tuple(meta['dimensions'][::-1]) and int(labels.max())==6
    raw=labels.tobytes();packed=gzip.compress(raw,compresslevel=9,mtime=0)
    meta.update(revision='continuity-gated-v5',title='Source-guided regional anatomy',generator='scripts/anatomy-v5-prepare.py',compressedBytes=len(packed),decodedBytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),compressedSha256=hashlib.sha256(packed).hexdigest(),generatedDate='2026-11-04')
    meta['method']='Source-guided LV and tricuspid geometry, connected measured arterial-wall cores, an independently reviewed pulmonary hinge and RV outflow corridor, followed by constrained tissue-geodesic propagation. Edge watershed and unconstrained geodesic alternatives were compared and rejected where they retained incorrect wall identities. Image intensities and rendering geometry are unchanged.'
    meta['methodParameters']={'baselineRevision':'source-contours-v4','workingGaussianSigma':.35,'gridDimensionsXYZ':meta['dimensions'],'seedBoundaryBandWorkingVoxels':5,'geodesicConnectivity':6,'edgeDifferenceScale':600,'lowDensityGapPenalty':4,'maximumGeodesicCost':85,**json.loads((w/'method-experiment.json').read_text())['hybrid']}
    meta['validation']='Twelve independent pre-candidate chamber/arterial control points, five separately recorded source-reviewed aortic/RVOT error points, and twenty existing v4 boundary regression points pass. Multiplanar source/overlay comparisons were reviewed. These are targeted diagnostic checks, not global segmentation accuracy, expert ground truth, a Dice score or clinical validation.'
    meta['limitations']=['Approximate regional annotations; no expert reference segmentation or trained segmentation model.','The compact interventricular septum is displayed with the LV myocardial body as a regional convention.','Pulmonary hinge and LV/atrial/root transitions are visually estimated. Shared fibrous tissue, valve attachment zones and small vessels remain uncertain.','Arterial-wall intensity is used only with spatial and continuity constraints; it does not independently establish tissue identity.','Valves, coronary vessels, individual pulmonary veins, caval veins and appendages are not separately segmented.','No fiber tractography, deformation, slice realignment or synthetic anatomical reconstruction is performed.','These labels are not for quantitative chamber volume, wall thickness, procedural or diagnostic measurements.']
    descriptions={1:'Continuous LV myocardial body, including compact septal myocardium under the stated display convention. Source-guided contours are retained; a local arterial-shell correction prevents aortic root wall from being mistaken for compact LV muscle.',2:'RV free wall, nonseptal trabeculated structures and muscular outflow. The ventricular side of the pulmonary hinge is explicitly connected to the RV, preventing a tricuspid-divider rule from recoloring the RV outflow as atrium or artery.',3:'Collapsed LA territory refined along connected measured tissue. Mitral, appendage and individual pulmonary-vein transitions remain provisional.',4:'RA wall and pectinate territory extending to the reviewed curved tricuspid junction. The muscular RV outflow is excluded from this atrial division.',5:'Connected aortic arterial wall and proximal root, using its measured intensity, source location and continuity. Color extension into adjacent LV muscle and the atrial/mitral junction is constrained; exact annular boundaries remain approximate.',6:'Pulmonary arterial wall and root proximal to a source-reviewed, oblique pulmonary hinge. The muscular RV outflow below that transition retains ventricular identity; distal branches are not separately identified.'}
    dims=np.array(meta['dimensions']);source=np.array(meta['sourceDimensionsXYZ'])
    for entry in meta['labels']:
        k=entry['id']
        if not k:continue
        coords=np.argwhere(labels==k);lo=coords.min(0)[::-1];hi=coords.max(0)[::-1]
        entry['description']=descriptions[k];entry['method']='Source-guided anatomy and arterial-wall continuity with constrained tissue-geodesic refinement.';entry['voxelCount']=int(len(coords));entry['boundsNormalizedXYZ']=[(lo/(dims-1)).tolist(),(hi/(dims-1)).tolist()]
        anchor=np.array(entry['referenceAnchorSourceXYZ']);p0=np.rint(anchor/(source-1)*(dims-1)).astype(int)
        if labels[p0[2],p0[1],p0[0]]!=k:
            nearest=coords[np.argmin(np.sum((coords[:,::-1]-p0)**2,axis=1))][::-1];entry['referenceAnchorSourceXYZ']=(nearest/(dims-1)*(source-1)).round(4).tolist()
    a.output.mkdir(parents=True,exist_ok=True);(a.output/'labels.raw.gz').write_bytes(packed);(a.output/'manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
    result={'revision':meta['revision'],'dimensions':meta['dimensions'],'compressedBytes':len(packed),'decodedBytes':len(raw),'sha256':meta['sha256'],'sourceScanSha256':hashlib.sha256(a.volume.read_bytes()).hexdigest(),'baselineSha256':hashlib.sha256(original).hexdigest(),'validation':validation['methods']['hybrid']['landmarkChecks']}
    (w/'packaging-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)

if __name__=='__main__':main()
