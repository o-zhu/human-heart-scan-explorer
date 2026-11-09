import { CASES_BASE64 } from './native-edge-table.js';

const TABLE = Int8Array.from(atob(CASES_BASE64), c => c.charCodeAt(0));
const START = [[0,0,0],[1,0,0],[0,1,0],[0,0,0],[0,0,1],[1,0,1],[0,1,1],[0,0,1],[0,0,0],[1,0,0],[1,1,0],[0,1,0]];
const AXIS = [0,1,0,1,0,1,0,1,2,2,2,2];
const CORNERS = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const TRIANGLES = Uint8Array.from({length:256}, (_, c) => { let n=0; while(n<16 && TABLE[c*16+n]>=0)n++; return n/3; });
const PARSED = new WeakMap();
const NO_CROSSING = 255;

/** Parse already decompressed NBE1 bytes. The worker verifies source hashes.
 * The input buffer must remain unchanged while the parsed object is in use.
 */
export function parseNativeEdges(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 64 || buffer.byteLength > 5*1024*1024) throw new Error('Native surface block has an invalid byte length.');
  const view = new DataView(buffer), h=Array.from({length:16},(_,i)=>view.getUint32(i*4,true));
  const [magic,version,nx,ny,nz,bits,maskBytes,nex,ney,nez,ox,oy,oz]=h;
  if(magic!==0x3145424e || version!==1 || bits!==5 || ![0,2,4,8].includes(h[15]) || [nx,ny,nz].some(n=>n<2||n>129)) throw new Error('Native surface block format is unsupported.');
  const step=h[15]||1;
  if(maskBytes!==Math.ceil(nx*ny*nz/8) || nex>(nx-1)*ny*nz || ney>nx*(ny-1)*nz || nez>nx*ny*(nz-1)) throw new Error('Native surface block dimensions are inconsistent.');
  if(ox+(nx-1)*step>=7614 || oy+(ny-1)*step>=7614 || oz+(nz-1)*step>=8480) throw new Error('Native surface block lies outside the measured scan.');
  const threshold=view.getFloat32(52,true),spacing=view.getFloat32(56,true);
  if(!Number.isFinite(threshold) || !Number.isFinite(spacing) || Math.abs(threshold-17133.4)>.01 || Math.abs(spacing-19.85*step)>.001) throw new Error('Native source spacing or threshold differs from the reconstruction.');
  const counts=[nex,ney,nez], offsets=[]; let cursor=64+maskBytes;
  for(const n of counts){offsets.push(cursor);cursor+=Math.ceil(n*5/8);}
  if(cursor!==buffer.byteLength) throw new Error('Native surface crossing data are incomplete.');
  const parsed=Object.freeze({buffer,bytes:new Uint8Array(buffer),nx,ny,nz,step,
    origin:Object.freeze([ox,oy,oz]),counts:Object.freeze(counts),offsets:Object.freeze(offsets),maskBytes});
  PARSED.set(parsed,{length:buffer.byteLength,codes:null});
  return parsed;
}

/** Unpack and validate each edge grid once. A 129³ tile needs 6,390,144
 * bytes, and the WeakMap does not keep the parsed tile alive after its job.
 */
function crossingCodes(parsed,state) {
  if(state.codes) return state.codes;
  const {bytes,nx,ny,nz,counts,offsets}=parsed,strides=[1,nx,nx*ny],grids=[];
  for(let axis=0;axis<3;axis++){
    const ex=nx-(axis===0),ey=ny-(axis===1),ez=nz-(axis===2);
    const codes=new Uint8Array(ex*ey*ez);codes.fill(NO_CROSSING);
    let crossing=0,edgeIndex=0;
    for(let z=0;z<ez;z++)for(let y=0;y<ey;y++){
      let sample=(z*ny+y)*nx;
      for(let x=0;x<ex;x++,sample++,edgeIndex++){
        const other=sample+strides[axis];
        const first=(bytes[64+(sample>>3)]>>(sample&7))&1,second=(bytes[64+(other>>3)]>>(other&7))&1;
        if(first===second)continue;
        if(crossing>=counts[axis]) throw new Error('Native surface signs and crossing counts disagree.');
        const bit=crossing*5,byte=offsets[axis]+(bit>>3),shift=bit&7;
        codes[edgeIndex]=((bytes[byte]|((bytes[byte+1]||0)<<8))>>shift)&31;
        crossing++;
      }
    }
    if(crossing!==counts[axis]) throw new Error('Native surface signs and crossing counts disagree.');
    grids.push(codes);
  }
  state.codes=grids;
  return grids;
}

/** Sum face normals in exact native-grid coordinates, before display rounding.
 * A one-cell shell supplies all incident faces at internal piece boundaries.
 * At an outer tile face only this tile's incident faces are available.
 */
