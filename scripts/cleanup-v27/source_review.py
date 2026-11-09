#!/usr/bin/env python3
"""Source-coordinate serial review of user-marked surfaces; never edits CT data."""
from pathlib import Path
import argparse,gzip,hashlib,json,sys,textwrap
import numpy as np
from scipy import ndimage as ndi
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource

def digest(data):return hashlib.sha256(data).hexdigest()
def load_masks(version='v26'):
    manifest_path=ROOT/f'public/assets/cleanup-{version}/lumen-manifest.json'
    manifest=json.loads(manifest_path.read_text());items=[]
    for item in manifest['masks']:
        encoded=(ROOT/'public'/item['url'].removeprefix('./')).read_bytes()
        assert digest(encoded)==item['sha256']
        raw=gzip.decompress(encoded);assert digest(raw)==item['decodedSha256']
        a=np.frombuffer(raw,np.uint8).reshape(item.get('storageDimensionsXYZ',item['dimensionsXYZ'])[::-1])
        if item.get('format')!='gzip-bitset-x-zyx':a=a!=0
        items.append((item,a))
    return manifest,items

def plane_mask(items,lo,hi,y):
    out=np.zeros((hi[2]-lo[2],hi[0]-lo[0]),bool)
    for item,a in items:
        l=np.array(item['lowerFullFineXYZ']);h=l+item['dimensionsXYZ']
        if not l[1]<=y<h[1]:continue
        aa=np.maximum(l,lo);bb=np.minimum(h,hi)
        if bb[0]<=aa[0] or bb[2]<=aa[2]:continue
        plane=a[aa[2]-l[2]:bb[2]-l[2],y-l[1]]
        if item.get('format')=='gzip-bitset-x-zyx':plane=np.unpackbits(plane,axis=1,count=item['dimensionsXYZ'][0],bitorder='little').astype(bool)
        out[aa[2]-lo[2]:bb[2]-lo[2],aa[0]-lo[0]:bb[0]-lo[0]]|=plane[:,aa[0]-l[0]:bb[0]-l[0]]
    return out

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--output',default='docs/cleanup-v27/source');parser.add_argument('--version',default='v26');args=parser.parse_args()
    cases=json.loads(Path(args.config).read_text());out=ROOT/args.output;out.mkdir(parents=True,exist_ok=True)
    reader=FineSource(cache_bricks=32);manifest,masks=load_masks(args.version);records=[]
    for case in cases:
        lo=np.array(case['lowerXYZ']);hi=np.array(case['upperXYZ']);ys=case['ys'];cols=min(len(ys),4);rows=(len(ys)+cols-1)//cols
        fig,axes=plt.subplots(rows,cols,figsize=(cols*5,rows*5.5),squeeze=False,constrained_layout=True)
        entries=[]
        for index,y in enumerate(ys):
            a=lo.copy();b=hi.copy();a[1]=y-3;b[1]=y+4
            raw=reader.region(a,b);source=raw[:,3,:];f05=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)[:,3,:]
            baseline=plane_mask(masks,lo,hi,y)
            ax=axes.flat[index];extent=[lo[0],hi[0]-1,hi[2]-1,lo[2]]
            ax.imshow(source,cmap='gray',vmin=25,vmax=205,extent=extent,interpolation='nearest')
            if case.get('overlay',True):
                rgba=np.zeros((*baseline.shape,4));rgba[baseline]=[1,.18,.03,.25]
                ax.imshow(rgba,extent=extent,interpolation='nearest')
            ax.contour(np.arange(lo[0],hi[0]),np.arange(lo[2],hi[2]),f05,levels=[71.4],colors=['#70bad5'],linewidths=.25,alpha=.6)
            ax.set(title=f'Fine Y={y} · section {y/4+1:g}',xlabel='Fine X',ylabel='Fine Z');ax.grid(alpha=.2)
            if case.get('points'):
                for p in case['points']:ax.plot(p[0],p[1],'+',c='#ffff00',ms=8)
            entries.append(dict(fineY=y,sourcePlaneSha256=digest(memoryview(np.ascontiguousarray(source))),excludedInPlane=int(baseline.sum())))
        for ax in list(axes.flat)[len(ys):]:ax.set_visible(False)
        fig.suptitle(textwrap.fill(case.get('title',case['id'])+' · measured 79.4 µm source',width=cols*48)+'\n'+textwrap.fill('Cyan: source sigma0.5 isovalue0.28. '+('Orange: current display exclusion.' if case.get('overlay',True) else 'Original display source; no mask overlay.'),width=cols*48),fontsize=11)
        fig.savefig(out/(case['id']+'.jpg'),dpi=145);plt.close(fig)
        record={**case,'sourcePlanes':entries};records.append(record);print(json.dumps(dict(case=case['id'],saved=str(out/(case['id']+'.jpg')))),flush=True)
    (out/'receipt.json').write_text(json.dumps(dict(source=reader.receipt(),version=args.version,cases=records),indent=2)+'\n')
if __name__=='__main__':main()
