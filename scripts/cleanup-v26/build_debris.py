#!/usr/bin/env python3
"""Add local complete-component selections to the frozen global v25 cleanup.

All selections are visibility flags on the original complete, uncut HFM graph.
No retained vertex, normal, or triangle index is changed.
"""
from pathlib import Path
import csv,gzip,hashlib,json,shutil,time
import numpy as np
from mesh_components import ROOT,EXPECTED,analyze

PUBLIC=ROOT/'public/assets/cleanup-v26';DOCS=ROOT/'docs/cleanup-v26';DATA=Path('/workspace/data/cleanup-v26')
START=time.monotonic()
def sha(x):return hashlib.sha256(x).hexdigest()
def save(name,data):
    p=PUBLIC/name
    encoded=gzip.compress(memoryview(np.ascontiguousarray(data)),compresslevel=9,mtime=0);p.write_bytes(encoded)
    assert sha(gzip.decompress(encoded))==sha(memoryview(data))
    return dict(url='./assets/cleanup-v26/'+name,compressedBytes=len(encoded),decodedBytes=data.nbytes,sha256=sha(encoded),decodedSha256=sha(memoryview(data)))

def main():
    PUBLIC.mkdir(parents=True,exist_ok=True);DOCS.mkdir(parents=True,exist_ok=True);DATA.mkdir(parents=True,exist_ok=True)
    a=analyze();mesh=a['mesh'];stats=a['stats'];labels=a['labels'];nv=mesh['vertexCount'];nt=mesh['indexCount']//3
    baseline=json.loads((ROOT/'public/assets/cleanup-v25/debris-manifest.json').read_text())['profiles'][0]
    old=baseline['vertexFlags'];encoded=(ROOT/'public'/old['url'].removeprefix('./')).read_bytes();assert sha(encoded)==old['sha256']
    raw=gzip.decompress(encoded);assert sha(raw)==old['decodedSha256'];old_flags=np.frombuffer(raw,np.uint8)
    valid=labels!=np.iinfo(np.uint32).max
    assert np.array_equal(old_flags[valid],a['removed'][labels[valid]].astype(np.uint8)*255)
    original_hashes={k:sha(memoryview(mesh[k])) for k in ('positions','normals','indices')}
    cavity_meta=json.loads((DATA/'arterial-review-cavity.json').read_text())
    cavity_raw=gzip.decompress((DATA/'arterial-review-cavity.bits.gz').read_bytes());assert sha(cavity_raw)==cavity_meta['decodedSha256']
    cavity=np.frombuffer(cavity_raw,np.uint8).reshape(cavity_meta['storageDimensionsXYZ'][::-1]);origin=np.array(cavity_meta['lowerFullFineXYZ']);dimensions=np.array(cavity_meta['dimensionsXYZ'])
    def inside(points):
        q=np.floor(points-origin+.5).astype(np.int64);ok=np.all((q>=0)&(q<dimensions),axis=1);answer=np.zeros(len(q),bool)
        x,y,z=q[ok].T;answer[ok]=((cavity[z,y,x//8]>>(x&7))&1)!=0
        return answer
    def boxed(lo,hi):return np.all(a['lower']>=lo,axis=1)&np.all(a['upper']<=hi,axis=1)
    protected=(stats[:,18]>0);protected[a['main_id']]=True
    available=~protected&~a['removed']
    arterial=available&(a['diameter']<=4.)&(stats[:,1]<=6000)&boxed(origin,origin+dimensions-1)
    candidate_components_before_geometry=int(arterial.sum())
    def fine_positions(indices):
        vertices=mesh['positions'][indices].astype(np.float64)/65535
        world=np.array(mesh['bounds']['min'])+vertices*(np.array(mesh['bounds']['max'])-np.array(mesh['bounds']['min']))
        return world[..., [0,2,1]]*[1,-1,1]*a['meta']['longestMm']/.0794+(np.array(a['meta']['fullDimensionsXYZ'])-1)/2
    rejected_by_vertex=set();arterial_vertices_checked=0
    for start in range(0,nv,250000):
        part=labels[start:start+250000];valid_part=part<len(stats);safe_part=part.copy();safe_part[~valid_part]=0
        selected=np.flatnonzero(valid_part&arterial[safe_part])
        if not len(selected):continue
        points=fine_positions(start+selected)
        membership=inside(points);arterial_vertices_checked+=len(points)
        rejected_by_vertex.update(int(c) for c in part[selected[~membership]])
    if rejected_by_vertex:arterial[list(rejected_by_vertex)]=False
    # Axis-aligned box corners are not part of a flake's geometry and can lie
    # outside an irregular lumen despite every surface point being inside.
    # Check actual triangle samples after all original vertices instead.
    rejected_by_face=set();arterial_faces_checked=0;arterial_face_samples_checked=0
    for start in range(0,nt,250000):
        faces=mesh['indices'].reshape(-1,3)[start:start+250000]
        ids=labels[faces[:,0]];selected=np.flatnonzero(arterial[ids])
        if not len(selected):continue
        points=fine_positions(faces[selected]);membership=np.ones(len(points),bool)
        for samples in [(points[:,0]+points[:,1])*.5,(points[:,1]+points[:,2])*.5,(points[:,2]+points[:,0])*.5,points.mean(axis=1)]:
            membership&=inside(samples);arterial_face_samples_checked+=len(samples)
        arterial_faces_checked+=len(points);rejected_by_face.update(int(c) for c in ids[selected[~membership]])
    if rejected_by_face:arterial[list(rejected_by_face)]=False
    # Long rods and sheets remain protected around chordae. A separate tiny
    # flake allowance applies only when the two large PCA spreads are similar,
    # so a small one-dimensional chord-like component is not admitted by it.
    large_ratio=np.sqrt((a['eigen'][:,2]+.0397**2)/(a['eigen'][:,1]+.0397**2))
    compact=(a['diameter']<=1.5)&(a['spread']<4.5)&(stats[:,1]<=2048)
    tiny_flake=(a['diameter']<=.65)&(a['spread']<10)&(large_ratio<2.5)&(stats[:,1]<=256)
    perivalve=available&boxed(np.array([550,850,850]),np.array([1280,1250,1420]))&(compact|tiny_flake)
    rv=available&boxed(np.array([450,780,1100]),np.array([1020,1200,1810]))&(compact|tiny_flake)
    additional=arterial|perivalve|rv
    removed=a['removed']|additional;assert not removed[a['main_id']]
    flags=np.zeros(nv,np.uint8);flags[valid]=removed[labels[valid]].astype(np.uint8)*255
    assert np.all(flags[old_flags!=0]==255)
    face_keep=np.empty(nt,np.uint8)
    for start in range(0,nt,250000):
        f=mesh['indices'].reshape(-1,3)[start:start+250000];values=flags[f]
        assert np.all(values[:,0]==values[:,1]) and np.all(values[:,0]==values[:,2])
        face_keep[start:start+len(f)]=values[:,0]==0
    def totals(selection):
        return dict(removedComponents=int(selection.sum()),removedVertices=int(stats[selection,0].sum()),removedTriangles=int(stats[selection,1].sum()),removedSurfaceAreaMm2=float(stats[selection,17].sum()),removedTriangleFraction=float(stats[selection,1].sum()/nt))
    assert int(np.count_nonzero(face_keep==0))==totals(removed)['removedTriangles']
    assert all(sha(memoryview(mesh[k]))==v for k,v in original_hashes.items())
    vertex_asset=save('debris-gentle-vertices.raw.gz',flags);face_asset=save('debris-gentle-faces.keep.gz',np.packbits(face_keep,bitorder='little'))
    policy=dict(id='reviewed-local-components-v26',baselinePolicy=baseline['policy'],baselineManifestSha256=sha((ROOT/'public/assets/cleanup-v25/debris-manifest.json').read_bytes()),
      arterial=dict(scope='Complete detached components in source-derived reviewed aortic/pulmonary lumens. Verify every original vertex and every triangle centroid and edge midpoint against the reviewed cavity; bbox corners are not required to represent actual fragment geometry.',maximumBoundingBoxDiagonalMm=4.,maximumTriangles=6000,shapeGuardRelaxedOnlyWithinReviewedArterialLumen=True,candidateComponentsBeforeGeometryCheck=candidate_components_before_geometry,originalVerticesChecked=arterial_vertices_checked,trianglesChecked=arterial_faces_checked,triangleInteriorAndEdgeSamplesChecked=arterial_face_samples_checked,componentsRejectedByVertexCheckCount=len(rejected_by_vertex),componentsRejectedByTriangleSamplesCount=len(rejected_by_face)),
      perivalvularAndRV=dict(scope='Complete detached small compact or two-dimensional flake components; retained long and strongly one-dimensional structures.',maximumCompactDiagonalMm=1.5,maximumCompactPcaSpreadExclusive=4.5,maximumCompactTriangles=2048,maximumFlakeDiagonalMm=.65,maximumFlakePcaSpreadExclusive=10,maximumFlakeLargeAxisRatioExclusive=2.5,maximumFlakeTriangles=256,perivalvularBoundsFullFineXYZ=[[550,850,850],[1280,1250,1420]],rvBoundsFullFineXYZ=[[450,780,1100],[1020,1200,1810]]),
      connectivity='Shared vertices in the complete uncut original HFM mesh',protectLargestComponent=True,protectQuantizedVolumeBoundary=True,positionsChanged=False,normalsChanged=False,indicesChanged=False,classification='Reversible display cleanup candidates, not validated biological material labels')
    profile=dict(lodId='gentle',sourceDecodedSha256=EXPECTED,sourceSha256=a['lod']['sha256'],sourceVertexCount=nv,sourceTriangleCount=nt,vertexFlags=vertex_asset,vertexFlagEncoding={'0':'retain','255':'exclude','indexing':'original HFM vertex order'},faceKeepMask={**face_asset,'bitOrder':'little','bit1':'retain','indexing':'original HFM triangle order'},policy=policy,**totals(removed),retainedTriangles=int(nt-stats[removed,1].sum()),additionalBeyondV25=totals(additional))
    (PUBLIC/'debris-manifest.json').write_text(json.dumps(dict(version=2,donorId='ladaf-2021-17',profiles=[profile],sourceSpacingUm=79.4),indent=2)+'\n')
    ledger=DATA/'newly-excluded-mesh-components.csv.gz'
    with gzip.open(ledger,'wt',newline='') as output:
        writer=csv.writer(output);writer.writerow(['component','vertices','triangles','bbox_diagonal_mm','pca_spread','larger_axis_ratio','arterial','perivalvular','rv','min_fine_x','min_fine_y','min_fine_z','max_fine_x','max_fine_y','max_fine_z'])
        for c in np.flatnonzero(additional):writer.writerow([int(c),int(stats[c,0]),int(stats[c,1]),float(a['diameter'][c]),float(a['spread'][c]),float(large_ratio[c]),int(arterial[c]),int(perivalve[c]),int(rv[c]),*a['lower'][c].tolist(),*a['upper'][c].tolist()])
    retained_ledger=DOCS/ledger.name;shutil.copyfile(ledger,retained_ledger)
    report=dict(sourceDecodedSha256=EXPECTED,componentCount=len(stats),baselineManifestSha256=policy['baselineManifestSha256'],profile=profile,regions=dict(arterial=totals(arterial),perivalvular=totals(perivalve),rv=totals(rv)),largestComponent=dict(id=a['main_id'],triangles=int(stats[a['main_id'],1]),excluded=False),arraySha256=original_hashes,validation=dict(sourceArraysByteIdentical=True,everyTriangleHasUniformFlag=True,allPreviousExcludedVerticesRetained=True,largestComponentRetained=True,quantizedBoundaryComponentsRetained=True),componentDeltaLedger=dict(path=str(retained_ledger.relative_to(ROOT)),bytes=retained_ledger.stat().st_size,sha256=sha(retained_ledger.read_bytes())),arterialReviewCavitySha256=cavity_meta['decodedSha256'],arterialRejectedComponentIds={'vertexCheck':sorted(rejected_by_vertex),'triangleSampleCheck':sorted(rejected_by_face)},elapsedSeconds=time.monotonic()-START)
    (DOCS/'debris-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(additional=totals(additional),total=totals(removed),regions=report['regions'],seconds=report['elapsedSeconds'])),flush=True)

if __name__=='__main__':main()
