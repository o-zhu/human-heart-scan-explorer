import { comparisonDisplayRequest } from './comparison-display-store-v10.mjs';

export const NATIVE_SURFACE_API = '/api/native-surface-v20/';
// Final-release gate. A retained platform secret must never reopen this bank.
export const nativeSurfaceUploadsEnabled = false;
/** A separate immutable collection; existing scan upload gates stay closed. */
export async function nativeSurfaceRequest(request, bucket, index, { uploadToken, uploadsEnabled = false, servePublic = true } = {}) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(NATIVE_SURFACE_API) && !path.startsWith('/assets/native-surface-v20/')) return null;
  const enabled = uploadsEnabled === true && typeof uploadToken === 'string' && uploadToken.length >= 32;
  if (request.method === 'PUT' && path.startsWith(NATIVE_SURFACE_API) && enabled) {
    const provided = request.headers.get('X-Heart-Native-Upload') || '';
    // This Site is public. Service access alone is deliberately insufficient
    // for writing; the temporary collection-specific runtime secret is required.
    if (provided.length !== uploadToken.length || provided !== uploadToken) return Response.json({ error: 'Native collection upload is not authorized.' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  }
  return comparisonDisplayRequest(request, bucket, index, {
    uploadsEnabled: enabled, servePublic,
    publicRoute: '/assets/native-surface-v20/', apiRoute: NATIVE_SURFACE_API,
    prefix: 'hoa-heart/native-surface-v20/', collection: 'native-surface-v20', maxBytes: 32 * 1024 * 1024,
  });
}
