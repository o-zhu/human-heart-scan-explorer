# Compact Echo Windows — v47 with v49 density refinements

## Presentation changes

Echo uses compact presentation at a window width of 1,050 CSS pixels or less, a
window height of 760 CSS pixels or less, or when any available pointer is coarse
(`any-pointer: coarse`, including a touch tablet with a primary trackpad).
These thresholds affect interface presentation only. They do not select a donor,
volume resolution, cleanup policy, acquisition plane, movie or image quality.

The large reference library becomes an optional, searchable **Views** overlay.
The starting row keeps the existing TTE/TEE buttons, a native selector containing
all 28 views in the selected approach, the library button, and one Echo Settings
button. Search groups, illustrations, previous/next navigation, the enlarged
illustration and original guideline links remain in the existing library.

Phones at 600 CSS pixels or less initially show one large Anatomy pane. An
Anatomy / Ultrasound / Both switch selects the visible panes; Both stacks the two
panes on phones. Tablets and short desktop windows initially show Both. Portrait
tablets at 900 CSS pixels or less stack the pair to give landscape ultrasound
more width; landscape tablets and short desktop windows show it side by side.
Portrait tablets retain their single-row navigation and do not become phone
layouts. An explicit pane choice survives later compact layout changes.
Returning to a large desktop shows the established paired workspace and library;
returning to compact presentation restores the chosen compact pane. A user who
has not selected a pane gets the appropriate phone/tablet default on resize.

The original anatomy toolbar, source selector, playback controls, probe options,
model/source details and plane controls move into Echo Settings. They are actual
existing DOM nodes, with their listeners, values and state intact. Original
positions are recorded with comment markers and restored when desktop space
returns. The shared canvas still has its existing 3D View Controls menu, which
owns camera and shared rendering controls independently of Echo.

In compact presentation the original **3D Anatomy** and **Real Ultrasound**
headings move inside their visual boxes. Their status/actions also become
in-screen overlays, reclaiming the formerly separate rows without changing
image size when a movie loads, buffers or fails. The ultrasound heading keeps
a small independent-reference qualifier. Source resolution, CT-correspondence
and reference-match diagnostics live inside optional Model/Source Details at
every width; they no longer occupy the main comparison.
The original source link remains immediately below the ultrasound image. The
full source, license, publisher and donor-correspondence explanations remain
available in Settings; the TEE reference-angle indicator and its explanation
stay with the image. No source catalog, source selection, movie, dataset, index
or geometric correspondence changed in this work.

## Layout and lifecycle contract

- `public/echo-mobile-v47.css` must load after the existing workspace styles.
- The panel gets `echo-compact`, and `echo-phone` when it is at most 600 pixels
  wide. `data-echo-visible-pane` is `anatomy`, `ultrasound` or `both`.
- Inactive `.echo-view-column` / `.echo-cine` sections use the native `hidden`
  attribute. This is a presentation switch; the video element, iframe and media
  request are not replaced or restarted.
- The shared fitter continues to own `--echo-screen-height`. Compact navigation
  is `.echo-compact-navigation`; both phone panes stack when Both is chosen.
  Portrait Both also stacks at width ≤900px and height > width. The fitter must
  split the common screen-height budget for that same portrait-tablet condition;
  the panel remains `echo-compact` without gaining `echo-phone` above 600px.
- Settings toolbar content must not be counted as above-image toolbar height.
  The fitter must only measure displayed panes and their visible footer content.
- Optional context captions and probe-fit notes move with Model Details into
  Settings. The critical `.echo-context-alert` remains below the Anatomy image:
  it reports anatomy loading/failure and unavailable probe poses. Include its
  actual visible height in the footer reserve.
- Compact headings, `.echo-mpr-caption` and `.echo-cine-status-slot` move into
  their existing `.echo-comparison-screen` with comment markers for exact
  desktop restoration. The fitter excludes all such in-screen nodes from its
  footer and stacked-heading reserve. No player node is moved or replaced.
- The outer `.echo-cine-status-slot` is always present. Its compact overlay
  sits above native playback controls and does not intercept input while its
  loading child is hidden. Retry and Play Local Example retain the shared
  control target height. Desktop restores the original v46 36-pixel row.
  Loading, error and retry events cannot change the visual's height.
- The compact source line reserves 26 pixels, including before media metadata
  arrives. Supplemental angle explanations remain visible and contribute their
  actual height when present.
- View selection returns focus to the compact native picker rather than a
  newly hidden gallery card. Escape, outside pointer/focus, switching panes and
  leaving Echo dismiss the overlays. Close buttons return focus to the opener.
- Gallery and Settings are mutually exclusive and scroll within the available
  viewport height. Search and native selectors use 16-pixel input text to avoid
  focus-driven zoom. Main compact buttons follow the shared fluid font and
  control-height variables, with 44-pixel targets for a coarse/touch pointer;
  precise-pointer windows can use the denser control height.
- The native view selector explicitly resets the global 143-pixel select limit
  and disabled native appearance, filling its grid cell and keeping the native
  dropdown indicator on tablets and short desktop windows.
- Resize, pointer-query, fullscreen and visual-viewport listeners are removed
  during destruction. All moved nodes return to their initial locations.

## Focused verification

With LinkeDOM installed outside the project, run:

```sh
node tests/echo-mobile-v47.mjs /absolute/path/to/linkedom/esm/index.js
node tests/echo-media-loading-v46.mjs /absolute/path/to/linkedom/esm/index.js
node tests/echo-reference-player-v39.mjs /absolute/path/to/linkedom/esm/index.js
node tests/tte-atlas-ui.mjs /absolute/path/to/linkedom/esm/index.js
node tests/tee-atlas-ui.mjs /absolute/path/to/linkedom/esm/index.js
```

All five passed again after the v49 density change. The compact suite covers phone,
tablet, short and coarse-pointer classification; explicit pane preferences;
native view selection and approach changes; overlay dismissal and focus return;
control identity, listener retention and exact desktop restoration of headings,
status and controls; optional quality diagnostics; source/iframe/video
continuity through layout changes; and removal of listeners on teardown.

The established media suites verify the ten exact licensed local defaults,
explicit alternative selection across catalog refresh, bounded retry and local
fallback, fresh iframe identity on real source changes, stale-event rejection,
source/license attribution, full-frame playback, reference-angle semantics and
the fixed outer status-row contract. The atlas suites verify all 28 TTE and all
28 TEE selections, camera/plane guards and saved view state.

Actual phone/tablet viewport fit, screenshots and touch-device browser behavior
require the parent integration review. DOM tests do not simulate a mobile GPU,
Safari's native video controls or its virtual keyboard.
