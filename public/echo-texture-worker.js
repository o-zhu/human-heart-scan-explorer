// Source grayscale WebP → R8 density. This work stays off the interactive UI thread.
const cancelled=new Set(),active=new Set();
self.onmessage=async({data:message})=>{
 const {id}=message;
 if(message.type==='cancel'){if(active.has(id))cancelled.add(id);return;}
 if(message.type!=='decode')return;
 if(typeof OffscreenCanvas!=='function'||typeof createImageBitmap!=='function'){
  self.postMessage({id,unsupported:true});return;
 }
 active.add(id);let bitmap;
 try{
  bitmap=await createImageBitmap(message.blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
  if(cancelled.delete(id))return;
  if(bitmap.width!==message.width||bitmap.height!==message.height)throw new Error('Section dimensions do not match the manifest.');
  const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(bitmap,0,0);
  const rgba=context.getImageData(0,0,bitmap.width,bitmap.height).data;
  const data=new Uint8Array(bitmap.width*bitmap.height);
  for(let i=0;i<data.length;i++)data[i]=rgba[i*4+3]?rgba[i*4]:0;
  if(cancelled.delete(id))return;
  self.postMessage({id,data:data.buffer,width:bitmap.width,height:bitmap.height},[data.buffer]);
 }catch(error){if(!cancelled.delete(id))self.postMessage({id,error:error.message||'Section decoding failed.'});}
 finally{bitmap?.close();active.delete(id);cancelled.delete(id);}
};
