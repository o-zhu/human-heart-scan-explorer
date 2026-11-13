# v61 visual review

## Scope and decision

Three original teaching illustrations were revised in response to concerns
about atrial septal tissue and apparent mitral obstruction. The previous v60
release already contained the earlier 28 replacements and 28 retained views.
This follow-up carries the other 53 v60 entry objects over exactly; it does not
claim a new review of every view.

The earlier TG illustrations depicted ventricular ejection, with closed mitral
valves and open aortic valves. A closed mitral valve can be normal in that
phase. The ambiguity was visual: the coapted leaflet contours resembled a
permanent partition. The two revised TG illustrations use ventricular filling
to show a recognizable open LA–MV–LV route, with the AV closed consistently.

## Per-view observations

| View | Accepted correction | Details preserved |
| --- | --- | --- |
| TTE subcostal four-chamber | Thin continuous salmon RA–LA septal tissue band, with central thinning and thicker rims; no white valve-like septal seam. | Four chamber labels and arrangement, finite atrial and RV walls, thicker LV wall and ventricular septum, true MV/TV profiles, near-field liver and sector. |
| TEE TG long-axis | Two attached open mitral leaflets and visible LA–LV inflow; closed AV inside a separately bounded aortic root. | LVOT, short aortomitral attachment, LA–Ao separation, thin atrial wall, RV crescent, labels and 120–140° view identity. |
| TEE deep TG five-chamber | Open labeled MV and open TV; visible atrioventricular passages beside the LVOT; closed AV with coaptation toward Ao. | Four chamber arrangement, myocardium thickness hierarchy, aortic-root walls, LA–Ao separation and 0–20° view identity. |

The central atrial septum and fibrous attachments are schematic rather than
histological. The short aortomitral curtain remains a genuine fibrous region;
it is not a permanent wall sealing the mitral orifice. Fine chordal anatomy is
outside the purpose and scale of these overview illustrations.

## Actual generation and rejection history

- Subcostal: the first localized septal correction was accepted after separate
  master and export review.
- Deep TG: the first correction improved the MV/TV openings but produced an
  ambiguous double-W AV with upstream-directed central coaptation. It was
  rejected. The second correction placed the cusp meeting downstream into Ao
  and was accepted after reviewing the actual exports.
- TG LAX: the first correction improved the MV but left an ambiguous, wavy AV.
  The second made the cusp closure clearer but incorrectly joined its center
  to the upper aortic wall. Both were rejected. The third separated the thin
  vascular wall from the upper cusp and left an ivory sinus space behind it;
  cusp coaptation is now internal to the lumen.

All anatomical edits were made with ChatGPT Image. Subsequent processing was
limited to uniform RGB resampling and WebP encoding, with no cropping or
programmatic anatomical redrawing. Exact prompts, reference identities,
attempt hashes and selected master hashes are retained in the manifest.

## Acceptance evidence and limits

The selected masters, exact 960px image exports, 384px thumbnails and 200px
previews decoded from those thumbnails were visually inspected. A separate
agent reviewed the TG images and the integrating agent independently inspected
all three views and their exports. Review covers view identity, topology,
walls, valves, attachments, labels, style and thumbnail clarity. Acceptance is
bound to the exact exported hashes, so a different encoding cannot silently
inherit these observations.

This is an AI-assisted comparison with the primary sources below, not an
independent clinician signoff or a claim of measured donor anatomy. Neither
these schematics nor their valve phase changes alter CT sections, reference
videos, donor registration or reconstruction geometry.

## Primary anatomical references

- [ASE comprehensive TTE guideline, Table 2 row 2.24](https://www.asecho.org/wp-content/uploads/2025/04/2019_Comprehensive-TTE.pdf): subcostal four-chamber identity and atrial-septum context.
- [ASE ASD/PFO guideline, atrial septal anatomy](https://www.asecho.org/wp-content/uploads/2025/04/2015_ASD-PFO.pdf): thin fossa region and surrounding atrial tissue; avoid a uniformly thick septum.
- [ASE/SCA comprehensive TEE guideline, Table 10 views 21 and 24](https://www.asecho.org/wp-content/uploads/2025/04/2013_Performing-Comprehensive-TEE.pdf): deep TG five-chamber and TG long-axis arrangement, MV/LVOT/AV relationships and aortomitral anatomy.
- [ASE surgical TEE guideline, Figure 4 and section 3.2.1](https://www.asecho.org/wp-content/uploads/2023/03/PIIS0894731720301334.pdf): normal diastolic cusp coaptation on the aortic side of the basal annular plane.
