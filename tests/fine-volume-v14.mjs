/** Independent scalar interpolation and local-cache contracts. No browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {planFinePlane,sampleFineBrick} from '../public/ultra-volume-core.js';
import {FineVolumeBackend} from '../public/ultra-volume-backend.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
let seed=417;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const shape=[15,13,11],origin=[3,2,1],full=[21,17,15],B=4,E=B+1,L=Math.max(...full.map(v=>v-1)),spacing=79.4,counts=shape.map(n=>Math.ceil(n/B));
const value=(x,y,z)=>x<0||y<0||z<0||x>=shape[0]||y>=shape[1]||z>=shape[2]?0:50+((x*17+y*23+z*37+x*y*3)%190);
const raw=new Map(),encoded=new Map(),blocks={};
for(let z=0;z<counts[2];z++)for(let y=0;y<counts[1];y++)for(let x=0;x<counts[0];x++){
 const id=String(x+counts[0]*(y+counts[1]*z)),data=new Uint8Array(E**3);
 for(let k=0;k<E;k++)for(let j=0;j<E;j++)for(let i=0;i<E;i++)data[i+E*(j+E*k)]=value(x*B+i,y*B+j,z*B+k);
 const bytes=new Uint8Array(gzipSync(data)),path=id+'.gz';raw.set(id,data);encoded.set(path,bytes);blocks[id]={path,bytes:bytes.length,sha256:sha(bytes),rawSha256:sha(data)};
}
const manifest={schemaVersion:1,codec:'gzip-u8-zyx-positive-halo',brickSize:B,storedEdge:E,decodedBrickBytes:E**3,sourceShapeXYZ:shape,sourceOriginXYZ:origin,fullDimensionsXYZ:full,sourceSpacingUm:spacing,longestMm:L*spacing/1000,brickCountsXYZ:counts,assetBaseUrl:'/fine/',blocks};
function reference(x,y,z){
 if(x<0||y<0||z<0||x>shape[0]-1||y>shape[1]-1||z>shape[2]-1)return 0;
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),f=[x-ix,y-iy,z-iz];let sum=0;
 for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)sum+=value(ix+i,iy+j,iz+k)*(i?f[0]:1-f[0])*(j?f[1]:1-f[1])*(k?f[2]:1-f[2]);
 return Math.round(sum);
}
function world(source){return [(source[0]+origin[0]-(full[0]-1)/2)/L,(source[2]+origin[2]-(full[2]-1)/2)/L,-(source[1]+origin[1]-(full[1]-1)/2)/L];}
const planes=[];
for(const axes of [[[1,0,0],[0,1,0]],[[0,0,-1],[0,1,0]],[[1,0,0],[0,0,-1]]])for(const edge of [0,4,8,10]){const [right,up]=axes,normal=cross(right,up);planes.push({center:world([edge,edge,edge]),right,up,normal,width:1.2,height:1.1});}
for(let i=0;i<180;i++){const right=norm([random()-.5,random()-.5,random()-.5]),normal=norm(cross(right,[random()-.5,random()-.5,random()-.5])),up=norm(cross(normal,right));planes.push({center:world(shape.map(n=>random()*(n-1))),right,up,normal,width:.4+random()*1.2,height:.4+random()*1.2});}

test('scanline clipping agrees with independent trilinear samples across oblique, reversed and exact brick-edge planes',()=>{
 let tested=0,changed=0,max=0;
 for(const plane of planes){const plan=planFinePlane(manifest,plane),out=new Uint8Array(plan.width*plan.height);for(const block of [...plan.blocks].reverse())sampleFineBrick(plan,block,raw.get(block.id),out);
  for(let row=0;row<plan.height;row++)for(let col=0;col<plan.width;col++){
   const p=plan.start.map((v,i)=>v+row*plan.row[i]+col*plan.column[i]),expected=reference(...p),difference=Math.abs(out[col+row*plan.width]-expected);max=Math.max(max,difference);changed+=Number(difference>0);tested++;assert.ok(difference<=1,`Unexpected sample ${difference}: plane ${JSON.stringify(plane)}, point ${p}`);
  }
 }
 assert.ok(tested>50000);assert.ok(changed/tested<.0001,`${changed}/${tested} differ`);assert.ok(max<=1);
});

test('local-only warming never invokes a network fetch and subsequent fine frames reuse decoded data',async()=>{
 let fetches=0,diskReads=0;
 const backend=new FineVolumeBackend(manifest,{baseUrl:'https://test/',fetcher:async()=>{fetches++;throw new Error('No network permitted.');}});
 const items=new Map(Object.values(blocks).map(r=>{const u=new URL('/fine/'+r.path,'https://test/');u.searchParams.set('v',r.sha256.slice(0,16));return [u.href,r.bytes];}));
 backend.disk={items,bytes:0,available:true,async init(){},async get(url){diskReads++;return encoded.get(new URL(url).pathname.split('/').at(-1));},put(){throw new Error('Already cached');},async remove(){}};
 const plane=planes[19],warm=await backend.warmPlane(plane,{localOnly:true,paddingMm:0});assert.ok(warm.ready>0);assert.equal(fetches,0);const reads=diskReads,progress=[];
 const result=await backend.samplePlane(plane,{onProgress:p=>progress.push(p)});assert.equal(result.complete,true);assert.equal(result.sourceSpacingUm,79.4);assert.equal(diskReads,reads);assert.ok(progress[0].local&&progress[0].resident);assert.ok(backend.bytes<=backend.limit);assert.equal(fetches,0);
});

test('an empty local cache does not cause hidden downloads during local-only warming',async()=>{
 let fetches=0;const backend=new FineVolumeBackend(manifest,{baseUrl:'https://test/',fetcher:async()=>{fetches++;throw new Error('Forbidden fetch');}});backend.disk={items:new Map(),bytes:0,available:true,async init(){},async get(){return null;}};
 const warmed=await backend.warmPlane(planes[19],{localOnly:true,paddingMm:0});assert.equal(warmed.ready,0);assert.equal(backend.bytes,0);assert.equal(fetches,0);
});

test('decoded memory remains bounded with explicitly constrained memory',async()=>{
 const limit=5*E**3,backend=new FineVolumeBackend(manifest,{baseUrl:'https://test/',decodedLimit:limit,fetcher:async url=>new Response(encoded.get(new URL(url).pathname.split('/').at(-1)))});
 const result=await backend.samplePlane(planes[19]);assert.equal(result.complete,true);assert.ok(backend.bytes<=limit);assert.ok(backend.cache.size<=5);
});
