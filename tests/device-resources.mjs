import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getDeviceResourcePolicy,permittedSurface,assertSurfaceBudget} from '../public/device-resources.js';
const policy=navigator=>getDeviceResourcePolicy({navigator});

test('phones and desktop-identified iPads have bounded resources without deviceMemory',()=>{
 for(const nav of [
  {userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',platform:'iPhone'},
  {userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',platform:'iPad'},
  {userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',platform:'MacIntel',maxTouchPoints:5},
  {userAgent:'Mozilla/5.0 (Linux; Android 15; Tablet)',deviceMemory:8},
 ]){
  const p=policy(nav);assert.equal(p.constrained,true);assert.equal(p.allowUltraSurface,false);
  assert.equal(p.defaultSurface,'detail');assert.equal(p.maxRenderPixels,1000000);
  assert.ok(p.fineBrickBytes<=64*1024**2);assert.equal(p.fineBackground,1);
  assert.equal(permittedSurface('gentle',p),'detail');assert.equal(permittedSurface('volume',p),'volume');
 }
});

test('desktop fidelity is independent of a small browser window',()=>{
 for(const nav of [
  {userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0',platform:'MacIntel',maxTouchPoints:0},
  {userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',deviceMemory:8,maxTouchPoints:10},
 ]){const p=policy(nav);assert.equal(p.defaultSurface,'gentle');assert.equal(p.allowUltraSurface,true);}
 const limited=policy({userAgent:'Desktop',deviceMemory:2});assert.equal(limited.defaultSurface,'balanced');
 assert.equal(limited.fineBrickBytes,48*1024**2);
});

test('real deployed surfaces fit the selected budget and Ultra is rejected before allocation',()=>{
 const small=JSON.parse(readFileSync(new URL('../public/assets/fine-surface-v19/manifest.json',import.meta.url)));
 const full=JSON.parse(readFileSync(new URL('../public/assets/display-compact-v29/surface-manifest.json',import.meta.url))).lods[0];
 const mobile=policy({userAgent:'iPhone'}),desktop=policy({userAgent:'Desktop',deviceMemory:8});
 assert.equal(full.decodedBytes,437470524);
 for(const lod of small.lods)assert.doesNotThrow(()=>assertSurfaceBudget(lod,mobile));
 assert.throws(()=>assertSurfaceBudget(full,mobile),/device memory budget/);
 assert.doesNotThrow(()=>assertSurfaceBudget(full,desktop));
 assert.throws(()=>assertSurfaceBudget({decodedBytes:Infinity},desktop));
 assert.throws(()=>assertSurfaceBudget({decodedBytes:-1},desktop));
});

test('new visits start compact even on capable desktops while explicit Ultra stays available',()=>{
 const p=policy({userAgent:'Desktop',deviceMemory:8,hardwareConcurrency:8});
 assert.equal(p.startupSurface,'detail');assert.equal(p.defaultSurface,'gentle');assert.equal(permittedSurface('gentle',p),'gentle');
 const low=policy({userAgent:'Desktop',deviceMemory:2,hardwareConcurrency:8});
 assert.equal(low.startupSurface,'balanced');assert.equal(permittedSurface('gentle',low),'balanced');
});

test('older low-core desktops cannot start the full model and unknown memory gets bounded caches/output',()=>{
 const old=policy({userAgent:'Desktop',deviceMemory:8,hardwareConcurrency:4});
 assert.equal(old.tier,'limited-cpu');assert.equal(old.allowUltraSurface,false);assert.equal(old.maxRenderPixels,1000000);
 assert.equal(permittedSurface('gentle',old),'detail');assert.equal(old.fineBrickBytes,64*1024**2);
 const unknown=policy({userAgent:'Macintosh',platform:'MacIntel',hardwareConcurrency:8});
 assert.equal(unknown.tier,'unknown-memory');assert.equal(unknown.allowUltraSurface,true);
 assert.equal(unknown.startupSurface,'detail');assert.equal(unknown.fineBrickBytes,128*1024**2);
 assert.equal(unknown.maxRenderPixels,2000000);assert.equal(unknown.fineBackground,1);
});
