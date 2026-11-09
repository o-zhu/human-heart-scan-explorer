/** Approximate, manually guided tissue territories; source coordinates are normalized XYZ. */
const anatomyPromises=new Map();
export async function loadAnatomy(manifestUrl='./assets/anatomy/manifest.json'){
 if(!manifestUrl)throw new Error('An anatomy overlay has not been prepared for this donor.');
 if(anatomyPromises.has(manifestUrl))return anatomyPromises.get(manifestUrl);
 const anatomyPromise=(async()=>{
  const response=await fetch(manifestUrl);
  if(!response.ok)throw new Error('The anatomy overlay is unavailable.');
  const manifest=await response.json();
  const dimensions=manifest.dimensions;
  if(!Array.isArray(dimensions)||dimensions.length!==3||dimensions.some(n=>!Number.isSafeInteger(n)||n<2))throw new Error('Invalid anatomy grid.');
  const compressed=await fetch(manifest.volumeUrl);
  if(!compressed.ok)throw new Error('The anatomy labels could not load.');
  // Some asset servers advertise Content-Encoding:gzip and the browser decodes
  // that transport layer. Inspect the bytes before applying file decompression.
  let data=new Uint8Array(await compressed.arrayBuffer());
  if(data[0]===31&&data[1]===139){
   if(!globalThis.DecompressionStream)throw new Error('This browser cannot decompress the anatomy labels.');
   const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
   data=new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if(data.length!==dimensions[0]*dimensions[1]*dimensions[2])throw new Error('The anatomy label data is incomplete.');
  const labels=manifest.labels;
  const palette=labels.map(label=>({id:label.id,color:[1,3,5].map(i=>parseInt(label.color.slice(i,i+2),16)/255)}));
  const sample=sourceNormalizedXYZ=>{
   if(!sourceNormalizedXYZ||sourceNormalizedXYZ.length!==3||sourceNormalizedXYZ.some(v=>!Number.isFinite(v)||v<0||v>1))return 0;
   const p=sourceNormalizedXYZ.map((v,i)=>Math.round(v*(dimensions[i]-1)));
   return data[(p[2]*dimensions[1]+p[1])*dimensions[0]+p[0]];
  };
  return {data,dimensions,labels,palette,manifest,sample};
 })();
 anatomyPromises.set(manifestUrl,anatomyPromise);
 try{return await anatomyPromise;}catch(error){if(anatomyPromises.get(manifestUrl)===anatomyPromise)anatomyPromises.delete(manifestUrl);throw error;}
}
