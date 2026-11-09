# Mobile reconstruction startup

## Diagnosis

The v39 resource policy already selected the smaller `detail` surface on
phones and touch-capable iPads. However, startup still read the shared v25
surface preference. An old explicit `volume` choice therefore prevented the
new mobile surface and its reviewed cavity cleanup from starting at all.

A second startup race occurred when the lazy surface controller initialized
after the user had opened Echo or a Lab. It correctly avoided changing that
workspace's threshold, but did not later normalize the untouched Reconstruction
threshold. The smaller mesh could finish loading on return and remain inactive
at the original volume threshold of 0.32 instead of its fixed 0.28.

## Changes

- Mobile choices now use `heart-explorer:surface:mobile:v43:<donor>`. With no
  choice in that namespace, the existing device policy loads Mobile Detail
  automatically. The old desktop preference is untouched. New explicit mobile
  choices, including Interactive Volume and cancellation, remain persistent.
- If initialization occurs in another workspace, the untouched mobile startup
  threshold is adopted once when Reconstruction resumes. The app restores its
  Reconstruction settings before this callback. A bookmark, customized setting,
  or explicit later surface choice cannot be overwritten by the deferred default.
- Activation still waits for the existing reviewed mobile cavity masks. Source
  data, smaller-mesh geometry, masks, memory ceilings, desktop local surfaces,
  cancellation, and other donors are unchanged.

## Verification

```sh
node tests/fine-surface-controller-v19.mjs /path/to/linkedom/esm/index.js
node --test tests/device-resources.mjs tests/mobile-resource-integration.mjs tests/mobile-lumen-v41.mjs
```

All 53 surface lifecycle checks and 18 resource/cleanup checks pass. New cases
exercise legacy-volume migration on iPhone, desktop-identified iPad and a
low-memory Android phone; actual default decoding and cleanup-gated activation;
independent preference persistence; unchanged low-memory desktop preference;
paused startup and return from Echo/Labs; and bookmarked, custom and cancelled
defaults. Existing checks cover no-WebGL fallback, asset identity/budgets,
transactional cleanup, stale results and retained source arrays.

The controller suite uses real production controllers with DOM, GPU and worker
fixtures. It does not claim a physical iPhone/iPad performance measurement.
