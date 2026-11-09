// Optional workspaces do not belong to the first-heart download/parse path.
const pending=new Map();
const loaders={
 echo:()=>import('./echo.js'),
 probe:()=>import('./probe-lab.js'),
 tee:()=>import('./tee-lab.js'),
 quick:()=>import('./quick-views.js'),
 cpu:()=>import('./cpu-renderer.js')
};
export function loadWorkbenchModule(kind){
 if(!loaders[kind])return Promise.reject(new Error('Unknown heart workspace.'));
 if(!pending.has(kind))pending.set(kind,loaders[kind]().catch(error=>{pending.delete(kind);throw error;}));
 return pending.get(kind);
}
