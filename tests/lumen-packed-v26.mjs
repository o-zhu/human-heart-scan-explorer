import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {loadLumenCollection} from '../public/lumen-cleanup-v23.js';
import {lumenExcludedAt} from '../public/volume-picking.js';
import {VolumeRenderer} from '../public/renderer.js';
const baseline=JSON.parse(await readFile(new URL('../public/assets/cleanup-v25/lumen-manifest.json',import.meta.url)));
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const masks=['atrial','arterial','valve-region','rv'].map((id,i)=>{
  const dimensionsXYZ=[19,3,2],storageDimensionsXYZ=[3,3,2],lowerFullFineXYZ=[100+i*30,100,100],data=new Uint8Array(18),dense=new Uint8Array(114);
  for(let z=0;z<2;z++)for(let y=0;y<3;y++)for(let x=0;x<19;x++)if((x+3*y+z+i)%4===0){data[(x>>3)+3*(y+3*z)]|=1<<(x&7);dense[x+19*(y+3*z)]=255;}
  const packed=gzipSync(data);
  return {id,dimensionsXYZ,storageDimensionsXYZ,lowerFullFineXYZ,upperFullFineXYZ:lowerFullFineXYZ.map((n,k)=>n+dimensionsXYZ[k]),url:`./assets/cleanup-v28/${id}.bits.gz`,data,dense,packed,decodedBytes:data.length,compressedBytes:packed.length,sha256:hash(packed),decodedSha256:hash(data)};
 });
 const manifest={...baseline,format:'gzip-bitset-x-zyx',masks:masks.map(({data,dense,packed,...m})=>m)};
 const fetcher=async url=>url.endsWith('manifest.json')?Response.json(manifest):new Response(masks.find(m=>m.url===url).packed);
 return {manifest,masks,fetcher};
}
test('four lossless bit-packed masks decode and CPU sampling agrees with every original logical sample',async()=>{
 const f=fixture(),collection=await loadLumenCollection({extent:f.manifest.extent,fetcher:f.fetcher});
 assert.equal(collection.bitPacked,true);assert.equal(collection.masks.length,4);
 const renderer={extent:collection.extent,settings:{lumenCleanupEnabled:true},lumenCleanup:collection};
 const world=fine=>{const t=fine.map((v,i)=>v/(collection.fullDimensionsXYZ[i]-1));return [(t[0]-.5)*renderer.extent[0],(t[2]-.5)*renderer.extent[1],(.5-t[1])*renderer.extent[2]];};
 for(const mask of f.masks)for(let z=-1;z<=2;z++)for(let y=-1;y<=3;y++)for(let x=-1;x<=19;x++){
  const fine=[x,y,z].map((n,i)=>n+mask.lowerFullFineXYZ[i]);
  const expected=x>=0&&x<19&&y>=0&&y<3&&z>=0&&z<2&&mask.dense[x+19*(y+3*z)]===255;
  assert.equal(lumenExcludedAt(renderer,world(fine)),expected,`${mask.id}:${x},${y},${z}`);
 }
 renderer.settings.lumenCleanupEnabled=false;
 assert.equal(lumenExcludedAt(renderer,world([100,100,100])),false);
});
test('packed dimensions, unknown format, excessive mask count and nonzero unused bits are rejected',async()=>{
 for(const alter of [m=>{m.format='resampled';},m=>{m.masks[0].storageDimensionsXYZ=[19,3,2];},m=>{m.masks.push(m.masks[0]);}]){
  const f=fixture();alter(f.manifest);await assert.rejects(loadLumenCollection({extent:f.manifest.extent,fetcher:f.fetcher}),/source|manifest/);
 }
 const f=fixture(),mask=f.masks[0];mask.data[2]|=128;mask.packed=gzipSync(mask.data);
 Object.assign(f.manifest.masks[0],{sha256:hash(mask.packed),decodedSha256:hash(mask.data),compressedBytes:mask.packed.length});
 await assert.rejects(loadLumenCollection({extent:f.manifest.extent,fetcher:f.fetcher}),/padding/);
});
test('GPU uploads use packed sizes and allocation failure retains the previous complete collection',async()=>{
 const f=fixture(),collection=await loadLumenCollection({extent:f.manifest.extent,fetcher:f.fetcher}),uploads=[],deleted=[];let created=0,fail=false;
 const gl={TEXTURE0:100,NO_ERROR:0,MAX_3D_TEXTURE_SIZE:1,createTexture:()=>++created,deleteTexture:t=>deleted.push(t),getParameter:()=>4096,
  getError:()=>fail&&uploads.length===6?1:0,activeTexture(){},bindTexture(){},pixelStorei(){},texParameteri(){},texImage3D(...a){uploads.push(a.slice(3,6));}};
 const renderer={gl,extent:collection.extent,settings:{},requestRender(){}};
 for(let i=0;i<4;i++)renderer['lumenMaskTexture'+i]=1000+i;
 VolumeRenderer.prototype.setLumenCleanupData.call(renderer,collection);
 assert.deepEqual(uploads,Array.from({length:4},()=>[3,3,2]));assert.equal(renderer.lumenCleanup,collection);
 const previous=[0,1,2,3].map(i=>renderer['lumenMaskTexture'+i]);fail=true;
 assert.throws(()=>VolumeRenderer.prototype.setLumenCleanupData.call(renderer,{...collection,id:'replacement'}),/graphics device/);
 assert.equal(renderer.lumenCleanup,collection);assert.deepEqual([0,1,2,3].map(i=>renderer['lumenMaskTexture'+i]),previous);
 assert.ok(deleted.includes(5)&&deleted.includes(6));assert.equal(previous.some(t=>deleted.includes(t)),false);
});
