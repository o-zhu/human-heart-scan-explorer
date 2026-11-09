/**
 * Fixed BodyParts3D thoracic context for both Echo atlases.
 *
 * The acquired donor heart remains the only displayed heart. These surrounding
 * meshes are reference anatomy, not donor segmentation or clinical registration.
 * The unchanged body transform supplies skin and contact queries. A single fixed
 * skeleton-only fit preserves all bone triangles while separating independent
 * reference organs. A selected view, camera, slice or probe pose is deliberately
 * not an input to either transform.
 *
 * Geometry uses the existing XYZ/NXYZ mesh contract and therefore the existing
 * accepted-heart-depth renderer. This module does not draw, clear depth, alter a
 * source section, move a probe, or access another storage collection.
 */
import {createTeeContextFrame,createTeeContextModel} from './tee-context-geometry.js';
import {ECHO_SKELETON_FITS,fitEchoSkeletonSample} from './echo-skeleton-fit.js';

export const ECHO_ANATOMY_CONTEXT_REVISION='echo-bodyparts3d-context-v41';
const frozenVector=v=>Object.freeze(Array.from(v));
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const mul=(a,s)=>a.map(v=>v*s);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const magnitude=v=>Math.hypot(...v);
const unit=v=>{const n=magnitude(v);if(!Number.isFinite(n)||n<1e-10)throw new Error('Reference anatomy has an invalid direction.');return mul(v,1/n);};
const finite3=v=>v&&v.length===3&&Array.from(v).every(Number.isFinite);
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const donorIdentity=value=>({
 '1659197537':'ladaf-2021-17','1966162746':'s-20-28','1773963465':'s-20-29',
 }[String(value).toLowerCase()]||String(value).toLowerCase());

/** Hashes pin the existing, already licensed 495 KB asset, not a new download. */
export const ECHO_REFERENCE_ANATOMY=Object.freeze({
 manifestUrl:new URL('./assets/probe-context-v11/manifest.json',import.meta.url).href,
 meshUrl:new URL('./assets/probe-context-v11/torso.bin.gz',import.meta.url).href,
 manifestBytes:35675,
 manifestSha256:'d8a7563803aac62012c4e78075024cbc35cd5ce53338b3797ca0068484b4408c',
 compressedBytes:495691,
 compressedSha256:'5e02de3b94c4a527d059bc6bb0c2d58ac995d699c940e9e5e68e997c11e37a28',
 decodedBytes:2166912,
 decodedSha256:'49fba584164d5664b30b8fc662f3a516bfc09f36b4c99308968efd906cf89b4c',
 referenceOriginMm:frozenVector([20,5,8]),
 coordinateSystem:'patient-left, superior, anterior; reference millimetres',
 sourceUrl:'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html',
 licenseUrl:'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html',
 attribution:'BodyParts3D, © The Database Center for Life Science, CC BY 4.0',
});

const LAYOUT=Object.freeze([
 Object.freeze({name:'skin',offset:0,count:19494}),
 Object.freeze({name:'bones',offset:467856,count:48000}),
 Object.freeze({name:'spine',offset:1619856,count:11400}),
 Object.freeze({name:'heart',offset:1893456,count:11394}),
]);
// Keep the anatomical chest, including the notch and subcostal window, but not
// the cut-off upper arms or abdominal continuation. Clipping adds no caps.
export const ECHO_BODY_CROP=Object.freeze({min:frozenVector([-160,-120,-165]),max:frozenVector([160,160,115])});
const MATERIALS=Object.freeze({
 skin:Object.freeze({color:frozenVector([.52,.43,.36]),alpha:.025,gloss:.035}),
 bones:Object.freeze({color:frozenVector([.74,.76,.69]),alpha:.09,gloss:.065}),
 spine:Object.freeze({color:frozenVector([.61,.68,.65]),alpha:.075,gloss:.055}),
});
const windowSpec=(anchor,min,max,label)=>Object.freeze({anchorXY:frozenVector(anchor),referenceBounds:Object.freeze({min:frozenVector(min),max:frozenVector(max)}),label,patientRegistered:false});
const parasternal=windowSpec([26,25],[8,-10,35],[44,60,125],'Left parasternal reference window');
/** Coordinates are in the fixed BodyParts3D frame, before the donor transform.
 * These are bounded illustrative windows, not measured intercostal landmarks.
 * The contact Z comes from the actual anterior skin triangles, not a flat patch.
 */
