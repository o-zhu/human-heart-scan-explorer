# Dataset details and Echo sidebar — v44

## Change

The former Compare Hearts button and expanding comparison table have been removed.
The site brand now reads Heart Explorer without a Human Organ Atlas subtitle.
Clinical boot no longer tries to update that removed subtitle or comparison button.

Each dataset keeps its direct navigation link. Hovering or focusing the link
opens a fixed-position details popup; a separate `i` button pins the same popup
for touch or keyboard use. Escape, an outside pointer press, or a second press
of the info button dismisses it. Only one popup is open at a time. Opening the
popup cannot change the header or workspace height. Its horizontal position
and maximum height are clamped to the viewport, with internal scrolling when
needed. The footer retains the complete source citations and original-source links.

HOA facts are read directly from `donors.js`: donor age/history, native sample
spacing, Ultra sample spacing, and full scan extent. Scan extent retains the
previous table's `nativeDimensions × nativeSpacingUm` convention, including
surrounding space; it is not a chamber-volume measurement. The two clinical
summaries come from the retained clinical manifests and describe their own
acquisitions, native/stored grids, and known pairing limitations.

The Echo library still fits the available workspace height. Its scrollable view
list now has a 190 px minimum, and the surrounding library can scroll if fixed
header/search/group controls plus that minimum exceed the available height.
This prevents the inner flex list from collapsing to one clipped row on short
desktop windows. Tablet/mobile layouts retain their horizontal view rail.

No source arrays, scan coordinates, acquisition frames, reconstruction geometry,
probe controls, or data-serving indexes are changed by this UI update.

## Validation

Run each command from the repository root. Substitute an installed LinkeDOM ESM
entry point for `$HEART_DOM_MODULE`:

```sh
node tests/dataset-citations-v33.mjs "$HEART_DOM_MODULE"
node tests/app-boot-v8.mjs "$HEART_DOM_MODULE"
node tests/clinical-ui-v19.mjs "$HEART_DOM_MODULE"
node tests/workspace-layout-v35.mjs "$HEART_DOM_MODULE"
node tests/explorer-layout-v33.mjs "$HEART_DOM_MODULE"
```

All 53 checks passed in the prepared checkout. The citation suite checks exact
source facts, valid navigation, independent info-button behavior, one open
popup, viewport positioning, Escape/outside dismissal, and repeat initialization.
The app and clinical suites execute actual controller code with controlled
transport/rendering fixtures. Layout suites exercise the production workspace
sizing controllers with controlled rectangles.

These are DOM/controller checks, not a browser pixel-layout or physical-device
measurement. The release owner must record any browser review separately.
