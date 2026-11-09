/** Software context uses the depth of the actual accepted CPU heart pixels.
 * The display raster is intentionally the same size, not a bounding-box mask. */
export function depthPointVisible(occlusion,p,width,height,{backgroundOnly=false}={}){
 if(!p||occlusion?.pending)return false;
 if(!occlusion?.data)return true;
 const x=Math.floor(p.x/width*occlusion.width),y=Math.floor(p.y/height*occlusion.height);
 if(x<0||y<0||x>=occlusion.width||y>=occlusion.height)return true;
 const heart=occlusion.data[y*occlusion.width+x];
 return backgroundOnly?!Number.isFinite(heart):p.depth<=heart+1e-6;
}

export function depthRaster(occlusion,width,height,{backgroundOnly=false}={}){
 if(!occlusion?.data||occlusion.pending)return null;
 return {width:occlusion.width,height:occlusion.height,scaleX:occlusion.width/width,scaleY:occlusion.height/height,
  heart:occlusion.data,backgroundOnly,pixels:new Uint8ClampedArray(occlusion.width*occlusion.height*4)};
}

export function depthColor(css){
 const values=css.match(/[\d.]+/g).map(Number);return [values[0],values[1],values[2],values[3]??1];
}

function blend(raster,x,y,depth,color,coverage=1){
 const pixel=y*raster.width+x,heart=raster.heart[pixel];if(raster.backgroundOnly?Number.isFinite(heart):depth>heart+1e-6)return;
 const i=pixel*4,data=raster.pixels,a=color[3]*coverage,b=data[i+3]/255,out=a+b*(1-a);if(out<=0)return;
 for(let k=0;k<3;k++)data[i+k]=(color[k]*a+data[i+k]*b*(1-a))/out;data[i+3]=out*255;
}
const point=(r,p)=>({x:p.x*r.scaleX,y:p.y*r.scaleY,depth:p.depth});
const edge=(a,b,x,y)=>(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);
const topLeft=(a,b)=>b.y<a.y||b.y===a.y&&b.x>a.x;

export function depthTriangle(raster,points,color){
 if(points.some(p=>!p||!Number.isFinite(p.depth)||p.depth<=0))return;
 let [a,b,c]=points.map(p=>point(raster,p)),area=edge(a,b,c.x,c.y);if(Math.abs(area)<1e-8)return;if(area<0){[b,c]=[c,b];area=-area;}
 const minX=Math.max(0,Math.ceil(Math.min(a.x,b.x,c.x)-.5)),maxX=Math.min(raster.width-1,Math.floor(Math.max(a.x,b.x,c.x)-.5));
 const minY=Math.max(0,Math.ceil(Math.min(a.y,b.y,c.y)-.5)),maxY=Math.min(raster.height-1,Math.floor(Math.max(a.y,b.y,c.y)-.5));
 const ab=topLeft(a,b),bc=topLeft(b,c),ca=topLeft(c,a);
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
  const x0=x+.5,y0=y+.5,e0=edge(b,c,x0,y0),e1=edge(c,a,x0,y0),e2=edge(a,b,x0,y0);
  if(e0<0||e1<0||e2<0||e0===0&&!bc||e1===0&&!ca||e2===0&&!ab)continue;
  const depth=area/(e0/a.depth+e1/b.depth+e2/c.depth);blend(raster,x,y,depth,color);
 }
}

export function depthLine(raster,a0,b0,color,width=1){
 if(!a0||!b0||!Number.isFinite(a0.depth)||!Number.isFinite(b0.depth)||a0.depth<=0||b0.depth<=0)return;
 const a=point(raster,a0),b=point(raster,b0),radius=Math.max(.5,width*(raster.scaleX+raster.scaleY)/4),dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
 const minX=Math.max(0,Math.floor(Math.min(a.x,b.x)-radius-1)),maxX=Math.min(raster.width-1,Math.ceil(Math.max(a.x,b.x)+radius+1));
 const minY=Math.max(0,Math.floor(Math.min(a.y,b.y)-radius-1)),maxY=Math.min(raster.height-1,Math.ceil(Math.max(a.y,b.y)+radius+1));
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
  const t=length?Math.max(0,Math.min(1,((x+.5-a.x)*dx+(y+.5-a.y)*dy)/length)):0;
  const distance=Math.hypot(x+.5-a.x-t*dx,y+.5-a.y-t*dy),coverage=Math.max(0,Math.min(1,radius+.5-distance));if(!coverage)continue;
  blend(raster,x,y,1/((1-t)/a.depth+t/b.depth),color,coverage);
 }
}

export function paintDepthRaster(ctx,raster,width,height,target=null){
 if(!raster)return null;
 let canvas=target;
 if(!canvas){
  try{if(typeof globalThis.OffscreenCanvas==='function')canvas=new globalThis.OffscreenCanvas(raster.width,raster.height);}catch{}
  if(!canvas)canvas=(ctx.canvas?.ownerDocument||globalThis.document)?.createElement('canvas');
 }
 if(!canvas)return null;
 if(canvas.width!==raster.width||canvas.height!==raster.height){canvas.width=raster.width;canvas.height=raster.height;}
 const surface=canvas.getContext('2d',{alpha:true});if(!surface)return null;
 let image;if(typeof ImageData==='function')image=new ImageData(raster.pixels,raster.width,raster.height);else{image=surface.createImageData(raster.width,raster.height);image.data.set(raster.pixels);}
 surface.setTransform(1,0,0,1,0,0);surface.putImageData(image,0,0);
 ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.imageSmoothingEnabled=false;ctx.drawImage(canvas,0,0,raster.width,raster.height,0,0,width,height);ctx.restore();return canvas;
}
