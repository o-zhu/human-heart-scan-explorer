# TTE chest-relative sliding — v45

## Result

External TTE contact now uses the fixed reference chest for sliding:

| Control | Movement |
| --- | --- |
| W / S | Toward the head / toward the feet, along the displayed skin |
| A / D | Left / right around the chest from the Front view; the path continues around the sides |
| Q / E | Counterclockwise / clockwise rotation when looking along the beam from the handle toward the skin |
| I / K | Existing upward / downward tilt convention in the starting scan frame |
| J / L | Existing left / right fan convention in the starting scan frame |
| Shift | Existing fine control |

The left/right and head/feet directions stay attached to the reference chest when its camera is orbited. The keycaps, held keys and position buttons share the same movement function. Free positioning retains its local probe axes, and the separate TEE Lab is unchanged.

## Cause and correction

The v44 skin implementation derived slide directions from `contact.right` and `contact.normal`. Those axes preserve the probe's acquisition plane. They differ across starting views, so positive advance pointed toward the feet in every apical start but could point sideways or upward in the parasternal starts. A global W/S swap would fix one start and reverse others. D also pointed left in the LADAF short-axis start.

`public/probe-skin-contact.js` now computes a separate movement tangent from the fixed illustrative chest's superior axis and the local skin normal. W follows the headward tangent. A/D follows the perpendicular tangent around the chest. This frame is independent of the acquisition axes and either camera. The probe's acquisition orientation is still transported across the actual triangles without resetting the user's steering angles.

The movement has no synthetic ellipse limit. Existing nearest-surface steps, the finite cropped skin boundary and the shared accepted pose remain in place. A horizontal skin cap has no further headward tangent; the lateral control remains finite there.

This changes movement intent, not stored contact coordinates. Existing bookmarks retain their contact point and orientation. No source volumes, donor registration, reference-body transforms, prepared planes, heart assets, TEE geometry or physical probe size were changed.

`public/probe-lab.js` adds concise head/feet guidance and precise accessible keycap/step labels. Q/E labels now explicitly say counterclockwise/clockwise. The angular key mappings and mouse mappings are retained.

## Verification

`tests/probe-control-directions-v45.mjs` loads all three real donor manifests/plane sets and the verified BodyParts3D skin. It exercises the production `keyDown`, tap and held-key paths for every external TTE preset, rather than asserting the sign of an arbitrary synthetic coordinate.

The six new tests cover:

- W/S headward/footward and A/D lateral directions in all nine donor/preset starts, including actual perspective projection through both Front and default Oblique cameras.
- Independence from probe rotation and the overview camera; unchanged source frames and skin vertices.
- Opposite-key cancellation, reversible paths and agreement between keyboard travel and position-button travel.
- Headward movement after selecting front, side and rear skin contacts.
- Q/E rotation about the beam, I/K tilt and J/L fan signs, inverse pairs and a fixed contact point.
- Agreement between mouse steering and the corresponding angular keys.

Every moved pose is checked against the real skin, the overview probe matrix and the sector's common CT cut plane. The focused five-millimetre forward/reverse diagnostic had a largest return error of 0.043 mm across the nine starts; the regression bound allows 0.15 mm for triangulated-surface integration.

The existing v44 skin tests still verify selection across the displayed triangles and travel beyond the retired 55 × 45 mm patch. Existing keyboard tests still cover ordinary focus, editable controls, native range input, shortcuts, multi-touch keycaps, precision, interrupted holds, optional cursor capture and saved-state behavior. Existing entry and motion tests retain source-plane alignment and stale-frame rejection.

Commands used (48 tests passed):

```bash
node --test tests/probe-control-directions-v45.mjs tests/probe-skin-v44.mjs tests/probe-entry-v14.mjs
HEART_DOM_MODULE={temporary-cache}/node_modules/linkedom/esm/index.js node --test tests/probe-keyboard-controls.mjs
node tests/probe-motion-v14.mjs --dom={temporary-cache}/node_modules/linkedom/esm/index.js
git diff --check
```

The LinkeDOM path is an external test fixture dependency, not a runtime dependency. These are numerical and DOM-fixture checks, not evidence of a real GPU/browser session. Browser review is tracked separately with the v45 loading/layout review.
