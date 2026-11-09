"""Native source-derived 3D before/after annotation evidence (no Site UI)."""
import argparse, ctypes, json, subprocess
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from scipy import ndimage as ndi

ROOT=Path(__file__).resolve().parents[1]
PALETTE=np.array([[155,169,176],[227,109,115],[84,166,230],[242,179,107],[99,199,186],[196,153,232],[97,204,224]],np.float32)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--work',type=Path,default=Path('/workspace/data/anatomy-v12'));a=p.parse_args();w=a.work
    libpath=w/'anatomy-v12-render.so';source=ROOT/'scripts/anatomy-v12-render.cpp'
    subprocess.run(['g++','-O3','-std=c++17','-shared','-fPIC','-fopenmp',str(source),'-o',str(libpath)],check=True)
    library=ctypes.CDLL(str(libpath));fn=library.render
    u16=np.ctypeslib.ndpointer(np.uint16,ndim=3,flags='C_CONTIGUOUS');f64=np.ctypeslib.ndpointer(np.float64,ndim=1,flags='C_CONTIGUOUS');f32=np.ctypeslib.ndpointer(np.float32,flags='C_CONTIGUOUS')
    fn.argtypes=[u16,ctypes.c_int,ctypes.c_int,ctypes.c_int,f64,f64,f64,f64,ctypes.c_double,ctypes.c_int,ctypes.c_int,ctypes.c_double,f64,ctypes.c_double,ctypes.c_double,f32,f32];fn.restype=None
    v=np.load(w/'working-volume.npy');support=np.load(w/'annotation-support.npy');v=np.ascontiguousarray(np.where(support,v,0),np.uint16)
    candidates={name:np.load(w/(name+'.npy')) for name in ['baseline','hybrid']}
    views=[('rv-cutaway',[-1,-.12,-.1],158.0),('outer-anterior',[-.8,-1,.1],-1),('outer-lateral',[1,-.6,.08],-1),('outer-posterior',[.6,1,0],-1)]
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
    stats={}
    for name,offset,clip in views:
        offset=np.array(offset,float);offset/=np.linalg.norm(offset);direction=-offset
        up=np.array([0.,0.,-1.]);right=np.cross(direction,up);right/=np.linalg.norm(right);up=np.cross(right,direction)
        center=np.array([164.,167.,177.]);origin=center+offset*650
        width,height=720,960;hits=np.full((height,width,3),-1,np.float32);shade=np.zeros((height,width),np.float32)
        clip_normal=np.array([-1.,0.,0.]) if clip>=0 else np.zeros(3,float)
        fn(v,*v.shape[::-1],origin,right,up,direction,.37,width,height,17100.,clip_normal,-clip,0.,hits,shade)
        valid=hits[:,:,0]>=0;xyz=np.maximum(np.rint(hits),0).astype(int);xyz=np.minimum(xyz,np.array(v.shape[::-1])-1)
        fig=Image.new('RGB',(width*2,height+70),(11,17,20));draw=ImageDraw.Draw(fig);stats[name]={}
        for col,(key,labels) in enumerate(candidates.items()):
            lab=labels[xyz[:,:,2],xyz[:,:,1],xyz[:,:,0]]
            rgb=PALETTE[lab]*(shade[:,:,None]*.86+.14)
            rgb[~valid]=[11,17,20]
            fig.paste(Image.fromarray(np.uint8(np.clip(rgb,0,255))),(col*width,55))
            draw.text((col*width+20,16),f'{name} / '+('previous v5' if key=='baseline' else 'v12 source-constrained'),fill=(225,231,232),font=font)
            stats[name][key]={'visiblePixels':int(valid.sum()),'unclassifiedPixels':int((valid&(lab==0)).sum()),'lvPixels':int((valid&(lab==1)).sum()),'rvPixels':int((valid&(lab==2)).sum())}
        target=ROOT/'docs/anatomy-v12'/f'{name}.jpg';fig.save(target,quality=93);print(target,flush=True)
    (ROOT/'docs/anatomy-v12/surface-review.json').write_text(json.dumps(stats,indent=2)+'\n')
    # Match the actual RV-inflow preset, not an orthogonal approximation.
    metadata=json.loads((ROOT/'public/assets/flow-views-v5.json').read_text())
    preset=next(p for p in metadata['presets'] if p['id']=='rv-inflow');frame=preset['source']
    source_scale=(np.array(v.shape[::-1])-1)/(np.array([475,475,530])-1)
    normal_source=np.array(frame['normal']);right_source=np.array(frame['right']);up_source=np.array(frame['up'])
    eye_direction=normal_source+.24*right_source+.10*up_source;eye_direction/=np.linalg.norm(eye_direction)
    up_source=up_source-eye_direction*np.dot(eye_direction,up_source);up_source/=np.linalg.norm(up_source)
    right_source=np.cross(-eye_direction,up_source);right_source/=np.linalg.norm(right_source)
    direction=-eye_direction*source_scale;direction/=np.linalg.norm(direction)
    right=right_source*source_scale;right/=np.linalg.norm(right)
    up=up_source*source_scale;up-=direction*np.dot(up,direction);up/=np.linalg.norm(up)
    origin=(np.array(frame['target'])+eye_direction*preset['cameraDistance']*529)*source_scale
    clip_normal=normal_source/source_scale;clip_normal/=np.linalg.norm(clip_normal)
    clip_distance=float(np.dot(clip_normal,np.array(frame['center'])*source_scale))
    width,height=900,1100;hits=np.full((height,width,3),-1,np.float32);shade=np.zeros((height,width),np.float32)
    fn(v,*v.shape[::-1],origin,right,up,direction,.37,width,height,17100.,clip_normal,clip_distance,.32,hits,shade)
    valid=hits[:,:,0]>=0;xyz=np.maximum(np.rint(hits),0).astype(int);xyz=np.minimum(xyz,np.array(v.shape[::-1])-1)
    source_hits=hits/source_scale
    signed_distance=(source_hits-np.array(frame['center']))@normal_source
    behind_plane=signed_distance<-3 # >0.95 mm from the cut; actual inner surface
    cavity=np.load(w/'cavities.npy');rv_distance=np.load(w/'cavity-2-distance-mm.npy');lv_distance=np.load(w/'cavity-1-distance-mm.npy')
    dr=rv_distance[xyz[:,:,2],xyz[:,:,1],xyz[:,:,0]];dl=lv_distance[xyz[:,:,2],xyz[:,:,1],xyz[:,:,0]]
    # This is a targeted source-cavity proximity region, not global ground truth.
    inside_rv=valid&behind_plane&(dr<=3.0)&(dl>=dr+1)&(source_hits[:,:,2]>=266)&(source_hits[:,:,2]<=460)
    fig=Image.new('RGB',(width*2,height+70),(11,17,20));draw=ImageDraw.Draw(fig)
    focused={'presetId':'rv-inflow','metadata':'public/assets/flow-views-v5.json','sourcePlane':frame,'cameraDistance':preset['cameraDistance'],'cameraDirectionRule':'normalize(normal + 0.24 * right + 0.10 * up)','perspectiveFactor':.32,'measuredThresholdRaw':17100,'sourceCavityReviewRegion':'Visible surface >3 s4 voxels behind the cut plane, <=3 mm from measured RV cavity and at least 1 mm closer to RV than LV, sourceZ 266..460. This is an operational targeted region, not expert ground truth.','candidates':{}}
    for col,(name,labels) in enumerate(candidates.items()):
        lab=labels[xyz[:,:,2],xyz[:,:,1],xyz[:,:,0]];rgb=PALETTE[lab]*(shade[:,:,None]*.86+.14);rgb[~valid]=[11,17,20]
        fig.paste(Image.fromarray(np.uint8(np.clip(rgb,0,255))),(col*width,55))
        draw.text((col*width+20,16),'RV inflow preset / '+('previous v5' if name=='baseline' else 'v12 source-constrained'),font=font,fill=(225,231,232))
        focused['candidates'][name]={'visiblePixels':int(valid.sum()),'rvCavityFacingReviewPixels':int(inside_rv.sum()),'rvLabelsInReviewRegion':int((inside_rv&(lab==2)).sum()),'lvLabelsInReviewRegion':int((inside_rv&(lab==1)).sum()),'otherLabelsInReviewRegion':int((inside_rv&(lab!=1)&(lab!=2)).sum())}
        pink=valid&(lab==1)
        focused['candidates'][name]['LVcutFacePixels']=int((pink&(~behind_plane)).sum())
        focused['candidates'][name]['LVsurfaceBehindPlanePixels']=int((pink&behind_plane).sum())
        if np.any(pink&behind_plane):
            focused['candidates'][name]['LVsurfaceBehindPlaneRVCavityDistanceMmPercentiles']=np.percentile(dr[pink&behind_plane],[0,10,50,90,100]).tolist()
    fig.save(ROOT/'docs/anatomy-v12/rv-inflow-preset.jpg',quality=94)
    np.save(w/'rv-inflow-hit-coordinates.npy',source_hits)
    np.save(w/'rv-inflow-hit-depth.npy',signed_distance)
    (ROOT/'docs/anatomy-v12/rv-inflow-review.json').write_text(json.dumps(focused,indent=2)+'\n')
    print('Wrote actual RV inflow preset comparison',flush=True)

if __name__=='__main__':main()
