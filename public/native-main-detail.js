/** Bounded native-sample refinement in the main viewer; never a whole-heart claim. */
import {NativeEdgeLoader, NATIVE_DIMENSIONS, validateGuidedManifest, selectAvailableTile} from './native-edge-loader.js';
import {pickVolume} from './volume-picking.js';
import {drawIndexedTriangles} from './mesh-draw.js';

export const MAIN_FINE_DIMENSIONS = [1897, 1897, 2117];
export const NATIVE_PRIOR_DIMENSIONS = [1903, 1903, 2120];
export const MAIN_NATIVE_GPU_BUDGET = 128 * 1024 * 1024;
const RATIO = NATIVE_DIMENSIONS.map((n, i) => n / NATIVE_PRIOR_DIMENSIONS[i]);
const abortError = () => new DOMException('A newer native region was selected.', 'AbortError');
const validPoint = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

/** The main display retains s2 indices verbatim and truncates only its far ends.
 * Invert the native bank's center-resize registration, then use main endpoints.
 * See prepare_hosted_sections.py:prepare_display and guided-native-v21/prior.py.
 */
export function nativeIndexToMainWorld(xyz) {
  if (!validPoint(xyz)) throw new Error('Invalid native coordinates.');
  const f = xyz.map((n, i) => (n + .5) / RATIO[i] - .5);
  return [(f[0] - 948) / 2116, (f[2] - 1058) / 2116, -(f[1] - 948) / 2116];
}

export function mainWorldToNativeIndex(world) {
  if (!validPoint(world)) throw new Error('Invalid main-view coordinates.');
  const f = [world[0] * 2116 + 948, -world[2] * 2116 + 948, world[1] * 2116 + 1058];
  return f.map((n, i) => (n + .5) * RATIO[i] - .5);
}

export function nativeTileMainBounds(xyz) {
  if (!validPoint(xyz) || xyz.some((n, i) => !Number.isInteger(n) || n < 0 || (n + 1) * 128 >= NATIVE_DIMENSIONS[i])) throw new Error('Invalid native tile bounds.');
  const a = nativeIndexToMainWorld(xyz.map(n => n * 128));
  const b = nativeIndexToMainWorld(xyz.map(n => (n + 1) * 128));
  return {min: a.map((n, i) => Math.min(n, b[i])), max: a.map((n, i) => Math.max(n, b[i]))};
}

/** The decoder emits original native-world Float32 positions and Int16 normals.
 * Transform just one acknowledged piece in place; no second whole-tile array.
 */
export function registerNativePiece(mesh) {
  if (mesh.positionFormat !== 'float32' || mesh.positionBytes !== 12 || !(mesh.buffer instanceof ArrayBuffer) || !Number.isSafeInteger(mesh.vertexCount) || mesh.vertexCount < 0 || !Number.isSafeInteger(mesh.indexCount) || mesh.indexCount < 0 || mesh.indexCount % 3) throw new Error('Unsupported native surface piece.');
  const p = new Float32Array(mesh.buffer, mesh.positionOffset, mesh.vertexCount * 3);
  const normals = new Int16Array(mesh.buffer, mesh.normalOffset, mesh.vertexCount * 3);
  const normalScale = [RATIO[0], RATIO[2], RATIO[1]];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] * 8479 + 7613 / 2, z = p[i + 1] * 8479 + 8479 / 2, y = -p[i + 2] * 8479 + 7613 / 2;
    p[i] = ((x + .5) / RATIO[0] - .5 - 948) / 2116;
    p[i + 1] = ((z + .5) / RATIO[2] - .5 - 1058) / 2116;
    p[i + 2] = -((y + .5) / RATIO[1] - .5 - 948) / 2116;
    const n0 = normals[i] * normalScale[0], n1 = normals[i + 1] * normalScale[1], n2 = normals[i + 2] * normalScale[2];
    const length = Math.hypot(n0, n1, n2) || 1;
    normals[i] = Math.round(n0 / length * 32767); normals[i + 1] = Math.round(n1 / length * 32767); normals[i + 2] = Math.round(n2 / length * 32767);
  }
  return mesh;
}

