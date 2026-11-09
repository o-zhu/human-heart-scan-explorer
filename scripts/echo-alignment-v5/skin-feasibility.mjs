/** Evaluate frozen CT planes against the new fixed, verified reference skin.
 * Intersection candidates use the anatomy module; contact residuals are
 * checked independently against its actual drawable triangle positions.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {minimumCenterPreservingCorrection} from './audit.mjs';
import {evaluateSkinContact} from './surface-checks.mjs';

const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>Math.hypot(...a);
const nearest=(p,a,b)=>{const d=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(p,a),d)/dot(d,d)));return add(a,mul(d,t));};
const args=process.argv.slice(2),arg=k=>{const i=args.indexOf(k);return i<0?null:args[i+1];};
const repo=resolve(arg('--repo')||process.cwd()),input=resolve(arg('--input')||'docs/echo-alignment-v5/baseline.json');
const report=JSON.parse(await readFile(input,'utf8')),load=async(root,file)=>import(pathToFileURL(join(root,file)).href);
const anatomy=await load(repo,'public/echo-anatomy-context-v2.js');
const referenceAnatomy=await anatomy.decodeEchoReferenceAnatomy({
 manifestBytes:await readFile(join(repo,'public/assets/probe-context-v11/manifest.json')),
 compressedBytes:await readFile(join(repo,'public/assets/probe-context-v11/torso.bin.gz'))});
const tte=await load(report.repo,'public/tte-atlas-geometry.js');
const {TTE_ATLAS_VIEWS}=await load(report.repo,'public/tte-atlas-data.js');
const rows=[];
for(const source of report.models){
 const primary=source.donor==='ladaf-2021-17',file=primary?'public/assets/echo-planes.json':`public/assets/donors/${source.donor}/echo-planes.json`;
 const raw=JSON.parse(await readFile(join(report.repo,file),'utf8'));
 const frames=Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,f.world]));
 const model=anatomy.createEchoAnatomyContext({baseModel:tte.createTteContextModel({frames,referenceMm:source.referenceMm,donorId:source.tte.donorId}),referenceAnatomy,frames});
 for(const row of report.rows.filter(r=>r.donor===source.donor&&r.mode==='tte'&&r.planeReference==='refined'&&r.adjustment==='baseline')){
  const view=TTE_ATLAS_VIEWS.find(v=>v.id===row.id),window=model.bodyWindows[view.group],anchor=window.anchorMm;
  const intersections=row.metrics.ctComparisonApplicable?anatomy.intersectEchoBodySkinPlane(model,{centerMm:mul(row.plane.center,source.referenceMm),normal:row.plane.normal},{windowId:view.group,frontOnly:true}):[];
  const candidates=intersections.map(segment=>{const pointMm=nearest(anchor,segment.aMm,segment.bMm);return {pointMm,bodyPointMm:anatomy.worldToBodyReference(pointMm,model),distanceFromAnchorMm:norm(sub(pointMm,anchor)),triangleIndex:segment.triangleIndex};}).sort((a,b)=>a.distanceFromAnchorMm-b.distanceFromAnchorMm);
  const best=candidates[0]||null;
  const candidateContact=best?evaluateSkinContact({...row.pose,originMm:best.pointMm},model,view.group):null;
  rows.push({donor:source.donor,id:row.id,window:view.group,outsideScan:row.metrics.outsideScan,
   anchorMm:anchor,anchorCorrection:minimumCenterPreservingCorrection(row.plane,anchor,source.referenceMm),
   segmentCount:intersections.length,nearestIntersection:best,candidateContact,
   oldOriginContact:evaluateSkinContact(row.pose,model,view.group)});
 }
}
const out=resolve(arg('--out')||'docs/echo-alignment-v5/skin-feasibility');await mkdir(dirname(out),{recursive:true});
await writeFile(out+'.json',JSON.stringify({schemaVersion:1,baselineInput:input,baselineInputSha256:createHash('sha256').update(await readFile(input)).digest('hex'),anatomySourceSha256:anatomy.ECHO_REFERENCE_ANATOMY.compressedSha256,patientRegistered:false,rows},null,2)+'\n');
const lines=['# Frozen CT planes versus fixed reference skin','',
 'The reference skin has one donor-specific fixed similarity transform. These are illustrative acoustic windows, not clinically registered positions. A missing intersection means the frozen plane cannot share the specified skin patch without changing the plane or window.',
 '', '| Donor | View | Skin / original plane segments | Nearest contact shift from window anchor (mm) | Minimum rotation through anchor (°) | Old origin distance to anterior skin (mm) |',
 '|---|---|---:|---:|---:|---:|'];
for(const r of rows)lines.push(`| ${r.donor} | ${r.id} | ${r.outsideScan?'outside scan':r.segmentCount} | ${r.nearestIntersection?.distanceFromAnchorMm.toFixed(2)??'—'} | ${r.outsideScan?'—':r.anchorCorrection.angleDeg.toFixed(2)} | ${r.oldOriginContact.frontSurfaceDistanceMm?.toFixed(2)??'—'} |`);
await writeFile(out+'.md',lines.join('\n')+'\n');
console.log(JSON.stringify({output:out,rows:rows.length,summary:report.models.map(d=>{const rs=rows.filter(r=>r.donor===d.donor&&!r.outsideScan);return {donor:d.donor,acquired:rs.length,noWindowIntersection:rs.filter(r=>!r.segmentCount).map(r=>r.id)};})},null,2));
