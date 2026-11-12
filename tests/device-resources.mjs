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
  const p=policy(nav);assert.equal(p.constrained,true);assert.equal(p.allowUltraSurface,true);
  assert.equal(p.defaultSurface,'gentle');assert.equal(p.startupSurface,'detail');assert.equal(p.maxRenderPixels,1000000);
  assert.ok(p.fineBrickBytes<=64*1024**2);assert.equal(p.fineBackground,1);
  assert.equal(p.surfaceLookahead,false);assert.equal(p.sparseReviewedMasks,true);assert.equal(p.boundedSurfaceHash,true);
  assert.equal(permittedSurface('gentle',p),'gentle');assert.equal(permittedSurface('volume',p),'volume');
 }
});

test('desktop fidelity is independent of a small browser window',()=>{
 for(const nav of [
  {userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0',platform:'MacIntel',maxTouchPoints:0},
  {userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',deviceMemory:8,maxTouchPoints:10},
 ]){const p=policy(nav);assert.equal(p.defaultSurface,'gentle');assert.equal(p.allowUltraSurface,true);}
 const limited=policy({userAgent:'Desktop',deviceMemory:2});assert.equal(limited.defaultSurface,'gentle');assert.equal(limited.startupSurface,'balanced');
 assert.equal(limited.fineBrickBytes,48*1024**2);
});

test('real Ultra is admitted on mobile while invalid and recovery allocations remain bounded',()=>{
 const small=JSON.parse(readFileSync(new URL('../public/assets/fine-surface-v19/manifest.json',import.meta.url)));
 const full=JSON.parse(readFileSync(new URL('../public/assets/display-compact-v29/surface-manifest.json',import.meta.url))).lods[0];
 const mobile=policy({userAgent:'iPhone'}),desktop=policy({userAgent:'Desktop',deviceMemory:8});
 assert.equal(full.decodedBytes,437470524);
 for(const lod of small.lods)assert.doesNotThrow(()=>assertSurfaceBudget(lod,mobile));
 assert.doesNotThrow(()=>assertSurfaceBudget(full,mobile));
 assert.doesNotThrow(()=>assertSurfaceBudget(full,desktop));
 const recovery=getDeviceResourcePolicy({navigator:{userAgent:'iPhone'},recovery:true});
 assert.equal(recovery.defaultSurface,'balanced');assert.equal(recovery.allowUltraSurface,false);assert.equal(permittedSurface('gentle',recovery),'balanced');
 assert.throws(()=>assertSurfaceBudget(full,recovery),/device memory budget/);
 assert.throws(()=>assertSurfaceBudget({decodedBytes:513*1024**2},mobile),/device memory budget/);
 assert.throws(()=>assertSurfaceBudget({decodedBytes:Infinity},desktop));
 assert.throws(()=>assertSurfaceBudget({decodedBytes:-1},desktop));
});

test('new visits start compact even on capable desktops while explicit Ultra stays available',()=>{
 const p=policy({userAgent:'Desktop',deviceMemory:8,hardwareConcurrency:8});
 assert.equal(p.startupSurface,'detail');assert.equal(p.defaultSurface,'gentle');assert.equal(permittedSurface('gentle',p),'gentle');
 assert.equal(p.sparseReviewedMasks,false);assert.equal(p.boundedSurfaceHash,false);
 const low=policy({userAgent:'Desktop',deviceMemory:2,hardwareConcurrency:8});
 assert.equal(low.startupSurface,'balanced');assert.equal(permittedSurface('gentle',low),'gentle');
});

test('low-core desktops retain Ultra eligibility with bounded scheduling and unknown memory remains eligible',()=>{
 const old=policy({userAgent:'Desktop',deviceMemory:8,hardwareConcurrency:4});
 assert.equal(old.tier,'limited-cpu');assert.equal(old.allowUltraSurface,true);assert.equal(old.maxRenderPixels,1000000);
 assert.equal(permittedSurface('gentle',old),'gentle');assert.equal(old.fineBrickBytes,64*1024**2);
 const unknown=policy({userAgent:'Macintosh',platform:'MacIntel',hardwareConcurrency:8});
 assert.equal(unknown.tier,'unknown-memory');assert.equal(unknown.allowUltraSurface,true);
 assert.equal(unknown.startupSurface,'detail');assert.equal(unknown.fineBrickBytes,128*1024**2);
 assert.equal(unknown.maxRenderPixels,2000000);assert.equal(unknown.fineBackground,1);
});