/** Own active and staged GPU resources separately; only complete tiles commit. */
export class NativeRegionState {
  constructor({disposePiece, maxBytes = MAIN_NATIVE_GPU_BUDGET}) {
    this.disposePiece = disposePiece; this.maxBytes = maxBytes; this.revision = 0; this.current = null; this.staging = null;
  }
  get bytes() { return (this.current?.bytes || 0) + (this.staging?.bytes || 0); }
  begin() { this.cancel(); this.staging = {revision: this.revision, pieces: [], bytes: 0}; return this.revision; }
  add(revision, index, bytes, createPiece) {
    const stage = this.staging;
    if (!stage || stage.revision !== revision) throw abortError();
    if (index !== stage.pieces.length || index >= 8 || !Number.isSafeInteger(bytes) || bytes < 0 || this.bytes + bytes > this.maxBytes) throw new Error('The native region exceeds its bounded graphics budget.');
    const piece = createPiece();
    stage.pieces.push(piece); stage.bytes += bytes;
    return piece;
  }
  commit(revision, record, result) {
    const stage = this.staging;
    if (!stage || stage.revision !== revision) throw abortError();
    if (stage.pieces.length !== 8 || result.pieces !== 8 || result.triangles <= 0 || stage.pieces.reduce((n, p) => n + p.indexCount / 3, 0) !== result.triangles) throw new Error('The complete native region could not be verified.');
    const previous = this.current;
    this.current = {...stage, record, result, bounds: nativeTileMainBounds(record.xyz)};
    this.staging = null;
    previous?.pieces.forEach(this.disposePiece);
    return this.current;
  }
  cancel() { this.revision++; this.staging?.pieces.forEach(this.disposePiece); this.staging = null; }
  clear() { this.cancel(); this.current?.pieces.forEach(this.disposePiece); this.current = null; }
}

function uploadPiece(gl, mesh) {
  const piece = {vao: null, buffers: [], indexCount: mesh.indexCount};
  if (!mesh.indexCount) return piece;
  try {
    if (gl.isContextLost()) throw new Error('The graphics context was interrupted.');
    piece.vao = gl.createVertexArray(); if (!piece.vao) throw new Error('Native region vertex storage is unavailable.');
    gl.bindVertexArray(piece.vao);
    for (const [location, offset, bytes, type, normalized] of [[0, mesh.positionOffset, mesh.vertexCount * 12, gl.FLOAT, false], [1, mesh.normalOffset, mesh.vertexCount * 6, gl.SHORT, true]]) {
      const buffer = gl.createBuffer(); if (!buffer) throw new Error('Native region storage is unavailable.');
      piece.buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(mesh.buffer, offset, bytes), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 3, type, normalized, 0, 0);
    }
    // Native compact-island cleanup has already removed triangles in the worker.
    gl.disableVertexAttribArray(2); gl.vertexAttrib1f(2, 0);
    const index = gl.createBuffer(); if (!index) throw new Error('Native region index storage is unavailable.');
    piece.buffers.push(index); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.buffer, mesh.indexOffset, mesh.indexCount), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('The graphics device could not retain this native region.');
    return piece;
  } catch (error) { gl.bindVertexArray(null); disposePiece(gl, piece); throw error; }
}
function disposePiece(gl, piece) { piece.buffers.forEach(buffer => gl.deleteBuffer(buffer)); if (piece.vao) gl.deleteVertexArray(piece.vao); }