export const ECHO_BODY_WINDOWS=Object.freeze({
 'parasternal-long':parasternal,
 'parasternal-short':parasternal,
 apical:windowSpec([76,-48],[44,-84,15],[112,-16,125],'Left apical reference window'),
 subcostal:windowSpec([0,-72],[-26,-110,30],[30,-52,125],'Subxiphoid reference window'),
 suprasternal:windowSpec([0,92],[-18,77,-5],[18,115,105],'Suprasternal notch reference window'),
});

const verifiedSources=new WeakSet();
const upgradedModels=new WeakMap();
let referencePromise=null;
const asBytes=value=>{
 if(value instanceof ArrayBuffer)return new Uint8Array(value);
 if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
 throw new TypeError('Reference anatomy requires byte buffers.');
};
const sha256=async bytes=>{
 if(!globalThis.crypto?.subtle)throw new Error('Reference anatomy needs checksum verification.');
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
};
const aborted=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Reference anatomy request aborted.','AbortError');};

async function exactStreamBytes(stream,length,label){
 if(!stream?.getReader)throw new Error(`${label} is not a readable byte stream.`);
 const reader=stream.getReader(),bytes=new Uint8Array(length);let used=0;
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   if(!(value instanceof Uint8Array)||value.byteLength>length-used)throw new Error(`${label} exceeds its pinned byte limit.`);
   bytes.set(value,used);used+=value.byteLength;
  }
  if(used!==length)throw new Error(`${label} is incomplete.`);
  return bytes;
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
}

/** Public to permit file-backed Node/native review without bypassing checks.
 * Validation finishes before any geometry becomes available to a caller.
 */
export async function decodeEchoReferenceAnatomy({manifestBytes,compressedBytes}){
 const metadata=asBytes(manifestBytes),compressed=asBytes(compressedBytes),pin=ECHO_REFERENCE_ANATOMY;
 if(metadata.byteLength!==pin.manifestBytes||compressed.byteLength!==pin.compressedBytes)throw new Error('Reference anatomy byte count mismatch.');
 const hashes=await Promise.all([sha256(metadata),sha256(compressed)]);
 if(hashes[0]!==pin.manifestSha256||hashes[1]!==pin.compressedSha256)throw new Error('Reference anatomy source checksum mismatch.');
 const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(metadata));
 if(manifest.schemaVersion!==1||manifest.dataFile!=='torso.bin.gz'||manifest.decodedBytes!==pin.decodedBytes||manifest.compressedBytes!==pin.compressedBytes||manifest.sha256!==pin.compressedSha256||manifest.meshes?.length!==LAYOUT.length)throw new Error('Reference anatomy layout mismatch.');
 if(typeof DecompressionStream!=='function')throw new Error('This browser cannot decode reference anatomy.');
 const raw=await exactStreamBytes(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),pin.decodedBytes,'Decoded reference anatomy');
 if(await sha256(raw)!==pin.decodedSha256)throw new Error('Decoded reference anatomy checksum mismatch.');
 const data=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),meshes=[];let heartBounds;
 for(let index=0;index<LAYOUT.length;index++){
  const spec=LAYOUT[index],item=manifest.meshes[index];
  if(item.name!==spec.name||item.offset!==spec.offset||item.count!==spec.count||item.triangles!==spec.count/3)throw new Error('Reference anatomy mesh range mismatch.');
  const vertices=new Float32Array(spec.count*6);
  for(let i=0;i<vertices.length;i++)vertices[i]=data.getFloat32(spec.offset+i*4,true);
  validateVertices(vertices);
  const bounds=vertexBounds(vertices);
  if(spec.name==='heart'){heartBounds=bounds;continue;}
  const cropped=clipVertices(vertices,ECHO_BODY_CROP);
  meshes.push(Object.freeze({name:spec.name,referenceVertices:cropped,bounds:vertexBounds(cropped),sourceTriangleCount:spec.count/3,sourceElements:Object.freeze([...item.sourceElements])}));
 }
 const reference=Object.freeze({revision:ECHO_ANATOMY_CONTEXT_REVISION,meshes:Object.freeze(meshes),heartReferenceBounds:heartBounds,referenceOriginMm:pin.referenceOriginMm,source:ECHO_REFERENCE_ANATOMY,manifest:Object.freeze({title:manifest.title,attribution:manifest.attribution,license:manifest.license,licenseUrl:manifest.licenseUrl,source:manifest.source,coordinateTransform:manifest.coordinateTransform})});
 verifiedSources.add(reference);return reference;
}

