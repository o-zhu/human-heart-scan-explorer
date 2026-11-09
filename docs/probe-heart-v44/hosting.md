# Whole-heart orientation mesh hosting

The two new S-donor whole-heart meshes use an immutable collection in the existing `BUCKET` binding. Their browser URLs remain `/assets/probe-heart-v44/s-20-29.hfm.gz` and `/assets/probe-heart-v44/s-20-28.hfm.gz`. The adjacent JSON manifest remains a static source/build file. LADAF retains its existing balanced whole-heart mesh URL and storage arrangement.

The fixed allowlist is `server/probe-heart-index-v44.json`. It contains exactly two objects, totaling **5,746,842 bytes**, with the source manifest's byte lengths and SHA-256 hashes. Their storage prefix is `hoa-heart/probe-heart-v44/`; the narrow administrative route is `/api/probe-heart-v44/`. This collection does not reopen any historical bank or add a storage binding.

## Staging a built Worker

After building, run the matching mode before the final archive-budget stage:

```sh
# Ordinary final release: source and compiled policy must both be read-only.
python3 scripts/prepare-probe-heart-hosting-v44.py --stage

# Only during the explicit temporary seed phase:
python3 scripts/prepare-probe-heart-hosting-v44.py --stage --seed
```

The helper validates the fixed two-object index, both source mesh files, their manifest records, the retained static manifest, and the built Worker's policy and object index. It validates every input before removing either file. Only matching copies under `dist/client/assets/probe-heart-v44/` are removed. Source meshes, metadata, public URLs, and all other build files are preserved. Running it again is safe. The receipt is `.sites-runtime/probe-heart-staging-v44.json`.

This helper does not upload, deploy, enable a gate, or check the overall archive budget. Run the existing final `prepare-hosted-display-v10.py --stage` budget check afterward. A fresh build restores the copies, so staging is required after every build.

## Seed and final release

During the temporary `probe-heart-v44:seed` policy, administrative reads and PUTs require the collection's authorized token; public mesh reads remain unavailable. Keep the temporary credential out of files and logs. After both stored objects pass complete byte-length and SHA-256 readback verification, set the collection policy to `probe-heart-v44:read-only`, remove the temporary secret, rebuild, and stage without `--seed`.

The final handler serves public GET/HEAD requests and rejects mutations with HTTP 405, including requests with a retained former seed token. Verify that final behavior and both public object hashes after publication. The manifest stays available throughout local development; a portable public-source checkout can instead serve its restored local mesh files without R2.

These are CC BY 4.0 derivatives of the corresponding Human Organ Atlas datasets, with the processing limits and credits retained in the model manifest and [methods](README.md).
