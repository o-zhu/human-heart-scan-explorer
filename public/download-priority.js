/** Give the visible scan and input handling priority over optional downloads. */
const safely = (callback, value) => { try { callback(value); } catch { /* An observer cannot block the viewer. */ } };

export class ScanActivity {
  constructor({ready = false, idleMs = 1800, prefetchIdleMs = 180,
               now = () => performance.now(),
               setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
               clearTimer = handle => globalThis.clearTimeout(handle),
               document = null, window = null} = {}) {
    this.ready = ready; this.idleMs = idleMs; this.prefetchIdleMs = prefetchIdleMs;
    // Keep native browser calls on their Window/worker receiver when invoked as methods.
    this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.lastActivity = -Infinity; this.foreground = new Map(); this.gestures = new Set();
    this.listeners = new Set(); this.sequence = 0; this.cleanups = [];
    if (document) this.observe(document, window);
  }
  getState() {
    const quietFor = Math.max(0, this.now() - this.lastActivity);
    const busy = this.foreground.size > 0, interacting = this.gestures.size > 0;
    const canRun = this.ready && !busy && !interacting && !this.disposed;
    // A slice gesture may prepare already-stored neighbors, but those decodes
    // must not compete with opening/refining the volume or another module.
    const allowLocalPrefetch = this.ready && !this.disposed &&
      [...this.foreground.values()].every(kind => kind === 'section');
    const reason = !this.ready ? 'loading-viewer' : busy ? 'foreground'
      : interacting || quietFor < this.idleMs ? 'interaction' : null;
    return {viewerReady:this.ready, foregroundCount:this.foreground.size, interacting, allowLocalPrefetch,
      allowPrefetch:canRun && quietFor >= this.prefetchIdleMs,
      allowBackground:canRun && quietFor >= this.idleMs, reason};
  }
  subscribe(listener) {
    this.listeners.add(listener); safely(listener, this.getState());
    return () => this.listeners.delete(listener);
  }
  publish() {
    if (this.disposed) return;
    const state = this.getState(), key = JSON.stringify(state);
    if (key !== this.lastState) {
      this.lastState = key;
      for (const listener of this.listeners) safely(listener, state);
    }
    this.clearTimer(this.timer); this.timer = null;
    if (!this.ready || this.foreground.size || this.gestures.size) return;
    const quietFor = this.now() - this.lastActivity;
    const next = [this.prefetchIdleMs, this.idleMs].find(ms => quietFor < ms);
    if (next !== undefined) {
      this.timer = this.setTimer(() => this.publish(), Math.max(1, next - quietFor));
      this.timer?.unref?.();
    }
  }
  setViewerReady(ready = true) {
    if (this.ready === Boolean(ready)) return;
    this.ready = Boolean(ready); this.lastActivity = this.now(); this.publish();
  }
  beginForeground(kind = 'current-view') {
    const id = ++this.sequence;
    this.foreground.set(id, kind); this.publish();
    let released = false;
    return () => {
      if (released) return;
      released = true; this.foreground.delete(id); this.lastActivity = this.now(); this.publish();
    };
  }
  noteInteraction() { this.lastActivity = this.now(); this.publish(); }
  beginGesture(id = 'pointer') { this.gestures.add(id); this.noteInteraction(); }
  endGesture(id = 'pointer') { this.gestures.delete(id); this.noteInteraction(); }
  observe(document, window) {
    const listen = (target, type, handler) => {
      target?.addEventListener?.(type, handler, {capture:true, passive:true});
      this.cleanups.push(() => target?.removeEventListener?.(type, handler, {capture:true}));
    };
    listen(document, 'pointerdown', event => this.beginGesture(event.pointerId));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      listen(document, type, event => this.endGesture(event.pointerId));
    listen(document, 'pointermove', event => {
      if (event.buttons || document.pointerLockElement) this.noteInteraction();
    });
    listen(document, 'mousemove', () => { if (document.pointerLockElement) this.noteInteraction(); });
    for (const type of ['wheel', 'keydown', 'input', 'scroll'])
      listen(document, type, () => this.noteInteraction());
    const clearGestures = () => { this.gestures.clear(); this.noteInteraction(); };
    listen(window, 'blur', clearGestures);
    listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') clearGestures(); });
  }
  dispose() {
    this.disposed = true; this.clearTimer(this.timer);
    for (const cleanup of this.cleanups) cleanup();
    this.listeners.clear(); this.foreground.clear(); this.gestures.clear();
  }
}

// Loading begins closed. The app opens the gate only after the first usable view.
// Listeners are passive: they never capture the cursor or change input behavior.
export const scanActivity = new ScanActivity({document:globalThis.document, window:globalThis.window});
