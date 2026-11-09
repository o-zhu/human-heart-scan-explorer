import { comparisonDisplayRequest } from './comparison-display-store-v10.mjs';

export const MOTION_CT_API = '/api/motion-ct-v24/';
export const MOTION_CT_PUBLIC = '/assets/motion-lab-v24/native-ct/';
// Temporary seed gate for this new, separately indexed collection only.
// Set false for the final release: a retained runtime secret cannot reopen it.
export const motionCTUploadsEnabled = false;

/** Immutable, size/SHA-pinned CT display meshes; the manifest stays static. */
export async function motionCTRequest(request, bucket, index, { uploadToken, uploadsEnabled = false, servePublic = true } = {}) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(MOTION_CT_API) && !path.startsWith(MOTION_CT_PUBLIC)) return null;
  const enabled = uploadsEnabled === true && typeof uploadToken === 'string' && uploadToken.length >= 32;
  if (request.method === 'PUT' && path.startsWith(MOTION_CT_API) && enabled) {
    const provided = request.headers.get('X-Heart-Motion-CT-Upload') || '';
    if (provided.length !== uploadToken.length || provided !== uploadToken) {
      return Response.json({ error: 'Motion CT collection upload is not authorized.' }, {
        status: 403, headers: { 'cache-control': 'no-store' },
      });
    }
  }
  return comparisonDisplayRequest(request, bucket, index, {
    uploadsEnabled: enabled, servePublic,
    publicRoute: MOTION_CT_PUBLIC, apiRoute: MOTION_CT_API,
    prefix: 'hoa-heart/motion-ct-v24/', collection: 'motion-ct-v24', maxBytes: 32 * 1024 * 1024,
  });
}
