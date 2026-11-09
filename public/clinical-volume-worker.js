/** Native-grid clinical frame preparation, isolated from scrolling and orbit. */
self.onmessage=async({data})=>{
 try{
  const response=await fetch(data.url,{priority:data.priority||'high'});
  if(!response.ok)throw new Error('Frame download failed ('+response.status+').');
  let bytes=new Uint8Array(await response.arrayBuffer());
  if(data.sha256){const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');if(actual!==data.sha256)throw new Error('Frame checksum did not match the measured source.');}
  if(bytes[0]===31&&bytes[1]===139)bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  if(bytes.length!==data.decodedBytes)throw new Error('Frame dimensions do not match the source.');
  self.postMessage({buffer:bytes.buffer},[bytes.buffer]);
 }catch(error){self.postMessage({error:error.message});}
};
