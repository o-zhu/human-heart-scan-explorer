/** Exact four-field lumen cleanup without retaining the dense source masks.
 * The existing RMR program supplies offline-selected byte copies, not new
 * cleanup decisions. Local-surface fields are excluded: they need their own
 * replacement geometry and are not a valid mask-only mobile approximation.
 */
import {validateReviewedMaskManifest,validateReviewedMaskReferences,loadVerifiedReviewedMaskAsset} from './reviewed-mask-atlas.js';

const SOURCE='./assets/reviewed-mask-v32/manifest.json';
const SOURCE_SHA='23466336a7becdaef676bca4a7347ebce5b5899bc3269edad5fe5080e09ef2b2';
const PROGRAM_SHA='3a520b5bb6d0d66972b1139f915676cfbae1defb1758d5ab4bf1c4a72cca5537';
const FULL=[1897,1897,2117],EXTENT=[1896/2116,1,1896/2116];
const FIELDS=[
 ['lumen:atrial','./assets/cleanup-v29/atrial.bits.gz','8011250557ade5201d00d3fa9a7b9cc95e885bac6a2c0519e484d8ee5384f6e1',[355,607,728],[1080,748,432]],
 ['lumen:arterial','./assets/cleanup-v28/arterial.bits.gz','5e296ed795b22ef90a0b3c4dc7959b94e1c6f7868753dfad715297388c7efa38',[650,445,800],[510,900,180]],
 ['lumen:valve-region','./assets/cleanup-v28/valve-region.bits.gz','404b8c552c906d13b72dba3940883f74188d7b688873a659a75e92cc01c9677d',[430,305,470],[850,900,850]],
 ['lumen:rv','./assets/cleanup-v28/rv.bits.gz','aac23435be1a7484d4ed9aed86c78f69a6c85a2af800425f7640ce860af7a342',[570,440,790],[450,760,1020]],
];
export const MOBILE_LUMEN_LAYOUT=Object.freeze({
 index:Object.freeze({format:'R32UI',width:1024,height:165,entryCount:168208,byteLength:675840,logicalBytes:672832,sha256:'4c9142e6cc54ffabab17b47ca1baedc523787cf29451b672c64d58ab275499ad'}),
 payload:Object.freeze({format:'RGBA8',width:2048,height:1254,brickCount:20054,byteLength:10272768,logicalBytes:10267648,sha256:'4e4354def962c1a985e26abf28406ae071632525d2812f8c499dafc6604f424a'}),
 retainedBytes:10948608,largestSourceBytes:29192000,
});
const equal=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((value,index)=>value===b[index]);
const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),value=>value.toString(16).padStart(2,'0')).join('');
const current=signal=>signal?.throwIfAborted();
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));

