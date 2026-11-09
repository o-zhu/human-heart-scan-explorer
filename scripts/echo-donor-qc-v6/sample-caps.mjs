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

const root=fileURLToPath(new URL('../../',import.meta.url));
const input=resolve(process.argv[2]||'/dev/shm/echo-donor-qc-v6');
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const reviewBytes=await readFile(join(input,'review.json')),review=JSON.parse(reviewBytes);
const manifestBytes=await readFile(join(root,review.sourceManifest));
if(sha(manifestBytes)!==review.sourceHashes[review.sourceManifest])throw new Error('Donor source manifest changed after plane export.');
const manifest=JSON.parse(manifestBytes),level=manifest.levels.high;
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
const caps=[];
for(const c of review.cases){
 if(c.outsideScan){caps.push({id:c.id,available:false,reason:'Outside the acquired heart scan; no invented CT raster.'});continue;}
 const spacing=manifest.sourceScaleSpacingUm,physicalWidthMm=c.plane.width*review.referenceMm,physicalHeightMm=c.plane.height*review.referenceMm;
 const width=Math.max(2,Math.ceil(physicalWidthMm*1000/spacing)+1),height=Math.max(2,Math.ceil(physicalHeightMm*1000/spacing)+1);
 context.onmessage({data:{type:'sample',id:c.id,plane:c.plane,width,height}});
 if(result?.id!==c.id||result.data.length!==width*height)throw new Error(`MPR worker result missing: ${c.id}`);
 const file=`caps/${c.id}.raw`,output=Buffer.from(result.data);
 await writeFile(join(input,file),output);
 caps.push({id:c.id,available:true,file,width,height,sha256:sha(output),bytes:output.length,sourceSpacingUm:spacing,
  pixelSpacingUm:[physicalWidthMm*1000/(width-1),physicalHeightMm*1000/(height-1)],
  planeSha256:sha(JSON.stringify(Object.fromEntries(['center','right','up','normal','width','height'].map(k=>[k,c.plane[k]])))),
  orientation:'Row zero is positive plane.up; columns increase along plane.right.',cleaned:false});
}
const report={schemaVersion:1,exportSha256:sha(reviewBytes),donor:review.donor,source:`Measured ${review.donor} resident display volume`,sourceSpacingUm:manifest.sourceScaleSpacingUm,sourceDimensions:level.dimensions,referenceMm:referenceUm/1000,extent,manifestSha256:sha(manifestBytes),sourceParts:verifiedParts,worker:'public/mpr-worker.js',workerSha256:sha(workerBytes),intensity:'Windowed uint8 display contrast; not Hounsfield units.',sampling:'Actual production MPR worker, trilinear interpolation, zero outside source, source-oriented complete plane raster; no source edit.',caps};
await writeFile(join(input,'caps.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({caps:caps.filter(c=>c.available).length,outside:caps.filter(c=>!c.available).length,sourceSpacingUm:report.sourceSpacingUm,output:join(input,'caps.json')}));
