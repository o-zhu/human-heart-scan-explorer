"""Independent real-source MPR sweeps for specimen echo target selection.

This inspection helper never edits source data or production calibration. It
hash-verifies the resident scan and shows candidate planes around the measured
LV apex/MV axis. The images are interpolation of the real display voxels, not
synthetic anatomy. Candidate labels do not establish clinical correspondence.
"""
from pathlib import Path
import argparse, gzip, hashlib, json
import numpy as np
from scipy.ndimage import map_coordinates
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]

def unit(v):
    v=np.asarray(v,float)
    return v/np.linalg.norm(v)

def rotate(v,axis,angle):
    angle=np.radians(angle);axis=unit(axis)
    return v*np.cos(angle)+np.cross(axis,v)*np.sin(angle)+axis*np.dot(axis,v)*(1-np.cos(angle))

def load_source(donor):
    base=ROOT/'public/assets/donors'/donor
    manifest=json.loads((base/'manifest.json').read_text())
    level=manifest['levels']['high'];dims=np.array(level['dimensions'])
    data=np.zeros(tuple(dims[::-1]),np.uint8);receipt=[]
    for part in level['parts']:
        packed=(ROOT/'public'/part['url']).read_bytes()
        assert hashlib.sha256(packed).hexdigest()==part['sha256']
        count=part['zRange'][1]-part['zRange'][0]
        block=np.frombuffer(gzip.decompress(packed),np.uint8).reshape((count,dims[1],dims[0]))
        if part.get('predictor')=='delta-z':block=np.cumsum(block,axis=0,dtype=np.uint8)
        elif part.get('predictor')=='delta-x':block=np.cumsum(block,axis=2,dtype=np.uint8)
        else:assert not part.get('predictor')
        assert hashlib.sha256(block.tobytes()).hexdigest()==part['rawSha256']
        data[part['zRange'][0]:part['zRange'][1]]=block
        receipt.append({'url':part['url'],'sha256':part['sha256'],'rawSha256':part['rawSha256']})
    extent=np.array(manifest['sourceScaleCenterExtentUm'])/1000
    return data,dims,extent,receipt

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--donor',choices=['s-20-28','s-20-29'],required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--apex',choices=['epicardial','cavity'],default='epicardial')
    args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    data,dims,extent,receipt=load_source(args.donor)
    guides=json.loads((ROOT/'docs/anatomy-donors-v17/source-guides.json').read_text())[args.donor]
    def world(source):
        xyz=(np.asarray(source)+.375-(dims-1)/2)*extent/(dims-1)
        return xyz[[0,2,1]]*np.array([1,1,-1])
    def source(world_mm):
        xyz=world_mm[..., [0,2,1]]*np.array([1,-1,1])
        return (xyz/extent+.5)*(dims-1)
    def track(k):
        values=np.array(guides['tracks'][str(k)],float)
        return [world([v[1],v[2],v[0]]) for v in values]
    last=max(map(int,guides['lvContours']))
    contour=np.asarray(guides['lvContours'][str(last)],float)
    apex=world([*contour.mean(axis=0),last])
    if args.apex=='cavity':apex=track(1)[-1]
    mv=world(guides['valveTransition']['laLv']['centerXYZ'])
    tv=world(guides['valveTransition']['raRv']['centerXYZ'])
    av=world(guides['valveTransition']['aortic']['centerXYZ'])
    points={'apex':apex,'MV':mv,'TV':tv,'AV':av}
    for key,k in [('LV',1),('RV',2),('LA',3),('RA',4)]:points[key]=np.mean(track(k),axis=0)
    axis=unit(mv-apex);side=unit((mv-tv)-axis*np.dot(mv-tv,axis));normal=unit(np.cross(side,axis))
    center=(apex+(points['LA']+points['RA'])/2)/2
    rows=[];records=[];size=380;physical=[125,150]
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',14)
    for label,angles in [('Four-chamber neighbourhood',[-45,-30,-15,0,15,30,45]),('Other LV long-axis rotations',[60,75,90,105,120,135,150])]:
        row=Image.new('RGB',(size*7,(size+52)),(10,18,21));draw=ImageDraw.Draw(row)
        for i,angle in enumerate(angles):
            n=unit(rotate(normal,axis,angle));r=unit(np.cross(axis,n));up=axis
            c=center-n*np.dot(center-mv,n)
            u=(np.linspace(-.5,.5,size)*physical[0])[None,:,None]
            v=(np.linspace(.5,-.5,size)*physical[1])[:,None,None]
            grid=c+u*r+v*up;xyz=source(grid)
            pixels=map_coordinates(data,[xyz[...,2],xyz[...,1],xyz[...,0]],order=1,mode='constant',cval=0,prefilter=False)
            frame=Image.fromarray(pixels).convert('RGB');fd=ImageDraw.Draw(frame)
            misses={key:float(abs(np.dot(value-c,n))) for key,value in points.items()}
            for key,value in points.items():
                if misses[key]>15:continue
                q=value-c;x=(np.dot(q,r)/physical[0]+.5)*(size-1);y=(.5-np.dot(q,up)/physical[1])*(size-1)
                color=(236,181,118) if misses[key]<4 else (119,161,172)
                fd.ellipse([x-2,y-2,x+2,y+2],outline=color,width=1)
                fd.text((x+4,y-7),key,fill=color,font=font)
            row.paste(frame,(i*size,0))
            draw.text((i*size+6,size+3),f'{angle:+d}° | LV {misses["LV"]:.1f} / TV {misses["TV"]:.1f} mm',fill=(224,231,227),font=font)
            draw.text((i*size+6,size+24),label,fill=(150,176,174),font=font)
            records.append({'angleDeg':angle,'plane':{'centerMm':c.tolist(),'right':r.tolist(),'up':up.tolist(),'normal':n.tolist(),'widthMm':physical[0],'heightMm':physical[1]},'landmarkPlaneMissMm':misses})
        rows.append(row)
    canvas=Image.new('RGB',(size*7,(size+52)*2),(10,18,21))
    for i,row in enumerate(rows):canvas.paste(row,(0,i*(size+52)))
    output=args.output/f'{args.donor}-{args.apex}-long-axis-sweep.jpg';canvas.save(output,quality=91)
    report={'donor':args.donor,'sourceParts':receipt,'sourceDimensionsXYZ':dims.tolist(),'sourceExtentMmXYZ':extent.tolist(),'sourceCoordinateOffsetXYZ':[.375]*3,'landmarksMm':{k:v.tolist() for k,v in points.items()},'candidates':records,'clinicalValidated':False,'method':'Independent SciPy trilinear source MPR, complete plane. Candidate landmarks are approximate source guides.'}
    (args.output/f'{args.donor}-{args.apex}-long-axis-sweep.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'output':str(output),'candidates':len(records),'sourcePartsVerified':len(receipt)}))

if __name__=='__main__':main()
