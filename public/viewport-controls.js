/** Keep the shared 3D canvas clear when its own pane has limited room.
 * Controls are moved, never copied: their state and existing listeners survive
 * resizing, fullscreen and the Reconstruction / Echo / TTE / TEE workspaces.
 */
export function needsCompactControls(width, height) {
  return width > 0 && height > 0 && (width <= 850 || height <= 550);
}

export function mountViewportControls(doc = globalThis.document, view = doc?.defaultView) {
  const viewport = doc?.getElementById('viewport');
  if (!viewport || !view || viewport.dataset.compactControlsReady) return () => {};
  viewport.dataset.compactControlsReady = 'true';

  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'viewport-menu-toggle';
  toggle.hidden = true;
  toggle.setAttribute('aria-label', '3D View Controls');
  toggle.setAttribute('title', '3D View Controls');
  toggle.setAttribute('aria-haspopup', 'dialog');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'viewportControlMenu');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9 3v6m6 0v6M9 15v6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';

  const menu = doc.createElement('section');
  menu.id = 'viewportControlMenu';
  menu.className = 'viewport-control-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', '3D View Controls');
  menu.innerHTML = '<div class="viewport-control-menu-header"><strong>3D View Controls</strong><button class="viewport-menu-close" type="button" aria-label="Close 3D View Controls">×</button></div><div class="viewport-control-menu-body"></div>';
  const content = menu.querySelector('.viewport-control-menu-body');
  const closeButton = menu.querySelector('.viewport-menu-close');
  viewport.append(menu, toggle);

  const originals = new Map();
  let labControls = null;
  let host = viewport.parentElement;
  let compact = false;
  let frame = null;
  let stopped = false;

  const move = node => {
    if (!node || originals.has(node)) return;
    const marker = doc.createComment('3D control position');
    node.before(marker);
    originals.set(node, marker);
    content.append(node);
  };
  const restore = node => {
    const marker = originals.get(node);
    if (!marker) return;
    marker.replaceWith(node);
    originals.delete(node);
  };
  const close = (returnFocus = false) => {
    const wasOpen = !menu.hidden;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    for (const details of menu.querySelectorAll('details[open]')) details.removeAttribute('open');
    if (returnFocus && wasOpen && !toggle.hidden) toggle.focus({ preventScroll: true });
  };
  const update = () => {
    frame = null;
    if (stopped) return;
    if (host !== viewport.parentElement) {
      close();
      if (labControls) restore(labControls);
      labControls = null;
      host = viewport.parentElement;
    }
    const { width, height } = viewport.getBoundingClientRect();
    // A temporarily hidden workspace has no useful dimensions. Its next
    // ResizeObserver notification will supply the visible pane size.
    if (!(width > 0 && height > 0)) return;
    const next = needsCompactControls(width, height);
    if (next !== compact) {
      const focused = doc.activeElement;
      close();
      compact = next;
      viewport.classList.toggle('viewport-controls-compact', compact);
      toggle.hidden = !compact;
      if (compact) {
        for (const selector of ['.viewport-heading', '.viewer-controls', '.viewport-bottom']) move(viewport.querySelector(selector));
        if (focused && menu.contains(focused)) toggle.focus({ preventScroll: true });
      } else {
        for (const node of [...originals.keys()]) restore(node);
        labControls = null;
        if (focused === toggle || focused === closeButton) doc.getElementById('volumeCanvas')?.focus({ preventScroll: true });
        else if (focused && viewport.contains(focused)) focused.focus({ preventScroll: true });
      }
    }
    // TEE starting views are an overlay beside the shared viewport. TTE's
    // starting views live outside the canvas and deliberately stay there.
    if (compact && host?.id === 'teeViewportMount' && !labControls) {
      labControls = [...host.children].find(node => node.classList.contains('workspace-starting-views')) || null;
      move(labControls);
    }
  };
  const schedule = () => {
    if (frame === null && !stopped) frame = view.requestAnimationFrame(update);
  };
  const onToggle = () => {
    if (!menu.hidden) return close(true);
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    closeButton.focus({ preventScroll: true });
  };
  const onClose = () => close(true);
  const onPointer = event => {
    if (!menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) close();
  };
  const onKey = event => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };
  const onFocus = event => {
    if (!menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) close();
  };
  // These actions are used in the scene or below the viewer. Reveal their
  // result immediately instead of keeping the compact menu in the way.
  const onAction = event => {
    if (event.target.closest?.('#openReconstructionDetail, #measureDistance, [data-anatomy-context-toggle]')) close();
  };
  toggle.addEventListener('click', onToggle);
  closeButton.addEventListener('click', onClose);
  menu.addEventListener('click', onAction);
  doc.addEventListener('pointerdown', onPointer, true);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('focusin', onFocus);
  view.addEventListener('resize', schedule);
  doc.addEventListener('fullscreenchange', schedule);

  const resize = view.ResizeObserver ? new view.ResizeObserver(schedule) : null;
  resize?.observe(viewport);
  const observed = new WeakSet();
  const observeMounts = () => {
    for (const node of doc.querySelectorAll('#reconstructionWorkspace, #echoPanel, #probePanel, #teePanel, #echoViewportMount, #probeViewportMount, #teeViewportMount')) {
      if (!observed.has(node)) {
        mutation?.observe(node, { childList: true });
        observed.add(node);
      }
    }
  };
  const mutation = view.MutationObserver ? new view.MutationObserver(records => {
    // A lazily inserted lab template supplies its mount once. Do not observe
    // its subtree: live ultrasound/probe status text can change every frame.
    observeMounts();
    if (host !== viewport.parentElement || records.some(record => record.target === host && [...record.addedNodes].some(node => node.nodeType === 1 && node.classList.contains('workspace-starting-views')))) schedule();
  }) : null;
  observeMounts();
  update();

  return () => {
    stopped = true;
    if (frame !== null) view.cancelAnimationFrame(frame);
    resize?.disconnect();
    mutation?.disconnect();
    close();
    for (const node of [...originals.keys()]) restore(node);
    toggle.removeEventListener('click', onToggle);
    closeButton.removeEventListener('click', onClose);
    menu.removeEventListener('click', onAction);
    doc.removeEventListener('pointerdown', onPointer, true);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('focusin', onFocus);
    view.removeEventListener('resize', schedule);
    doc.removeEventListener('fullscreenchange', schedule);
    viewport.classList.remove('viewport-controls-compact');
    delete viewport.dataset.compactControlsReady;
    menu.remove();
    toggle.remove();
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountViewportControls(), { once: true });
  else mountViewportControls();
}
