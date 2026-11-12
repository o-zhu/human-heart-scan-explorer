import { MeasurementSurfacePicker } from './measurement-picking.js';
import { measurementGeometry, measurementDistanceMm, projectMeasurementPoint, validMeasurementPoint } from './measurement-geometry.js';

const modified = event => event.shiftKey || event.ctrlKey || event.altKey || event.metaKey;
const SVG = 'http://www.w3.org/2000/svg';

/** One straight-line annotation, anchored in source space, never in pixels. */
export class MeasurementControls {
  constructor({ renderer, viewport, button, meta, sourceKey, picker, onStart = () => {}, onChange = () => {} }) {
    this.renderer = renderer; this.viewport = viewport; this.button = button;
    this.canvas = renderer.canvas; this.doc = this.canvas.ownerDocument; this.view = this.doc.defaultView;
    this.picker = picker || new MeasurementSurfacePicker(renderer);
    this.onStart = onStart; this.onChange = onChange;
    this.points = []; this.placing = false; this.active = true; this.epoch = 0;
    this.pointers = new Set(); this.listeners = []; this.pending = null; this.busy = false;
    this.sourceKey = sourceKey || renderer.donorId || ''; this.geometry = measurementGeometry(meta);
    renderer.measurementSourceKey = this.sourceKey;
    renderer.measurementController = this;
    this.createOverlay();
    this.listen(button, 'click', () => this.points.length === 2 ? this.clear() : this.placing ? this.cancelPlacement() : this.start());
    this.listen(this.cancelButton, 'click', () => { this.cancelPlacement(); this.button.focus?.({ preventScroll: true }); });
    this.listen(this.canvas, 'pointerdown', event => this.pointerDown(event), true);
    this.listen(this.canvas, 'pointermove', event => this.pointerMove(event), true);
    this.listen(this.canvas, 'pointerup', event => this.pointerUp(event), true);
    this.listen(this.canvas, 'dblclick', event => {
      if (this.placing || this.commitPending) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    for (const type of ['pointercancel', 'lostpointercapture']) this.listen(this.canvas, type, event => {
      this.pointers.delete(event.pointerId); if (this.down?.id === event.pointerId) this.down = null;
    }, true);
    this.listen(this.canvas, 'pointerleave', () => { if (!this.down && !this.commitPending) { this.lastPointer = null; this.invalidatePreview(); } });
    this.listen(this.canvas, 'wheel', () => this.invalidatePreview(), { passive: true });
    this.listen(this.doc, 'pointerdown', event => {
      if (this.down && event.pointerId !== this.down.id) { this.down.moved = true; this.lastPointer = null; this.invalidatePreview(); }
    }, true);
    this.listen(this.doc, 'keydown', event => {
      if (event.key === 'Escape' && this.placing) { event.preventDefault(); this.cancelPlacement(); this.button.focus?.({ preventScroll: true }); }
    });
    this.listen(this.view, 'blur', () => this.suspendInput());
    this.listen(this.view, 'pagehide', () => this.suspendInput());
    this.listen(this.doc, 'visibilitychange', () => { if (this.doc.hidden) this.suspendInput(); else this.draw(); });
    this.listen(this.doc, 'pointerlockchange', () => { if (this.doc.pointerLockElement) this.cancelPlacement(); });
    this.listen(this.canvas, 'webglcontextlost', () => { this.contextLost = true; this.clear(); this.sync(); });
    this.previousFrameListener = renderer.onMeasurementFrame;
    this.frameListener = frame => {
      this.previousFrameListener?.(frame); this.preview = null; this.sync(); this.draw();
      if (this.placing && this.lastPointer && !this.down && !this.commitPending) this.queuePick(this.lastPointer);
    };
    renderer.onMeasurementFrame = this.frameListener;
    this.resize = this.view.ResizeObserver ? new this.view.ResizeObserver(() => { this.invalidatePreview(); this.draw(); }) : null;
    this.resize?.observe(this.canvas);
    this.sync();
  }

  listen(node, type, fn, options) { node?.addEventListener(type, fn, options); this.listeners.push(() => node?.removeEventListener(type, fn, options)); }

  createOverlay() {
    const make = (tag, className) => { const node = this.doc.createElement(tag); node.className = className; return node; };
    this.overlay = make('div', 'measurement-overlay'); this.overlay.hidden = true; this.overlay.setAttribute('aria-hidden', 'true');
    this.svg = this.doc.createElementNS(SVG, 'svg'); this.svg.setAttribute('aria-hidden', 'true');
    const shape = (tag, className) => { const node = this.doc.createElementNS(SVG, tag); node.setAttribute('class', className); this.svg.append(node); return node; };
    this.lineBack = shape('line', 'measurement-line-back'); this.line = shape('line', 'measurement-line');
    this.dotA = shape('circle', 'measurement-point'); this.dotB = shape('circle', 'measurement-point'); this.hoverDot = shape('circle', 'measurement-preview');
    this.label = make('span', 'measurement-value');
    this.overlay.append(this.svg, this.label);
    this.prompt = make('div', 'measurement-prompt'); this.prompt.hidden = true;
    this.promptText = make('span', 'measurement-prompt-text');
    this.cancelButton = make('button', 'measurement-cancel'); this.cancelButton.type = 'button'; this.cancelButton.textContent = 'Cancel';
    this.prompt.append(this.promptText, this.cancelButton);
    this.announcement = make('span', 'screen-reader-only'); this.announcement.setAttribute('role', 'status'); this.announcement.setAttribute('aria-live', 'polite');
    this.viewport.append(this.overlay, this.prompt, this.announcement);
  }

  available() { return this.active && !this.contextLost && this.renderer.loaded && this.geometry && this.renderer.settings.mode === 0 && !this.renderer.settings.showPlanes; }

  setSource(meta, sourceKey = this.sourceKey) {
    const geometry = measurementGeometry(meta);
    const changed = this.sourceKey !== sourceKey || (this.geometry && (!geometry || geometry.sizeMm.some((n, i) => Math.abs(n - this.geometry.sizeMm[i]) > 1e-5)));
    if (changed) this.clear();
    this.sourceKey = sourceKey; this.geometry = geometry; this.renderer.measurementSourceKey = sourceKey;
    this.invalidatePreview(); this.sync(); this.draw();
  }

  setWorkspaceActive(value) {
    this.active = !!value;
    if (!this.active) this.cancelPlacement();
    this.sync(); this.draw();
  }

  start() {
    if (!this.available() || this.disposed) return false;
    this.onStart(); this.clear(); this.placing = true; this.renderer.measurementPlacing = true;
    this.renderer.autoRotate = false; this.renderer.requestRender?.('camera');
    this.promptText.textContent = 'Choose the first point · Drag to rotate';
    this.announcement.textContent = 'Measurement started. Click two points on the visible surface. Drag to rotate. Escape cancels.';
    this.canvas.focus?.({ preventScroll: true }); this.sync(); this.onChange(); return true;
  }

  invalidatePreview() {
    this.epoch++; this.preview = null; this.pending = null;
    this.abort?.abort(); this.picker.cancel?.();
    this.commitPending = false;
    if (this.timer) this.view.clearTimeout(this.timer); this.timer = null;
    this.draw();
  }

  suspendInput() { this.down = null; this.pointers.clear(); this.lastPointer = null; this.invalidatePreview(); }

  cancelPlacement() { if (this.placing) this.clear(); else this.suspendInput(); }

  clear() {
    this.placing = false; this.renderer.measurementPlacing = false; this.points = []; this.lastPointer = null;
    this.down = null; this.pointers.clear(); this.invalidatePreview(); this.sync(); this.draw();
    this.announcement.textContent = ''; this.onChange();
  }

  sync() {
    if (this.disposed) return;
    if (this.placing && !this.available()) { this.clear(); return; }
    const complete = this.points.length === 2;
    this.button.dataset.measureState = complete ? 'complete' : this.placing ? 'placing' : 'ready';
    const label = this.button.querySelector('[data-measure-label]');
    const text = complete ? 'Clear Measurements' : this.placing ? 'Cancel Measurement' : 'Measure';
    if (label) label.textContent = text; else this.button.textContent = text;
    this.button.setAttribute('aria-pressed', String(this.placing));
    this.button.disabled = !complete && !this.available();
    this.button.title = complete ? 'Remove the measured line' : this.renderer.settings.mode !== 0 ? 'Use Whole Organ or Cutaway to measure a visible surface' : this.renderer.settings.showPlanes ? 'Hide section plane guides to measure the visible surface' : 'Measure the straight-line distance between two surface points';
    const mount = this.button.closest('[data-measure-controls]'); if (mount) mount.hidden = !this.active;
    this.viewport.classList.toggle('is-measuring', this.placing && this.active);
    this.prompt.hidden = !this.placing || !this.active;
  }

  pointerCoordinates(event) {
    const rect = this.canvas.getBoundingClientRect();
    const u = (event.clientX - rect.left) / rect.width, v = (event.clientY - rect.top) / rect.height;
    return rect.width > 0 && rect.height > 0 && Number.isFinite(u + v) && u >= 0 && v >= 0 && u <= 1 && v <= 1 ? { u, v, pointerType: event.pointerType } : null;
  }

  track(event) {
    if (this.down?.id !== event.pointerId) return;
    for (const p of [...(event.getCoalescedEvents?.() || []), event]) {
      this.down.distance += Math.hypot(p.clientX - this.down.x, p.clientY - this.down.y);
      this.down.x = p.clientX; this.down.y = p.clientY;
      if (!Number.isFinite(this.down.distance) || this.down.distance > 5) this.down.moved = true;
    }
  }

  pointerDown(event) {
    if (!this.placing) return;
    const repeated = this.pointers.has(event.pointerId); this.pointers.add(event.pointerId);
    if (this.commitPending) { this.down = null; this.lastPointer = null; return; }
    this.invalidatePreview();
    if (repeated || this.pointers.size !== 1 || event.button !== 0 || event.isPrimary === false || modified(event) || event.defaultPrevented || this.doc.pointerLockElement) { this.down = null; return; }
    this.down = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, moved: false };
  }

  pointerMove(event) {
    if (!this.placing) return;
    this.track(event);
    if (this.down) { if (modified(event) || event.buttons !== 1) this.down.moved = true; return; }
    if (event.buttons || this.pointers.size || event.isPrimary === false) return;
    this.lastPointer = this.pointerCoordinates(event);
    if (this.lastPointer) this.queuePick(this.lastPointer);
  }

  pointerUp(event) {
    if (!this.placing) return;
    this.track(event); const down = this.down?.id === event.pointerId ? this.down : null;
    if (down) this.down = null; this.pointers.delete(event.pointerId);
    const point = this.pointerCoordinates(event);
    if (down && !down.moved && !this.pointers.size && event.button === 0 && event.isPrimary !== false && !modified(event) && !event.defaultPrevented && !this.doc.pointerLockElement && point && !this.commitPending) {
      event.preventDefault(); this.lastPointer = point; this.queuePick(point, true);
    } else { this.lastPointer = event.pointerType === 'touch' ? null : point; }
  }

  selectionViewKey() {
    return JSON.stringify([this.renderer.basis?.() || this.renderer.presentedMeasurementFrame?.basis, this.renderer.settings]);
  }

  queuePick(point, commit = false) {
    if (!this.placing || this.doc.hidden || (this.commitPending && !commit)) return;
    if (commit) this.commitPending = true;
    this.pending = { ...point, commit, epoch: this.epoch, viewKey: commit ? point.viewKey || this.selectionViewKey() : null };
    if (!this.busy && !this.timer) {
      const delay = commit ? 0 : Math.max(0, 70 - ((this.view.performance?.now?.() || Date.now()) - (this.lastPickAt || 0)));
      this.timer = this.view.setTimeout(() => { this.timer = null; void this.drainPick(); }, delay);
    }
  }

  async drainPick() {
    if (this.busy || !this.pending || !this.placing) return;
    const request = this.pending; this.pending = null; this.busy = true;
    this.lastPickAt = this.view.performance?.now?.() || Date.now();
    const abort = this.abort = new AbortController();
    try {
      const hit = await this.picker.pick(request.u, request.v, { toleranceCssPixels: request.pointerType === 'touch' ? 6 : 4, signal: abort.signal });
      if (abort.signal.aborted || request.epoch !== this.epoch || !this.placing || !this.active || this.doc.hidden || this.disposed) return;
      if (hit && hit.sourceKey && hit.sourceKey !== this.sourceKey) return;
      if (request.commit && request.viewKey !== this.selectionViewKey()) {
        this.preview = null; this.promptText.textContent = 'View changed · Choose the point again'; this.draw(); return;
      }
      if (request.commit) {
        if (!validMeasurementPoint(hit?.world)) {
          this.preview = null;
          this.promptText.textContent = this.picker.unavailableReason ? 'Surface selection unavailable · Try again' : 'Choose a point on the visible heart';
          this.announcement.textContent = this.picker.unavailableReason ? 'Surface selection is temporarily unavailable. Try again after the view finishes updating.' : 'No surface at that point. Choose a point on the visible heart.';
        } else if (this.points.length && measurementDistanceMm(this.points[0], hit.world, this.geometry) < .01) {
          this.promptText.textContent = 'Choose a different second point';
        } else {
          this.points.push([...hit.world]); this.preview = null;
          if (this.points.length === 2) {
            this.placing = false; this.renderer.measurementPlacing = false; this.pending = null; this.lastPointer = null;
            this.announcement.textContent = `Straight-line distance ${measurementDistanceMm(...this.points, this.geometry).toFixed(1)} millimeters.`;
          } else {
            this.promptText.textContent = 'Choose the second point · Drag to rotate';
            this.announcement.textContent = 'First point placed. Choose the second surface point.';
          }
        }
      } else if (!this.pending) this.preview = validMeasurementPoint(hit?.world) ? [...hit.world] : null;
      this.sync(); this.draw();
    } catch (error) {
      if (!abort.signal.aborted && request.epoch === this.epoch && this.placing && error?.name !== 'AbortError') {
        this.preview = null; this.promptText.textContent = 'Surface selection unavailable · Try again'; this.draw();
      }
    } finally {
      this.busy = false; if (this.abort === abort) this.abort = null;
      if (request.commit && request.epoch === this.epoch) this.commitPending = false;
      if (this.pending && this.placing) this.queuePick(this.pending, this.pending.commit);
    }
  }

  draw() {
    if (!this.overlay) return;
    const frame = this.renderer.presentedMeasurementFrame;
    const visible = this.active && !this.doc.hidden && !this.contextLost && (this.points.length || this.preview) && frame?.basis && (!frame.sourceKey || frame.sourceKey === this.sourceKey);
    this.overlay.hidden = !visible;
    if (!visible) return;
    const rect = this.canvas.getBoundingClientRect(), parent = this.viewport.getBoundingClientRect();
    const width = rect.width, height = rect.height;
    if (!(width > 0 && height > 0)) { this.overlay.hidden = true; return; }
    // Resizing stretches the previous canvas until the next render. Do not
    // project its old depth with a new aspect ratio during that short interval.
    if ((Number.isFinite(frame.cssWidth) && Math.abs(frame.cssWidth - width) > .01) || (Number.isFinite(frame.cssHeight) && Math.abs(frame.cssHeight - height) > .01)) { this.overlay.hidden = true; return; }
    Object.assign(this.overlay.style, { left: `${rect.left - parent.left}px`, top: `${rect.top - parent.top}px`, width: `${width}px`, height: `${height}px` });
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const project = p => p ? projectMeasurementPoint(p, frame.basis, width, height, frame.aspect) : null;
    const a = project(this.points[0]), b = project(this.points[1] || (this.points.length ? this.preview : null)), hover = project(this.preview);
    const dot = (node, p, radius) => {
      node.style.display = p && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height ? '' : 'none';
      if (p) { node.setAttribute('cx', p.x); node.setAttribute('cy', p.y); node.setAttribute('r', radius); }
    };
    dot(this.dotA, a, 4); dot(this.dotB, this.points.length === 2 ? b : null, 4); dot(this.hoverDot, hover, 5);
    for (const line of [this.lineBack, this.line]) {
      line.style.display = a && b ? '' : 'none';
      if (a && b) for (const [key, value] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) line.setAttribute(key, value);
    }
    this.label.hidden = !(a && b);
    if (a && b) {
      const distance = measurementDistanceMm(this.points[0], this.points[1] || this.preview, this.geometry);
      this.label.textContent = `${distance.toFixed(1)} mm`;
      this.label.title = 'Straight-line distance in the source scan';
      const x = Math.max(52, Math.min(width - 52, (a.x + b.x) / 2));
      const y = Math.max(22, Math.min(height - 22, (a.y + b.y) / 2 - 16));
      this.label.style.left = `${x}px`; this.label.style.top = `${y}px`;
    }
  }

  dispose() {
    this.clear(); this.disposed = true; this.listeners.splice(0).forEach(remove => remove()); this.resize?.disconnect(); this.picker.dispose?.();
    if (this.renderer.onMeasurementFrame === this.frameListener) this.renderer.onMeasurementFrame = this.previousFrameListener;
    if (this.renderer.measurementController === this) this.renderer.measurementController = null;
    this.overlay.remove(); this.prompt.remove(); this.announcement.remove();
  }
}
