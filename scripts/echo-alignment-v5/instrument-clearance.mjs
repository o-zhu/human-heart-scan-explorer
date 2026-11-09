/** Independent geometric clearance of rendered TEE head vertices and shaft
 * centerline against the unchanged illustrative GI surface. The two open ends
 * are capped ONLY for the inside/outside parity query, not for wall distance.
 * This is a mesh-level illustration audit, not clinical collision validation.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {closestPointOnTriangle} from './surface-checks.mjs';
const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]),scale=(a,s)=>a.map(x=>x*s);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),norm=a=>Math.hypot(...a),unit=a=>scale(a,1/norm(a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const key=p=>p.map(v=>v.toFixed(6)).join(',');
const bounds=triangles=>({min:[0,1,2].map(i=>Math.min(...triangles.map(t=>t.min[i]))),max:[0,1,2].map(i=>Math.max(...triangles.map(t=>t.max[i])))});
const triangle=(a,b,c,cap=false)=>({a,b,c,e1:sub(b,a),e2:sub(c,a),min:a.map((x,i)=>Math.min(x,b[i],c[i])),max:a.map((x,i)=>Math.max(x,b[i],c[i])),center:a.map((x,i)=>(x+b[i]+c[i])/3),cap});
function bvh(triangles){
 const box=bounds(triangles);if(triangles.length<=12)return {...box,triangles};
 const sizes=box.max.map((x,i)=>x-box.min[i]),axis=sizes.indexOf(Math.max(...sizes));
 const sorted=[...triangles].sort((a,b)=>a.center[axis]-b.center[axis]),mid=Math.floor(sorted.length/2);
 return {...box,left:bvh(sorted.slice(0,mid)),right:bvh(sorted.slice(mid))};
}
function boxDistance2(p,b){let s=0;for(let i=0;i<3;i++){const d=Math.max(0,b.min[i]-p[i],p[i]-b.max[i]);s+=d*d;}return s;}
function nearestWall(p,tree){
 let best2=Infinity,best=null;const stack=[tree];
 while(stack.length){const node=stack.pop();if(boxDistance2(p,node)>=best2)continue;
  if(node.triangles){for(const t of node.triangles){const hit=closestPointOnTriangle(p,t.a,t.b,t.c),d2=dot(sub(p,hit.point),sub(p,hit.point));if(d2<best2){best2=d2;best=hit.point;}}}
  else{const a=boxDistance2(p,node.left),b=boxDistance2(p,node.right);if(a<b)stack.push(node.right,node.left);else stack.push(node.left,node.right);}
 }
 return {distanceMm:Math.sqrt(best2),pointMm:best};
}
function rayBox(p,d,b){let low=0,high=Infinity;for(let i=0;i<3;i++){let a=(b.min[i]-p[i])/d[i],c=(b.max[i]-p[i])/d[i];if(a>c)[a,c]=[c,a];low=Math.max(low,a);high=Math.min(high,c);if(low>high)return false;}return true;}
function rayTriangle(p,d,t){
 const h=cross(d,t.e2),det=dot(t.e1,h);if(Math.abs(det)<1e-11)return null;
 const s=sub(p,t.a),u=dot(s,h)/det;if(u< -1e-10||u>1+1e-10)return null;
 const q=cross(s,t.e1),v=dot(d,q)/det;if(v< -1e-10||u+v>1+1e-10)return null;
 const at=dot(t.e2,q)/det;return at>1e-7?at:null;
}
const rays=[[.731,.424,.534],[-.641,.673,.368],[.319,-.583,.747]].map(unit);
function parity(p,d,tree){
 const hits=[],stack=[tree];while(stack.length){const node=stack.pop();if(!rayBox(p,d,node))continue;
  if(node.triangles){for(const t of node.triangles){const at=rayTriangle(p,d,t);if(at!==null)hits.push(at);}}
  else stack.push(node.left,node.right);
 }
 hits.sort((a,b)=>a-b);let unique=0,last=-Infinity;for(const t of hits)if(t-last>1e-5){unique++;last=t;}
 return unique%2===1;
}
function classify(p,solid,wall){
 const nearest=nearestWall(p,wall);if(nearest.distanceMm<1e-4)return {inside:true,boundary:true,distanceMm:nearest.distanceMm};
 const votes=rays.map(d=>parity(p,d,solid)),inside=votes.filter(Boolean).length>=2;
 return {inside,ambiguous:votes.some(v=>v!==votes[0]),distanceMm:nearest.distanceMm,closestWallMm:nearest.pointMm};
}
function makeSolid(model){
 const g=model.topology.gastrointestinal,points=Array.from({length:g.positionsMm.length/3},(_,i)=>Array.from(g.positionsMm.subarray(i*3,i*3+3)));
 const triangles=Array.from({length:g.indices.length/3},(_,i)=>triangle(...Array.from(g.indices.subarray(i*3,i*3+3),n=>points[n])));
 const caps=[];
 for(const offset of [0,(g.rings-1)*g.segments]){
  const ring=points.slice(offset,offset+g.segments),center=scale(ring.reduce(add,[0,0,0]),1/ring.length);
  for(let i=0;i<ring.length;i++)caps.push(triangle(center,ring[i],ring[(i+1)%ring.length],true));
 }
 return {wall:bvh(triangles),solid:bvh([...triangles,...caps]),triangleCount:triangles.length};
}
const args=process.argv.slice(2),arg=k=>{const i=args.indexOf(k);return i<0?null:args[i+1];};
const repo=resolve(arg('--repo')||process.cwd()),input=resolve(arg('--input')||'docs/echo-alignment-v5/current.json');
const report=JSON.parse(await readFile(input,'utf8'));
const verifiedSourceFiles=['public/tee-context-geometry.js','public/probe-scene.js'],observedHashes={};
for(const file of verifiedSourceFiles){observedHashes[file]=createHash('sha256').update(await readFile(join(repo,file))).digest('hex');if(report.sourceHashes[file]&&observedHashes[file]!==report.sourceHashes[file])throw new Error(`Instrument audit source differs from accepted-pose export: ${file}`);}
const load=p=>import(pathToFileURL(join(repo,p)).href);
const [{createTeeContextModel},{createProbeMeshes}]=await Promise.all([load('public/tee-context-geometry.js'),load('public/probe-scene.js')]);
const localUnique=new Map();
for(const mesh of createProbeMeshes('tee').filter((_,i)=>i!==2))for(let i=0;i<mesh.vertices.length;i+=6){const p=Array.from(mesh.vertices.subarray(i,i+3));localUnique.set(key(p),p);}
const localHead=[...localUnique.values()],rows=[];
const donors=args.includes('--all-donors')?report.models:report.models.filter(m=>m.donor==='ladaf-2021-17');
for(const source of donors){
 const file=source.donor==='ladaf-2021-17'?'public/assets/echo-planes.json':`public/assets/donors/${source.donor}/echo-planes.json`,raw=JSON.parse(await readFile(join(repo,file),'utf8'));
 const frames=Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,f.world]));
 const model=createTeeContextModel({frames,referenceMm:source.referenceMm,donorId:source.tee.donorId}),solid=makeSolid(model);
 for(const row of report.rows.filter(r=>r.donor===source.donor&&r.mode==='tee'&&r.planeReference==='refined'&&r.adjustment==='baseline')){
  const p=row.plane.acquisitionPose;
  if(!p?.shaftPoints){rows.push({donor:source.donor,id:row.id,unavailable:true,reason:row.plane.acquisition?.reason||'No accepted instrument pose'});continue;}
  const probeScale=.60*model.frame.scale,head=localHead.map(q=>add(p.originMm,scale(add(add(scale(p.instrument.right,q[0]),scale(p.instrument.normal,q[1])),scale(p.beam,-q[2])),probeScale)));
  const headChecks=head.map(pointMm=>({pointMm,...classify(pointMm,solid.solid,solid.wall)}));
  const shaftChecks=p.shaftPoints.map((pointMm,i)=>({pointMm,index:i,...classify(pointMm,solid.solid,solid.wall)}));
  // The shaft begins exactly at the uncapped upper entry; do not call that
  // deliberately open boundary an organ-wall violation.
  const testedShaft=shaftChecks.slice(1),outsideHead=headChecks.filter(q=>!q.inside),outsideShaft=testedShaft.filter(q=>!q.inside);
  const minShaftClearance=Math.min(...testedShaft.filter(q=>q.inside).map(q=>q.distanceMm));
  rows.push({donor:source.donor,id:row.id,level:p.contextFit.level,shaftBendDeg:p.contextFit.shaftBendDeg,headVertices:head.length,
   headOutsideVertices:outsideHead.length,headAmbiguousVotes:headChecks.filter(q=>q.ambiguous).length,
   worstHeadOutsideMm:Math.max(0,...outsideHead.map(q=>q.distanceMm)),worstHeadOutside:outsideHead.toSorted((a,b)=>b.distanceMm-a.distanceMm).slice(0,3),
   shaftPoints:testedShaft.length,shaftOutsidePoints:outsideShaft.length,shaftAmbiguousVotes:testedShaft.filter(q=>q.ambiguous).length,
   worstShaftOutsideMm:Math.max(0,...outsideShaft.map(q=>q.distanceMm)),minimumShaftCenterlineClearanceMm:minShaftClearance,
   drawnShaftRadiusMm:1.8*model.frame.scale,shaftClearanceBelowRadius:testedShaft.filter(q=>q.inside&&q.distanceMm<1.8*model.frame.scale-1e-3).length,
   worstShaftOutside:outsideShaft.toSorted((a,b)=>b.distanceMm-a.distanceMm).slice(0,3),
   headCenter:classify(p.contextFit.headCenterMm,solid.solid,solid.wall),sourceTriangleCount:solid.triangleCount,patientRegistered:false});
 }
}
const out=resolve(arg('--out')||'docs/echo-alignment-v5/instrument-clearance');await mkdir(dirname(out),{recursive:true});
await writeFile(out+'.json',JSON.stringify({schemaVersion:1,sourceHashes:report.sourceHashes,method:'Independent three-ray majority parity in GI mesh capped only for inside query; exact triangle distance to original open wall; actual rendered head vertices and shaft centerline. Discrete geometric audit, not clinical validation.',rows},null,2)+'\n');
const lines=['# TEE instrument versus fixed organ surface','', '| Donor | View | Bend (°) | Head vertices outside | Worst head protrusion (mm) | Shaft center points outside | Minimum shaft clearance (mm) |', '|---|---|---:|---:|---:|---:|---:|'];
for(const r of rows)lines.push(r.unavailable?`| ${r.donor} | ${r.id} | — | unavailable | — | — | — |`:`| ${r.donor} | ${r.id} | ${r.shaftBendDeg.toFixed(1)} | ${r.headOutsideVertices}/${r.headVertices} | ${r.worstHeadOutsideMm.toFixed(3)} | ${r.shaftOutsidePoints}/${r.shaftPoints} | ${r.minimumShaftCenterlineClearanceMm.toFixed(3)} |`);
await writeFile(out+'.md',lines.join('\n')+'\n');
console.log(JSON.stringify({output:out,cases:rows.length,unavailable:rows.filter(r=>r.unavailable).map(r=>r.id),headProtrusionCases:rows.filter(r=>r.headOutsideVertices).map(r=>({id:r.id,mm:r.worstHeadOutsideMm})),shaftProtrusionCases:rows.filter(r=>r.shaftOutsidePoints).map(r=>({id:r.id,mm:r.worstShaftOutsideMm})),shaftRadiusConflicts:rows.filter(r=>r.shaftClearanceBelowRadius).map(r=>r.id),ambiguousVotes:rows.reduce((s,r)=>s+(r.headAmbiguousVotes||0)+(r.shaftAmbiguousVotes||0),0)},null,2));
for(const file of verifiedSourceFiles)if(createHash('sha256').update(await readFile(join(repo,file))).digest('hex')!==observedHashes[file])throw new Error(`Instrument source changed during audit: ${file}`);
if(args.includes('--strict')&&rows.some(r=>r.unavailable||r.headOutsideVertices||r.shaftOutsidePoints||r.shaftClearanceBelowRadius))process.exitCode=1;