async function readMetadata(response,signal){
 if(!response.body)throw new Error('The reviewed lumen metadata is empty.');
 const bytes=new Uint8Array(32768),reader=response.body.getReader();let used=0;
 try{for(;;){current(signal);const {done,value}=await reader.read();current(signal);if(done)break;if(used+value.length>bytes.length)throw new Error('The reviewed lumen metadata length exceeds its budget.');bytes.set(value,used);used+=value.length;}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 return bytes.subarray(0,used);
}

export function validateMobileLumenManifest(manifest){
 if(manifest?.schema!=='heart-reviewed-lumen-atlas-v41'||manifest.version!==1||manifest.donorId!=='ladaf-2021-17'||manifest.sourceAtlasSha256!==SOURCE_SHA||!equal(manifest.sourceFullDimensionsXYZ,FULL)||!equal(manifest.extent,EXTENT)||!equal(manifest.brickSizeXYZ,[8,8,8])||manifest.brickBytes!==512||!Array.isArray(manifest.fields)||manifest.fields.length!==4)throw new Error('The mobile lumen cleanup does not match this source.');
 let entries=0;
 for(const [index,field]of manifest.fields.entries()){
  const [id,url,sha,dimensions,lower]=FIELDS[index],storage=[Math.ceil(dimensions[0]/8),dimensions[1],dimensions[2]],grid=storage.map(value=>Math.ceil(value/8));
  if(field.id!==id||field.kind!=='lumen'||field.sourceId!==id.slice(6)||field.sourceUrl!==url||field.sourceDecodedSha256!==sha||!equal(field.dimensionsXYZ,dimensions)||!equal(field.lowerFullFineXYZ,lower)||!equal(field.upperFullFineXYZ,lower.map((value,axis)=>value+dimensions[axis]))||!equal(field.storageDimensionsXYZ,storage)||field.sourceDecodedBytes!==storage.reduce((a,b)=>a*b,1)||!equal(field.brickGridXYZ,grid)||field.indexOffset!==entries)throw new Error('Invalid mobile lumen cleanup field.');
  entries+=grid.reduce((a,b)=>a*b,1);
 }
 for(const [key,expected]of [['indexTexture',MOBILE_LUMEN_LAYOUT.index],['payloadTexture',MOBILE_LUMEN_LAYOUT.payload]])if(!manifest[key]||Object.entries(expected).some(([name,value])=>manifest[key][name]!==value))throw new Error('Invalid mobile lumen atlas layout.');
 if(entries!==MOBILE_LUMEN_LAYOUT.index.entryCount)throw new Error('Invalid mobile lumen index extent.');
 return manifest;
}

export async function loadMobileLumenAtlas({fetcher=(...args)=>globalThis.fetch(...args),signal}={}){
 current(signal);const response=await fetcher(SOURCE,{signal,priority:'low'});
 if(!response.ok)throw new Error('The reviewed lumen metadata is unavailable.');
 const sourceBytes=await readMetadata(response,signal);current(signal);
 if(await digest(sourceBytes)!==SOURCE_SHA)throw new Error('The mobile lumen source metadata checksum does not match.');
 const source=validateReviewedMaskManifest(JSON.parse(new TextDecoder().decode(sourceBytes)));
 if(source.transport?.decodedSha256!==PROGRAM_SHA)throw new Error('The reviewed lumen reference program does not match.');
 const program=await loadVerifiedReviewedMaskAsset(source.transport,fetcher,signal),{view,offset}=validateReviewedMaskReferences(program,source);
 const {index:il,payload:pl}=MOBILE_LUMEN_LAYOUT,index=new Uint32Array(il.byteLength/4),remap=new Uint32Array(source.payloadTexture.brickCount+1),owners=new Uint8Array(pl.brickCount),ordinals=new Uint32Array(pl.brickCount);
 let count=0;
 for(let entry=0;entry<il.entryCount;entry++){
  const old=view.getUint32(32+entry*4,true);if(!old)continue;
  if(!remap[old]){
   if(count>=pl.brickCount)throw new Error('The mobile lumen brick budget does not match.');
   const field=view.getUint32(offset+(old-1)*8,true),ordinal=view.getUint32(offset+(old-1)*8+4,true);
   if(field>=4)throw new Error('A lumen mask must not depend on a local replacement surface.');
   owners[count]=field;ordinals[count]=ordinal;remap[old]=++count;
  }
  index[entry]=remap[old];
 }
 current(signal);if(count!==pl.brickCount||await digest(index)!==il.sha256)throw new Error('The compact lumen index checksum does not match.');
 const payload=new Uint8Array(pl.byteLength);
 // One source is decoded at a time. Each verified source is copied directly
 // into its final sparse bricks and released before the next transfer starts.
 for(let fieldIndex=0;fieldIndex<4;fieldIndex++){
  current(signal);const field=source.fields[fieldIndex];
  if(field.sourceDecodedBytes>MOBILE_LUMEN_LAYOUT.largestSourceBytes)throw new Error('The mobile lumen source exceeds its memory budget.');
  let data=await loadVerifiedReviewedMaskAsset({url:field.sourceUrl,compressedBytes:field.sourceCompressedBytes,decodedBytes:field.sourceDecodedBytes,sha256:field.sourceCompressedSha256,decodedSha256:field.sourceDecodedSha256},fetcher,signal);
  const grid=field.brickGridXYZ,storage=field.storageDimensionsXYZ;let copied=0;
  for(let brick=0;brick<count;brick++){
   if(owners[brick]!==fieldIndex)continue;
   if(copied++%256===0){await pause();current(signal);}
   const ordinal=ordinals[brick],x=(ordinal%grid[0])*8,y=(Math.floor(ordinal/grid[0])%grid[1])*8,z=Math.floor(ordinal/(grid[0]*grid[1]))*8,width=Math.min(8,storage[0]-x),target=brick*512;
   for(let dz=0;dz<Math.min(8,storage[2]-z);dz++)for(let dy=0;dy<Math.min(8,storage[1]-y);dy++){
    const start=x+storage[0]*(y+dy+storage[1]*(z+dz));payload.set(data.subarray(start,start+width),target+8*(dy+8*dz));
   }
  }
  data=null;
 }
 current(signal);if(await digest(payload)!==pl.sha256)throw new Error('The compact lumen payload checksum does not match.');current(signal);
 const manifest=validateMobileLumenManifest({schema:'heart-reviewed-lumen-atlas-v41',version:1,id:'ladaf-reviewed-lumen-atlas-v41',donorId:source.donorId,sourceAtlasSha256:SOURCE_SHA,sourceFullDimensionsXYZ:[...FULL],extent:[...EXTENT],brickSizeXYZ:[8,8,8],brickBytes:512,zeroBrickIndex:0,fields:source.fields.slice(0,4),indexTexture:{...il},payloadTexture:{...pl}});
 return {manifest,index,payload};
}
