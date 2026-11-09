/** Export the actual bounded loader's arrays for independent native verification. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,webcrypto} from 'node:crypto';
import {loadMobileLumenAtlas} from '../../public/mobile-lumen-atlas.js';

globalThis.crypto ||= webcrypto;
const output=process.argv[2];
if(!output||!output.startsWith('/'))throw new Error('Pass an absolute scratch output directory.');
const publicRoot=new URL('../../public/',import.meta.url),requests=[];
const fetcher=async(url,{signal}={})=>{
 signal?.throwIfAborted();requests.push(String(url));
 const bytes=await readFile(new URL(String(url).replace(/^\.\//,''),publicRoot));
 signal?.throwIfAborted();return new Response(bytes);
};
const started=performance.now(),collection=await loadMobileLumenAtlas({fetcher});
if(!(collection.index instanceof Uint32Array)||!(collection.payload instanceof Uint8Array))throw new Error('Unexpected atlas output.');
if(collection.sourceMasks?.size)throw new Error('The mobile atlas retained dense source masks.');
const index=Buffer.from(collection.index.buffer,collection.index.byteOffset,collection.index.byteLength);
const payload=Buffer.from(collection.payload.buffer,collection.payload.byteOffset,collection.payload.byteLength);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(output,{recursive:true});
await Promise.all([
 writeFile(resolve(output,'manifest.json'),JSON.stringify(collection.manifest,null,2)+'\n'),
 writeFile(resolve(output,'index.raw'),index),
 writeFile(resolve(output,'payload.raw'),payload),
]);
const runtimeHashes={};
for(const filename of ['mobile-lumen-atlas.js','reviewed-mask-atlas.js','lumen-cleanup-v23.js','volume-picking.js']){
 runtimeHashes[filename]=hash(await readFile(new URL(filename,publicRoot)));
}
const report={passed:true,output,requests,indexBytes:index.byteLength,payloadBytes:payload.byteLength,
 indexSha256:hash(index),payloadSha256:hash(payload),retainedDenseMasks:collection.sourceMasks?.size||0,
 fields:collection.manifest.fields.map(f=>f.id),runtimeHashes,elapsedMs:performance.now()-started,
 scope:'Production loader with hash-verified local source transport. This elapsed time is not network or iPhone performance.'};
await writeFile(resolve(output,'runtime-export.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
