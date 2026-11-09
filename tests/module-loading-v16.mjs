/** Static production module boundaries and backward-compatible shared exports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {EchoTextureCache as sharedTextureCache, isUltra} from '../public/echo-texture-cache.js';
import {EchoTextureCache as legacyTextureCache} from '../public/echo.js';
import {flowPlane as sharedFlowPlane} from '../public/flow-plane.js';
import {flowPlane as legacyFlowPlane} from '../public/flow-views.js';
import {loadWorkbenchModule} from '../public/workbench-modules.js';

const require=createRequire(import.meta.url);
const {init,parse}=require(require.resolve('es-module-lexer',{paths:[require.resolve('vite')]}));
await init;
const root=fileURLToPath(new URL('../',import.meta.url));
async function staticClosure(entry){
  const pending=[entry],seen=new Set();
  while(pending.length){
    const file=pending.pop();if(seen.has(file))continue;seen.add(file);
    const [imports]=parse(await readFile(path.join(root,file),'utf8'),file);
    for(const item of imports){
      if(item.d!==-1)continue;
      assert.ok(item.n?.startsWith('.'),'Production static import is locally resolvable: '+item.n);
      pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file),item.n.split(/[?#]/,1)[0])));
    }
  }
  return seen;
}

test('initial app graph and automatic Quick Views graph do not import optional workspace implementations',async()=>{
  const forbidden=['tee-lab.js','tee-geometry.js','echo.js','flow-views.js','probe-lab.js','probe-scene.js','cpu-renderer.js','echo-media-cache.js','echo-correspondence.js'];
  for(const entry of ['public/app.js','public/quick-views.js']){
    const closure=await staticClosure(entry);
    for(const file of forbidden)assert.equal(closure.has('public/'+file),false,`${entry} must not eagerly import ${file}`);
    if(entry.endsWith('quick-views.js')){
      assert.equal(closure.has('public/echo-texture-cache.js'),true);
      assert.equal(closure.has('public/flow-plane.js'),true);
    }
  }
});

test('old cache and flow-plane exports refer to the same extracted implementations',()=>{
  assert.equal(legacyTextureCache,sharedTextureCache);
  assert.equal(legacyFlowPlane,sharedFlowPlane);
  assert.equal(isUltra(79.4,79.4),true);
  assert.equal(isUltra(79.56,79.56,79.56),true);
  assert.equal(isUltra(317.6,79.4),false,'Upsampling cannot be labeled native Ultra');
  assert.equal(isUltra(79.4,158.8),false,'A coarser output grid cannot be labeled native Ultra');
});

test('concurrent lazy Quick Views requests share one module result',async()=>{
  const a=loadWorkbenchModule('quick'),b=loadWorkbenchModule('quick');
  assert.equal(a,b);
  const [left,right]=await Promise.all([a,b]);
  assert.equal(left,right);
  assert.equal(typeof left.QuickViews,'function');
  await assert.rejects(loadWorkbenchModule('unknown'),/Unknown heart workspace/);
});
