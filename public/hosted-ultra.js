/**
 * Hosted scan sections with manifest-declared display compression. The selected cut face,
 * orthogonal cards and speculative neighbors share every transfer and decode.
 * Crop origins and pixel spacing remain in the source scan coordinates.
 * The primary compact profile bounds display intensity error to one gray level;
 * original immutable lossless sections remain available in their source bank.
 */
import {SectionTransport} from './ultra-prefetch.js';
import {scanActivity} from './download-priority.js';
import {getDeviceResourcePolicy} from './device-resources.js';
const MIB = 1024 * 1024;
const keyFor = (axis, index) => `ultra:${axis}:${index}`;
const abortError = () => new DOMException('The previous scan section is no longer needed.', 'AbortError');
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };
const safely = (callback, value) => { try { callback?.(value); } catch { /* UI observers cannot break shared loading. */ } };

export class HostedSectionStore {
  constructor({loader, fetchImpl = (...args) => fetch(...args), manifest = null,
               connection = globalThis.navigator?.connection, resourcePolicy = getDeviceResourcePolicy(), decodedLimit = resourcePolicy.sectionCacheBytes,
               maxConcurrency = resourcePolicy.constrained ? 2 : 3, idleDelay = 180, now = () => performance.now(),
               visibility = () => globalThis.document?.visibilityState !== 'hidden',
               autoDownloadCollection = !loader, collectionConfigurator,
               manifestUrl = './assets/ultra-sections/manifest.json', cacheName, pauseKey,
               activity = loader ? null : scanActivity, collectionConcurrency = 1, collectionDelay = 400} = {}) {
    this.cache = new Map(); this.pending = new Map(); this.active = new Set();
    this.wanted = new Map(); this.failedUntil = new Map(); this.localMissUntil = new Map(); this.listeners = new Set();
    this.cacheBytes = 0; this.decodedLimit = decodedLimit; this.maxConcurrency = maxConcurrency; this.resourcePolicy = resourcePolicy;
    this.fetchImpl = fetchImpl; this.connection = connection; this.now = now; this.visibility = visibility;
    this.manifestUrl = new URL(manifestUrl, import.meta.url); this.activity = activity;
    this.pauseKey = pauseKey || 'heart-ultra-collection-v7-paused';
    this.collectionConcurrency = Math.max(1, collectionConcurrency); this.collectionDelay = Math.max(0, collectionDelay);
    this.nextCollectionStartAt = 0;
    this.idleDelay = idleDelay; this.focus = null; this.visible = null; this.recentFocus = [];
    this.decodeEstimateMs = 32;
    this.paused = false; this.serial = 0; this.focusRevision = 0; this.disposed = false;
    this.autoDownloadCollection = autoDownloadCollection; this.collectionStarted = false; this.collectionConfigured = false;
    this.collectionPaused = this.readCollectionPause(); this.collectionDone = new Set(); this.collectionFailures = new Map();
    this.collectionCompletedBytes = 0; this.collectionStorageReason = null;
    this.metrics = {cacheHits:0, encodedHits:0, networkLoads:0, preempted:0,
      encodedBytes:0, persistentBytes:0, persistentAvailable:false, decodeWorker:false};
    this.transport = loader ? null : new SectionTransport({onStats:stats => this.receiveTransportStats(stats),backendOptions:{fetchImpl,cacheOptions:{cacheName}}});
    this.collectionConfigurator = collectionConfigurator || ((entries,options) => this.transport
      ? this.transport.configureCollection(entries,options) : Promise.resolve({persistentAvailable:false,storageReason:'storage-unavailable',persistedUrls:[]}));
    this.loader = loader || ((request, options) => this.transport.load(request, options));
    if (manifest) this.acceptManifest(manifest);
    this.onPolicyChange = () => {
      if (this.disposed) return;
      this.transport?.setBackgroundEnabled(!this.collectionPolicyReason());
      if (this.manifest) {
        this.plan(this.extended); this.refreshCollectionTasks();
        if (this.collectionStarted && !this.collectionConfigured && !this.collectionSetup && !this.collectionPolicyReason())
          void this.startCollectionDownload();
      }
    };
    this.unsubscribeActivity = activity?.subscribe(this.onPolicyChange);
    connection?.addEventListener?.('change', this.onPolicyChange);
    globalThis.document?.addEventListener?.('visibilitychange', this.onPolicyChange);
    globalThis.addEventListener?.('online',this.onPolicyChange); globalThis.addEventListener?.('offline',this.onPolicyChange);
  }
  acceptManifest(manifest) {
    if (manifest.schemaVersion !== 2 || !manifest.cropped || !manifest.slices) throw new Error('The hosted scan-section metadata is invalid.');
    for (let axis = 0; axis < 3; axis++) if (manifest.slices['xyz'[axis]]?.length !== manifest.sliceCounts[axis])
      throw new Error('The hosted scan-section inventory is incomplete.');
    this.manifest = manifest;
    this.base = new URL(manifest.assetBaseUrl || './assets/ultra-sections/', import.meta.url);
    this.initializeCollectionInventory(); return manifest;
  }
  readCollectionPause() {
    try { return globalThis.localStorage?.getItem(this.pauseKey) === '1'; } catch { return false; }
  }
  saveCollectionPause() {
    try { globalThis.localStorage?.setItem(this.pauseKey,this.collectionPaused ? '1' : '0'); } catch { /* Storage preferences are optional. */ }
  }
  receiveTransportStats(stats) {
    for (const key of ['encodedBytes','persistentBytes','persistentAvailable','persistentLimit','decodeWorker'])
      if (stats[key] !== undefined) this.metrics[key] = stats[key];
    if (stats.persistedUrl) this.markCollectionStored(stats.persistedUrl);
    if (stats.invalidatedUrl) this.markCollectionMissing(stats.invalidatedUrl);
    if (stats.persistentWriteBlockedReason) {
      this.collectionStorageReason = stats.persistentWriteBlockedReason;
      this.refreshCollectionTasks();
    }
    this.emitStatus();
  }
  initializeCollectionInventory() {
    this.collectionEntries = []; this.collectionByUrl = new Map(); this.collectionByKey = new Map();
    this.collectionTotalBytes = 0; this.collectionEmptySections = 0;
    for (let axis = 0; axis < 3; axis++) for (let index = 0; index < this.manifest.sliceCounts[axis]; index++) {
      const record = this.record(axis,index);
      if (record.empty) { this.collectionEmptySections++; continue; }
      const url = new URL(record.path,this.base); if (record.sha256) url.searchParams.set('v',record.sha256.slice(0,16));
      const entry = {axis,index,key:keyFor(axis,index),url:url.href,bytes:record.bytes};
      this.collectionEntries.push(entry); this.collectionByUrl.set(entry.url,entry); this.collectionByKey.set(entry.key,entry);
      this.collectionTotalBytes += entry.bytes;
    }
    if (this.autoDownloadCollection) queueMicrotask(() => { if (!this.disposed) void this.startCollectionDownload(); });
  }
  markCollectionStored(url) {
    const entry = this.collectionByUrl?.get(url);
    if (!entry || this.collectionDone.has(entry.key)) return;
    this.collectionDone.add(entry.key); this.collectionCompletedBytes += entry.bytes; this.collectionFailures.delete(entry.key);
    const task = this.pending.get(entry.key);
    if (task) { this.updatePriority(task); if (task.state === 'queued') this.cancelIfUnused(task); }
    this.schedulePump(); this.emitStatus();
  }
  markCollectionMissing(url) {
    const entry = this.collectionByUrl?.get(url);
    if (!entry || !this.collectionDone.delete(entry.key)) return;
    this.collectionCompletedBytes -= entry.bytes; this.schedulePump(); this.emitStatus();
  }
  collectionPolicyReason() {
    if (this.collectionPaused) return 'user';
    if (this.collectionStorageReason) return this.collectionStorageReason;
    if (this.connection?.saveData && !this.collectionAllowMetered) return 'save-data';
    if (globalThis.navigator?.onLine === false) return 'offline';
    if (!this.visibility()) return 'hidden';
    const activity = this.activity?.getState();
    if (activity && !activity.allowBackground) return activity.reason || 'interaction';
    return null;
  }
  collectionBlockReason() {
    if (!this.collectionStarted) return 'not-started';
    return this.collectionPolicyReason() || (!this.collectionConfigured ? 'checking-storage' : null);
  }
  collectionRunnable() { return this.collectionBlockReason() === null && !this.disposed; }
  getCollectionStatus() {
    const totalFiles = this.collectionEntries?.length || 0, complete = this.collectionConfigured && this.collectionDone.size === totalFiles;
    const reason = this.collectionBlockReason();
    let state = !this.collectionStarted ? 'idle' : complete ? 'complete' : reason === 'checking-storage' ? 'checking'
      : reason === 'quota' || reason === 'storage-unavailable' ? 'blocked' : reason ? 'paused' : 'downloading';
    let nextRetryAt = null, failedFiles = 0, readyMissing = false;
    for (const entry of this.collectionEntries || []) {
      if (this.collectionDone.has(entry.key)) continue;
      const failure = this.collectionFailures.get(entry.key);
      if (!failure || failure.retryAt <= this.now() && failure.attempts < 3) readyMissing = true;
      else if (failure.attempts >= 3) failedFiles++;
      else nextRetryAt = nextRetryAt == null ? failure.retryAt : Math.min(nextRetryAt,failure.retryAt);
    }
    let detailReason = complete ? null : reason;
    if (state === 'downloading' && !readyMissing && ![...this.active].some(task => task.collectionRequested)) {
      state = nextRetryAt != null ? 'waiting' : 'partial'; detailReason = nextRetryAt != null ? 'network-retry' : 'failed-files';
    }
    const activeBytes = [...this.active].reduce((sum,task) => sum + (this.collectionDone.has(task.key) ? 0 : Math.min(task.receivedBytes || 0,task.record.bytes || 0)),0);
    return {state,reason:detailReason,enabled:this.collectionStarted,paused:this.collectionPaused,complete,
      totalFiles,completedFiles:this.collectionDone.size,totalBytes:this.collectionTotalBytes || 0,
      completedBytes:this.collectionCompletedBytes,activeBytes,failedFiles,
      totalSections:this.manifest?.sliceCounts.reduce((sum,n) => sum+n,0) || 0,emptySections:this.collectionEmptySections || 0,
      persistentLimit:this.metrics.persistentLimit || 640*MIB,availableBytes:this.collectionAvailableBytes ?? null,
      requiredBytes:Math.max(0,(this.collectionTotalBytes || 0)-this.collectionCompletedBytes),
      retryInMs:nextRetryAt == null ? null : Math.max(0,nextRetryAt-this.now())};
  }
  async startCollectionDownload({retry = false} = {}) {
    if (this.disposed) return this.getCollectionStatus();
    this.collectionStarted = true;
    this.transport?.setBackgroundEnabled(!this.collectionPolicyReason());
    if (this.collectionSetup) return this.collectionSetup;
    if (this.collectionConfigured && !retry) { this.refreshCollectionTasks(); return this.getCollectionStatus(); }
    if (!this.manifest) await this.init();
    if (this.disposed) return this.getCollectionStatus();
    this.collectionConfigured = false; this.emitStatus();
    // Metadata can be fetched early, but opening/inventorying the full disk cache
    // waits until the heart is usable and foreground work has settled.
    this.transport?.setBackgroundEnabled(!this.collectionPolicyReason());
    if (this.collectionPolicyReason()) { this.refreshCollectionTasks(); return this.getCollectionStatus(); }
    this.collectionSetup = (async () => {
      if (this.disposed) return this.getCollectionStatus();
      const result = await this.collectionConfigurator(this.collectionEntries.map(({url,bytes}) => ({url,bytes})),{retry});
      if (this.disposed) return this.getCollectionStatus();
      this.receiveTransportStats(result);
      for (const url of result.persistedUrls || []) this.markCollectionStored(url);
      this.collectionStorageReason = result.storageReason || (!result.persistentAvailable ? 'storage-unavailable' : null);
      this.collectionAvailableBytes = result.availableBytes ?? null;
      this.collectionConfigured = true; this.refreshCollectionTasks(); return this.getCollectionStatus();
    })().catch(() => {
      this.collectionConfigured = true; this.collectionStorageReason = 'storage-unavailable';
      this.refreshCollectionTasks(); return this.getCollectionStatus();
    }).finally(() => { this.collectionSetup = null; this.emitStatus(); });
    return this.collectionSetup;
  }
  pauseCollectionDownload(paused = true) {
    if (!paused) return this.resumeCollectionDownload();
    this.collectionPaused = true; this.saveCollectionPause(); this.onPolicyChange(); return this.getCollectionStatus();
  }
  async resumeCollectionDownload({allowMetered = true} = {}) {
    this.collectionPaused = false; this.collectionAllowMetered = allowMetered; this.saveCollectionPause();
    this.collectionFailures.clear(); this.collectionStorageReason = null;
    return this.startCollectionDownload({retry:true});
  }
  refreshCollectionTasks() {
    clearTimeout(this.collectionRetryTimer);
    for (const task of this.pending.values()) { this.updatePriority(task); this.cancelIfUnused(task); }
    this.schedulePump(); this.emitStatus();
  }
  ensureCollectionTask() {
    if (!this.collectionRunnable()) return;
    // Nearby/visible sections finish first. Bulk download receives one paced
    // spare slot, never every connection that the foreground viewer can use.
    if ([...this.pending.values()].some(task => this.wantsDecoded(task))) return;
    if (this.now() < this.nextCollectionStartAt) { this.scheduleCollectionPump(); return; }
    const slots = Math.min(this.collectionConcurrency, this.policy().concurrency);
    let prepared = [...this.pending.values()].filter(task => task.collectionRequested && !this.collectionDone.has(task.key)).length;
    if (prepared >= slots) return;
    let nextRetryAt = null;
    for (const entry of this.collectionEntries) {
      if (this.collectionDone.has(entry.key) || this.pending.has(entry.key)) continue;
      const failure = this.collectionFailures.get(entry.key);
      if (failure?.attempts >= 3) continue;
      if (failure?.retryAt > this.now()) { nextRetryAt = Math.min(nextRetryAt ?? Infinity,failure.retryAt); continue; }
      const task = this.ensureTask(entry.axis,entry.index); task.collectionRequested = true; this.updatePriority(task);
      if (++prepared >= slots) return;
    }
    if (nextRetryAt != null) {
      clearTimeout(this.collectionRetryTimer);
      this.collectionRetryTimer = setTimeout(() => this.schedulePump(),Math.max(1,nextRetryAt-this.now()));
      this.collectionRetryTimer.unref?.();
    }
  }
  scheduleCollectionPump() {
    if (this.collectionPaceTimer || this.disposed) return;
    this.collectionPaceTimer = setTimeout(() => { this.collectionPaceTimer = null; this.schedulePump(); },
      Math.max(1, this.nextCollectionStartAt - this.now()));
    this.collectionPaceTimer.unref?.();
  }
  noteCollectionFailure(task) {
    if (!this.collectionStarted || this.collectionDone.has(task.key) || !this.collectionByKey?.has(task.key)) return;
    const attempts = (this.collectionFailures.get(task.key)?.attempts || 0)+1;
    this.collectionFailures.set(task.key,{attempts,retryAt:this.now()+Math.min(60000,5000*4**(attempts-1))});
  }
  wantsDecoded(task) { return Number.isFinite(task.backgroundPriority) || task.subscribers.size > 0; }