async function fetchReference(fetchImpl){
 const load=async(url,length,label)=>{
  const response=await fetchImpl(url,{cache:'force-cache',priority:'low'});
  if(!response?.ok)throw new Error(`${label} could not load.`);
  return exactStreamBytes(response.body,length,label);
 };
 const [manifestBytes,compressedBytes]=await Promise.all([
  load(ECHO_REFERENCE_ANATOMY.manifestUrl,ECHO_REFERENCE_ANATOMY.manifestBytes,'Reference anatomy metadata'),
  load(ECHO_REFERENCE_ANATOMY.meshUrl,ECHO_REFERENCE_ANATOMY.compressedBytes,'Reference anatomy mesh'),
 ]);
 return decodeEchoReferenceAnatomy({manifestBytes,compressedBytes});
}

function waitWithSignal(promise,signal){
 if(!signal)return promise;
 aborted(signal);
 return new Promise((resolve,reject)=>{
  const cancel=()=>reject(signal.reason||new DOMException('Reference anatomy request aborted.','AbortError'));
  signal.addEventListener('abort',cancel,{once:true});
  promise.then(value=>{signal.removeEventListener('abort',cancel);if(!signal.aborted)resolve(value);},error=>{signal.removeEventListener('abort',cancel);reject(error);});
 });
}

/** A failed download is retryable. Cancellation detaches one consumer without
 * cancelling another atlas's shared, bounded 495 KB download.
 */
export function loadEchoReferenceAnatomy({signal,fetchImpl=globalThis.fetch}={}){
 aborted(signal);
 if(typeof fetchImpl!=='function')return Promise.reject(new Error('Reference anatomy fetch is unavailable.'));
 if(fetchImpl!==globalThis.fetch)return waitWithSignal(fetchReference(fetchImpl),signal);
 if(!referencePromise)referencePromise=fetchReference(fetchImpl).catch(error=>{referencePromise=null;throw error;});
 return waitWithSignal(referencePromise,signal);
}

function validateVertices(vertices){
 if(vertices.length===0||vertices.length%18!==0)throw new Error('Reference anatomy triangle layout is invalid.');
 for(let i=0;i<vertices.length;i+=6){
  for(let j=0;j<3;j++)if(!Number.isFinite(vertices[i+j])||Math.abs(vertices[i+j])>512)throw new Error('Reference anatomy coordinate is invalid.');
  const n=Math.hypot(vertices[i+3],vertices[i+4],vertices[i+5]);
  if(!Number.isFinite(n)||n<.98||n>1.02)throw new Error('Reference anatomy normal is invalid.');
 }
}

function pointBounds(points){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const p of points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
 if(!min.every(Number.isFinite)||!max.every(Number.isFinite))throw new Error('Reference anatomy bounds are empty.');
 return Object.freeze({min:frozenVector(min),max:frozenVector(max),center:frozenVector(mix(min,max,.5))});
}
function vertexBounds(vertices){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let j=0;j<vertices.length;j+=6)for(let i=0;i<3;i++){min[i]=Math.min(min[i],vertices[j+i]);max[i]=Math.max(max[i],vertices[j+i]);}
 return pointBounds([min,max]);
}
function boxCorners(box){return Array.from({length:8},(_,mask)=>box.min.map((v,i)=>(mask>>i)&1?box.max[i]:v));}

