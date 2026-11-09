/** Submit the unchanged indexed surface in browser-safe, whole-triangle batches.
 * Firefox rejects a draw with more than 30M vertex IDs (Mozilla bug 1849433).
 * The main prepared heart contains 70,856,055 indices. Reusing its existing
 * buffers in bounded calls preserves every vertex, triangle, normal and mask.
 */
export const MAX_MESH_INDICES_PER_DRAW = 3_000_000;

export function drawIndexedTriangles(gl, indexCount) {
  if (!Number.isSafeInteger(indexCount) || indexCount < 0 || indexCount % 3 || indexCount > 0x7fffffff) {
    throw new Error('The surface has an invalid triangle count.');
  }
  let draws = 0;
  for (let first = 0; first < indexCount; first += MAX_MESH_INDICES_PER_DRAW) {
    const count = Math.min(MAX_MESH_INDICES_PER_DRAW, indexCount - first);
    // drawElements offsets are bytes; each original index is an unsigned int.
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, first * 4);
    draws++;
  }
  return draws;
}

/** WebGL records draw failures instead of throwing JavaScript exceptions.
 * Check before presenting the offscreen model, so missing base geometry can
 * never leave just the small repair regions on the user's screen.
 */
export function assertMeshDrawSucceeded(gl) {
  const error = gl.getError();
  if (error !== gl.NO_ERROR || gl.isContextLost()) {
    throw new Error('The graphics device could not draw the complete detailed model' +
      (error !== gl.NO_ERROR ? ' (GL 0x' + error.toString(16) + ')' : '') + '.');
  }
}
