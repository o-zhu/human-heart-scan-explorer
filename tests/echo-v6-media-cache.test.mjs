import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {EchoMediaCache,ECHO_MEDIA_CACHE_BYTES,ECHO_MEDIA_MAX_CLIP_BYTES} from '../public/echo-media-cache.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const clip=(name,bytes=4)=>({id:`tte-${name}`,url:`./assets/echo-media-v6/tte-${name}.mp4`,bytes});
function harness(options={}){
 const calls=[],created=new Map(),revoked=[];let serial=0;
 const cache=new EchoMediaCache({...options,fetcher:(url,init)=>new Promise((resolve,reject)=>{
  const call={url,init,resolve,reject,cancelled:false};calls.push(call);
  call.reply=(data=new Uint8Array(4),{status=200,headers={}}={})=>resolve(new Response(new ReadableStream({
   start(controller){controller.enqueue(data);controller.close();},cancel(){call.cancelled=true;}
  }),{status,headers}));
 }),createURL:blob=>{const url=`blob:test-${++serial}`;created.set(url,blob);return url;},revokeURL:url=>{assert.notEqual(cache.entries.get(cache.activeKey)?.url,url,'An active movie URL must not be revoked.');revoked.push(url);created.delete(url);}});
 return {cache,calls,created,revoked};
}

test('only the selected complete movie is fetched and returned as a local MP4 Blob',async()=>{
 const h=harness(),progress=[];
 const a=h.cache.load(clip('a'),{onProgress:(n,total)=>progress.push([n,total])});
 const duplicate=h.cache.load(clip('a'),{onProgress:(n,total)=>progress.push([n,total])});
 assert.equal(a,duplicate);assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.headers,undefined);
 h.calls[0].reply(Uint8Array.of(1,2,3,4));const entry=await a;
 assert.equal(entry.url,'blob:test-1');assert.equal(h.created.get(entry.url).type,'video/mp4');
 assert.deepEqual(new Uint8Array(await h.created.get(entry.url).arrayBuffer()),Uint8Array.of(1,2,3,4));
 assert.deepEqual(progress.at(-1),[4,4]);assert.equal(h.cache.bytes,4);
 assert.equal(await h.cache.load(clip('a')),entry);assert.equal(h.calls.length,1);h.cache.destroy();
});

test('superseded response is aborted and cannot create an obsolete object URL',async()=>{
 const h=harness();const a=h.cache.load(clip('a'));const rejected=assert.rejects(a,{name:'AbortError'});
 const b=h.cache.load(clip('b'));assert.equal(h.calls[0].init.signal.aborted,true);
 h.calls[0].reply();h.calls[1].reply();await rejected;
 const current=await b;assert.equal(current.id,'tte-b');assert.equal(h.created.size,1);assert.equal(h.calls[0].cancelled,true);h.cache.destroy();
});

test('leaving during a partial transfer cancels the reader and a later request can retry',async()=>{
 const h=harness();let controller,cancelled=false;
 const pending=h.cache.load(clip('a'));const rejected=assert.rejects(pending,{name:'AbortError'});
 h.calls[0].resolve(new Response(new ReadableStream({start(c){controller=c;c.enqueue(Uint8Array.of(1,2));},cancel(){cancelled=true;}})));
 await tick();h.cache.cancel();controller.enqueue(Uint8Array.of(3,4));await rejected;
 assert.equal(cancelled,true);assert.equal(h.created.size,0);
 const retry=h.cache.load(clip('a'));h.calls[1].reply();await retry;h.cache.destroy();
});

test('8 MiB retention and 4 MiB clip limits default correctly; LRU never evicts a pinned source',async()=>{
 const defaults=harness();assert.equal(defaults.cache.maxBytes,ECHO_MEDIA_CACHE_BYTES);assert.equal(defaults.cache.maxClipBytes,ECHO_MEDIA_MAX_CLIP_BYTES);defaults.cache.destroy();
 const h=harness({maxBytes:8,maxClipBytes:4});
 const load=async name=>{const promise=h.cache.load(clip(name));h.calls.at(-1).reply();return promise;};
 const a=await load('a');h.cache.setActive(a);const b=await load('b');
 const c=await load('c');assert.equal(h.cache.bytes,8);assert.deepEqual(h.revoked,[b.url]);assert.equal(h.cache.peek(clip('a')),a);
 h.cache.setActive(null);h.cache.destroy();assert.equal(h.created.size,0);assert.equal(new Set(h.revoked).size,3);
 assert.ok(h.revoked.includes(c.url));assert.equal(h.cache.bytes,0);
});

test('selecting an already cached movie aborts another pending movie',async()=>{
 const h=harness();const first=h.cache.load(clip('a'));h.calls[0].reply();const a=await first;
 const pending=h.cache.load(clip('b'));const rejected=assert.rejects(pending,{name:'AbortError'});
 assert.equal(await h.cache.load(clip('a')),a);assert.equal(h.calls[1].init.signal.aborted,true);
 h.calls[1].reply();await rejected;assert.equal(h.created.size,1);h.cache.destroy();
});

test('bad paths, oversized clips, incorrect headers, truncation and overflow fail within bounds',async()=>{
 const h=harness();
 await assert.rejects(h.cache.load({...clip('a'),url:'https://example.com/movie.mp4'}));
 await assert.rejects(h.cache.load(clip('a',ECHO_MEDIA_MAX_CLIP_BYTES+1)));assert.equal(h.calls.length,0);
 for(const scenario of [
  {data:Uint8Array.of(1,2,3,4),headers:{'content-length':'50'}},
  {data:Uint8Array.of(1,2)},
  {data:Uint8Array.of(1,2,3,4,5)},
  {data:Uint8Array.of(1,2,3,4),status:500}
 ]){
  const promise=h.cache.load(clip('a'));const rejected=assert.rejects(promise);const call=h.calls.at(-1);call.reply(scenario.data,scenario);await rejected;
  assert.equal(call.init.signal.aborted,true);assert.equal(h.created.size,0);assert.equal(h.cache.bytes,0);
 }
 assert.equal(h.calls[0].cancelled,true,'A rejected header cancels the body before a reader is acquired.');h.cache.destroy();
});

test('catalog checksums guard against an unexpected HTML/error payload of the same size',async()=>{
 const h=harness(),data=Uint8Array.of(1,2,3,4),item={...clip('a'),sha256:createHash('sha256').update(data).digest('hex')};
 const wrong=h.cache.load(item);const rejected=assert.rejects(wrong,/checksum/);h.calls[0].reply(Uint8Array.of(4,3,2,1));await rejected;assert.equal(h.created.size,0);
 const right=h.cache.load(item);h.calls[1].reply(data);await right;assert.equal(h.created.size,1);h.cache.destroy();
});

test('destroy aborts late completions and releases all existing URLs exactly once',async()=>{
 const h=harness();const ready=h.cache.load(clip('a'));h.calls[0].reply();await ready;
 const pending=h.cache.load(clip('b'));const rejected=assert.rejects(pending,{name:'AbortError'});
 h.cache.destroy();h.calls[1].reply();await rejected;assert.equal(h.created.size,0);assert.equal(h.revoked.length,1);
 await assert.rejects(h.cache.load(clip('a')),{name:'AbortError'});assert.equal(h.calls.length,2);h.cache.destroy();assert.equal(h.revoked.length,1);
});
