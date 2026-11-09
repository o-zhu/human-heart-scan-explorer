import {titleCaseUi} from './ui-text.js';
import { NativeMeshLoader } from './native-mesh-loader.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const mb = bytes => `${(bytes / 1e6).toFixed(1)} MB`;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform vec3 uMin, uMax, uRight, uUp, uView;
uniform vec2 uPan;
uniform float uSpan, uAspect;
uniform bool uFloatPosition;
out vec3 vPosition, vNormal;
void main(){
 vec3 p=uFloatPosition?aPosition:mix(uMin,uMax,aPosition);
 vPosition=p;vNormal=aNormal;
 gl_Position=vec4(2.0*(dot(p,uRight)+uPan.x)/(uSpan*uAspect),2.0*(dot(p,uUp)+uPan.y)/uSpan,-dot(p,uView)/3.0,1.0);
}`;
const fragment = `#version 300 es
precision highp float;
in vec3 vPosition, vNormal;
uniform vec3 uView,uRight,uUp,uCutAxis;
uniform float uCutValue,uCutSign;
uniform bool uCutEnabled;
out vec4 outColor;
void main(){
 if(uCutEnabled && uCutSign*(dot(vPosition,uCutAxis)-uCutValue)>0.0)discard;
 vec3 n=normalize(vNormal);if(dot(n,uView)<0.0)n=-n;
 vec3 l=normalize(uView*.65+uRight*.42+uUp*.65);
 vec3 l2=normalize(uView*.45-uRight*.8+uUp*.15);
 float diffuse=max(dot(n,l),0.0),fill=max(dot(n,l2),0.0);
 float spec=pow(max(dot(n,normalize(l+uView)),0.0),34.0);
 float rim=pow(1.0-max(dot(n,uView),0.0),3.0);
 vec3 color=vec3(.54,.365,.27)*(.24+.67*diffuse+.14*fill)+vec3(.10)*spec+vec3(.018,.027,.025)*rim;
 outColor=vec4(pow(color,vec3(1.0/2.2)),1.0);
}`;

class MeshPane {
  constructor(name, onChange) {
    this.name = name; this.canvas = $(`${name}Canvas`); this.message = $(`${name}Message`); this.revision = 0;
    this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!this.gl) throw new Error('Interactive native surfaces require WebGL 2. The recorded comparison is available below.');
    this.initialize();
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; this.setMessage('Graphics memory was released. Waiting to restore this view…'); });
    this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.mesh = null; this.initialize(); onChange(this.name, $(`${name}Choice`).value, true); });
  }
  initialize() {
    const gl = this.gl;
    const shader = (type, source) => {
      const result = gl.createShader(type); gl.shaderSource(result, source); gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(result); gl.deleteShader(result); throw new Error(`Surface shader could not compile: ${error}`); }
      return result;
    };
    const vs = shader(gl.VERTEX_SHADER, vertex), fs = shader(gl.FRAGMENT_SHADER, fragment), program = gl.createProgram();
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Native surface renderer could not initialize.');
    this.program = program; this.u = {};
    for (const key of ['Min', 'Max', 'Right', 'Up', 'View', 'Pan', 'Span', 'Aspect', 'FloatPosition', 'CutAxis', 'CutValue', 'CutSign', 'CutEnabled']) this.u[key] = gl.getUniformLocation(program, `u${key}`);
  }
  setMessage(text) { this.message.textContent = text; this.message.hidden = !text; }
  upload(decoded, lod) {
    if (this.lost) throw new Error('Graphics context is unavailable.');
    const gl = this.gl, next = { vao: gl.createVertexArray(), buffers: [], count: decoded.indexCount, lod, float: decoded.positionFormat === 'float32' };
    try {
      if (!next.vao) throw new Error('Native surface graphics storage is unavailable.');
      gl.bindVertexArray(next.vao);
      for (const [attribute, offset, length, type, normalized] of [
        [0, decoded.positionOffset, decoded.vertexCount * decoded.positionBytes, next.float ? gl.FLOAT : gl.UNSIGNED_SHORT, !next.float],
        [1, decoded.normalOffset, decoded.vertexCount * 6, gl.SHORT, true],
      ]) {
        const buffer = gl.createBuffer(); if (!buffer) throw new Error('Native surface graphics storage is unavailable.');
        next.buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(decoded.buffer, offset, length), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 3, type, normalized, 0, 0);
      }
      const index = gl.createBuffer(); if (!index) throw new Error('Native surface index storage is unavailable.');
      next.buffers.push(index); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(decoded.buffer, decoded.indexOffset, decoded.indexCount), gl.STATIC_DRAW);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('This device has insufficient graphics memory for the selected native surface.');
    } catch (error) { this.release(next); throw error; }
    finally { gl.bindVertexArray(null); }
    this.release(this.mesh); this.mesh = next; this.setMessage('');
  }
  release(mesh) { if (!mesh) return; for (const buffer of mesh.buffers) this.gl.deleteBuffer(buffer); this.gl.deleteVertexArray(mesh.vao); }
  draw(camera, cut, manifest) {
    const gl = this.gl, rect = this.canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    if (this.lost) return;
    gl.viewport(0, 0, width, height); gl.clearColor(.027, .047, .060, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.mesh) return;
    const right = [Math.cos(camera.yaw), 0, -Math.sin(camera.yaw)];
    const view = [Math.sin(camera.yaw) * Math.cos(camera.pitch), Math.sin(camera.pitch), Math.cos(camera.yaw) * Math.cos(camera.pitch)];
    const up = [-Math.sin(camera.pitch) * Math.sin(camera.yaw), Math.cos(camera.pitch), -Math.sin(camera.pitch) * Math.cos(camera.yaw)];
    const u = this.u, bounds = this.mesh.lod.bounds || manifest.bounds;
    gl.useProgram(this.program); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.uniform3fv(u.Min, bounds.min); gl.uniform3fv(u.Max, bounds.max); gl.uniform3fv(u.Right, right); gl.uniform3fv(u.Up, up); gl.uniform3fv(u.View, view);
    gl.uniform2fv(u.Pan, camera.pan); gl.uniform1f(u.Span, camera.span); gl.uniform1f(u.Aspect, width / height); gl.uniform1i(u.FloatPosition, this.mesh.float ? 1 : 0);
    const axes = { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] }, component = { x: 0, y: 2, z: 1 };
    gl.uniform1i(u.CutEnabled, cut.axis === 'none' ? 0 : 1); gl.uniform3fv(u.CutAxis, axes[cut.axis] || [0, 0, 0]);
    gl.uniform1f(u.CutValue, (cut.position - .5) * (manifest.extent[component[cut.axis]] || 1)); gl.uniform1f(u.CutSign, cut.flip ? -1 : 1);
    gl.bindVertexArray(this.mesh.vao); gl.drawElements(gl.TRIANGLES, this.mesh.count, gl.UNSIGNED_INT, 0); gl.bindVertexArray(null);
    const longestMm = Math.max(...manifest.roi.physicalSizeMm), desired = camera.span * longestMm * 70 / Math.max(1, rect.height);
    const power = 10 ** Math.floor(Math.log10(desired)), distance = [1, 2, 5, 10].find(n => n * power >= desired) * power;
    $(`${this.name}Scale`).textContent = `${distance < 1 ? Number((distance * 1000).toPrecision(3)) + ' µm' : Number(distance.toPrecision(3)) + ' mm'}`;
    $(`${this.name}Scale`).previousElementSibling.style.width = `${distance / (camera.span * longestMm) * rect.height}px`;
  }
  dispose() { this.release(this.mesh); this.gl.deleteProgram(this.program); }
}

let manifest, panes = {}, scheduled = false, fallbackShown = false;
const loader = new NativeMeshLoader();
const camera = { yaw: .48, pitch: .28, span: 1.45, pan: [0, 0] };
const cut = { axis: 'none', position: .5, flip: false };
function requestDraw() {
  if (scheduled || !manifest) return;
  scheduled = true; requestAnimationFrame(() => { scheduled = false; for (const pane of Object.values(panes)) pane.draw(camera, cut, manifest); });
}
function showFallback() {
  if (fallbackShown) return; fallbackShown = true;
  $('staticComparison').hidden = false; $('comparisonImage').src = './assets/native-surface-v20/comparison.webp';
}
function updateMetrics(lod) {
  const movement = lod.maximumGeometryDisplacementUm || 0;
  $('gridMetric').textContent = `${lod.sourceSpacingUm} µm`;
  $('movementMetric').textContent = lod.id === 'overview' ? 'Separate grid' : lod.id === 'bilateral' ? 'Topology changes' : movement === 0 ? '0 µm' : `${movement.toFixed(3)} µm`;
  $('movementNote').textContent = lod.id === 'overview' ? 'Overview uses its own coarser samples' : lod.id === 'bilateral' ? 'Denoising can change small structures' : movement === 0 ? 'Same geometry as the native reference' : 'Maximum measured vertex movement';
  $('triangleMetric').textContent = number.format(lod.triangles);
  $('triangleNote').textContent = lod.id === 'overview' ? 'Actual 317.6 µm source overview' : lod.id === 'bilateral' ? 'Extracted from an explicitly filtered source' : 'No decimation or component removal';
  $('downloadMetric').textContent = mb(lod.compressedBytes);
  const descriptions = {
    overview: 'The overview is extracted from the actual 317.6 µm source pyramid in the same physical crop. It provides a sampling comparison; its geometry is not the native reference.',
    native: 'The native reference uses the original 16-bit samples at 19.85 µm, with no scalar blur, triangle reduction or disconnected-component removal. This also retains noise and small threshold-dependent structures.',
    normals: 'Smooth lighting changes only the vertex normals used for illumination. Every vertex position and triangle remains identical to the native reference. This improves the lighting response without moving the surface.',
    gentle: 'Gentle geometry smoothing preserves all vertices and triangle connections. Crop boundaries and detected features are pinned, and movement is limited to one quarter of a native voxel. The measured maximum is shown above.',
    moderate: 'Moderate geometry smoothing preserves the same triangle connections but allows up to half a native voxel of movement. This is an experimental comparison; a movement bound alone does not guarantee that every thin structure remains anatomically faithful.',
    bilateral: 'Experimental edge-aware denoising filters the scalar samples before surface extraction, using a 0.65-voxel spatial scale and a 600-unit intensity scale. The original source remains intact. This can suppress noise and also change thin structures and connectivity, so compare it directly with the native reference; it is not the default.',
  };
  $('methodDescription').textContent = descriptions[lod.id] || manifest.processing.source;
}
function syncPageStatus() {
  const views = Object.values(panes), failed = views.find(pane => pane.loadError);
  $('pageStatus').textContent = views.some(pane => pane.loading)
    ? 'Preparing the selected surface. The current views remain usable.'
    : failed ? failed.loadError
      : 'Linked views ready · original source data, fixed threshold · drag either view to explore.';
}
async function choose(name, id, force = false) {
  const pane = panes[name], lod = manifest?.lods.find(item => item.id === id);
  if (!pane || !lod) return;
  const revision = ++pane.revision;
  pane.loadError = null;
  if (!force && pane.mesh?.lod.id === id) {
    loader.cancel(name); loader.pump(); pane.loading = false; pane.setMessage('');
    $(`${name}Choice`).removeAttribute('aria-busy');
    if (name === 'candidate') updateMetrics(lod);
    syncPageStatus(); return;
  }
  pane.loading = true;
  pane.setMessage(`Loading ${mb(lod.compressedBytes)} · ${lod.label}…`);
  $(`${name}Choice`).setAttribute('aria-busy', 'true');
  syncPageStatus();
  try {
    const decoded = await loader.load(name, lod);
    if (revision !== pane.revision) return;
    pane.upload(decoded, lod);
    $(`${name}Spacing`).textContent = `${lod.sourceSpacingUm} µm`;
    $(`${name}Label`).textContent = lod.label;
    $(`${name}Detail`).textContent = `${number.format(lod.triangles)} triangles · ${mb(lod.compressedBytes)} · open crop boundaries`;
    if (name === 'candidate') updateMetrics(lod);
    requestDraw();
  } catch (error) {
    if (revision !== pane.revision || error.name === 'AbortError') return;
    if (pane.mesh) $(`${name}Choice`).value = pane.mesh.lod.id;
    pane.loadError = `${error.message}${pane.mesh ? ' The previous surface remains available.' : ''}`;
    pane.setMessage(`${pane.loadError} Choose a surface to retry.`); showFallback();
  } finally {
    if (revision === pane.revision) {
      pane.loading = false; $(`${name}Choice`).removeAttribute('aria-busy'); syncPageStatus();
    }
  }
}
function bindCamera(canvas) {
  const pointers = new Map();
  const point = event => [event.clientX, event.clientY];
  canvas.addEventListener('pointerdown', event => { pointers.set(event.pointerId, point(event)); canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true }); });
  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    const old = [...pointers.values()]; pointers.set(event.pointerId, point(event)); const next = [...pointers.values()];
    const size = Math.max(1, canvas.getBoundingClientRect().height);
    if (next.length >= 2) {
      const distance = items => Math.hypot(items[0][0] - items[1][0], items[0][1] - items[1][1]);
      const oldDistance = distance(old), newDistance = distance(next);
      if (oldDistance > 1 && newDistance > 1) camera.span = clamp(camera.span * oldDistance / newDistance, .06, 4);
      camera.pan[0] += ((next[0][0] + next[1][0]) - (old[0][0] + old[1][0])) / 2 / size * camera.span;
      camera.pan[1] -= ((next[0][1] + next[1][1]) - (old[0][1] + old[1][1])) / 2 / size * camera.span;
    } else {
      const dx = next[0][0] - old[0][0], dy = next[0][1] - old[0][1];
      if (event.shiftKey || event.buttons === 2 || event.buttons === 4) { camera.pan[0] += dx / size * camera.span; camera.pan[1] -= dy / size * camera.span; }
      else { camera.yaw -= dx * .006; camera.pitch = clamp(camera.pitch + dy * .006, -1.52, 1.52); }
    }
    requestDraw();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => pointers.delete(event.pointerId));
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('wheel', event => { event.preventDefault(); camera.span = clamp(camera.span * Math.exp(clamp(event.deltaY, -100, 100) * .0018), .06, 4); requestDraw(); }, { passive: false });
  canvas.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') camera.yaw += .08;
    else if (event.key === 'ArrowRight') camera.yaw -= .08;
    else if (event.key === 'ArrowUp') camera.pitch = clamp(camera.pitch + .08, -1.52, 1.52);
    else if (event.key === 'ArrowDown') camera.pitch = clamp(camera.pitch - .08, -1.52, 1.52);
    else if (['+', '='].includes(event.key)) camera.span = clamp(camera.span * .88, .06, 4);
    else if (event.key === '-') camera.span = clamp(camera.span / .88, .06, 4);
    else if (event.key.toLowerCase() === 'r') resetView();
    else return;
    event.preventDefault(); requestDraw();
  });
}
function resetView() { Object.assign(camera, { yaw: .48, pitch: .28, span: 1.45, pan: [0, 0] }); requestDraw(); }
function fillProvenance() {
  const records = [
    ['Dataset', 'LADAF-2021-17 · ESRF Human Organ Atlas'],
    ['Reconstructed crop', `${manifest.roi.shapeXYZ.join(' × ')} native samples; ${manifest.roi.description}`],
    ['Native grid origin', manifest.roi.originXYZ.join(', ') + ' (X, Y, Z)'],
    ['Physical span', manifest.roi.physicalSizeMm.map(n => n.toFixed(3)).join(' × ') + ' mm, sample center to sample center'],
    ['Extraction', `Raw uint16 isovalue ${manifest.rawThreshold}; blockwise extraction with exact shared-edge identities`],
    ['Source preservation', 'Lossless compressed slices and surface-cell checkpoints; no scalar blur for the native reference'],
    ['Geometry', 'Native, smooth lighting, gentle and moderate keep identical triangle connectivity. The separate denoising experiment changes scalar samples and can change topology. No decimation is applied.'],
    ['Overview alignment', 'The separate source s4 grid uses factor-16 index scaling with zero origin. A pyramid center offset is not independently established; do not treat this as a validated subvoxel registration.'],
    ['Mesh encoding', manifest.processing.quantization],
    ['Interpretation', 'Fixed-threshold experimental surfaces retain native scan noise. Anatomical accuracy and absence of self-intersection are not certified.'],
    ['Source credit', `${manifest.attribution} · ${manifest.license}`],
  ];
  const list = document.createElement('dl');
  for (const [label, value] of records) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; list.append(dt, dd); }
  $('provenance').replaceChildren(list);
}
async function boot() {
  const response = await fetch('./assets/native-surface-v20/manifest.json');
  if (!response.ok) throw new Error(`Native study metadata could not load (${response.status}).`);
  manifest = await response.json();
  if (manifest.donorId !== 'ladaf-2021-17' || manifest.sourceSpacingUm !== 19.85 || !Array.isArray(manifest.lods) || !manifest.lods.some(lod => lod.id === 'native')) throw new Error('Native study metadata is incompatible.');
  $('regionSize').textContent = manifest.roi.physicalSizeMm.map(n => n.toFixed(2)).join(' × ') + ' mm region';
  fillProvenance();
  for (const name of ['reference', 'candidate']) {
    const select = $(`${name}Choice`); select.replaceChildren();
    for (const lod of manifest.lods) { const option = document.createElement('option'); option.value = lod.id; option.textContent = titleCaseUi(lod.label); select.append(option); }
    select.value = name === 'reference' ? (manifest.lods.some(l => l.id === 'overview') ? 'overview' : 'native') : (manifest.defaultMethod || 'normals');
    try { panes[name] = new MeshPane(name, choose); select.disabled = false; bindCamera(panes[name].canvas); }
    catch (error) { $(`${name}Message`).textContent = error.message; document.body.dataset.webgl = 'unavailable'; showFallback(); }
    select.addEventListener('change', () => choose(name, select.value));
  }
  $('resetView').addEventListener('click', resetView);
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('comparisonWorkspace').requestFullscreen(); }
    catch { $('pageStatus').textContent = 'Fullscreen is unavailable in this browser. Both views remain usable.'; }
  });
  document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen'; requestDraw(); });
  $('cutAxis').addEventListener('change', event => { cut.axis = event.target.value; $('cutPosition').disabled = $('flipSection').disabled = cut.axis === 'none'; requestDraw(); });
  $('cutPosition').addEventListener('input', event => { cut.position = Number(event.target.value) / 100; $('cutPositionText').textContent = `${event.target.value}%`; requestDraw(); });
  $('flipSection').addEventListener('click', () => { cut.flip = !cut.flip; $('flipSection').setAttribute('aria-pressed', String(cut.flip)); requestDraw(); });
  const resize = new ResizeObserver(requestDraw); for (const pane of Object.values(panes)) resize.observe(pane.canvas);
  window.addEventListener('pagehide', () => { loader.dispose(); resize.disconnect(); for (const pane of Object.values(panes)) pane.dispose(); }, { once: true });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  updateMetrics(manifest.lods.find(lod => lod.id === $('candidateChoice').value));
  for (const name of Object.keys(panes)) void choose(name, $(`${name}Choice`).value);
  if (!Object.keys(panes).length) $('pageStatus').textContent = 'Recorded comparison available · interactive WebGL is unavailable on this device.';
  requestDraw();
}
boot().catch(error => { for (const name of ['reference', 'candidate']) $(`${name}Message`).textContent = error.message; $('pageStatus').textContent = error.message; showFallback(); });
