#!/usr/bin/env python3
"""Read-only audit of the completed v21 bank; writes only its /tmp report."""
import os,sys
os.environ['PYTHONDONTWRITEBYTECODE']='1'
os.environ['OPENBLAS_NUM_THREADS']='1'
sys.dont_write_bytecode=True
from pathlib import Path
import base64,collections,datetime,gzip,hashlib,json,math,resource,struct,time
import numpy as np
REPO=Path('{local-workspace}')
SCRIPTS=REPO/'scripts/guided-native-v21'
sys.path.insert(0,str(SCRIPTS))
import finalize_manifest as fm
from source import parse_header
RUN=Path('{source-cache}/guided-native-v21/whole/run')
OUT=Path('{temporary-cache}')
START=time.monotonic()
def strict_json(path):
 def pairs(items):
  result={}
  for k,v in items:
   if k in result:raise ValueError('Duplicate JSON key '+k)
   result[k]=v
  return result
 def invalid(x):raise ValueError('Nonfinite JSON '+x)
 raw=Path(path).read_bytes()
 return json.loads(raw,object_pairs_hook=pairs,parse_constant=invalid),hashlib.sha256(raw).hexdigest()
def need(ok,message):
 if not ok:raise ValueError(message)
def report_json(value):
 OUT.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')
run,run_sha=strict_json(RUN/'run.json');progress,progress_sha=strict_json(RUN/'progress.json')
core,core_sha=fm.plan(Path(run['corePlan']),'core',core=True)
inputs,input_sha=fm.plan(Path(run['inputPlan']),'input')
need(core_sha==input_sha==fm.WHOLE_PLAN_SHA256 and run['fingerprint']==fm.WHOLE_RUN_FINGERPRINT,'Whole identity mismatch')
need(core==inputs and len(core)==run['coreBlocks']==run['inputBlocks']==37612,'Whole plan count mismatch')
need(progress['complete'] is True and progress['phase']=='complete' and progress['error'] is None,'Run incomplete')
need(progress['plannedCoreBlocks']==progress['completedCoreBlocks']==len(core),'Progress plan mismatch')
provenance=dict(inputPlan=input_sha,corePlan=core_sha,configuration=run['config'],processingCode={name:fm.file_hash(SCRIPTS/name) for name in fm.PROCESSING_FILES},priorManifest=fm.file_hash(REPO/'public/assets/ultra-volume-v7.json'))
need(fm.sha_bytes(json.dumps(provenance,sort_keys=True).encode())==run['fingerprint'],'Scientific fingerprint not reproducible')
seen={};lean=[];native_receipts=[];overview_inventory=[]
totals=collections.Counter();contribution=collections.Counter();by_z={};native_max=0.;native_rms2=0.;received=[]
weight_classes=collections.Counter();ov_empty_native_nonempty=0
paths=sorted((RUN/'records').glob('*.json'))
for i,path in enumerate(paths):
 r,record_sha=strict_json(path);xyz=fm.coordinates(r.get('coordinatesXYZ'),'record',core=True)
 need(xyz in core and xyz not in seen,'Duplicate or unplanned record '+str(xyz))
 need(path.name=='_'.join(map(str,xyz))+'.json','Record filename mismatch')
 need(r['fingerprint']==run['fingerprint'] and r.get('nativeSourceSamplingPreserved') is True,'Foreign fingerprint/source sampling')
 need(type(r.get('empty')) is bool,'Invalid empty status')
 seen[xyz]=record_sha
 arts=r.get('artifacts');need(isinstance(arts,list) and all(a.get('role') in ('native','overview') for a in arts),'Unknown artifact')
 ovs=[a for a in arts if a['role']=='overview'];ns=[a for a in arts if a['role']=='native']
 need(len(ovs)==1 and len(ns)==int(not r['empty']),'Artifact role count mismatch')
 ov=ovs[0];fm.nbe_metadata(ov,xyz,4)
 need(ov['path']=='tiles/'+'_'.join(map(str,xyz))+'.lod.nbe.gz','Overview path mismatch')
 header=fm.verify_local(fm.relative_path(RUN,ov['path'],'overview'),ov,'overview checkpoint')
 fm.check_nbe_header(header,ov,run['config']['thresholdRaw'])
 overview_inventory.append(dict(xyz=list(xyz),sha256=ov['sha256'],bytes=ov['bytes'],decodedSha256=ov['decodedSha256'],decodedBytes=ov['decodedBytes'],vertices=ov['vertices'],triangles=ov['triangles']))
 totals['overviewCheckpointTriangles']+=ov['triangles'];totals['overviewCheckpointVertices']+=ov['vertices']
 totals['overviewCheckpointCompressedBytes']+=ov['bytes'];totals['overviewCheckpointDecodedBytes']+=ov['decodedBytes']
 totals['overviewNonemptyTiles']+=int(ov['triangles']>0)
 lean.append((xyz,ov['triangles']))
 c=r.get('surfaceContribution');need(isinstance(c,dict) and set(c)==set(fm.CONTRIBUTION),'Contribution keys differ')
 for k in fm.CONTRIBUTION:contribution[k]+=fm.integer(c[k],k)
 full=fm.integer(r['nativeWeightFullPoints'],'full');nz=fm.integer(r['nativeWeightNonzeroPoints'],'nonzero');n=fm.integer(r['coreSamples'],'samples')
 need(n==129**3 and full<=nz<=n,'Invalid weight accounting')
 totals['coreSampleRecords']+=n;totals['nativeWeightFullPointRecords']+=full;totals['nativeWeightNonzeroPointRecords']+=nz
 weight_classes['noNativeWeightTiles' if nz==0 else 'allFullNativeWeightTiles' if full==n else 'partlyNativeWeightTiles']+=1
 if r['empty']:
  need(r['nativeVertices']==r['nativeTriangles']==sum(c.values())==ov['triangles']==0,'Empty counts disagree')
  totals['emptyTiles']+=1
 else:
  a=ns[0];v,f=fm.nbe_metadata(a,xyz,1)
  need(a['path']=='tiles/'+'_'.join(map(str,xyz))+'.nbe.gz','Native path mismatch')
  need(v==r['nativeVertices']==sum(c.values()) and f==r['nativeTriangles'] and min(v,f)>0,'Native count mismatch')
  remote=fm.receipt(a.get('remote'),a,'native',xyz,False)
  need(remote['verified'] is True,'Missing native verification')
  native_receipts.append(dict(xyz=list(xyz),**remote));received.append(remote['verifiedAt'])
  totals['nonemptyNativeTiles']+=1;totals['nativeVertices']+=v;totals['nativeTriangles']+=f
  totals['nativeCompressedBytes']+=a['bytes'];totals['nativeDecodedBytes']+=a['decodedBytes']
  native_max=max(native_max,a['maximumEncodingMovementUm']);native_rms2+=a['rmsEncodingMovementUm']**2*v
  ov_empty_native_nonempty+=int(ov['triangles']==0)
 z=by_z.setdefault(xyz[2],collections.Counter())
 z['plannedTiles']+=1;z['emptyTiles']+=int(r['empty']);z['nativeTriangles']+=r['nativeTriangles'];z['overviewTriangles']+=ov['triangles']
 if (i+1)%10000==0:print(json.dumps({'stage':'records-audited','records':i+1,'seconds':time.monotonic()-START}),flush=True)
