"""Create a reversible conservative display-support mask, without editing intensities.

Keep the largest 18-connected source component above raw intensity 17490,
then add a three-voxel Manhattan safety margin. A further one-voxel maximum
filter protects that margin when resampling to the compact 238x238x265 grid.
This excludes disconnected debris/background, not a clinically validated
anatomical segmentation. The original source arrays remain unchanged.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--volume', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/assets/cleanup'))
    parser.add_argument('--support-output', type=Path, default=Path('public/assets/ultra-support.json'))
    args = parser.parse_args()
    raw = np.load(args.volume, mmap_mode='r')
    assert raw.shape == (530, 475, 475) and raw.dtype == np.uint16
    yy, xx = np.ogrid[:475, :475]
    cylinder = (xx-237)**2+(yy-237)**2 <= 210**2
    foreground = (raw > 17490) & cylinder[None]
    labels, count = ndi.label(foreground, structure=ndi.generate_binary_structure(3, 2))
    counts = np.bincount(labels.ravel()); counts[0] = 0
    largest = int(counts.argmax()); core = labels == largest
    core_voxels = int(counts[largest]); total_foreground = int(foreground.sum())
    del labels, counts, foreground
    margin = ndi.binary_dilation(core, structure=ndi.generate_binary_structure(3, 1), iterations=3)
    support = ndi.maximum_filter(margin, size=3, mode='constant')
    coords = [np.rint(np.linspace(0, old-1, new)).astype(int)
              for old, new in zip(raw.shape, (265, 238, 238))]
    compact = support[np.ix_(*coords)].astype('uint8') * 255
    args.output.mkdir(parents=True, exist_ok=True)
    raw_bytes = compact.tobytes()
    compressed = gzip.compress(raw_bytes, compresslevel=9, mtime=0)
    (args.output/'heart-support.raw.gz').write_bytes(compressed)
    bbox = [[int(q.min()), int(q.max())] for q in np.where(support)[::-1]]
    # Re-evaluate the exact compact mask on source centers for display statistics.
    source_coords = [np.rint(np.linspace(0, old-1, new)).astype(int)
                     for old, new in zip(compact.shape, raw.shape)]
    displayed = compact[np.ix_(*source_coords)] > 0
    statistics = []
    for threshold in (.25,.28,.30,.32,.40,.50):
        visible = (raw > 14640 + threshold * 8905) & cylinder[None]
        total = int(visible.sum()); removed = int((visible & ~displayed).sum())
        statistics.append({'displayThreshold':threshold,'visibleVoxelsBefore':total,
                           'excludedVoxels':removed,'excludedFraction':removed/total})
    # This check ensures the cleanup cannot remove the source-connected core.
    retained_core = int((core & displayed).sum())
    assert retained_core == core_voxels, (retained_core, core_voxels)
    manifest = {
        'schemaVersion':1, 'specimen':'LADAF-2021-17', 'dimensions':[238,238,265],
        'volumeUrl':'assets/cleanup/heart-support.raw.gz', 'dtype':'uint8',
        'arrayOrder':'ZYX, X fastest', 'values':{'0':'excluded','255':'retained'},
        'physicalCenterExtentUm':[150542.4,150542.4,168010.4],
        'registration':'First and last voxel centers match the s4 display extent on each axis.',
        'sourceScale':'s4', 'sourceDimensions':[475,475,530], 'sourceThresholdRaw':17490,
        'sourceThresholdDisplay':(17490-14640)/8905,
        'method':'Largest 18-connected tissue component, expanded by 3 Manhattan voxels plus a conservative one-voxel resampling guard.',
        'coreConnectivity':18,'marginVoxelsS4':3,'sourceSpacingUm':317.6,
        'coreComponentVoxels':core_voxels, 'sourceForegroundVoxels':total_foreground,
        'sourceComponents':int(count),'nonCoreComponents':int(count-1),
        'coreVoxelsRetained':retained_core, 'boundsXYZ':bbox,
        'rawBytes':len(raw_bytes),'compressedBytes':len(compressed),
        'sha256':hashlib.sha256(compressed).hexdigest(),
        'statistics':statistics,
        'limitations':'Conservative display cleanup. It suppresses disconnected bright fragments and background outside the organ-support region. Nearby or attached debris can remain. It neither reconstructs missing tissue nor establishes a clinical tissue segmentation. Disable cleanup to inspect the original display volume.',
        'intensitiesModified':False,
    }
    (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Sparse N5 s2 requests: source s2 blocks contain 32 s4 sample intervals.
    sparse_support = ndi.binary_dilation(margin, structure=ndi.generate_binary_structure(3, 1), iterations=2)
    slices = {}; sub_blocks = {}
    for name, axis, count_axis in [('x',2,475),('y',1,475),('z',0,530)]:
        arrays=[]; quarter_arrays=[]
        for index in range(count_axis):
            selectors=[slice(None)]*3;selectors[axis]=slice(max(index-1,0),min(index+2,count_axis))
            plane=sparse_support[tuple(selectors)].any(axis=axis)
            a,b=np.where(plane)
            if name=='x': cx=np.full(a.shape,index//32);cy=b//32;cz=a//32
            elif name=='y': cx=b//32;cy=np.full(a.shape,index//32);cz=a//32
            else: cx=b//32;cy=a//32;cz=np.full(a.shape,index//32)
            keys=cx+15*(cy+15*cz); unique=np.unique(keys)
            arrays.append(unique.tolist())
            z_coord=np.full(a.shape,index) if name=='z' else a
            quarters=1 << ((z_coord % 32)//8)
            masks=np.zeros(15*15*17,dtype=np.uint8)
            np.bitwise_or.at(masks,keys,quarters.astype(np.uint8))
            quarter_arrays.append(masks[unique].tolist())
        slices[name]=arrays
        sub_blocks[name]=quarter_arrays
    args.support_output.parent.mkdir(parents=True,exist_ok=True)
    args.support_output.write_text(json.dumps({
        'schemaVersion':1,'blockSizeS4':32,'chunkGridXYZ':[15,15,17],
        'encoding':'cx+15*(cy+15*cz)','support':'Largest source component plus five s4 Manhattan voxels; each section includes adjacent ±1 s4 planes.',
        'slices':slices,'subBlocks':sub_blocks,
        'subBlockEncoding':'Bitmask of Z quarters (1 << floor((s4Z % 32)/8)), aligned to each slice chunk-key list. Only valid for the source chunk Blosc layout of four 1 MiB blocks; otherwise use complete chunks.'
    },separators=(',',':'))+'\n')
    print(json.dumps({'cleanup':manifest,'ultraSupportBytes':args.support_output.stat().st_size,
                      'ultraBlocksPerPlane':{k:{'min':min(map(len,v)),'max':max(map(len,v)),'mean':float(np.mean(list(map(len,v))))} for k,v in slices.items()}},indent=2))


if __name__=='__main__':
    main()
