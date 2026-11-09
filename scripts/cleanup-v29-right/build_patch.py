#!/usr/bin/env python3
"""Source-derived v29 right-side candidates; original source stays immutable.

Reuses the v28 complete local isosurface method with an explicitly recorded
display-intensity gate. The candidate stronger band is reviewed visually;
every smoothed sample >=155 and original sample >=190 remains protected.
These are windowed display intensities, not Hounsfield units.
"""
from pathlib import Path
import argparse, hashlib, json, sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28-right'))
source=(ROOT/'scripts/cleanup-v28-right/adaptive_patch.py').read_text().split("if __name__=='__main__':")[0]
assert "config['interiorThreshold']<=120" in source
source=source.replace("config['interiorThreshold']<=120", "config['interiorThreshold']<=155")
source=source.replace('protected135Samples','protected155Samples').replace('lostProtected135Samples','lostProtected155Samples').replace('strong=p>=135','strong=p>=155')
source=source.replace("sl=(slice(None),j,slice(None)) if slice_axis==1 else (slice(None),slice(None),j)","sl={0:(slice(None),slice(None),j),1:(slice(None),j,slice(None)),2:(j,slice(None),slice(None))}[slice_axis]")
exec(compile(source,str(ROOT/'scripts/cleanup-v28-right/adaptive_patch.py'),'exec'))

def fields_for(config):
    lo=np.array(config['lowerXYZ']);hi=np.array(config['upperXYZ']);axis=config.get('sliceAxis',1)
    horizontal,vertical=[i for i in range(3) if i!=axis]
    vv,hh=np.mgrid[lo[vertical]:hi[vertical],lo[horizontal]:hi[horizontal]]
    points=np.column_stack([hh.ravel(),vv.ravel()]);fields={}
    for index,polygon in config['polygons'].items():
        inside=Polygon(polygon).contains_points(points).reshape(hh.shape)
        fields[int(index)]=(ndi.distance_transform_edt(inside)-ndi.distance_transform_edt(~inside)).astype(np.float32)
    return fields

def threshold_plane_single(config,fields,index):
    lo=np.array(config['lowerXYZ']);hi=np.array(config['upperXYZ']);keys=sorted(fields);axis=config.get('sliceAxis',1)
    horizontal,vertical=[i for i in range(3) if i!=axis]
    shape=(hi[vertical]-lo[vertical],hi[horizontal]-lo[horizontal])
    if index<keys[0] or index>keys[-1]:return np.full(shape,BASE,np.float32)
    right=min(int(np.searchsorted(keys,index,side='right')),len(keys)-1);left=max(0,right-1)
    a,b=keys[left],keys[right];fraction=0 if a==b else (index-a)/(b-a)
    distance=fields[a]*(1-fraction)+fields[b]*fraction
    weight=smoothstep(distance/config.get('polygonCollarSamples',12)).astype(np.float32)
    vv=np.arange(lo[vertical],hi[vertical])[:,None];hh=np.arange(lo[horizontal],hi[horizontal])[None,:]
    margin=np.minimum(np.minimum(hh-lo[horizontal],hi[horizontal]-1-hh),np.minimum(vv-lo[vertical],hi[vertical]-1-vv))
    margin=np.minimum(margin,min(index-lo[axis],hi[axis]-1-index))
    weight*=smoothstep(margin/config.get('boxCollarSamples',8))
    weight*=smoothstep(min(index-keys[0],keys[-1]-index)/config.get('endCollarSamples',12))
    return (BASE+(config['interiorThreshold']-BASE)*weight).astype(np.float32)

extra_cache={}
def threshold_plane(config,fields,index):
    original=threshold_plane_single(config,fields,index)
    if not config.get('extraPolygons'):return original
    key=id(config)
    if key not in extra_cache:
        extra={**config,'polygons':config['extraPolygons'],'interiorThreshold':config['extraThreshold'],'polygonCollarSamples':config.get('extraCollarSamples',10),'endCollarSamples':10}
        assert BASE<extra['interiorThreshold']<=155
        extra_cache[key]=(extra,fields_for(extra))
    extra,extra_fields=extra_cache[key]
    return np.maximum(original,threshold_plane_single(extra,extra_fields,index))

def main():
    p=argparse.ArgumentParser();p.add_argument('config',type=Path);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    config=json.loads(a.config.read_text());reader=FineSource(12);report=build_patch(reader,config,a.output)
    report.update(builder='scripts/cleanup-v29-right/build_patch.py',upstreamBuilder='scripts/cleanup-v28-right/adaptive_patch.py',upstreamBuilderSha256=hashlib.sha256((ROOT/'scripts/cleanup-v28-right/adaptive_patch.py').read_bytes()).hexdigest(),protectedSmoothedDisplayLevel=155,protectedOriginalDisplayLevel=190)
    (a.output/(config['id']+'-policy.json')).write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':main()
