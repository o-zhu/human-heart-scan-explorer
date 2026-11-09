"""Reproducible, manually guided regional cardiac tissue labels.

LV / RV colors follow a reviewed compact-myocardial envelope. RA / RV colors
follow source-observed tricuspid hinge curves. Other basal identities are guided
by measured cavity components. No fiber tractography or expert accuracy is claimed.
"""
from pathlib import Path
import argparse, gzip, hashlib, json, shutil
import numpy as np
from scipy import ndimage as ndi
from scipy.interpolate import PchipInterpolator, splprep, splev
from PIL import Image, ImageDraw, ImageFont

PROJECT=Path(__file__).resolve().parents[1]
SRC=np.array([475,475,530]); DIMS=np.array([317,317,354])
SCALE=(DIMS-1)/(SRC-1); SOURCE_SPACING=317.6; GRID_SPACING=SOURCE_SPACING/SCALE
PALETTE={0:'#9ba9b0',1:'#e36d73',2:'#54a6e6',3:'#f2b36b',4:'#63c7ba',5:'#c499e8',6:'#61cce0'}


def arguments():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data-root',type=Path,default=Path.cwd()/'heart-data')
    p.add_argument('--volume',type=Path,help='Original s4 uint16 array, ZYX')
    p.add_argument('--review-volume',type=Path,help='Optional original s3 uint16 array for review images')
    p.add_argument('--work-dir',type=Path,help='Intermediate array directory')
    p.add_argument('--output',type=Path,default=PROJECT/'public/assets/anatomy')
    p.add_argument('--review-output',type=Path,default=PROJECT/'docs/anatomy')
    p.add_argument('--previous-labels',type=Path,help='Optional prior gzip map for before/after evidence')
    p.add_argument('--previous-manifest',type=Path,help='Manifest belonging to --previous-labels')
    return p.parse_args()


def load_working_volume(source,root):
    cache=root/'working-source.json'; target=root/'working-volume.npy'; stat=source.stat()
    identity={'path':str(source),'size':stat.st_size,'mtimeNs':stat.st_mtime_ns,'dimensions':DIMS.tolist(),'sigma':.35}
    if target.exists() and cache.exists() and json.loads(cache.read_text())==identity:
        return np.load(target)
    raw=np.load(source,mmap_mode='r')
    if list(raw.shape)!=SRC[::-1].tolist() or raw.dtype!=np.uint16:
        raise ValueError('Expected the original s4 uint16 ZYX array')
    v=np.empty(tuple(DIMS[::-1]),np.float32)
    yy,xx=np.meshgrid(np.linspace(0,SRC[1]-1,DIMS[1]),np.linspace(0,SRC[0]-1,DIMS[0]),indexing='ij')
    for iz,z in enumerate(np.linspace(0,SRC[2]-1,DIMS[2])):
        lo=int(z);hi=min(lo+1,SRC[2]-1);a=z-lo
        slab=(1-a)*raw[lo].astype(np.float32)+a*raw[hi]
        v[iz]=ndi.map_coordinates(slab,[yy,xx],order=1,prefilter=False)
    v=ndi.gaussian_filter(v,.35).astype(np.uint16)
    np.save(target,v);cache.write_text(json.dumps(identity));return v


def guide(track,z):
    p=np.array(track['points'],float)
    if z<p[0,0]-8 or z>p[-1,0]+8:return None
    return np.array([np.interp(z,p[:,0],p[:,i]) for i in range(1,5)])


