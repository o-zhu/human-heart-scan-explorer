/** Eight exact source JSON files transported inside the production Worker.
 * No source rewrite, R2, fetch, asset binding, upload route or runtime secret.
 * Complete bounded decompression and integrity checks precede every response.
 */
export const BUNDLED_JSON_PATHS = Object.freeze([
  '/assets/donors/s-20-28/ultra-volume.json',
  '/assets/donors/s-20-29/ultra-volume.json',
  '/assets/ultra-volume-v7.json',
  '/assets/tte-atlas/media.json',
  '/assets/ultra-support.json',
  '/assets/ultra-sections/manifest.json',
  '/assets/donors/s-20-28/ultra-sections.json',
  '/assets/donors/s-20-29/ultra-sections.json',
]);
export const BUNDLED_JSON_POLICY = 'bundled-json-v1:exact-source:read-only';
const ALLOWED = new Set(BUNDLED_JSON_PATHS);
const MAX_RAW_BYTES = 2 * 1024 * 1024;
const MAX_GZIP_BYTES = 1024 * 1024;
const CACHE_CONTROL = 'private, max-age=0, must-revalidate';
const HASH = /^[a-f0-9]{64}$/;
// A flat character scan avoids repeated-group regexp stack growth on the
// largest payload. atob plus canonical re-encoding checks the final padding.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const sha256 = async data => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
  byte => byte.toString(16).padStart(2, '0'),
).join('');

function validEntry(entry) {
  return entry && Number.isSafeInteger(entry.rawLength)
    && entry.rawLength > 0 && entry.rawLength <= MAX_RAW_BYTES
    && Number.isSafeInteger(entry.gzipLength)
    && entry.gzipLength > 0 && entry.gzipLength <= MAX_GZIP_BYTES
    && typeof entry.rawSha256 === 'string' && HASH.test(entry.rawSha256)
    && typeof entry.gzipSha256 === 'string' && HASH.test(entry.gzipSha256)
    && typeof entry.gzipBase64 === 'string'
    && entry.gzipBase64.length === 4 * Math.ceil(entry.gzipLength / 3)
    && BASE64.test(entry.gzipBase64);
}

async function verifiedBytes(entry) {
  if (!validEntry(entry)) throw new Error('Invalid entry');
  const encoded = atob(entry.gzipBase64);
  if (btoa(encoded) !== entry.gzipBase64) throw new Error('Noncanonical base64');
  const compressed = Uint8Array.from(encoded, c => c.charCodeAt(0));
  if (compressed.byteLength !== entry.gzipLength
      || await sha256(compressed) !== entry.gzipSha256) throw new Error('Compressed integrity');
  const reader = new Blob([compressed]).stream()
    .pipeThrough(new DecompressionStream('gzip')).getReader();
  const output = new Uint8Array(entry.rawLength);
  let used = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (used + value.byteLength > output.byteLength) throw new Error('Decoded length');
      output.set(value, used);
      used += value.byteLength;
    }
    if (used !== entry.rawLength || await sha256(output) !== entry.rawSha256) {
      throw new Error('Decoded integrity');
    }
    return output;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

const notModified = (value, etag) => value?.split(',').some(
  item => item.trim() === '*' || item.trim().replace(/^W\//, '') === etag,
);

export async function bundledJsonRequest(request, index, { servePublic = false } = {}) {
  if (!servePublic || !['GET', 'HEAD'].includes(request.method)) return null;
  const pathname = new URL(request.url).pathname;
  if (!ALLOWED.has(pathname)) return null;
  try {
    if (index?.schemaVersion !== 1 || index.encoding !== 'gzip+base64'
        || !index.files || !Object.hasOwn(index.files, pathname)) throw new Error('Missing entry');
    const entry = index.files[pathname];
    const bytes = await verifiedBytes(entry);
    const etag = `"sha256-${entry.rawSha256}"`;
    const headers = new Headers({
      'content-type': 'application/json',
      'content-length': String(entry.rawLength),
      'cache-control': CACHE_CONTROL,
      'etag': etag,
      'x-content-sha256': entry.rawSha256,
      'x-content-type-options': 'nosniff',
      'x-heart-json-transport': BUNDLED_JSON_POLICY,
    });
    if (notModified(request.headers.get('if-none-match'), etag)) {
      headers.delete('content-length');
      return new Response(null, { status: 304, headers });
    }
    return new Response(request.method === 'HEAD' ? null : bytes, { headers });
  } catch {
    // An allowlisted but corrupt/missing bundle never falls through to stale
    // static bytes or another storage route, including HEAD and conditional GET.
    return new Response(request.method === 'HEAD' ? null : 'Bundled JSON integrity check failed.', {
      status: 500,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
