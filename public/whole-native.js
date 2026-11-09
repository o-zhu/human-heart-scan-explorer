import { NativeEdgeLoader, nativeToWorld, selectAvailableTile, validateGuidedManifest } from './native-edge-loader.js';
import { OVERVIEW_FACE_FILTERS } from './overview-noise-filters.js';

const number = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const bytesLabel = n => n < 1e6 ? `${Math.round(n / 1000)} kB` : `${(n / 1e6).toFixed(2)} MB`;
const blockLabel = xyz => `[${xyz.join(', ')}]`;
const REGION_SPAN = 128 / 8479;
const SOURCE_AXIS_SPAN = { x: 7613 / 8479, y: 7613 / 8479, z: 1 };
const WORLD_MM = 8479 * 19.85 / 1000;
const GPU_BUDGET = 128 * 1024 * 1024;
const axes = { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const basis = camera => ({
  right: [Math.cos(camera.yaw), 0, -Math.sin(camera.yaw)],
  view: [Math.sin(camera.yaw) * Math.cos(camera.pitch), Math.sin(camera.pitch), Math.cos(camera.yaw) * Math.cos(camera.pitch)],
  up: [-Math.sin(camera.pitch) * Math.sin(camera.yaw), Math.cos(camera.pitch), -Math.sin(camera.pitch) * Math.cos(camera.yaw)],
});

const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform vec3 uMin,uMax,uCenter,uRight,uUp,uView;
uniform vec2 uPan;
uniform float uSpan,uAspect;
uniform bool uFloatPosition;
out vec3 vPosition,vNormal;
void main(){
 vec3 world=uFloatPosition?aPosition:mix(uMin,uMax,aPosition);
 vec3 p=world-uCenter;vPosition=world;vNormal=aNormal;
 gl_Position=vec4(2.0*(dot(p,uRight)+uPan.x)/(uSpan*uAspect),2.0*(dot(p,uUp)+uPan.y)/uSpan,-dot(p,uView)/3.0,1.0);
}`;
const fragment = `#version 300 es
precision highp float;
in vec3 vPosition,vNormal;
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
const pickFragment = `#version 300 es
precision highp float;
precision highp int;
in vec3 vPosition;
uniform vec3 uCutAxis;
uniform float uCutValue,uCutSign;
uniform bool uCutEnabled;
layout(location=0) out uvec4 coordinate;
void main(){
 if(uCutEnabled && uCutSign*(dot(vPosition,uCutAxis)-uCutValue)>0.0)discard;
 vec3 native=vec3(vPosition.x*8479.0+3806.5,-vPosition.z*8479.0+3806.5,vPosition.y*8479.0+4239.5);
 coordinate=uvec4(uvec3(clamp(floor(native+.5),vec3(0.0),vec3(7613.0,7613.0,8479.0))),1u);
}`;

export class SurfacePane {
  constructor(name, { document, window, onLost, onRestore }) {
    this.name = name; this.document = document; this.window = window;
    this.canvas = document.getElementById(`${name}Canvas`); this.message = document.getElementById(`${name}Message`);
    this.meshes = []; this.gpuBytes = 0; this.lost = false;
    this.camera = { yaw: .48, pitch: .28, span: name === 'overview' ? 1.16 : REGION_SPAN * 1.65, center: [0,0,0], pan: [0,0] };
    this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'high-performance' });
    if (!this.gl) throw new Error('WebGL 2 is unavailable. The coverage and processing record remain available below.');
    this.initialize();
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.lost = true; this.meshes = []; this.gpuBytes = 0;
      this.setMessage('Graphics memory was released. Waiting to restore this view…'); onLost(name);
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      try { this.initialize(); onRestore(name); }
      catch (error) { this.setMessage(error.message); }
    });
  }
  makeProgram(fragmentSource) {
    const gl = this.gl;
    const compile = (kind, source) => {
      const shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('The surface shader could not initialize.'); }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragmentSource), program = gl.createProgram();
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); throw new Error('The surface renderer could not initialize.'); }
    const uniforms = {};
    for (const key of ['Min','Max','Center','Right','Up','View','Pan','Span','Aspect','FloatPosition','CutAxis','CutValue','CutSign','CutEnabled']) uniforms[key] = gl.getUniformLocation(program, `u${key}`);
    return { program, uniforms };
  }
  initialize() { this.renderProgram = this.makeProgram(fragment); this.pickProgram = this.name === 'overview' ? this.makeProgram(pickFragment) : null; }
  setMessage(text, retained = false) { this.message.textContent = text; this.message.hidden = !text; this.message.classList.toggle('loading-retained', retained && Boolean(text)); }
  upload(decoded, record, stagedBytes = 0) {
    if (this.lost) throw new Error('Graphics context is unavailable. The region can reload when it returns.');
    if (decoded.indexCount === 0) return null;
    const allocated = decoded.vertexCount * (decoded.positionBytes + 6) + decoded.indexCount * 4;
    if (this.gpuBytes + stagedBytes + allocated > GPU_BUDGET) throw new Error('This region exceeds the graphics memory budget while retaining the current view. Select another region.');
    const float = decoded.positionFormat === 'float32';
    const bounds = record.bounds;
    if (!float && (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max) || [...bounds.min,...bounds.max].some(n => !Number.isFinite(n)))) throw new Error('The overview is missing its world-coordinate bounds.');
    const gl = this.gl, mesh = { vao: gl.createVertexArray(), buffers: [], count: decoded.indexCount, float, bounds, bytes: allocated };
    try {
      if (!mesh.vao) throw new Error('Surface graphics storage is unavailable.');
      gl.bindVertexArray(mesh.vao);
      for (const [attribute, offset, length, type, normalized] of [
        [0, decoded.positionOffset, decoded.vertexCount * decoded.positionBytes, float ? gl.FLOAT : gl.UNSIGNED_SHORT, !float],
        [1, decoded.normalOffset, decoded.vertexCount * 6, gl.SHORT, true],
      ]) {
        const buffer = gl.createBuffer(); if (!buffer) throw new Error('Surface graphics storage is unavailable.');
        mesh.buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(decoded.buffer, offset, length), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 3, type, normalized, 0, 0);
      }
      const buffer = gl.createBuffer(); if (!buffer) throw new Error('Surface index storage is unavailable.');
      mesh.buffers.push(buffer); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(decoded.buffer, decoded.indexOffset, decoded.indexCount), gl.STATIC_DRAW);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('The device could not allocate this surface. The previous view remains available.');
    } catch (error) { this.release(mesh); throw error; }
    finally { gl.bindVertexArray(null); }
    return mesh;
  }
  release(mesh) { if (!mesh) return; for (const buffer of mesh.buffers) this.gl.deleteBuffer(buffer); this.gl.deleteVertexArray(mesh.vao); }
  commit(meshes, center = null) {
    for (const old of this.meshes) this.release(old);
    this.meshes = meshes.filter(Boolean); this.gpuBytes = this.meshes.reduce((sum, mesh) => sum + mesh.bytes, 0);
    if (center) { this.camera.center = center; this.camera.pan = [0,0]; this.camera.span = REGION_SPAN * 1.65; }
    this.setMessage('');
  }
  reset() { Object.assign(this.camera, { yaw: .48, pitch: .28, span: this.name === 'overview' ? 1.16 : REGION_SPAN * 1.65, pan: [0,0] }); }
  setUniforms(program, mesh, aspect, cut) {
    const gl = this.gl, u = program.uniforms, { right, up, view } = basis(this.camera);
    gl.useProgram(program.program);
    gl.uniform3fv(u.Min, mesh.bounds?.min || [0,0,0]); gl.uniform3fv(u.Max, mesh.bounds?.max || [1,1,1]);
    gl.uniform3fv(u.Center, this.camera.center); gl.uniform3fv(u.Right, right); gl.uniform3fv(u.Up, up); gl.uniform3fv(u.View, view);
    gl.uniform2fv(u.Pan, this.camera.pan); gl.uniform1f(u.Span, this.camera.span); gl.uniform1f(u.Aspect, aspect); gl.uniform1i(u.FloatPosition, mesh.float ? 1 : 0);
    const axis = axes[cut?.axis] || [0,0,0];
    gl.uniform1i(u.CutEnabled, cut && cut.axis !== 'none' ? 1 : 0); gl.uniform3fv(u.CutAxis, axis);
    // Overview sections span the source volume, independently of either camera.
    const cutCenter = this.name === 'overview' ? 0 : dot(this.camera.center, axis);
    const cutSpan = this.name === 'overview' ? SOURCE_AXIS_SPAN[cut?.axis] ?? 0 : REGION_SPAN;
    gl.uniform1f(u.CutValue, cutCenter + ((cut?.position ?? .5) - .5) * cutSpan);
    gl.uniform1f(u.CutSign, cut?.flip ? -1 : 1);
  }
  draw(cut) {
    if (this.lost) return;
    const gl = this.gl, rect = this.canvas.getBoundingClientRect(), dpr = Math.min(this.window.devicePixelRatio || 1, 1.75);
    const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0,0,width,height); gl.clearColor(.027,.047,.060,1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    for (const mesh of this.meshes) {
      this.setUniforms(this.renderProgram, mesh, width / height, cut);
      gl.bindVertexArray(mesh.vao); gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    const desired = this.camera.span * WORLD_MM * 64 / Math.max(1, rect.height);
    const power = 10 ** Math.floor(Math.log10(desired)), distance = [1,2,5,10].find(n => n * power >= desired) * power;
    const label = this.document.getElementById(`${this.name}Scale`);
    label.textContent = distance < 1 ? `${Number((distance * 1000).toPrecision(3))} µm` : `${Number(distance.toPrecision(3))} mm`;
    label.previousElementSibling.style.width = `${distance / (this.camera.span * WORLD_MM) * rect.height}px`;
  }
  pick(clientX, clientY, cut = null) {
    if (this.lost || !this.meshes.length || !this.pickProgram) return null;
    const gl = this.gl, rect = this.canvas.getBoundingClientRect(), width = this.canvas.width, height = this.canvas.height;
    const x = clamp(Math.floor((clientX - rect.left) / rect.width * width), 0, width - 1);
    const y = clamp(Math.floor((rect.top + rect.height - clientY) / rect.height * height), 0, height - 1);
    const target = gl.createFramebuffer(), texture = gl.createTexture(), depth = gl.createRenderbuffer();
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, 1, 1, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 1, 1);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Point selection is unavailable on this device. Use the coordinate fields.');
      gl.viewport(-x,-y,width,height); gl.clearBufferuiv(gl.COLOR,0,new Uint32Array(4)); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      for (const mesh of this.meshes) {
        this.setUniforms(this.pickProgram, mesh, width / height, cut);
        gl.bindVertexArray(mesh.vao); gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT,0);
      }
      const point = new Uint32Array(4); gl.readPixels(0,0,1,1,gl.RGBA_INTEGER,gl.UNSIGNED_INT,point);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Point selection could not complete. Use the coordinate fields.');
      return point[3] ? Array.from(point.slice(0,3)) : null;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.bindVertexArray(null); gl.deleteFramebuffer(target); gl.deleteTexture(texture); gl.deleteRenderbuffer(depth);
    }
  }
  dispose() { for (const mesh of this.meshes) this.release(mesh); this.meshes = []; this.gl.deleteProgram(this.renderProgram.program); if (this.pickProgram) this.gl.deleteProgram(this.pickProgram.program); }
}

