# TEE atlas implementation and design review

## Scope

The Echo windows → TEE module implements the 28 standard views in Table 10 of the ASE/SCA 2013 comprehensive examination, in the paper's order. The navigation groups are Midesophageal (1–15), Transgastric (16–24), and Aortic (25–28). The ascending-aorta views remain in the midesophageal group. The existing free-steering TEE lab links to this atlas and retains its separate probe mechanics.

Primary reference: Hahn et al., JASE 2013;26:921–964, [comprehensive TEE guideline](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf). This is a comprehensive acquisition study set, not a claim about an exhaustive board-examination syllabus.

## Design decisions

The previous large introduction and stacked text cards consumed too much of the study area. The new layout has a short introduction, narrow searchable library, illustrated cards, and one active-view heading. Three compact group controls expose the examination structure. Search covers all views, and previous/next follows the complete 28-view sequence.

The two principal panes use equal grid columns and exactly the same screen-height variable. The left pane switches between the measured 3D cutaway and its CT section. The right pane shows the selected view's independent clinical reference, with clearly named alternatives only for that same TEE target. A separate dialog enlarges the original cartoon; it does not add a third permanent image pane. The acquisition strip retains the multiplane range and probe level beneath the images. Longer guidance, target anatomy, source metadata and fine CT controls use disclosures. The pair can be enlarged by hiding the library. On smaller screens, the library becomes a horizontal strip; phone layouts stack the image panes.

## Probe and CT correspondence

`tee-atlas-geometry.js` fits additional starting planes from the selected donor's existing frames. For LADAF-2021-17, reviewed regional coordinates from `flow-views-v5.json` also guide the aortic root, ascending aorta and selected right/left-heart targets. The added views remain explicitly approximate. The clinical target list does not verify those structures in the CT.

The instrument and sector share the heart camera and the currently displayed physical plane. The multiplane reference is inverted into the mechanical head frame; the green sector, transducer face and CT plane are coplanar. The shaft is an authored spatial guide. No registered esophagus, stomach, contact model or clinical insertion measurement exists in this specimen. Clinical probe levels, published acquisition angles and relative maneuvers are distinct from CT offsets/rotations.

Existing measured frames remain immutable. In particular, a refitted aortic-valve SAX frame is flagged as derived so that its previous prepared texture cannot be stretched onto the changed plane. Adjusted and new planes use the measured volume and the exact-plane fine sampling path. Cancellation tokens continue to reject obsolete results. Moving to a new plane clears previous CT pixels immediately. The ascending-aorta long axis contains both authored aortic anchors and is perpendicular to its short-axis plane.

The descending thoracic aorta and aortic arch are outside the excised-heart scan. Their atlas entries show whole-heart spatial context with an explicit coverage notice. CT section controls are disabled there, the cut face is cleared, and no substitute aortic section is sampled or claimed.

## Reference media

Reference ultrasound and donor CT are independent acquisitions from different people. They are not spatially registered or heartbeat synchronized. All 28 primary references are the matching supplementary movies from the supplied guideline, streamed unchanged from the publisher. All 28 were decoded and inspected; 26 are 1280 × 720 and two are 800 × 600. Five existing licensed local cine loops remain available as alternatives. Each reference records its original source and attribution in the media catalog; external media retain an original-source link and a retry state. Only the selected reference is attached to a media element. Display framing removes source black side padding inside a centered 1.4:1 video viewport; a Full frame button restores the complete original frame. All 1,502 decoded frames were checked for a conservative crop that retains anatomy, annotations and full frame height. Declared non-square pixel aspect ratios are preserved. The pulmonary-vein entry uses the guideline’s combined right/left pulmonary-vein reference.

## Verification

The unit checks cover all 28 unique targets and 15/9/4 grouping; finite orthogonal frames; immutable original source frames; outside-scan handling; and coplanarity of probe, central beam and image plane. DOM checks exercise all 28 selections, group/search controls, wraparound navigation, probe visibility, diagram dialog, crosslink, out-of-scan CT guard, image retry and obsolete-load rejection, and returning to TTE. Existing Echo texture/orientation/camera tests and TEE steering tests remain part of the verification.

The local application build succeeded. The managed preview server reported healthy, but the cloud browser could not reach its preview address. Browser appearance and media playback are checked on the published page separately; DOM tests are not presented as GPU or clinical validation.

The first published atlas was verified with loaded SVG thumbnails, native playback of the official ME four-chamber, TG midpapillary and upper-esophageal arch long-axis cines, corresponding 3D updates, the probe overlay, enlarged diagram dialog, and disabled CT slicing for targets outside the scan. The initially seen prior canvas frame resolved after rendering; ME four-chamber camera-up and plane-up agree (dot product 1.0). The oblique probe inspection camera was widened so more of the instrument remains visible.

## Artwork update

The current navigation uses 28 individual ChatGPT Image illustrations guided by the corresponding Table 10 first-column schematics. The originals are 1448 × 1086 RGBA; the site uses 1024 × 768 transparent WebP assets. Anatomical refinements used the image tool, while final processing only resized and encoded the approved images. `artwork-v2.json` retains the exact reference crops, prompts, output hashes and dimensions.

Review compared every illustration with its own source for gross topology, orientation and view identity. Specific refinements removed invented pulmonary-vein/appendage valve flaps and an extra RV/RVOT barrier, clarified the basal RV tricuspid orifice, and corrected near-field left atrial cavity shading in the two aortic-valve views. These are illustrative reviews, not clinical validation or quantitative registration.

Thumbnails are larger inside the existing sidebar widths: 104 × 72 pixels at the standard desktop size, 116 × 80 on wide screens, and 88 × 61 on smaller desktops. On phones the cards form a horizontal strip. The enlarged Illustration dialog uses the same high-resolution art with its reference link and AI attribution. Exact names and acquisition angles remain HTML. The four TEE lab starting views share the same illustration catalog. The 3D and ultrasound comparison panes retain their area.

Asset checks verify one WebP per view, valid image signatures and matching provenance, alongside the existing geometry/media and all-view DOM checks. Visual review remains separate from those automated checks.
