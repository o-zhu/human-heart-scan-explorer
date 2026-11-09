#!/usr/bin/env python3
"""Check the guide's acquisition-center mapping at six real native regions.

This is a registration consistency check, not a resampling-operator identity or
an anatomical accuracy measurement. Only measured cached s0 blocks and directly
downloaded source s2 blocks enter the comparison.
"""
from pathlib import Path
import hashlib
import json
import sys

import httpx
import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/guided-native-v21'))
from source import SOURCE,decode_n5

WORK = Path('{source-cache}/guided-native-v21/alignment')
CACHE = Path('{source-cache}/guided-native-v21/network-pilot')
NATIVE = np.array([7614,7614,8480],np.float64)
GUIDE = np.array([1903,1903,2120],np.float64)
ratio = NATIVE/GUIDE


def main():
    regional = json.loads((ROOT/'docs/guided-native-v21/denoising/measurements.json').read_text())['regional']
    candidates = [r for r in regional if .08 < r['methods']['raw']['tissueFraction'] < .92]
    candidates.sort(key=lambda r:r['blockXYZ'][2])
    selected = [candidates[i] for i in np.linspace(0,len(candidates)-1,6).astype(int)]
    checks = []
    with httpx.Client(timeout=60) as client:
        for item in selected:
            block = np.array(item['blockXYZ'],np.int64)
            path = CACHE/('_'.join(map(str,block))+'.n5')
            encoded = path.read_bytes()
            original = decode_n5(encoded)
            origin = block*128
            lo = np.ceil((origin+10+.5)/ratio-.5).astype(int)
            hi = np.floor((origin+117+.5)/ratio-.5).astype(int)
            indices = [np.arange(a,b+1) for a,b in zip(lo,hi)]
            parent = lo//128
            assert np.array_equal(parent,hi//128)
            parent_path = WORK/('s2-'+'_'.join(map(str,parent))+'.n5')
            if not parent_path.exists():
                response = client.get(SOURCE.replace('/s0/','/s2/')+'/'.join(map(str,parent)))
                response.raise_for_status()
                parent_path.write_bytes(response.content)
            parent_encoded = parent_path.read_bytes()
            overview = decode_n5(parent_encoded)
            xyz = np.meshgrid(*indices,indexing='ij')
            coordinates = np.stack(xyz,axis=0).reshape(3,-1)
            local = coordinates-parent[:,None]*128
            observed = overview[local[2],local[1],local[0]].astype(np.float64)
            expected = (coordinates+.5)*ratio[:,None]-.5-origin[:,None]
            field = gaussian_filter(original.astype(np.float64),1.2,radius=6)
            def sample(delta):
                return map_coordinates(field,(expected+np.asarray(delta)[:,None])[::-1],order=1,prefilter=False)
            fit = least_squares(lambda d:(sample(d)-observed)/1000,
                np.zeros(3),bounds=(-3,3),diff_step=.01,max_nfev=40)
            predicted = sample(np.zeros(3))
            corrected = sample(fit.x)
            naive = 4*coordinates+1.5-origin[:,None]
            wrong = map_coordinates(field,naive[::-1],order=1,prefilter=False)
            row = dict(nativeBlockXYZ=block.tolist(),s2BlockXYZ=parent.tolist(),
                nativeSha256=hashlib.sha256(encoded).hexdigest(),
                s2Sha256=hashlib.sha256(parent_encoded).hexdigest(),samples=len(observed),
                fittedResidualShiftNativeXYZ=fit.x.tolist(),
                expectedMappingRmseRaw=float(np.sqrt(np.mean((predicted-observed)**2))),
                fittedMappingRmseRaw=float(np.sqrt(np.mean((corrected-observed)**2))),
                naiveFactorFourRmseRaw=float(np.sqrt(np.mean((wrong-observed)**2))),
                expectedMappingCorrelation=float(np.corrcoef(predicted,observed)[0,1]),
                fitSucceeded=bool(fit.success))
            checks.append(row)
            print(json.dumps(row),flush=True)
    report = dict(schema='guided-native-pyramid-alignment-v21.1',
        formula='native_index=(s2_index+0.5)*(native_dimension/s2_dimension)-0.5',
        nativeDimensionsXYZ=NATIVE.astype(int).tolist(),s2DimensionsXYZ=GUIDE.astype(int).tolist(),
        operator='Gaussian sigma1.2 native voxels, radius6, followed by trilinear sampling',
        limitation='Approximate source-pyramid operator; offsets test registration consistency, not anatomical accuracy.',
        blocks=checks,maximumAbsoluteFittedShiftNative=float(max(np.max(np.abs(r['fittedResidualShiftNativeXYZ'])) for r in checks)))
    (Path(__file__).parent/'pyramid-alignment.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__ == '__main__':
    main()
