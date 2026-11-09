/** Conservative, reversible visibility filtering of the original NBE1 surface.
 * This labels foreground TISSUE, not disconnected triangle shells: a cavity
 * wall belonging to retained tissue must never be mistaken for an island.
 * The original signs/crossings, all positions and referenced normals are kept.
 */
export const NATIVE_CLEANUP = Object.freeze({
  id: 'compact-tissue-islands-v22', connectivity: 26,
  maximumSamples: 512, maximumSupportDiagonalMm: 0.4,
  protectedAnisotropy: 3, protectSheets: true, sourceSpacingUm: 19.85,
});

// Eigenvalues of a real symmetric 3x3 covariance, by bounded Jacobi rotations.
// Only small, fully observed candidate components need this calculation.
export function covarianceEigenvalues(xx, yy, zz, xy, xz, yz) {
  const a = [xx,xy,xz, xy,yy,yz, xz,yz,zz];
  for (let iteration = 0; iteration < 12; iteration++) {
    let p=0,q=1;
    if (Math.abs(a[2]) > Math.abs(a[p*3+q])) { p=0;q=2; }
    if (Math.abs(a[5]) > Math.abs(a[p*3+q])) { p=1;q=2; }
    const apq=a[p*3+q];
    if (Math.abs(apq) < 1e-12) break;
    const angle=.5*Math.atan2(2*apq,a[q*3+q]-a[p*3+p]);
    const c=Math.cos(angle),s=Math.sin(angle),app=a[p*3+p],aqq=a[q*3+q];
    a[p*3+p]=c*c*app-2*s*c*apq+s*s*aqq;
    a[q*3+q]=s*s*app+2*s*c*apq+c*c*aqq;
    a[p*3+q]=a[q*3+p]=0;
    for(let k=0;k<3;k++) if(k!==p&&k!==q) {
      const akp=a[k*3+p],akq=a[k*3+q];
      a[k*3+p]=a[p*3+k]=c*akp-s*akq;
      a[k*3+q]=a[q*3+k]=s*akp+c*akq;
    }
  }
  return [Math.max(0,a[0]),Math.max(0,a[4]),Math.max(0,a[8])].sort((a,b)=>a-b);
}

/** A full tile is classified ONCE, before its eight rendering pieces are made.
 * Components intersecting any outer face are unconditionally retained. Their
 * extent outside the downloaded tile is unknown. This sacrifices border
 * cleanup but cannot cut a strand merely because it crosses a tile seam.
 * Allocation is five bytes/sample: 10.24 MiB for a 129-cubed tile.
 */
export function classifyNativeTissue(parsed, settings = NATIVE_CLEANUP) {
  const {bytes,nx,ny,nz,step}=parsed;
  if (!(bytes instanceof Uint8Array) || step!==1 ||
      [nx,ny,nz].some(n=>!Number.isInteger(n)||n<2||n>129) || bytes.length<64+Math.ceil(nx*ny*nz/8)) {
    throw new Error('Cleanup requires an intact native tissue mask.');
  }
  const {maximumSamples,maximumSupportDiagonalMm,protectedAnisotropy,protectSheets,sourceSpacingUm}=settings;
  if (!Number.isSafeInteger(maximumSamples)||maximumSamples<1||maximumSamples>4096||
      !Number.isFinite(maximumSupportDiagonalMm)||maximumSupportDiagonalMm<=0||maximumSupportDiagonalMm>1||
      !Number.isFinite(protectedAnisotropy)||protectedAnisotropy<1||sourceSpacingUm!==19.85) {
    throw new Error('The native cleanup settings are invalid.');
  }
  const count=nx*ny*nz,plane=nx*ny,mm=sourceSpacingUm/1000;
  const states=new Uint8Array(count),queue=new Uint32Array(count);
  const stats={method:settings.id,components:0,foregroundSamples:0,removedComponents:0,removedSamples:0,
    boundaryProtectedComponents:0,shapeProtectedComponents:0,sizeProtectedComponents:0,
    maximumSamples,maximumSupportDiagonalMm,protectedAnisotropy,protectSheets,
    connectivity:26,boundaryPolicy:'retain every component touching any outer tile face',
    positionsChanged:0,sourceSignsChanged:0};
  for(let seed=0;seed<count;seed++) {
    if(states[seed] || !((bytes[64+(seed>>3)]>>(seed&7))&1)) continue;
    let head=0,tail=1;queue[0]=seed;states[seed]=1;
    const seedZ=Math.floor(seed/plane),seedRow=seed-seedZ*plane,seedY=Math.floor(seedRow/nx),seedX=seedRow-seedY*nx;
    let minX=nx,minY=ny,minZ=nz,maxX=-1,maxY=-1,maxZ=-1,boundary=false;
    let sx=0,sy=0,sz=0,sxx=0,syy=0,szz=0,sxy=0,sxz=0,syz=0;
    while(head<tail) {
      const index=queue[head++],z=Math.floor(index/plane),row=index-z*plane,y=Math.floor(row/nx),x=row-y*nx;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
      if(x===0||x===nx-1||y===0||y===ny-1||z===0||z===nz-1) boundary=true;
      // Beyond the size cap, a component is retained regardless of moments.
      if(head<=maximumSamples) {
        const dx=x-seedX,dy=y-seedY,dz=z-seedZ;
        sx+=dx;sy+=dy;sz+=dz;sxx+=dx*dx;syy+=dy*dy;szz+=dz*dz;sxy+=dx*dy;sxz+=dx*dz;syz+=dy*dz;
      }
      const za=Math.max(0,z-1),zb=Math.min(nz-1,z+1),ya=Math.max(0,y-1),yb=Math.min(ny-1,y+1),xa=Math.max(0,x-1),xb=Math.min(nx-1,x+1);
      for(let zz=za;zz<=zb;zz++) for(let yy=ya;yy<=yb;yy++) {
        let other=(zz*ny+yy)*nx+xa;
        for(let xx=xa;xx<=xb;xx++,other++) {
          if(!states[other] && ((bytes[64+(other>>3)]>>(other&7))&1)) {states[other]=1;queue[tail++]=other;}
        }
      }
    }
    stats.components++;stats.foregroundSamples+=tail;
    if(boundary) {stats.boundaryProtectedComponents++;continue;}
    const diagonal=Math.hypot(maxX-minX+1,maxY-minY+1,maxZ-minZ+1)*mm;
    if(tail>maximumSamples||diagonal>maximumSupportDiagonalMm) {stats.sizeProtectedComponents++;continue;}
    const n=tail,mx=sx/n,my=sy/n,mz=sz/n;
    const values=covarianceEigenvalues(sxx/n-mx*mx,syy/n-my*my,szz/n-mz*mz,sxy/n-mx*my,sxz/n-mx*mz,syz/n-my*mz);
    const anisotropy=Math.sqrt((values[2]+1/12)/(values[protectSheets?0:1]+1/12));
    // Retain components at the threshold despite insignificant roundoff.
    if(anisotropy>=protectedAnisotropy-1e-10) {stats.shapeProtectedComponents++;continue;}
    stats.removedComponents++;stats.removedSamples+=tail;
    for(let i=0;i<tail;i++) states[queue[i]]=2;
  }
  for(let i=0;i<count;i++) states[i]=states[i]===2?1:0;
  stats.removedVolumeMm3=stats.removedSamples*mm**3;
  return {removedSamples:states,stats};
}
