/** Immutable scan images, protected by this Site's existing owner-private access boundary. */
const PREFIX='hoa-heart/s2-v4/';
const URL_PREFIX='/api/ultra/v4/';
const response=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const digestHex=bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');

async function readBounded(request,length){
 const declared=request.headers.get('content-length');
 if(declared!==null&&Number(declared)!==length)throw new Error('size');
 const reader=request.body?.getReader();if(!reader)throw new Error('size');
 const data=new Uint8Array(length);let used=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;
   if(used+value.length>length)throw new Error('size');data.set(value,used);used+=value.length;
  }
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 if(used!==length)throw new Error('size');return data;
}

export async function ultraRequest(request,bucket,index,{uploadsEnabled=false,route=URL_PREFIX,prefix=PREFIX,specimen='LADAF-2021-17',spacingUm=79.4,sourceScale='s2'}={}){
 const pathname=new URL(request.url).pathname;if(!pathname.startsWith(route))return null;
 if(!bucket)return response({error:'Scan storage is unavailable.'},503);
 const name=pathname.slice(route.length);
 if(name==='status'&&request.method==='GET'){
  const found=new Map();let cursor;
  do{const page=await bucket.list({prefix,limit:1000,include:['customMetadata'],...(cursor?{cursor}:{})});
   for(const item of page.objects)found.set(item.key.slice(prefix.length),item);
   cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
  const missing=[],mismatched=[];let bytes=0;
  for(const [path,expected]of Object.entries(index)){
   const item=found.get(path);if(!item)missing.push(path);
   else if(item.size!==expected.bytes||item.customMetadata?.sha256!==expected.sha256)mismatched.push(path);
   else bytes+=item.size;
  }
  return response({complete:!missing.length&&!mismatched.length,expected:Object.keys(index).length,verified:Object.keys(index).length-missing.length-mismatched.length,bytes,missingCount:missing.length,mismatchCount:mismatched.length,missing:missing.slice(0,10),mismatched:mismatched.slice(0,10),uploadsEnabled});
 }
 const expected=Object.hasOwn(index,name)?index[name]:null;
 if(!expected)return response({error:'Unknown scan image.'},404);
 const key=prefix+name;
 if(request.method==='PUT'){
  if(!uploadsEnabled)return response({error:'This scan collection is read-only.'},405);
  if(!Number.isInteger(expected.bytes)||expected.bytes<12||expected.bytes>4*1024*1024)return response({error:'Invalid image manifest.'},500);
  let data;try{data=await readBounded(request,expected.bytes);}catch{return response({error:'Image length does not match the manifest.'},400);}
  const sha256=digestHex(await crypto.subtle.digest('SHA-256',data));
  if(sha256!==expected.sha256)return response({error:'Image checksum does not match the manifest.'},400);
  const existing=await bucket.head(key);
  if(existing){
   if(existing.size!==expected.bytes||existing.customMetadata?.sha256!==sha256)return response({error:'An immutable image conflicts with the manifest.'},409);
   return new Response(null,{status:204});
  }
  await bucket.put(key,data,{sha256,httpMetadata:{contentType:'image/webp',cacheControl:'private, max-age=31536000, immutable'},customMetadata:{sha256,specimen,sourceScale,spacingUm:String(spacingUm)}});
  return new Response(null,{status:201});
 }
 if(request.method!=='GET'&&request.method!=='HEAD')return response({error:'Method not allowed.'},405);
 const object=request.method==='HEAD'?await bucket.head(key):await bucket.get(key);
 if(!object)return response({error:'This scan image is not ready.'},503);
 if(object.size!==expected.bytes||object.customMetadata?.sha256!==expected.sha256){await object.body?.cancel();return response({error:'Scan image integrity check failed.'},503);}
 const headers=new Headers({'content-type':'image/webp','content-length':String(object.size),'cache-control':'private, max-age=31536000, immutable','etag':object.httpEtag,'x-content-sha256':expected.sha256,'x-content-type-options':'nosniff'});
 if(request.headers.get('if-none-match')===object.httpEtag){await object.body?.cancel();return new Response(null,{status:304,headers});}
 return new Response(request.method==='HEAD'?null:object.body,{headers});
}
