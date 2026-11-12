# Stable TTE and TEE rendering during camera and probe motion

The earlier Reconstruction camera fix distinguished camera-only changes from
volume scene edits. Camera changes kept the settled rendering grid; actual
threshold/mode changes used the bounded interaction path. The lab oblique
section was not recognized by that stable-section condition, so probe and
cut-plane changes could immediately select the coarse scene budget.

`renderer.js` now recognizes a section surface when it is either an orthogonal
Reconstruction section or an oblique cut in the `probe`/`tee` render profile.
`app.js` carries the actual workspace profile into the renderer. Both direct
settings updates and camera alignment use this same condition. Probe motion,
pan, release and late fine-cap installation keep the settled output grid and
sampling uniforms, while threshold and display-mode changes retain the existing
bounded scene-edit path. A late cap still belongs to the current accepted plane.

The output ceiling remains 1.5 million pixels on Auto and 2.6 million on High
for these interactive lab profiles, with the existing device constraints. The
full reconstruction profile retains its own settings. No shader, source scalar
value, source plane, cap transfer, donor data or spatial registration changed.

The one-frame GPU fence remains authoritative. While it is busy, repeated
motions replace the queued target with the newest pose; they do not enqueue
older renders or trigger a temporary resolution downgrade. Higher detail can
cost frame rate on slower devices, so no particular FPS is promised.

## Verification

The focused renderer suite uses the production scheduling code and a controlled
WebGL implementation. It checks both lab profiles, oblique cuts, identical
settled/moving uniforms, pan/release/late caps, 24 newer poses during a busy GPU
frame, bounded threshold changes, preserved custom thresholds and constrained
device quality settings. Existing camera, response, latency and touch checks
remain included.

```sh
node --test tests/renderer-camera-v17.mjs tests/renderer-responsiveness-v16.mjs \
  tests/renderer-latency-v15.mjs tests/echo-camera-tracking-v17.mjs \
  tests/camera-touch-v40.mjs
```

The implementation session passed all 58 checks above and 18 application-boot
checks. These fixtures establish rendering policy and lifecycle behavior; they
do not establish physical browser FPS, real-device GPU behavior or clinical
validation. Native/browser observations are reported separately for the release.
