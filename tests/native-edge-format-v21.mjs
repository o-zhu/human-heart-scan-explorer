import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { parseNativeEdges, meshNativeEdges } from '../public/native-edge-format.js';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const PILOT=process.env.NATIVE_EDGE_PILOT||'/workspace/data/guided-native-v21/pilot/run';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const arrayBuffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const viewBytes=view=>new Uint8Array(view.buffer,view.byteOffset,view.byteLength);
function fixture({nx=3,ny=3,nz=3,step=1,origin=[1000,1100,1200],inside=(x)=>x>=1}={}){
  const signs=new Uint8Array(nx*ny*nz),mask=new Uint8Array(Math.ceil(signs.length/8)),streams=[],counts=[];
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const i=(z*ny+y)*nx+x;signs[i]=Number(inside(x,y,z));mask[i>>3]|=signs[i]<<(i&7);
  }
  for(let axis=0;axis<3;axis++){
    const dims=[nx,ny,nz];dims[axis]--;const values=[];
    for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
      const i=(z*ny+y)*nx+x,j=i+[1,nx,nx*ny][axis];
      if(signs[i]!==signs[j])values.push((x*3+y*5+z*7+axis)%32);
    }
    counts.push(values.length);const packed=new Uint8Array(Math.ceil(values.length*5/8));
    for(let i=0;i<values.length;i++)for(let bit=0;bit<5;bit++)packed[(i*5+bit)>>3]|=((values[i]>>bit)&1)<<((i*5+bit)&7);
    streams.push(packed);
  }
  const buffer=new ArrayBuffer(64+mask.length+streams.reduce((a,b)=>a+b.length,0)),header=new DataView(buffer);
  [0x3145424e,1,nx,ny,nz,5,mask.length,...counts,...origin,0,0,step===1?0:step].forEach((v,i)=>header.setUint32(i*4,v,true));
  header.setFloat32(52,17133.4,true);header.setFloat32(56,19.85*step,true);
  let offset=64;for(const data of[mask,...streams]){new Uint8Array(buffer,offset,data.length).set(data);offset+=data.length;}
  return buffer;
}
const alter=(buffer,offset,value,float=false)=>{const copy=buffer.slice(0),view=new DataView(copy);view[float?'setFloat32':'setUint32'](offset,value,true);return copy;};
function meshViews(mesh){return {positions:new Float32Array(mesh.buffer,mesh.positionOffset,mesh.vertexCount*3),
  normals:new Int16Array(mesh.buffer,mesh.normalOffset,mesh.vertexCount*3),indices:new Uint32Array(mesh.buffer,mesh.indexOffset,mesh.indexCount)};}

test('NBE1 rejects malformed headers, nonfinite source values, unsupported flags and wrong lengths',()=>{
  const good=fixture();
  for(const [offset,value,float] of [[0,0],[4,2],[8,1],[8,130],[20,4],[24,0],[28,999999],
    [40,7613],[44,7613],[48,8479],[52,NaN,true],[56,NaN,true],[52,Infinity,true],
    [52,17000,true],[56,20,true],[60,1],[60,3],[60,16]])assert.throws(()=>parseNativeEdges(alter(good,offset,value,float)));
  assert.throws(()=>parseNativeEdges(new Uint8Array(good)));
  assert.throws(()=>parseNativeEdges(new ArrayBuffer(63)));
  assert.throws(()=>parseNativeEdges(new ArrayBuffer(5*1024*1024+1)));
  assert.throws(()=>parseNativeEdges(good.slice(0,-1)));
  assert.throws(()=>parseNativeEdges(new Uint8Array([...new Uint8Array(good),0]).buffer));
  for(const step of[1,2,4,8])assert.equal(parseNativeEdges(fixture({step})).step,step);
});

test('Actual mask/edge count mismatches are rejected before any mesh is returned',()=>{
  let bad=alter(fixture(),28,8);bad=alter(bad,32,1); // Same total packed length; actual X/Y counts disagree.
  const parsed=parseNativeEdges(bad);
  assert.throws(()=>meshNativeEdges(parsed),/counts disagree/);
  assert.throws(()=>meshNativeEdges(parsed),/counts disagree/);
});