function regionNormals(parsed,codes,gridDims,maps,mapDims,start,cells,positions,indices,sign) {
  const {nx,ny,nz,origin,step}=parsed,normals=new Float32Array(positions.length);
  function add(a,b,c,x,y,z){
    if(a>=0){normals[a*3]+=x;normals[a*3+1]+=z;normals[a*3+2]-=y;}
    if(b>=0){normals[b*3]+=x;normals[b*3+1]+=z;normals[b*3+2]-=y;}
    if(c>=0){normals[c*3]+=x;normals[c*3+1]+=z;normals[c*3+2]-=y;}
  }
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i],ib=indices[i+1],ic=indices[i+2],a=ia*3,b=ib*3,c=ic*3;
    const ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2];
    const vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2];
    add(ia,ib,ic,uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx);
  }
  const end=start.map((v,i)=>v+cells[i]),lo=start.map(v=>Math.max(0,v-1));
  const hi=end.map((v,i)=>Math.min([nx-1,ny-1,nz-1][i],v+1));
  const p=new Float64Array(9),ids=new Int32Array(3);
  for(let z=lo[2];z<hi[2];z++)for(let y=lo[1];y<hi[1];y++)for(let x=lo[0];x<hi[0];x++){
    if(x>=start[0]&&x<end[0]&&y>=start[1]&&y<end[1]&&z>=start[2]&&z<end[2])continue;
    let c=0;for(let bit=0;bit<8;bit++){const d=CORNERS[bit];if(!sign(x+d[0],y+d[1],z+d[2]))c|=1<<bit;}
    for(let t=0;t<15 && TABLE[c*16+t]>=0;t+=3){
      for(let k=0;k<3;k++){
        const edge=TABLE[c*16+t+k],d=START[edge],axis=AXIS[edge],gd=gridDims[axis],md=mapDims[axis];
        const ex=x+d[0],ey=y+d[1],ez=z+d[2],q=codes[axis][(ez*gd[1]+ey)*gd[0]+ex];
        if(q===NO_CROSSING)throw new Error('Native normal halo references a missing crossing.');
        const fraction=(q+.5)/32;
        p[k*3]=(ex+(axis===0?fraction:0))*step+origin[0];
        p[k*3+1]=(ey+(axis===1?fraction:0))*step+origin[1];
        p[k*3+2]=(ez+(axis===2?fraction:0))*step+origin[2];
        const lx=ex-start[0],ly=ey-start[1],lz=ez-start[2];
        ids[k]=lx>=0&&ly>=0&&lz>=0&&lx<md[0]&&ly<md[1]&&lz<md[2] ? maps[axis][(lz*md[1]+ly)*md[0]+lx] : -1;
      }
      if(ids[0]<0&&ids[1]<0&&ids[2]<0)continue;
      const ux=p[3]-p[0],uy=p[4]-p[1],uz=p[5]-p[2],vx=p[6]-p[0],vy=p[7]-p[1],vz=p[8]-p[2];
      add(ids[0],ids[1],ids[2],uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx);
    }
  }
  return normals;
}