export class NativeMainDetailController {
  constructor({renderer, donor, mount, toast = () => {}, onChange = () => {}, loader = new NativeEdgeLoader()}) {
    this.renderer = renderer; this.donor = donor; this.mount = mount; this.toast = toast; this.onChange = onChange; this.loader = loader;
    this.visible = true; this.picking = false; this.loading = false; this.disposed = false;
    this.state = new NativeRegionState({disposePiece: piece => disposePiece(renderer.gl, piece)});
    if (donor.id !== 'ladaf-2021-17' || !renderer.gl) { if (mount) mount.hidden = true; return; }
    renderer.nativeMainDetail = this;
    if (mount) this.createControls();
    this.pickStart = event => {
      if (!this.picking || event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.pickDown = [event.clientX, event.clientY];
    };
    this.pickEnd = event => {
      if (!this.picking || !this.pickDown) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const start = this.pickDown; this.pickDown = null;
      if (Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 8) return;
      const rect = renderer.canvas.getBoundingClientRect();
      const hit = pickVolume(renderer, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      if (!hit) { this.toast('Select visible tissue in the main heart view.'); return; }
      this.setPicking(false); void this.loadAt(hit.world);
    };
    this.cancelKey = event => { if (event.key === 'Escape') this.setPicking(false); };
    this.contextLost = () => { this.loader.cancel('detail'); this.state.clear(); this.loading = false; this.statusMessage = 'Native region cleared after graphics interruption.'; this.sync(); };
    renderer.canvas.addEventListener('pointerdown', this.pickStart, true);
    renderer.canvas.addEventListener('pointerup', this.pickEnd, true);
    renderer.canvas.addEventListener('webglcontextlost', this.contextLost);
    globalThis.addEventListener?.('keydown', this.cancelKey);
    this.sync();
  }
  createControls() {
    this.mount.hidden = false;
    this.mount.innerHTML = '<div class="control-section-heading"><h3>Native Detail in This View</h3><span class="subtle-badge">Local Region</span></div>' +
      '<p class="control-note">Select a small surface region to replace it with the reconstruction from 19.85 µm samples. The surrounding heart stays at 79.4 µm; CT sections keep their displayed resolution.</p>' +
      '<div class="button-row"><button type="button" data-native-pick aria-pressed="false">Select Native Region</button><button type="button" data-native-focus>Focus Loaded Region</button><button type="button" data-native-clear>Clear Region</button></div>' +
      '<label class="control-note"><input type="checkbox" data-native-visible checked> Show Loaded Native Region</label>' +
      '<p class="control-note" data-native-status role="status" aria-live="polite"></p>' +
      '<p class="control-note">Each region spans about 2.54 mm. Selection follows the scan volume; focus the loaded region to check its location. Its boundary can remain visible because the reconstructions use different processing. Native detail is denoised and guided by the coarser surface.</p>';
    this.pickButton = this.mount.querySelector('[data-native-pick]'); this.focusButton = this.mount.querySelector('[data-native-focus]');
    this.clearButton = this.mount.querySelector('[data-native-clear]'); this.visibleInput = this.mount.querySelector('[data-native-visible]'); this.status = this.mount.querySelector('[data-native-status]');
    this.pickButton.addEventListener('click', () => this.setPicking(!this.picking));
    this.focusButton.addEventListener('click', () => this.focus());
    this.clearButton.addEventListener('click', () => this.clear());
    this.visibleInput.addEventListener('change', () => { this.visible = this.visibleInput.checked; this.refresh(); });
    this.badge = document.createElement('span'); this.badge.className = 'fine-source-label'; this.badge.hidden = true;
    (document.querySelector('#viewport .source-tag') || document.querySelector('#viewport .viewport-heading'))?.append(this.badge);
  }
  compatible() { const p = this.renderer.fineSurface; return this.donor.id === 'ladaf-2021-17' && this.renderer.settings.debrisCleanupEnabled !== false && p?.lod?.id === 'gentle' && p.activeFor(this.renderer); }
  hasActiveRegion() { return this.visible && !!this.state.current && this.compatible(); }
  activeFor(pass) { return pass === this.renderer.fineSurface && this.hasActiveRegion(); }
  focusViewport() {
    this.renderer.canvas.closest?.('#viewport')?.scrollIntoView?.({behavior: 'smooth', block: 'center'});
    this.renderer.canvas.focus?.({preventScroll: true});
  }
  setPicking(value) {
    if (value && !this.compatible()) { this.toast('Enable Ultra-high Fidelity and detached-debris cleanup before selecting a native region.'); return; }
    if (value) this.renderer.measurementController?.cancelPlacement();
    this.picking = value; this.pickDown = null; this.renderer.canvas.style.cursor = value ? 'crosshair' : '';
    if (value) { this.focusViewport(); this.toast('Click visible tissue in the heart view. Escape cancels.'); }
    this.sync();
  }
  async loadAt(world) {
    if (!this.compatible() || this.disposed) return false;
    const revision = this.state.begin(); this.loader.cancel('detail'); this.loading = true; this.statusMessage = 'Loading the native-region index…'; this.sync();
    try {
      if (!this.manifest) {
        // Concurrent region choices share the verified metadata request.
        this.manifestPromise ||= this.loader.loadManifest(new URL('./assets/guided-native-v21.json', import.meta.url).href)
          .then(({manifest, baseUrl}) => validateGuidedManifest(manifest, baseUrl)).catch(error => { this.manifestPromise = null; throw error; });
        this.manifest = await this.manifestPromise;
      }
      if (revision !== this.state.revision || this.disposed) return false;
      const selected = selectAvailableTile(this.manifest.tiles, mainWorldToNativeIndex(world));
      // A nearest block could replace the wrong visible structure. Keep this selection exact.
      if (!selected.exact) throw new Error('No stored native surface covers that point. Select a nearby tissue surface.');
      const record = selected.tile;
      this.statusMessage = 'Loading 19.85 µm region · the current surface remains visible'; this.sync();
      const result = await this.loader.loadTile({...record, cleanupView: 'cleaned'}, {
        onProgress: progress => { if (revision === this.state.revision && progress.stage === 'mesh') { this.statusMessage = `Preparing native region ${progress.loaded + 1}/8`; this.sync(); } },
        onPiece: (mesh, index, total) => {
          if (revision !== this.state.revision || this.disposed) throw abortError();
          if (total !== 8) throw new Error('Native region piece count is invalid.');
          const bytes = mesh.vertexCount * 18 + mesh.indexCount * 4;
          this.state.add(revision, index, bytes, () => uploadPiece(this.renderer.gl, registerNativePiece(mesh)));
        }
      });
      if (revision !== this.state.revision || this.disposed) return false;
      this.state.commit(revision, record, result); this.loading = false; this.statusMessage = null;
      this.refresh(); return true;
    } catch (error) {
      if (revision !== this.state.revision || this.disposed) return false;
      this.state.cancel(); this.loading = false; this.statusMessage = error.message;
      this.refresh(); if (error.name !== 'AbortError') this.toast(error.message); return false;
    }
  }
  /** Called after the main program is bound, before the Gentle draw. */
  bindBase(pass) {
    const gl = this.renderer.gl, active = this.activeFor(pass), bounds = active ? this.state.current.bounds : null;
    gl.uniform1i(pass.nativeUniforms.nativeReplacementEnabled, active ? 1 : 0);
    gl.uniform1i(pass.nativeUniforms.nativePatchPass, 0);
    if (bounds) { gl.uniform3fv(pass.nativeUniforms.nativeRegionMin, bounds.min); gl.uniform3fv(pass.nativeUniforms.nativeRegionMax, bounds.max); }
  }
  /** Same framebuffer, program, camera, light, clip and lumen masks as Gentle. */
  draw(pass) {
    if (!this.activeFor(pass)) return;
    const gl = this.renderer.gl;
    gl.uniform1i(pass.nativeUniforms.nativePatchPass, 1); gl.uniform1i(pass.debrisEnabled, 0);
    gl.uniform3fv(pass.boundsMin, [0, 0, 0]); gl.uniform3fv(pass.boundsMax, [1, 1, 1]);
    for (const piece of this.state.current.pieces) if (piece.indexCount) {
      gl.bindVertexArray(piece.vao); gl.vertexAttrib1f(2, 0); drawIndexedTriangles(gl, piece.indexCount);
    }
    gl.bindVertexArray(null); gl.uniform1i(pass.nativeUniforms.nativePatchPass, 0);
  }
  focus() {
    if (!this.state.current) return;
    const bounds = this.state.current.bounds;
    this.renderer.camera.pan = bounds.min.map((n, i) => (n + bounds.max[i]) / 2);
    this.renderer.camera.distance = .08; this.renderer.autoRotate = false;
    this.renderer.requestRender('camera'); this.renderer.onChange?.({camera: true}); this.focusViewport();
  }
  clear() { this.loader.cancel('detail'); this.state.clear(); this.loading = false; this.statusMessage = null; this.setPicking(false); this.refresh(); }
  refresh() { this.sync(); this.renderer.requestRender('camera'); this.onChange(); }
  sync() {
    const active = this.hasActiveRegion(), current = this.state.current;
    if (this.pickButton) {
      this.pickButton.disabled = !this.compatible(); this.pickButton.setAttribute('aria-pressed', String(this.picking));
      this.pickButton.textContent = this.picking ? 'Cancel Region Selection' : 'Select Native Region';
      this.focusButton.disabled = !current || !active; this.clearButton.disabled = !current && !this.loading;
      this.visibleInput.disabled = !current; this.visibleInput.checked = this.visible;
      this.mount.setAttribute('aria-busy', String(this.loading));
      const prefix = active ? 'Showing' : this.renderer.settings.debrisCleanupEnabled === false ? 'Retained, hidden for original debris comparison:' : 'Retained, currently hidden:';
      this.status.textContent = this.statusMessage || (current ? prefix + ' local 19.85 µm region · ' + current.record.xyz.join(', ') + ' · ' + Math.round(current.result.triangles).toLocaleString() + ' triangles. Surrounding Ultra-high Fidelity surface: 79.4 µm.' : 'No native region loaded. Select a point while Ultra-high Fidelity and detached-debris cleanup are visible.');
      this.badge.hidden = !active; this.badge.textContent = 'Local Region · 19.85 µm source';
    }
    if (this.picking && !this.compatible()) this.setPicking(false);
  }
  dispose() {
    this.disposed = true; this.loader.dispose(); this.state.clear(); this.setPicking(false);
    const c = this.renderer.canvas; c.removeEventListener('pointerdown', this.pickStart, true); c.removeEventListener('pointerup', this.pickEnd, true); c.removeEventListener('webglcontextlost', this.contextLost);
    globalThis.removeEventListener?.('keydown', this.cancelKey); this.badge?.remove();
    if (this.renderer.nativeMainDetail === this) this.renderer.nativeMainDetail = null;
  }
}
