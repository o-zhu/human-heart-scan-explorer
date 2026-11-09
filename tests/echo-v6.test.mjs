import test from 'node:test';
import assert from 'node:assert/strict';
import {EchoTextureCache,EchoModule,sampleEchoPreview,paintEchoPreview} from '../public/echo.js';
import {buildAnatomyPalette} from '../public/render-styles.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const item=id=>({url:`${id}.webp`,width:4,height:2,spacingUm:79.4,bytes:4});
function network(){
 const calls=[],pending=new Map();
 const fetcher=(url,{signal,priority})=>new Promise((resolve,reject)=>{
  calls.push({url,priority,signal});pending.set(url,{resolve,reject});
  signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{name:'AbortError'})),{once:true});
 });
 const finish=id=>pending.get(`${id}.webp`).resolve({ok:true,blob:async()=>new Blob([id])});
 const decode=async(_blob,metadata)=>({data:new Uint8Array(8).fill(metadata.url.charCodeAt(0)),width:4,height:2,spacingUm:79.4,ultra:true});
 return {calls,pending,fetcher,finish,decode};
}

test('the newest preset starts immediately and superseded speculative transfer is aborted',async()=>{
 const n=network(),cache=new EchoTextureCache({fetcher:n.fetcher,decode:n.decode});
 const a=cache.load(item('a'),{priority:1}).catch(error=>error);
 const b=cache.load(item('b')).catch(error=>error);
 const c=cache.load(item('c')).catch(error=>error);
 assert.deepEqual(n.calls.map(x=>x.url),['a.webp','b.webp','c.webp']);
 assert.equal(n.calls[0].signal.aborted,true);
 assert.equal(n.calls[2].priority,'high');
 n.finish('c');await c;n.finish('b');await b;
 assert.equal((await a).name,'AbortError');
 assert.equal(cache.peek(item('c')).ultra,true);cache.destroy();
});

test('only one speculative fetch runs, pause cancels queued work and preserves ready pixels',async()=>{
 const n=network(),cache=new EchoTextureCache({fetcher:n.fetcher,decode:n.decode});
 const a=cache.load(item('a'),{priority:1}).catch(error=>error);
 const b=cache.load(item('b'),{priority:1}).catch(error=>error);
 assert.deepEqual(n.calls.map(x=>x.url),['a.webp']);
 const c=cache.load(item('c')).catch(error=>error);n.finish('c');await c;
 cache.pause();await Promise.all([a,b]);await tick();
 assert.equal(n.calls.length,2);
 assert.equal(cache.peek(item('c')).data.length,8);
 assert.equal(cache.queue.length,0);assert.equal(cache.running.size,0);cache.destroy();
});

test('decoded LRU enforces the byte budget while retaining the displayed preset',async()=>{
 const n=network(),cache=new EchoTextureCache({maxBytes:8,fetcher:n.fetcher,decode:n.decode});
 const a=cache.load(item('a'));n.finish('a');await a;await tick();
 const b=cache.load(item('b'));n.finish('b');await b;await tick();
 assert.equal(cache.bytes,8);assert.equal(cache.peek(item('a')),null);assert.ok(cache.peek(item('b')));cache.destroy();
});

test('repeated requests share one transfer; failed transfers can be retried',async()=>{
 const n=network(),cache=new EchoTextureCache({fetcher:n.fetcher,decode:n.decode});
 const a=cache.load(item('a')).catch(error=>error),duplicate=cache.load(item('a')).catch(error=>error);
 assert.equal(n.calls.length,1);n.pending.get('a.webp').reject(new Error('offline'));await Promise.all([a,duplicate]);await tick();
 const retry=cache.load(item('a'));assert.equal(n.calls.length,2);n.finish('a');await retry;cache.destroy();
});

test('preview preserves source orientation, reflects a flip and never alters source pixels',()=>{
 const data=Uint8Array.from([1,2,3,4,5,6,7,8,9,10,11,12]);
 const sample={data,width:4,height:3,plane:{center:[0,0,0],right:[1,0,0],up:[0,1,0],width:1,height:1}};
 const regular=sampleEchoPreview(sample,{maxSize:100,extent:[1,1,1]});
 const flipped=sampleEchoPreview(sample,{maxSize:100,extent:[1,1,1],flip:true});
 assert.deepEqual([...regular.intensity],[...data]);assert.deepEqual([...flipped.intensity],[4,3,2,1,8,7,6,5,12,11,10,9]);
 const sparse={...regular,intensity:Uint8Array.from([0,220]),support:Uint8Array.from([1,1]),labels:Uint8Array.from([0,0])};
 const rgba=paintEchoPreview(sparse,{palette:4,threshold:.28,cleanupEnabled:true},1.8,buildAnatomyPalette());
 assert.deepEqual([...rgba.slice(0,4)],[0,0,0,255]);assert.ok(rgba[4]>200);assert.equal(rgba[7],255);assert.equal(data[0],1);
});

test('a slower volume preview cannot replace a finished Ultra cut face',async()=>{
 let resolveVolume;const volume=new Promise(resolve=>{resolveVolume=resolve;});
 const capCalls=[],elements=new Map(),plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.7,height:.9};
 const echo=Object.create(EchoModule.prototype);
 Object.assign(echo,{active:true,requestId:7,sourceSpacingUm:317.6,state:{preset:'a4c'},
  renderer:{setCapData:cap=>capCalls.push(cap)},ensureSampler:()=>({sample:()=>volume}),drawSection:()=>{},message:()=>{},
  $:name=>{if(!elements.has(name))elements.set(name,{dataset:{}});return elements.get(name);}});
 const pending=echo.samplePlane(plane,7,'a4c',true);
 echo.showSample({data:new Uint8Array(4),width:2,height:2,spacingUm:79.4,ultra:true,encodedBytes:4},plane,7,'a4c');
 resolveVolume({data:new Uint8Array(4),width:2,height:2});await pending;
 assert.equal(capCalls.length,1);assert.equal(capCalls[0].spacingUm,79.4);
 echo.showSample({data:new Uint8Array(4),width:2,height:2,spacingUm:317.6},plane,6,'a4c');
 assert.equal(capCalls.length,1);assert.match(elements.get('resolution').textContent,/79.4.*Ultra/);
});
