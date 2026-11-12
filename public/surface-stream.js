/** Verify an HFM as it passes through bounded CPU storage into an unpublished
 * graphics transaction. Callers must discard that transaction on ANY failure;
 * only finish() proves complete geometry, source identity and debris uniformity.
 */
import {SurfaceSha256} from './surface-sha256.js';

export const SURFACE_TRANSFER_BYTES=2*1024*1024-8; // Whole triangles: 2,097,144 / 12.
const MAX_DECODED=512*1024*1024;
const hashPattern=/^[a-f0-9]{64}$/;

export function parseSurfaceHeader(bytes,expectedBytes){
 if(!(bytes instanceof Uint8Array)||bytes.length!==32||!Number.isSafeInteger(expectedBytes)||expectedBytes<32||expectedBytes>MAX_DECODED)throw new Error('Invalid streamed surface length.');
 const d=new DataView(bytes.buffer,bytes.byteOffset,32);
 if(d.getUint32(0,true)!==0x314d4648||d.getUint32(4,true)!==1)throw new Error('Unsupported fine surface format.');
 const vertexCount=d.getUint32(8,true),indexCount=d.getUint32(12,true),positionOffset=d.getUint32(16,true),normalOffset=d.getUint32(20,true),indexOffset=d.getUint32(24,true);
 if(!vertexCount||!indexCount||indexCount%3||positionOffset<32||positionOffset%4||normalOffset%4||indexOffset%4||positionOffset+vertexCount*6>normalOffset||normalOffset+vertexCount*6>indexOffset||indexOffset+indexCount*4!==expectedBytes)throw new Error('Invalid fine surface layout.');
 return {vertexCount,indexCount,positionOffset,normalOffset,indexOffset};
}

