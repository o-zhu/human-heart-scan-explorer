# Heart Explorer: readable workspace and SlicerHeart entry

This interface update builds on the published v30 interior reconstruction and
TEE spatial presentation v4. It changes presentation, source discovery, and the
initial clinical viewing state. The acquired scan files, reconstruction meshes,
cleanup masks, serving indexes, source coordinate systems, and TEE evidence
catalogs are unchanged.

## Source discovery

The main page now has an **Explore hearts** band with a labeled **Heart dataset**
selector, direct links to all five existing sources, and a prominent **Watch a
beating heart** action for SlicerHeart. Three preserved donors remain distinct
from the independently acquired SlicerHeart and cMAC sources. The initial HOA
dataset has not changed.

`public/dataset-browser.js` initializes the links independently of scan loading.
It uses the established `donorUrl` contract: retain unrelated query parameters,
select the exact source ID, and clear any saved camera/section hash from another
source. The selected source has `aria-current="page"` in the shortcut row.

## Readable, responsive presentation

`public/ui-readability.css` defines shared typography, contrast, focus and input
targets. `public/explorer-ui.css` applies the fluid workspace layout and source
discovery presentation after the existing module styles. The original module
styles also have their small text sizes raised, including narrow-screen rules
and the standalone native/motion viewers.

The old workspace width cap is removed. Reconstruction and CT panels use the
available width; CT cards retain useful image space rather than squeezing all
their controls into tiny rows. Narrower layouts stack the sections below the
heart. Fullscreen continues to include the whole selected workspace and uses
the browser's normal Escape behavior. Image renderers continue to own the
physical aspect ratio and source pixels.

## SlicerHeart behavior

Fresh SlicerHeart entry opens the whole acquired volume upright and starts
measured-phase playback after its initial volume is ready. The source's 20
unique phases remain the loop; the stored closing index 20 duplicates index 0.
The static native reference remains static. The viewing rate is not an inferred
ECG phase duration. Intentional shared clinical views and manual pause remain
supported, and cMAC retains its independent source behavior.

Full sampling and timing qualifications remain available in scan details and
About. No new anatomical segmentation, motion interpolation, or image data is
created by this interface change.

## Verification scope

Verification uses the existing section and clinical DOM/interaction fixtures,
source-navigation checks, CSS parsing and responsive cascade inspection, and a
production build followed by every existing asset staging step. In this session
the managed preview server started, but the computer-use browser backend failed
to connect. Browser-rendered appearance, device-specific frame rates, and
real-device pointer/touch behavior therefore remain unverified.

The focused clinical suite passes 18 checks, including fresh SlicerHeart
autoplay, upright reset, pause during an in-flight frame, stale playback-loop
protection, static-series transitions, cMAC acquisition switching, and shared
views. The section navigation suite passes all three checks. Direct source-link
checks cover all five datasets, and all 13 public stylesheets parse cleanly.
