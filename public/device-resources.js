/** Conservative resource budgets, independent of viewport size.
 * A phone's short download is not a promise that its decoded CPU/GPU working
 * set fits. iPadOS can advertise a desktop Mac user agent and no deviceMemory.
 * Resolve on the Window and pass the result to workers (which lack touch data).
 */
const MiB = 1024 * 1024;

export function getDeviceResourcePolicy({navigator: nav = globalThis.navigator, recovery = false} = {}) {
  const ua = String(nav?.userAgent || '');
  const platform = String(nav?.platform || '');
  const reportedMemory = Number(nav?.deviceMemory);
  const memory = Number.isFinite(reportedMemory) && reportedMemory > 0 ? reportedMemory : null;
  const reportedCores = Number(nav?.hardwareConcurrency);
  const cores = Number.isFinite(reportedCores) && reportedCores > 0 ? reportedCores : null;
  const appleTouch = /iPad|iPhone|iPod/i.test(ua) ||
    (/Mac/i.test(platform + ' ' + ua) && Number(nav?.maxTouchPoints) > 1);
  const mobile = appleTouch || /Android|Mobile|Tablet/i.test(ua) || nav?.userAgentData?.mobile === true;
  const low = memory !== null && memory <= 2;
  const limitedCpu = cores !== null && cores <= 4;
  const constrained = recovery || mobile || (memory !== null && memory <= 4) || limitedCpu;
  // Device hints control scheduling, not attainable detail. iPadOS usually
  // omits memory and even a reported value is not a GPU allocation test. Give
  // every normal visit one progressive Ultra attempt; actual failed loads or
  // graphics allocations keep the cleaned smaller surface and expose Retry.
  const allowUltraSurface = !recovery;
  const cautious = constrained || memory === null;
  const tier = recovery ? 'recovery' : low ? 'low-memory' : mobile ? 'mobile' : memory !== null && memory <= 4 ? 'limited-memory' : limitedCpu ? 'limited-cpu' : memory === null ? 'unknown-memory' : 'desktop';
  return Object.freeze({
    tier, constrained, mobile, appleTouch, reportedMemoryGiB: memory, reportedCores: cores,
    defaultSurface: allowUltraSurface ? 'gentle' : low || recovery ? 'balanced' : 'detail',
    // New visits show the cleaned compact model, then continue to the highest
    // permitted surface. Explicit user selections still take precedence.
    startupSurface: low || recovery ? 'balanced' : 'detail',
    allowUltraSurface,
    sparseReviewedMasks: cautious,
    boundedSurfaceHash: cautious,
    surfaceLookahead: !cautious && !limitedCpu,
    maxSurfaceDecodedBytes: allowUltraSurface ? 512 * MiB : 64 * MiB,
    fineBrickBytes: (low || recovery ? 48 : constrained ? 64 : memory === null ? 128 : memory < 8 ? 256 : 384) * MiB,
    preparedPlaneBytes: (low || recovery ? 12 : constrained ? 16 : 32) * MiB,
    resultCacheBytes: (low || recovery ? 12 : constrained ? 16 : 32) * MiB,
    sectionCacheBytes: (low || recovery ? 24 : constrained ? 32 : cautious ? 48 : 96) * MiB,
    clinicalFrameBytes: (low || recovery ? 48 : constrained ? 64 : cautious ? 96 : 192) * MiB,
    fineForeground: low || recovery ? 2 : constrained ? 4 : cautious ? 6 : 12,
    fineBackground: cautious ? 1 : 3,
    maxRenderPixels: constrained ? 1000000 : cautious ? 2000000 : Infinity,
    maxPixelRatio: cautious ? 1.5 : 2,
  });
}

export function permittedSurface(id, policy = getDeviceResourcePolicy()) {
  return id === 'gentle' && !policy.allowUltraSurface ? policy.defaultSurface : id;
}

export function assertSurfaceBudget(lod, policy = getDeviceResourcePolicy()) {
  if (!Number.isSafeInteger(lod?.decodedBytes) || lod.decodedBytes <= 0 || lod.decodedBytes > policy.maxSurfaceDecodedBytes)
    throw new Error('This surface exceeds the device memory budget. Use the smaller detail surface.');
}