def cavity_seeds(v,main,tracks):
    """Extract actual cavity pixels; manual paths identify their anatomy."""
    r=np.arange(-3,4);disk=r[:,None]**2+r[None,:]**2<=9
    cavity=np.zeros(v.shape,np.uint8);records=[]
    for iz in range(v.shape[0]):
        z=iz/SCALE[2];guides={k:guide(s,z) for k,s in tracks.items()}
        guides={k:g for k,g in guides.items() if g is not None}
        if not guides:continue
        closed=ndi.binary_closing(main[iz],structure=disk)
        holes=ndi.binary_fill_holes(closed)&~closed;cc,n=ndi.label(holes);stats=np.bincount(cc.ravel())
        for lab,box in enumerate(ndi.find_objects(cc),1):
            if stats[lab]<5 or stats[lab]>32000:continue
            region=cc[box]==lab;yp,xp=np.nonzero(region)
            xp=(xp+box[1].start)/SCALE[0];yp=(yp+box[0].start)/SCALE[1]
            scores={k:np.quantile(((xp-g[0])/g[2])**2+((yp-g[1])/g[3])**2,.35) for k,g in guides.items()}
            k=min(scores,key=scores.get)
            if scores[k]>1.35:continue
            cavity[iz,box[0],box[1]][region]=k
            if iz%14==0:records.append({'sourceZ':round(z,3),'id':k,'pixels':int(stats[lab]),'centroidXY':[float(xp.mean()),float(yp.mean())]})
        for k,g in guides.items():
            xc,yc=np.round(g[:2]*SCALE[:2]).astype(int);radius=6
            y0,y1=max(1,yc-radius),min(v.shape[1]-1,yc+radius+1)
            x0,x1=max(1,xc-radius),min(v.shape[2]-1,xc+radius+1)
            q=v[iz,y0:y1,x0:x1].astype(float);yy,xx=np.indices(q.shape)
            cost=(yy+y0-yc)**2+(xx+x0-xc)**2+np.maximum(q-17400,0)/180
            iy,ix=np.unravel_index(np.argmin(cost),cost.shape);py,px=y0+iy,x0+ix
            if v[iz,py,px]>=18100:continue
            for dy,dx in [(0,0),(-1,0),(1,0),(0,-1),(0,1)]:
                if v[iz,py+dy,px+dx]<18100 and cavity[iz,py+dy,px+dx]==0:cavity[iz,py+dy,px+dx]=k
    return cavity,records


def lv_envelope(landmarks,source_x,source_y,source_z,key='lvContours'):
    """Smooth signed-distance interpolation of manually reviewed LV contours."""
    contours=landmarks[key];zs=sorted(float(z) for z in contours);fields=[]
    yy,xx=np.meshgrid(source_y*2,source_x*2,indexing='ij')
    for z in zs:
        p=np.array(contours[str(int(z))],float);p=np.vstack([p,p[0]])
        tck,_=splprep(p.T,s=0,per=True,k=min(3,len(p)-2))
        curve=np.array(splev(np.linspace(0,1,1000,endpoint=False),tck)).T
        # Geometry rasterization is finer than the label grid. No image data is invented.
        canvas=Image.new('1',(SRC[0]*2,SRC[1]*2),0);draw=ImageDraw.Draw(canvas)
        draw.polygon([tuple(p*2) for p in curve],fill=1);mask=np.asarray(canvas,dtype=bool)
        field=(ndi.distance_transform_edt(~mask)-ndi.distance_transform_edt(mask))/2
        fields.append(ndi.map_coordinates(field,[yy,xx],order=1,prefilter=False).astype(np.float32))
    interp=PchipInterpolator(np.array(zs),np.stack(fields),axis=0,extrapolate=False)
    result=np.zeros((len(source_z),len(source_y),len(source_x)),bool)
    for i,z in enumerate(source_z):
        if zs[0]<=z<=zs[-1]:result[i]=interp(z)<=0
    return result


def tricuspid_surface(landmarks,source_x,source_y):
    """Bounded surface through the outer groove, free-wall and septal hinge curves."""
    p=np.array(landmarks['tricuspidHingeSourceXYZ'],float);half=len(p)//2
    free,septal=p[:half],p[half:]
    # Off-axis end caps prevent the central RA depth from being extrapolated
    # across lateral sections with no remaining tricuspid inlet.
    free=np.vstack([[125,145,234],[150,145,255],free,[325,193,302],[355,210,285]])
    septal=np.vstack([[125,146,234],[150,161,244],septal,[325,225,292],[355,211,285]])
    x=np.clip(source_x,free[0,0],free[-1,0])
    fy=PchipInterpolator(free[:,0],free[:,1])(x);fz=PchipInterpolator(free[:,0],free[:,2])(x)
    sy=PchipInterpolator(septal[:,0],septal[:,1])(x);sz=PchipInterpolator(septal[:,0],septal[:,2])(x)
    outer=np.array(landmarks['tricuspidOuterGrooveSourceXYZ'],float)
    outer=np.vstack([[125,125,234],[150,118,270],outer,[325,182,302],[355,205,285]])
    oy=PchipInterpolator(outer[:,0],outer[:,1])(x);oz=PchipInterpolator(outer[:,0],outer[:,2])(x)
    result=np.empty((len(source_y),len(source_x)),np.float32)
    for i in range(len(source_x)):
        ys=np.array([oy[i],fy[i],sy[i]])
        zs=np.array([oz[i],fz[i],sz[i]])
        # These three observations constrain the wall thickness as well as the
        # valvar inlet. Clamping beyond the outer/inner points avoids a divergent
        # global plane through unrelated tissue.
        result[:,i]=PchipInterpolator(ys,zs)(np.clip(source_y,ys[0],ys[-1]))
    return result


