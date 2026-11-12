/** SHA-256 for large, already resident surface buffers without a full input copy.
 * Work yields between bounded chunks so lab priority and termination remain
 * responsive. Small transport blocks still use native Web Crypto in the worker.
 */
const K=new Uint32Array([
 0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
 0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
 0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
 0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
 0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
 0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
 0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
 0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotate=(v,n)=>(v>>>n)|(v<<(32-n));
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));

// Per job: 8 state words, 64 schedule words, at most two padding blocks.
// The immutable round constants are shared; the JS fallback only views input.
export const SURFACE_HASH_WORKING_BYTES=32+256+128;
// One shared fixed page for every accelerated hash in this worker. An update
// copies at most 63 KiB, completes synchronously, and restores its own state.
// No whole input is retained, and no WebAssembly memory growth is permitted.
export const SURFACE_HASH_ACCELERATOR_BYTES=65536;
const HASH_INPUT_OFFSET=1024,HASH_INPUT_BYTES=SURFACE_HASH_ACCELERATOR_BYTES-HASH_INPUT_OFFSET;
let surfaceHashBackend=null,surfaceHashInitialization=null;

// BEGIN GENERATED SURFACE SHA-256 WASM
// Rebuild with python3 scripts/build-surface-sha256-v53.py.
const surfaceHashWasmBase64=
 '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'+
 'IQEMAAsLCw==';
// END GENERATED SURFACE SHA-256 WASM

/** Optional scalar accelerator, embedded so loading it never opens a request.
 * Compilation/CSP/unsupported-engine failures retain the exact JS algorithm.
 * The finite setup deadline also covers a compiler promise that never settles.
 */
export function initializeSurfaceHash({timeoutMs=2000}={}){
 if(surfaceHashInitialization)return surfaceHashInitialization;
 surfaceHashInitialization=(async()=>{
  if(typeof globalThis.WebAssembly?.instantiate!=='function'||typeof globalThis.atob!=='function')return false;
  let timer;
  try{
   if(!Number.isFinite(timeoutMs)||timeoutMs<0)return false;
   const encoded=atob(surfaceHashWasmBase64),binary=new Uint8Array(encoded.length);
   for(let i=0;i<encoded.length;i++)binary[i]=encoded.charCodeAt(i);
   const pending=WebAssembly.instantiate(binary).then(({instance})=>{
    const {memory,compress}=instance.exports;
    if(memory.buffer.byteLength!==SURFACE_HASH_ACCELERATOR_BYTES||typeof compress!=='function')throw new Error('Invalid surface hash accelerator.');
    const input=new Uint8Array(memory.buffer),stateView=new DataView(memory.buffer,0,32);
    const backend={active:true,compress(state,bytes,start,end){
     // State belongs to the caller. Commit it only after every bounded batch
     // succeeds, so a runtime failure can repeat this update in JS exactly.
     for(let i=0;i<8;i++)stateView.setUint32(i*4,state[i],true);
     for(let offset=start;offset<end;){
      const count=Math.min(HASH_INPUT_BYTES,end-offset);
      input.set(bytes.subarray(offset,offset+count),HASH_INPUT_OFFSET);compress(count);offset+=count;
     }
     for(let i=0;i<8;i++)state[i]=stateView.getUint32(i*4,true);
    }};
    // An independent published SHA-256 vector guards the embedded module
    // before any source identity depends on it. Padding remains in JS.
    const state=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const block=new Uint8Array(64);block.set([97,98,99,128]);block[63]=24;
    backend.compress(state,block,0,64);
    if(Array.from(state,v=>v.toString(16).padStart(8,'0')).join('')!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')throw new Error('Surface hash accelerator self-check failed.');
    return backend;
   });
   const backend=await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]);
   if(!backend)return false;
   surfaceHashBackend=backend;return true;
  }catch{return false;}
  finally{clearTimeout(timer);}
 })();
 return surfaceHashInitialization;
}

/** Incremental identity check for a surface which is never resident in full.
 * update() consumes the caller's bytes synchronously and retains at most the
 * final incomplete SHA block. Transferring those bytes afterwards is safe.
 */
