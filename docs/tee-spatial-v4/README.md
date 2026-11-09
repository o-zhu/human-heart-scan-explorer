# TEE spatial presentation, v4

## Requested behavior

The atlas now offers an orientation preference across all 28 TEE views, a
simulated probe for every target, and depth-aware contextual anatomy. These
changes concern spatial presentation. The 24 acquired reviewed CT frames,
regional evidence, original source data, labels, and cleanup assets retain
their existing meanings.

## Orientation

The selector above the comparison panes offers **Align to ultrasound view**
and **Align to upright anatomy**. Ultrasound alignment remains the fresh default.
An explicit choice is remembered locally and included in shared-view state.
Older shared states without an alignment value restore their historical
ultrasound presentation rather than silently adopting a later preference.

Upright framing uses the fixed contextual anatomical frame, target and bounds,
independent of the selected CT plane. Changing TEE presets, including transitions
to and from the outside-scan aortic targets, preserves the established camera
and manual orbit/pan/zoom. Changing Previous/Reviewed fit also preserves it.
Explicit reset or entry into the module restores the fixed upright fit. Plane
edits honor the existing camera-lock control. Switching through TTE correctly
re-establishes the selected TEE orientation on return.

**Face this plane**, clicking the CT image, or pressing Enter on that image
selects ultrasound alignment. **Probe & anatomy** shows the context and selects
upright alignment. Camera selection never changes `getPlane()`, the retained
half, sampled pixels, regional evidence, or the clinical reference movie.

An upright cutaway is naturally oblique, or seen from its retained side, for
some views. The application does not silently reverse the retained half to
make every section face a fixed camera.

## Probe estimates and measured sections

Every atlas entry now supplies a finite illustrative probe pose. Existing
successful fits retain their exact CT-plane coincidence within the authored
tract. When a fit is unresolved, the alternative uses an esophageal or gastric
model sample and targets the regional anatomy, without projecting the probe
out of the tract just to force coincidence with the CT plane.

Independent estimates have an amber dashed sector. Their caption explicitly
distinguishes the modeled sector from the displayed measured CT section.
The four descending-aorta/arch views have illustrative probe positions even
though their target vessels are absent from the heart acquisition. They keep
their outside-scan evidence status and disabled CT-section option.

Displayed centimetres are **model distances**, not measured clinical insertion
depths. Neither a geometrically coincident pose nor a tract estimate constitutes
patient registration, contact/collision validation, or an acoustic acquisition.

## Verification

`tests/tee-spatial-review-v4.mjs` exercises real Echo DOM events and production
camera math for all 28 views in both alignment modes. It checks invariant
upright camera state, unchanged CT frames/retained halves/evidence, manual
exploration across preset and fit changes, locked edits, CT/TTE round trips,
explicit camera actions, legacy/shared state and unavailable local storage.

The existing atlas DOM, CT correspondence and camera-workload checks also pass.
Depth rendering and all-view probe geometry have separate focused evidence
and tests added with this release. Browser verification is performed against
the published build; the managed local preview route was unavailable in this
session.

## Concurrent reconstruction update

This work was merged with the final v29 activation source at
`dbf5eb23c879466be71397163f207ed9786cd379`. Its verified compact display profiles,
source identities, local cleanup, and closed upload code gate are retained.
The final integration run passed all 22 tests for compact transport, local
refinement, and the immutable display store. Depth texture composition is
independent of whether the source mesh arrived through the original or compact
transport.

## Hosted package

Run `python3 scripts/prepare-tee-hosting-v4.py --stage` after the existing
asset staging steps and before the final comparison-display budget check.
The new depth and label modules require a small amount of static-package space.
This step removes only insignificant JSON whitespace from six allowlisted
Echo/TEE and comparison-volume catalog build copies. Source bytes, values, key order, numeric literals,
string escapes and all image/volume payloads remain unchanged. The script
verifies every catalog before writing and records hashes in its staging receipt.