export class WholeNativeViewer {
  constructor({ document = globalThis.document, window = globalThis.window, loader = new NativeEdgeLoader(), requestFrame } = {}) {
    this.document = document; this.window = window; this.loader = loader;
    this.get = id => document.getElementById(id);
    this.requestFrame = requestFrame || (callback => window.requestAnimationFrame(callback));
    this.panes = {}; this.revision = 0; this.overviewRevision = 0; this.loading = false; this.overviewLoading = false;
    this.cut = { axis: 'none', position: .5, flip: false }; this.framesPending = false; this.disposed = false;
    this.overviewCut = { axis: 'none', position: .5, flip: false }; this.overviewChoices = new Map();
    this.cleanupView = 'cleaned'; this.displayedCleanupView = null;
    this.overviewRepair = false; this.displayedOverviewRepair = false;
    this.bindControls();
  }
  async boot() {
    this.get('retryRegion').disabled = true;
    this.get('requestError').hidden = true;
    this.get('pageStatus').textContent = 'Verifying the reconstruction index…';
    try {
      const loaded = await this.loader.loadManifest('./assets/guided-native-v21.json');
      if (this.disposed) return;
      this.manifest = validateGuidedManifest(loaded.manifest, loaded.baseUrl);
      this.configureOverview(loaded.baseUrl);
      this.fillCoverage();
      for (const name of ['overview', 'detail']) {
        if (this.panes[name]) continue;
        try {
          this.panes[name] = new SurfacePane(name, { document: this.document, window: this.window,
            onLost: pane => this.contextLost(pane), onRestore: pane => this.contextRestored(pane) });
          this.bindCamera(this.panes[name]);
        } catch (error) { this.get(`${name}Message`).textContent = error.message; }
      }
      if (this.window.ResizeObserver && !this.observer) {
        this.observer = new this.window.ResizeObserver(() => this.requestDraw());
        for (const pane of Object.values(this.panes)) this.observer.observe(pane.canvas);
      }
      for (const id of ['coordinateX','coordinateY','coordinateZ','openRegion']) this.get(id).disabled = !this.manifest.tiles.length;
      this.get('retryRegion').disabled = false;
      this.get('cleanupView').disabled = !this.panes.detail;
      this.get('overviewRepair').disabled = !this.panes.overview || ![...this.overviewChoices.values()].some(r=>r.parts.every(p=>p.faceFilter));
      // Give the small native region the first worker slot so a usable measured
      // surface appears while the larger whole-heart display is still opening.
      const initial = Array.isArray(this.manifest.defaultRegionXYZ) ? this.manifest.defaultRegionXYZ : [4544,4032,4672];
      void this.selectRegion(initial);
      this.get('overviewQuality').disabled = !this.panes.overview || !this.overviewChoices.size;
      if (this.overviewChoices.size && this.panes.overview) void this.loadOverview();
      else if (!this.overviewChoices.size) this.get('overviewMessage').textContent = 'A whole-heart overview is not included in this reconstruction record. Native regions can still be selected by coordinates.';
      this.requestDraw();
    } catch (error) {
      if (error.name === 'AbortError' || this.disposed) return;
      this.get('coverageStatus').textContent = 'Reconstruction index unavailable';
      this.get('coverageDescription').textContent = 'Coverage could not be verified.';
      this.get('requestError').textContent = `${error.message} Select Retry to reopen the index.`; this.get('requestError').hidden = false;
      this.get('pageStatus').textContent = 'The reconstruction index did not load.';
      this.get('detailMessage').textContent = 'The index is needed before a native region can be selected.';
      this.get('overviewMessage').textContent = 'The overview could not be opened.';
      this.get('retryRegion').disabled = false;
    }
  }
  releaseStage(stage, pane) {
    if (!stage || stage.released || stage.committed) return;
    stage.released = true; for (const mesh of stage.meshes) pane?.release(mesh);
    stage.meshes = [];
  }
  configureOverview(baseUrl) {
    const m = this.manifest, candidates = Array.isArray(m.overviewLods) && m.overviewLods.length >= 2
      ? m.overviewLods : m.overview ? [{ ...m.overview, id: m.overview.id || 'overview' }] : [];
    if (candidates.length > 16) throw new Error('The overview quality list is invalid.');
    this.overviewChoices.clear();
    for (const candidate of candidates) {
      if (!candidate || typeof candidate.id !== 'string' || !candidate.id.length || candidate.id.length > 80 || this.overviewChoices.has(candidate.id)) throw new Error('An overview quality is invalid or duplicated.');
      // Validate every selectable asset without traversing the native tile bank again.
      const record = validateGuidedManifest({ schema: m.schema, complete: false, sourceSpacingUm: m.sourceSpacingUm,
        dimensionsXYZ: m.dimensionsXYZ, tiles: [], overview: candidate }, baseUrl).overview;
      record.parts=record.parts.map(part=>{
        const filter=OVERVIEW_FACE_FILTERS.find(item=>item.sourceSha256===part.sha256&&item.originalTriangles===part.triangles);
        return filter?{...part,faceFilter:{...filter,mask:{...filter.mask,url:new URL(filter.mask.url,this.window.location?.href||this.loader.baseUrl||baseUrl).href}}}:part;
      });
      this.overviewChoices.set(record.id, record);
    }
    this.overviewRequestedId = this.overviewChoices.has('overview') ? 'overview'
      : this.overviewChoices.has(m.overview?.id) ? m.overview.id : this.overviewChoices.keys().next().value;
    const select = this.get('overviewQuality');
    const options = [...this.overviewChoices.values()].map(record => {
      const option = this.document.createElement('option'); option.value = record.id;
      const label = record.id === 'overview' ? 'Overview' : record.id === 'detail' ? 'Detail' : record.label || record.id;
      const count = Number.isSafeInteger(record.triangles) && record.triangles >= 0
        ? ` · ${record.triangles >= 1e6 ? `${(record.triangles / 1e6).toFixed(1)}M` : number.format(record.triangles)} triangles` : '';
      option.textContent = label + count; return option;
    });
    select.replaceChildren(...options); select.value = this.overviewRequestedId || ''; select.disabled = !options.length;
    this.get('overviewQualityControl').hidden = options.length < 2;
  }
  async loadOverview(id = this.overviewRequestedId) {
    const pane = this.panes.overview, record = this.overviewChoices.get(id);
    if (!pane || !record || pane.lost) return;
    const revision = ++this.overviewRevision, stage = { meshes: [], bytes: 0 }, parts = record.parts || [record];
    const overviewRepair=this.overviewRepair&&parts.every(part=>part.faceFilter);
    this.releaseStage(this.overviewStage,pane); this.overviewStage = stage; this.overviewLoading = true; this.overviewError = null;
    this.overviewRequestedId = id; this.overviewRetryId = null;
    this.get('overviewQuality').value = id; this.get('overviewQuality').setAttribute('aria-busy','true');
    const qualityLabel = record.label || (id === 'detail' ? 'Whole-heart display detail' : 'Whole-heart overview');
    pane.setMessage(`Opening ${qualityLabel.toLowerCase()} · ${bytesLabel(parts.reduce((sum, part) => sum + (part.compressedBytes ?? part.bytes), 0))}…`, pane.meshes.length > 0);
    try {
      const result = await this.loader.loadOverview({...record,overviewRepair}, { onPiece: (decoded,index,total) => {
        if (revision !== this.overviewRevision || pane.lost) throw new DOMException('Overview changed.', 'AbortError');
        if (index !== stage.meshes.length || total !== parts.length) throw new Error('Overview parts arrived out of order.');
        const mesh = pane.upload(decoded, parts[index], stage.bytes); stage.meshes.push(mesh); stage.bytes += mesh?.bytes || 0;
        pane.setMessage(`Preparing the whole-heart overview · ${index + 1}/${total} parts`, pane.meshes.length > 0);
      } });
      if (revision !== this.overviewRevision || pane.lost || this.disposed) return;
      if (stage.meshes.length !== parts.length || result.pieces !== parts.length) throw new Error('The whole-heart overview is incomplete.');
      pane.commit(stage.meshes); stage.committed = true;
      this.displayedOverview = record; this.get('overviewQuality').value = id;
      this.displayedOverviewRepair=overviewRepair;this.get('overviewRepair').checked=overviewRepair;
      this.get('overviewLabel').textContent = record.label || 'Whole-heart context';
      this.get('overviewDetail').textContent = `${number.format(overviewRepair?result.triangles:record.triangles??result.triangles)} overview triangles · ${overviewRepair?'overlap repair':'original display'} · click tissue to choose a region`;
      this.get('overviewModeLabel').textContent=overviewRepair?'Overlap repair':'Original reference';
      this.get('overviewCleanupStatus').textContent=overviewRepair
        ? `${number.format(result.removedTriangles??0)} exactly overlapping display triangles removed. Original positions and stored normals are unchanged. This is an experimental display repair; thin structures already collapsed by simplification are not recovered.`
        : 'Showing the original whole-heart display. Experimental overlap repair is available for the two verified overview quality levels.';
      this.requestDraw();
    } catch (error) {
      if (revision !== this.overviewRevision || error.name === 'AbortError') return;
      pane.setMessage(`${error.message} Coordinate selection remains available.`, pane.meshes.length > 0);
      this.overviewError = error.message; this.overviewRetryId = id;
      if (this.displayedOverview) { this.overviewRequestedId = this.displayedOverview.id; this.get('overviewQuality').value = this.displayedOverview.id; }
      this.overviewRepair=this.displayedOverviewRepair;this.get('overviewRepair').checked=this.displayedOverviewRepair;
    } finally {
      this.releaseStage(stage,pane);
      if (revision === this.overviewRevision) { this.overviewLoading = false; this.get('overviewQuality').removeAttribute('aria-busy'); this.syncStatus(); this.requestDraw(); }
    }
  }
  async selectRegion(xyz, force = false) {
    if (!this.manifest || this.disposed) return;
    let choice;
    try { choice = selectAvailableTile(this.manifest.tiles, xyz); }
    catch (error) { this.get('requestError').textContent = error.message; this.get('requestError').hidden = false; return; }
    const pane = this.panes.detail, revision = ++this.revision, record = choice.tile;
    this.loader.cancel('detail'); this.releaseStage(this.detailStage,pane); this.detailStage = null;
    this.requested = choice; this.targetTile = record; this.loading = false; this.lastError = null;
    this.get('regionForm').removeAttribute('aria-busy');
    for (const [axis,id] of ['coordinateX','coordinateY','coordinateZ'].entries()) this.get(id).value = String(Math.round(xyz[axis]));
    this.get('requestError').hidden = true;
    this.get('detailHeading').textContent = `Block ${blockLabel(record.xyz)}`;
    this.get('selectionStatus').textContent = choice.exact
      ? `Exact available block ${blockLabel(record.xyz)} · requested native point ${blockLabel(xyz.map(Math.round))}.`
      : `Nearest available block ${blockLabel(record.xyz)} · requested block ${blockLabel(choice.requestedBlock)} is unavailable. The selected block center is ${choice.distanceMm.toFixed(3)} mm from the requested point.`;
    this.get('retryRegion').disabled = false;
    this.requestDraw();
    if (!pane) { this.setProgress(0,'Graphics unavailable'); this.get('pageStatus').textContent = 'The selected region is identified above; WebGL 2 is required to display its surface.'; return; }
    const cleanupView=this.cleanupView;
    if (!force && this.displayedTile?.key === record.key && this.displayedCleanupView===cleanupView && pane.meshes.length && !pane.lost) {
      pane.setMessage(''); this.setProgress(8,'Region ready'); this.syncStatus(); return;
    }
    if (pane.lost) { pane.setMessage('The region will load when graphics memory is restored.'); return; }
    const stage = { meshes: [], bytes: 0, triangles: 0 }; this.detailStage = stage; this.loading = true;
    this.get('regionForm').setAttribute('aria-busy','true');
    this.setProgress(0, 'Waiting for decoder');
    pane.setMessage(`Opening block ${blockLabel(record.xyz)}…${this.displayedTile ? ` Showing ${blockLabel(this.displayedTile.xyz)} until ready.` : ''}`, pane.meshes.length > 0);
    this.syncStatus(); this.requestDraw();
    try {
      const result = await this.loader.loadTile({...record,cleanupView}, {
        onProgress: event => {
          if (revision !== this.revision) return;
          if (event.stage === 'download') this.setProgress(0, `Downloading ${Math.round(event.loaded / Math.max(1,event.total) * 100)}%`);
          else if (event.stage === 'cached') this.setProgress(0, 'Using verified cached region');
          else if (event.stage === 'decode') this.setProgress(0, 'Verifying and decoding');
          else if (event.stage === 'cleanup') this.setProgress(0, 'Checking detached tissue fragments');
          else if (event.stage === 'mesh') this.setProgress(event.loaded, `Preparing region ${event.loaded + 1}/8`);
        },
        onPiece: (decoded,index,total) => {
          if (revision !== this.revision || pane.lost || stage.released) throw new DOMException('Region changed.', 'AbortError');
          if (index !== stage.meshes.length || total !== 8) throw new Error('Native region pieces arrived out of order.');
          const mesh = pane.upload(decoded,record,stage.bytes); stage.meshes.push(mesh); stage.bytes += mesh?.bytes || 0; stage.triangles += decoded.indexCount / 3;
          this.setProgress(index + 1, `Prepared ${index + 1}/8`);
        },
      });
      if (revision !== this.revision || pane.lost || this.disposed) return;
      if (stage.meshes.length !== 8 || result.pieces !== 8 || stage.triangles !== result.triangles) throw new Error('The selected native region is incomplete.');
      const sameRegion=this.displayedTile?.key===record.key;
      pane.commit(stage.meshes, sameRegion?null:nativeToWorld(record.xyz.map(n => n * 128 + 64)));
      stage.committed = true; this.displayedTile = record; this.displayedCleanupView=cleanupView;
      this.get('detailLabel').textContent = `Displayed block ${blockLabel(record.xyz)}`;
      this.get('detailDetail').textContent = `Native XYZ ${record.xyz.map(n => `${n * 128}–${n * 128 + 128}`).join(' · ')} · ${number.format(result.triangles)} triangles · open crop boundaries`;
      this.get('detailRegionLabel').textContent = `2.5408 MM REGION · BLOCK ${record.xyz.join(' / ')}`;
      this.get('triangleMetric').textContent = number.format(result.triangles);
      this.get('triangleNote').textContent = `Displayed block ${blockLabel(record.xyz)}`;
      this.get('downloadMetric').textContent = bytesLabel(record.bytes);
      const cleanup=result.cleanup;
      const modeLabel=cleanupView==='original'?'Original reconstruction':cleanupView==='removed'?'Removed fragments only':'Cleaned surface';
      this.get('detailCleanupLabel').textContent=modeLabel+' · compare';
      this.get('cleanupView').value=cleanupView;
      this.get('cleanupStatus').textContent=cleanupView==='original'
        ? 'Showing the original denoised reconstruction. Cleanup does not change the archived surface.'
        : `${number.format(cleanup?.removedComponents??0)} compact, detached fragments ${cleanupView==='removed'?'shown':'hidden'} · ${number.format(result.suppressedTriangles??0)} original triangles. Retained surfaces keep their original positions; elongated or flat fragments and every component touching the block boundary are protected.`;
      if (!result.triangles) pane.setMessage(cleanupView==='removed'?'No fragments meet the cleanup criteria in this region.':cleanup?.removedComponents?'Only removable fragments were present in this region. Choose Original reconstruction to inspect them.':'No thresholded surface crosses this block.');
      this.setProgress(8,'Region ready'); this.requestDraw();
    } catch (error) {
      if (revision !== this.revision || error.name === 'AbortError') return;
      const previous = this.displayedTile && pane.meshes.length ? ` Still displaying block ${blockLabel(this.displayedTile.xyz)}.` : '';
      this.lastError = `${error.message}${previous}`;
      this.get('requestError').textContent = this.lastError; this.get('requestError').hidden = false;
      pane.setMessage(`Selected block ${blockLabel(record.xyz)} could not load.${previous}`, pane.meshes.length > 0);
      if(this.displayedCleanupView) {this.cleanupView=this.displayedCleanupView;this.get('cleanupView').value=this.displayedCleanupView;}
      this.setProgress(0,'Region did not load');
    } finally {
      this.releaseStage(stage,pane);
      if (revision === this.revision) { this.loading = false; this.get('regionForm').removeAttribute('aria-busy'); this.syncStatus(); this.requestDraw(); }
    }
  }
  setProgress(value,text) { this.get('regionProgress').value = value; this.get('regionProgressText').textContent = text; }
  syncStatus() {
    this.get('pageStatus').textContent = this.loading ? 'Opening the selected native region. The previous view remains usable.'
      : this.lastError ? this.lastError : this.overviewLoading ? 'Native region ready; the coarser overview is opening.'
        : this.displayedTile ? `Native region ${blockLabel(this.displayedTile.xyz)} ready · cameras move independently · denoised, coarse-guided surface`
          : 'Choose an available native region to inspect.';
  }
  fillCoverage() {
    const m = this.manifest, c = m.coverage, completeCounts = Number.isSafeInteger(c.completedBlocks) && Number.isSafeInteger(c.plannedBlocks);
    const pilot = m.completeScope === 'pilot-only', whole = m.completeScope === 'whole-plan';
    this.get('coverageDot').classList.toggle('complete',m.complete && !pilot);
    this.get('coverageStatus').textContent = pilot ? 'Pilot regions only · partial organ coverage'
      : m.complete ? whole ? 'Planned whole-heart boundary reconstruction complete' : 'Planned boundary reconstruction complete' : 'Reconstruction is incomplete';
    this.get('coverageDescription').textContent = `${completeCounts ? `${number.format(c.completedBlocks)} of ${number.format(c.plannedBlocks)} planned blocks processed · ` : ''}${number.format(m.tiles.length)} available surface blocks. Coverage follows the coarse guide.`;
    this.get('coverageMetric').textContent = completeCounts ? `${number.format(c.completedBlocks)} / ${number.format(c.plannedBlocks)}` : 'Not reported';
    this.get('coverageNote').textContent = pilot ? 'Pilot scope · incomplete whole-heart coverage' : m.complete ? 'Planned boundary region processed' : 'Partial coverage; only available blocks can load';
    const counts = [c.nativeOnlyEdgeVertices,c.blendedEdgeVertices,c.priorOnlyEdgeVertices], total = counts.reduce((sum,n) => sum + (n || 0),0);
    if (counts.every(Number.isSafeInteger) && total > 0) {
      this.get('nativeMetric').textContent = `${(counts[0] / total * 100).toFixed(1)}% native`;
      this.get('nativeNote').textContent = `${(counts[1] / total * 100).toFixed(1)}% blended · ${(counts[2] / total * 100).toFixed(1)}% prior-only stored crossings`;
    } else { this.get('nativeMetric').textContent = 'Not reported'; this.get('nativeNote').textContent = 'Surface provenance counts are unavailable'; }
    const p = m.processing || {};
    const records = [
      ['Source','LADAF-2021-17 · ESRF Human Organ Atlas'],
      ['Original grid','7,614 × 7,614 × 8,480 samples; acquisition axes X, Y, Z'],
      ['Source spacing','19.85 µm; each inspected region spans 2.5408 mm'],
      ['Processing state',pilot ? 'Pilot-only coverage; this is not a completed whole-heart bank' : m.complete ? 'Complete for the planned coarse-guided boundary region' : 'Incomplete; available blocks only'],
      ['Native processing',`Total variation weight ${p.tvWeightRaw ?? 800}, ${p.tvIterations ?? 16} fixed iterations; lossy intensity filtering`],
      ['Guide','Existing coarse field with native detail near its boundaries; features outside the guide band may be absent'],
      ['Surface threshold',String(p.thresholdRaw ?? 17133.4) + ' original intensity units'],
      ['Stored crossing provenance',counts.every(Number.isSafeInteger) ? `${number.format(counts[0])} native-only; ${number.format(counts[1])} blended; ${number.format(counts[2])} prior-only` : 'Not reported in this record'],
      ['Display','The overview uses a coarser display mesh. Native regions are separate views with uncapped crop boundaries.'],
      ['Native cleanup','Reversible suppression of compact, detached foreground components: at most 512 samples, inclusive support-box diagonal at most 0.4 mm, 26-neighbor connectivity. Components touching a tile boundary or with principal shape anisotropy at least 3 are retained. Source signs, edge positions and the original archive are unchanged.'],
      ['Cleanup limits','This is candidate suppression, not validated tissue segmentation. Attached clutter remains. The whole-heart overview has a separate optional repair for exactly coincident display faces; neither method restores missing anatomy.'],
      ['Limits','Denoising and guide blending can remove or alter small structures. Sampling and encoding precision do not establish anatomical accuracy.'],
    ];
    const list = this.document.createElement('dl');
    for (const [label,value] of records) { const dt=this.document.createElement('dt'),dd=this.document.createElement('dd'); dt.textContent=label;dd.textContent=value;list.append(dt,dd); }
    this.get('provenance').replaceChildren(list);
    if (m.evidenceUrl) {
      try { const url = new URL(m.evidenceUrl,this.window.location.href); if (['http:','https:'].includes(url.protocol)) { this.get('externalEvidence').href = url.href; this.get('externalEvidence').textContent = 'Measured denoising report ↗'; } } catch { /* Retain the primary method link. */ }
    }
  }
  requestDraw() {
    if (this.framesPending || this.disposed) return;
    this.framesPending = true;
    this.requestFrame(() => {
      this.framesPending = false; if (this.disposed) return;
      for (const [name,pane] of Object.entries(this.panes)) pane.draw(name === 'detail' ? this.cut : this.overviewCut);
      this.drawMarker();
    });
  }
  drawMarker() {
    const pane = this.panes.overview, svg = this.get('overviewMarker'), tile = this.targetTile;
    if (!pane || !tile || pane.lost) { svg.style.display='none';return; }
    svg.style.display=''; svg.dataset.pending = String(this.loading || this.displayedTile?.key !== tile.key);
    const { width,height } = pane.canvas.getBoundingClientRect(), { right,up }=basis(pane.camera);
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const project = xyz => {
      const w=nativeToWorld(xyz).map((n,i)=>n-pane.camera.center[i]);
      return [(dot(w,right)+pane.camera.pan[0])/pane.camera.span*height+width/2, height/2-(dot(w,up)+pane.camera.pan[1])/pane.camera.span*height];
    };
    const points=[];for(const z of [0,128])for(const y of [0,128])for(const x of [0,128])points.push(project([tile.xyz[0]*128+x,tile.xyz[1]*128+y,tile.xyz[2]*128+z]));
    const edges=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
    if (!this.markerLines) {
      this.markerLines=edges.map(()=>this.document.createElementNS('http://www.w3.org/2000/svg','line'));
      this.get('markerBox').replaceChildren(...this.markerLines);
    }
    edges.forEach(([a,b],i)=>{for(const [name,value] of [['x1',points[a][0]],['y1',points[a][1]],['x2',points[b][0]],['y2',points[b][1]]])this.markerLines[i].setAttribute(name,String(value));});
    const center=project(tile.xyz.map(n=>n*128+64)),circle=this.get('markerCenter'),text=this.get('markerText');
    circle.setAttribute('cx',String(center[0]));circle.setAttribute('cy',String(center[1]));
    text.setAttribute('x',String(clamp(center[0]+10,10,width-150)));text.setAttribute('y',String(clamp(center[1]-10,20,height-10)));
    text.textContent=this.loading?'Opening region':this.displayedTile?.key===tile.key?'Displayed region':'Requested region';
  }
  contextLost(name) {
    this.loader.cancel(name === 'detail' ? 'detail' : 'overview');
    if (name === 'detail') {
      this.revision++; this.loading=false; this.releaseStage(this.detailStage,this.panes.detail);this.get('regionForm').removeAttribute('aria-busy');this.setProgress(0,'Restoring graphics');
      if (this.displayedTile) { this.get('detailLabel').textContent=`Previously displayed block ${blockLabel(this.displayedTile.xyz)}`;this.get('triangleNote').textContent='Previous region · graphics temporarily unavailable'; }
    }
    else { this.overviewRevision++;this.overviewLoading=false;this.get('overviewQuality').removeAttribute('aria-busy');this.releaseStage(this.overviewStage,this.panes.overview); }
    this.get('pageStatus').textContent=`The ${name} graphics context was released. The other view remains available.`;
    this.requestDraw();
  }
  contextRestored(name) {
    if (name === 'overview') void this.loadOverview();
    else if (this.requested) void this.selectRegion(this.requested.requestedXYZ,true);
    this.requestDraw();
  }
  bindCamera(pane) {
    const canvas=pane.canvas,camera=pane.camera,pointers=new Map();
    canvas.addEventListener('pointerdown',event=>{pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false});canvas.setPointerCapture(event.pointerId);canvas.focus({preventScroll:true});});
    canvas.addEventListener('pointermove',event=>{
      const point=pointers.get(event.pointerId);if(!point)return;
      const old=[...pointers.values()].map(p=>({...p}));point.x=event.clientX;point.y=event.clientY;
      if(Math.hypot(point.x-point.startX,point.y-point.startY)>4)point.moved=true;
      const next=[...pointers.values()],size=Math.max(1,canvas.getBoundingClientRect().height);
      if(next.length>=2){
        for(const p of next)p.moved=true;
        const distance=items=>Math.hypot(items[0].x-items[1].x,items[0].y-items[1].y);
        if(distance(old)>1&&distance(next)>1)camera.span=clamp(camera.span*distance(old)/distance(next),pane.name==='overview'?.08:REGION_SPAN*.12,pane.name==='overview'?3:REGION_SPAN*6);
        camera.pan[0]+=((next[0].x+next[1].x)-(old[0].x+old[1].x))/2/size*camera.span;
        camera.pan[1]-=((next[0].y+next[1].y)-(old[0].y+old[1].y))/2/size*camera.span;
      }else{
        const dx=next[0].x-old[0].x,dy=next[0].y-old[0].y;
        if(event.shiftKey||event.buttons===2||event.buttons===4){camera.pan[0]+=dx/size*camera.span;camera.pan[1]-=dy/size*camera.span;}
        else{camera.yaw-=dx*.006;camera.pitch=clamp(camera.pitch+dy*.006,-1.52,1.52);}
      }
      this.requestDraw();
    });
    canvas.addEventListener('pointerup',event=>{
      const point=pointers.get(event.pointerId),tap=point&&!point.moved&&pointers.size===1&&(event.button===0||event.button===undefined);pointers.delete(event.pointerId);
      if(tap&&pane.name==='overview'){
        try{const xyz=pane.pick(event.clientX,event.clientY,this.overviewCut);if(xyz)void this.selectRegion(xyz);else this.get('selectionStatus').textContent='Select visible tissue in the overview, or enter native coordinates below.';}
        catch(error){this.get('selectionStatus').textContent=error.message;}
        this.requestDraw();
      }
    });
    for(const type of ['pointercancel','lostpointercapture'])canvas.addEventListener(type,event=>pointers.delete(event.pointerId));
    canvas.addEventListener('contextmenu',event=>event.preventDefault());
    const zoom=factor=>{camera.span=clamp(camera.span*factor,pane.name==='overview'?.08:REGION_SPAN*.12,pane.name==='overview'?3:REGION_SPAN*6);};
    canvas.addEventListener('wheel',event=>{event.preventDefault();zoom(Math.exp(clamp(event.deltaY,-100,100)*.0018));this.requestDraw();},{passive:false});
    canvas.addEventListener('keydown',event=>{
      if(event.key==='ArrowLeft')camera.yaw+=.08;else if(event.key==='ArrowRight')camera.yaw-=.08;
      else if(event.key==='ArrowUp')camera.pitch=clamp(camera.pitch+.08,-1.52,1.52);else if(event.key==='ArrowDown')camera.pitch=clamp(camera.pitch-.08,-1.52,1.52);
      else if(['+','='].includes(event.key))zoom(.88);else if(event.key==='-')zoom(1/.88);else if(event.key.toLowerCase()==='r')pane.reset();else return;
      event.preventDefault();this.requestDraw();
    });
  }
  bindControls() {
    this.get('regionForm').addEventListener('submit',event=>{event.preventDefault();const xyz=['coordinateX','coordinateY','coordinateZ'].map(id=>Number(this.get(id).value));if(xyz.some(n=>!Number.isInteger(n))){this.get('requestError').textContent='Use whole native sample coordinates.';this.get('requestError').hidden=false;return;}void this.selectRegion(xyz);});
    this.get('retryRegion').addEventListener('click',()=>{if(this.manifest){if(this.requested)void this.selectRegion(this.requested.requestedXYZ,true);if(this.overviewError)void this.loadOverview(this.overviewRetryId || this.overviewRequestedId);}else void this.boot();});
    this.get('resetViews').addEventListener('click',()=>{for(const pane of Object.values(this.panes))pane.reset();this.requestDraw();});
    this.get('overviewQuality').addEventListener('change',()=>{void this.loadOverview(this.get('overviewQuality').value);});
    this.get('cleanupView').addEventListener('change',()=>{
      const mode=this.get('cleanupView').value;
      if(!['cleaned','original','removed'].includes(mode))return;
      this.cleanupView=mode;
      if(this.requested)void this.selectRegion(this.requested.requestedXYZ,true);
    });
    this.get('detailCleanupLabel').addEventListener('click',()=>{this.get('cleanupSettings').open=true;});
    this.get('overviewRepair').addEventListener('change',()=>{this.overviewRepair=this.get('overviewRepair').checked;void this.loadOverview();});
    this.get('overviewCutAxis').addEventListener('change',()=>{this.overviewCut.axis=this.get('overviewCutAxis').value;const disabled=this.overviewCut.axis==='none';this.get('overviewCutPosition').disabled=disabled;this.get('overviewFlipSection').disabled=disabled;this.requestDraw();});
    this.get('overviewCutPosition').addEventListener('input',()=>{this.overviewCut.position=clamp(Number(this.get('overviewCutPosition').value)/100,0,1);this.get('overviewCutPositionText').textContent=`${Math.round(this.overviewCut.position*100)}%`;this.requestDraw();});
    this.get('overviewFlipSection').addEventListener('click',()=>{this.overviewCut.flip=!this.overviewCut.flip;this.get('overviewFlipSection').setAttribute('aria-pressed',String(this.overviewCut.flip));this.requestDraw();});
    this.get('cutAxis').addEventListener('change',()=>{this.cut.axis=this.get('cutAxis').value;const disabled=this.cut.axis==='none';this.get('cutPosition').disabled=disabled;this.get('flipSection').disabled=disabled;this.requestDraw();});
    this.get('cutPosition').addEventListener('input',()=>{this.cut.position=Number(this.get('cutPosition').value)/100;this.get('cutPositionText').textContent=`${Math.round(this.cut.position*100)}%`;this.requestDraw();});
    this.get('flipSection').addEventListener('click',()=>{this.cut.flip=!this.cut.flip;this.get('flipSection').setAttribute('aria-pressed',String(this.cut.flip));this.requestDraw();});
    this.get('fullscreen').addEventListener('click',async()=>{try{if(this.document.fullscreenElement)await this.document.exitFullscreen();else await this.get('nativeWorkspace').requestFullscreen();}catch{this.get('pageStatus').textContent='Fullscreen is unavailable. Both views remain usable.';}});
    this.document.addEventListener('fullscreenchange',()=>{this.get('fullscreen').textContent=this.document.fullscreenElement?'Exit Fullscreen':'Fullscreen';this.requestDraw();});
    this.window.addEventListener('pagehide',()=>this.dispose(),{once:true});
    this.window.addEventListener('pageshow',event=>{if(event.persisted&&this.disposed)this.window.location.reload();});
  }
  dispose() { if(this.disposed)return;this.disposed=true;this.loader.dispose();this.observer?.disconnect();this.releaseStage(this.detailStage,this.panes.detail);this.releaseStage(this.overviewStage,this.panes.overview);for(const pane of Object.values(this.panes))pane.dispose(); }
}

if (typeof document !== 'undefined' && document.getElementById('wholeNativeViewer')) {
  const viewer = new WholeNativeViewer();
  void viewer.boot();
}