test('Native selections remain bounded and require an intact parsed block',()=>{
  const parsed=parseNativeEdges(fixture({nx:129,ny:129,nz:129,inside:()=>false}));
  for(const options of[{size:0},{size:1.5},{size:129},{size:65},{size:128},{start:[128,0,0]},
    {start:[-1,0,0]},{start:[0,0]},{start:null},{start:[0,0,NaN]},{local:'yes'}])assert.throws(()=>meshNativeEdges(parsed,options));
  assert.throws(()=>meshNativeEdges({...parsed}),/parsed/);
  const empty=meshNativeEdges(parsed,{start:[0,0,0],size:64});
  assert.equal(empty.vertexCount,0);assert.equal(empty.indexCount,0);
  const b=fixture(),p=parseNativeEdges(b);structuredClone(b,{transfer:[b]});
  assert.throws(()=>meshNativeEdges(p),/intact/);
});

test('World/local display transforms preserve connectivity and native-derived normals',()=>{
  const parsed=parseNativeEdges(fixture({nx:5,ny:5,nz:5,inside:(x,y,z)=>x+y+z>=5}));
  const a=meshNativeEdges(parsed,{size:3}),b=meshNativeEdges(parsed,{size:3,local:true});
  const av=meshViews(a),bv=meshViews(b);
  assert.deepEqual(av.indices,bv.indices);assert.deepEqual(av.normals,bv.normals);
  assert.equal(a.vertexCount,b.vertexCount);assert.equal(b.longestNativeVoxels,3);
  for(const p of[...av.positions,...bv.positions])assert.ok(Number.isFinite(p));
  for(const i of av.indices)assert.ok(i<a.vertexCount);
});

const PYTHON_REFERENCE=String.raw`
import hashlib,json,pathlib,sys,numpy as np,resource
sys.path.insert(0,str(pathlib.Path(sys.argv[1])/'scripts/guided-native-v21'))
from edge_codec import mesh_native_edges,decode_native_edges,cases_from_inside,TRI_COUNTS
root=pathlib.Path(sys.argv[2]);results=[]
h=lambda a:hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()
for path in sorted((root/'tiles').glob('*.nbe.gz')):
 if '.lod.' in path.name:continue
 encoded=path.read_bytes();points,faces=mesh_native_edges(encoded)
 inside,_,origin,step=decode_native_edges(encoded);assert step==1 and inside.shape==(129,129,129)
 cases=cases_from_inside(inside);counts=TRI_COUNTS[cases].ravel()
 owners=np.repeat(np.arange(cases.size,dtype=np.uint32),counts)
 piece=(owners%128>=64).astype(np.uint8)+2*((owners//128)%128>=64).astype(np.uint8)+4*(owners//16384>=64).astype(np.uint8)
 assert len(owners)==len(faces)
 a=points[faces[:,0]];u=points[faces[:,1]]-a;v=points[faces[:,2]]-a
 face_normals=np.cross(u,v);del a,u,v
 normals=np.zeros_like(points)
 for k in range(3):np.add.at(normals,faces[:,k],face_normals)
 del face_normals
 normals=normals[:,[0,2,1]]*np.array([1,1,-1]);length=np.linalg.norm(normals,axis=1);length[length==0]=1
 packed=np.floor(normals/length[:,None]*32767+.5).astype('<i2')
 local=points-origin;items=[]
 for z in (0,64):
  for y in (0,64):
   for x in (0,64):
    start=np.array([x,y,z]);selected=np.flatnonzero(np.all((local>=start)&(local<=start+64),axis=1))
    remap=np.full(len(points),0xffffffff,np.uint32);remap[selected]=np.arange(len(selected),dtype=np.uint32)
    indices=remap[faces[piece==(x//64+2*(y//64)+4*(z//64))]]
    assert not np.any(indices==0xffffffff)
    world=((points[selected]-np.array([3806.5,3806.5,4239.5]))[:,[0,2,1]]*np.array([1,1,-1])/8479).astype('<f4')
    items.append(dict(start=start.tolist(),vertices=len(selected),triangles=len(indices),positionsSha256=h(world),indicesSha256=h(indices.astype('<u4')),normalsSha256=h(packed[selected])))
 results.append(dict(tile=path.name.removesuffix('.nbe.gz'),triangles=len(faces),vertices=len(points),pieces=items))
print(json.dumps(dict(results=results,peakRssMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024)))
`;

