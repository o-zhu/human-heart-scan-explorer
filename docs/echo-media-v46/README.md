# Echo reference media loading and stable layout

Reviewed November 9, 2026. This update changes selection and presentation of
existing reference media; it adds no media files and changes no source pixels,
recorded frames, attribution, or acquisition correspondence.

## Fast references with explicit reuse terms

The first selected example now uses an existing, locally hosted movie for six
matched TTE acquisitions: PLAX, papillary short axis, apical four/two/three
chamber, and subcostal four chamber. These six 624 × 480 CardioNetworks movies
total 1,753,195 bytes. Four named TEE examples also use the existing local
Nazerian et al. movies: ME four chamber, long axis, two chamber, and bicaval.
The long-axis title retains its **color Doppler** qualification.

`localEchoReference()` uses an explicit acquisition/asset map, checks the
catalog's named-view correspondence, local collection URL, reuse-license
label, size, and hash metadata. Actual delivery continues through the existing
bounded media cache, including its byte-length and available SHA-256 checks.
No remote player or YouTube connection is started for a local default. All
original source alternatives and links remain available. A refreshed catalog
preserves the current selection when that source is still present.

The default map intentionally excludes specialized zooms, increased-depth
views, sweeps, the noncommercial POCUS Atlas mitral sweep, and the broader
transgastric short-axis example whose exact midpapillary level is unverified.
It does not turn a general acquisition into a more specific one. Source loops
remain independent recordings, not images registered to the donor CT.

When a remote source is selected, its required origins receive deduplicated
preconnect hints. A matched **Play Local Example** action is offered during
loading or failure. Switching stops and destroys the old player and rejects
its late events. It never silently replaces an explicitly selected source.
YouTube API/player startup and buffering retain their existing bounded
watchdogs and retry path.

## Layout behavior

The media viewport already has an explicit shared height. Its iframe now has
absolute 100% sizing from creation, before asynchronous player/style loading;
the base Echo stylesheet also locks the frame to that box. API width/height
attributes cannot resize the surrounding grid. Loading text remains an overlay.

A fixed 36 px status slot remains in layout through loading, playback,
buffering, error, retry and source replacement. Only its contents are hidden.
Text can truncate within the slot; progress and action controls cannot add a
new flex row. The production workspace-height controller observes and measures
that fixed slot unconditionally; measuring the hidden/visible inner loader
would otherwise resize both canvases by 44 px on player state changes. A legacy
template without the slot retains the earlier visible-loader fallback.
The later Fit Ultrasound default uses each source's existing reviewed
`focusAspect` crop. Full Frame is still an explicit option for that selection;
source/view changes restore Fit. Retries preserve the chosen framing, while
ordinary updates and framing changes do not reload playback. Sources without
reviewed crop
metadata, including the local TEE/TTE examples, remain uncropped and contained
within the same stage. Decoded pixel-aspect ratios, original video bytes and
source-matched reference-angle placement remain unchanged. The existing 1.4
TEE crop retains all 26 native dial bounds reviewed in v56.

## Why the TECHmED YouTube videos remain embeds

The existing catalog records 30 TECHmED YouTube sources with no established
redistribution license. Their public source pages establish named acquisition
and embedding, not a grant to download and redistribute the recordings.
Direct watch-page retrieval was unavailable during this review; no claim is
made that the individual videos' licenses were conclusively verified as
Standard License. No new redistribution permission was established.

YouTube's official license help distinguishes its default Standard License
from CC BY, and its copyright guidance states that credit alone does not grant
reuse rights. The source embeds therefore remain available. The project's
software license does not change upstream media rights.

The six CardioNetworks examples have explicit CC BY-SA 3.0 permission recorded
on their Wikimedia Commons file pages, including VRT confirmation. Preserve
their attribution, license link, modification notice, and share-alike terms
when redistributing adaptations. Nazerian et al.'s article and supplementary
movies use CC BY 4.0, subject to the article's third-party-credit qualification.
Existing metadata and media-license files remain authoritative for the exact
source and conversion details.

Sources inspected:

- [YouTube license types](https://support.google.com/youtube/answer/2797468?hl=en)
- [YouTube copyright myths: attribution alone](https://support.google.com/youtube/answer/2797449/frequently-asked-copyright-questions?hl=en)
- [YouTube terms](https://www.youtube.com/t/terms)
- [TECHmED PLAX source](https://www.techmed.sk/en/echo/view/01/)
- [CardioNetworks PLAX](https://commons.wikimedia.org/wiki/File:PLAXnormal_(CardioNetworks_ECHOpedia).webm)
- [CardioNetworks papillary short axis](https://commons.wikimedia.org/wiki/File:SAXPAP_normal_(CardioNetworks_ECHOpedia).webm)
- [CardioNetworks A4C](https://commons.wikimedia.org/wiki/File:A4C_normal_(CardioNetworks_ECHOpedia).webm)
- [CardioNetworks A2C](https://commons.wikimedia.org/wiki/File:A2Cnormal_(CardioNetworks_ECGpedia).avi.webm)
- [CardioNetworks A3C](https://commons.wikimedia.org/wiki/File:A3Cnormal_(CardioNetworks_ECGpedia).avi.webm)
- [CardioNetworks subcostal](https://commons.wikimedia.org/wiki/File:Subcostal_normal_(CardioNetworks_ECHOpedia).webm)
- [Nazerian et al., 2020: TEE training and supplementary movies](https://doi.org/10.1186/s13089-020-00189-0)

EchoNet-Dynamic was considered and rejected for redistribution: its official
[research-use agreement](https://echonet.github.io/dynamic/) requires specific
written permission to distribute any portion, and the published videos are
112 × 112 pixels. Public research access is not a redistribution license.

## Focused verification

```sh
node tests/echo-media-loading-v46.mjs /absolute/path/to/linkedom/esm/index.js
node tests/echo-reference-player-v39.mjs /absolute/path/to/linkedom/esm/index.js
node tests/tte-atlas-ui.mjs /absolute/path/to/linkedom/esm/index.js
node tests/tee-atlas-ui.mjs /absolute/path/to/linkedom/esm/index.js
node tests/echo-angle-placement-v41.mjs /absolute/path/to/linkedom/esm/index.js
node tests/workspace-layout-v35.mjs /absolute/path/to/linkedom/esm/index.js
node --test tests/echo-v6-media-cache.test.mjs
```

The v46 regression uses production selection/controller logic, actual local
movie bytes, controlled media elements and a controlled YouTube API. It checks
local preference and exclusions, original alternatives and credits, catalog
refresh, retries, local fallback, stale remote events, connection-hint reuse,
and invariant iframe/status-slot contracts. These DOM checks do not establish
real third-party playback, browser layout-shift metrics, or device frame rates.
The workspace regression executes the real `fitComparisonWorkspaces()` against
production templates and controlled rectangles, proving equal canvas-height
values through initial/loading/playing/buffering/retry states, including an
unrelated resize in the same turn.

All listed checks passed in the implementation session. An additional run of
the historical `echo-v6-ui.mjs` failed before its media assertions because its
old fixture does not define `cancelAnimationFrame`, which the current overlay
constructor requires. The same failure was reproduced against the unchanged
v80 checkout. It was not counted as a passing check; current player-v39 and
TTE/TEE controller suites cover the active media lifecycle.
