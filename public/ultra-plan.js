/** Registered 79.4 µm section geometry. No source voxels are interpolated. */
export const ULTRA_DIMENSIONS = [1897, 1897, 2117];
export const ULTRA_SLICE_COUNTS = [475, 475, 530];
export const ULTRA_SPACING_UM = 79.4;
export const ULTRA_BLOCK_SIZE = 128;
export const ULTRA_BLOCK_GRID = [15, 15, 17];

export function decodeSupportKey(key) {
  const x = key % 15, y = Math.floor(key / 15) % 15, z = Math.floor(key / 225);
  return [x, y, z];
}

export function makeUltraPlan(axis, index, manifest, support) {
  if (!Number.isInteger(axis) || axis < 0 || axis > 2 || !Number.isInteger(index) ||
      index < 0 || index >= ULTRA_SLICE_COUNTS[axis]) {
    throw new Error('Choose a valid source section for ultra detail.');
  }
  const sourceIndex = index * 4;
  const normalBlock = Math.floor(sourceIndex / ULTRA_BLOCK_SIZE);
  const width = ULTRA_DIMENSIONS[axis === 0 ? 1 : 0];
  const height = ULTRA_DIMENSIONS[axis === 2 ? 1 : 2];
  const bounds = manifest.boundsS4 || [[0,474],[0,474],[0,529]];
  const perSlice = support?.slices?.['xyz'[axis]]?.[index];
  const subBlocks = support?.subBlocks?.['xyz'[axis]]?.[index];
  const maskByKey = {};
  let blocks;
  if (Array.isArray(perSlice)) {
    blocks = perSlice.map((value,i) => {
      const coord=Array.isArray(value)?value:decodeSupportKey(value);
      if(Array.isArray(subBlocks) && Number.isInteger(subBlocks[i]))maskByKey[coord.join(':')]=subBlocks[i]&15;
      return coord;
    });
    blocks = blocks.filter(c => c[axis] === normalBlock && c.every((v, i) => Number.isInteger(v) && v >= 0 && v < ULTRA_BLOCK_GRID[i]));
  } else {
    blocks = [];
    const ranges = bounds.map(([lo, hi], i) => i === axis ? [normalBlock, normalBlock] :
      [Math.floor(lo * 4 / 128), Math.floor(hi * 4 / 128)]);
    if (index >= bounds[axis][0] && index <= bounds[axis][1]) {
      for (let z = ranges[2][0]; z <= ranges[2][1]; z++) {
        for (let y = ranges[1][0]; y <= ranges[1][1]; y++) {
          for (let x = ranges[0][0]; x <= ranges[0][1]; x++) blocks.push([x,y,z]);
        }
      }
    }
  }
  // Center-first download order gives an informative progress sequence and
  // keeps nearby heart chunks at the front of the cache on repeated requests.
  const center = bounds.map(([lo, hi]) => (lo + hi) / 64);
  blocks.sort((a,b) => a.reduce((s,v,i)=>s+(v-center[i])**2,0)-b.reduce((s,v,i)=>s+(v-center[i])**2,0));
  for(const coord of blocks){
    const key=coord.join(':');
    maskByKey[key]=axis===2?1<<Math.floor((sourceIndex%128)/32):(maskByKey[key]??15);
  }
  const countBits=n=>{let count=0;for(let bit=0;bit<4;bit++)if(n&(1<<bit))count++;return count;};
  const estimatedBytes=blocks.reduce((sum,coord)=>sum+countBits(maskByKey[coord.join(':')])*850000,0);
  return {axis,index,sourceIndex,width,height,blocks,spacingUm:ULTRA_SPACING_UM,
    estimatedBytes,maskByKey,
    rangeOptimized:axis===2 || Boolean(subBlocks),
    key:`s2:${axis}:${index}`};
}

/**
 * Copy genuine big-endian source voxels into the exact full-extent plane.
 * X images have Y columns/Z rows; Y images have X columns/Z rows; Z images
 * have X columns/Y rows, identical to the packaged 158.8 µm sections.
 */
export function copyUltraSection(plan, coord, decoded, output, window = [14640,23545]) {
  const [dx,dy,dz] = decoded.dimensions;
  const origin = coord.map(v => v * ULTRA_BLOCK_SIZE);
  const local = plan.sourceIndex - origin[plan.axis];
  if (local < 0 || local >= decoded.dimensions[plan.axis]) return;
  const data = decoded.data, byteStart = decoded.byteStart || 0;
  const scale = 255 / (window[1] - window[0]);
  const xMax = Math.min(dx, ULTRA_DIMENSIONS[0] - origin[0]);
  const yMax = Math.min(dy, ULTRA_DIMENSIONS[1] - origin[1]);
  const zMax = Math.min(dz, ULTRA_DIMENSIONS[2] - origin[2]);
  const set = (outIndex, byteIndex, sourceX, sourceY) => {
    // Preserve the existing, documented mounting-container cylinder. The
    // finer anatomical cleanup mask is applied separately by the renderer.
    if ((sourceX - 948) ** 2 + (sourceY - 948) ** 2 > 840 ** 2) return;
    const pos = byteIndex - byteStart;
    if (pos < 0 || pos + 1 >= data.length) return;
    const value = data[pos] * 256 + data[pos + 1];
    output[outIndex] = Math.max(0, Math.min(255, Math.round((value - window[0]) * scale)));
  };
  if (plan.axis === 0) {
    for (let z=0;z<zMax;z++) for (let y=0;y<yMax;y++) {
      set((origin[2]+z)*plan.width+origin[1]+y,((z*dy+y)*dx+local)*2,plan.sourceIndex,origin[1]+y);
    }
  } else if (plan.axis === 1) {
    for (let z=0;z<zMax;z++) for (let x=0;x<xMax;x++) {
      set((origin[2]+z)*plan.width+origin[0]+x,((z*dy+local)*dx+x)*2,origin[0]+x,plan.sourceIndex);
    }
  } else {
    for (let y=0;y<yMax;y++) for (let x=0;x<xMax;x++) {
      set((origin[1]+y)*plan.width+origin[0]+x,((local*dy+y)*dx+x)*2,origin[0]+x,origin[1]+y);
    }
  }
}