function clipVertices(vertices,box){
 const output=[];
 for(let i=0;i<vertices.length;i+=18){
  let polygon=[0,6,12].map(j=>Array.from(vertices.subarray(i+j,i+j+6)));
  for(let axis=0;axis<3&&polygon.length;axis++)for(const [side,limit] of [[1,box.min[axis]],[-1,box.max[axis]]]){
   const next=[];
   for(let j=0;j<polygon.length;j++){
    const a=polygon[j],b=polygon[(j+1)%polygon.length],da=(a[axis]-limit)*side,db=(b[axis]-limit)*side,insideA=da>=0,insideB=db>=0;
    if(insideA)next.push(a);
    if(insideA!==insideB)next.push(mix(a,b,da/(da-db)));
   }
   polygon=next;
  }
  for(let j=1;j<polygon.length-1;j++){
   const triangle=[polygon[0],polygon[j],polygon[j+1]];
   if(magnitude(cross(sub(triangle[1].slice(0,3),triangle[0].slice(0,3)),sub(triangle[2].slice(0,3),triangle[0].slice(0,3))))<1e-7)continue;
   for(const vertex of triangle)output.push(...vertex.slice(0,3),...unit(vertex.slice(3)));
  }
  if(output.length>vertices.length*6)throw new Error('Reference thorax crop exceeds its geometry bound.');
 }
 return new Float32Array(output);
}

function makeTransform(frame){
 if(!frame||!(frame.referenceMm>0)||!(frame.scale>0)||!finite3(frame.originMm)||!finite3(frame.left)||!finite3(frame.superior)||!finite3(frame.anterior))throw new TypeError('Reference anatomy needs a fixed donor frame.');
 const axes=[frame.left,frame.superior,frame.anterior];
 if(axes.some(a=>Math.abs(magnitude(a)-1)>1e-6)||Math.abs(dot(axes[0],axes[1]))>1e-6||Math.abs(dot(axes[0],axes[2]))>1e-6||Math.abs(dot(axes[1],axes[2]))>1e-6||dot(cross(axes[0],axes[1]),axes[2])<.999999)throw new TypeError('Reference anatomy needs a right-handed orthonormal frame.');
 // One donor-specific uniform fit clears the measured specimen envelope.
 // The complete reference thorax shares this factor; source anatomy, its
 // orientation and the independently fitted GI/diaphragm remain fixed.
 const bodyReferenceScale=frame.contextProfile?.bodyReferenceScale||1;
 if(!(Number.isFinite(bodyReferenceScale)&&bodyReferenceScale>0))throw new TypeError('Reference torso scale must be positive.');
 return Object.freeze({revision:ECHO_ANATOMY_CONTEXT_REVISION,referenceOriginMm:ECHO_REFERENCE_ANATOMY.referenceOriginMm,originMm:frozenVector(frame.originMm),left:frozenVector(frame.left),superior:frozenVector(frame.superior),anterior:frozenVector(frame.anterior),scale:frame.scale*bodyReferenceScale,bodyReferenceScale,referenceMm:frame.referenceMm,donorId:frame.donorId,patientRegistered:false,method:'One fixed reference-center-to-AV-frame similarity with specimen-envelope torso scaling; no view-dependent transform.'});
}

function transformOf(model){const t=model?.bodyTransform;if(!t)throw new TypeError('An upgraded Echo anatomy model is required.');return t;}
const rotate=(p,t)=>p.map((_,i)=>t.left[i]*p[0]+t.superior[i]*p[1]+t.anterior[i]*p[2]);
export function bodyReferenceToWorld(point,model){
 if(!finite3(point))throw new TypeError('A finite reference point is required.');
 const t=transformOf(model);return add(t.originMm,mul(rotate(sub(Array.from(point),t.referenceOriginMm),t),t.scale));
}
export function worldToBodyReference(point,model){
 if(!finite3(point))throw new TypeError('A finite world point is required.');
 const t=transformOf(model),p=mul(sub(Array.from(point),t.originMm),1/t.scale);
 return add(t.referenceOriginMm,[dot(p,t.left),dot(p,t.superior),dot(p,t.anterior)]);
}
export function bodyReferenceDirectionToWorld(direction,model){return unit(rotate(Array.from(direction),transformOf(model)));}

export function skeletonReferenceToWorld(point,model){
 const fit=model.skeletonFit;
 if(!fit)return bodyReferenceToWorld(point,model);
 const origin=model.bodyTransform.referenceOriginMm;
 return bodyReferenceToWorld(add(origin,fitEchoSkeletonSample(sub(Array.from(point),origin),null,fit).point),model);
}

