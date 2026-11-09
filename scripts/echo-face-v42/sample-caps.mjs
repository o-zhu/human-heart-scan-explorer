/** Resample every accepted acquired plane with the ACTUAL production MPR
 * worker and the hash-verified donor resident measured volume. The small
 * controller audit fixture is deliberately never used as image data.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createContext,runInContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {DONORS} from '../../public/donors.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const input=resolve(process.argv[2]||'/dev/shm/echo-face-v42');
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const reviewBytes=await readFile(join(input,'review.json')),review=JSON.parse(reviewBytes);
const manifestBytes=await readFile(join(root,review.sourceManifest));
if(sha(manifestBytes)!==review.sourceHashes[review.sourceManifest])throw new Error('Donor source manifest changed after plane export.');
const manifest=JSON.parse(manifestBytes),level=manifest.levels.high;
const donor=DONORS.find(d=>d.id===review.donor);
const publicPath=url=>join(root,'public',url.replace(/^\.\//,'').split('?')[0]);
const support=await json(publicPath(donor.cleanupManifestUrl));
const supportPacked=await readFile(publicPath(support.volumeUrl)),supportRaw=gunzipSync(supportPacked);
assert.ok([sha(supportPacked),sha(supportRaw)].includes(support.sha256),'Donor source-support hash mismatch.');
const [nx,ny,nz]=level.dimensions,data=new Uint8Array(nx*ny*nz);
const verifiedParts=[];
for(const part of level.parts){
 const packed=await readFile(join(root,'public',part.url)),decoded=gunzipSync(packed);
 if(sha(packed)!==part.sha256)throw new Error('Source transport hash mismatch.');
 const start=part.zRange[0],count=part.zRange[1]-start,a=new Uint8Array(decoded);
 if(part.predictor==='delta-z'){
  for(let z=1;z<count;z++)for(let i=0;i<nx*ny;i++)a[z*nx*ny+i]=(a[z*nx*ny+i]+a[(z-1)*nx*ny+i])&255;
 }else if(part.predictor==='delta-x'){
  for(let i=0;i<a.length;i++)if(i%nx)a[i]=(a[i]+a[i-1])&255;
 }else if(part.predictor)throw new Error(`Unsupported predictor ${part.predictor}`);
 if(sha(a)!==part.rawSha256)throw new Error('Decoded source hash mismatch.');
 data.set(a,start*nx*ny);verifiedParts.push({url:part.url,sha256:part.sha256,rawSha256:part.rawSha256});
}
const extents=manifest.sourceScaleCenterExtentUm,referenceUm=Math.max(...extents);
const extent=[extents[0]/referenceUm,extents[2]/referenceUm,extents[1]/referenceUm];
const workerBytes=await readFile(join(root,'public/mpr-worker.js'));
if(sha(workerBytes)!==review.sourceHashes['public/mpr-worker.js'])throw new Error('Production MPR worker changed after plane export.');
let result=null;
const context=createContext({Uint8Array,Math,onmessage:null,postMessage(value){result=value;}});
runInContext(workerBytes.toString(),context,{filename:'public/mpr-worker.js'});
context.onmessage({data:{type:'load',data,dimensions:level.dimensions,extent}});
const out=join(input,'caps');await mkdir(out,{recursive:true});
const sourceDataBefore=sha(data);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const world=(p,x,y,width,height)=>p.center.map((v,i)=>v+p.right[i]*(x/(width-1)-.5)*p.width+p.up[i]*(.5-y/(height-1))*p.height);
const voxel=p=>[(p[0]/extent[0]+.5)*(nx-1),(.5-p[2]/extent[2])*(ny-1),(p[1]/extent[1]+.5)*(nz-1)];
// Independent weighted-corner interpolation oracle. This does not invoke the
// worker or re-use its nested interpolation expression.
function directSample(p){
 const v=voxel(p),dims=[nx,ny,nz];if(v.some((n,i)=>n<0||n>dims[i]-1))return 0;
 const lo=v.map(Math.floor),f=v.map((n,i)=>n-lo[i]);let sum=0;
 for(let corner=0;corner<8;corner++){
  const bits=[corner&1,(corner>>1)&1,(corner>>2)&1],q=lo.map((n,i)=>Math.min(n+bits[i],dims[i]-1));
  const w=bits.reduce((a,b,i)=>a*(b?f[i]:1-f[i]),1);sum+=w*data[q[0]+nx*(q[1]+ny*q[2])];
 }
 return Math.round(sum);
}
function supported(p){
 const t=[p[0]/extent[0]+.5,.5-p[2]/extent[2],p[1]/extent[1]+.5];
 if(t.some(v=>v<0||v>1))return false;
 const q=t.map((v,i)=>Math.round(v*(support.dimensions[i]-1)));
 return supportRaw[q[0]+support.dimensions[0]*(q[1]+support.dimensions[1]*q[2])]>=128;
}
function supportStats(c,p,width,height,pixels){
 let total=0,outsideRoi=0;
 const threshold=manifest.defaultThreshold??.30;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  if(pixels[x+y*width]/255<=threshold)continue;
  const w=world(p,x,y,width,height);if(!supported(w))continue;total++;
  const delta=sub(w,c.plane.center);
  if(Math.abs(dot(delta,c.plane.right))>c.plane.width/2||Math.abs(dot(delta,c.plane.up))>c.plane.height/2)outsideRoi++;
 }
 return {threshold,supportedDisplaySamples:total,supportedSamplesOutsideOriginalRoi:outsideRoi,outsideRoiFraction:total?outsideRoi/total:0};
}
async function samplePlane(c,p,suffix){
 const spacing=manifest.sourceScaleSpacingUm,physicalWidthMm=p.width*review.referenceMm,physicalHeightMm=p.height*review.referenceMm;
 const width=Math.max(2,Math.ceil(physicalWidthMm*1000/spacing)+1),height=Math.max(2,Math.ceil(physicalHeightMm*1000/spacing)+1);
 const id=c.id+'-'+suffix;context.onmessage({data:{type:'sample',id,plane:p,width,height}});
 if(result?.id!==id||result.data.length!==width*height)throw new Error(`MPR worker result missing: ${id}`);
 const file=`caps/${id}.raw`,output=Buffer.from(result.data);await writeFile(join(input,file),output);
 let directComparisons=0,maximumDirectError=0;
 for(let i=0;i<=16;i++)for(let j=0;j<=18;j++){
  const x=Math.round(i*(width-1)/16),y=Math.round(j*(height-1)/18);
  const error=Math.abs(output[x+y*width]-directSample(world(p,x,y,width,height)));
  maximumDirectError=Math.max(maximumDirectError,error);directComparisons++;
 }
 assert.ok(maximumDirectError<=1,'Independent source interpolation mismatch: '+id);
 return {file,width,height,sha256:sha(output),bytes:output.length,sourceSpacingUm:spacing,
  pixelSpacingUm:[physicalWidthMm*1000/(width-1),physicalHeightMm*1000/(height-1)],
  planeSha256:sha(JSON.stringify(Object.fromEntries(['center','right','up','normal','width','height'].map(k=>[k,p[k]])))),
  directComparisons,maximumDirectError,coverage:supportStats(c,p,width,height,output),
  orientation:'Row zero is positive plane.up; columns increase along plane.right.',cleaned:false};
}
const caps=[];
for(const c of review.cases){
 if(c.outsideScan){caps.push({id:c.id,available:false,reason:'Outside the acquired heart scan; no invented CT raster.'});continue;}
 assert.ok(c.capPlane,'Full-face plane missing in current export: '+c.id);
 const roi=await samplePlane(c,c.plane,'roi'),full=await samplePlane(c,c.capPlane,'full');
 caps.push({id:c.id,available:true,...full,roi});
}
assert.equal(sha(data),sourceDataBefore,'Source voxels changed during sampling.');
const report={schemaVersion:2,exportSha256:sha(reviewBytes),donor:review.donor,source:`Measured ${review.donor} resident display volume`,sourceSpacingUm:manifest.sourceScaleSpacingUm,sourceDimensions:level.dimensions,referenceMm:referenceUm/1000,extent,manifestSha256:sha(manifestBytes),sourceParts:verifiedParts,decodedSourceSha256:sourceDataBefore,sourceSupportSha256:sha(supportRaw),worker:'public/mpr-worker.js',workerSha256:sha(workerBytes),intensity:'Windowed uint8 display contrast; not Hounsfield units.',sampling:'Actual production MPR worker at resident source spacing, both unchanged CT ROI and complete same-plane cap; independently checked weighted-corner samples; zero outside source; source voxels unchanged. Fine grid planning is separate and does not imply a fine bank download.',caps};
await writeFile(join(input,'caps.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({caps:caps.filter(c=>c.available).length,outside:caps.filter(c=>!c.available).length,sourceSpacingUm:report.sourceSpacingUm,output:join(input,'caps.json')}));
