/**
 * Reversible display control for a prepared, source-derived coronary view.
 *
 * prepare({signal, onProgress, donorId}) may fetch/decode but must not change the
 * visible renderer. commit(prepared) synchronously installs the complete field;
 * only then does this controller enable settings.coronaryReveal. The renderer
 * owns committed resources and applies its own dataset/workspace eligibility.
 * discard(prepared), when supplied, releases an uncommitted stale result.
 *
 * App hooks: setContext on donor/workspace changes, sync after lazy Echo mount,
 * and exit before an explicit threshold or Detail selection. Nothing here
 * writes the camera, source data, threshold, clipping, window or mesh choice.
 */

const WORKSPACES = new Set(['reconstruction', 'echo']);
const EXPLANATION = 'Prepared intensity-based surface for following coronary vessel outlines. It does not classify arteries or fat. CT sections retain their source samples.';
const ICON = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2v6m0 0L5 5M10 8l5-3M10 8v5m0 0-5 5m5-5 5 5M5 5 3 7m12-2 2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function coronaryControlsMarkup() {
 return `<div class="coronary-control" data-coronary-controls hidden><button class="coronary-toggle" data-coronary-toggle type="button" aria-pressed="false">${ICON}<span data-coronary-label>Reveal Coronaries</span></button><span class="coronary-status" data-coronary-status role="status" aria-live="polite" hidden></span></div>`;
}

function progressText(progress) {
 if (typeof progress === 'string') return progress.slice(0, 180);
 if (typeof progress?.message === 'string') return progress.message.slice(0, 180);
 const loaded = Number(progress?.loaded), total = Number(progress?.total);
 if (Number.isFinite(loaded) && Number.isFinite(total) && total > 0) {
  // Avoid a live-region announcement for every downloaded chunk. Completion is
  // announced by the changed button, after the complete field is committed.
  const percent = Math.min(95, Math.max(0, Math.floor(loaded / total * 20) * 5));
  return `Preparing Coronary View · ${percent}%`;
 }
 return 'Preparing Coronary View…';
}

export class CoronaryControls {
 constructor({renderer, prepare, commit, discard = () => {}, onChange = () => {}, onIntent = () => {}, document = globalThis.document,
  context = {}} = {}) {
  if (!renderer || typeof prepare !== 'function' || typeof commit !== 'function' || !document) {
   throw new TypeError('CoronaryControls requires a renderer, document, prepare and commit.');
  }
  this.renderer = renderer; this.prepare = prepare; this.commit = commit;
  this.discard = discard; this.onChange = onChange; this.onIntent = onIntent; this.document = document;
  this.context = {donorId: '', workspace: 'reconstruction', supported: false, samplingLabel: '', ...context};
  this.loading = false; this.error = ''; this.status = ''; this.revision = 0;
  this.abort = null; this.pending = null; this.disposed = false;
  this.click = event => {
   const button = event.target?.closest?.('[data-coronary-toggle]');
   if (!button || button.disabled || !button.closest('[data-coronary-controls]') || !this.available) return;
   event.preventDefault(); void this.toggle();
  };
  document.addEventListener('click', this.click);
  this.sync();
 }

 get available() { return !this.disposed && this.context.supported && WORKSPACES.has(this.context.workspace); }
 get active() { return this.available && this.renderer.settings.mode === 0 && this.renderer.settings.coronaryReveal === true; }

 setContext(next = {}) {
  if (this.disposed) return;
  const prior = this.context, context = {...prior, ...next};
  const donorChanged = context.donorId !== prior.donorId;
  const changed = donorChanged || context.workspace !== prior.workspace || context.supported !== prior.supported;
  this.context = context;
  if (changed) this.cancelPending();
  // A successful view preference can pass between Reconstruction and Echo and
  // remain suspended in a lab. It never passes into another donor or an
  // unsupported backend. The renderer independently gates its actual use.
  if ((donorChanged || !context.supported) && this.renderer.settings.coronaryReveal) {
   this.renderer.set({coronaryReveal: false});
  }
  this.sync();
  if (changed) this.onChange(this.active);
 }

 mountEcho() {
  const toolbar = this.document.querySelector('#echoPanel .echo-view-column .echo-toolbar-content');
  if (!toolbar || toolbar.querySelector('[data-coronary-controls]')) return;
  const holder = this.document.createElement('div'); holder.innerHTML = coronaryControlsMarkup();
  toolbar.append(holder.firstElementChild);
 }

