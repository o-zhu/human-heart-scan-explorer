# Probe Lab reference anatomy

**BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.**

- Official license: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- Creative Commons license: https://creativecommons.org/licenses/by/4.0/
- Official source: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
- Source archive: https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_BP3D_4.0_obj_99.zip
- Element mapping: https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_element_parts.txt
- License verified on 2026-11-05; the official license page was last updated 2025-02-27.

The redistributed derivative contains selected skin, thoracic bones, costal
cartilage and reference-heart meshes. It crops the full-body skin to the torso,
reduces mesh density, recalculates normals, and transforms coordinates for the
separate chest-orientation view. `manifest.json` lists every source element,
source archive checksum, output checksum, and modification. The original adult
reference anatomy is not registered to, or inferred from, any HiP-CT donor.

The cardiac phased-array probe and TEE tip in `probe-scene.js` are original
illustrative geometry written for this website. They are not vendor CAD, a
licensed third-party probe model, or an acoustically calibrated device. Their
rounded cases, acoustic faces, orientation markers, grips, strain reliefs and
cables are educational visual details.

The torso does not contribute tissue values to the donor CT reformat or to the
modeled ultrasound image. Its ribs do not create measured bone shadows in that
simulation.