function boundaryMaps(mesh,origin,start){
  const {positions,normals}=meshViews(mesh),bits=new Uint32Array(positions.buffer,positions.byteOffset,positions.length);
  const maps=Array.from({length:3},()=>[new Map(),new Map()]),component=[0,2,1],direction=[1,-1,1],center=[3806.5,3806.5,4239.5];
  for(let axis=0;axis<3;axis++)for(let side=0;side<2;side++){
    const plane=Math.fround((origin[axis]+start[axis]+64*side-center[axis])/8479*direction[axis]);
    for(let i=0;i<mesh.vertexCount;i++)if(positions[3*i+component[axis]]===plane){
      const key=`${bits[3*i]}:${bits[3*i+1]}:${bits[3*i+2]}`,normal=`${normals[3*i]}:${normals[3*i+1]}:${normals[3*i+2]}`;
      assert.ok(!maps[axis][side].has(key)||maps[axis][side].get(key)===normal);maps[axis][side].set(key,normal);
    }
  }
  return maps;
}
function compareFaces(a,b,requireNormals){
  assert.equal(a.size,b.size,'Shared boundary vertex counts differ.');
  const angles=[];let mismatches=0;
  for(const [key,normal]of a){assert.ok(b.has(key),'A shared boundary position differs.');
    if(normal!==b.get(key)){mismatches++;if(requireNormals)assert.equal(normal,b.get(key),'An internal-piece shading normal differs.');}
    const first=normal.split(':').map(Number),second=b.get(key).split(':').map(Number);
    const cosine=first.reduce((s,n,i)=>s+n*second[i],0)/(Math.hypot(...first)*Math.hypot(...second));
    angles.push(Math.acos(Math.max(-1,Math.min(1,cosine)))*180/Math.PI);
  }
  return {vertices:a.size,normalMismatches:mismatches,angles};
}

