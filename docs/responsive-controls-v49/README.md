# Responsive controls and visual space — v49

This presentation update responds to oversized small-window controls, missing
page-tab labels, crowded Echo comparisons and phone steering callouts. It is
delivered as update v0084 after the sequential Ultra release v0083. Geometry,
cleanup, fidelity, download scheduling and media assets are unchanged.

## Shared navigation

An older rule hid every span in the page tabs below 760px. The previous compact
override restored labels only in Echo and the labs. Reconstruction therefore
showed four blank buttons. Explicit short-label visibility now applies to all
four tabs, retaining the full accessible page names. Wide desktop layouts
restore the full visible names.

Compact presentation responds to width at or below 1050px, height at or below
760px, or any coarse pointer. Shared `clamp()` type tokens vary within bounded
readable sizes. Main controls use 36px height for precise pointers and 44px for
touch-capable devices, including tablets with a trackpad. Native editable
controls retain 16px text where needed. Important scoped rules supersede the
older global sizes without changing the desktop design or disabling user zoom.

Reconstruction now shares the compact source selector and header. Source cards
collapse only after the working disclosure is initialized, preserving ordinary
navigation if that helper cannot start. All five sources and their information
buttons remain available. Short landscape puts source/actions and page tabs
in one row.

## Echo visual area

Compact “3D Anatomy” and “Real Ultrasound” headings are overlays inside their
existing screens. Retry and the fixed media-status slot move inside too. These
are the original nodes, restored to their exact desktop locations on exit.
Neither the player nor renderer is recreated by layout changes.

Resolution/quality, CT correspondence and reference-label checking now live
inside optional Model Details or Source Details instead of the main comparison.
The independent-recording qualifier and source attribution stay visible.
Genuine anatomy alerts and applicable angle notes still reserve outside space.

The workspace fitter ignores in-screen overlays when calculating usable height.
It continues to measure outside source/alert rows and bases a stacked pair on
the first screen, avoiding feedback from the second screen's moving position.
Loading, retry, playback and floating Settings do not resize the visual pair.
See [the Echo contract](../mobile-echo-v47/README.md).

## Labs and held controls

With Both selected, opening Steer puts the visuals in two columns on compact
phones and portrait tablets. Closing restores the ordinary arrangement. An
explicit 3D Heart, Image or Chest selection is preserved. On very narrow phones,
either single-pane choice still provides a larger individual view.

The dock uses tighter spacing and smaller keys while preserving arrow/action
labels. TEE Lock and Reset share a row. Optional controls remain expandable and
scrollable. See [lab layout details](labs.md).

Selection, dragging and native callout suppression apply only to steering keys,
the pad and their descendants. Cancelable long-press menus are suppressed while
the intended hold continues; an uncancelable menu releases motion. Pointer
ownership, failed capture recovery, page suspension and release behavior are
covered in [the gesture contract](../mobile-steering-v49/README.md).

## Verification performed

- 64 framework-counted tests passed across compact navigation (4), workspace
  fitting (16), compact labs (13), TTE keyboard/hold controls (15) and TEE
  keyboard/hold controls (16).
- Five integration scripts passed: compact Echo, media lifecycle, reference
  player, TTE atlas and TEE atlas. These scripts have no aggregate framework
  count; the TTE atlas reported all eight scenarios, and the TEE atlas all 28
  selections plus lifecycle checks.
- All seven changed JavaScript modules passed syntax checks; whitespace checks
  passed. No scientific source asset, hosting bank or dependency changed.
- Actual Chromium browser review used the production application in a temporary
  resizing frame at 320x568, 390x844, 600x600, 820x1180, 844x390 and 1440x1000.
  No horizontal document overflow was observed in the settled measured cases.
  Page names remained visible, desktop names restored, both lab views shared a
  row with Steer, explicit Image mode stayed selected, and the tablet returned
  to stacked Both when Steer closed. All five compact source choices remained
  available through keyboard-operable disclosure.
- At 390x844, the compact fine-pointer header was 44px, tabs 36px, and primary
  Echo controls 36px with a 16px native view selector. The paired TTE visuals
  measured about 180x451px each with its 175px dock fitting below. At 320x568,
  all ten TTE steering keys remained reachable in the scrolling dock.
- A held TEE Advance control changed the displayed depth, released its active
  state and stopped afterward. Physical touch/iOS callouts were not available
  in this browser; their application behavior is covered by focused gesture
  tests and scoped WebKit CSS. The remote browser lacked WebGL2 and used the
  application's software fallback. Some preview-only fine asset requests were
  unavailable, so this review is layout/interaction evidence, not GPU or native
  iPad performance validation.

The temporary resizing page is not included in deployed or public source.
