import { comparisonDisplayRequest } from './comparison-display-store-v10.mjs';

export const PROBE_HEART_V44_API = '/api/probe-heart-v44/';
export const PROBE_HEART_V44_PUBLIC = '/assets/probe-heart-v44/';
export const PROBE_HEART_V44_NAMES = Object.freeze(['s-20-29.hfm.gz', 's-20-28.hfm.gz']);
// This gate applies only to the two new overview meshes. Existing collections
// and the existing BUCKET binding retain their separate release policies.
export const probeHeartV44ReleasePolicy = 'probe-heart-v44:read-only';
export const probeHeartV44UploadsEnabled = probeHeartV44ReleasePolicy.endsWith(':seed');
export const probeHeartV44PublicServingEnabled = probeHeartV44ReleasePolicy.endsWith(':read-only');

const MAX_BYTES = 3 * 1024 * 1024;
const reply = (error, status) => Response.json({ error }, {
  status,
  headers: { 'cache-control': 'no-store', 'X-Heart-Probe-Heart-Policy': probeHeartV44ReleasePolicy },
});
const validIndex = index => index && typeof index === 'object'
  && Object.keys(index).length === PROBE_HEART_V44_NAMES.length
  && PROBE_HEART_V44_NAMES.every(name => Object.hasOwn(index, name)
    && Number.isSafeInteger(index[name]?.bytes) && index[name].bytes > 0 && index[name].bytes <= MAX_BYTES
    && typeof index[name].sha256 === 'string' && /^[a-f0-9]{64}$/.test(index[name].sha256)
    && index[name].contentType === 'application/octet-stream');

/** Exact opaque HFM gzip transport. Seed access is authenticated GET/PUT only;
 * the final code policy permits public GET/HEAD and cannot be reopened by a
 * retained token. The common store bounds bodies, hashes before writing, and
 * checks stored length/SHA metadata before all reads or idempotent responses.
 */
export async function probeHeartV44Request(request, bucket, index, {
  uploadToken, uploadsEnabled = false, servePublic = probeHeartV44PublicServingEnabled,
} = {}) {
  const path = new URL(request.url).pathname;
  const api = path.startsWith(PROBE_HEART_V44_API);
  const publicAsset = path.startsWith(PROBE_HEART_V44_PUBLIC);
  if (!api && !publicAsset) return null;
  const name = path.slice((api ? PROBE_HEART_V44_API : PROBE_HEART_V44_PUBLIC).length);
  const read = ['GET', 'HEAD'].includes(request.method);
  const enabled = probeHeartV44UploadsEnabled && uploadsEnabled === true
    && typeof uploadToken === 'string' && /^[!-~]{32,256}$/.test(uploadToken);

  if (publicAsset) {
    if (!read) return reply('Probe whole-heart data is read-only.', 405);
    // This small metadata file remains static in both release phases.
    if (name === 'manifest.json') return null;
    if (!PROBE_HEART_V44_NAMES.includes(name)) return reply('Unknown probe whole-heart file.', 404);
    if (!probeHeartV44PublicServingEnabled) return reply('Probe whole-heart meshes are not released.', 503);
    if (!servePublic) return null;
  } else if (probeHeartV44UploadsEnabled) {
    if (!enabled || !['GET', 'PUT'].includes(request.method)) return reply('Probe whole-heart data is read-only.', 405);
    const supplied = request.headers.get('X-Heart-Probe-Heart-Upload') || '';
    if (supplied.length !== uploadToken.length || supplied !== uploadToken) {
      return reply('Probe whole-heart upload is not authorized.', 403);
    }
  } else if (!probeHeartV44PublicServingEnabled || !read) {
    return reply('Probe whole-heart data is read-only.', 405);
  }

  if (!validIndex(index)) return reply('Invalid probe whole-heart manifest.', 500);
  if (!PROBE_HEART_V44_NAMES.includes(name) && !(api && name === 'status' && request.method === 'GET')) {
    return reply('Unknown probe whole-heart file.', 404);
  }
  const response = await comparisonDisplayRequest(request, bucket, index, {
    uploadsEnabled: enabled, servePublic,
    publicRoute: PROBE_HEART_V44_PUBLIC, apiRoute: PROBE_HEART_V44_API,
    prefix: 'hoa-heart/probe-heart-v44/', collection: 'probe-heart-v44', maxBytes: MAX_BYTES,
  });
  if (response) response.headers.set('X-Heart-Probe-Heart-Policy', probeHeartV44ReleasePolicy);
  return response;
}
