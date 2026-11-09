import {buildAcceleration} from './render-v5-acceleration.js';

function undoPredictor(data,kind,nx,ny){
 if(!kind||kind==='none')return;
 if(kind==='delta-x'){
  for(let row=0;row<data.length;row+=nx)for(let x=1;x<nx;x++)data[row+x]=(data[row+x]+data[row+x-1])&255;
 }else if(kind==='delta-z'){
  const plane=nx*ny;for(let i=plane;i<data.length;i++)data[i]=(data[i]+data[i-plane])&255;
 }else throw new Error('Unsupported lossless scan predictor.');
}

function cropForGPU(data,dimensions,bounds){
 const offset=bounds.map(([lo])=>Math.max(0,lo-1)),end=bounds.map(([,hi],axis)=>Math.min(dimensions[axis]-1,hi+1));
 const size=end.map((hi,axis)=>hi-offset[axis]+1),[cx,cy,cz]=size,[nx,ny]=dimensions,crop=new Uint8Array(cx*cy*cz);
 for(let z=0;z<cz;z++)for(let y=0;y<cy;y++){
  const start=offset[0]+nx*(y+offset[1]+ny*(z+offset[2]));crop.set(data.subarray(start,start+cx),cx*(y+cy*z));
 }
 return {data:crop,dimensions:size,offset};
}

self.onmessage=async event=>{
 const {level,original,baseUrl,gpuCrop:wantCrop,acceleration:wantAcceleration=true}=event.data,parts=original?(level.originalParts||level.parts):level.parts;
 let received=0,lastProgress=0;
 const total=original?(level.originalCompressedBytes||level.compressedBytes):level.compressedBytes;
 const report=(phase,force=false)=>{const now=performance.now();if(force||now-lastProgress>40){lastProgress=now;self.postMessage({type:'progress',phase,received,total});}};
 try{
  const started=performance.now(),size=level.dimensions.reduce((a,b)=>a*b,1),data=new Uint8Array(size);let offset=0;
  const [nx,ny]=level.dimensions;
  for(const part of parts){
   const response=await fetch(new URL(part.url,baseUrl),{cache:'force-cache',priority:'high'});
   if(!response.ok)throw new Error(`Scan data could not load (${response.status}).`);
   const reader=response.body?.getReader();if(!reader)throw new Error('Streaming scan loading is unavailable.');
   let first=await reader.read();if(first.done)throw new Error('The scan file is empty.');
   received+=first.value.length;
   if(first.value.length<2){const second=await reader.read();if(!second.done){const joined=new Uint8Array(first.value.length+second.value.length);joined.set(first.value);joined.set(second.value,first.value.length);received+=second.value.length;first={done:false,value:joined};}}
   report('download');
   let firstChunk=first.value;
   // Fetch may already have decoded a Content-Encoding layer. File gzip is
   // decompressed only when its magic bytes are still present.
   let stream=new ReadableStream({
    async pull(controller){
     if(firstChunk){controller.enqueue(firstChunk);firstChunk=null;return;}
     const item=await reader.read();if(item.done){controller.close();return;}
     received+=item.value.length;report('download');controller.enqueue(item.value);
    },cancel(reason){return reader.cancel(reason);}
   });
   if(first.value[0]===31&&first.value[1]===139){
    if(!self.DecompressionStream)throw new Error('This browser cannot decompress the scan.');
    stream=stream.pipeThrough(new DecompressionStream('gzip'));
   }
   const decoded=stream.getReader(),start=offset;
   while(true){const item=await decoded.read();if(item.done)break;if(offset+item.value.length>size)throw new Error('The scan file exceeds its declared size.');data.set(item.value,offset);offset+=item.value.length;}
   if(part.uncompressedBytes&&offset-start!==part.uncompressedBytes)throw new Error('The scan file is incomplete.');
   undoPredictor(data.subarray(start,offset),part.predictor,nx,ny);
  }
  if(offset!==size)throw new Error('The scan volume is incomplete.');
  const decodedAt=performance.now();report('prepare',true);
  const acceleration=wantAcceleration?buildAcceleration(data,level.dimensions):null;
  const gpuCrop=wantCrop&&!original&&level.supportCompressed&&level.supportCompression?.boundsXYZ?cropForGPU(data,level.dimensions,level.supportCompression.boundsXYZ):null;
  const transfers=[data.buffer];if(acceleration?.maxima?.buffer)transfers.push(acceleration.maxima.buffer);
  if(gpuCrop)transfers.push(gpuCrop.data.buffer);
  self.postMessage({type:'ready',data:data.buffer,acceleration,gpuCrop,stats:{receivedBytes:received,decodedBytes:size,gpuTextureBytes:gpuCrop?.data.length||size,decodeMilliseconds:decodedAt-started,accelerationMilliseconds:performance.now()-decodedAt}},transfers);
 }catch(error){self.postMessage({type:'error',message:error?.message||'The scan could not be prepared.'});}
};
