/** Compact navigation changes presentation only. Existing controls, players and
 * their listeners are moved as whole nodes and restored at their original sites. */
export function echoCompactLayout({width = 0, height = 0, coarse = false} = {}) {
  return {
    compact: (width > 0 && width <= 1050) || (height > 0 && height <= 760) || coarse,
    phone: width > 0 && width <= 600,
  };
}

export function mountEchoCompactWorkspace({mount, presets, getState, onSelect, onLayout = () => {}, view = mount.ownerDocument.defaultView}) {
  const doc = mount.ownerDocument;
  const find = name => mount.querySelector(`[data-echo="${name}"]`);
  const navigation = find('compact-navigation');
  const selector = find('compact-view');
  const library = mount.querySelector('.echo-library');
  const settings = find('compact-settings');
  const browse = find('compact-browse');
  const settingsToggle = find('compact-settings-toggle');
  const anatomy = mount.querySelector('.echo-view-column');
  const ultrasound = mount.querySelector('.echo-cine');
  const approach = mount.querySelector('.echo-approach');
  const originals = new Map();
  const listeners = [];
  // A tablet may have a trackpad as its primary pointer and still need a compact
  // touch workspace. Pointer capability never changes model/detail policy.
  const pointer = view?.matchMedia?.('(any-pointer: coarse)');
  let compact = false, phone = false, selectedPane = null, catalogMode = null;
  let stopped = false, frame = null;
  const listen = (node, type, handler, options) => {
    node?.addEventListener?.(type, handler, options);
    listeners.push(() => node?.removeEventListener?.(type, handler, options));
  };
  const move = (node, destination) => {
    if (!node || originals.has(node)) return;
    const marker = doc.createComment('Echo control position');
    node.before(marker);
    originals.set(node, marker);
    destination.append(node);
  };
  const restore = () => {
    // Reverse order also restores nested nodes safely.
    for (const [node, marker] of [...originals].reverse()) marker.replaceWith(node);
    originals.clear();
  };
  const close = (returnFocus = false) => {
    const wasLibrary = compact && !library.hidden;
    const wasSettings = !settings.hidden;
    library.hidden = compact;
    settings.hidden = true;
    browse.setAttribute('aria-expanded', 'false');
    settingsToggle.setAttribute('aria-expanded', 'false');
    if (returnFocus && (wasLibrary || wasSettings)) (wasLibrary ? browse : settingsToggle).focus({preventScroll: true});
  };
  const positionMenus = () => {
    if (!compact) return;
    const viewportHeight = view?.visualViewport?.height || view?.innerHeight || 800;
    const top = Math.max(8, Math.min(navigation.getBoundingClientRect().bottom + 6, viewportHeight - 100));
    mount.style.setProperty('--echo-compact-menu-top', `${Math.round(top)}px`);
    mount.style.setProperty('--echo-compact-menu-height', `${Math.max(80, Math.floor(viewportHeight - top - 10))}px`);
  };
  const open = name => {
    if (!compact) return;
    const target = name === 'library' ? library : settings;
    const alreadyOpen = !target.hidden;
    close();
    if (alreadyOpen) return;
    positionMenus();
    target.hidden = false;
    (name === 'library' ? browse : settingsToggle).setAttribute('aria-expanded', 'true');
    (name === 'library' ? find('search') : find('compact-settings-close')).focus({preventScroll: true});
  };
  const applyPane = () => {
    const pane = compact ? (selectedPane || (phone ? 'anatomy' : 'both')) : 'both';
    anatomy.hidden = pane === 'ultrasound';
    ultrasound.hidden = pane === 'anatomy';
    if (mount.dataset.echoVisiblePane !== pane) mount.dataset.echoVisiblePane = pane;
    for (const button of mount.querySelectorAll('[data-echo-pane]')) button.setAttribute('aria-pressed', String(button.dataset.echoPane === pane));
  };
  const sync = () => {
    const state = getState();
    if (catalogMode !== state.mode) {
      selector.replaceChildren(...presets.filter(preset => preset.mode === state.mode).map(preset => {
        const option = doc.createElement('option');
        option.value = preset.id;
        option.textContent = `${preset.code} · ${preset.shortName || preset.name}`;
        return option;
      }));
      catalogMode = state.mode;
    }
    selector.value = state.preset;
    selector.setAttribute('aria-label', `${state.mode.toUpperCase()} Reference View`);
    applyPane();
  };
  const update = () => {
    frame = null;
    if (stopped) return;
    const next = echoCompactLayout({width: view?.innerWidth, height: view?.innerHeight, coarse: !!pointer?.matches});
    const changed = compact !== next.compact || phone !== next.phone;
    if (compact !== next.compact) {
      const focused = doc.activeElement;
      close();
      compact = next.compact;
      navigation.hidden = !compact;
      find('compact-library-close').hidden = !compact;
      mount.classList.toggle('echo-compact', compact);
      if (compact) {
        move(approach, find('compact-approach'));
        move(mount.querySelector('.echo-active-view nav'), find('compact-library-actions'));
        const model = find('compact-model-controls');
        const reference = find('compact-reference-controls');
        for (const selector of ['.echo-panel-toolbar', '.echo-probe-options', '.echo-region-legend', '.echo-tissue-caption', '.echo-model-details', '.echo-section-hint']) move(anatomy.querySelector(selector), model);
        move(find('align'), model);
        const anatomyScreen = anatomy.querySelector('.echo-comparison-screen');
        const ultrasoundScreen = ultrasound.querySelector('.echo-comparison-screen');
        // These are the original headings and status/actions. Keeping them in
        // the visual's stable box removes extra rows without replacing a player.
        move(anatomy.querySelector('.echo-scene-heading'), anatomyScreen);
        move(anatomy.querySelector('.echo-mpr-caption'), anatomyScreen);
        move(ultrasound.querySelector('.echo-section-heading'), ultrasoundScreen);
        move(ultrasound.querySelector('.echo-cine-status-slot'), ultrasoundScreen);
        for (const selector of ['.echo-panel-toolbar', '.echo-cine-playback', '.echo-cine-credit']) move(ultrasound.querySelector(selector), reference);
        move(mount.querySelector('.echo-detail-fold'), find('compact-plane-controls'));
        library.hidden = true;
        if (focused && (library.contains(focused) || settings.contains(focused))) (library.contains(focused) ? browse : settingsToggle).focus({preventScroll: true});
      } else {
        restore();
        library.hidden = false;
        if (focused && navigation.contains(focused)) (mount.querySelector(`[data-preset="${getState().preset}"]`) || approach.querySelector('[aria-pressed="true"]'))?.focus({preventScroll: true});
      }
    }
    phone = next.phone;
    mount.classList.toggle('echo-phone', phone);
    sync();
    positionMenus();
    if (changed) onLayout();
  };
  const schedule = () => {
    if (stopped || frame !== null) return;
    if (view?.requestAnimationFrame) frame = view.requestAnimationFrame(update);
    else update();
  };
  listen(browse, 'click', () => open('library'));
  listen(settingsToggle, 'click', () => open('settings'));
  listen(find('compact-library-close'), 'click', () => close(true));
  listen(find('compact-settings-close'), 'click', () => close(true));
  listen(selector, 'change', () => onSelect(selector.value));
  for (const button of mount.querySelectorAll('[data-echo-pane]')) listen(button, 'click', () => {
    selectedPane = button.dataset.echoPane;
    close();
    applyPane();
    onLayout();
  });
  const outside = event => {
    if (!compact || (library.hidden && settings.hidden)) return;
    if (!library.contains(event.target) && !settings.contains(event.target) && !browse.contains(event.target) && !settingsToggle.contains(event.target)) close();
  };
  listen(doc, 'pointerdown', outside, true);
  listen(doc, 'focusin', outside);
  listen(doc, 'keydown', event => {
    if (event.key === 'Escape' && compact && (!library.hidden || !settings.hidden)) {
      event.preventDefault();
      close(true);
    }
  });
  listen(view, 'resize', schedule);
  listen(view?.visualViewport, 'resize', schedule);
  listen(doc, 'fullscreenchange', schedule);
  listen(pointer, 'change', schedule);
  update();
  return {
    get compact() { return compact; },
    sync,
    close,
    selectionChanged() {
      sync();
      if (!compact) return false;
      close();
      selector.focus({preventScroll: true});
      return true;
    },
    destroy() {
      if (stopped) return;
      stopped = true;
      if (frame !== null) view?.cancelAnimationFrame?.(frame);
      for (const remove of listeners) remove();
      close();
      restore();
      library.hidden = false;
      anatomy.hidden = false;
      ultrasound.hidden = false;
      navigation.hidden = true;
      find('compact-library-close').hidden = true;
      mount.classList.remove('echo-compact', 'echo-phone');
      delete mount.dataset.echoVisiblePane;
    },
  };
}
