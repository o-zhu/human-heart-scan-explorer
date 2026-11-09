/** Conservative maxima for empty-space skipping; no voxel values are changed.
 * A cell contains blockSize trilinear interpolation intervals. Including its
 * upper voxel boundary bounds every trilinear sample throughout that cell.
 * Call in the volume-decoding worker so preparation never blocks the UI.
 */
export function buildAcceleration(data, sourceDimensions, blockSize = 8) {
 if (!(data instanceof Uint8Array) || !Array.isArray(sourceDimensions) || sourceDimensions.length !== 3 ||
     sourceDimensions.some(n => !Number.isInteger(n) || n < 2) ||
     data.length !== sourceDimensions.reduce((a, b) => a * b, 1) || !Number.isInteger(blockSize) || blockSize < 2 || blockSize > 32) {
  throw new Error('Invalid scalar volume for empty-space acceleration.');
 }
 const started = performance.now();
 const [nx, ny, nz] = sourceDimensions;
 const dimensions = sourceDimensions.map(n => Math.ceil((n - 1) / blockSize));
 const [bx, by, bz] = dimensions, maxima = new Uint8Array(bx * by * bz);
 let cell = 0;
 for (let z = 0; z < bz; z++) for (let y = 0; y < by; y++) for (let x = 0; x < bx; x++) {
  const x0 = x * blockSize, x1 = Math.min(x0 + blockSize, nx - 1);
  const y0 = y * blockSize, y1 = Math.min(y0 + blockSize, ny - 1);
  const z0 = z * blockSize, z1 = Math.min(z0 + blockSize, nz - 1);
  let maximum = 0;
  for (let iz = z0; iz <= z1; iz++) for (let iy = y0; iy <= y1; iy++) {
   const start = nx * (iy + ny * iz);
   for (let ix = x0; ix <= x1; ix++) { const value = data[start + ix]; if (value > maximum) maximum = value; }
  }
  maxima[cell++] = maximum;
 }
 return { dimensions, sourceDimensions: [...sourceDimensions], blockSize, maxima, buildMs: performance.now() - started };
}

export function validAcceleration(acceleration, dimensions) {
 return Boolean(acceleration && acceleration.maxima instanceof Uint8Array &&
  Number.isInteger(acceleration.blockSize) && acceleration.blockSize >= 2 && acceleration.blockSize <= 32 &&
  Array.isArray(acceleration.dimensions) && acceleration.dimensions.length === 3 &&
  acceleration.dimensions.every((n, i) => n === Math.ceil((dimensions[i] - 1) / acceleration.blockSize)) &&
  acceleration.maxima.length === acceleration.dimensions.reduce((a, b) => a * b, 1) &&
  Array.isArray(acceleration.sourceDimensions) && acceleration.sourceDimensions.every((n, i) => n === dimensions[i]));
}
