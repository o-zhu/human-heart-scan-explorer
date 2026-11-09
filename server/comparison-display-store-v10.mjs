/** Indexed comparison display files behind the Site's existing access boundary.
 * Public URLs stay stable; the upload API is closed unless explicitly enabled.
 * Compressed bytes remain opaque because the client performs decompression.
 */
const PUBLIC_ROUTE = '/assets/donors/';
const API_ROUTE = '/api/comparison-display-v10/';
const PREFIX = 'hoa-heart/comparison-display-v10/';
const MAX_BYTES = 16 * 1024 * 1024;
const CACHE_CONTROL = 'private, max-age=0, must-revalidate';
const json = (value, status = 200) => Response.json(value, {
  status, headers: { 'cache-control': 'no-store' },
});
const sha256 = async data => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
  byte => byte.toString(16).padStart(2, '0'),
).join('');

function validEntry(name, entry, maxBytes = MAX_BYTES, jsonNames = []) {
  return Number.isInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= maxBytes
    && /^[a-f0-9]{64}$/.test(entry.sha256)
    && ((name.endsWith('.webp') && entry.contentType === 'image/webp')
      || (name.endsWith('.gz') && ['application/octet-stream', 'application/gzip'].includes(entry.contentType))
      || (jsonNames.includes(name) && name.endsWith('.json') && entry.contentType === 'application/json'));
}

async function boundedBody(request, size) {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) !== size) throw new Error('length');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('body');
  const data = new Uint8Array(size);
  let used = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (used + value.byteLength > size) throw new Error('length');
      data.set(value, used);
      used += value.byteLength;
    }
    if (used !== size) throw new Error('length');
    return data;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

const matches = (object, expected) => object.size === expected.bytes
  && object.customMetadata?.sha256 === expected.sha256;
const discard = async object => { await object?.body?.cancel().catch(() => {}); };
const notModified = (value, etag) => value?.split(',').some(
  item => item.trim() === '*' || item.trim().replace(/^W\//, '') === etag,
);

async function inventory(bucket, index, prefix, uploadsEnabled) {
  const found = new Map();
  let cursor;
  do {
    const page = await bucket.list({
      prefix, limit: 1000, include: ['customMetadata'], ...(cursor ? { cursor } : {}),
    });
    for (const object of page.objects) found.set(object.key.slice(prefix.length), object);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const missing = [], mismatched = [];
  let bytes = 0, verified = 0;
  for (const [name, expected] of Object.entries(index)) {
    const object = found.get(name);
    if (!object) missing.push(name);
    else if (!matches(object, expected)) mismatched.push(name);
    else { verified++; bytes += object.size; }
  }
  return json({
    complete: !missing.length && !mismatched.length,
    expected: Object.keys(index).length, verified, bytes, uploadsEnabled,
    missingCount: missing.length, mismatchCount: mismatched.length,
    missing: missing.slice(0, 10), mismatched: mismatched.slice(0, 10),
  });
}

export async function comparisonDisplayRequest(request, bucket, index, {
  uploadsEnabled = false, servePublic = true,
  publicRoute = PUBLIC_ROUTE, apiRoute = API_ROUTE, prefix = PREFIX, collection = 'comparison-display-v10', maxBytes = MAX_BYTES,
  jsonNames = [],
} = {}) {
  const pathname = new URL(request.url).pathname;
  const api = pathname.startsWith(apiRoute);
  const isPublic = pathname.startsWith(publicRoute);
  if (!api && !isPublic) return null;
  const name = pathname.slice((api ? apiRoute : publicRoute).length);
  const expected = Object.hasOwn(index, name) ? index[name] : null;
  // Unlisted JSON, previous donors and local static files keep their normal path.
  if (!api && (!servePublic || !['GET', 'HEAD'].includes(request.method) || !expected)) return null;
  const status = api && name === 'status' && request.method === 'GET';
  if (!expected && !status) return json({ error: 'Unknown comparison display file.' }, 404);
  if (expected && !validEntry(name, expected, maxBytes, jsonNames)) return json({ error: 'Invalid display manifest.' }, 500);
  if (api && request.method === 'PUT' && !uploadsEnabled) {
    return json({ error: 'Comparison display data is read-only.' }, 405);
  }
  if (!status && !['GET', 'HEAD', 'PUT'].includes(request.method)) {
    return json({ error: 'Method not allowed.' }, 405);
  }
  if (!bucket) return json({ error: 'Comparison display storage is unavailable.' }, 503);
  if (status) return inventory(bucket, index, prefix, uploadsEnabled);

  const key = prefix + name;
  if (api && request.method === 'PUT') {
    let data;
    try { data = await boundedBody(request, expected.bytes); }
    catch { return json({ error: 'Display file length does not match the manifest.' }, 400); }
    if (await sha256(data) !== expected.sha256) {
      return json({ error: 'Display file checksum does not match the manifest.' }, 400);
    }
    const existing = await bucket.head(key);
    if (existing) {
      if (!matches(existing, expected)) return json({ error: 'Immutable display file conflict.' }, 409);
      return new Response(null, { status: 204 });
    }
    await bucket.put(key, data, {
      sha256: expected.sha256,
      httpMetadata: { contentType: expected.contentType, cacheControl: CACHE_CONTROL },
      customMetadata: { sha256: expected.sha256, collection, sourcePath: name },
    });
    return new Response(null, { status: 201 });
  }

  const conditional = request.headers.get('if-none-match');
  let object = request.method === 'HEAD' || conditional ? await bucket.head(key) : await bucket.get(key);
  if (!object) return json({ error: 'Comparison display file is not ready.' }, 503);
  if (!matches(object, expected)) {
    await discard(object);
    return json({ error: 'Comparison display file integrity check failed.' }, 503);
  }
  const etag = `"sha256-${expected.sha256}"`;
  const headers = new Headers({
    'content-type': expected.contentType, 'content-length': String(expected.bytes),
    'cache-control': CACHE_CONTROL, 'etag': etag,
    'x-content-sha256': expected.sha256, 'x-content-type-options': 'nosniff',
  });
  if (notModified(conditional, etag)) {
    headers.delete('content-length');
    return new Response(null, { status: 304, headers });
  }
  if (request.method === 'GET' && conditional) {
    object = await bucket.get(key);
    if (!object || !matches(object, expected)) {
      await discard(object);
      return json({ error: 'Comparison display file integrity check failed.' }, 503);
    }
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}