function transformMesh(source,model){
 const a=source.referenceVertices,out=new Float32Array(a.length),t=model.bodyTransform,fit=source.name==='skin'?null:model.skeletonFit;
 for(let i=0;i<a.length;i+=6){
  const point=a.subarray(i,i+3),normal=a.subarray(i+3,i+6);
  const fitted=fit?fitEchoSkeletonSample(sub(Array.from(point),t.referenceOriginMm),normal,fit):null;
  out.set(bodyReferenceToWorld(fitted?add(t.referenceOriginMm,fitted.point):point,model),i);
  out.set(unit(rotate(fitted?fitted.normal:normal,t)),i+3);
 }
 const material=MATERIALS[source.name];
 return Object.freeze({id:`bodyparts3d-${source.name}`,vertices:out,...material,role:'surface',bounds:vertexBounds(out),referenceBounds:source.bounds,sourceElements:source.sourceElements,sourceTriangleCount:source.sourceTriangleCount,source:'BodyParts3D reference anatomy',patientRegistered:false});
}

/** A ray through reference (left, superior) intersects the actual anterior
 * skin triangle. `normal` is its outward WORLD direction; `bodyNormal` is the
 * outward reference direction. Null means no skin was found, with no fallback.
 */
export function sampleEchoBodySkin(model,leftMm,superiorMm){
 if(!Number.isFinite(leftMm)||!Number.isFinite(superiorMm))throw new TypeError('Skin sampling needs finite reference coordinates.');
 const vertices=model?.skinSurface?.referenceVertices;if(!vertices)return null;
 let best=null;
 for(let i=0;i<vertices.length;i+=18){
  const a=vertices.subarray(i,i+6),b=vertices.subarray(i+6,i+12),c=vertices.subarray(i+12,i+18);
  const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(det)<1e-9)continue;
  const u=((b[1]-c[1])*(leftMm-c[0])+(c[0]-b[0])*(superiorMm-c[1]))/det;
  const v=((c[1]-a[1])*(leftMm-c[0])+(a[0]-c[0])*(superiorMm-c[1]))/det,w=1-u-v;
  if(Math.min(u,v,w)<-1e-7)continue;
  const z=u*a[2]+v*b[2]+w*c[2],normal=unit([0,1,2].map(k=>u*a[k+3]+v*b[k+3]+w*c[k+3]));
  if(normal[2]<=.02||best&&z<=best.bodyPointMm[2])continue;
  const bodyPointMm=[leftMm,superiorMm,z];
  best={pointMm:bodyReferenceToWorld(bodyPointMm,model),bodyPointMm,normal:bodyReferenceDirectionToWorld(normal,model),bodyNormal:normal,triangleIndex:i/18,barycentric:[u,v,w],patientRegistered:false};
 }
 return best;
}

function clipSegment(a,b,box){
 let low=0,high=1;
 for(let axis=0;axis<3;axis++){
  const d=b[axis]-a[axis];
  if(Math.abs(d)<1e-10){if(a[axis]<box.min[axis]-1e-7||a[axis]>box.max[axis]+1e-7)return null;continue;}
  let enter=(box.min[axis]-a[axis])/d,leave=(box.max[axis]-a[axis])/d;
  if(enter>leave)[enter,leave]=[leave,enter];low=Math.max(low,enter);high=Math.min(high,leave);if(low>high)return null;
 }
 return [mix(a,b,low),mix(a,b,high)];
}

/** Exact intersection segments between the unchanged CT plane and the real
 * anterior skin. Input centerMm is WORLD MILLIMETRES, not normalized units.
 * Optional windowId clips segments to that fixed reference window. A caller
 * chooses among these segments; this function never revises a source plane.
 */