export class SurfaceSha256{
 constructor(){
  this.state=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  this.words=new Uint32Array(64);this.tail=new Uint8Array(128);this.tailView=new DataView(this.tail.buffer);
  this.length=0;this.pending=0;this.result=null;this.backend=surfaceHashBackend;
 }
 compress(view,offset){
  const words=this.words,state=this.state;
  for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4,false);
  for(let i=16;i<64;i++){
   const x=words[i-15],y=words[i-2],s0=rotate(x,7)^rotate(x,18)^(x>>>3),s1=rotate(y,17)^rotate(y,19)^(y>>>10);
   words[i]=(words[i-16]+s0+words[i-7]+s1)>>>0;
  }
  let a=state[0],b=state[1],c=state[2],d=state[3],e=state[4],f=state[5],g=state[6],h=state[7];
  for(let i=0;i<64;i++){
   const s1=rotate(e,6)^rotate(e,11)^rotate(e,25),choice=(e&f)^(~e&g),t1=(h+s1+choice+K[i]+words[i])>>>0;
   const s0=rotate(a,2)^rotate(a,13)^rotate(a,22),majority=(a&b)^(a&c)^(b&c),t2=(s0+majority)>>>0;
   h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
  }
  state[0]+=a;state[1]+=b;state[2]+=c;state[3]+=d;state[4]+=e;state[5]+=f;state[6]+=g;state[7]+=h;
 }
 update(bytes){
  if(this.result!==null)throw new Error('Surface SHA-256 has already completed.');
  if(!(bytes instanceof Uint8Array))throw new TypeError('Surface SHA-256 requires bytes.');
  if(!Number.isSafeInteger(this.length+bytes.length))throw new RangeError('Surface SHA-256 input is too large.');
  this.length+=bytes.length;let offset=0;
  if(this.pending){
   const take=Math.min(64-this.pending,bytes.length);this.tail.set(bytes.subarray(0,take),this.pending);this.pending+=take;offset=take;
   if(this.pending===64){this.compress(this.tailView,0);this.pending=0;}
  }
  const end=bytes.length-(bytes.length-offset)%64;
  if(end>offset&&this.backend?.active){
   try{this.backend.compress(this.state,bytes,offset,end);offset=end;}
   catch{
    // The accelerator commits no state on a failed call. Disable it for this
    // worker and process the same bytes with the unchanged JS implementation.
    this.backend.active=false;surfaceHashBackend=null;surfaceHashInitialization=Promise.resolve(false);
   }
  }
  if(offset<end){
   const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
   for(;offset<end;offset+=64)this.compress(view,offset);
  }
  if(offset<bytes.length){this.pending=bytes.length-offset;this.tail.set(bytes.subarray(offset),0);}
  return this;
 }
 digest(){
  if(this.result!==null)return this.result;
  this.tail.fill(0,this.pending);this.tail[this.pending]=0x80;
  const length=this.pending<56?64:128;
  this.tailView.setUint32(length-8,Math.floor(this.length/0x20000000),false);
  this.tailView.setUint32(length-4,(this.length*8)>>>0,false);
  this.compress(this.tailView,0);if(length===128)this.compress(this.tailView,64);
  this.result=Array.from(this.state,v=>v.toString(16).padStart(8,'0')).join('');return this.result;
 }
}

export async function sha256Surface(bytes,{chunkBytes=1024*1024,waitForWorkspace=async()=>{},onProgress=()=>{},signal}={}){
 if(!(bytes instanceof Uint8Array))throw new TypeError('Surface SHA-256 requires bytes.');
 if(!Number.isSafeInteger(chunkBytes)||chunkBytes<64||chunkBytes>2*1024*1024||chunkBytes%64)throw new RangeError('Invalid surface SHA-256 work budget.');
 const current=()=>signal?.throwIfAborted();current();
 await initializeSurfaceHash();current();
 const hash=new SurfaceSha256();
 const fullEnd=bytes.length-bytes.length%64;let offset=0;
 while(offset<fullEnd){
  current();await waitForWorkspace();current();
  const end=Math.min(fullEnd,offset+chunkBytes);
  hash.update(bytes.subarray(offset,end));offset=end;
  onProgress(offset,bytes.length);current();await yieldTask();current();
 }
 await waitForWorkspace();current();
 hash.update(bytes.subarray(offset));const result=hash.digest();
 onProgress(bytes.length,bytes.length);current();
 return result;
}
