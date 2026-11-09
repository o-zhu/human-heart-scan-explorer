/** Bounded lossless transport of a prepared field; processing is offline. */
import {readCoronaryExact, validateCoronaryProfile} from './coronary-data.js';

const hash = async bytes => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');

function undoPredictor(data, kind, nx, ny) {
 if (kind === 'none') return;
 if (kind === 'delta-x') {
  for (let row = 0; row < data.length; row += nx) for (let x = 1; x < nx; x++) data[row + x] = (data[row + x] + data[row + x - 1]) & 255;
 } else if (kind === 'delta-z') {
  const plane = nx * ny;
  for (let i = plane; i < data.length; i++) data[i] = (data[i] + data[i - plane]) & 255;
 } else throw new Error('Unsupported coronary transport predictor.');
}

let running = false;
self.onmessage = async event => {
 if (running || event.data?.type !== 'prepare') return;
 running = true;
 try {
  const {donorId, profile, baseUrl} = event.data;
  validateCoronaryProfile(profile, donorId);
  if (typeof globalThis.DecompressionStream !== 'function' || !globalThis.crypto?.subtle) throw new Error('This browser cannot verify and decompress the coronary surface.');
  const data = new Uint8Array(profile.uncompressedBytes), [nx, ny] = profile.dimensions;
  let offset = 0, received = 0, lastPercent = -1;
  const progress = (loaded, message) => {
   const percent = Math.floor(loaded / profile.compressedBytes * 100);
   if (message || percent !== lastPercent) {
    lastPercent = percent; self.postMessage({type: 'progress', loaded, total: profile.compressedBytes, ...(message ? {message} : {})});
   }
  };
  for (const part of profile.parts) {
   // All URLs passed the fixed local namespace check, with no query, fragment,
   // traversal or redirects. The manifest fixes every encoded/decoded byte.
   const response = await globalThis.fetch(new URL(part.url, baseUrl), {cache: 'force-cache', redirect: 'error'});
   if (!response.ok) throw new Error(`Coronary data could not load (${response.status}).`);
   const length = response.headers?.get('content-length');
   if (length !== null && length !== undefined && Number(length) !== part.compressedBytes) throw new Error('Coronary download length did not match.');
   const packed = new Uint8Array(part.compressedBytes);
   await readCoronaryExact(response.body, packed, 0, packed.length, used => progress(received + used));
   received += packed.length;
   if (await hash(packed) !== part.sha256) throw new Error('Coronary compressed checksum did not match.');
   if (packed[0] !== 31 || packed[1] !== 139) throw new Error('Coronary transport is not gzip.');
   const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
   await readCoronaryExact(stream, data, offset, part.uncompressedBytes);
   const decoded = data.subarray(offset, offset + part.uncompressedBytes);
   undoPredictor(decoded, part.predictor, nx, ny);
   if (await hash(decoded) !== part.rawSha256) throw new Error('Coronary decoded part checksum did not match.');
   offset += part.uncompressedBytes;
  }
  if (offset !== data.length || received !== profile.compressedBytes) throw new Error('Coronary volume length did not match.');
  progress(received, 'Verifying Prepared Coronary Surface…');
  if (await hash(data) !== profile.rawSha256) throw new Error('Coronary complete volume checksum did not match.');
  self.postMessage({type: 'ready', donorId, rawSha256: profile.rawSha256, data: data.buffer}, [data.buffer]);
 } catch (error) { self.postMessage({type: 'error', message: error?.message || 'The coronary surface could not be prepared.'}); }
};
