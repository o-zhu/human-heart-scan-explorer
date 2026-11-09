# Sharp measured cut faces during camera motion (v7)

## What changed

The old interaction path reduced the canvas drawing-buffer resolution to fit `interactionPixels`. That reduced the measured cut-face texture and the surrounding 3D volume together, making a fine image immediately blurry during orbit, pan or zoom.

The canvas now retains the resolution used by the selected quality setting while idle. During interaction, the expensive volume ray march renders into a smaller RGBA8 offscreen color target. A second pass samples that background and evaluates the measured cut face at every output pixel. The target is reused across frames. Once interaction ends, the normal full-resolution single pass returns.

The lower-resolution volume pass omits the textured cap. This avoids magnifying an already blurred cap around the edges of the final fine overlay. The compositor uses the same source sampling, threshold, grayscale contrast, palette, anatomy tint and facing term as the normal shader. It overlays the cap only when the clipping plane is the front entry into the retained volume; it does not paint a back-facing plane over foreground anatomy. The two passes share the same camera aspect ratio, preventing low-target rounding from shifting the cap against the scene.

This retains measured source detail. It does not sharpen, synthesize, or increase the resolution of the input image. Surface structures in the background still use the adaptive interaction budget. Output resolution continues to respect the existing quality setting, device-pixel ratio cap and maximum output pixel count.

## Cleanup provenance

`setCapData` retains its existing object signature and accepts `cleaned: true`. The shader then samples that prepared fine cap without applying the volume's coarser cleanup mask a second time. Prepared Echo caps, streamed fine planes and hosted orthogonal images carry that provenance. Ordinary volume-surface cleanup is unaffected. A cap without the flag retains the previous cleanup behavior.

## Performance behavior

GPU timing still adapts the volume pixel budget and includes both draws when a composite frame is rendered. The canvas does not resize simply because the user moves the camera. The single-frame-in-flight fence remains in place to avoid a backlog of obsolete camera states.

The additional target is four bytes per adaptive volume pixel; it does not allocate another full-resolution 3D volume. If a graphics device cannot create the extra color target, rendering falls back to the full-resolution single pass, preserving sharpness at the possible cost of a lower frame rate. The existing snapshot path forces a full-resolution single-pass render.

`renderer.renderStats` reports output/volume dimensions and pixel counts, cap pixel count, whether the full-resolution cap path is active, pass count, motion state and target bytes. `volumeShaderSources` exports the exact vertex, volume and compositor GLSL for native verification.

## Verification and measured result

```sh
node scripts/verify-renderer-motion-v7.mjs
python scripts/render_motion_caps_v7.py
```

Seven orchestration checks execute the actual renderer path with a recording WebGL interface. They verify stable output dimensions during orbit/pan/zoom, the smaller background and full-size cap viewports, independent fine-image cleanup provenance, unchanged appearance and physical sampling settings, full-resolution allocation fallback, snapshot behavior, correct whole-organ/translucent handling, and target reuse.

The native EGL harness compiles and runs the production GLSL with the measured A4C and ME4C textures and the original scalar volume. At a 520 × 590 output with a 200 × 227 moving background:

| View | Verified cap pixels | New motion vs idle: maximum channel difference | Previous reduced-canvas cap: mean absolute channel difference |
| --- | ---: | ---: | ---: |
| A4C | 64,860 | 0 | 26.01 |
| ME4C | 67,558 | 0 | 26.00 |

Every tested cap pixel was identical to the full-resolution idle reference. The checks also verify that an already-cleaned fine cap survives an intentionally empty coarse cleanup mask, that an unmarked cap retains mask behavior, and that the compositor does not overlay the back side of the clipping plane. Both programs returned no GL errors.

A small warmed software-driver timing sample measured 49–54 ms for the full-resolution single pass and 12–15 ms for the new two-pass motion frame at those stated pixel counts. The former reduced-canvas motion pass took approximately 10–11 ms. These are offscreen software-driver observations, not browser FPS measurements; the actual device's adaptive budget controls the background workload.

Evidence is stored in `docs/renderer-motion-v7/shader-validation.json`, `docs/renderer-motion-v7-orchestration.json` and `docs/renderer-motion-v7/cut-face-motion-comparison.jpg`. The comparison shows the unchanged idle cap detail, the previous loss during motion, and the new sharp cap above the cheaper background.

Platform references: [WebGL framebufferTexture2D](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/framebufferTexture2D), [WebGL 2 specification](https://registry.khronos.org/webgl/specs/latest/2.0/).