export function intersectEchoBodySkinPlane(model,{centerMm,normal},{windowId,frontOnly=true}={}){
 if(!finite3(centerMm)||!finite3(normal))throw new TypeError('Skin intersection needs a world-mm center and finite normal.');
 const n=unit(Array.from(normal)),surface=model?.skinSurface;if(!surface)return [];
 const spec=windowId?ECHO_BODY_WINDOWS[windowId]:null;if(windowId&&!spec)throw new TypeError('Unknown reference skin window.');
 const rv=surface.referenceVertices,segments=[],epsilon=1e-9*model.referenceMm;
 for(let i=0;i<rv.length;i+=18){
  const points=[0,6,12].map(j=>Array.from(rv.subarray(i+j,i+j+3))),world=points.map(p=>bodyReferenceToWorld(p,model));
  const bodyNormal=unit([0,1,2].map(k=>rv[i+3+k]+rv[i+9+k]+rv[i+15+k]));
  if(frontOnly&&bodyNormal[2]<=.02)continue;
  const distances=world.map(p=>dot(sub(p,centerMm),n));
  if(distances.every(d=>d>epsilon)||distances.every(d=>d<-epsilon))continue;
  const intersections=[];
  const addPoint=p=>{if(!intersections.some(q=>magnitude(sub(q,p))<1e-6))intersections.push(p);};
  for(let j=0;j<3;j++){
   const k=(j+1)%3,da=distances[j],db=distances[k];
   if(Math.abs(da)<=epsilon)addPoint(points[j]);
   if(da*db<0)addPoint(mix(points[j],points[k],da/(da-db)));
  }
  if(intersections.length<2)continue;
  const pairs=intersections.length===3?[[0,1],[1,2],[2,0]]:[[0,1]];
  for(const [a,b]of pairs){
   const clipped=spec?clipSegment(intersections[a],intersections[b],spec.referenceBounds):[intersections[a],intersections[b]];
   if(!clipped||magnitude(sub(clipped[1],clipped[0]))<1e-7)continue;
   segments.push({aMm:bodyReferenceToWorld(clipped[0],model),bMm:bodyReferenceToWorld(clipped[1],model),bodyA:clipped[0],bodyB:clipped[1],triangleIndex:i/18,bodyNormal,normal:bodyReferenceDirectionToWorld(bodyNormal,model)});
  }
 }
 return segments;
}

/** Upgrade only static contextual anatomy. TEE route/interior arrays keep
 * their original identity. TTE's schematic ribs and disk are replaced by the
 * verified torso and the existing double-domed, open-hiatus diaphragm.
 */
