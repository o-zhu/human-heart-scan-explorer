/** Immutable component visibility labels. Retained positions/normals never change. */
const MANIFEST='./assets/cleanup-v26/debris-manifest.json';
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');

async function bounded(stream,length,signal){
 signal?.throwIfAborted();
 if(!stream)throw new Error('The debris filter download is empty.');
 const out=new Uint8Array(length),reader=stream.getReader();let used=0;
 try{
  for(;;){signal?.throwIfAborted();const {value,done}=await reader.read();signal?.throwIfAborted();if(done)break;if(used+value.length>length)throw new Error('The debris filter length did not match.');out.set(value,used);used+=value.length;}
  if(used!==length)throw new Error('The debris filter length did not match.');
 }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 return out;
}

export async function loadDebrisAttribute(lod,decoded,{fetcher=fetch,signal}={}){
 signal?.throwIfAborted();
 if(lod.id!=='gentle')return null;
 const response=await fetcher(MANIFEST,{signal,priority:'low'});
 signal?.throwIfAborted();
 if(!response.ok)throw new Error('Detached-debris cleanup is unavailable.');
 const manifest=await response.json();
 signal?.throwIfAborted();
 if(manifest.version!==2||manifest.donorId!=='ladaf-2021-17'||!Array.isArray(manifest.profiles))throw new Error('Invalid debris filter metadata.');
 const matches=manifest.profiles.filter(p=>p.lodId===lod.id);
 if(matches.length!==1)throw new Error('The debris filter does not match this surface.');
 const profile=matches[0],item=profile.vertexFlags;
 // The compact transport verifies exact position/index bytes against pinned
 // source identities before exposing this value. Shading-only normal changes
 // must not disable component labels tied to the same original vertex order.
 const geometryIdentity=decoded.geometrySourceSha256||lod.decodedSha256;
 if(profile.sourceDecodedSha256!==geometryIdentity||profile.sourceVertexCount!==decoded.vertexCount||profile.sourceTriangleCount*3!==decoded.indexCount||!hex(profile.sourceDecodedSha256)||!item||item.decodedBytes!==decoded.vertexCount||!Number.isSafeInteger(item.decodedBytes)||item.decodedBytes<1||item.decodedBytes>32*1024*1024||!Number.isSafeInteger(item.compressedBytes)||item.compressedBytes<1||item.compressedBytes>16*1024*1024||!hex(item.sha256)||!hex(item.decodedSha256)||typeof item.url!=='string'||!/^\.\/assets\/cleanup-v26\/debris-[a-z-]+\.raw\.gz$/.test(item.url))throw new Error('The debris filter does not match this surface.');
 const reply=await fetcher(item.url,{signal,priority:'low'});
 signal?.throwIfAborted();
 if(!reply.ok)throw new Error('Detached-debris cleanup download failed.');
 const packed=await bounded(reply.body,item.compressedBytes,signal);
 if(await digest(packed)!==item.sha256)throw new Error('Debris filter checksum did not match.');
 signal?.throwIfAborted();
 const flags=await bounded(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')),item.decodedBytes,signal);
 if(await digest(flags)!==item.decodedSha256)throw new Error('Decoded debris filter checksum did not match.');
 signal?.throwIfAborted();
 for(const flag of flags)if(flag!==0&&flag!==255)throw new Error('Invalid debris filter values.');
 // Every face must have a single component decision: the fragment shader can
 // then discard complete triangles without smoothing, clipping or new edges.
 const indices=new Uint32Array(decoded.buffer,decoded.indexOffset,decoded.indexCount);
 for(let i=0;i<indices.length;i+=3){const a=flags[indices[i]];if(a!==flags[indices[i+1]]||a!==flags[indices[i+2]])throw new Error('The debris filter crosses a retained structure.');}
 decoded.debrisReport={removedTriangles:profile.removedTriangles,removedComponents:profile.removedComponents,sourceDecodedSha256:profile.sourceDecodedSha256};
 return flags;
}