need(set(seen)==core,'Missing core records')
need(dict(contribution)==progress['surfaceContribution'],'Progress contribution mismatch')
need(progress['nonemptyTiles']==progress['verifiedHostedNativeObjects']==totals['nonemptyNativeTiles'],'Progress receipt count mismatch')
need(progress['outputBytes']==totals['nativeCompressedBytes']+totals['overviewCheckpointCompressedBytes'],'Output bytes mismatch')
need(sum(contribution.values())==totals['nativeVertices'],'Stored crossing totals mismatch')
ledger=fm.source_ledger(RUN/'source-objects.jsonl',inputs)
objects={tuple(r['xyz']):r for r in ledger['objects']};extras=sorted(set(objects)-inputs)
extra_rows=[]
for c in extras:
 adjacent=[]
 for dz in (-1,0,1):
  for dy in (-1,0,1):
   for dx in (-1,0,1):
    if (c[0]+dx,c[1]+dy,c[2]+dz) in core:adjacent.append((c[0]+dx,c[1]+dy,c[2]+dz))
 need(bool(adjacent),'Unexplained source object farther than one source block from plan '+str(c))
 extra_rows.append(dict(xyz=list(c),sha256=objects[c]['sha256'],bytes=objects[c]['bytes'],generations=objects[c]['generations'],neighboringPlannedCoreTiles=len(adjacent)))
source_summary={k:v for k,v in ledger.items() if k!='objects'}
source_summary.update(additionalContextEncodedBytes=sum(r['bytes'] for r in extra_rows),plannedInputEncodedBytes=sum(objects[c]['bytes'] for c in inputs),
 allAdditionalContextWithinOneBlockOfCore=True,additionalContextXYZ=extra_rows,
 generationUnavailableUniqueObjects=sum(not r['generations'] for r in objects.values()),
 multipleGenerationSameBytesUniqueObjects=sum(len(r['generations'])>1 for r in objects.values()),
 conflictingHashOrSizeObjects=0,
 uniqueObjectRawBytes=sum(math.prod(min(128,d-c[i]*128) for i,d in enumerate(fm.DIMENSIONS))*2 for c in objects),
 sourceObjectCoordinatesBoundsXYZ=[list(map(min,zip(*objects))),list(map(max,zip(*objects)))],
 allSourceBlocksFull128Cubed=all(all(c[i]*128+128<=d for i,d in enumerate(fm.DIMENSIONS)) for c in objects),
 accountingScope='Original compressed N5 object identities observed by this scientific run. Repeated reads and final-invocation counters are distinct; none is a complete end-to-end network-transfer measurement.',
 outsidePlanInterpretation='All additional source coordinates are immediate 3x3x3 neighbors of at least one planned core. The frozen refine.missing_source_blocks code requests such context only when nonzero native weight needs real original samples through the finite TV halo; no extra core tiles were added.')
