/** Independent whole-cut coverage audit for all Echo donor/preset combinations.
 * Production chooses the full-face raster with box-edge intersections. This
 * audit instead clips a 2D polygon against six source half-spaces, then checks
 * every resulting vertex in the returned raster. It never edits source data.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fullEchoCutFacePlane} from '../../public/echo-cut-face.js';
import {planFinePlane} from '../../public/ultra-volume-core.js';
import {FineSectionStore} from '../../public/fine-section-store.js';
import {DONORS,ALL_SOURCES} from '../../public/donors.js';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p));
const physical=p=>Object.fromEntries(['center','right','up','normal','width','height'].map(k=>[k,p[k]]));

export function clipPolygon(poly,a,b,c){
 const result=[];
 if(!poly.length)return result;
 for(let i=0;i<poly.length;i++){
  const p=poly[i],q=poly[(i+1)%poly.length],d=a*p[0]+b*p[1]-c,e=a*q[0]+b*q[1]-c;
  const inside=d<=1e-12,next=e<=1e-12;
  if(inside)result.push(p);
  if(inside!==next){const t=d/(d-e);result.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
 }
 return result;
}

export function sourcePolygon(plane,extent){
 let poly=[[-8,-8],[8,-8],[8,8],[-8,8]];
 for(let axis=0;axis<3;axis++)for(const sign of [-1,1])
  poly=clipPolygon(poly,sign*plane.right[axis],sign*plane.up[axis],extent[axis]/2-sign*plane.center[axis]);
 return poly;
}

const world=(p,uv)=>p.center.map((v,i)=>v+p.right[i]*uv[0]+p.up[i]*uv[1]);
const rectangleCoords=(p,v)=>[dot(sub(v,p.center),p.right),dot(sub(v,p.center),p.up)];
const area=poly=>Math.abs(poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length];return s+p[0]*q[1]-p[1]*q[0];},0))/2;
function cropArea(poly,p){
 for(const [a,b,c] of [[1,0,p.width/2],[-1,0,p.width/2],[0,1,p.height/2],[0,-1,p.height/2]])poly=clipPolygon(poly,a,b,c);
 return area(poly);
}

export async function auditCoverage({input,baseline=null,output=null}={}){
 const rows=[],sources=[],keys=new Map();
 for(const donor of DONORS){
  const path=join(input,donor.id,'review.json'),exported=await json(path);
  assert.equal(exported.donor,donor.id);assert.equal(exported.cases.length,56);
  const before=baseline?await json(join(baseline,donor.id,'review.json')):null;
  const oldRows=before?new Map(before.cases.map(c=>[c.mode+'/'+c.id,c])):null;
  const sourcePath=join(ROOT,'public',donor.manifestUrl.slice(2)),manifest=await json(sourcePath);
  const finePath=join(ROOT,'public',donor.ultraVolumeManifestUrl.slice(2)),fineBytes=await readFile(finePath),fine=JSON.parse(fineBytes);
  const millimeters=Math.max(...manifest.sourceScaleCenterExtentUm)/1000;
  const extent=[manifest.sourceScaleCenterExtentUm[0],manifest.sourceScaleCenterExtentUm[2],manifest.sourceScaleCenterExtentUm[1]].map(v=>v/(millimeters*1000));
  const store=new FineSectionStore(fine,{baseUrl:'https://heart-explorer.invalid/ultra-volume-worker.js',cacheStorage:null});
  const identity=await store.identity();sources.push({donor:donor.id,sourceIdentity:identity,sourceManifestSha256:sha(await readFile(sourcePath)),fineManifestSha256:sha(fineBytes),fineSpacingUm:fine.sourceSpacingUm,extent,exportSha256:sha(await readFile(path)),baselineExportSha256:baseline?sha(await readFile(join(baseline,donor.id,'review.json'))):null});
  for(const c of exported.cases){
   const key=donor.id+'/'+c.mode+'/'+c.id,p=c.plane,pBefore=JSON.stringify(physical(p));
   if(oldRows){const old=oldRows.get(c.mode+'/'+c.id);assert.ok(old,key);assert.deepEqual(physical(p),physical(old.plane),'Accepted CT ROI/plane changed: '+key);assert.equal(c.clipFlip,old.clipFlip,'Retained half changed: '+key);assert.deepEqual(c.cameras,old.cameras,'Camera changed: '+key);}
   if(c.outsideScan){rows.push({donor:donor.id,id:c.id,mode:c.mode,outsideScan:true,pass:true,reason:'Target absent from acquired coverage; no CT cap.'});continue;}
   const poly=sourcePolygon(p,extent),vertices=poly.map(uv=>world(p,uv));assert.ok(vertices.length>=3,key);
   const cap=fullEchoCutFacePlane(p,extent,{paddingWorld:2*donor.fineSpacingUm/(millimeters*1000)});
   if(c.capPlane||baseline)assert.deepEqual(physical(c.capPlane),physical(cap),'Exported/native cap differs from current production full face: '+key);
   assert.equal(JSON.stringify(physical(p)),pBefore,'Input plane mutated: '+key);
   const n=cross(p.right,p.up),offset=Math.abs(dot(sub(cap.center,p.center),n));assert.ok(offset<1e-9,'Physical plane moved: '+key);
   assert.deepEqual(cap.right,p.right);assert.deepEqual(cap.up,p.up);assert.deepEqual(cap.normal,p.normal);
   const margins=vertices.map(v=>{const uv=rectangleCoords(cap,v);return [cap.width/2-Math.abs(uv[0]),cap.height/2-Math.abs(uv[1])];}).flat();
   const minimumMargin=Math.min(...margins);assert.ok(minimumMargin>=-1e-9,'Uncovered source-plane polygon: '+key);
   const plan=planFinePlane(fine,cap,{spacingUm:donor.fineSpacingUm});
   assert.ok(plan.width*plan.height<=12*1024*1024,'Raster exceeds memory ceiling: '+key);
   const roiPlan=planFinePlane(fine,p,{spacingUm:donor.fineSpacingUm});
   const descriptor=await store.descriptor(cap,plan),roiDescriptor=await store.descriptor(p,roiPlan);
   if(cap!==p)assert.notEqual(descriptor.key,roiDescriptor.key,'Full cut reused ROI-only pixels: '+key);
   const owner=keys.get(descriptor.key);assert.ok(!owner||owner.donor===donor.id,'Cross-donor section key collision: '+key);
   keys.set(descriptor.key,{donor:donor.id,id:c.id});
   const coveredArea=cropArea(poly,p),sourceArea=area(poly),blockBytes=plan.blocks.reduce((s,b)=>s+(fine.blocks[b.id]?.bytes||0),0);
   rows.push({donor:donor.id,id:c.id,mode:c.mode,outsideScan:false,pass:true,
    sourcePlaneSha256:sha(pBefore),inputPlaneUnchanged:true,roiUnchanged:true,clipFlip:c.clipFlip,
    expanded:cap!==p,sourcePolygonVertices:vertices.length,sourceBoxArea:sourceArea,roiCoveredSourceBoxFraction:coveredArea/sourceArea,
    fullCapPlane:physical(cap),maximumPlaneResidualWorld:offset,minimumSourcePolygonMarginWorld:minimumMargin,
    fineSourceSpacingUm:fine.sourceSpacingUm,fullRaster:[plan.width,plan.height],fullRasterBytes:plan.width*plan.height,
    roiRaster:[roiPlan.width,roiPlan.height],roiRasterBytes:roiPlan.width*roiPlan.height,combinedRasterBytes:plan.width*plan.height+roiPlan.width*roiPlan.height,
    requestedFineBlocks:plan.blocks.length,requestedEncodedFineBytes:blockBytes,sourceIdentity:identity,roiCacheKey:roiDescriptor.key,fullFaceCacheKey:descriptor.key});
  }
 }
 assert.equal(rows.length,168);assert.equal(new Set(sources.map(s=>s.sourceIdentity)).size,3);
 const acquired=rows.filter(r=>!r.outsideScan),max=acquired.reduce((a,b)=>b.fullRasterBytes>a.fullRasterBytes?b:a),pair=acquired.reduce((a,b)=>b.combinedRasterBytes>a.combinedRasterBytes?b:a);
 const byDonor=DONORS.map(d=>{const a=acquired.filter(r=>r.donor===d.id);return {donor:d.id,views:56,acquired:a.length,outside:56-a.length,expanded:a.filter(r=>r.expanded).length,maximumRasterBytes:Math.max(...a.map(r=>r.fullRasterBytes)),maximumPlaneResidualWorld:Math.max(...a.map(r=>r.maximumPlaneResidualWorld))};});
 const report={schemaVersion:1,createdAt:new Date().toISOString(),passed:true,
  scope:'All supported Echo presets: independent half-space coverage of the production full-face crop; exact accepted physical plane, CT ROI, camera and retained-half preservation; planned native fine grids and donor-key isolation. Fine grid planning does not claim fine-bank download or native-resolution rendering.',
  sourceSampling:'Actual sampled/rendered resident CT is recorded separately; these fine raster dimensions are source-metadata plans.',
  totalViews:168,acquiredViews:acquired.length,outsideViews:rows.length-acquired.length,expandedViews:acquired.filter(r=>r.expanded).length,
  maxFullRasterBytes:max.fullRasterBytes,maxFullRaster:{donor:max.donor,id:max.id,dimensions:max.fullRaster},maximumFullRasterDimension:Math.max(...acquired.flatMap(r=>r.fullRaster)),rasterCeilingBytes:12*1024*1024,
  maximumCombinedRoiAndFullFaceBytes:pair.combinedRasterBytes,largestCombined:{donor:pair.donor,id:pair.id,fullFaceBytes:pair.fullRasterBytes,roiBytes:pair.roiRasterBytes},
  excludes:ALL_SOURCES.filter(s=>!DONORS.some(d=>d.id===s.id)).map(s=>({id:s.id,reason:'Separate clinical viewer; no Echo TTE/TEE preset workspace.'})),
  byDonor,sources,rows};
 if(output){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');}
 return report;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const option=(key,fallback)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)||fallback;
 const report=await auditCoverage({input:resolve(option('input','/dev/shm/echo-face-v42')),baseline:option('baseline',null),output:resolve(option('output','docs/echo-face-v42/coverage.json'))});
 console.log(JSON.stringify({passed:report.passed,totalViews:report.totalViews,acquired:report.acquiredViews,outside:report.outsideViews,expanded:report.expandedViews,maxFullRasterBytes:report.maxFullRasterBytes,maxFullRaster:report.maxFullRaster,byDonor:report.byDonor}));
}
