"""Render same-source comparisons and diagnostic checks for v5 candidates."""
from pathlib import Path
import json,argparse
import numpy as np
from scipy import ndimage as ndi
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1];WORK=Path('/workspace/data/anatomy-v5')
PALETTE=np.array([[155,169,176],[227,109,115],[84,166,230],[242,179,107],[99,199,186],[196,153,232],[97,204,224]],float)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)

def sample(a,xyz):
    dims=np.array(a.shape[::-1]);p=np.rint(xyz/np.array([474,474,529])*(dims-1)).astype(int);return a[p[...,2],p[...,1],p[...,0]]

def image(a,labels):
    gray=np.clip((a.astype(float)-15000)/8000,0,1);rgb=np.repeat(gray[...,None]*255,3,axis=2);mask=(a>17300)&(labels>0)
    rgb[mask]=rgb[mask]*.34+PALETTE[labels[mask]]*(.4+.6*gray[mask,None])*.66
    return Image.fromarray(np.uint8(np.clip(rgb,0,255)))

def plane(v,axis,i,left,right,top,bottom):
    a=v[top*2:bottom*2,left*2:right*2,i*2] if axis=='X' else v[top*2:bottom*2,i*2,left*2:right*2] if axis=='Y' else v[i*2,top*2:bottom*2,left*2:right*2]
    yy,xx=np.meshgrid(np.arange(top*2,bottom*2)/2,np.arange(left*2,right*2)/2,indexing='ij');fix=np.full(xx.shape,i)
    xyz=np.stack([fix,xx,yy] if axis=='X' else [xx,fix,yy] if axis=='Y' else [xx,yy,fix],axis=-1)
    return a,xyz