/** Generate a bounded block of native cells; no full-volume arrays are made. */
export function meshNativeEdges(parsed, {start=[0,0,0], size=64, local=false, cleanup=null, cleanupView='cleaned'}={}) {
  const state=PARSED.get(parsed);
  if(!state || parsed.buffer.byteLength!==state.length) throw new Error('Use an intact parsed native surface block.');
  const {bytes,nx,ny,nz,origin,step}=parsed;
  if(cleanup && (!(cleanup.removedSamples instanceof Uint8Array) || cleanup.removedSamples.length!==nx*ny*nz || !['cleaned','removed'].includes(cleanupView))) throw new Error('Native cleanup does not match the complete source tile.');
  const arrayStart=Array.isArray(start)||(ArrayBuffer.isView(start)&&typeof start.length==='number');
  if(!Number.isInteger(size)||size<1||size>128||!arrayStart||start.length!==3||start.some((v,i)=>!Number.isInteger(v)||v<0||v>=[nx-1,ny-1,nz-1][i])||typeof local!=='boolean') throw new Error('Invalid native cell region.');
  const cells=[Math.min(size,nx-1-start[0]),Math.min(size,ny-1-start[1]),Math.min(size,nz-1-start[2])],dims=cells.map(n=>n+1);
  if(cells.reduce((a,b)=>a*b,1)>64**3 && step===1) throw new Error('Select at most 64 native cells per worker mesh.');
  const codes=crossingCodes(parsed,state),mapDims=[],gridDims=[];
  let vertexCount=0;
  for(let axis=0;axis<3;axis++){
    const md=dims.slice();md[axis]--;mapDims.push(md);
    const gd=[nx,ny,nz];gd[axis]--;gridDims.push(gd);
    for(let z=0;z<md[2];z++)for(let y=0;y<md[1];y++){
      const row=((z+start[2])*gd[1]+y+start[1])*gd[0]+start[0];
      for(let x=0;x<md[0];x++)if(codes[axis][row+x]!==NO_CROSSING)vertexCount++;
    }
  }
  if(vertexCount>850000)throw new Error('Native region exceeds its bounded mesh allocation.');
  const positions=new Float32Array(vertexCount*3),maps=[];
  let vertex=0;
  for(let axis=0;axis<3;axis++){
    const md=mapDims[axis],gd=gridDims[axis],map=new Int32Array(md[0]*md[1]*md[2]);
    map.fill(-1);maps.push(map);
    for(let z=0;z<md[2];z++)for(let y=0;y<md[1];y++){
      const row=((z+start[2])*gd[1]+y+start[1])*gd[0]+start[0],target=(z*md[1]+y)*md[0];
      for(let x=0;x<md[0];x++){
        const q=codes[axis][row+x];if(q===NO_CROSSING)continue;
        const fraction=(q+.5)/32;map[target+x]=vertex;
        positions[3*vertex]=(x+start[0]+(axis===0?fraction:0))*step+origin[0];
        positions[3*vertex+1]=(y+start[1]+(axis===1?fraction:0))*step+origin[1];
        positions[3*vertex+2]=(z+start[2]+(axis===2?fraction:0))*step+origin[2];vertex++;
      }
    }
  }
  const sign=(x,y,z)=>{const i=(z*ny+y)*nx+x;return(bytes[64+(i>>3)]>>(i&7))&1;};
  const cases=new Uint8Array(cells[0]*cells[1]*cells[2]);let triangleCount=0,sourceTriangles=0,suppressedTriangles=0,index=0;
  for(let z=0;z<cells[2];z++)for(let y=0;y<cells[1];y++)for(let x=0;x<cells[0];x++){
    let c=0,suppressed=false;for(let bit=0;bit<8;bit++){
      const d=CORNERS[bit],sx=x+start[0]+d[0],sy=y+start[1]+d[1],sz=z+start[2]+d[2];
      if(!sign(sx,sy,sz))c|=1<<bit;
      if(cleanup?.removedSamples[(sz*ny+sy)*nx+sx])suppressed=true;
    }
    sourceTriangles+=TRIANGLES[c];
    if(suppressed)suppressedTriangles+=TRIANGLES[c];
    // In 26-connectivity all tissue corners in a cell belong to one component.
    // Removing its complete case selects an exact subset of original faces.
    if(cleanup && (cleanupView==='removed'?!suppressed:suppressed))c=0;
    cases[index++]=c;triangleCount+=TRIANGLES[c];
  }
  if(triangleCount>1500000)throw new Error('Native region exceeds its bounded triangle allocation.');
  const indices=new Uint32Array(triangleCount*3);index=0;let out=0;
  for(let z=0;z<cells[2];z++)for(let y=0;y<cells[1];y++)for(let x=0;x<cells[0];x++){
    const c=cases[index++];for(let t=0;t<16;t++){
      const edge=TABLE[c*16+t];if(edge<0)break;
      const d=START[edge],a=AXIS[edge],md=mapDims[a];
      const v=maps[a][((z+d[2])*md[1]+y+d[1])*md[0]+x+d[0]];
      if(v<0)throw new Error('Native case references a missing crossing.');indices[out++]=v;
    }
  }
  const normals=regionNormals(parsed,codes,gridDims,maps,mapDims,start,cells,positions,indices,sign);
  const center=local ? origin.map((v,i)=>v+(start[i]+cells[i]/2)*step) : [7613/2,7613/2,8479/2];
  const longest=local ? Math.max(...cells)*step : 8479;
  for(let i=0;i<vertexCount;i++){
    const x=positions[3*i]-center[0],y=positions[3*i+1]-center[1],z=positions[3*i+2]-center[2];
    positions[3*i]=x/longest;positions[3*i+1]=z/longest;positions[3*i+2]=-y/longest;
  }
  const packedNormals=new Int16Array(normals.length);
  for(let i=0;i<vertexCount;i++){const j=i*3,n=Math.hypot(normals[j],normals[j+1],normals[j+2])||1;for(let k=0;k<3;k++)packedNormals[j+k]=Math.round(normals[j+k]/n*32767);}
  const positionOffset=32,normalOffset=positionOffset+positions.byteLength,indexOffset=(normalOffset+packedNormals.byteLength+3)&~3;
  const buffer=new ArrayBuffer(indexOffset+indices.byteLength),head=new Uint32Array(buffer,0,8);
  head.set([0x314d4648,1,vertexCount,indices.length,positionOffset,normalOffset,indexOffset,1]);
  new Float32Array(buffer,positionOffset,positions.length).set(positions);
  new Int16Array(buffer,normalOffset,packedNormals.length).set(packedNormals);
  new Uint32Array(buffer,indexOffset,indices.length).set(indices);
  return {buffer,vertexCount,indexCount:indices.length,positionOffset,normalOffset,indexOffset,positionBytes:12,positionFormat:'float32',
    sourceOriginXYZ:origin.map((v,i)=>v+start[i]*step),sourceShapeXYZ:cells.map(n=>n*step+1),longestNativeVoxels:longest,triangles:triangleCount,sourceTriangles,suppressedTriangles};
}