 sync() {
  if (this.disposed) return;
  this.mountEcho();
  const surfaceMode = this.renderer.settings.mode === 0;
  const explanation = [EXPLANATION, this.context.samplingLabel].filter(Boolean).join(' ');
  for (const control of this.document.querySelectorAll('[data-coronary-controls]')) {
   control.hidden = !this.available;
   const button = control.querySelector('[data-coronary-toggle]');
   const label = control.querySelector('[data-coronary-label]');
   const status = control.querySelector('[data-coronary-status]');
   if (!button || !label || !status) continue;
   const text = this.loading ? 'Cancel Preparation' : this.active ? 'Restore Surface Tissue' : this.error ? 'Retry Coronary View' : 'Reveal Coronaries';
   if (label.textContent !== text) label.textContent = text;
   button.disabled = !surfaceMode && !this.loading;
   button.setAttribute('aria-pressed', String(this.active));
   button.setAttribute('aria-busy', String(this.loading));
   button.title = !surfaceMode ? 'Available in Whole Organ or Cutaway.' : this.loading ? 'Keep the current surface and cancel preparation.' : this.error ? `Retry preparation. ${this.error}` : explanation;
   control.classList.toggle('is-active', this.active);
   control.classList.toggle('is-loading', this.loading);
   control.classList.toggle('has-error', Boolean(this.error));
   status.hidden = !this.loading && !this.error;
   const message = this.error ? 'Could not load this surface. Your current view is unchanged.' : this.status;
   if (status.textContent !== message) status.textContent = message;
  }
 }

 cancelPending() {
  ++this.revision; this.abort?.abort(); this.abort = null;
  this.pending = null; this.loading = false; this.status = ''; this.error = '';
 }

 exit() {
  if (this.disposed) return;
  this.cancelPending();
  if (this.renderer.settings.coronaryReveal) this.renderer.set({coronaryReveal: false});
  this.sync(); this.onChange(this.active);
 }

 toggle() {
  this.onIntent();
  if (this.loading || this.active) { this.exit(); return Promise.resolve(false); }
  return this.enable();
 }

 enable() {
  if (!this.available || this.renderer.settings.mode !== 0) return Promise.resolve(false);
  if (this.loading) return this.pending;
  this.cancelPending();
  const revision = this.revision, abort = new AbortController(), donorId = this.context.donorId;
  this.abort = abort; this.loading = true; this.status = 'Preparing Coronary View…';
  this.sync(); this.onChange(this.active);
  const current = () => !this.disposed && revision === this.revision && !abort.signal.aborted &&
   this.available && this.context.donorId === donorId && this.renderer.settings.mode === 0;
  const onProgress = progress => {
   if (!current()) return;
   const status = progressText(progress);
   if (status !== this.status) { this.status = status; this.sync(); }
  };
  this.pending = (async () => {
   let prepared, committed = false;
   try {
    // Let a synchronous context change/cancel win before starting transport.
    // This also keeps pending correct when prepare throws synchronously.
    await Promise.resolve();
    if (!current()) return false;
    prepared = await this.prepare({signal: abort.signal, onProgress, donorId});
    if (!current()) return false;
    this.commit(prepared); committed = true;
    this.renderer.set({coronaryReveal: true});
    return true;
   } catch (error) {
    if (current()) this.error = String(error?.message || 'The prepared surface could not be loaded.').slice(0, 300);
    return false;
   } finally {
    if (prepared !== undefined && !committed) {
     // A stale result may arrive even when its transport cannot be aborted.
     // A cleanup error must not reactivate or replace the current surface.
     try { this.discard(prepared); } catch { /* best-effort cleanup */ }
    }
    if (revision === this.revision && !this.disposed) {
     this.abort = null; this.loading = false; this.pending = null; this.status = '';
     this.sync(); this.onChange(this.active);
    }
   }
  })();
  return this.pending;
 }

 dispose() {
  if (this.disposed) return;
  this.exit(); this.disposed = true;
  this.document.removeEventListener('click', this.click);
  for (const control of this.document.querySelectorAll('[data-coronary-controls]')) control.hidden = true;
 }
}