export function createEchoAnatomyContext({baseModel,referenceAnatomy,frames={},donorId,referenceMm}={}){
 if(!verifiedSources.has(referenceAnatomy))throw new TypeError('Use verified reference anatomy from load/decodeEchoReferenceAnatomy.');
 const frame=baseModel?.frame||createTeeContextFrame({frames,donorId,referenceMm});
 if(referenceMm!==undefined&&(!Number.isFinite(referenceMm)||referenceMm<=0||Math.abs(referenceMm-frame.referenceMm)>1e-7))throw new TypeError('Reference anatomy belongs to another physical scale.');
 if(donorId!==undefined&&donorIdentity(donorId)!==donorIdentity(frame.donorId))throw new TypeError('Reference anatomy belongs to another donor frame.');
 if(baseModel?.referenceAnatomy===referenceAnatomy)return baseModel;
 if(baseModel){const cached=upgradedModels.get(baseModel)?.get(referenceAnatomy);if(cached)return cached;}
 const bodyTransform=makeTransform(frame),skeletonFit=ECHO_SKELETON_FITS[donorIdentity(frame.donorId)]||null,shell={bodyTransform,skeletonFit,frame,referenceMm:frame.referenceMm};
 const isTee=!!baseModel?.tractSamples;
 const gi=isTee?baseModel:createTeeContextModel({frames,donorId:frame.donorId,referenceMm:frame.referenceMm,anatomicalFrame:frame});
 const bodyMeshes=referenceAnatomy.meshes.map(source=>transformMesh(source,shell));
 const sourceSkin=referenceAnatomy.meshes.find(m=>m.name==='skin'),skin=bodyMeshes.find(m=>m.id==='bodyparts3d-skin');
 const skinSurface=Object.freeze({vertices:skin.vertices,referenceVertices:sourceSkin.referenceVertices,vertexStride:6,triangleStride:18,triangleCount:skin.vertices.length/18,bounds:skin.bounds,referenceBounds:sourceSkin.bounds,sourceSha256:ECHO_REFERENCE_ANATOMY.compressedSha256,patientRegistered:false});
 shell.skinSurface=skinSurface;
 let retained,labels,contours,topology;
 if(isTee){
  retained=baseModel.meshes.filter(m=>!m.id.startsWith('bodyparts3d-'));
  labels=[...baseModel.labels];contours=baseModel.contours;topology=baseModel.topology;
 }else{
  const diaphragm=gi;
  const ids=new Set(['diaphragm','central-tendon','esophageal-hiatus','diaphragm-rim']);
  retained=diaphragm.meshes.filter(m=>ids.has(m.id));labels=diaphragm.labels.filter(l=>l.id==='diaphragm');
  contours=Object.freeze({hiatus:diaphragm.contours.hiatus,diaphragmRim:diaphragm.contours.diaphragmRim});
  topology=Object.freeze({diaphragm:diaphragm.topology.diaphragm});
 }
 for(const [id,text,point,priority]of [
  ['bodyparts3d-sternum','Sternum',[0,28,78],2],
  ['bodyparts3d-ribs','Rib cage',[108,20,47],3],
  ['bodyparts3d-spine','Thoracic spine',[0,45,-77],3],
 ])labels.push(Object.freeze({id,text,pointMm:frozenVector(skeletonReferenceToWorld(point,shell)),priority}));
 const bodyWindows=Object.fromEntries(Object.entries(ECHO_BODY_WINDOWS).map(([id,spec])=>{
  const contact=sampleEchoBodySkin(shell,...spec.anchorXY);
  return [id,Object.freeze({...spec,id,anchorMm:contact?frozenVector(contact.pointMm):null,referenceAnchorMm:contact?frozenVector(contact.bodyPointMm):null,anchorTriangleIndex:contact?.triangleIndex??null})];
 }));
 // Cameras can focus on the cardiac/window region while the remaining thorax
 // continues naturally beyond the view. Arms and abdomen are not fit targets.
 const focusReferenceBounds=Object.freeze({min:frozenVector([-67,-88,-65]),max:frozenVector([116,119,111])});
 const focusPoints=boxCorners(focusReferenceBounds).map(p=>bodyReferenceToWorld(p,shell));
 focusPoints.push(...Object.values(frame.landmarksMm||{}));
 const focusBounds=pointBounds(focusPoints),meshes=Object.freeze([...retained,...bodyMeshes]);
 const bounds=pointBounds(meshes.flatMap(m=>[m.bounds.min,m.bounds.max]));
 const model=Object.freeze({
  ...baseModel,revision:ECHO_ANATOMY_CONTEXT_REVISION,frame,referenceMm:frame.referenceMm,bodyTransform,referenceAnatomy,skinSurface,bodyWindows:Object.freeze(bodyWindows),
  meshes,labels:Object.freeze(labels),contours,topology,bounds,focusBounds,focusReferenceBounds,focusPointsMm:Object.freeze(focusPoints.map(frozenVector)),skeletonFit,
  camera:Object.freeze({...baseModel?.camera,preferredAway:baseModel?.camera?.preferredAway||unit(add(mul(frame.anterior,.96),mul(frame.left,.29)))}),
  provenance:Object.freeze({...baseModel?.provenance,kind:'BodyParts3D thorax with illustrative surrounding organs',segmentedFromDonor:false,patientRegistered:false,orientation:frame.kind,source:ECHO_REFERENCE_ANATOMY.sourceUrl,license:'CC BY 4.0',licenseUrl:ECHO_REFERENCE_ANATOMY.licenseUrl,attribution:ECHO_REFERENCE_ANATOMY.attribution,sourceHash:ECHO_REFERENCE_ANATOMY.compressedSha256,decodedHash:ECHO_REFERENCE_ANATOMY.decodedSha256,transform:bodyTransform.method,referenceHeartDisplayed:false,presentation:'Reference skin and thoracic bones are cropped for context. The accepted heart and cut face take display priority over foreground and rear context.'+(skeletonFit?' One fixed smooth fit adjusts only the intact reference skeleton; every bone triangle is retained and the skin, GI tract and source heart stay fixed.':''),skeletonFit,limitations:'The fixed specimen has no acquired body. Reference anatomy, body axes and probe contact windows are illustrative; no clinical registration is claimed.'}),
 });
 if(baseModel){let cache=upgradedModels.get(baseModel);if(!cache){cache=new WeakMap();upgradedModels.set(baseModel,cache);}cache.set(referenceAnatomy,model);}
 return model;
}

export async function loadEchoAnatomyContext(options={}){
 const referenceAnatomy=options.referenceAnatomy||await loadEchoReferenceAnatomy(options);
 aborted(options.signal);
 return createEchoAnatomyContext({...options,referenceAnatomy});
}
