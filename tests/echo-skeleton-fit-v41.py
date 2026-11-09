"""Verify the intact fixed LADAF skeleton fit against original reference geometry.

Every source triangle is retained. Continuous triangle tests check GI and skin
crossings; the immutable acquired-heart support supplies an independent convex
clearance bound. Residual coarse reference-skin contacts are reported explicitly.
This is illustrative fitting, not patient registration or clinical validation.
"""
from pathlib import Path
import argparse,gzip,hashlib,json,subprocess,tempfile
import numpy as np
from scipy.ndimage import binary_erosion
from scipy.spatial import ConvexHull

ROOT=Path(__file__).resolve().parents[1]
P=argparse.ArgumentParser(description=__doc__)
P.add_argument('--output',type=Path,default=ROOT/'docs/echo-mobile-v41')
P.add_argument('--export',type=Path)
A=P.parse_args();A.output.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()

def edge_crosses(a,b,tris):
    d=b-a;e1=tris[:,1]-tris[:,0];e2=tris[:,2]-tris[:,0]
    h=np.cross(d,e2);det=np.einsum('ij,ij->i',e1,h);valid=np.abs(det)>1e-9
    inv=np.zeros_like(det);inv[valid]=1/det[valid];s=a-tris[:,0]
    u=inv*np.einsum('ij,ij->i',s,h);q=np.cross(s,e1);v=inv*(q@d);t=inv*np.einsum('ij,ij->i',e2,q)
    return valid&(u>=-1e-7)&(u<=1+1e-7)&(v>=-1e-7)&(u+v<=1+1e-7)&(t>1e-7)&(t<1-1e-7)

def crossing_pairs(first,second):
    lo,hi=second.min(1),second.max(1);pairs=[]
    for i,tri in enumerate(first):
        ids=np.nonzero(np.all((hi>=tri.min(0))&(lo<=tri.max(0)),axis=1))[0]
        if not len(ids):continue
        candidates=second[ids];hit=np.zeros(len(ids),bool)
        for k in range(3):hit|=edge_crosses(tri[k],tri[(k+1)%3],candidates)
        for j,other in enumerate(candidates):
            if not hit[j]:
                for k in range(3):
                    if edge_crosses(other[k],other[(k+1)%3],tri[None])[0]:hit[j]=True;break
        pairs.extend((i,int(v))for v in ids[hit])
    return pairs

def aabb_clearance(first,second):
    lo,hi=second.min(1),second.max(1);minimum=float('inf')
    for tri in first:
        gap=np.maximum(np.maximum(tri.min(0)-hi,lo-tri.max(0)),0)
        minimum=min(minimum,float(np.linalg.norm(gap,axis=1).min()))
    return minimum

class SkinEnvelope:
    """Actual outermost skin intersections along the unchanged anterior axis.

    This envelope check is separate from the full triangle intersection test;
    multiple coarse skin faces can occur within an anterior/posterior interval.
    """
    def __init__(self,triangles):
        self.triangles=triangles;self.a,self.b,self.c=triangles[:,0],triangles[:,1],triangles[:,2]
        a,b,c=self.a,self.b,self.c
        self.det=(b[:,1]-c[:,1])*(a[:,0]-c[:,0])+(c[:,0]-b[:,0])*(a[:,1]-c[:,1])
        self.grid={};self.cell=10;self.ymin=float(triangles[:,:,1].min());self.ymax=float(triangles[:,:,1].max())
        for i,(lo,hi) in enumerate(zip(triangles.min(1),triangles.max(1))):
            for x in range(int(np.floor(lo[0]/self.cell)),int(np.floor(hi[0]/self.cell))+1):
                for y in range(int(np.floor(lo[1]/self.cell)),int(np.floor(hi[1]/self.cell))+1):self.grid.setdefault((x,y),[]).append(i)
    def margin(self,point):
        p=point.copy();p[1]=np.clip(p[1],self.ymin+1e-5,self.ymax-1e-5)
        ids=np.asarray(self.grid.get(tuple(np.floor(p[:2]/self.cell).astype(int)),[]),dtype=int)
        if not len(ids):return None
        ids=ids[np.abs(self.det[ids])>1e-9];a,b,c=self.a[ids],self.b[ids],self.c[ids];d=self.det[ids]
        u=((b[:,1]-c[:,1])*(p[0]-c[:,0])+(c[:,0]-b[:,0])*(p[1]-c[:,1]))/d
        v=((c[:,1]-a[:,1])*(p[0]-c[:,0])+(a[:,0]-c[:,0])*(p[1]-c[:,1]))/d;w=1-u-v
        valid=(u>=-1e-7)&(v>=-1e-7)&(w>=-1e-7)
        z=(u*a[:,2]+v*b[:,2]+w*c[:,2])[valid]
        if len(z)<2:return None
        return float(min(p[2]-z.min(),z.max()-p[2]))
    def vertices(self,triangles):
        points=np.unique(triangles.reshape(-1,3),axis=0);margins=[self.margin(p)for p in points]
        finite=[m for m in margins if m is not None]
        return {'vertices':len(points),'missingIntersections':sum(m is None for m in margins),'verticesOutsideOuterSkinEnvelope':sum(m<-.0001 for m in finite),'minimumAnteriorPosteriorMarginMm':min(finite)}
    def contacts(self,triangles,pairs,original_pairs):
        if not pairs:return {'intersectionPairs':0,'intersectingBoneFaces':0}
        ids=np.unique(np.asarray(pairs)[:,0]);original_faces={i for i,j in original_pairs};faces=set(ids)
        minimum=0.;outside=0;total=0;worst=None
        for face in triangles[ids]:
            n=max(1,int(np.ceil(np.linalg.norm(face-np.roll(face,1,axis=0),axis=1).max()/.5)))
            for i in range(n+1):
                for j in range(n+1-i):
                    p=face[0]+(i/n)*(face[1]-face[0])+(j/n)*(face[2]-face[0]);margin=self.margin(p)
                    if margin is None:continue
                    total+=1;outside+=margin<0
                    if margin<minimum:minimum=margin;worst=p.tolist()
        centers=triangles[ids].mean(1);old=set(original_pairs);new=set(pairs)
        return {'intersectionPairs':len(pairs),'intersectingBoneFaces':len(ids),'previouslyIntersectingBoneFaces':len(faces&original_faces),'newNeighboringBoneFaces':sorted(map(int,faces-original_faces)),
            'retainedTrianglePairs':len(old&new),'newNeighboringTrianglePairs':len(new-old),'superiorLateralBoneFaces':int(((np.abs(centers[:,0])>100)&(centers[:,1]>100)).sum()),
            'maximumTriangleSampleEdgeMm':.5,'samples':total,'samplesOutsideOuterSkinEnvelope':int(outside),'maximumSampledAnteriorPosteriorPenetrationMm':-minimum,'worstSampleMm':worst}

