import { comparisonDisplayRequest } from './comparison-display-store-v10.mjs';

export const CLEANUP_V30_API = '/api/cleanup-v30/';
// This collection contains only the new, reversible reconstruction derivatives.
// Existing scan and display collections retain their closed upload gates.
// One retained marker controls both gates, so staging can distinguish a seed
// Worker from the read-only Worker even when their object indices are equal.
export const cleanupV30ReleasePolicy = 'cleanup-v30:read-only';
export const cleanupV30UploadsEnabled = cleanupV30ReleasePolicy.endsWith(':seed');
export const cleanupV30PublicServingEnabled = cleanupV30ReleasePolicy.endsWith(':read-only');

export async function cleanupV30Request(request, bucket, index, {
  uploadToken, uploadsEnabled = false, servePublic = true,
} = {}) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(CLEANUP_V30_API) && !path.startsWith('/assets/cleanup-v30/')) return null;
  const enabled = uploadsEnabled === true && typeof uploadToken === 'string' && uploadToken.length >= 32;
  if (request.method === 'PUT' && path.startsWith(CLEANUP_V30_API) && enabled) {
    const supplied = request.headers.get('X-Heart-Cleanup-Upload') || '';
    if (supplied.length !== uploadToken.length || supplied !== uploadToken) {
      return Response.json({ error: 'Reconstruction cleanup upload is not authorized.' }, {
        status: 403, headers: { 'cache-control': 'no-store' },
      });
    }
  }
  const response = await comparisonDisplayRequest(request, bucket, index, {
    uploadsEnabled: enabled, servePublic,
    publicRoute: '/assets/cleanup-v30/', apiRoute: CLEANUP_V30_API,
    prefix: 'hoa-heart/cleanup-v30/', collection: 'cleanup-v30',
    maxBytes: 8 * 1024 * 1024,
  });
  if (response) response.headers.set('X-Heart-Cleanup-Policy', cleanupV30ReleasePolicy);
  return response;
}