def main():
    global WORK
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--work',type=Path,default=WORK);p.add_argument('--source-s3',type=Path,default=Path('/workspace/data/heart-atlas-cache/s3-volume-u16.npy'));p.add_argument('--working-volume',type=Path,default=Path('/workspace/scratch/7d584d74921e/anatomy-v4/work/working-volume.npy'));a0=p.parse_args();WORK=a0.work
    v=np.load(a0.source_s3,mmap_mode='r')
    methods={'v4':np.load(WORK/'v4-labels.npy'),'watershed':np.load(WORK/'candidate-watershed.npy'),'geodesic':np.load(WORK/'candidate-geodesic.npy'),'hybrid':np.load(WORK/'candidate-hybrid.npy')}
    specs=[('X',237,180,350,170,310),('Y',290,120,285,170,310),('Z',250,120,380,100,360),('X',300,100,375,150,370)]
    names=['Source','v4','watershed','geodesic','hybrid'];cw,ch=510,540
    sheet=Image.new('RGB',(cw*5,ch*len(specs)),(10,16,19));draw=ImageDraw.Draw(sheet)
    for row,spec in enumerate(specs):
        a,xyz=plane(v,*spec)
        for col,name in enumerate(names):
            lab=np.zeros(a.shape,np.uint8) if name=='Source' else sample(methods[name],xyz)
            im=image(a,lab);im.thumbnail((cw-18,ch-62),Image.Resampling.LANCZOS);x=col*cw;y=row*ch
            sheet.paste(im,(x+(cw-im.width)//2,y+42));draw.text((x+10,y+12),f'{name} · {spec[0]}{spec[1]}',font=font,fill='#e1e8e7')
    sheet.save(WORK/'candidate-comparison.jpg',quality=95)
    # Compare a source-root view large enough to inspect continuous wall identity.
    a,xyz=plane(v,'X',237,95,375,65,495);cw,ch=600,980
    sheet=Image.new('RGB',(cw*3,ch),(10,16,19));draw=ImageDraw.Draw(sheet)
    for col,name in enumerate(['Source','v4','hybrid']):
        lab=np.zeros(a.shape,np.uint8) if name=='Source' else sample(methods[name],xyz);im=image(a,lab);im.thumbnail((cw-20,ch-70),Image.Resampling.LANCZOS)
        sheet.paste(im,(col*cw+(cw-im.width)//2,45));draw.text((col*cw+10,13),name,font=font,fill='#e1e8e7')
    sheet.save(WORK/'hybrid-x237-comparison.jpg',quality=96)
    for title,spec in [('rvot',('Y',290,120,285,170,310)),('basal',('Z',250,120,380,100,360)),('atrial',('X',300,100,375,150,370)),('off-axis',('X',275,100,375,170,360))]:
        a,xyz=plane(v,*spec);cw,ch=600,650
        sheet=Image.new('RGB',(cw*3,ch),(10,16,19));draw=ImageDraw.Draw(sheet)
        for col,name in enumerate(['Source','v4','hybrid']):
            lab=np.zeros(a.shape,np.uint8) if name=='Source' else sample(methods[name],xyz);im=image(a,lab);factor=min((cw-20)/im.width,(ch-80)/im.height);im=im.resize((round(im.width*factor),round(im.height*factor)),Image.Resampling.LANCZOS)
            sheet.paste(im,(col*cw+(cw-im.width)//2,45));draw.text((col*cw+12,13),f'{name} · source {spec[0]} = {spec[1]}',font=font,fill='#e1e8e7')
        draw.text((12,ch-25),'Same measured source intensity. Only the regional color annotation changes.',font=font,fill='#b0c1c2')
        sheet.save(WORK/f'hybrid-{title}-comparison.jpg',quality=96)
    tests=[]
    for filename,group,key in [(ROOT/'docs/anatomy/independent-flow-landmarks-v5.json','independentFlowReview','landmarks'),(ROOT/'docs/anatomy/targeted-landmarks-v5.json','targetedErrorReview','points')]:
        for point in json.loads(filename.read_text())[key]:tests.append({**point,'group':group})
    prior=json.loads((ROOT/'docs/anatomy/boundary-validation.json').read_text())['independentLandmarks']['points']
    for point in prior:tests.append({'name':point['name'],'expectedRegion':point['expectedReviewedRegion'],'sourceXYZ':point['sourceXYZ'],'group':'existingV4BoundaryRegression'})
    record={'reviewScope':'Targeted diagnostic regression checks. No expert ground truth or global segmentation accuracy is asserted.','methods':{},'points':[]}
    for point in tests:
        d={**point,'candidateLabels':{name:int(sample(a,np.array(point['sourceXYZ']))) for name,a in methods.items()}}
        record['points'].append(d)
    tissue=np.load(a0.working_volume)>17500
    for name,a in methods.items():
        cases={g:{'matched':sum(p['candidateLabels'][name]==p['expectedRegion'] for p in record['points'] if p['group']==g),'total':sum(p['group']==g for p in record['points'])} for g in ['independentFlowReview','targetedErrorReview','existingV4BoundaryRegression']}
        parts={}
        for k in range(1,7):
            cc,n=ndi.label((a==k)&tissue,structure=ndi.generate_binary_structure(3,2));counts=np.bincount(cc.ravel())[1:];parts[str(k)]={'tissueVoxels':int(counts.sum()),'componentsAtLeast27Voxels':int((counts>=27).sum()),'largestComponentFraction':float(counts.max()/counts.sum()) if len(counts) else 0}
        transitions=np.bincount((methods['v4'][tissue]*7+a[tissue]).astype(np.int64),minlength=49).reshape(7,7)
        record['methods'][name]={'landmarkChecks':cases,'changedMeasuredTissueVoxelsFromV4':int(((a!=methods['v4'])&tissue).sum()),'transitionMatrixRowsV4ColumnsCandidate':transitions.tolist(),'connectedComponents':parts}
    (WORK/'candidate-validation.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({k:v['landmarkChecks'] for k,v in record['methods'].items()}),flush=True)

if __name__=='__main__':main()