code=r'''
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTeeContextModel,teeContextToLocal} from './public/tee-context-geometry.js';
import {decodeEchoReferenceAnatomy,createEchoAnatomyContext,bodyReferenceToWorld,bodyReferenceDirectionToWorld} from './public/echo-anatomy-context-v2.js';
import {fitEchoSkeletonSample} from './public/echo-skeleton-fit.js';
const path=process.argv[1];mkdirSync(path,{recursive:true});
const reference=await decodeEchoReferenceAnatomy({manifestBytes:readFileSync('public/assets/probe-context-v11/manifest.json'),compressedBytes:readFileSync('public/assets/probe-context-v11/torso.bin.gz')});
const donorId='ladaf-2021-17',referenceMm=JSON.parse(readFileSync('public/assets/echo-planes.json')).referenceMm;
const base=createTeeContextModel({donorId,referenceMm}),model=createEchoAnatomyContext({baseModel:base,referenceAnatomy:reference});
const hash=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const record={donorId,referenceMm,frame:model.frame,bodyTransform:model.bodyTransform,skeletonFit:model.skeletonFit,files:{},observedMaximumDisplacementMm:0,observedMinimumJacobianDeterminant:Infinity};
const save=(id,mesh)=>{
 const local=new Float32Array(mesh.vertices.length);
 for(let i=0;i<local.length;i+=6){local.set(teeContextToLocal(Array.from(mesh.vertices.subarray(i,i+3)),model.frame),i);const n=mesh.vertices.subarray(i+3,i+6);local.set(['left','superior','anterior'].map(k=>n.reduce((s,x,j)=>s+x*model.frame[k][j],0)),i+3);}
 const file=id+'.f32';writeFileSync(path+'/'+file,local);record.files[id]={file,sha256:hash(local),triangles:local.length/18,color:mesh.color,alpha:mesh.alpha,gloss:mesh.gloss};
};
for(const source of reference.meshes){
 const mesh=model.meshes.find(m=>m.id==='bodyparts3d-'+source.name);
 if(source.name==='skin'){save('skin',mesh);continue;}
 const original=new Float32Array(source.referenceVertices.length),origin=model.bodyTransform.referenceOriginMm;
 for(let i=0;i<original.length;i+=6){
  const p=source.referenceVertices.subarray(i,i+3),n=source.referenceVertices.subarray(i+3,i+6);
  original.set(bodyReferenceToWorld(p,model),i);original.set(bodyReferenceDirectionToWorld(n,model),i+3);
  const fit=fitEchoSkeletonSample(Array.from(p,(v,k)=>v-origin[k]),n,model.skeletonFit);
  record.observedMaximumDisplacementMm=Math.max(record.observedMaximumDisplacementMm,fit.displacementMm);
  record.observedMinimumJacobianDeterminant=Math.min(record.observedMinimumJacobianDeterminant,fit.jacobianDeterminant);
 }
 save(source.name+'-before',{...mesh,vertices:original});save(source.name+'-after',mesh);
}
for(const id of ['esophagus','stomach'])save(id,model.meshes.find(m=>m.id===id));
writeFileSync(path+'/model.json',JSON.stringify(record,null,2));
'''

