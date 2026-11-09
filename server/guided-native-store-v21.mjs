/** Immutable, content-addressed native surface checkpoints for this public Site.
 * Gzip files are opaque bytes: decompression belongs to the reader.
 */
export const GUIDED_NATIVE_API = '/api/guided-native-v21/';
export const GUIDED_NATIVE_PREFIX = 'hoa-heart/guided-native-v21/';
// Seed-release gate. Set false for the final release; a retained secret alone
// and even an incorrect caller option must never reopen the collection.
export const guidedNativeUploadsEnabled = false;

const COLLECTION = 'guided-native-v21';
const TILE_MAX_BYTES = 4 * 1024 * 1024;
const OTHER_MAX_BYTES = 32 * 1024 * 1024;
const CACHE_CONTROL = 'public, max-age=31536000, immutable, no-transform';
const json = (value, status, headers = {}) => Response.json(value, {
  status, headers: { 'cache-control': 'no-store', ...headers },
});
const hex = data => Array.from(new Uint8Array(data), b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async data => hex(await crypto.subtle.digest('SHA-256', data));
const discard = async object => { await object?.body?.cancel().catch(() => {}); };

function asset(name) {
  let match = /^tiles\/(0|[1-9]\d?)_(0|[1-9]\d?)_(0|[1-9]\d?)-([a-f0-9]{64})\.nbe\.gz$/.exec(name);
  if (match) {
    if (+match[1] >= 60 || +match[2] >= 60 || +match[3] >= 67) return null;
    return { name, sha256: match[4], maxBytes: TILE_MAX_BYTES, kind: 'tile' };
  }
  match = /^overview\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}-([a-f0-9]{64})\.hfm\.gz$/.exec(name);
  if (match) return { name, sha256: match[1], maxBytes: OTHER_MAX_BYTES, kind: 'overview' };
  match = /^manifest-([a-f0-9]{64})\.json\.gz$/.exec(name);
  return match ? { name, sha256: match[1], maxBytes: OTHER_MAX_BYTES, kind: 'manifest' } : null;
}

function validSecret(secret) {
  return typeof secret === 'string' && secret.length >= 32 && secret.length <= 4096
    && /^[\x21-\x7e]+$/.test(secret);
}

