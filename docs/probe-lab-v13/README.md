# Probe Lab v13 — body proportions, indicator and shared pose

## Changes

The reference-torso instrument now uses a scale of **1.20**, up from 0.45.
Its authored phased-array shell is approximately **107 mm long and 37 mm wide**;
the contact head is about **23 × 13 mm**. The left instrument is 2.67 times the
previous linear size. The middle-column scale remains **0.40**, and both of its
original instrument meshes and materials are byte-identical to v12. Enlarging
the reference instrument never changes the acoustic origin or sampled plane.

These are illustrative proportions, not a vendor CAD model. Scale was checked
against manufacturer contact-head specifications: Philips reports a 20.3 mm
aperture for its S5-1 adult-echo transducer; GE reports an 18 × 27 mm footprint for
the M5Sc-D. Aperture, lens and outer footprint are different measurements, so
neither specification is represented as an exact measurement of this authored
model's handle.

The reference instrument has a raised amber indicator with a dark surround and
pale centre, on one flank only. A small projected **Indicator** callout follows
that exact flank as the instrument moves. Its dashed **far side** state indicates
that the marked flank faces away from the reference camera. The annotation is a
position locator; it does not claim a tissue-occlusion visibility test. Offscreen
markers are not clamped to a false location. The physical mark is on local −X,
which is −probe.right and the marked left side of this application's sector
image. No change is made to the image orientation convention.

## Alignment defect and correction

Previously, the reference renderer ignored the actual pose supplied by the main
module. It separately aimed toward the reference heart at the current position
and reapplied the state angles. As a result, contact motion could diverge from
the middle pose, locking/unlocking could produce a reference-only jump, and
free motion could be ignored when old contact coordinates remained present.

The new renderer consumes the **same displayed-frame pose** as the middle
renderer. Each starting preset defines a fixed source basis and a fixed
reference basis. The rotation is `R = B_reference × transpose(B_source)`.
Position is the reference anchor plus the rotated displacement from the source
anchor, normalized by the existing donor length scale. Beam, in-plane right,
normal and up vectors all use that same proper rotation. There is no new
retargeting, Euler reconstruction, position clamping or skin projection after
movement. The displayed scan, main probe and reference pose consequently stay
on the same frame while an updated sampled image is being computed.

BodyParts3D is still **not registered to a donor**. Initial anchors are illustrative
entry points. The reference body and synthetic contact patch can have different
contours away from their anchor; the mapping must not be interpreted as clinical
probe-to-donor registration. This qualification remains visible in the interface
and is explained in its optional method disclosure.

## Verification

Run:

```sh
node --test tests/probe-alignment-v13.mjs tests/probe-lab-v11.mjs tests/probe-lab-v12.mjs
python3 tests/probe-lab-v13-native.py
```

The alignment suite compares 288 poses across all 12 starting planes and all
three donors against an independent two-stage axis-angle construction. It covers
contact movement, combined steering, free translation, lock/free continuity,
supplied-pose precedence, marker polarity, actual renderer handoff and unchanged
middle meshes. `alignment-verification.json` records the results.

The native review uses the production probe geometry and shader programs with
the real reference torso assets. It renders before/after proportions with fixed
cameras. These are native scientific renders, not browser screenshots or browser
layout/permission tests. The original donor source data, ultrasound calculation,
scan-plane presets and middle-camera framing are unchanged.

## Primary references

- [Philips S5-1 specifications](https://www.usa.philips.com/healthcare/product/HC989605412081/s5-1)
- [GE cardiac probe specifications](https://www.gehealthcare.com/static/me/cvus-picker-v3/cvus-picker/index.html)
- [GE probe orientation guidance](https://vscanair-support.gehealthcare.com/support/solutions/articles/47001170431-probe-orientation)

The GE orientation guide documents physical-marker to image-marker correspondence;
screen-left is this application's existing convention, not a universal clinical
display convention.
