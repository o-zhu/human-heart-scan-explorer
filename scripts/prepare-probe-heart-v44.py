#!/usr/bin/env python3
"""Prepare bounded whole-heart meshes for the TTE Chest Orientation viewport.

This is an independent, lossy display derivative. All scalar inputs and existing
meshes remain unchanged. LADAF reuses its existing 497,714-triangle HFM exactly;
S donors use their own complete, verified, cleaned high-grid scalar data.

Build:  python3 scripts/prepare-probe-heart-v44.py
Verify: python3 scripts/prepare-probe-heart-v44.py --verify
Build dependencies: numpy, scipy, vtk. Verify uses only the Python standard library.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import importlib.util
import json
import struct
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / 'public/assets/probe-heart-v44'
DOCS = ROOT / 'docs/probe-heart-v44'
THRESHOLD = .28
SIGMA_VOXELS = .55
TARGET_TRIANGLES = 300000
MAX_COMPRESSED_BYTES = 5 * 1024 * 1024
COORDINATES = 'Acquisition XYZ -> centered world [X,Z,-Y] millimetres; HFM positions normalized by the longest high-grid sample-center extent. No anatomy registration or per-view transform.'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda: f.read(8 * 1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.partial')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def log(**values):
    print(json.dumps(values), flush=True)


def inspect_hfm(path):
    encoded = path.read_bytes()
    raw = gzip.decompress(encoded)
    assert len(raw) >= 32, 'short HFM'
    magic, version, nv, ni, po, no, io, reserved = struct.unpack_from('<8I', raw)
    assert magic == 0x314d4648 and version == 1 and reserved == 0
    assert nv > 0 and ni > 0 and ni % 3 == 0
    assert po == 32 and no == (po + nv * 6 + 3) & ~3
    assert io == (no + nv * 6 + 3) & ~3 and len(raw) == io + ni * 4
    assert max(struct.iter_unpack('<I', raw[io:]))[0] < nv
    return dict(url='./' + str(path.relative_to(ROOT / 'public')), vertices=nv,
                vertexCount=nv, triangles=ni // 3, indexCount=ni,
                compressedBytes=len(encoded), decodedBytes=len(raw),
                sha256=sha(encoded), decodedSha256=sha(raw),
                positionOffset=po, normalOffset=no, indexOffset=io)


def geometry(level):
    spacing = level['spacingUm']
    spacing = spacing if isinstance(spacing, list) else [spacing] * 3
    size_mm = [(n - 1) * s / 1000 for n, s in zip(level['dimensions'], spacing)]
    reference_mm = max(size_mm)
    extent = [size_mm[i] / reference_mm for i in (0, 2, 1)]
    return spacing, size_mm, reference_mm, extent


def credits(manifest):
    return {k: manifest[k] for k in ['datasetUrl', 'doiUrl', 'attribution', 'license', 'licenseUrl']}


def existing_ladaf():
    path = ROOT / 'public/assets/fine-surface-v19/manifest.json'
    source = json.loads(path.read_text())
    volume_path = ROOT / 'public/assets/manifest.json'
    level = json.loads(volume_path.read_text())['levels']['high']
    _, _, reference_mm, extent = geometry(level)
    lod = next(item for item in source['lods'] if item['id'] == 'balanced')
    mesh_path = ROOT / 'public' / lod['url'].removeprefix('./')
    actual = inspect_hfm(mesh_path)
    for k in ['vertices', 'triangles', 'compressedBytes', 'decodedBytes', 'sha256', 'decodedSha256']:
        assert actual[k] == lod[k], ('LADAF existing source mismatch', k)
    assert all(abs(a - b) < 1e-12 for a, b in zip(extent, source['extent']))
    return dict(donorId='ladaf-2021-17', referenceMm=reference_mm,
                sourceDimensionsXYZ=level['dimensions'],
                sourceSpacingUm=source['sourceSpacingUm'],
                residentSpacingUm=level['spacingUm'], threshold=source['threshold'],
                extent=extent, bounds=source['bounds'], lod=actual, **credits(source),
                provenance=dict(sourceManifest=str(path.relative_to(ROOT)),
                    sourceManifestSha256=file_sha(path),
                    residentManifest=str(volume_path.relative_to(ROOT)),
                    residentManifestSha256=file_sha(volume_path),
                    method='Reuse existing balanced whole-heart HFM byte-for-byte. No new extraction, smoothing, or simplification.',
                    reusedExistingPayload=True, sourceDataChanged=False,
                    originalProcessing=source['processing'],
                    originalValidation=source['validationSummary'],
                    coordinateConvention=COORDINATES,
                    qualification='Whole-heart display geometry from 79.4 micrometre source; lossy existing compact surface, not the 437 MB finalized Ultra model or a 19.85 micrometre full-heart mesh.'))


def load_high(manifest):
    import numpy as np
    high = manifest['levels']['high']
    nx, ny, nz = high['dimensions']
    data = np.empty((nz, ny, nx), dtype=np.uint8)
    next_z = 0
    inputs = []
    for part in high['parts']:
        path = ROOT / 'public' / part['url'].removeprefix('./')
        encoded = path.read_bytes()
        assert sha(encoded) == part['sha256'], str(path)
        assert len(encoded) == part['bytes']
        raw = gzip.decompress(encoded)
        assert len(raw) == part['uncompressedBytes']
        z0, z1 = part['zRange']
        assert z0 == next_z and z1 > z0
        a = np.frombuffer(raw, np.uint8).reshape((z1 - z0, ny, nx))
        predictor = part.get('predictor')
        if predictor in ['delta-z', 'delta-x']:
            a = np.cumsum(a, axis=0 if predictor == 'delta-z' else 2, dtype=np.uint8)
        else:
            assert predictor in [None, 'none']
        assert sha(a.tobytes()) == part['rawSha256'], 'predictor round trip'
        data[z0:z1] = a
        next_z = z1
        inputs.append(dict(path=str(path.relative_to(ROOT)), bytes=len(encoded),
                           sha256=part['sha256'], rawSha256=part['rawSha256'], zRange=[z0,z1], predictor=predictor))
    assert next_z == nz and data.nbytes == high['uncompressedBytes']
    return data, inputs


def sampled_distance(source_poly, target_poly, count=5000, seed=4401):
    import numpy as np
    import vtk
    from vtk.util.numpy_support import vtk_to_numpy
    points = vtk_to_numpy(source_poly.GetPoints().GetData())
    faces = vtk_to_numpy(source_poly.GetPolys().GetConnectivityArray()).reshape(-1,3)
    cross = np.cross(points[faces[:,1]] - points[faces[:,0]], points[faces[:,2]] - points[faces[:,0]])
    weights = np.linalg.norm(cross, axis=1).astype(np.float64)
    total = weights.sum()
    assert total > 0
    rng = np.random.default_rng(seed)
    indices = rng.choice(len(faces), count, p=weights/total)
    r = rng.random((count,2)); r[:,0] = np.sqrt(r[:,0])
    triangles = points[faces[indices]]
    samples = triangles[:,0]*(1-r[:,0,None]) + triangles[:,1]*(r[:,0]*(1-r[:,1]))[:,None] + triangles[:,2]*(r[:,0]*r[:,1])[:,None]
    locator = vtk.vtkStaticCellLocator(); locator.SetDataSet(target_poly); locator.BuildLocator()
    nearest = [0.,0.,0.]; cell = vtk.reference(0); sub = vtk.reference(0); dist2 = vtk.reference(0.)
    distances=[]
    for q in samples:
        locator.FindClosestPoint(q, nearest, cell, sub, dist2)
        distances.append(float(dist2)**.5)
    return dict(samples=count, seed=seed, medianMm=float(np.median(distances)),
                p95Mm=float(np.percentile(distances,95)), p99Mm=float(np.percentile(distances,99)),
                maximumSampledMm=max(distances), rmsMm=float(np.sqrt(np.mean(np.square(distances)))))


def make_donor(donor_id, pipeline):
    import numpy as np
    import scipy
    import vtk
    from scipy.ndimage import gaussian_filter
    from vtk.util.numpy_support import numpy_to_vtk
    started=time.monotonic()
    path=ROOT / 'public/assets/donors' / donor_id / 'manifest.json'
    manifest=json.loads(path.read_text()); high=manifest['levels']['high']
    spacing, size_mm, reference_mm, extent=geometry(high)
    assert spacing[0] == spacing[1] == spacing[2]
    source, inputs=load_high(manifest)
    source_sha=sha(source.tobytes())
    log(stage='source-verified',donor=donor_id,dimensions=high['dimensions'],sourceBytes=source.nbytes)
    # Separate float field only; source remains read-only and is checked after.
    source.flags.writeable=False
    field=gaussian_filter(source.astype(np.float32),sigma=SIGMA_VOXELS,truncate=3,mode='nearest')
    origin=(-np.array(size_mm)/2).tolist()
    image=vtk.vtkImageData(); image.SetDimensions(*high['dimensions']);image.SetSpacing(*[s/1000 for s in spacing]);image.SetOrigin(*origin)
    image.GetPointData().SetScalars(numpy_to_vtk(field.ravel(),deep=False))
    contour=vtk.vtkFlyingEdges3D();contour.SetInputData(image);contour.SetValue(0,255*THRESHOLD)
    contour.ComputeNormalsOff();contour.ComputeGradientsOff();contour.ComputeScalarsOff();contour.InterpolateAttributesOff();contour.Update()
    reference=vtk.vtkPolyData();reference.DeepCopy(contour.GetOutput())
    source_triangles=reference.GetNumberOfCells()
    assert source_triangles>100000, 'Unexpectedly empty/coarse source'
    del contour,image,field
    log(stage='full-grid-isosurface',donor=donor_id,triangles=source_triangles)
    compact=pipeline.decimate(reference,TARGET_TRIANGLES)
    assert 0<compact.GetNumberOfCells()<=TARGET_TRIANGLES+4
    validation=dict(method='Deterministic area-weighted nearest-triangle distances against the full high-grid isosurface after the stated scalar filter; not Hausdorff or clinical accuracy bounds.',
                    sourceToCompact=sampled_distance(reference,compact),
                    compactToSource=sampled_distance(compact,reference,seed=4402))
    meta=dict(longestMm=reference_mm,extent=extent)
    encoded=pipeline.write_hfm(compact,donor_id,meta,ASSET)
    assert encoded['compressedBytes']<=MAX_COMPRESSED_BYTES
    lod=inspect_hfm(ASSET/f'{donor_id}.hfm.gz')
    assert lod['triangles']<=TARGET_TRIANGLES
    assert sha(source.tobytes())==source_sha
    for item in inputs:assert file_sha(ROOT/item['path'])==item['sha256']
    item=dict(donorId=donor_id,referenceMm=reference_mm,
              sourceDimensionsXYZ=high['dimensions'],sourceSpacingUm=high['spacingUm'],residentSpacingUm=high['spacingUm'],
              threshold=THRESHOLD,extent=extent,
              bounds=dict(min=[-v/2 for v in extent],max=[v/2 for v in extent]),lod=lod,**credits(manifest),
              provenance=dict(sourceManifest=str(path.relative_to(ROOT)),sourceManifestSha256=file_sha(path),
                sourceParts=inputs,sourceDecodedSha256=source_sha,
                source='The complete existing cleaned, windowed uint8 high display volume, at its actual recorded sample centers; not original quantitative native acquisition.',
                scalarFilter=dict(method='Separate Gaussian float32 display field',sigmaVoxels=SIGMA_VOXELS,sigmaMm=SIGMA_VOXELS*spacing[0]/1000,truncate=3,mode='nearest'),
                isosurface=dict(method='VTK FlyingEdges3D',threshold=THRESHOLD,scalarThreshold=THRESHOLD*255,referenceTriangles=source_triangles),
                simplification=dict(method='VTK QuadricDecimation',targetTriangles=TARGET_TRIANGLES,volumePreservation=True,boundaryWeightFactor=100,topologyGuaranteed=False),
                encoding={k:v for k,v in encoded.items() if k.startswith('quantization') or k in ['trianglesBeforeEncoding','removedZeroAreaTriangles','normalFallbackVertices','normalFallbackFraction']},
                versions=dict(python=sys.version.split()[0],numpy=np.__version__,scipy=scipy.__version__,vtk=vtk.vtkVersion.GetVTKVersion()),
                coordinateConvention=COORDINATES,sourceDataChanged=False,expertValidated=False,
                reusedExistingPayload=False,validation=validation,
                qualification='Whole-heart model prepared from this donor high display grid. Lossy orientation geometry; not a fine-source or native-resolution model and not clinically registered anatomy.'))
    log(stage='donor-complete',donor=donor_id,triangles=lod['triangles'],compressedBytes=lod['compressedBytes'],seconds=time.monotonic()-started)
    return item


def verify(manifest):
    assert manifest['schemaVersion']==1 and len(manifest['donors'])==3
    for item in manifest['donors']:
        path=ROOT/'public'/item['lod']['url'].removeprefix('./')
        actual=inspect_hfm(path)
        for key,value in actual.items():assert item['lod'][key]==value,(item['donorId'],key)
        assert actual['decodedBytes']<48*1024*1024 and actual['compressedBytes']<8*1024*1024 and actual['indexCount']<2000000
        prov=item['provenance'];source=json.loads((ROOT/prov['sourceManifest']).read_text())
        assert file_sha(ROOT/prov['sourceManifest'])==prov['sourceManifestSha256']
        if item['donorId']=='ladaf-2021-17':level=json.loads((ROOT/prov['residentManifest']).read_text())['levels']['high']
        else:level=source['levels']['high']
        _,size_mm,reference_mm,extent=geometry(level)
        assert abs(reference_mm-item['referenceMm'])<1e-10
        assert all(abs(a-b)<1e-12 for a,b in zip(extent,item['extent']))
        for axis in range(3):
            assert abs(item['bounds']['min'][axis]+extent[axis]/2)<1e-12
            assert abs(item['bounds']['max'][axis]-extent[axis]/2)<1e-12
        for part in prov.get('sourceParts',[]):assert file_sha(ROOT/part['path'])==part['sha256']
        log(verified=True,donor=item['donorId'],triangles=actual['triangles'],referenceMm=reference_mm,compressedBytes=actual['compressedBytes'])


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',action='store_true');args=p.parse_args()
    manifest_path=ASSET/'manifest.json'
    if args.verify:return verify(json.loads(manifest_path.read_text()))
    import vtk
    vtk.vtkSMPTools.Initialize(3)
    pipeline_path=ROOT/'scripts/fine-surface-v19/prepare.py'
    spec=importlib.util.spec_from_file_location('heart_hfm_encoding',pipeline_path)
    pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
    donors=[existing_ladaf()]
    for donor_id in ['s-20-29','s-20-28']:donors.append(make_donor(donor_id,pipeline))
    manifest=dict(schemaVersion=1,format='HFM1',coordinateConvention=COORDINATES,
        role='Bounded whole-heart geometry for TTE Chest Orientation only',
        donors=donors,limitations=['Reference body and skin are illustrative, not donor-registered.','These meshes are separate compact display derivatives, not the finalized Ultra surface.','Original volume arrays and main reconstruction geometry are unchanged.'])
    verify(manifest);save_json(manifest_path,manifest)
    save_json(DOCS/'verification.json',dict(verified=True,manifestSha256=file_sha(manifest_path),
        generatorSha256=file_sha(Path(__file__)),hfmPipelineSha256=file_sha(pipeline_path),
        tests=['All compressed and decoded HFM identities and bounded layouts verified.','All retained source-part checksums verified before and after processing.','Dimensions, extent, center and reference millimetres agree with runtime volumeGeometry mapping.','Triangle indices stay in vertex bounds; all source-coordinate intervals retained.'],
        notTested=['Physical-device/browser performance','Expert anatomical or clinical validity','Full native-acquisition processing rerun']))


if __name__=='__main__':main()
