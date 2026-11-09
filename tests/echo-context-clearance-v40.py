"""Historical v40 regression: compare its frozen cutaway with intact v71 geometry.

The current runtime uses the user-requested v41 intact skeleton fit. This test
loads the historical v40 implementation from its exact Git snapshot; its result
must not be described as current runtime geometry.

Continuous triangle bounds prove the esophageal clearance; segment/triangle
intersections independently reproduce the old defect and its removal. Retained
fragments must lie on original reference-spine faces. This is display geometry
verification, not patient registration or an acquired anatomical reconstruction.
"""
from pathlib import Path
import argparse,hashlib,json,subprocess,tempfile
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
P=argparse.ArgumentParser(description=__doc__)
P.add_argument('--output',type=Path,default=ROOT/'docs/echo-polish-v40')
P.add_argument('--export',type=Path,help='Optionally retain small meshes for native reference-geometry review.')
A=P.parse_args();A.output.mkdir(parents=True,exist_ok=True)
BASELINE='bd2b8b4261c288c7b9fef0d1970848b90c58e128'
FROZEN_V40='b1e5eb16954839923d0e37841079008c99730daf'
sha=lambda b:hashlib.sha256(b).hexdigest()

def edge_crosses(a,b,tris):
    d=b-a;e1=tris[:,1]-tris[:,0];e2=tris[:,2]-tris[:,0]
    h=np.cross(d,e2);det=np.einsum('ij,ij->i',e1,h);valid=np.abs(det)>1e-9
    inv=np.zeros_like(det);inv[valid]=1/det[valid];s=a-tris[:,0]
    u=inv*np.einsum('ij,ij->i',s,h);q=np.cross(s,e1);v=inv*(q@d);t=inv*np.einsum('ij,ij->i',e2,q)
    return valid&(u>=-1e-7)&(u<=1+1e-7)&(v>=-1e-7)&(u+v<=1+1e-7)&(t>1e-7)&(t<1-1e-7)

def crossing_pairs(spine,eso):
    lo,hi=eso.min(1),eso.max(1);pairs=[]
    for i,tri in enumerate(spine):
        ids=np.nonzero(np.all((hi>=tri.min(0))&(lo<=tri.max(0)),axis=1))[0]
        if not len(ids):continue
        candidates=eso[ids];hit=np.zeros(len(ids),bool)
        for k in range(3):hit|=edge_crosses(tri[k],tri[(k+1)%3],candidates)
        for j,other in enumerate(candidates):
            if not hit[j]:
                for k in range(3):
                    if edge_crosses(other[k],other[(k+1)%3],tri[None])[0]:hit[j]=True;break
        pairs.extend((i,int(v))for v in ids[hit])
    return pairs

def aabb_clearance(a,b):
    lo,hi=b.min(1),b.max(1);minimum=float('inf')
    for triangle in a:
        gap=np.maximum(np.maximum(triangle.min(0)-hi,lo-triangle.max(0)),0)
        minimum=min(minimum,float(np.linalg.norm(gap,axis=1).min()))
    return minimum

def contained_on_face(fragment,source,tolerance=4e-5):
    a,b,c=source;n=np.cross(b-a,c-a);length=np.linalg.norm(n)
    if length<1e-12:return False
    n/=length
    if np.max(np.abs((fragment-a)@n))>tolerance:return False
    for u,v in [(a,b),(b,c),(c,a)]:
        edge=v-u;distance=np.cross(edge,fragment-u)@n/max(np.linalg.norm(edge),1e-12)
        if np.min(distance)<-tolerance:return False
    return True

