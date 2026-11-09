# Echo plane/probe alignment audit

Actual production controller plane/clip/cap/overlay handoffs plus independent numerical plane and tract audit. GPU pixels, skin/head collision certification and clinical validity are not established by this harness.

| Donor | Mode | Baseline acquired | Noncoplanar | Max origin residual (mm) | Max sector angle (°) | Adjusted failures / acquired cases |
|---|---|---:|---:|---:|---:|---:|
| ladaf-2021-17 | TTE | 25 | 20 | 56.108 | 47.934 | 322 / 375 |
| ladaf-2021-17 | TEE | 24 | 10 | 67.226 | 75.379 | 167 / 360 |
| s-20-28 | TTE | 25 | 25 | 70.906 | 75.442 | 374 / 375 |
| s-20-28 | TEE | 24 | 12 | 58.579 | 85.253 | 193 / 360 |
| s-20-29 | TTE | 25 | 25 | 69.033 | 75.442 | 372 / 375 |
| s-20-29 | TEE | 24 | 13 | 56.155 | 85.253 | 199 / 360 |

## LADAF baseline by view

| View | Origin residual (mm) | Sector angle (°) | Largest fan residual (mm) | Pose mode |
|---|---:|---:|---:|---|
| plax_deep | 47.169 | 43.723 | 47.169 | independent estimate |
| plax | 47.169 | 43.723 | 47.169 | independent estimate |
| plax_av | 47.169 | 46.102 | 47.169 | independent estimate |
| plax_mv | 47.169 | 43.604 | 47.169 | independent estimate |
| plax_rvot | 42.418 | 34.448 | 42.418 | independent estimate |
| plax_rvin | 0.000 | 0.000 | 0.000 | plane fit |
| psax_great | 0.000 | 0.000 | 0.000 | plane fit |
| psax_av | 28.298 | 25.643 | 28.298 | independent estimate |
| psax_av_zoom | 28.298 | 25.643 | 28.298 | independent estimate |
| psax_tv | 20.798 | 25.920 | 24.595 | independent estimate |
| psax_pv | 29.663 | 21.044 | 29.663 | independent estimate |
| psax_mitral | 45.549 | 32.978 | 45.549 | independent estimate |
| psax_papillary | 17.752 | 15.685 | 17.752 | independent estimate |
| psax_apical | 0.000 | 0.000 | 0.000 | plane fit |
| a4c | 14.963 | 35.607 | 41.716 | independent estimate |
| a4c_lv | 14.963 | 36.001 | 38.026 | independent estimate |
| a4c_rv | 19.622 | 42.994 | 50.077 | independent estimate |
| a5c | 0.640 | 26.823 | 32.067 | independent estimate |
| a4c_cs | 32.439 | 47.934 | 49.787 | independent estimate |
| a2c | 0.000 | 0.000 | 0.000 | plane fit |
| a2c_lv | 0.000 | 0.000 | 0.000 | plane fit |
| a3c | 17.303 | 36.967 | 42.820 | independent estimate |
| a3c_lv | 17.303 | 38.046 | 40.147 | independent estimate |
| a4c_la_pv | 14.963 | 34.983 | 53.193 | independent estimate |
| subcostal | 56.108 | 45.366 | 56.108 | independent estimate |
| subcostal_ivc | — | — | — | Outside scan; CT comparison inapplicable |
| subcostal_hepatic | — | — | — | Outside scan; CT comparison inapplicable |
| ssn_arch | — | — | — | Outside scan; CT comparison inapplicable |
| me5c | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| me4c | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| mecommissural | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| me2c | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| melax | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| meavlax | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| meaaolax | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| meaaosax | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| merpv | 24.690 | 50.042 | 29.719 | tract-estimate |
| meavsax | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| mervinout | 7.556 | 20.591 | 22.664 | tract-estimate |
| memodbicaval | 29.719 | 75.379 | 60.079 | tract-estimate |
| bicaval | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| mepv | 26.142 | 69.334 | 38.429 | tract-estimate |
| melaa | 22.616 | 72.873 | 39.495 | tract-estimate |
| tgbasalsax | 35.775 | 66.859 | 50.939 | tract-estimate |
| tgpapillary | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| tgapicalsax | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| tgrvbasal | 15.523 | 56.953 | 54.029 | tract-estimate |
| tgrvinout | 67.226 | 49.236 | 67.226 | tract-estimate |
| deeptg5c | 3.903 | 68.645 | 61.802 | tract-estimate |
| tg2c | 42.913 | 57.891 | 42.913 | tract-estimate |
| tgrvin | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| tglax | 0.000 | 0.000 | 0.000 | ct-plane-estimate |
| daosax | — | — | — | Outside scan; CT comparison inapplicable |
| daolax | — | — | — | Outside scan; CT comparison inapplicable |
| uearchlax | — | — | — | Outside scan; CT comparison inapplicable |
| uearchsax | — | — | — | Outside scan; CT comparison inapplicable |

## TEE strict-level feasibility

| View | Nearest sampled origin residual (mm) | Minimum center-preserving rotation (°) | Centerline crossings | Gastric disk crossings | Protected lumen fits |
|---|---:|---:|---:|---:|---:|
| me5c | 0.705 | 0.495 | 1 | 0 | 0 |
| me4c | 0.382 | 0.276 | 1 | 0 | 1 |
| mecommissural | 0.125 | 0.087 | 1 | 0 | 5 |
| me2c | 0.065 | 0.050 | 1 | 0 | 6 |
| melax | 0.633 | 0.479 | 1 | 0 | 2 |
| meavlax | 0.423 | 0.425 | 1 | 0 | 2 |
| meaaolax | 0.195 | 0.185 | 1 | 0 | 2 |
| meaaosax | 0.468 | 0.446 | 1 | 0 | 2 |
| merpv | 14.395 | 15.423 | 0 | 0 | 0 |
| meavsax | 0.051 | 0.049 | 1 | 0 | 1 |
| mervinout | 6.586 | 4.697 | 0 | 0 | 0 |
| memodbicaval | 16.605 | 14.249 | 0 | 0 | 0 |
| bicaval | 0.078 | 0.072 | 1 | 0 | 1 |
| mepv | 14.688 | 15.748 | 0 | 0 | 0 |
| melaa | 2.212 | 3.101 | 0 | 0 | 0 |
| tgbasalsax | 31.268 | 29.927 | 0 | 0 | 0 |
| tgpapillary | 0.018 | 0.017 | 1 | 16 | 13 |
| tgapicalsax | 0.053 | 0.048 | 0 | 4 | 0 |
| tgrvbasal | 4.940 | 3.489 | 0 | 0 | 0 |
| tgrvinout | 57.259 | 38.720 | 0 | 0 | 0 |
| deeptg5c | 0.211 | 0.149 | 0 | 4 | 0 |
| tg2c | 36.798 | 34.803 | 0 | 0 | 0 |
| tgrvin | 0.056 | 0.032 | 0 | 11 | 10 |
| tglax | 0.013 | 0.010 | 0 | 11 | 8 |
