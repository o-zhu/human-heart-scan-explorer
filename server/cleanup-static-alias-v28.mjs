/** Three frozen v27 masks are byte-identical to their retained v28 assets.
 * Keep the historical URLs usable without shipping duplicate static payloads.
 * No storage binding, network fetch, upload gate or access policy is changed.
 */
const LEGACY = /^\/assets\/cleanup-v27\/(arterial|rv|valve-region)\.bits\.gz$/;

export function cleanupStaticAliasRequest(request, index) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  if (!LEGACY.test(url.pathname) || !Object.hasOwn(index, url.pathname)) return null;
  const entry = index[url.pathname];
  const expectedTarget = url.pathname.replace('/cleanup-v27/', '/cleanup-v28/');
  if (entry?.target !== expectedTarget || !Number.isSafeInteger(entry.bytes)
      || entry.bytes < 1 || entry.bytes > 1024 * 1024 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    return new Response('Invalid cleanup static alias.', {
      status: 500, headers: { 'cache-control': 'no-store' },
    });
  }
  // Change only this exact path. Origin and query remain those of the original
  // request, so no user-controlled cross-origin or authentication-root redirect
  // is possible. 308 preserves both GET and HEAD through normal fetch redirects.
  url.pathname = entry.target;
  return new Response(null, {
    status: 308,
    headers: {
      location: url.href,
      'cache-control': 'public, max-age=31536000, immutable',
      'content-length': '0',
    },
  });
}
