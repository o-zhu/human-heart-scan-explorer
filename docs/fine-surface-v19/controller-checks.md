# Optional fine-surface lifecycle checks

`tests/fine-surface-controller-v19.mjs` exercises the actual fine-surface
controller and resource lifecycle with DOM, worker, and WebGL-call fixtures.
**All seven focused checks pass** after the corresponding fixes.

Run from the repository root with an installed LinkeDOM ESM entry point:

```sh
node tests/fine-surface-controller-v19.mjs /absolute/path/to/linkedom/esm/index.js
```

## Covered behavior

1. Returning to **Interactive volume** cancels pending preparation. A late worker
   result cannot install geometry or change the selected mode.
2. Rapid mesh-level choices install only the most recent selection. The measured
   volume bytes and current cut-face object remain unchanged, and the renderer's
   default screen-quad vertex-array state is restored.
3. Surface-compatible settings apply when the user selects the mesh. Once loading
   is underway, a later change to mode, threshold, cleanup, or plane guides wins;
   download completion does not silently restore older settings.
4. A failed optional download selects the retained scalar renderer and schedules
   a repaint. The interface does not merely change its label while leaving the
   previous mesh image painted indefinitely.
5. If construction fails after the first program is created, already allocated
   GPU resources are released.
6. A missing render-target allocation rejects construction instead of installing
   an incomplete surface.
7. The fixed mesh stays inactive for an incompatible resident extent, changed
   extraction threshold, translucent rendering, disabled cleanup, or plane guides.
   Those settings retain the existing volume-rendering path.

## Review and limits

The fine pass writes its own color/depth target and then uses the existing
full-output measured-cap composite. It does not rewrite the source volume or
Ultra cut-face textures. Source provenance, geometric error, and actual decoded
asset integrity are documented separately from these controller checks.

These are lifecycle and event tests, not GPU benchmarks or browser interaction
tests. They do not establish device frame rates, available GPU memory, clinical
accuracy, or absence of a visible smoothing/decimation tradeoff. Native EGL
shader and geometry checks provide separate rendering evidence.
