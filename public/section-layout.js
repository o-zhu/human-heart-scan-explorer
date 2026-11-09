/** Cropped pixels retain their original scan coordinates; voxel centers define the extent. */
export function sectionLayout(image){
 const fullWidth=image.fullWidth??image.width,fullHeight=image.fullHeight??image.height;
 const [x,y]=image.crop??[0,0];
 return {x,y,width:image.width,height:image.height,fullWidth,fullHeight,
  stepU:1/Math.max(1,fullWidth-1),stepV:1/Math.max(1,fullHeight-1)};
}

/** A texture frame spans the centers of the first and last retained pixels. */
export function croppedSectionFrame(frame,image){
 if(!image.crop)return frame;
 const b=sectionLayout(image),u=(b.x+(b.width-1)/2)*b.stepU,v=(b.y+(b.height-1)/2)*b.stepV;
 return {...frame,
  center:frame.center.map((c,i)=>c+frame.right[i]*(u-.5)*frame.width+frame.up[i]*(.5-v)*frame.height),
  width:frame.width*Math.max(1,b.width-1)*b.stepU,
  height:frame.height*Math.max(1,b.height-1)*b.stepV};
}

/** Canvas rectangles use pixel edges, while crosshairs and 3D frames use pixel centers. */
export function sectionImageRect(image){
 const b=sectionLayout(image);
 return {x:(b.x-.5)*b.stepU,y:(b.y-.5)*b.stepV,width:b.width*b.stepU,height:b.height*b.stepV};
}
