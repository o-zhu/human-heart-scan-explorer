import { comparisonDisplayRequest } from './comparison-display-store-v10.mjs';

export const DISPLAY_COMPACT_API = '/api/display-compact-v29/';
// This is a new derived-display collection. All source-bank gates stay closed.
// A retained runtime secret cannot reopen the final release's upload gate.
export const displayCompactUploadsEnabled = false;
export const displayCompactPublicServingEnabled = true;

export async function displayCompactRequest(request, bucket, index, {
  uploadToken, uploadsEnabled = false, servePublic = true,
} = {}) {
  let path = new URL(request.url).pathname;
  // New reconstruction derivatives retain readable, versioned URLs. Only
  // indexed binary files are routed to this new bank; manifests stay static.
  if (path.startsWith('/assets/cleanup-v29/')) {
    const key = 'cleanup/' + path.slice('/assets/cleanup-v29/'.length);
    if (!servePublic || !['GET', 'HEAD'].includes(request.method) || !Object.hasOwn(index, key)) return null;
    const url = new URL(request.url); url.pathname = '/assets/display-compact-v29/' + key;
    request = new Request(url, request); path = url.pathname;
  }
  if (!path.startsWith(DISPLAY_COMPACT_API) && !path.startsWith('/assets/display-compact-v29/')) return null;
  const enabled = uploadsEnabled === true && typeof uploadToken === 'string' && uploadToken.length >= 32;
  if (request.method === 'PUT' && path.startsWith(DISPLAY_COMPACT_API) && enabled) {
    const supplied = request.headers.get('X-Heart-Compact-Upload') || '';
    if (supplied.length !== uploadToken.length || supplied !== uploadToken) {
      return Response.json({ error: 'Compact display upload is not authorized.' }, {
        status: 403, headers: { 'cache-control': 'no-store' },
      });
    }
  }
  return comparisonDisplayRequest(request, bucket, index, {
    uploadsEnabled: enabled, servePublic,
    publicRoute: '/assets/display-compact-v29/', apiRoute: DISPLAY_COMPACT_API,
    prefix: 'hoa-heart/display-compact-v29/', collection: 'display-compact-v29',
    maxBytes: 8 * 1024 * 1024,
    jsonNames: ['sections-manifest.json', 'mesh-manifest.json', 'surface-manifest.json'],
  });
}
