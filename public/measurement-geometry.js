/** Measurement uses the same centre-to-centre physical extent as the viewer.
 * Source sampling labels are deliberately not a substitute for this scale. */
export function measurementGeometry(meta) {
  const dimensions = meta?.dimensions;
  const spacing = Array.isArray(meta?.spacingUm) ? meta.spacingUm : [meta?.spacingUm, meta?.spacingUm, meta?.spacingUm];
  if (!Array.isArray(dimensions) || dimensions.length !== 3 || spacing.length !== 3 ||
      !dimensions.every(n => Number.isFinite(n) && n >= 2) || !spacing.every(n => Number.isFinite(n) && n > 0)) return null;
  const sizeMm = dimensions.map((n, i) => (n - 1) * spacing[i] / 1000);
  const longestMm = Math.max(...sizeMm);
  return Number.isFinite(longestMm) && longestMm > 0 ? { sizeMm, longestMm } : null;
}

export const validMeasurementPoint = point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

export function measurementDistanceMm(a, b, geometry) {
  if (!validMeasurementPoint(a) || !validMeasurementPoint(b) || !Number.isFinite(geometry?.longestMm) || !(geometry.longestMm > 0)) return null;
  return Math.hypot(...b.map((n, i) => n - a[i])) * geometry.longestMm;
}

export function projectMeasurementPoint(point, basis, width, height, aspect = width / height) {
  if (!validMeasurementPoint(point) || !basis || !(width > 0 && height > 0)) return null;
  const d = point.map((n, i) => n - basis.eye[i]);
  const dot = vector => d.reduce((sum, n, i) => sum + n * vector[i], 0);
  const depth = dot(basis.forward);
  if (!(depth > .01) || !Number.isFinite(depth)) return null;
  const x = (.5 + dot(basis.right) / (2 * .32 * depth * aspect)) * width;
  const y = (.5 - dot(basis.up) / (2 * .32 * depth)) * height;
  return Number.isFinite(x + y) ? { x, y, depth } : null;
}
