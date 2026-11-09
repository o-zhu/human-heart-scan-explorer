import { comparisonDisplayRequest } from './comparison-display-store-v10.mjs';

export const CORONARY_V36_API = '/api/coronary-v36/';
export const CORONARY_V36_PUBLIC = '/assets/coronary-v36/';
// A new derivative collection has its own release gate and credential. Never
// reopen an earlier scan, cleanup or display bank to deliver these objects.
export const coronaryV36ReleasePolicy = 'coronary-v36:read-only';
export const coronaryV36UploadsEnabled = coronaryV36ReleasePolicy.endsWith(':seed');
export const coronaryV36PublicServingEnabled = coronaryV36ReleasePolicy.endsWith(':read-only');

const BINARY_NAME = /^[a-z0-9][a-z0-9-]*\.(?:raw|hfm|sfr|bits|mask)(?:\.part-[0-9]{3})?\.gz$/;
const reply = (error, status) => Response.json({ error }, {
  status,
  headers: { 'cache-control': 'no-store', 'X-Heart-Coronary-Policy': coronaryV36ReleasePolicy },
});

export async function coronaryV36Request(request, bucket, index, {
  uploadToken, uploadsEnabled = false, servePublic = coronaryV36PublicServingEnabled,
} = {}) {
  const path = new URL(request.url).pathname;
  const api = path.startsWith(CORONARY_V36_API);
  const publicAsset = path.startsWith(CORONARY_V36_PUBLIC);
  if (!api && !publicAsset) return null;
  const name = path.slice((api ? CORONARY_V36_API : CORONARY_V36_PUBLIC).length);
  const read = ['GET', 'HEAD'].includes(request.method);
  const enabled = coronaryV36UploadsEnabled && uploadsEnabled === true
    && typeof uploadToken === 'string' && /^[!-~]{32,256}$/.test(uploadToken);

  // Code policy is authoritative, even if a retired secret and an explicit
  // uploadsEnabled option survive. All public writes are always rejected.
  if (!read && !(api && request.method === 'PUT' && enabled)) {
    return reply('Coronary reconstruction data is read-only.', 405);
  }
  if (api && request.method === 'PUT') {
    const supplied = request.headers.get('X-Heart-Coronary-Upload') || '';
    if (supplied.length !== uploadToken.length || supplied !== uploadToken) {
      return reply('Coronary reconstruction upload is not authorized.', 403);
    }
  }

  if (publicAsset) {
    // Small manifests remain normal static files. Binary seed requests must
    // not fall through to accidental build copies before verified release.
    if (name.endsWith('.json')) return null;
    if (!coronaryV36PublicServingEnabled) {
      return reply('Coronary reconstruction derivatives are not released.', 503);
    }
    if (!servePublic) return null; // Local preview uses the verified source copy.
    if (!Object.hasOwn(index, name)) return reply('Unknown coronary reconstruction file.', 404);
  }
  if (Object.hasOwn(index, name) && !BINARY_NAME.test(name)) {
    return reply('Invalid coronary reconstruction manifest.', 500);
  }
  const response = await comparisonDisplayRequest(request, bucket, index, {
    uploadsEnabled: enabled, servePublic,
    publicRoute: CORONARY_V36_PUBLIC, apiRoute: CORONARY_V36_API,
    prefix: 'hoa-heart/coronary-v36/', collection: 'coronary-v36',
    maxBytes: 4 * 1024 * 1024,
  });
  if (response) response.headers.set('X-Heart-Coronary-Policy', coronaryV36ReleasePolicy);
  return response;
}
