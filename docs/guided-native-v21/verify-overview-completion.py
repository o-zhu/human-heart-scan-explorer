#!/usr/bin/env python3
"""Read-only completion audit of the actual whole-heart overview checkpoints."""
import os,sys,resource
for key in ('OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS'):
 os.environ[key]='1'
os.environ['PYTHONDONTWRITEBYTECODE']='1';sys.dont_write_bytecode=True
resource.setrlimit(resource.RLIMIT_AS,(1024**3,1024**3))
from pathlib import Path
import collections,datetime,gc,gzip,hashlib,json,math,struct,time,zipfile
import numpy as np
REPO=Path('{local-workspace}');SCRIPTS=REPO/'scripts/guided-native-v21'
sys.path.insert(0,str(SCRIPTS))
import build_overview as b
import write_release_report as rr
BASE=Path('{source-cache}/guided-native-v21/whole');OUT=BASE/'overview';RUN=BASE/'run'
START=time.monotonic()
def need(ok,message):
 if not ok:raise ValueError(message)
def load(path):
 raw=path.read_bytes();return rr.strict_json(raw,path.name),hashlib.sha256(raw).hexdigest()
def canonical_sha(x):return hashlib.sha256(b.canonical(x)).hexdigest()
manifest,manifest_sha=load(OUT/'manifest.json');build,build_sha=load(OUT/'build.json');inputs,input_file_sha=load(OUT/'input-manifest.json')
run,run_sha=load(RUN/'run.json');audit,audit_sha=load(REPO/'docs/guided-native-v21/completed-bank-audit.json')
need(manifest['complete'] is True and manifest['completeInputCorePlan'] is True and manifest['pilot'] is False,'Overview incomplete/pilot')
need(run['fingerprint']==rr.WHOLE_RUN_FINGERPRINT==inputs['runFingerprint']==audit['processingFingerprint'],'Whole identity mismatch')
need(inputs['corePlanSha256']==rr.WHOLE_PLAN_SHA256==b.digest(Path(run['corePlan'])),'Core plan mismatch')
need(inputs['runManifestSha256']==run_sha==audit['runManifestSha256'],'Run changed')
need(inputs['sourceObjectLedgerSha256']==b.digest(RUN/'source-objects.jsonl')==audit['source']['logSha256'],'Source ledger changed')
need(inputs['sourceConfiguration']==run['config'] and inputs['completeCorePlan'] is True,'Source configuration/scope differs')
input_canonical=canonical_sha(inputs)
need(input_file_sha==manifest['inputManifestFileSha256']==build['inputManifestFileSha256'] and input_canonical==manifest['inputManifestCanonicalSha256']==build['inputManifestCanonicalSha256'],'Input manifest identity mismatch')
code=dict(codeSha256=b.digest(SCRIPTS/'build_overview.py'),edgeCodecSha256=b.digest(SCRIPTS/'edge_codec.py'),collapseFilterSha256=b.digest(SCRIPTS/'overview_collapse.c'))
reproduced=canonical_sha(dict(input=input_canonical,settings=build['settings'],**code))
need(reproduced==manifest['fingerprint']==build['fingerprint'],'Display fingerprint not reproduced')
need(manifest['nativeBankModified'] is False and manifest['displayLodIsLossy'] is True,'Display/native scope missing')
rows=inputs['records'];coords={tuple(r['coordinatesXYZ']) for r in rows}
plan={tuple(map(int,row)) for row in np.load(run['corePlan'],allow_pickle=False)}
need(len(rows)==len(coords)==len(plan)==37612 and coords==plan,'Source input plan mismatch')
need(sum(r['triangles'] for r in rows)==manifest['inputOverviewTriangles']==audit['totals']['overviewCheckpointTriangles'],'Source input triangles mismatch')
for r in rows:
 c=tuple(r['coordinatesXYZ']);path=RUN/'records'/('_'.join(map(str,c))+'.json')
 need(b.digest(path)==r['recordSha256'],'Completed native record changed')
