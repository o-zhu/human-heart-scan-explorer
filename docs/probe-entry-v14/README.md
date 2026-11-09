# External starting entries for the S donors

## Cause and correction

The previous default placed the probe tip `0.47 × imaging depth` in front of a
section's geometric centre. That rule happened to work for the original donor's
reviewed planes, but a geometric centre is not a safe entry point for another
heart. Both S donors' long-axis and opposite-entry tips landed inside their
retained tissue support.

The four starting planes for each S donor now carry their own `probeEntry`
calibration. The preparation script projects **every retained sample of that
donor's existing cleanup support** toward the probe and puts the tip beyond the
outermost occupied cell. Clearance includes a half-cell diagonal guard and an
additional 8 mm at the reference scale. If the previous origin was already
farther outside, it is retained exactly. The default depth also covers the most
distant projected source sample plus a small far-field margin.

| Donor | Starting entry | Tip moved outward | Minimum support-cell clearance | Initial imaging depth |
|---|---|---:|---:|---:|
| S-20-29 | Long axis | 18.5 mm | 7.4 mm | 163.6 mm |
| S-20-29 | Opposite entry | 26.6 mm | 7.4 mm | 163.7 mm |
| S-20-28 | Long axis | 22.9 mm | 7.7 mm | 177.7 mm |
| S-20-28 | Opposite entry | 31.2 mm | 7.7 mm | 177.9 mm |

The remaining S starting entries were already outside and retain their existing
positions and depths. LADAF-2021-17's four defaults are unchanged.

## Geometry preserved

The offset is exclusively along the existing beam. The source plane's normal,
in-plane axes, physical voxel coordinates and prepared Ultra texture all remain
the same. There is no resampling or change to source data. All eight S starting
planes still match their existing prepared Ultra images through `sameFinePlane`.
The small middle-column probe keeps its existing geometry and scale.

Both probe illustrations still consume the same displayed physical pose. The
reference torso's fixed mapping uses the calibrated synthetic contact origin as
its source anchor, so correcting the source entry does not independently rotate
or move the reference probe's starting anchor. This remains an illustrative
mapping to BodyParts3D, not registration of a donor's heart to their chest.

Custom imaging depths and explicit free-pose bookmarks remain intact. A legacy
default contact depth is migrated once when its calibrated entry is loaded.
Changing imaging depth subsequently cannot push the calibrated contact tip back
into the heart. Resetting or choosing a starting preset uses its calibrated
default depth.

## Verification and reproducibility

`preparation.json` records the support hashes, bounds, per-preset offsets and
coverage measurements. `verification.json` is an independent production-code
audit that scans all **2,011,319** S-20-29 support samples and **2,204,619**
S-20-28 support samples, checks the entire compact probe mesh, and verifies
distal depth coverage, physical scaling, bookmarks and plane identity.

`entry-before-after.png` projects the actual production probe mesh onto each
prepared fine CT plane. It uses one fixed gamma only for diagram readability.
It is a measured geometry diagram, not a browser screenshot or a clinical
ultrasound simulation.

Reproduce with:

```sh
python3 scripts/prepare-probe-entries-v14.py --write
node tests/probe-entry-v14.mjs --report=docs/probe-entry-v14/verification.json
python3 scripts/render-probe-entry-v14.py
```

This correction verifies the **starting placements**. The contact surfaces are
synthetic and do not provide collision avoidance against donor anatomy during
arbitrary later movement. Chamber identities and clinical window names remain
unassigned for these geometric comparison donors.
