/** One verified block ahead of decode, with only one network request at a time.
 * The extra retained transport is at most one manifest-bounded block. Geometry
 * publication remains the caller's responsibility after complete verification.
 */
export async function* verifiedSurfaceParts(parts, {loadPart, hash, waitForWorkspace=async()=>{}, onProgress=()=>{}, lookahead=false}={}) {
 let next=null,closed=false,completeBytes=0,downloadedBytes=0,verifiedParts=0;
 const totalBytes=parts.reduce((total,part)=>total+part.compressedBytes,0);
 const report=(stage,details={})=>{if(!closed)onProgress({phase:'download',stage,loadedBytes:downloadedBytes,totalBytes,verifiedParts,totalParts:parts.length,...details});};
 const begin=part=>(async()=>{
  await waitForWorkspace();
  if(closed)return null;
  const packed=await loadPart(part,count=>{
   if(!Number.isFinite(count)||count<0||count>part.compressedBytes)throw new Error('Invalid surface progress.');
   // A paused transfer can restart; already observed bytes must not make the
   // download meter move backward or falsely count a retransmission twice.
   downloadedBytes=Math.max(downloadedBytes,completeBytes+count);report('download');
  });
  if(closed)return null;
  if(!(packed instanceof Uint8Array)||packed.length!==part.compressedBytes)throw new Error('Compact surface download length did not match.');
  if(await hash(packed)!==part.sha256)throw new Error('Compact surface block checksum did not match.');
  completeBytes+=part.compressedBytes;downloadedBytes=Math.max(downloadedBytes,completeBytes);verifiedParts++;
  report('verify-part');
  return {part,packed};
 })().then(value=>({value}),error=>({error}));
 // A result envelope prevents a lookahead error becoming an unhandled promise
 // rejection while the preceding verified block is still being decoded.
 try{
  for(let index=0;index<parts.length;index++){
   const outcome=await(next||begin(parts[index]));next=null;
   if(outcome.error)throw outcome.error;
   if(lookahead&&index+1<parts.length)next=begin(parts[index+1]);
   yield outcome.value;
  }
 }finally{closed=true;next=null;}
}
