/** Reproduce the three reported v73 cap crops from unchanged accepted planes.
 * The complete same-plane section is an independent diagnostic rectangle fitted
 * to the volume-box intersection, not a replacement clinical ROI or new plane.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createContext,runInContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {DONORS} from '../../public/donors.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const input=resolve(process.argv[2]);
const out=join(input,'targeted');await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const reviewBytes=await readFile(join(input,'review.json')),review=JSON.parse(reviewBytes);
const manifestBytes=await readFile(join(root,review.sourceManifest));
if(sha(manifestBytes)!==review.sourceHashes[review.sourceManifest])throw new Error('Source manifest changed.');
const manifest=JSON.parse(manifestBytes),level=manifest.levels.high;
const donor=DONORS.find(d=>d.id===review.donor);
const publicPath=url=>join(root,'public',url.replace(/^\.\//,'').split('?')[0]);
const cleanup=await json(publicPath(donor.cleanupManifestUrl));
const cleanupBytes=gunzipSync(await readFile(publicPath(cleanup.volumeUrl)));
const [nx,ny,nz]=level.dimensions,data=new Uint8Array(nx*ny*nz);
const verifiedParts=[];
for(const part of level.parts){
 const packed=await readFile(publicPath(part.url)),decoded=gunzipSync(packed);
 if(sha(packed)!==part.sha256)throw new Error('Source transport hash mismatch.');
 const start=part.zRange[0],count=part.zRange[1]-start,a=new Uint8Array(decoded);
 if(part.predictor==='delta-z'){
  for(let z=1;z<count;z++)for(let i=0;i<nx*ny;i++)a[z*nx*ny+i]=(a[z*nx*ny+i]+a[(z-1)*nx*ny+i])&255;
 }else if(part.predictor==='delta-x'){
  for(let i=0;i<a.length;i++)if(i%nx)a[i]=(a[i]+a[i-1])&255;
 }else if(part.predictor)throw new Error(`Unsupported predictor ${part.predictor}`);
 if(sha(a)!==part.rawSha256)throw new Error('Source voxel hash mismatch.');
 data.set(a,start*nx*ny);verifiedParts.push({url:part.url,sha256:part.sha256,rawSha256:part.rawSha256});
}
const physical=manifest.sourceScaleCenterExtentUm,referenceUm=Math.max(...physical);
const extent=[physical[0]/referenceUm,physical[2]/referenceUm,physical[1]/referenceUm];
const worker=await readFile(join(root,'public/mpr-worker.js'));
if(sha(worker)!==review.sourceHashes['public/mpr-worker.js'])throw new Error('MPR worker changed.');
let result=null;
const context=createContext({Uint8Array,Math,onmessage:null,postMessage(value){result=value;}});
runInContext(worker.toString(),context,{filename:'public/mpr-worker.js'});
context.onmessage({data:{type:'load',data,dimensions:level.dimensions,extent}});
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,n)=>a.map(v=>v*n);
function completePlane(p){
 const corners=Array.from({length:8},(_,i)=>extent.map((e,j)=>((i>>j&1)-.5)*e));
 const points=[];
 for(let i=0;i<8;i++)for(let axis=0;axis<3;axis++){
  const j=i^(1<<axis);if(j<=i)continue;
  const a=corners[i],b=corners[j],da=dot(sub(a,p.center),p.normal),db=dot(sub(b,p.center),p.normal);
  if(Math.abs(da)<1e-12)points.push(a);if(Math.abs(db)<1e-12)points.push(b);
  if(da*db<0)points.push(add(a,mul(sub(b,a),da/(da-db))));
 }
 if(points.length<3)throw new Error('Expected acquired plane intersection.');
 const uv=points.map(q=>[dot(sub(q,p.center),p.right),dot(sub(q,p.center),p.up)]);
 const lo=[0,1].map(k=>Math.min(...uv.map(q=>q[k]))),hi=[0,1].map(k=>Math.max(...uv.map(q=>q[k])));
 return {center:add(p.center,add(mul(p.right,(lo[0]+hi[0])/2),mul(p.up,(lo[1]+hi[1])/2))),
  right:p.right,up:p.up,normal:p.normal,width:hi[0]-lo[0],height:hi[1]-lo[1]};
}
const supported=p=>{
 const t=[p[0]/extent[0]+.5,.5-p[2]/extent[2],p[1]/extent[1]+.5];
 const q=t.map((v,i)=>Math.round(Math.max(0,Math.min(1,v))*(cleanup.dimensions[i]-1)));
 return cleanupBytes[q[0]+cleanup.dimensions[0]*(q[1]+cleanup.dimensions[1]*q[2])]>=128;
};
async function sample(id,plane,suffix){
 const width=Math.ceil(plane.width*referenceUm/manifest.sourceScaleSpacingUm)+1;
 const height=Math.ceil(plane.height*referenceUm/manifest.sourceScaleSpacingUm)+1;
 context.onmessage({data:{type:'sample',id,plane,width,height}});
 if(result?.id!==id||result.data.length!==width*height)throw new Error('MPR result missing.');
 const pixels=Buffer.from(result.data),file=`${id}-${suffix}.raw`;
 await writeFile(join(out,file),pixels);
 return {file,width,height,plane,sha256:sha(pixels),pixels};
}
const rows=[];
for(const id of ['plax_av','plax_mv','psax_pv']){
 const c=review.cases.find(v=>v.id===id),crop=await sample(id,c.plane,'roi'),full=await sample(id,completePlane(c.plane),'complete');
 const thresholds=[.18,.28],counts=thresholds.map(threshold=>({threshold,tissue:0,missing:0}));
 for(let y=0;y<full.height;y++)for(let x=0;x<full.width;x++){
  const p=add(full.plane.center,add(mul(full.plane.right,(x/(full.width-1)-.5)*full.plane.width),mul(full.plane.up,(.5-y/(full.height-1))*full.plane.height)));
  if(!supported(p))continue;
  const q=sub(p,c.plane.center),outside=Math.abs(dot(q,c.plane.right))>c.plane.width/2||Math.abs(dot(q,c.plane.up))>c.plane.height/2;
  for(const count of counts)if(full.pixels[x+y*full.width]/255>count.threshold){count.tissue++;if(outside)count.missing++;}
 }
 const row={id,name:c.name,roiWidthMm:c.plane.width*review.referenceMm,roiHeightMm:c.plane.height*review.referenceMm,
  thresholdCoverage:counts.map(({threshold,tissue,missing})=>({threshold,supportedTissueSamples:tissue,unsupportedByOldCap:missing,missingCapFraction:missing/tissue})),
  planeResidualMm:Math.abs(dot(sub(full.plane.center,c.plane.center),c.plane.normal))*review.referenceMm,
  crop:{...crop,pixels:undefined},complete:{...full,pixels:undefined},camera:c.cameras.probe,clipFlip:c.clipFlip};
 rows.push(row);console.log(JSON.stringify({id,thresholdCoverage:row.thresholdCoverage}));
}
await writeFile(join(out,'samples.json'),JSON.stringify({schemaVersion:1,commit:'831198eeede3a6e0afac12fc644e4862e60527b9',
 donor:review.donor,exportSha256:sha(reviewBytes),referenceMm:review.referenceMm,extent,sourceSpacingUm:manifest.sourceScaleSpacingUm,
 sourceParts:verifiedParts,workerSha256:sha(worker),cleanupDecodedSha256:sha(cleanupBytes),
 scope:'Hash-verified 317.6 µm resident display source, production MPR worker and unchanged accepted planes. Counts are supported display samples above 0.18 resident and 0.28 prepared-mesh thresholds; not an anatomy or clinical audit.',rows},null,2)+'\n');