def classify(v,root,tracks,landmarks):
    source_x=np.linspace(0,SRC[0]-1,DIMS[0]);source_y=np.linspace(0,SRC[1]-1,DIMS[1]);source_z=np.linspace(0,SRC[2]-1,DIMS[2])
    yy,xx=np.meshgrid(source_y,source_x,indexing='ij');cylinder=(xx-237)**2+(yy-237)**2<210**2
    tissue=(v>17500)&cylinder[None,:,:];cc,_=ndi.label(tissue);sizes=np.bincount(cc.ravel());sizes[0]=0
    main=cc==sizes.argmax();del cc,sizes
    support=ndi.binary_dilation(main,iterations=2)
    identity=hashlib.sha256(((root/'working-source.json').read_text()+json.dumps(tracks,sort_keys=True)+'basal-v4-r3-d30-30-27-25').encode()).hexdigest()
    cache=root/'basal-cache.json';cached_labels=root/'basal-territories.npy'
    if cache.exists() and cached_labels.exists() and json.loads(cache.read_text()).get('identity')==identity:
        labels=np.load(cached_labels)
    else:
        cavity,records=cavity_seeds(v,main,tracks)
        np.save(root/'cavity-regions.npy',cavity);(root/'component-review.json').write_text(json.dumps(records,indent=2)+'\n')
        labels=np.zeros(v.shape,np.uint8);best=np.full(v.shape,np.inf,np.float32);sampling=tuple(1/SCALE[::-1])
        # Combine RA/RV for this basal territory step. Their final border is the
        # source-guided annular surface, not a nearest-cavity contest or Z cutoff.
        for label,seeds,max_distance in [(2,(cavity==2)|(cavity==4),30),(3,cavity==3,30),(5,cavity==5,27),(6,cavity==6,25)]:
            distance=ndi.distance_transform_edt(~seeds,sampling=sampling).astype(np.float32)
            choose=support&(distance<=max_distance)&(distance<best)
            labels[choose]=label;best[choose]=distance[choose];del distance
        del best
        np.save(cached_labels,labels);cache.write_text(json.dumps({'identity':identity}))
    surface=tricuspid_surface(landmarks,source_x,source_y);right=labels==2
    labels[right&(source_z[:,None,None]<surface[None,:,:])]=4
    envelope=lv_envelope(landmarks,source_x,source_y,source_z)
    labels[support&envelope]=1
    for k in range(1,7):
        parts,_=ndi.label(labels==k);sizes=np.bincount(parts.ravel());small=sizes<12;small[0]=False;labels[small[parts]]=0
    np.save(root/'tissue-labels.npy',labels);np.save(root/'lv-envelope.npy',envelope);np.save(root/'tricuspid-surface.npy',surface)
    return labels,main


def sample_labels(data,xyz):
    p=np.rint(np.asarray(xyz)/(SRC-1)*(np.array(data.shape[::-1])-1)).astype(int)
    return data[p[...,2],p[...,1],p[...,0]]


def overlay(a,lab,alpha=.64):
    g=np.clip((a.astype(float)-15000)/8000,0,1);im=np.repeat((g*255)[...,None],3,axis=2)
    for k,color in PALETTE.items():
        if k==0:continue
        c=np.array([int(color[i:i+2],16) for i in (1,3,5)]);m=(lab==k)&(a>17300)
        im[m]=im[m]*(1-alpha)+c[None,:]*(.40+.60*g[m,None])*alpha
    return Image.fromarray(np.uint8(np.clip(im,0,255)))