code=r'''
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createTeeContextModel,teeContextToLocal} from './public/tee-context-geometry.js';
const path=process.argv[1],baseline=process.argv[2],frozen=process.argv[3],baseUrl=pathToFileURL(process.cwd()+'/public/echo-anatomy-context-v2.js');
const dataUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const snapshot=file=>execFileSync('git',['show',frozen+':'+file],{encoding:'utf8'});
const absoluteImports=code=>code.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,p)=>'from '+q+new URL(p,baseUrl).href+q).replaceAll('import.meta.url',JSON.stringify(baseUrl.href));
const cutawayUrl=dataUrl(absoluteImports(snapshot('public/echo-context-cutaway.js')));
const frozenCode=snapshot('public/echo-anatomy-context-v2.js').replace("'./echo-context-cutaway.js'",JSON.stringify(cutawayUrl));
const current=await import(dataUrl(absoluteImports(frozenCode)));
const old=execFileSync('git',['show',baseline+':public/echo-anatomy-context-v2.js'],{encoding:'utf8'}).replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,p)=>'from '+q+new URL(p,baseUrl).href+q).replaceAll('import.meta.url',JSON.stringify(baseUrl.href));
const legacy=await import('data:text/javascript;base64,'+Buffer.from(old).toString('base64'));
const bytes={manifestBytes:readFileSync('public/assets/probe-context-v11/manifest.json'),compressedBytes:readFileSync('public/assets/probe-context-v11/torso.bin.gz')};
const oldReference=await legacy.decodeEchoReferenceAnatomy(bytes),newReference=await current.decodeEchoReferenceAnatomy(bytes);
const hash=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const records=[];mkdirSync(path,{recursive:true});
for(const donorId of ['ladaf-2021-17','s-20-29','s-20-28']){
 const sourcePath=donorId==='ladaf-2021-17'?'public/assets/echo-planes.json':`public/assets/donors/${donorId}/echo-planes.json`;
 const {referenceMm}=JSON.parse(readFileSync(sourcePath)),base=createTeeContextModel({donorId,referenceMm});
 const before=legacy.createEchoAnatomyContext({baseModel:base,referenceAnatomy:oldReference}),after=current.createEchoAnatomyContext({baseModel:base,referenceAnatomy:newReference});
 const transforms=['originMm','left','superior','anterior','scale','bodyReferenceScale','referenceMm'];
 if(transforms.some(k=>JSON.stringify(before.bodyTransform[k])!==JSON.stringify(after.bodyTransform[k])))throw new Error('Body transform moved: '+donorId);
 if(before.tractSamples!==after.tractSamples||before.gastricInteriorSamples!==after.gastricInteriorSamples||before.topology!==after.topology)throw new Error('GI route changed: '+donorId);
 const unchanged=before.meshes.filter(m=>m.id!=='bodyparts3d-spine').every(m=>hash(m.vertices)===hash(after.meshes.find(n=>n.id===m.id).vertices));
 if(!unchanged||hash(before.skinSurface.vertices)!==hash(after.skinSurface.vertices))throw new Error('Non-spine anatomy changed: '+donorId);
 const record={donorId,referenceMm:base.referenceMm,frameScale:base.frame.scale,bodyScale:after.bodyTransform.bodyReferenceScale,sourceHash:after.provenance.sourceHash,nonSpineMeshesByteIdentical:true,skinByteIdentical:true,tractAndTopologyIdentityPreserved:true,transformUnchanged:true,files:{}};
 for(const [id,model,name]of [['before',before,'bodyparts3d-spine'],['after',after,'bodyparts3d-spine'],['esophagus',after,'esophagus']]){
  const mesh=model.meshes.find(x=>x.id===name),local=new Float32Array(mesh.vertices.length);
  for(let i=0;i<local.length;i+=6){local.set(teeContextToLocal([...mesh.vertices.subarray(i,i+3)],model.frame),i);const n=mesh.vertices.subarray(i+3,i+6);local.set(['left','superior','anterior'].map(k=>n.reduce((v,x,j)=>v+x*model.frame[k][j],0)),i+3);}
  const file=`${donorId}-${id}.f32`,worldFile=`${donorId}-${id}-world.f32`;
  writeFileSync(path+'/'+file,local);writeFileSync(path+'/'+worldFile,mesh.vertices);
  record.files[id]={file,worldFile,sha256:hash(local),worldSha256:hash(mesh.vertices),triangles:local.length/18,color:mesh.color,alpha:mesh.alpha,gloss:mesh.gloss};
  if(id==='after')record.cutaway=mesh.displayCutaway||null;
 }
 records.push(record);
}
writeFileSync(path+'/models.json',JSON.stringify(records,null,2));
'''
with tempfile.TemporaryDirectory(prefix='heart-context-clearance-',dir='/dev/shm') as temporary:
    target=A.export or Path(temporary);target.mkdir(parents=True,exist_ok=True)
    subprocess.run(['node','--input-type=module','-e',code,str(target),BASELINE,FROZEN_V40],cwd=ROOT,check=True)
    records=json.loads((target/'models.json').read_text());checks=[]
    for record in records:
        donor=record['donorId'];files=record['files']
        raw={k:np.fromfile(target/f['worldFile'],'<f4').reshape(-1,3,6)for k,f in files.items()}
        # Geometry checks use local orthonormal coordinates; convert the bound
        # to actual model millimetres below using the unchanged physical scale.
        local={k:np.fromfile(target/f['file'],'<f4').reshape(-1,3,6)[:,:,:3].astype(float)for k,f in files.items()}
        before,after,eso=local['before'],local['after'],local['esophagus']
        old_cross=crossing_pairs(before,eso);new_cross=crossing_pairs(after,eso)
        assert not new_cross,(donor,'esophagus/spine intersections remain')
        clearance=aabb_clearance(after,eso)*record['frameScale']
        exact_before={t.tobytes()for t in raw['before']};exact_after={t.tobytes()for t in raw['after']}
        retained=len(exact_before&exact_after);changed=len(raw['before'])-retained
        if donor=='ladaf-2021-17':
            assert len(old_cross)==551 and len({i for i,j in old_cross})==59
            assert clearance>=2.4999,(donor,'conservative continuous clearance',clearance)
            assert changed==record['cutaway']['changedSourceTriangles']
        else:
            assert not old_cross and record['cutaway'] is None
            assert raw['before'].tobytes()==raw['after'].tobytes(),donor+' should not change'
        old_world=raw['before'][:,:,:3].astype(float);low,high=old_world.min(1),old_world.max(1);fragments=0
        for triangle in raw['after']:
            if triangle.tobytes() in exact_before:continue
            fragment=triangle[:,:3].astype(float);lo,hi=fragment.min(0),fragment.max(0)
            candidates=old_world[np.all((low<=lo+4e-5)&(high>=hi-4e-5),axis=1)]
            assert any(contained_on_face(fragment,face)for face in candidates),(donor,'new off-surface fragment')
            fragments+=1
        checks.append({**record,'originalIntersectionPairs':len(old_cross),'originalIntersectingSpineFaces':len({i for i,j in old_cross}),'originalIntersectingEsophagealFaces':len({j for i,j in old_cross}),'remainingIntersectionPairs':0,'continuousTriangleAabbClearanceMm':clearance,'byteIdenticalOriginalTriangles':retained,'changedOriginalTriangles':changed,'newFragmentsOnOriginalFaces':fragments})
        print(donor,'crossings',len(old_cross),'-> 0; continuous AABB clearance',round(clearance,6),'mm; unchanged original triangles',retained,flush=True)
    frozen_paths=['public/echo-context-cutaway.js','public/echo-anatomy-context-v2.js']
    source_hashes={p:sha(subprocess.check_output(['git','show',FROZEN_V40+':'+p],cwd=ROOT))for p in frozen_paths}
    source_hashes['public/tee-context-geometry.js']=sha((ROOT/'public/tee-context-geometry.js').read_bytes())
    report={'passed':True,'scope':__doc__,'baselineCommit':BASELINE,'frozenRevision':FROZEN_V40,'checks':checks,'sourceHashes':source_hashes}
    (A.output/'spine-cutaway-verification.json').write_text(json.dumps(report,indent=2)+'\n')