node_paths=sorted((OUT/'nodes').glob('*.json'));nodes={};checkpoint_bytes=0;method_counts=collections.Counter();rejected_seam_trials=0
header_verified=0
for path in node_paths:
 n,_=load(path);need(n['name']==path.stem and n['path']=='nodes/'+path.stem+'.npz','Node path identity mismatch')
 need(n['name'] not in nodes and n['fingerprint']==reproduced,'Duplicate/foreign node')
 checkpoint=OUT/n['path'];need(b.digest(checkpoint)==n['sha256'],'Node NPZ checksum mismatch')
 checkpoint_bytes+=checkpoint.stat().st_size
 s=n['simplification'];need(s.get('frozenBoundaryExact') is True,'A final node lacks exact seam assertion')
 rejected_seam_trials+=sum(t.get('frozenBoundaryExact') is False for t in s.get('trials',[]))
 method_counts[s['method']]+=1
 expected={'points.npy':((n['vertices'],3),np.dtype('float32')),'faces.npy':((n['triangles'],3),np.dtype('uint32')),
           'referenceSamples.npy':((n['referenceSamples'],3),np.dtype('float64')),'referenceWeights.npy':((n['referenceSamples'],),np.dtype('float64'))}
 with zipfile.ZipFile(checkpoint) as z:
  need(set(z.namelist())==set(expected),'Node NPZ members differ')
  for key,(shape,dtype) in expected.items():
   with z.open(key) as stream:
    version=np.lib.format.read_magic(stream)
    got=np.lib.format.read_array_header_1_0(stream) if version==(1,0) else np.lib.format.read_array_header_2_0(stream)
   need(got[0]==shape and got[1] is False and got[2]==dtype,'Node array shape/dtype mismatch')
 header_verified+=1;nodes[n['name']]=n