def make_reviews(args,root,data):
    raw=np.load(args.review_volume or args.volume,mmap_mode='r');factor=2 if raw.shape[0]>600 else 1
    def plane(axis,value,lo,hi,top,bottom):
        i=int(value*factor)
        a=raw[top*factor:bottom*factor,lo*factor:hi*factor,i] if axis=='X' else raw[top*factor:bottom*factor,i,lo*factor:hi*factor] if axis=='Y' else raw[i,top*factor:bottom*factor,lo*factor:hi*factor]
        vv,uu=np.meshgrid(np.arange(top*factor,bottom*factor)/factor,np.arange(lo*factor,hi*factor)/factor,indexing='ij');fix=np.full(uu.shape,value)
        xyz=np.stack([fix,uu,vv] if axis=='X' else [uu,fix,vv] if axis=='Y' else [uu,vv,fix],axis=-1)
        return np.array(a),xyz
    ff=Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');font=ImageFont.truetype(str(ff),16) if ff.exists() else ImageFont.load_default()
    old=None
    if args.previous_labels and args.previous_manifest:
        old_dims=json.loads(args.previous_manifest.read_text())['dimensions']
        old=np.frombuffer(gzip.decompress(args.previous_labels.read_bytes()),np.uint8).reshape(old_dims[::-1])
    a,xyz=plane('X',237,95,375,65,495)
    parts=[overlay(a,np.zeros(a.shape,np.uint8)),overlay(a,sample_labels(data,xyz))]
    titles=['Original source tissue','Revised LV / RV and RA / RV boundaries']
    if old is not None:parts.insert(1,overlay(a,sample_labels(old,xyz)));titles.insert(1,'Previous nearest-cavity territories')
    th=860;tw=round(a.shape[1]/a.shape[0]*th);sheet=Image.new('RGB',((tw+20)*len(parts),th+82),(10,16,19));d=ImageDraw.Draw(sheet)
    for j,(part,title) in enumerate(zip(parts,titles)):
        x=j*(tw+20);sheet.paste(part.resize((tw,th),Image.Resampling.LANCZOS),(x+10,44));d.text((x+10,13),title,font=font,fill='#e1e8e7')
    d.text((12,th+55),'Same measured X=237 source section. Colors are annotations; image intensities are unchanged.',font=font,fill='#b0c1c2')
    sheet.save(root/'anatomy-x237-before-after.jpg',quality=96)
    specs=[('X',200,90,375,210,470),('X',275,100,380,210,460),('Y',200,100,365,210,480),('Y',275,100,385,210,480)]
    cw,ch=520,600;sheet=Image.new('RGB',(cw*4,ch),(10,16,19));d=ImageDraw.Draw(sheet)
    for j,(axis,value,lo,hi,top,bottom) in enumerate(specs):
        a,xyz=plane(axis,value,lo,hi,top,bottom);part=overlay(a,sample_labels(data,xyz));part.thumbnail((500,540),Image.Resampling.LANCZOS)
        x=j*cw;sheet.paste(part,(x+(cw-part.width)//2,46));d.text((x+12,15),f'Source {axis} = {value}',font=font,fill='#e1e8e7')
    sheet.save(root/'anatomy-long-axis-review.jpg',quality=96)
    zs=[160,220,250,270,290,310,340,380,420,460,475,490];cw,ch=420,455;sheet=Image.new('RGB',(cw*4,ch*3),(10,16,19));d=ImageDraw.Draw(sheet)
    for j,z in enumerate(zs):
        a,xyz=plane('Z',z,95,390,90,385);part=overlay(a,sample_labels(data,xyz)).resize((400,400),Image.Resampling.LANCZOS)
        x=j%4*cw;y=j//4*ch;sheet.paste(part,(x+10,y+38));d.text((x+12,y+11),f'Source Z = {z}',font=font,fill='#e1e8e7')
    sheet.save(root/'anatomy-axial-review.jpg',quality=96)
    a,xyz=plane('Z',220,95,390,90,385);pair=Image.new('RGB',(1040,580),(10,16,19));d=ImageDraw.Draw(pair)
    for j,part in enumerate([overlay(a,np.zeros(a.shape,np.uint8)),overlay(a,sample_labels(data,xyz))]):pair.paste(part.resize((500,500),Image.Resampling.LANCZOS),(j*520+10,40))
    d.text((12,12),'Original basal source Z = 220',font=font,fill='#e1e8e7');d.text((532,12),'Revised regional labels',font=font,fill='#e1e8e7')
    pair.save(root/'anatomy-basal-comparison.jpg',quality=96)


def package(args,root,v,data,tracks,landmarks):
    raw=data.tobytes();packed=gzip.compress(raw,compresslevel=9,mtime=0);out=args.output.resolve();out.mkdir(parents=True,exist_ok=True);(out/'labels.raw.gz').write_bytes(packed)
    descriptions={
        1:'Continuous LV myocardial body, including the compact interventricular septum under this display convention. The RV-facing compact-muscle edge was traced across source sections instead of dividing the wall by distance to a cavity.',
        2:'RV free wall, nonseptal trabeculated structures and outflow territory. The compact septal myocardium is displayed with the LV; the RA transition follows reviewed tricuspid hinge curves.',
        3:'Collapsed left-atrial region identified from the published basal slice and followed through the source volume. Mitral, appendage and pulmonary-vein boundaries remain provisional.',
        4:'Right-atrial wall and pectinate region above the source-guided curved tricuspid junction. Its inferior free-wall fold is retained rather than cut off at a constant scan height.',
        5:'Vessel continuous with the three-sinus aortic root and LV outflow. Identity is supported by the matching published basal slice; precise root and coronary boundaries remain approximate.',
        6:'Pulmonary trunk and outflow region adjacent to the aortic root and toward the RV. Distal branches and the valvar boundary remain approximate.'}
    labels=[{'id':0,'key':'unclassified','name':'Unclassified tissue','color':PALETTE[0],'confidence':'Unclassified','description':'Tissue outside the six regional annotations remains neutral. Coronary, cardiac venous, individual pulmonary-vein and caval identities are not separately inferred.','method':'No anatomical identity is asserted.'}]
    anchors={1:[237,236,340],2:[150,180,350],3:[326,269,220],4:[237,153,280],5:[197,249,160],6:[204,365,160]}
    for k,s in tracks.items():
        coords=np.argwhere(data==k);lo=coords.min(0)[::-1];hi=coords.max(0)[::-1]
        tc=np.argwhere((data==k)&(v>17700));sc=tc[:,::-1]/SCALE;picked=sc[np.argmin(np.sum((sc-np.array(anchors[k]))**2,axis=1))]
        labels.append({'id':k,'key':s['key'],'name':s['name'],'color':s['color'],'confidence':s['confidence'],'description':descriptions[k],'method':'Source-guided LV myocardial-envelope contours and tricuspid hinge curves; measured-cavity tracking for basal identities.','voxelCount':int(len(coords)),'boundsNormalizedXYZ':[(lo/(DIMS-1)).tolist(),(hi/(DIMS-1)).tolist()],'referenceAnchorSourceXYZ':np.round(picked,4).tolist()})
    manifest={
        'schemaVersion':2,'revision':'source-contours-v4','title':'Source-guided regional anatomy','specimen':'LADAF-2021-17',
        'datasetUrl':'https://human-organ-atlas.esrf.fr/datasets/1659197537','sourceDoi':'10.15151/ESRF-DC-1634390196','sourceLicense':'CC BY 4.0','sourceAttribution':'Brunet et al. / ESRF Human Organ Atlas',
        'dimensions':DIMS.tolist(),'volumeUrl':'./assets/anatomy/labels.raw.gz','arrayOrder':'ZYX in NumPy; X-fastest bytes','dtype':'uint8','registration':'Endpoints match original s4 voxel centers [0,0,0] and [474,474,529]. Sample nearest at round(sourceNormalizedXYZ*(dimensions-1)).','sourceDimensionsXYZ':SRC.tolist(),'sourceSpacingUm':SOURCE_SPACING,'labelGridSpacingUmXYZ':np.round(GRID_SPACING,6).tolist(),
        'rendering':'Labels tint independently measured tissue density; labels must never be rendered as filled chamber contents.','compressedBytes':len(packed),'decodedBytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'compressedSha256':hashlib.sha256(packed).hexdigest(),
        'method':'Manually reviewed compact-LV myocardial contours are interpolated through the volume as smooth signed-distance fields. The entire compact septal wall receives LV identity under an explicit display convention. Right-heart tissue is divided using source-observed free-wall and septal tricuspid hinge curves interpolated across the heart. Actual cavity components guide atrial/outflow identities. Fixed axial chamber cutoffs and competing LV/RV nearest-cavity wall division are not used.',
        'methodParameters':{'s4ThresholdIntensity':17500,'workingGaussianSigma':.35,'sourceReviewSamplingUm':158.8,'lvContourCount':len(landmarks['lvContours']),'tricuspidHingeLandmarkCount':len(landmarks['tricuspidHingeSourceXYZ']),'tricuspidOuterGrooveLandmarkCount':len(landmarks['tricuspidOuterGrooveSourceXYZ']),'lvContourInterpolation':'Periodic cubic section curves; PCHIP signed-distance interpolation between axial contours','annularInterpolation':'Shape-preserving outer groove, free-wall and septal hinge curves across source X; bounded PCHIP interpolation through those three observations in source Y','rightHeartMaximumAssignmentDistanceMm':9.528,'supportDilationWorkingVoxels':2,'minimumLabelIslandVoxels':12},
        'septalDisplayConvention':landmarks['lvConvention'],
        'validation':'Source morphology and held-out tissue landmarks are reviewed in central and off-axis longitudinal planes and multiple axial levels. There is no expert reference segmentation, measured Dice score or validated fiber tractography.',
        'limitations':['Manual regional annotations, not expert ground-truth chamber, valve, myocardial-layer or vessel-lumen segmentation.','The compact interventricular septum is shared anatomy; it is colored with the LV myocardial body as an explicit display convention.','Tricuspid hinge locations are visually estimated; mitral, outflow, appendage and distal vascular boundaries remain approximate.','No muscle fiber tractography has been computed. Curves follow visible tissue morphology and continuity.','Coronary arteries, cardiac veins, separate pulmonary veins and caval veins are not individually segmented.','Do not use these regional labels for quantitative chamber volume, wall thickness, procedural or diagnostic measurements.'],
        'sourceReferences':[{'title':'Original LADAF-2021-17 complete-heart dataset','url':'https://human-organ-atlas.esrf.fr/datasets/1659197537'},{'title':'Brunet et al., 2023 preprint, Figures 3 and 5','url':'https://pmc.ncbi.nlm.nih.gov/articles/PMC10592740/'},{'title':'Brunet et al., Radiology 2024;312(1):e232731','url':'https://doi.org/10.1148/radiol.232731'}],
        'labels':labels,'generatedDate':'2026-11-04','generator':'scripts/prepare_anatomy.py','supportsQuantification':False}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    docs=args.review_output.resolve();docs.mkdir(parents=True,exist_ok=True)
    for filename in ['anatomy-x237-before-after.jpg','anatomy-long-axis-review.jpg','anatomy-axial-review.jpg','anatomy-basal-comparison.jpg','component-review.json']:shutil.copy2(root/filename,docs/filename)
    return manifest


def main():
    args=arguments();args.volume=(args.volume or args.data_root/'s4-volume-u16.npy').resolve()
    root=(args.work_dir or args.data_root/'anatomy-v4-work').resolve();root.mkdir(parents=True,exist_ok=True)
    tracks={int(k):v for k,v in json.loads((PROJECT/'docs/anatomy/cavity-tracks.json').read_text()).items()}
    landmarks=json.loads((PROJECT/'docs/anatomy/boundary-landmarks.json').read_text())
    v=load_working_volume(args.volume,root);print('Working volume',v.shape,flush=True)
    data,main_mask=classify(v,root,tracks,landmarks);print('Regional labels',dict(zip(*np.unique(data,return_counts=True))),flush=True)
    make_reviews(args,root,data);manifest=package(args,root,v,data,tracks,landmarks)
    print(json.dumps({'dimensions':manifest['dimensions'],'bytes':manifest['compressedBytes'],'rawBytes':manifest['decodedBytes'],'sha256':manifest['sha256']}),flush=True)


if __name__=='__main__':main()