function sameSecret(provided, expected) {
  if (provided.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

class BodyError extends Error {
  constructor(status) { super('Invalid bounded upload body.'); this.status = status; }
}

async function boundedBody(request, maxBytes) {
  const declared = request.headers.get('content-length');
  if (declared !== null && !/^[1-9]\d*$/.test(declared)) throw new BodyError(400);
  const size = declared === null ? null : Number(declared);
  if (size !== null && (!Number.isSafeInteger(size) || size > maxBytes)) throw new BodyError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new BodyError(400);
  const data = new Uint8Array(size ?? maxBytes);
  let used = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (used + value.byteLength > maxBytes) throw new BodyError(413);
      if (used + value.byteLength > data.length) throw new BodyError(400);
      data.set(value, used);
      used += value.byteLength;
    }
    if (!used || (size !== null && used !== size)) throw new BodyError(400);
    return data.subarray(0, used);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function matches(object, expected, size) {
  return object && Number.isSafeInteger(object.size) && object.size > 0
    && object.size <= expected.maxBytes && (size === undefined || object.size === size)
    && object.customMetadata?.sha256 === expected.sha256
    && object.customMetadata?.collection === COLLECTION
    && object.customMetadata?.sourcePath === expected.name
    && object.checksums?.sha256 && hex(object.checksums.sha256) === expected.sha256;
}

const notModified = (value, etag) => value?.split(',').some(
  item => item.trim() === '*' || item.trim().replace(/^W\//, '') === etag,
);

/**
 * Integration: guidedNativeRequest(request, bucket, {
 *   uploadToken: env.HEART_GUIDED_NATIVE_UPLOAD_TOKEN,
 *   uploadsEnabled: guidedNativeUploadsEnabled,
 * }). Returns null for routes outside this collection.
 */
export async function guidedNativeRequest(request, bucket, {
  uploadToken, uploadsEnabled = false,
} = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(GUIDED_NATIVE_API)) return null;
  const enabled = guidedNativeUploadsEnabled && uploadsEnabled === true && validSecret(uploadToken);
  if (request.method === 'PUT' && !enabled) {
    return json({ error: 'Guided native collection is read-only.' }, 405, { allow: 'GET, HEAD' });
  }
  if (!['GET', 'HEAD', 'PUT'].includes(request.method)) {
    return json({ error: 'Method not allowed.' }, 405, { allow: enabled ? 'GET, HEAD, PUT' : 'GET, HEAD' });
  }
  if (request.method === 'PUT' && !sameSecret(request.headers.get('X-Heart-Guided-Upload') || '', uploadToken)) {
    return json({ error: 'Guided native collection upload is not authorized.' }, 403);
  }
  const name = url.pathname.slice(GUIDED_NATIVE_API.length);
  const expected = !url.search && !url.hash ? asset(name) : null;
  if (!expected) return json({ error: 'Unknown guided native object.' }, 404);
  if (!bucket) return json({ error: 'Guided native storage is unavailable.' }, 503);
  const key = GUIDED_NATIVE_PREFIX + name;
  try {
    if (request.method === 'PUT') {
      let data;
      try { data = await boundedBody(request, expected.maxBytes); }
      catch (error) { return json({ error: 'Invalid guided native upload length.' }, error instanceof BodyError ? error.status : 400); }
      if (await sha256(data) !== expected.sha256) {
        return json({ error: 'Guided native checksum differs from its content-addressed name.' }, 400);
      }
      const headers = { 'cache-control': 'no-store', 'x-content-sha256': expected.sha256,
        location: GUIDED_NATIVE_API + name };
      const existing = await bucket.head(key);
      if (existing) {
        return matches(existing, expected, data.byteLength)
          ? new Response(null, { status: 204, headers })
          : json({ error: 'Immutable guided native object conflict.' }, 409);
      }
      // The conditional write also closes the head/put race. R2 returns null
      // if another request created this immutable key in the meantime.
      const stored = await bucket.put(key, data, {
        onlyIf: new Headers({ 'If-None-Match': '*' }),
        sha256: expected.sha256,
        httpMetadata: { contentType: 'application/octet-stream', cacheControl: CACHE_CONTROL },
        customMetadata: { sha256: expected.sha256, collection: COLLECTION, sourcePath: name, kind: expected.kind },
      });
      if (stored === null) {
        const winner = await bucket.head(key);
        return matches(winner, expected, data.byteLength)
          ? new Response(null, { status: 204, headers })
          : json({ error: 'Immutable guided native object conflict.' }, 409);
      }
      if (!matches(stored, expected, data.byteLength)) {
        return json({ error: 'Guided native stored-object verification failed.' }, 503);
      }
      return new Response(null, { status: 201, headers });
    }

    const conditional = request.headers.get('if-none-match');
    let object = request.method === 'HEAD' || conditional ? await bucket.head(key) : await bucket.get(key);
    if (!object) return json({ error: 'Guided native object is not ready.' }, 404);
    if (!matches(object, expected)) {
      await discard(object);
      return json({ error: 'Guided native object integrity check failed.' }, 503);
    }
    const etag = `"sha256-${expected.sha256}"`;
    const headers = new Headers({
      'content-type': 'application/octet-stream', 'content-length': String(object.size),
      'cache-control': CACHE_CONTROL, etag,
      'x-content-sha256': expected.sha256, 'x-content-type-options': 'nosniff',
    });
    if (notModified(conditional, etag)) {
      headers.delete('content-length');
      return new Response(null, { status: 304, headers });
    }
    if (request.method === 'GET' && conditional) {
      object = await bucket.get(key);
      if (!matches(object, expected)) {
        await discard(object);
        return json({ error: 'Guided native object integrity check failed.' }, 503);
      }
    }
    // Never copy stored HTTP metadata wholesale: Content-Encoding must remain
    // absent so both clients and checksum verification receive the exact gzip.
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  } catch {
    return json({ error: 'Guided native storage request failed.' }, 503);
  }
}