need(canonical_sha(sorted(nodes.values(),key=lambda n:n['name']))==manifest['hierarchy']['nodeRecordsCanonicalSha256'],'Canonical node-record hash mismatch')
# Independently reproduce the exact partition and verify topology of the checkpoint tree.
visited=[];leaves=[]
def walk(source,origin,span):
 name=f's{span:03d}_'+'_'.join(map(str,origin));n=nodes[name];visited.append(name)
 raw=sum(r['triangles'] for r in source)
 leaf=(span<=build['settings']['groupBlocks'] and raw<=build['settings']['leafFaceCap']) or span==1
 need(n['leaf'] is leaf and n['originBlockXYZ']==list(origin) and n['spanBlocks']==span,'Node partition geometry differs')
 need(n['inputOverviewBlocks']==len(source) and n['originalOverviewTriangles']==raw,'Node source coverage differs')
 budget=max(32,min(n['inputTriangles'],int(math.ceil(max(build['settings']['triangles'],build['settings']['detailTriangles'])*build['settings']['intermediateFactor']*raw/manifest['inputOverviewTriangles']))))
 need(n['targetTriangles']==budget,'Node numerical target differs')
 if leaf:
  need(not n['children'] and raw<=build['settings']['leafFaceCap'],'Invalid leaf')
  leaves.append(n)
 else:
  half=span//2;groups={}
  for r in source:groups.setdefault(tuple(x//half*half for x in r['coordinatesXYZ']),[]).append(r)
  names=[f's{half:03d}_'+'_'.join(map(str,c)) for c in sorted(groups)]
  need(n['children']==names,'Child ordering/partition differs')
  children=[nodes[x] for x in names]
  need(n['pendingChildTriangles']==sum(x['triangles'] for x in children),'Pending child face count differs')
  need(n['pendingChildTriangles']<=n['mergeFaceCapAtBuild'],'Node violated its recorded allocation cap')
  need(n['referenceSamples']==sum(x['referenceSamples'] for x in children),'Parent lost reference samples')
  for c in sorted(groups):walk(groups[c],c,half)
walk(rows,(0,0,0),1<<max(max(c) for c in coords).bit_length())
need(len(visited)==len(set(visited))==len(nodes)==manifest['hierarchy']['nodes']==3838,'Tree lost/duplicated/unreferenced nodes')
need(len(leaves)==manifest['hierarchy']['leafGroups']==3284,'Leaf count mismatch')
root=nodes[Path(manifest['rootCheckpoint']).stem]
need(root['triangles']==manifest['hierarchy']['finalIntermediateTriangles']==4999999,'Root triangle count mismatch')
# Check every original leaf sample/weight survives byte-exactly to the root.
leaf_sample_hash=hashlib.sha256();leaf_weight_hash=hashlib.sha256();sample_total=0;empty_sample_leaves=0
for n in leaves:
 with np.load(OUT/n['path'],allow_pickle=False) as z:
  samples=z['referenceSamples'];weights=z['referenceWeights']
  need(np.isfinite(samples).all() and np.isfinite(weights).all() and (weights>=0).all(),'Invalid original reference samples/weights')
  need(float(weights.sum())==n['referenceAreaNativeVoxelSquared'],'Leaf area weights changed')
  leaf_sample_hash.update(samples.tobytes());leaf_weight_hash.update(weights.tobytes())
  sample_total+=len(samples);empty_sample_leaves+=int(len(samples)==0)
with np.load(OUT/root['path'],allow_pickle=False) as z:
 root_samples=z['referenceSamples'];root_weights=z['referenceWeights']
 need(hashlib.sha256(root_samples.tobytes()).digest()==leaf_sample_hash.digest() and hashlib.sha256(root_weights.tobytes()).digest()==leaf_weight_hash.digest(),'Root changed/dropped original sample bytes or weights')
 need(len(root_samples)==sample_total==816640,'Reference sample count differs')
 del root_samples,root_weights
# Fresh exact shared-plane checks between all adjacent root children.
signatures={};root_plane_vertices=0
for child_name in root['children']:
 n=nodes[child_name]
 with np.load(OUT/n['path'],allow_pickle=False) as z:points=z['points'];faces=z['faces']
 need(np.isfinite(points).all() and (faces.max(initial=0)<len(points) or not len(faces)),'Invalid root-child geometry')
 b.lattice_keys(points)
 lo=np.array(n['originBlockXYZ'])*128;hi=lo+n['spanBlocks']*128
 signatures[tuple(n['originBlockXYZ'])]=b.frozen_signature(points,faces,lo,hi)
 root_plane_vertices+=int(np.count_nonzero(np.any((points==0)|(points==8192),axis=1)))
 del points,faces
seam_checks=[]
for origin,signature in signatures.items():
 for axis in range(3):
  other=list(origin);other[axis]+=32;other=tuple(other)
  if other not in signatures:continue
  a=signature[2*axis+1];c=signatures[other][2*axis]
  need(np.array_equal(a[0],c[0]) and np.array_equal(a[1],c[1]),'Independent S32 seam differs')
  seam_checks.append(dict(leftOriginBlockXYZ=list(origin),rightOriginBlockXYZ=list(other),axisXYZ=axis,
                         sharedPlaneVertices=len(a[0]),oneFaceBoundaryEdges=len(a[1]),exact=True))
need(len(seam_checks)==12 and root_plane_vertices==0,'Root shared-plane or outer-boundary count unexpected')
del signatures;gc.collect()
h=manifest['hierarchy']
checks={'maximumNodeInputTriangles':max(n['inputTriangles'] for n in nodes.values()),'maximumPendingChildTriangles':max(n['pendingChildTriangles'] for n in nodes.values()),
 'vertexClusteringNodes':sum('clustering' in n['simplification']['method'] for n in nodes.values()),
 'constrainedQemNodes':sum('constrained-qem' in n['simplification']['method'] for n in nodes.values()),
 'parentClusteringFallbackNodes':sum(n['simplification'].get('parentCellFallbackUsed',False) for n in nodes.values()),
 'intermediateTargetMissNodes':sum(n['triangles']>n['targetTriangles'] for n in nodes.values()),
 'maximumClusterCellNativeVoxels':max(n['simplification'].get('maximumClusteringCellNativeVoxels',0) for n in nodes.values())}
need(all(h[k]==v for k,v in checks.items()),'Hierarchy aggregate differs from nodes')
asset_checks=[]
for lod in manifest['lods']:
 sidecar,_=load(OUT/(lod['id']+'.json'));need(sidecar==lod and lod['fingerprint']==reproduced,'LOD sidecar mismatch')
 need(lod['sampledDistances']['hausdorffBound'] is False and lod['sampledDistances']['anatomicalAccuracyClaim'] is False,'Incorrect error scope')
 need(lod['sampledDistances']['originalOverviewToStoredDisplay']['samples']==sample_total and lod['sampledDistances']['storedDisplayToOriginalOverview']['samples']==build['settings']['reverseSamples'],'LOD sample accounting mismatch')
 for direction in ('originalOverviewToStoredDisplay','storedDisplayToOriginalOverview'):
  metric=lod['sampledDistances'][direction]
  need(all(math.isfinite(metric[k]) and metric[k]>=0 for k in ('meanUm','rmsUm','medianUm','p95Um','p99Um','maximumSampledUm')),'Nonfinite distance metric')
  need(metric['medianUm']<=metric['p95Um']<=metric['p99Um']<=metric['maximumSampledUm'],'Invalid sample quantile ordering')
 for part in lod['parts']:
  path=OUT/part['path'];encoded=path.read_bytes();need(hashlib.sha256(encoded).hexdigest()==part['sha256'] and len(encoded)==part['compressedBytes']<=32*1024**2,'HFM compressed identity mismatch')
  decoded=gzip.decompress(encoded);need(hashlib.sha256(decoded).hexdigest()==part['decodedSha256'] and len(decoded)==part['decodedBytes'],'HFM decoded identity mismatch')
  magic,version,nv,ni,po,no,io,flags=struct.unpack('<8I',decoded[:32])
  need((magic,version,flags)==(0x314d4648,1,1) and nv==part['vertices'] and ni==part['triangles']*3,'HFM header format/count mismatch')
  need(po==32 and no==(po+12*nv+3)&~3 and io==(no+6*nv+3)&~3 and io+ni*4==len(decoded),'HFM offsets/length mismatch')
  positions=np.frombuffer(decoded,'<f4',3*nv,po).reshape(-1,3);normals=np.frombuffer(decoded,'<i2',3*nv,no).reshape(-1,3);faces=np.frombuffer(decoded,'<u4',ni,io).reshape(-1,3)
  need(np.isfinite(positions).all() and faces.max()<nv,'HFM nonfinite position/index bounds')
  need((positions>=np.array(manifest['bounds']['min'])-1e-7).all() and (positions<=np.array(manifest['bounds']['max'])+1e-7).all(),'HFM positions outside source world bounds')
  zero_normals=int(np.count_nonzero(~np.any(normals,axis=1)));degenerate=0
  for first in range(0,len(faces),100000):
   f=faces[first:first+100000];a=positions[f[:,0]].astype(np.float64)
   cross=np.cross(positions[f[:,1]]-a,positions[f[:,2]]-a)
   degenerate+=int(np.count_nonzero(~np.any(cross!=0,axis=1)))
  need(zero_normals==0 and degenerate==0,'HFM contains zero normals/zero-area triangles')
  asset_checks.append(dict(lod=lod['id'],path=part['path'],vertices=nv,triangles=ni//3,compressedBytes=len(encoded),decodedBytes=len(decoded),sha256=part['sha256'],decodedSha256=part['decodedSha256'],
      format='HFM1/version1/float32-position-flag1',headerOffsetsAndCountsValid=True,indicesInBounds=True,finitePositions=True,worldBoundsValid=True,zeroStoredNormals=zero_normals,zeroAreaStoredTriangles=degenerate,
      recordedFloat32PositionMaximumErrorUm=part['float32PositionMaximumErrorUm'],recordedFloat32PositionRmsErrorUm=part['float32PositionRmsErrorUm']))
  del encoded,decoded,positions,normals,faces,cross,a
 need(sum(p['triangles'] for p in lod['parts'])==lod['triangles'] and sum(p['decodedBytes'] for p in lod['parts'])<=128*1024**2,'LOD total/budget mismatch')
preflight,preflight_sha=load(OUT/'budget-preflight.json');resume,resume_sha=load(OUT/'bounded-resume.json')
need(preflight['assembled'] is False and preflight['pendingChildTriangles']==resume['exactPendingChildTriangles']==root['pendingChildTriangles']==7039735,'Root allocation history mismatch')
need(preflight['mergeFaceCap']==6000000 and resume['mergeFaceCap']==root['mergeFaceCapAtBuild']==h['mergeFaceCap']==7039735,'Root actual cap mismatch')
need(build['operationalCapExcludedFromGeometryIdentity'] is True and h['mergeFaceCapsObserved']==build['mergeFaceCapsObserved']==[6000000,7039735],'Cap identity/history mismatch')
need(resume['sourceSha256']==code['codeSha256'] and resume['numericalSettingsChanged'] is False and resume['overviewFingerprint']==reproduced,'Resume changed numerical source identity')
need(manifest['peakProcessRssBytes']<resume['addressSpaceLimitBytes'],'Final process RSS incompatible with declared cap')
need(b.digest(OUT/'manifest.json')==manifest_sha and b.digest(SCRIPTS/'build_overview.py')==code['codeSha256'],'Inputs changed during audit')
result=dict(schema='guided-native-overview-completion-audit-v21.1',passed=True,scope='whole-plan',completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),readOnly=True,networkRequests=0,
 overviewManifestSha256=manifest_sha,overviewFingerprint=reproduced,scientificRunFingerprint=run['fingerprint'],inputManifestFileSha256=input_file_sha,inputManifestCanonicalSha256=input_canonical,
 exactSourceRecordCoverage=len(rows),sourceRecordsStillMatchCompletedBank=True,processingCode=code,
 checkpointVerification=dict(nodes=len(nodes),leaves=len(leaves),compressedBytesHashed=checkpoint_bytes,allNpzSha256MatchRecords=True,allArrayHeadersValidated=header_verified,
   canonicalNodeRecordsSha256=h['nodeRecordsCanonicalSha256'],canonicalNodeRecordsSha256Reproduced=True,exactPartitionAndChildCountsVerified=True,
   recordedFinalExactBoundaryAssertions=len(nodes),rejectedIntermediateBoundaryTrials=rejected_seam_trials,methods=dict(method_counts),
   seamAssertionScope='All final nodes retain their runtime exact-boundary assertions, covered by the reproduced source and canonical record hash. Original input/output seam computations were not rerun for all nodes.'),
 independentRootChildSeams=dict(comparisons=seam_checks,allTwelveSharedPlanesExact=True,rootOuterPlaneVertices=root_plane_vertices,
   method='Fresh equality of sorted exact 1/16-native coordinate keys and one-face boundary-edge pairs for every adjacent S32 root-child pair.'),
 originalReferenceSamples=dict(count=sample_total,leafGroups=len(leaves),emptySampleLeafGroups=empty_sample_leaves,
   samplesSha256=leaf_sample_hash.hexdigest(),weightsSha256=leaf_weight_hash.hexdigest(),allLeafSamplesAndWeightsRetainedByteExactlyInRoot=True),
 hierarchyAggregates=checks,assets=asset_checks,
 lodMeasurements=[dict(id=l['id'],triangles=l['triangles'],vertices=l['vertices'],repairedCancellingNormals=l['repairedCancellingNormals'],sampledDistances=l['sampledDistances'],seconds=l['seconds']) for l in manifest['lods']],
 capOutcome=dict(status='complete',preflightSha256=preflight_sha,resumeSha256=resume_sha,originalCap=6000000,
   refusedBeforeAssembly=True,exactResumedCap=7039735,rootInputTriangles=root['inputTriangles'],rootFinalTriangles=root['triangles'],
   rootMethod=root['simplification']['method'],rootFrozenFaceFloor=root['simplification']['frozenFaceFloor'],
   addressSpaceLimitBytes=resume['addressSpaceLimitBytes'],finalResumedProcessPeakRssBytes=manifest['peakProcessRssBytes'],
   geometryFingerprintUnchanged=True,numericalSourceUnchanged=True,
   elapsedResumedProcessSeconds=manifest['elapsedSeconds'],timingScope='Successful final resumed process only; excludes prior parent work and parallel leaf precomputation.'),
 limitations=['Stored sampled distance statistics were identity-checked and reconciled, not recomputed in this audit.',
  'The lossy step-4 display is for navigation. Its error relative to the step-4 surface is not the native archive encoding bound or anatomical accuracy.',
  'Exact seams and valid HFM storage do not establish manifold topology or absence of self-intersections.'],
 seconds=time.monotonic()-START,peakAuditRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024)
Path('{temporary-cache}').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ('passed','overviewManifestSha256','overviewFingerprint','checkpointVerification','originalReferenceSamples','capOutcome','seconds','peakAuditRssBytes')}),flush=True)