with tempfile.TemporaryDirectory(prefix='heart-skeleton-fit-',dir='/dev/shm') as temporary:
    export=A.export or Path(temporary);export.mkdir(parents=True,exist_ok=True)
    subprocess.run(['node','--input-type=module','-e',code,str(export)],cwd=ROOT,check=True)
    record=json.loads((export/'model.json').read_text());meshes={}
    for key,file in record['files'].items():
        raw=(export/file['file']).read_bytes();assert sha(raw)==file['sha256'];meshes[key]=np.frombuffer(raw,'<f4').reshape(-1,3,6)[:,:,:3].astype(float)
    manifest=json.loads((ROOT/'public/assets/cleanup/manifest.json').read_text());packed=(ROOT/'public'/manifest['volumeUrl']).read_bytes();assert sha(packed)==manifest['sha256']
    dims=np.asarray(manifest['dimensions']);extent=np.asarray(manifest['physicalCenterExtentUm'])/1000
    support=np.frombuffer(gzip.decompress(packed),np.uint8).reshape(dims[::-1])>0
    boundary=np.stack(np.nonzero(support&~binary_erosion(support)),axis=1)[:,::-1]
    xyz=(boundary/(dims-1)-.5)*extent;world=xyz[:,[0,2,1]]*[1,1,-1]
    frame=record['frame'];local=(world-np.asarray(frame['originMm']))@np.asarray([frame['left'],frame['superior'],frame['anterior']]).T/frame['scale']
    hull=ConvexHull(local);guard=float(np.linalg.norm(extent/(dims-1))/2);skin=SkinEnvelope(meshes['skin']);checks={}
    def heart_clearance(triangles):
        minimum=float('inf')
        for i in range(0,len(triangles),128):
            planes=triangles[i:i+128]@hull.equations[:,:3].T+hull.equations[:,3]
            minimum=min(minimum,float(planes.min(1).max(1).min())*frame['scale']-guard)
        return minimum
    for name in ['spine','bones']:
        before,after=meshes[name+'-before'],meshes[name+'-after'];assert before.shape==after.shape
        old_skin=crossing_pairs(before,meshes['skin']);new_skin=crossing_pairs(after,meshes['skin'])
        old_eso=crossing_pairs(before,meshes['esophagus']);new_eso=crossing_pairs(after,meshes['esophagus']);new_stomach=crossing_pairs(after,meshes['stomach'])
        assert not new_eso and not new_stomach
        margin=heart_clearance(after);assert margin>1.9
        vertices=skin.vertices(after);assert not vertices['missingIntersections'] and not vertices['verticesOutsideOuterSkinEnvelope']
        entry={'trianglesBefore':len(before),'trianglesAfter':len(after),'originalEsophagusIntersectionPairs':len(old_eso),'remainingEsophagusIntersectionPairs':len(new_eso),'stomachIntersectionPairs':len(new_stomach),
            'conservativeEsophagusClearanceMm':aabb_clearance(after,meshes['esophagus'])*frame['scale'],'continuousAcquiredHeartSupportClearanceMm':margin,
            'originalSkinContact':skin.contacts(before,old_skin,old_skin),'fittedSkinContact':skin.contacts(after,new_skin,old_skin),'fittedSkinVertices':vertices}
        if name=='spine':assert len(old_eso)==551 and not old_skin and not new_skin
        else:
            assert len(old_skin)==263 and len(new_skin)==61
            assert entry['fittedSkinContact']['samplesOutsideOuterSkinEnvelope']==0
        checks[name]=entry;print(name,json.dumps(entry),flush=True)
    assert record['skeletonFit']['minimumJacobianDeterminant']>0.5
    report={'passed':True,'scope':__doc__,'sourceMaskSha256':manifest['sha256'],'halfSupportCellDiagonalMm':guard,'reference':record,'checks':checks,
        'limitations':'The reference skin is a coarse illustrative mesh. The fitted skeleton has 61 residual rib/sternum–skin triangle contacts, explicitly classified above; it is not asserted watertight. No bone triangles are removed. All three donors skin/GI/contact/source invariants and normals are separately checked by echo-skeleton-fit-v41.mjs.',
        'sourceHashes':{p:sha((ROOT/p).read_bytes())for p in ['public/echo-skeleton-fit.js','public/echo-anatomy-context-v2.js','public/tee-context-geometry.js','tests/echo-skeleton-fit-v41.py']}}
    (A.output/'skeleton-fit-verification.json').write_text(json.dumps(report,indent=2)+'\n')
