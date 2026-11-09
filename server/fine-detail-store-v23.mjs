import { comparisonDisplayRequest } from './comparison-display-store-v10.mjs';

export const FINE_DETAIL_API = '/api/fine-detail-v23/';
// Closed in the final release, independently of any retained runtime secret.
export const fineDetailUploadsEnabled = false;
export const fineDetailPublicServingEnabled = true;

/** A new immutable collection. No older scan or surface upload gate is changed. */
export async function fineDetailRequest(request, bucket, index, {
  uploadToken, uploadsEnabled = false, servePublic = true,
} = {}) {
  const path = new URL(request.url).pathname;
  const api = path.startsWith(FINE_DETAIL_API);
  const publicAsset = path.startsWith('/assets/fine-surface-v19/')
    || path.startsWith('/assets/fine-surface-v23/');
  if (!api && !publicAsset) return null;
  const enabled = uploadsEnabled === true && typeof uploadToken === 'string' && uploadToken.length >= 32;
  if (api && request.method === 'PUT' && enabled) {
    const provided = request.headers.get('X-Heart-Fine-Upload') || '';
    if (provided.length !== uploadToken.length || provided !== uploadToken) {
      return Response.json({ error: 'Fine-detail collection upload is not authorized.' }, {
        status: 403, headers: { 'cache-control': 'no-store' },
      });
    }
  }
  return comparisonDisplayRequest(request, bucket, index, {
    uploadsEnabled: enabled, servePublic,
    publicRoute: '/assets/', apiRoute: FINE_DETAIL_API,
    prefix: 'hoa-heart/fine-detail-v23/', collection: 'fine-detail-v23',
    maxBytes: 32 * 1024 * 1024,
  });
}