test('All eight native pilot tiles match Python and share exact internal geometry and normals',
  {skip:!existsSync(resolve(PILOT,'run.json'))},async()=>{
  const reference=spawnSync('python',['-c',PYTHON_REFERENCE,ROOT,PILOT],{encoding:'utf8',maxBuffer:2*1024*1024,
    env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1'}});
  assert.equal(reference.status,0,reference.stderr);const expected=JSON.parse(reference.stdout);assert.equal(expected.results.length,8);
  const baselinePath=process.env.NATIVE_EDGE_BASELINE||'/workspace/data/guided-native-v21/browser-qa/baseline.mjs';
  const baseline=existsSync(baselinePath)?await import(pathToFileURL(baselinePath).href):null;
  const results=[],tileFaces=new Map();let internalPairs=0,internalVertices=0,totalTriangles=0,zeroNormals=0;
  for(const record of expected.results){
    const file=resolve(PILOT,'tiles',record.tile+'.nbe.gz'),raw=gunzipSync(readFileSync(file)),buffer=arrayBuffer(raw);
    const parsed=parseNativeEdges(buffer),before=baseline?baseline.parseNativeEdges(buffer.slice(0)):null;
    const pieceFaces=new Map(),outer=Array.from({length:3},()=>[new Map(),new Map()]),pieces=[];
    for(const ref of record.pieces){
      let baselineMs=null;
      if(before){const t=performance.now(),old=baseline.meshNativeEdges(before,{start:ref.start,size:64});baselineMs=performance.now()-t;
        const oldViews=meshViews(old);assert.equal(hash(viewBytes(oldViews.positions)),ref.positionsSha256);assert.equal(hash(viewBytes(oldViews.indices)),ref.indicesSha256);}
      const t=performance.now(),mesh=meshNativeEdges(parsed,{start:ref.start,size:64}),milliseconds=performance.now()-t;
      const views=meshViews(mesh);
      assert.equal(mesh.vertexCount,ref.vertices);assert.equal(mesh.triangles,ref.triangles);
      assert.equal(hash(viewBytes(views.positions)),ref.positionsSha256,'Positions differ from Python.');
      assert.equal(hash(viewBytes(views.indices)),ref.indicesSha256,'Indices differ from Python.');
      assert.equal(hash(viewBytes(views.normals)),ref.normalsSha256,'Normals differ from complete-tile Python reference.');
      for(const value of views.positions)assert.ok(Number.isFinite(value));
      for(let i=0;i<mesh.vertexCount;i++){
        const magnitude=Math.hypot(views.normals[3*i],views.normals[3*i+1],views.normals[3*i+2]);
        if(magnitude===0)zeroNormals++;else assert.ok(Math.abs(magnitude-32767)<1.1);
      }
      for(const value of views.indices)assert.ok(value<mesh.vertexCount);
      const faces=boundaryMaps(mesh,parsed.origin,ref.start);pieceFaces.set(ref.start.join(','),faces);
      for(let axis=0;axis<3;axis++)for(let side=0;side<2;side++)if(ref.start[axis]===64*side)
        for(const [key,value]of faces[axis][side]){assert.ok(!outer[axis][side].has(key)||outer[axis][side].get(key)===value);outer[axis][side].set(key,value);}
      pieces.push({start:ref.start,vertices:mesh.vertexCount,triangles:mesh.triangles,milliseconds,baselineMilliseconds:baselineMs,
        positionsSha256:ref.positionsSha256,indicesSha256:ref.indicesSha256,normalsSha256:ref.normalsSha256});
    }
    for(const ref of record.pieces)for(let axis=0;axis<3;axis++)if(ref.start[axis]===0){
      const next=ref.start.slice();next[axis]=64;
      const match=compareFaces(pieceFaces.get(ref.start.join(','))[axis][1],pieceFaces.get(next.join(','))[axis][0],true);
      internalPairs++;internalVertices+=match.vertices;
    }
    const triangles=pieces.reduce((n,p)=>n+p.triangles,0);assert.equal(triangles,record.triangles);totalTriangles+=triangles;
    results.push({tile:record.tile,triangles,milliseconds:pieces.reduce((n,p)=>n+p.milliseconds,0),
      baselineMilliseconds:before?pieces.reduce((n,p)=>n+p.baselineMilliseconds,0):null,pieces});
    tileFaces.set(record.tile,outer);
  }
  let outerPairs=0,outerVertices=0,outerNormalMismatches=0;const angles=[];
  for(const [name,faces]of tileFaces){const xyz=name.split('_').map(Number);
    for(let axis=0;axis<3;axis++){const next=xyz.slice();next[axis]++;
      if(!tileFaces.has(next.join('_')))continue;
      const match=compareFaces(faces[axis][1],tileFaces.get(next.join('_'))[axis][0],false);
      outerPairs++;outerVertices+=match.vertices;outerNormalMismatches+=match.normalMismatches;angles.push(...match.angles);
    }
  }
  angles.sort((a,b)=>a-b);
  const milliseconds=results.reduce((n,r)=>n+r.milliseconds,0),baselineMilliseconds=baseline?results.reduce((n,r)=>n+r.baselineMilliseconds,0):null;
  const report={schema:'native-edge-browser-decoder-v21.1',pilot:PILOT,nodeVersion:process.version,
    decoderSha256:hash(readFileSync(resolve(ROOT,'public/native-edge-format.js'))),baselineSha256:baseline?hash(readFileSync(baselinePath)):null,
    decodedTiles:results.length,subregions:results.length*8,totalNativeTriangles:totalTriangles,
    exactPythonPositionMatches:64,exactPythonIndexMatches:64,exactPythonCompleteTileNormalMatches:64,
    nonfinitePositions:0,zeroNormals,crossingCacheBytesPer129CubedTile:3*128*129*129,
    normalPolicy:'Area-weighted normals from exact native-grid crossings, including the complete tile one-cell incident-face halo at each 64-cell piece. Outer tile normals use only their own tile.',
    internalSeams:{pairs:internalPairs,sharedVertices:internalVertices,positionsExact:true,packedNormalsExact:true},
    outerTileSeams:{pairs:outerPairs,sharedVertices:outerVertices,positionsExact:true,packedNormalMismatches:outerNormalMismatches,
      normalAngleDegreesMedian:angles[Math.floor(angles.length*.5)]||0,normalAngleDegreesP95:angles[Math.floor(angles.length*.95)]||0,
      normalAngleDegreesMax:angles.at(-1)||0},
    performance:{optimizedMilliseconds:milliseconds,baselineMilliseconds,speedup:baseline?baselineMilliseconds/milliseconds:null,
      scope:'Eight interleaved baseline/new 64-piece tile decodes in Node; includes lazy cache build and normal halos, excludes fetch/decompression/hash verification and GPU rendering. Concurrent reconstruction load makes these timings runtime-specific.'},
    pythonReferencePeakRssMiB:expected.peakRssMiB,results};
  if(process.env.NATIVE_EDGE_REPORT){mkdirSync(dirname(resolve(process.env.NATIVE_EDGE_REPORT)),{recursive:true});writeFileSync(process.env.NATIVE_EDGE_REPORT,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({nativeEdgeQA:{tiles:8,pieces:64,triangles:totalTriangles,internalPairs,outerPairs,outerNormalMismatches,
    optimizedMilliseconds:milliseconds,baselineMilliseconds,speedup:report.performance.speedup}}));
});