export class SurfaceStreamVerifier{
 constructor({expectedBytes,decodedSha256,geometrySourceSha256=decodedSha256,positionSha256,indexSha256,debrisFlags,onStart=async()=>{},onChunk=async()=>{},waitForWorkspace=async()=>{},onProgress=()=>{}}={}){
  if(!Number.isSafeInteger(expectedBytes)||expectedBytes<32||expectedBytes>MAX_DECODED||!hashPattern.test(decodedSha256||'')||!hashPattern.test(geometrySourceSha256||'')||positionSha256!==undefined&&!hashPattern.test(positionSha256)||indexSha256!==undefined&&!hashPattern.test(indexSha256))throw new Error('Invalid streamed surface identity.');
  if(!(debrisFlags instanceof Uint8Array)||!debrisFlags.length||debrisFlags.length>32*1024*1024)throw new Error('Streamed surface cleanup flags are unavailable.');
  this.expectedBytes=expectedBytes;this.decodedSha256=decodedSha256;this.geometrySourceSha256=geometrySourceSha256;
  this.positionSha256=positionSha256;this.indexSha256=indexSha256;this.debrisFlags=debrisFlags;
  this.onStart=onStart;this.onChunk=onChunk;this.wait=waitForWorkspace;this.onProgress=onProgress;
  this.hash=new SurfaceSha256();this.positionHash=positionSha256?new SurfaceSha256():null;this.indexHash=indexSha256?new SurfaceSha256():null;
  this.header=new Uint8Array(32);this.offset=0;this.layout=null;this.ranges=null;this.rangeIndex=0;
  this.chunk=null;this.recycled=null;this.chunkUsed=0;this.chunkOffset=0;this.trianglesChecked=0;this.completed=false;this.failed=false;this.maxChunkBytes=0;
 }
 async acceptHeader(){
  const layout=this.layout=parseSurfaceHeader(this.header,this.expectedBytes);
  if(this.debrisFlags.length!==layout.vertexCount)throw new Error('The debris filter does not match this surface.');
  for(let start=0;start<this.debrisFlags.length;start+=262144){
   await this.wait();
   const end=Math.min(start+262144,this.debrisFlags.length);
   for(let i=start;i<end;i++)if(this.debrisFlags[i]!==0&&this.debrisFlags[i]!==255)throw new Error('Invalid debris filter values.');
  }
  this.ranges=[
   {kind:'position',start:layout.positionOffset,end:layout.positionOffset+layout.vertexCount*6},
   {kind:'normal',start:layout.normalOffset,end:layout.normalOffset+layout.vertexCount*6},
   {kind:'index',start:layout.indexOffset,end:layout.indexOffset+layout.indexCount*4},
  ];
  await this.wait();await this.onStart({...layout,geometrySourceSha256:this.geometrySourceSha256,expectedBytes:this.expectedBytes});
 }
 async emit(range){
  const bytes=this.chunk;
  if(range.kind==='index'){
   const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),flags=this.debrisFlags;
   if(bytes.byteLength%12)throw new Error('Invalid streamed triangle boundary.');
   for(let i=0;i<bytes.byteLength;i+=12){
    const a=view.getUint32(i,true),b=view.getUint32(i+4,true),c=view.getUint32(i+8,true);
    if(a>=this.layout.vertexCount||b>=this.layout.vertexCount||c>=this.layout.vertexCount)throw new Error('Invalid fine surface index.');
    if(flags[a]!==flags[b]||flags[a]!==flags[c])throw new Error('The debris filter crosses a retained structure.');
   }
   this.trianglesChecked+=bytes.byteLength/12;
  }
  // No retained alias to the transferred buffer may survive acknowledgement.
  this.chunk=null;this.chunkUsed=0;
  await this.wait();
  const returned=await this.onChunk({kind:range.kind,byteOffset:this.chunkOffset,bytes});
  // Browser callers transfer ownership back only after the GPU fence. Reuse
  // that credit buffer instead of accumulating garbage on either thread.
  if(returned instanceof ArrayBuffer)this.recycled=returned;
  this.onProgress({phase:'decode',stage:'stream-surface',processedBytes:this.offset,processingBytes:this.expectedBytes});
 }
 async write(bytes){
  if(this.completed||this.failed)throw new Error('The surface stream is already closed.');
  if(!(bytes instanceof Uint8Array)||this.offset+bytes.byteLength>this.expectedBytes){this.failed=true;throw new Error('Fine surface length exceeds its manifest.');}
  let used=0;
  try{
   while(used<bytes.length){
    await this.wait();
    if(this.offset<32){
     const take=Math.min(32-this.offset,bytes.length-used),part=bytes.subarray(used,used+take);
     this.header.set(part,this.offset);this.hash.update(part);this.offset+=take;used+=take;
     if(this.offset===32)await this.acceptHeader();
     continue;
    }
    while(this.rangeIndex<this.ranges.length&&this.offset>=this.ranges[this.rangeIndex].end)this.rangeIndex++;
    const range=this.ranges[this.rangeIndex];
    if(!range)throw new Error('Fine surface length exceeds its geometry.');
    if(this.offset<range.start){
     const take=Math.min(range.start-this.offset,bytes.length-used,SURFACE_TRANSFER_BYTES),part=bytes.subarray(used,used+take);
     this.hash.update(part);this.offset+=take;used+=take;continue;
    }
    if(!this.chunk){
     const length=Math.min(SURFACE_TRANSFER_BYTES,range.end-this.offset);
     this.chunk=this.recycled?.byteLength===length?new Uint8Array(this.recycled):new Uint8Array(length);this.recycled=null;
     this.maxChunkBytes=Math.max(this.maxChunkBytes,this.chunk.length);this.chunkOffset=this.offset-range.start;
    }
    const take=Math.min(this.chunk.length-this.chunkUsed,bytes.length-used),part=bytes.subarray(used,used+take);
    this.chunk.set(part,this.chunkUsed);this.hash.update(part);
    if(range.kind==='position')this.positionHash?.update(part);if(range.kind==='index')this.indexHash?.update(part);
    this.chunkUsed+=take;this.offset+=take;used+=take;
    if(this.chunkUsed===this.chunk.length)await this.emit(range);
   }
  }catch(error){this.failed=true;this.chunk=null;this.recycled=null;throw error;}
 }
 async finish(){
  if(this.completed||this.failed)throw new Error('The surface stream is already closed.');
  try{
   await this.wait();
   if(this.offset!==this.expectedBytes||!this.layout||this.chunk||this.trianglesChecked*3!==this.layout.indexCount)throw new Error('Fine surface length did not match.');
   this.onProgress({phase:'decode',stage:'verify-final',final:true,processedBytes:this.offset,processingBytes:this.expectedBytes});
   if(this.hash.digest()!==this.decodedSha256)throw new Error('Fine surface decoded checksum did not match.');
   if(this.positionHash&&this.positionHash.digest()!==this.positionSha256)throw new Error('Compact surface positions changed.');
   if(this.indexHash&&this.indexHash.digest()!==this.indexSha256)throw new Error('Compact surface topology changed.');
   this.completed=true;this.recycled=null;return {...this.layout,geometrySourceSha256:this.geometrySourceSha256,debrisValidated:true,trianglesChecked:this.trianglesChecked,maxTransferBytes:this.maxChunkBytes};
  }catch(error){this.failed=true;this.chunk=null;this.recycled=null;throw error;}
 }
}
