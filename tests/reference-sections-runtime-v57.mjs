/** Production cache against the completed measured reference bank (no network).
 * node tests/reference-sections-runtime-v57.mjs --require-fixtures \
 *   --planes=/path/to/planes-v57.json --bank=/path/to/reference-sections-v57 \
 *   --out=/path/to/runtime-qc.json
 * A public clone without restored fixtures explicitly skips this check.
 * This is Node decoder/controller evidence, not browser or clinical validation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReferenceSectionCache} from '../public/reference-section-cache.js';
import {sameFinePlane} from '../public/ultra-volume-core.js';
import {DONORS} from '../public/donors.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const option=(name,fallback)=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const planesPath=resolve(option('planes',root+'docs/reference-sections-v57/plane-export.json'));
const bank=resolve(option('bank',root+'data/reference-sections-v57'));
const output=option('out',null),required=process.argv.includes('--require-fixtures');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFields=['donorId','datasetId','sourceKey','sourceMaskSha256','sourceSpacingUm','longestMm'];

test('completed donor manifests and largest exact rasters pass the production cache',async t=>{
 const missing=[];
 for(const path of [planesPath,...DONORS.map(donor=>resolve(bank,donor.id,'manifest.json'))]){
  try{await access(path);}catch(error){if(error.code!=='ENOENT')throw error;missing.push(path);}
 }
 if(missing.length){
  const message=`${missing.length} required production fixture files are absent; no real-bank metadata or pixel verification was performed.`;
  if(required)assert.fail(message);t.skip(message);return;
 }
 const exportBytes=await readFile(planesPath),planes=JSON.parse(exportBytes);
 assert.equal(planes.kind,'heart-reference-planes-v57');assert.equal(planes.schemaVersion,1);
 assert.equal(DONORS.length,3);assert.equal(planes.rows.length,168);assert.equal(planes.sources.length,3);
 const echoSourceSha256=sha(await readFile(new URL('../public/echo.js',import.meta.url)));
 assert.equal(echoSourceSha256,planes.sourceHashes['public/echo.js'],'The frozen plane producer must match the tested source.');
 const donors=[];
 for(const donor of DONORS){
  const source=planes.sources.find(item=>item.donorId===donor.id);
  assert.ok(source);assert.equal(source.datasetId,String(donor.datasetId));assert.equal(source.sourceSpacingUm,donor.fineSpacingUm);
  const expectedSource=Object.fromEntries(sourceFields.map(key=>[key,source[key]]));
  const rows=planes.rows.filter(row=>row.donorId===donor.id),rowById=new Map(rows.map(row=>[row.viewId,row]));
  assert.equal(rows.length,56);assert.equal(rowById.size,56);
  const manifestBytes=await readFile(resolve(bank,donor.id,'manifest.json')),manifest=JSON.parse(manifestBytes);
  const manifestUrl=`https://reference-test.invalid/assets/reference-sections-v57/${donor.id}.json`;
  let assetRequests=0,assetBytes=0;
  const cache=new ReferenceSectionCache({manifestUrl,expectedSource,manifestSha256:sha(manifestBytes),maxBytes:24*1024*1024,
   fetcher:async(url,{signal}={})=>{
    if(url===manifestUrl)return new Response(manifestBytes);
    const path=new URL(url).pathname;
    assert.match(path,/^\/assets\/reference-sections-v57\/rasters\/[a-f0-9]{64}\.r8\.gz$/);
    const encoded=await readFile(resolve(bank,'rasters',path.split('/').at(-1)),{signal});
    assetRequests++;assetBytes+=encoded.byteLength;return new Response(encoded);
   }});
  const request=(view,role)=>({viewId:view.viewId,mode:view.mode,donorId:donor.id,role,plane:view[role].plane,
   sourceKey:source.sourceKey,cleanupEnabled:true,modified:false,planeReference:'refined'});
  let metadataRoles=0,outsideViews=0,peakCacheBytes=0;
  const cases=[];
  try{
   await cache.init();assert.equal(cache.views.size,56);assert.equal(manifest.views.length,56);
   for(const view of manifest.views){
    const row=rowById.get(view.viewId);assert.ok(row);assert.equal(view.mode,row.mode);assert.equal(view.outsideScan,row.outsideScan);
    if(row.outsideScan){outsideViews++;assert.equal(view.ct,null);assert.equal(view.face,null);continue;}
    for(const role of ['ct','face']){
     const record=view[role],expected=row[role];assert.ok(record);assert.equal(record.codec,'gzip-r8-delta-v1');
     for(const field of ['plane','width','height','decodedBytes','spacingUmXY','sourceSpacingUm','cleaned']){
      assert.deepEqual(record[field],expected[field],`${donor.id}/${view.viewId}/${role}/${field}`);
     }
     assert.ok(cache.match(request(view,role)));metadataRoles++;
    }
   }
   assert.equal(metadataRoles,98);assert.equal(outsideViews,7);assert.equal(assetRequests,0,'Metadata validation never downloads a raster.');
   for(const mode of ['tte','tee'])for(const role of ['ct','face']){
    const view=manifest.views.filter(item=>item.mode===mode&&item[role]).sort((a,b)=>b[role].decodedBytes-a[role].decodedBytes)[0];
    const record=view[role],result=await cache.load(request(view,role));
    assert.equal(result.width,record.width);assert.equal(result.height,record.height);assert.equal(result.data.byteLength,record.decodedBytes);
    assert.equal(sha(result.data),record.pixelSha256);assert.ok(sameFinePlane(result.plane,record.plane,1e-12));
    const status=cache.getStatus();assert.ok(status.decodedBytes<=24*1024*1024);peakCacheBytes=Math.max(peakCacheBytes,status.decodedBytes);
    cases.push({viewId:view.viewId,mode,role,codec:record.codec,width:result.width,height:result.height,
     decodedBytes:result.data.byteLength,compressedSha256:record.sha256,pixelSha256:result.pixelSha256,cacheDecodedBytes:status.decodedBytes});
   }
  }finally{cache.destroy();assert.equal(cache.getStatus().decodedBytes,0);}
  donors.push({donorId:donor.id,manifestSha256:sha(manifestBytes),sourceKey:source.sourceKey,metadataRoles,outsideViews,
   decodedRoles:cases.length,assetRequests,assetBytes,peakCacheBytes,decodedCacheLimit:24*1024*1024,cases});
 }
 const receipt={kind:'heart-reference-runtime-qc-v57',schemaVersion:1,passed:true,browserClaim:false,
  frozenPlanesSha256:sha(exportBytes),echoSourceSha256,donors:donors,
  totals:{donors:donors.length,views:168,metadataRoles:donors.reduce((n,d)=>n+d.metadataRoles,0),
   outsideViews:donors.reduce((n,d)=>n+d.outsideViews,0),decodedRoles:donors.reduce((n,d)=>n+d.decodedRoles,0)}};
 assert.equal(receipt.totals.metadataRoles,294);assert.equal(receipt.totals.outsideViews,21);assert.equal(receipt.totals.decodedRoles,12);
 if(output){const path=resolve(output);await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(receipt,null,2)+'\n');}
 t.diagnostic(JSON.stringify(receipt.totals));
});
