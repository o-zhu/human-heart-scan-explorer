/** Native-style Window receiver checks without a browser or Node-global patches. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const activityUrl=new URL('../public/download-priority.js',import.meta.url);
const echoUrl=new URL('../public/echo-texture-cache.js',import.meta.url);
const [activitySource,echoSource]=await Promise.all([readFile(activityUrl,'utf8'),readFile(echoUrl,'utf8')]);

function realm(){
  const context=vm.createContext({AbortController});
  vm.runInContext(`
    'use strict';
    let time=0,serial=0;
    const timers=new Map(),timerCalls=[],fetchCalls=[],decodeCalls=[];
    function requireWindow(receiver,name){
      if(receiver!==globalThis)throw new TypeError('Can only call Window.'+name+' on instances of Window');
    }
    globalThis.window=globalThis;
    globalThis.performance={now(){return time;}};
    globalThis.setTimeout=function(callback,delay,...args){
      requireWindow(this,'setTimeout');
      const id=++serial;timerCalls.push({method:'setTimeout',id,delay});
      timers.set(id,{callback,args,at:time+delay});return id;
    };
    globalThis.clearTimeout=function(id){
      requireWindow(this,'clearTimeout');timerCalls.push({method:'clearTimeout',id});timers.delete(id);
    };
    globalThis.fetch=function(url,options){
      requireWindow(this,'fetch');fetchCalls.push({url,options});
      return Promise.resolve({ok:true,status:200,blob:async()=>new Uint8Array([31,73,127])});
    };
    globalThis.fixture={timers,timerCalls,fetchCalls,decodeCalls,
      advance(ms){
        const end=time+ms;
        for(;;){
          const next=[...timers].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
          if(!next)break;
          const [id,job]=next;timers.delete(id);time=job.at;
          Reflect.apply(job.callback,globalThis,job.args);
        }
        time=end;
      },
      async decode(blob,item,signal){
        decodeCalls.push({url:item.url,aborted:signal.aborted});
        return {data:new Uint8Array(blob),width:3,height:1};
      }
    };
  `,context);
  return context;
}

function loadModule(context,source,url,exports){
  // Import dependencies are not exercised by these two classes. Keep the actual
  // implementations, but make their declarations parse in a strict VM closure.
  // Calling the strict closure with undefined also preserves module-level this.
  const body=source.replace(/^import [^\n]*;\r?\n/gm,'').replace(/^export /gm,'')
    .replace(/\bimport\.meta\.url\b/g,JSON.stringify(url.href));
  return vm.runInContext(`(function(){'use strict';\n${body}\nreturn {${exports}};}).call(undefined)`,context,{filename:url.pathname});
}

function activityRealm(){
  const context=realm();
  return {context,fixture:context.fixture,...loadModule(context,activitySource,activityUrl,'ScanActivity,scanActivity')};
}

test('Default clearTimeout keeps the Window receiver during foreground startup and disposal',()=>{
  const {context,fixture,scanActivity:activity}=activityRealm();
  // Prove that the fixture rejects the borrowed-method pattern used in v8.
  assert.throws(()=>vm.runInContext('globalThis.clearTimeout.call({},undefined)',context),/Window\.clearTimeout/);
  try{
    const release=activity.beginForeground('volume');
    assert.equal(activity.getState().viewerReady,false);
    assert.equal(activity.getState().foregroundCount,1);
    assert.equal(fixture.timers.size,0,'initial volume work does not open the idle gate');
    release();release();
    assert.equal(activity.getState().foregroundCount,0);
    assert.equal(fixture.timerCalls.filter(call=>call.method==='clearTimeout').length,2);
  }finally{activity.dispose();}
  assert.equal(fixture.timerCalls.at(-1).method,'clearTimeout');
});

test('Default setTimeout keeps the Window receiver through readiness and both idle thresholds',()=>{
  const {context,fixture,scanActivity:activity}=activityRealm();
  assert.throws(()=>vm.runInContext('globalThis.setTimeout.call({},()=>{},1)',context),/Window\.setTimeout/);
  try{
    activity.setViewerReady(true);
    assert.equal(fixture.timers.size,1);
    fixture.advance(179);assert.equal(activity.getState().allowPrefetch,false);
    fixture.advance(1);assert.equal(activity.getState().allowPrefetch,true);
    assert.equal(activity.getState().allowBackground,false);
    fixture.advance(1619);assert.equal(activity.getState().allowBackground,false);
    fixture.advance(1);assert.equal(activity.getState().allowBackground,true);
    assert.equal(fixture.timers.size,0);
    assert.equal(fixture.timerCalls.filter(call=>call.method==='setTimeout').length,2);
  }finally{activity.dispose();}
});

test('Default timers preserve gesture preemption, idle resumption and cancellation on disposal',()=>{
  const {fixture,scanActivity:activity}=activityRealm();
  try{
    activity.setViewerReady(true);
    activity.beginGesture(7);
    assert.equal(fixture.timers.size,0);
    fixture.advance(5000);assert.equal(activity.getState().allowBackground,false);
    activity.endGesture(7);assert.equal(fixture.timers.size,1);
    fixture.advance(180);assert.equal(activity.getState().allowPrefetch,true);
    fixture.advance(1620);assert.equal(activity.getState().allowBackground,true);
    activity.noteInteraction();assert.equal(fixture.timers.size,1);
  }finally{activity.dispose();}
  assert.equal(fixture.timers.size,0,'dispose cancels the pending native timer');
  const calls=fixture.timerCalls.length;fixture.advance(5000);
  assert.equal(fixture.timerCalls.length,calls,'no disposed callback is left scheduled');
  assert.equal(activity.getState().allowBackground,false);
});

test('Default Echo fetch keeps the Window receiver and returns a decoded reusable selected texture',async()=>{
  const context=realm(),{EchoTextureCache}=loadModule(context,echoSource,echoUrl,'EchoTextureCache');
  assert.throws(()=>vm.runInContext('globalThis.fetch.call({},"/invalid")',context),/Window\.fetch/);
  const cache=new EchoTextureCache({decode:context.fixture.decode});
  const item={url:'/assets/receiver-test.webp',width:3,height:1};
  try{
    const result=await cache.load(item);
    assert.deepEqual(Array.from(result.data),[31,73,127]);
    assert.equal(context.fixture.fetchCalls.length,1);
    assert.equal(context.fixture.fetchCalls[0].url,item.url);
    assert.equal(context.fixture.fetchCalls[0].options.priority,'high');
    assert.equal(context.fixture.decodeCalls.length,1);
    assert.equal(context.fixture.decodeCalls[0].aborted,false);
    assert.equal(cache.peek(item),result);
    assert.equal(await cache.load(item),result);
    assert.equal(context.fixture.fetchCalls.length,1,'cached selection reuses the decoded image');
  }finally{cache.destroy();}
});
