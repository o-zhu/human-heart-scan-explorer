/** Manifest-bound, immutable fine display bricks behind the existing Site access boundary. */
const PREFIX='hoa-heart/volume-v7/';
const ROUTE='/api/ultra-volume/v7/';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const sha=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
async function boundedBody(request,size){
 const length=request.headers.get('content-length');if(length!==null&&Number(length)!==size)throw new Error('length');
 const reader=request.body?.getReader();if(!reader)throw new Error('body');const data=new Uint8Array(size);let used=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;if(used+value.length>size)throw new Error('length');data.set(value,used);used+=value.length;}if(used!==size)throw new Error('length');return data;}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
export async function fineVolumeRequest(request,bucket,index,{uploadsEnabled=false,route=ROUTE,prefix=PREFIX,specimen='LADAF-2021-17',spacingUm=79.4,sourceScale='s2'}={}){
 const path=new URL(request.url).pathname;if(!path.startsWith(route))return null;
 if(!bucket)return json({error:'Fine scan storage is unavailable.'},503);
 const name=path.slice(route.length);
 if(name==='status'&&request.method==='GET'){
  const found=new Map();let cursor;
  do{const page=await bucket.list({prefix,limit:1000,include:['customMetadata'],...(cursor?{cursor}:{})});for(const item of page.objects)found.set(item.key.slice(prefix.length),item);cursor=page.truncated?page.cursor:undefined;}while(cursor);
  let verified=0,bytes=0;const missing=[],mismatched=[];
  for(const [path,item] of Object.entries(index)){const object=found.get(path);if(!object)missing.push(path);else if(object.size!==item.bytes||object.customMetadata?.sha256!==item.sha256)mismatched.push(path);else{verified++;bytes+=object.size;}}
  return json({complete:!missing.length&&!mismatched.length,expected:Object.keys(index).length,verified,bytes,uploadsEnabled,missingCount:missing.length,mismatchCount:mismatched.length,missing:missing.slice(0,8),mismatched:mismatched.slice(0,8)});
 }
 const entry=Object.hasOwn(index,name)?index[name]:null;if(!entry)return json({error:'Unknown fine scan block.'},404);
 const key=prefix+name;
 if(request.method==='PUT'){
  if(!uploadsEnabled)return json({error:'Fine scan data is read-only.'},405);
  if(!Number.isInteger(entry.bytes)||entry.bytes<20||entry.bytes>1024*1024)return json({error:'Invalid block manifest.'},500);
  let data;try{data=await boundedBody(request,entry.bytes);}catch{return json({error:'Fine scan block size mismatch.'},400);}
  if(await sha(data)!==entry.sha256)return json({error:'Fine scan block checksum mismatch.'},400);
  const old=await bucket.head(key);if(old){if(old.size!==entry.bytes||old.customMetadata?.sha256!==entry.sha256)return json({error:'Immutable fine scan block conflict.'},409);return new Response(null,{status:204});}
  await bucket.put(key,data,{sha256:entry.sha256,httpMetadata:{contentType:'application/octet-stream',cacheControl:'private, max-age=31536000, immutable'},customMetadata:{sha256:entry.sha256,specimen,sourceScale,spacingUm:String(spacingUm),codec:'gzip-u8-zyx-positive-halo'}});
  return new Response(null,{status:201});
 }
 if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed.'},405);
 const object=request.method==='HEAD'?await bucket.head(key):await bucket.get(key);
 if(!object)return json({error:'Fine scan block is not ready.'},503);
 if(object.size!==entry.bytes||object.customMetadata?.sha256!==entry.sha256){await object.body?.cancel();return json({error:'Fine scan block integrity check failed.'},503);}
 const headers=new Headers({'content-type':'application/octet-stream','content-length':String(object.size),'cache-control':'private, max-age=31536000, immutable','etag':object.httpEtag,'x-content-sha256':entry.sha256,'x-content-type-options':'nosniff'});
 if(request.headers.get('if-none-match')===object.httpEtag){await object.body?.cancel();return new Response(null,{status:304,headers});}
 return new Response(request.method==='HEAD'?null:object.body,{headers});
}