# Bounded source-byte check of every retained network-pilot object present in this run.
source_sample=[];outside_sample=0
for path in sorted(Path('{source-cache}/guided-native-v21/network-pilot').glob('*.n5')):
 c=tuple(map(int,path.stem.split('_')))
 if c not in objects:outside_sample+=1;continue
 h=fm.file_hash(path);need(h==objects[c]['sha256'] and path.stat().st_size==objects[c]['bytes'],'Retained original source hash/size mismatch')
 with path.open('rb') as f:header=f.read(48)
 meta=parse_header(header);need(meta['cbytes']+16==path.stat().st_size,'Retained original N5 cbytes mismatch')
 source_sample.append(dict(xyz=list(c),sha256=h,bytes=path.stat().st_size,dimensionsXYZ=list(meta['dimensionsXYZ']),nbytes=meta['nbytes'],bloscBlocksize=meta['blocksize']))
# Exact count of the builder's leaf partition, without constructing any meshes.
leaf_stats=collections.Counter();node_stats=collections.Counter();leaf_faces=[]
def partition(rows,span):
 node_stats[str(span)]+=1;raw=sum(v for c,v in rows)
 if (span<=4 and raw<=750000) or span==1:
  need(raw<=750000,'Single tile exceeds leaf face cap')
  leaf_stats[str(span)]+=1;leaf_faces.append(raw);return
 half=span//2;groups={}
 for c,v in rows:groups.setdefault(tuple(n//half*half for n in c),[]).append((c,v))
 for group in groups.values():partition(group,half)
partition(lean,1<<max(max(c) for c,v in lean).bit_length())
# Validate the exact final immutable recovery control and its historical receipts.
CP=RUN.parent/'checkpoints';reference,_=strict_json(CP/'control-latest.json');control_path=CP/reference['file']
encoded=control_path.read_bytes();decoded=gzip.decompress(encoded);control=json.loads(decoded)
need(hashlib.sha256(encoded).hexdigest()==reference['sha256']=='874f82813bc0d791416751384d3a143a6cfd5b7c4e3f7129ce3bbdf0b64e2809','Final control checksum mismatch')
need(len(encoded)==reference['bytes'] and len(decoded)==reference['decodedBytes'] and hashlib.sha256(decoded).hexdigest()==reference['decodedSha256'],'Control decoded identity mismatch')
fm.receipt(reference['remote'],dict(sha256=reference['sha256'],bytes=reference['bytes']),'evidence')
need(control['fingerprint']==run['fingerprint'] and control['coverageComplete'] is True and control['plannedRecords']==control['completedRecords']==len(core),'Final control scope mismatch')
need(control['originalRunSha256']==run_sha,'Final control run identity differs')
need(control['sourceObjects']['bytes']==(RUN/'source-objects.jsonl').stat().st_size and control['sourceObjects']['sha256']==ledger['logSha256'],'Final control source log differs')
need(base64.b64decode(control['sourceObjects']['base64'],validate=True)==(RUN/'source-objects.jsonl').read_bytes(),'Final control source log not byte exact')
for name,expected in [('core',core_sha),('input',input_sha)]:
 p=control['plans'][name];raw=base64.b64decode(p['base64'],validate=True)
 need(p['sha256']==expected==hashlib.sha256(raw).hexdigest() and p['bytes']==len(raw),'Final control embedded plan differs')
part_coords=[];part_rows=[]
for part in control['parts']:
 part_coords.extend(tuple(c) for c in part['coordinatesXYZ'])
 remote=part.get('remote');fm.receipt(remote,dict(sha256=part['sha256'],bytes=part['bytes']),'evidence')
 part_rows.append(dict(sha256=part['sha256'],bytes=part['bytes'],coordinates=len(part['coordinatesXYZ']),verifiedAt=remote['verifiedAt']))
need(len(part_coords)==len(core) and set(part_coords)==core,'Recovery part coordinates do not cover plan exactly once')
need(fm.file_hash(RUN/'run.json')==run_sha and fm.file_hash(RUN/'progress.json')==progress_sha and fm.file_hash(RUN/'source-objects.jsonl')==ledger['logSha256'],'Run changed during audit')
result=dict(schema='guided-native-completed-bank-local-audit-v21.1',passed=True,completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),scope='whole-plan',readOnly=True,networkRequests=0,
 processingFingerprint=run['fingerprint'],planSha256=core_sha,runManifestSha256=run_sha,progressSha256=progress_sha,configuration=run['config'],processingIdentity=provenance,
 exactPlanCoverage=dict(plannedBlocks=len(core),completedBlocks=len(seen),duplicates=0,missing=0,foreignFingerprint=0,unplannedCoreTiles=0),
 totals=dict(totals),surfaceContribution=dict(contribution),storedCrossingFractions={k:v/totals['nativeVertices'] for k,v in contribution.items()},
 contributionScope='Stored edge crossings, including shared-tile duplicates; not distinct mesh vertices, area fractions or anatomical completeness.',weightPointAccounting=dict(weight_classes),
 overviewNativeNonemptyButStep4EmptyTiles=ov_empty_native_nonempty,
 source=source_summary,retainedSourceValidation=dict(objects=len(source_sample),encodedBytes=sum(r['bytes'] for r in source_sample),allHashesMatchRunLedger=True,allFourStreamN5HeadersValid=True,bloscVersion=2,bloscCodecVersion=1,bloscFlags=148,typesize=2,decodedUint16Endianness='big',decodedBlockShapeXYZ=[128,128,128],fourIndependentStreamsRawBytes=1048576,otherCacheObjectsOutsideRunSkipped=outside_sample,scope='Existing retained network-pilot bytes only; the full original volume was not redownloaded or re-decoded.',objectsCanonicalSha256=fm.sha_bytes(fm.canonical(source_sample))),
 nativeReceipts=dict(count=len(native_receipts),allHistoricalFullPublicGetVerified=True,allShaBytesUrlFilenameXYZMatch=True,freshNetworkProbe=False,earliestVerifiedAt=min(received),latestVerifiedAt=max(received),canonicalSha256=fm.sha_bytes(fm.canonical(sorted(native_receipts,key=lambda r:r['xyz'])))),
 localOverviewVerification=dict(count=len(overview_inventory),compressedAndDecodedHashesAndSizes=True,nbeHeaderThresholdOriginStepCountsMatch=True,canonicalSha256=fm.sha_bytes(fm.canonical(sorted(overview_inventory,key=lambda r:r['xyz'])))),
 encoding=dict(nativeCrossingBits=5,nativeEncodingBoundUm=19.85/64,maximumRecordedEncodingMovementUm=native_max,weightedRmsEncodingMovementUm=math.sqrt(native_rms2/totals['nativeVertices']),overviewEncodingBoundUm=19.85*4/64,scope='Relative to the processed scalar isosurface; excludes TV, guidance, registration, simplification and anatomical error.'),
 finalProgressLastInvocationOnly={k:progress[k] for k in ('networkBytesThisRun','requestsThisRun','retriesThisRun','elapsedSeconds')},
 overviewPartition=dict(groupBlocks=4,leafFaceCap=750000,totalOriginalOverviewTriangles=totals['overviewCheckpointTriangles'],leaves=sum(leaf_stats.values()),leavesBySpan=dict(leaf_stats),totalHierarchyNodes=sum(node_stats.values()),nodesBySpan=dict(node_stats),maximumLeafRawTriangles=max(leaf_faces),scope='Exact partition only; no meshes constructed and no prediction of final merge cap feasibility.'),
 finalRecoveryControl=dict(sha256=reference['sha256'],bytes=len(encoded),decodedSha256=reference['decodedSha256'],decodedBytes=len(decoded),verifiedAt=reference['remote']['verifiedAt'],parts=len(part_rows),partCompressedBytes=sum(r['bytes'] for r in part_rows),partCoordinatesCoverPlanExactly=True,allPartHistoricalReceiptsValid=True,sourceLedgerEmbeddedByteExact=True,scope='Control and part metadata/receipts validated locally; archive parts not re-downloaded or restored in this audit.'),
 zLayers=[dict(z=z,**v) for z,v in sorted(by_z.items())],issues=[],limits=[fm.COVERAGE_CAVEAT,'Step-4 overview construction and hosted HFM publication are still in progress; this is a completed native bank audit, not a publishable final-viewer manifest.'],
 seconds=time.monotonic()-START,peakRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024)
report_json(result)
print(json.dumps({k:result[k] for k in ('passed','scope','totals','surfaceContribution','overviewPartition','seconds','peakRssBytes')}),flush=True)
print(json.dumps({'source':{k:v for k,v in source_summary.items() if k!='additionalContextXYZ'},'report':str(OUT)}),flush=True)