  async init() {
    if (this.manifest) return this.manifest;
    if (!this.ready) this.ready = (async () => {
      const response = await this.fetchImpl(this.manifestUrl, {cache:'force-cache',priority:'low'});
      if (!response.ok) throw new Error('The hosted scan-section metadata could not load.');
      return this.acceptManifest(await response.json());
    })();
    try { return await this.ready; } catch (error) { this.ready = null; throw error; }
  }
  record(axis, index) {
    if (!this.manifest) throw new Error('Initialize scan sections first.');
    if (!Number.isInteger(axis) || axis < 0 || axis > 2 || !Number.isInteger(index) ||
        index < 0 || index >= this.manifest.sliceCounts[axis]) throw new RangeError('The requested scan section is outside the volume.');
    return this.manifest.slices['xyz'[axis]][index];
  }
  has(axis, index) { return this.cache.has(keyFor(axis, index)); }
  cached(axis, index) {
    const key = keyFor(axis, index), result = this.cache.get(key);
    if (result) { this.cache.delete(key); this.cache.set(key, result); }
    return result;
  }
  remember(result) {
    if (this.cache.has(result.key)) this.cacheBytes -= this.cache.get(result.key).data.byteLength;
    this.cache.delete(result.key);
    if (result.data.byteLength > this.decodedLimit) return result;
    this.cache.set(result.key, result); this.cacheBytes += result.data.byteLength;
    while (this.cacheBytes > this.decodedLimit) {
      const keys = [...this.cache.keys()], focused = this.focus?.key;
      const oldest = keys.find(key => key !== focused && !this.wanted.has(key)) || keys.find(key => key !== focused) || keys[0];
      this.cacheBytes -= this.cache.get(oldest).data.byteLength; this.cache.delete(oldest);
    }
    return result;
  }
  policy() {
    const saveData = Boolean(this.connection?.saveData), type = this.connection?.effectiveType;
    const slowConnection = ['slow-2g','2g','3g'].includes(type) ||
      (this.connection?.downlink > 0 && this.connection.downlink < 1.5);
    const restricted = saveData || slowConnection;
    const activity = this.activity?.getState();
    const rapid = this.focus?.rapid && this.now() - this.focus.changedAt < 180;
    const compatibilityDecoder = this.transport && (this.transport.workerDisabled || typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function');
    const localSpeculative = this.visibility() && activity?.viewerReady !== false && activity?.allowLocalPrefetch !== false && this.metrics.persistentAvailable
      ? Math.min(Math.max(0,this.maxConcurrency-1),rapid || compatibilityDecoder || this.resourcePolicy.constrained ? 1 : 2) : 0;
    return {saveData, slowConnection, concurrency:restricted ? 1 : this.maxConcurrency,
      taskConcurrency:Math.max(restricted ? 1 : this.maxConcurrency,localSpeculative+1),
      speculative:saveData || rapid || !this.visibility() || activity?.allowPrefetch === false ? 0 : slowConnection ? 1 : Math.max(0, this.maxConcurrency - 1),
      // Stored images can be decoded during a gesture without spending any
      // network bandwidth. Two local jobs overlap bitmap decode/cache reads,
      // leaving one task slot for the selected face. Slow-network limits still
      // constrain transfers, not data already stored on this device.
      localSpeculative, rapid,
      ahead:slowConnection ? 1 : 3, behind:slowConnection ? 0 : 2,
      idleAhead:slowConnection ? 2 : 8, idleBehind:slowConnection ? 1 : 4,
      byteBudget:(slowConnection ? 2 : 10) * MIB};
  }
  getStatus() {
    let readyNeighbors = 0, plannedNeighbors = 0;
    for (const [key, item] of this.wanted) if (item.kind === 'neighbor') {
      plannedNeighbors++; if (this.cache.has(key)) readyNeighbors++;
    }
    const policy = this.policy();
    return {...this.metrics, focus:this.focus ? {axis:this.focus.axis,index:this.focus.index,direction:this.focus.direction} : null,
      currentReady:Boolean(this.focus && this.cache.has(this.focus.key)), readyNeighbors, plannedNeighbors,
      decodedBytes:this.cacheBytes, decodedLimit:this.decodedLimit,
      active:this.active.size, queued:[...this.pending.values()].filter(task => task.state === 'queued').length,
      saveData:policy.saveData, slowConnection:policy.slowConnection, paused:this.paused,collection:this.getCollectionStatus()};
  }
  subscribe(listener) {
    this.listeners.add(listener); safely(listener, {type:'status',status:this.getStatus()});
    return () => this.listeners.delete(listener);
  }
  emit(event) { const message = {...event,status:this.getStatus()}; for (const listener of this.listeners) safely(listener, message); }
  emitStatus() {
    if (this.statusScheduled || this.disposed) return;
    this.statusScheduled = true; queueMicrotask(() => { this.statusScheduled = false; if (!this.disposed) this.emit({type:'status'}); });
  }
  /** Integer source-section indices, including positions. -1 warms the three cards only. */
  setFocus(axis, index, {positions, direction} = {}) {
    if (this.disposed) return;
    const revision = ++this.focusRevision;
    if (!this.manifest) {
      void this.init().then(() => { if (revision === this.focusRevision && !this.disposed) this.setFocus(axis,index,{positions,direction}); })
        .catch(error => this.emit({type:'error',error}));
      return;
    }
    const previous = this.focus, now = this.now();
    if (axis >= 0) {
      this.record(axis,index);
      const sameAxis = previous?.axis === axis, delta = sameAxis ? index - previous.index : 0;
      const elapsed = sameAxis ? Math.max(1,now - previous.changedAt) : Infinity;
      const movement = sameAxis ? Math.sign(delta) || previous.direction : 1;
      const changed = !sameAxis || delta !== 0;
      this.focus = {axis,index,key:keyFor(axis,index),direction:Math.sign(direction) || movement || 1,
        changedAt:changed ? now : previous.changedAt,
        stride:changed ? Math.max(1,Math.min(24,Math.abs(delta))) : previous.stride,
        intervalMs:changed ? elapsed : previous.intervalMs,
        rapid:changed ? sameAxis && this.activity?.getState().allowPrefetch===false && elapsed < 90 && (Math.abs(delta)>1 || elapsed<14) : previous.rapid};
    } else this.focus = null;
    // Keep up to two recently viewed transfers alive for a short reversal. They
    // remain bounded and cannot postpone the newly selected face behind neighbors.
    this.recentFocus = this.focus?.rapid ? [] : this.recentFocus.filter(item => item.until > now && item.key !== this.focus?.key);
    if (previous && previous.key !== this.focus?.key && !this.focus?.rapid && previous.axis===this.focus?.axis)
      this.recentFocus.unshift({...previous,until:now + 320});
    this.recentFocus = this.recentFocus.slice(0,2);
    if (Array.isArray(positions)) this.visible = positions.map((value,a) => Math.max(0,Math.min(this.manifest.sliceCounts[a]-1,Math.round(value))));
    if (!this.visible) this.visible = this.manifest.sliceCounts.map(n => Math.floor(n / 2));
    if (this.focus) this.visible[this.focus.axis] = this.focus.index;
    this.paused = false; clearTimeout(this.idleTimer); clearTimeout(this.recentTimer);
    this.plan(false);
    this.idleTimer = setTimeout(() => { if (revision === this.focusRevision && !this.paused) this.plan(true); },this.idleDelay);
    this.recentTimer = setTimeout(() => { if (revision === this.focusRevision && !this.paused) this.plan(this.extended); },330);
  }
  pauseBackground(paused = true) {
    // Invalidate a deferred setFocus while its manifest is still loading.
    if (paused) this.focusRevision++;
    this.paused = paused; clearTimeout(this.idleTimer); clearTimeout(this.recentTimer);
    if (this.manifest) this.plan(false);
    if (!paused) this.idleTimer = setTimeout(() => this.plan(true),this.idleDelay);
  }
  plan(extended = false) {
    if (!this.manifest || this.disposed) return;
    this.extended = extended; const policy = this.policy(), desired = new Map();
    const add = (axis,index,priority,kind,localOnly = false) => {
      if (index < 0 || index >= this.manifest.sliceCounts[axis]) return;
      const key = keyFor(axis,index), previous = desired.get(key);
      if (!previous || priority < previous.priority) desired.set(key,{key,axis,index,priority,kind,localOnly:localOnly && previous?.localOnly !== false});
      else if (!localOnly) previous.localOnly = false;
    };
    if (!this.paused && this.visibility() && this.activity?.getState().viewerReady !== false) {
      if (this.focus) add(this.focus.axis,this.focus.index,0,'focus');
      const hasLocal = policy.localSpeculative > 0;
      const storedOnly = (axis,index) => !policy.speculative || hasLocal && this.collectionDone.has(keyFor(axis,index));
      if (policy.speculative || hasLocal) this.visible?.forEach((index,axis) => add(axis,index,25,'visible',storedOnly(axis,index)));
      if (policy.speculative || hasLocal) {
        for (const item of this.recentFocus) if (item.until > this.now() && this.pending.has(item.key)) add(item.axis,item.index,2,'recent',storedOnly(item.axis,item.index));
        if (this.focus) {
          const {axis,index,direction} = this.focus, candidates = [];
          const ahead = policy.speculative ? extended ? policy.idleAhead : policy.ahead : 0;
          const behind = policy.speculative ? extended ? policy.idleBehind : policy.behind : 0;
          for (let distance = 1; distance <= Math.max(ahead,behind); distance++) {
            if (distance <= ahead) candidates.push({index:index + direction * distance,distance,back:false});
            if (distance <= behind) candidates.push({index:index - direction * distance,distance,back:true});
          }
          let plannedBytes = 0;
          for (const candidate of candidates) {
            if (candidate.index < 0 || candidate.index >= this.manifest.sliceCounts[axis]) continue;
            const bytes = this.record(axis,candidate.index).bytes || 0;
            if (plannedBytes + bytes > policy.byteBudget) continue;
            plannedBytes += bytes;
            const immediate = candidate.distance <= (candidate.back ? policy.behind : policy.ahead);
            add(axis,candidate.index,immediate ? 4 + candidate.distance * 2 + Number(candidate.back) : 28 + candidate.distance,'neighbor',storedOnly(axis,candidate.index));
          }
          if (hasLocal) {
            // Build a runway before the next wheel event, including while idle.
            // Budget decoded pixels rather than compressed network bytes. Old
            // slices remain in the LRU for reversals; reserve room for all cards.
            let decodedBytes = 0;
            const decodedBudget = this.decodedLimit * .7;
            const offsets = [];
            if (policy.rapid) {
              // Fast wheels and slider drags skip many sections. Decode the
              // likely next sampled positions, not every intermediate image.
              const stride = this.focus.stride || 1;
              const lead = Math.max(1,Math.min(4,Math.ceil(this.decodeEstimateMs / Math.max(8,this.focus.intervalMs))));
              offsets.push(stride*lead,stride*(lead+1),stride,1,-stride);
            } else for (let distance=1;distance<=12;distance++) offsets.push(...(distance<=2?[distance,-distance]:[distance]));
            for (const [order,offset] of [...new Set(offsets)].entries()) {
              const next = index + direction * offset;
              if (next < 0 || next >= this.manifest.sliceCounts[axis]) continue;
              const record = this.record(axis,next), bytes = record.crop[2] * record.crop[3];
              if (decodedBytes + bytes > decodedBudget) continue;
              decodedBytes += bytes;
              add(axis,next,policy.rapid ? 6+order : 4+Math.abs(offset)*2+Number(offset<0),'neighbor',true);
            }
          }
        }
        if (extended || !this.focus) this.visible?.forEach((index,axis) => {
          if (axis !== this.focus?.axis) { add(axis,index+1,45,'neighbor',storedOnly(axis,index+1)); add(axis,index-1,46,'neighbor',storedOnly(axis,index-1)); }
        });
      }
    }
    this.wanted = desired;
    for (const task of this.pending.values()) {
      task.backgroundPriority = desired.get(task.key)?.priority ?? Infinity;
      this.updatePriority(task); this.cancelIfUnused(task);
      if(task.state==='active'&&this.localOnly(task)&&!task.startedLocalOnly&&task.phase!=='decode'){
        task.state='cancelling';task.controller.abort();
      }
    }
    for (const item of desired.values()) if (!this.cache.has(item.key) && !(this.failedUntil.get(item.key) > this.now()) && !(item.localOnly && this.localMissUntil.get(item.key) > this.now()))
      this.ensureTask(item.axis,item.index);
    this.schedulePump(); this.emitStatus();
  }
  ensureTask(axis,index) {
    const key = keyFor(axis,index);
    let task = this.pending.get(key);
    if (!task) {
      task = {key,axis,index,record:this.record(axis,index),order:++this.serial,subscribers:new Set(),
        state:'queued',phase:'queued',backgroundPriority:this.wanted.get(key)?.priority ?? Infinity};
      this.pending.set(key,task); this.updatePriority(task);
    }
    return task;
  }
  updatePriority(task) {
    const collectionPriority = task.collectionRequested && this.collectionRunnable() && !this.collectionDone.has(task.key) ? 100 : Infinity;
    task.priority = Math.min(task.backgroundPriority,collectionPriority,...[...task.subscribers].map(subscriber => subscriber.priority));
  }
  localOnly(task) { return !task.subscribers.size && this.wanted.get(task.key)?.localOnly === true; }
  needed(task) { return this.wantsDecoded(task) || Boolean(task.collectionRequested && this.collectionRunnable() && !this.collectionDone.has(task.key)); }
  cancelIfUnused(task) {
    if (this.needed(task)) return;
    if (task.state === 'queued') this.pending.delete(task.key);
    else if (task.state === 'active') {
      // The bitmap codec is already running and cannot be interrupted. Keep
      // its bounded result for reversals rather than spend the same native
      // work and throw the pixels away. No obsolete image is presented.
      const retainDecode=task.phase==='decode'&&!this.paused&&!this.disposed&&this.visibility()&&
        this.activity?.getState().allowLocalPrefetch!==false;
      if(retainDecode)return;
      task.state = 'cancelling'; task.controller.abort();
    }
  }
  async load(axis,index,{signal,onProgress,cacheOnly=false,priority=0} = {}) {
    if (this.disposed) throw new Error('The scan section store has been disposed.');
    checkAbort(signal); await this.init(); checkAbort(signal);
    this.record(axis,index);
    const cached = this.cached(axis,index);
    if (cached) {
      this.metrics.cacheHits++; this.emitStatus();
      safely(onProgress,{stage:'ready',loaded:1,completed:1,total:1,receivedBytes:0,cached:true,spacingUm:this.manifest.spacingUm || this.manifest.sourceSpacingUm || 79.4});
      return cached;
    }
    if (cacheOnly) { const error = new Error('This section is not in the decoded image cache.'); error.name = 'CacheMissError'; throw error; }
    const key = keyFor(axis,index); this.failedUntil.delete(key); this.localMissUntil.delete(key); this.collectionFailures.delete(key);
    const task = this.ensureTask(axis,index);
    return new Promise((resolve,reject) => {
      const subscriber = {resolve,reject,onProgress,priority:Number.isFinite(priority) ? priority : 0};
      const cleanup = () => { signal?.removeEventListener('abort',abort); task.subscribers.delete(subscriber); subscriber.release?.(); };
      const abort = () => { cleanup(); this.updatePriority(task); this.cancelIfUnused(task); reject(abortError()); this.schedulePump(); };
      subscriber.cleanup = cleanup; task.subscribers.add(subscriber); this.updatePriority(task);
      // Subscribe before closing the background gate: a selected image can join
      // a bulk transfer already in flight without aborting/refetching that image.
      subscriber.release = this.activity?.beginForeground('section');
      signal?.addEventListener('abort',abort,{once:true});
      if (signal?.aborted) { abort(); return; }
      safely(onProgress,{stage:task.phase,loaded:0,completed:0,total:1,estimatedBytes:task.record.bytes,spacingUm:this.manifest.spacingUm || this.manifest.sourceSpacingUm || 79.4});
      this.schedulePump();
    });
  }
  schedulePump() {
    if (this.pumpScheduled || this.disposed) return;
    this.pumpScheduled = true; queueMicrotask(() => { this.pumpScheduled = false; this.pump(); });
  }
  pump() {
    if (this.disposed) return;
    this.ensureCollectionTask();
    const policy = this.policy();
    const queue = [...this.pending.values()].filter(task => task.state === 'queued' && this.needed(task))
      .sort((a,b) => a.priority - b.priority || a.order - b.order);
    const usesTransferSlot = task => task.state !== 'cancelling' && !task.startedLocalOnly && !['decode','decode-queued'].includes(task.phase);
    // A current face can interrupt speculative/other-card network work. Decoding
    // already underway is allowed to finish, avoiding repeated bitmap work.
    const urgent = queue.filter(task => task.priority < 100);
    if (urgent.length) {
      let available = Math.max(0,policy.taskConcurrency-this.active.size)+[...this.active].filter(task => task.state === 'cancelling').length;
      const victims = [...this.active].filter(task => task.state === 'active' && task.phase !== 'decode' && task.priority > urgent[0].priority)
        .sort((a,b) => b.priority-a.priority || a.order-b.order);
      const currentSlots = Math.min(policy.concurrency,urgent.filter(task => task.priority <= 0).length);
      const urgentSlots = Math.min(policy.concurrency,urgent.length);
      const networkUrgent = urgent.filter(task => !this.localOnly(task));
      const currentTransferSlots = Math.min(policy.concurrency,networkUrgent.filter(task => task.priority <= 0).length);
      const urgentTransferSlots = Math.min(policy.concurrency,networkUrgent.length);
      let availableTransfers = Math.max(0,policy.concurrency-[...this.active].filter(usesTransferSlot).length);
      for (const victim of victims) {
        // Only a current consumer can preempt another card/recent face. Nearby
        // warming may preempt collection jobs, preserving rapid reversal reuse.
        const collection = victim.collectionRequested && victim.priority >= 100;
        const needsTaskSlot = available < currentSlots || available < urgentSlots && collection;
        // Stored-image work has its own task allowance. A free local slot must
        // not hide an occupied transfer slot on a restricted connection.
        const occupiesTransfer = !victim.startedLocalOnly;
        const needsTransferSlot = occupiesTransfer && (availableTransfers < currentTransferSlots || availableTransfers < urgentTransferSlots && collection);
        if (!needsTaskSlot && !needsTransferSlot) continue;
        this.metrics.preempted++; victim.state = 'cancelling'; victim.controller.abort(); available++;
        if (occupiesTransfer) availableTransfers++;
      }
    }
    for (const task of queue) {
      if (this.active.size >= policy.taskConcurrency) break;
      const localOnly = this.localOnly(task);
      if (!localOnly && [...this.active].filter(usesTransferSlot).length >= policy.concurrency) continue;
      if (task.priority >= 100) {
        if (this.now() < this.nextCollectionStartAt) { this.scheduleCollectionPump(); continue; }
        if ([...this.pending.values()].some(item => item !== task && this.wantsDecoded(item))) continue;
        if ([...this.active].filter(item => item.startedAsCollection).length >= this.collectionConcurrency) continue;
      }
      const speculative = task.priority > 0 && !task.subscribers.size;
      const allSpeculative = [...this.active].filter(item => item.priority > 0 && !item.subscribers.size);
      const runningSpeculative = allSpeculative.filter(item => localOnly ? item.startedLocalOnly : !item.startedLocalOnly).length;
      const allowedSpeculative = task.collectionRequested && this.collectionRunnable() ? this.collectionConcurrency : localOnly ? policy.localSpeculative : policy.speculative;
      if (speculative && (runningSpeculative >= allowedSpeculative || allSpeculative.length >= Math.max(1,policy.taskConcurrency-1))) continue;
      void this.run(task);
    }
    this.emitStatus();
  }
  async run(task) {
    task.state = 'active'; task.controller = new AbortController(); this.active.add(task);
    task.decodeStartedAt=undefined;
    task.startedAsCollection = !this.wantsDecoded(task); task.startedLocalOnly = this.localOnly(task);
    const spacingUm = this.manifest.spacingUm || this.manifest.sourceSpacingUm || 79.4;
    const signal = task.controller.signal;
    const progress = info => {
      if (signal.aborted) return;
      task.phase = info.stage; task.receivedBytes = info.receivedBytes ?? task.receivedBytes ?? 0;
      if(info.stage==='decode'&&task.decodeStartedAt===undefined)task.decodeStartedAt=this.now();
      for (const subscriber of task.subscribers) safely(subscriber.onProgress,{loaded:0,completed:0,total:1,spacingUm,...info});
      this.emitStatus();
    };
    try {
      const record = task.record, width = record.crop[2], height = record.crop[3];
      let loaded = {data:new Uint8Array(1),receivedBytes:0};
      if (!record.empty) {
        const url = new URL(record.path,this.base); if (record.sha256) url.searchParams.set('v',record.sha256.slice(0,16));
        loaded = await this.loader({url:url.href,record,priority:task.priority,axis:task.axis,index:task.index,decode:this.wantsDecoded(task),localOnly:task.startedLocalOnly}, {signal,onProgress:progress});
        if (loaded.persisted) this.markCollectionStored(url.href);
        if (loaded.encodedOnly) {
          if (loaded.encodedCacheHit) this.metrics.encodedHits++; else this.metrics.networkLoads++;
          if (!loaded.persisted) this.collectionStorageReason = loaded.persistenceReason || 'storage-unavailable';
          if (!this.wantsDecoded(task)) { this.pending.delete(task.key); return; }
          // A current request can join a collection fetch. Decode its already
          // cached bytes; never start a second network request for that image.
          loaded = await this.loader({url:url.href,record,priority:task.priority,axis:task.axis,index:task.index,decode:true},{signal,onProgress:progress});
        }
      }
      checkAbort(signal);
      if (loaded.data.byteLength !== width * height) throw new Error('The decoded scan section has an incorrect pixel count.');
      if(task.decodeStartedAt!==undefined){
        const duration=this.now()-task.decodeStartedAt;
        if(duration>0)this.decodeEstimateMs=.75*this.decodeEstimateMs+.25*Math.max(4,Math.min(200,duration));
      }
      if (!record.empty) { if (loaded.encodedCacheHit) this.metrics.encodedHits++; else this.metrics.networkLoads++; }
      const dims = this.manifest.imageDimensionsXYZ, axis = task.axis;
      const result = {data:loaded.data,width,height,fullWidth:axis === 0 ? dims[1] : dims[0],
        fullHeight:axis === 2 ? dims[1] : dims[2],crop:[...record.crop],axis,index:task.index,
        sourceIndex:(this.manifest.sourceIndexStep || 4) * task.index,key:task.key,
        spacingUm,source:this.manifest.compressionLossless ? 'Hosted measured scan section' : 'Hosted scan display derivative',sourceDtype:this.manifest.sourceDtype || 'uint16',displayDtype:'uint8',
        sourceWindow:[...this.manifest.sourceWindow],sourceScale:this.manifest.sourceScale || 's2',
        compressionLossless:this.manifest.compressionLossless,
        compression:this.manifest.compressionLossless ? 'Lossless WebP' : this.manifest.compression?.name || this.manifest.format,
        maxAbsoluteGrayError:this.manifest.compression?.maxAbsoluteGrayError ?? 0,
        backgroundRestricted:true,cleaned:true,encodedBytes:record.bytes,receivedBytes:loaded.receivedBytes || 0,
        sourceDisplaySha256:record.sourceDisplaySha256,empty:Boolean(record.empty),blocks:record.empty ? 0 : 1};
      this.remember(result); this.pending.delete(task.key);
      for (const subscriber of [...task.subscribers]) {
        subscriber.cleanup(); safely(subscriber.onProgress,{stage:'ready',loaded:1,completed:1,total:1,
          receivedBytes:result.receivedBytes,spacingUm,cached:Boolean(loaded.encodedCacheHit)}); subscriber.resolve(result);
      }
      this.emit({type:'ready',axis:task.axis,index:task.index,result});
    } catch (error) {
      if (error.name === 'CacheMissError' && task.startedLocalOnly && !this.disposed) {
        // A selected subscriber may have joined a disk-only prefetch. Retry that
        // foreground request normally; an unselected miss stays network-free.
        if (this.needed(task) && !this.localOnly(task)) { task.state = 'queued'; task.phase = 'queued'; task.order = ++this.serial; }
        else { this.pending.delete(task.key); this.localMissUntil.set(task.key,this.now()+2000); }
      } else if (error.name === 'AbortError' && this.needed(task) && !this.disposed) {
        task.state = 'queued'; task.phase = 'queued'; task.order = ++this.serial;
      } else {
        this.pending.delete(task.key);
        const observed = task.subscribers.size || task.key === this.focus?.key;
        if (error.name !== 'AbortError') { this.failedUntil.set(task.key,this.now()+30000); this.noteCollectionFailure(task); }
        for (const subscriber of [...task.subscribers]) { subscriber.cleanup(); subscriber.reject(error); }
        if (observed && error.name !== 'AbortError') this.emit({type:'error',axis:task.axis,index:task.index,error});
      }
    } finally {
      if (task.startedAsCollection) this.nextCollectionStartAt = Math.max(this.nextCollectionStartAt, this.now() + this.collectionDelay);
      this.active.delete(task); this.schedulePump(); this.emitStatus();
    }
  }
  dispose() {
    this.disposed = true; clearTimeout(this.idleTimer); clearTimeout(this.recentTimer); clearTimeout(this.collectionRetryTimer); clearTimeout(this.collectionPaceTimer);
    this.unsubscribeActivity?.();
    this.connection?.removeEventListener?.('change',this.onPolicyChange);
    globalThis.document?.removeEventListener?.('visibilitychange',this.onPolicyChange);
    globalThis.removeEventListener?.('online',this.onPolicyChange); globalThis.removeEventListener?.('offline',this.onPolicyChange);
    for (const task of this.pending.values()) {
      task.backgroundPriority = Infinity;
      for (const subscriber of [...task.subscribers]) { subscriber.cleanup(); subscriber.reject(abortError()); }
      task.controller?.abort();
    }
    this.pending.clear(); this.wanted.clear(); this.cache.clear(); this.cacheBytes = 0;
    this.transport?.dispose(); this.listeners.clear();
  }
}

export const hostedSections = new HostedSectionStore();

/** API-compatible replacement for the former raw-N5 streaming loader. */
export class UltraSections {
  constructor(store = hostedSections) { this.store = store; this.waiters = new Set(); }
  async init() { this.manifest = await this.store.init(); return this.manifest; }
  hasCached(axis,index) { return this.store.has(axis,index); }
  cached(axis,index) { return this.store.cached(axis,index); }
  setFocus(axis,index,options) { return this.store.setFocus(axis,index,options); }
  pauseBackground(paused = true) { return this.store.pauseBackground(paused); }
  startCollectionDownload(options) { return this.store.startCollectionDownload(options); }
  pauseCollectionDownload(paused = true) { return this.store.pauseCollectionDownload(paused); }
  resumeCollectionDownload(options) { return this.store.resumeCollectionDownload(options); }
  subscribe(listener) { return this.store.subscribe(listener); }
  getStatus() { return this.store.getStatus(); }
  async canLoadFromCache(axis,index) { await this.init(); return this.hasCached(axis,index); }
  estimate(axis,index) {
    const record = this.store.record(axis,index);
    return {blocks:record.empty ? 0 : 1,estimatedBytes:record.empty ? 0 : record.bytes,
      encodedBytes:record.bytes,cached:this.hasCached(axis,index),hosted:true,rangeOptimized:false,
      width:record.crop[2],height:record.crop[3],spacingUm:this.manifest.spacingUm || this.manifest.sourceSpacingUm || 79.4,compressionLossless:this.manifest.compressionLossless};
  }
  async load(axis,index,{signal,onProgress,cacheOnly = false} = {}) {
    checkAbort(signal);
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort',abort,{once:true}); this.waiters.add(abort);
    if (signal?.aborted) abort();
    try {
      await this.init(); checkAbort(controller.signal);
      return await this.store.load(axis,index,{signal:controller.signal,onProgress,cacheOnly,priority:0});
    }
    finally { signal?.removeEventListener('abort',abort); this.waiters.delete(abort); }
  }
  cancel() { for (const abort of [...this.waiters]) abort(); }
  dispose() { this.cancel(); }
}
