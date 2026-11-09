"""Build independent, source-guided approximate regional labels for S donors.

Only the categorical annotation volume is generated. Scan values, cleanup,
registration, geometry, source windows and clinical presets are never modified.
The closed source cavities, compact myocardial contours and local valve gates
are manually identified in each donor; none come from the LADAF label map.
"""
from pathlib import Path
import argparse, ctypes, gzip, hashlib, importlib.util, json, subprocess, time
import numpy as np
from scipy import ndimage as ndi
from scipy.interpolate import PchipInterpolator
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
DOCS=ROOT/'docs/anatomy-donors-v17'
PALETTE=np.array([[155,169,176],[227,109,115],[84,166,230],[242,179,107],[99,199,186],[196,153,232],[97,204,224]],np.uint8)
NAMES=['Unassigned tissue','Left ventricle','Right ventricle','Left atrium','Right atrium','Aortic outflow','Pulmonary outflow']
KEYS=['unclassified','lv','rv','la','ra','aorta','pulmonary']
COLORS=['#9ba9b0','#e36d73','#54a6e6','#f2b36b','#63c7ba','#c499e8','#61cce0']

def save_json(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(obj,indent=2,allow_nan=False)+'\n')

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(4*1024**2),b''):h.update(block)
    return h.hexdigest()

def largest(mask):
    if not np.any(mask):return np.zeros_like(mask,dtype=bool)
    cc,_=ndi.label(mask,structure=ndi.generate_binary_structure(3,2))
    count=np.bincount(cc.ravel());count[0]=0
    return cc==count.argmax()

class Donor:
    def __init__(self,slug,work,data):
        self.slug=slug;self.work=work/slug;self.work.mkdir(parents=True,exist_ok=True)
        self.output=ROOT/'public/assets/donors'/slug/'anatomy'
        self.docs=DOCS/slug;self.docs.mkdir(parents=True,exist_ok=True)
        self.guides=json.loads((DOCS/'source-guides.json').read_text())[slug]
        self.meta=json.loads((self.output/'manifest.json').read_text())
        self.scan=json.loads((self.output.parent/'manifest.json').read_text())
        self.src=np.array(self.meta['sourceDimensionsXYZ'])
        self.spacing=np.array(self.meta['sourceSpacingUm'])/1000
        self.dims=np.array([317,317,int(round((self.src[2]-1)/(self.src[0]-1)*316))+1])
        self.shape=tuple(self.dims[::-1]);self.gridspacing=self.spacing*(self.src-1)/(self.dims-1)
        self.rawpath=data/('heart-donor-'+self.guides['datasetId'])/'source-high-u16.npy'
        self.axes=[np.linspace(0,self.src[i]-1,self.dims[i])-.375 for i in range(3)]
        self.yy,self.xx=np.meshgrid(self.axes[1],self.axes[0],indexing='ij')
        self.z=self.axes[2][:,None,None]

    def prepare(self):
        path=self.work/'working-volume.npy'
        identity={'sourceSha256':sha(self.rawpath),'dimensionsXYZ':self.dims.tolist(),
                  'displayDimensionsXYZ':self.src.tolist(),'sourceCoordinateOffsetXYZ':[-.375]*3,
                  'sigmaLabelGridVoxels':.25}
        cache=self.work/'working-source.json'
        if not path.exists() or not cache.exists() or json.loads(cache.read_text())!=identity:
            raw=np.load(self.rawpath,mmap_mode='r')
            v=np.empty(self.shape,np.uint16)
            for iz,z in enumerate(self.axes[2]):
                q=ndi.map_coordinates(raw,[np.full(self.xx.shape,z),self.yy,self.xx],order=1,mode='nearest',prefilter=False)
                v[iz]=q
            v=ndi.gaussian_filter(v.astype(np.float32),.25).astype(np.uint16)
            np.save(path,v);save_json(cache,identity)
        self.v=np.load(path)
        self.core=largest((self.v>self.guides['coreThreshold'])&(((self.xx-237)**2+(self.yy-237)**2)<215**2)[None,:,:])
        collar=ndi.binary_dilation(self.core,iterations=4)
        measured=(self.v>self.guides['supportThreshold'])&collar
        self.support=ndi.binary_dilation(measured,iterations=1)&collar
        np.save(self.work/'source-core.npy',self.core);np.save(self.work/'annotation-support.npy',self.support)
        save_json(self.docs/'source-provenance.json',dict(identity,datasetId=self.guides['datasetId'],
            datasetUrl=self.meta['datasetUrl'],originalDimensionsXYZ=list(np.load(self.rawpath,mmap_mode='r').shape[::-1]),
            sourceOrder='ZYX; X fastest',sourceDtype='uint16',sourceSpacingMmXYZ=self.spacing.tolist(),
            sourceCoordinateRule='At display-normalized t, original s4 coordinate = t * (displayHighDimensions - 1) - 0.375. The offset registers original s4 centers to the first source fine voxel center.',
            expertValidated=False,otherDonorLabelsUsed=False,sourceIntensityChanged=False))

    def track(self,k,z):
        p=np.asarray(self.guides['tracks'][str(k)],float)
        if z<p[0,0]-2 or z>p[-1,0]+2:return None
        return np.array([np.interp(z,p[:,0],p[:,i]) for i in range(1,5)])

    def gate(self,name):
        p=self.guides['valveTransition'][name];x,y,z=p['centerXYZ'];a,b=p['zFromXY']
        # These local surfaces only gate a tracked source cavity region; they
        # never divide the whole donor or a shared valve into a clinical class.
        return z+a*(self.xx-x)+b*(self.yy-y)

    def extract_cavities(self):
        cavity=np.zeros(self.shape,np.uint8);record=[];fallback=0
        r=np.arange(-2,3);disk=r[:,None]**2+r[None,:]**2<=4
        for iz,z in enumerate(self.axes[2]):
            closed=ndi.binary_closing(self.core[iz],structure=disk)
            holes=ndi.binary_fill_holes(closed)&~closed
            cc,n=ndi.label(holes);counts=np.bincount(cc.ravel())
            for k in range(1,7):
                g=self.track(k,z)
                if g is None:continue
                cx,cy,rx,ry=g;q=((self.xx-cx)/rx)**2+((self.yy-cy)/ry)**2
                candidates=np.unique(cc[(q<.55)&(self.v[iz]<self.guides['cavityThreshold'])]);candidates=candidates[candidates>0]
                chosen=np.zeros(self.shape[1:],bool)
                for lab in candidates:
                    region=cc==lab
                    if counts[lab]<6 or counts[lab]>18000:continue
                    if np.quantile(q[region],.40)>1.8:continue
                    chosen|=region&(q<2.1)
                chosen&=self.v[iz]<self.guides['cavityThreshold']
                if np.count_nonzero(chosen)<8:
                    # Open acquisition ends cannot form a 2D enclosed hole.
                    # Keep only source-low pixels in the reviewed lumen core.
                    chosen=(q<.28)&(self.v[iz]<self.guides['cavityThreshold'])
                    fallback+=1
                if k==6 and 'pulmonaryPosteriorBoundarySourceZY' in self.guides:
                    boundary=np.asarray(self.guides['pulmonaryPosteriorBoundarySourceZY'])
                    chosen&=self.yy>np.interp(z,boundary[:,0],boundary[:,1])
                selected=chosen&(cavity[iz]==0)
                cavity[iz,selected]=k
                if iz%12==0 and np.any(selected):
                    sy,sx=np.nonzero(selected)
                    record.append({'sourceZ':round(float(z),3),'id':k,'pixels':int(selected.sum()),
                                   'centroidSourceXY':[float(self.axes[0][sx].mean()),float(self.axes[1][sy].mean())]})
        np.save(self.work/'cavities.npy',cavity)
        save_json(self.docs/'cavity-review.json',{'method':'Actual low-density pixels within source tissue holes, identified with donor-specific trajectories. At open tube/atrial acquisition ends, conservative low-density lumen-core pixels replace a closed hole.','fallbackSliceRegions':fallback,'components':record})
        self.cavity=cavity
        for k in range(1,7):
            if not np.any(cavity==k):raise ValueError(f'No source cavity for region {k}')
            d=ndi.distance_transform_edt(cavity!=k,sampling=self.gridspacing[::-1]).astype(np.float32)
            np.save(self.work/f'cavity-{k}-distance-mm.npy',d)

    def lv_envelope(self):
        contours=self.guides['lvContours'];zs=sorted(map(float,contours));fields=[]
        for z in zs:
            canvas=Image.new('1',(self.src[0]*2,self.src[1]*2),0)
            ImageDraw.Draw(canvas).polygon([tuple(np.array(p)*2) for p in contours[str(int(z))]],fill=1)
            m=np.asarray(canvas,bool)
            signed=(ndi.distance_transform_edt(~m)-ndi.distance_transform_edt(m))/2
            fields.append(ndi.map_coordinates(signed,[self.yy*2,self.xx*2],order=1,mode='nearest',prefilter=False))
        fn=PchipInterpolator(zs,np.stack(fields),axis=0,extrapolate=False)
        envelope=np.zeros(self.shape,bool)
        for iz,z in enumerate(self.axes[2]):
            if zs[0]<=z<=zs[-1]:envelope[iz]=fn(z)<=0
        np.save(self.work/'lv-envelope.npy',envelope)
        return envelope

    def candidates(self):
        dist={k:np.load(self.work/f'cavity-{k}-distance-mm.npy',mmap_mode='r') for k in range(1,7)}
        near=np.zeros(self.shape,np.uint8);best=np.full(self.shape,np.inf,np.float32)
        maxdist={1:27,2:13,3:9,4:9,5:5,6:4.8}
        gates={3:self.gate('laLv'),4:self.gate('raRv'),5:self.gate('aortic'),6:self.gate('pulmonary')}
        allowed=np.zeros(self.shape,np.uint8)
        for k in range(1,7):
            permit=self.support&(dist[k]<=maxdist[k])
            if k>=3:permit&=self.z<gates[k][None,:,:]+2
            if k==2:permit&=self.z>self.gate('raRv')[None,:,:]-10
            if k==1:permit&=self.z>self.gate('laLv')[None,:,:]-25
            allowed[permit]|=np.uint8(1<<k)
            win=permit&(dist[k]<best);near[win]=k;best[win]=dist[k][win]
        np.save(self.work/'nearest-cavity.npy',near)
        envelope=self.lv_envelope()
        markers=np.zeros(self.shape,np.uint8)
        for k in range(1,7):
            pick=self.core&(near==k)&(dist[k]<1.6)
            markers[pick]=k
        # A thick septal body cannot be partitioned fairly by nearest lumen.
        # Deep reviewed compact myocardium supplies additional LV markers.
        compact=self.core&envelope&(dist[2]>3)&(dist[3]>2.5)&(dist[5]>2.5)&(dist[6]>2.5)
        markers[compact]=1;allowed[envelope&self.support]|=np.uint8(1<<1)
        spec=importlib.util.spec_from_file_location('anatomy_methods',ROOT/'scripts/anatomy-v5-methods.py')
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        # Normalize only the annotation cost input so the helper's low-density
        # penalty has the same meaning for both raw-intensity scales.
        image=np.clip(self.v.astype(np.int32)-self.guides['coreThreshold']+17500,0,65535).astype(np.uint16)
        geodesic,path=mod.geodesic(image,self.support,markers,self.work,edge_scale=900,gap_penalty=2.5,max_cost=65,allowed=allowed)
        np.save(self.work/'geodesic.npy',geodesic);np.save(self.work/'seed-markers.npy',markers)
        hybrid=geodesic.copy()
        hybrid[(hybrid==0)&(near>0)]=near[(hybrid==0)&(near>0)]
        # The compact myocardial boundary follows source-reviewed contours,
        # while the tissue shell facing the RV receives RV regional ownership.
        compact_roi=envelope&self.support
        hybrid[compact_roi]=1
        shell=(dist[2]<=1.75)&(dist[1]>=dist[2]+1.0)&(self.z>self.gate('raRv')[None,:,:]+12)
        rv_surface=compact_roi&shell
        rv_trab=compact_roi&(dist[2]<2.6)&(dist[1]>dist[2]+2.3)&ndi.binary_dilation(rv_surface,iterations=2)
        hybrid[rv_surface|rv_trab]=2
        # Recover only each tracked artery's measured bright wall; the local
        # hinge guard avoids recoloring adjacent basal ventricular myocardium.
        for k,key in [(5,'aortic'),(6,'pulmonary')]:
            roi=self.support&(dist[k]<4.2)&(self.z<gates[k][None,:,:]-2)
            for iz,z in enumerate(self.axes[2]):
                g=self.track(k,z)
                if g is None:roi[iz]=False;continue
                cx,cy,rx,ry=g;roi[iz]&=((self.xx-cx)/rx)**2+((self.yy-cy)/ry)**2<2.8
            bright=largest(roi&(self.v>self.guides['coreThreshold']+700))
            collar=ndi.distance_transform_edt(~bright,sampling=self.gridspacing[::-1])
            wall=roi&(collar<1.7)&(dist[k]<4.2)&(dist[k]<np.minimum(dist[3],dist[4])+1)
            hybrid[wall]=k
        # Keep the uncertain +/-0.95 mm transition collar neutral only where
        # both distinct source regions compete. This is not a valve segment.
        uncertain=np.zeros(self.shape,bool)
        for a,b,key in [(4,2,'raRv'),(3,1,'laLv'),(5,1,'aortic'),(6,2,'pulmonary')]:
            g=self.gate(key);w=self.guides['valveTransition'][key]['uncertainHalfWidthSourceVoxels']
            collar=(abs(self.z-g[None,:,:])<w)&(dist[a]<3)&(dist[b]<3)
            uncertain|=collar&self.support
        hybrid[uncertain]=0
        # Remove isolated label islands without expanding any anatomical mask.
        for k in range(1,7):
            cc,_=ndi.label(hybrid==k,structure=ndi.generate_binary_structure(3,2));counts=np.bincount(cc.ravel())
            remove=counts<20;remove[0]=False;hybrid[remove[cc]]=0
        np.save(self.work/'hybrid.npy',hybrid);np.save(self.work/'uncertain-transition.npy',uncertain)
        result={}
        for name,a in [('nearest-cavity',near),('tissue-geodesic',geodesic),('source-constrained-hybrid',hybrid)]:
            result[name]={'annotatedVoxels':int(np.count_nonzero(a)),
                'labelCounts':{str(k):int(np.count_nonzero(a==k)) for k in range(7)},
                'neutralMeasuredSupportVoxels':int(np.count_nonzero(self.support&(a==0))),
                'disagreesWithSelectedVoxels':int(np.count_nonzero(a!=hybrid)),
                'compactLVEnvelopeLabeledLVFraction':float(np.count_nonzero(compact_roi&(a==1))/max(1,np.count_nonzero(compact_roi)))}
        save_json(self.docs/'method-comparison.json',{'selected':'source-constrained-hybrid','reason':'Nearest-cavity territory cuts into thick compact septum; unrestricted tissue travel can cross shared basal wall bridges. The selected method protects the donor-specific compact LV envelope, retains RV-facing surface ownership, and limits great-vessel color to tracked source walls with explicit uncertain transition collars.','candidates':result})
        self.labels=hybrid

    def sample(self,labels,xyz):
        idx=np.rint((np.asarray(xyz)+.375)/(self.src-1)*(self.dims-1)).astype(int)
        idx=np.clip(idx,0,self.dims-1)
        return labels[idx[...,2],idx[...,1],idx[...,0]]

    def source_reviews(self):
        raw=np.load(self.rawpath,mmap_mode='r');lo,hi=self.guides['window']
        font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
        planes=[('Z',130),('Z',190),('Z',250),('Z',330),('Y',170),('Y',230),('Y',285),('X',250)]
        for page in range(2):
            sheet=Image.new('RGB',(1080,1680),'#0b1114');draw=ImageDraw.Draw(sheet)
            for row,(axis,i) in enumerate(planes[page*4:page*4+4]):
                p=raw[i] if axis=='Z' else raw[:,i,:] if axis=='Y' else raw[:,:,i]
                vv,uu=np.indices(p.shape);fix=np.full(p.shape,i)
                xyz=np.stack([uu,vv,fix] if axis=='Z' else [uu,fix,vv] if axis=='Y' else [fix,uu,vv],axis=-1)
                labels=self.sample(self.labels,xyz);g=np.clip((p.astype(float)-lo)/(hi-lo),0,1)**.9
                gray=np.repeat((g*255)[...,None],3,axis=2);overlay=gray.copy()
                mask=(labels>0)&(p>self.guides['supportThreshold'])
                overlay[mask]=gray[mask]*.34+PALETTE[labels[mask]]*(.40+.60*g[mask,None])*.66
                for col,a in enumerate([gray,overlay]):
                    im=Image.fromarray(np.uint8(np.clip(a,0,255)));im.thumbnail((520,380))
                    sheet.paste(im,(col*540+(540-im.width)//2,row*420+30))
                    draw.text((col*540+10,row*420+5),f'{self.slug} {axis}={i} / '+('measured source' if col==0 else 'approximate regional colors'),font=font,fill='white')
            sheet.save(self.docs/f'source-overlay-{page+1}.jpg',quality=92)
        self.outflow_review(raw)

    def outflow_review(self,raw):
        lo,hi=self.guides['window'];font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
        sheet=Image.new('RGB',(1120,1260),'#0b1114');draw=ImageDraw.Draw(sheet)
        for row,(name,points) in enumerate(self.guides['outflowReview'].items()):
            p0,p1,p2=np.array(points,float);up=p2-p0;up/=np.linalg.norm(up);normal=np.cross(up,p1-p0);normal/=np.linalg.norm(normal);right=np.cross(up,normal);origin=(p0+p2)/2
            xx,yy=np.meshgrid(np.linspace(-160,160,560),np.linspace(180,-180,600));xyz=origin+xx[...,None]*right+yy[...,None]*up
            q=ndi.map_coordinates(raw,xyz[...,::-1].transpose(2,0,1),order=1,mode='constant',cval=lo,prefilter=False).astype(float)
            g=np.clip((q-lo)/(hi-lo),0,1)**.9;gray=np.repeat((g*255)[...,None],3,axis=2);lab=self.sample(self.labels,xyz)
            colored=gray.copy();m=(lab>0)&(q>self.guides['supportThreshold']);colored[m]=gray[m]*.30+PALETTE[lab[m]]*(.4+.6*g[m,None])*.70
            for col,a in enumerate([gray,colored]):
                im=Image.fromarray(np.uint8(np.clip(a,0,255)));di=ImageDraw.Draw(im)
                for n,p in enumerate([p0,p1,p2],1):
                    x=(np.dot(p-origin,right)+160)/320*559;y=(180-np.dot(p-origin,up))/360*599
                    di.ellipse((x-4,y-4,x+4,y+4),outline='#f3d8a9',width=2);di.text((x+7,y-7),str(n),font=font,fill='#f3d8a9')
                sheet.paste(im,(col*560,row*630+30));draw.text((col*560+8,row*630+6),self.slug+' '+name+' / '+('source' if col==0 else 'regional overlay'),font=font,fill='white')
        sheet.save(self.docs/'outflow-continuity.jpg',quality=93)

    def surface_reviews(self):
        libpath=self.work/'native-render.so';cpp=ROOT/'scripts/anatomy-v12-render.cpp'
        subprocess.run(['g++','-O3','-std=c++17','-shared','-fPIC','-fopenmp',str(cpp),'-o',str(libpath)],check=True)
        lib=ctypes.CDLL(str(libpath));fn=lib.render
        u16=np.ctypeslib.ndpointer(np.uint16,ndim=3,flags='C_CONTIGUOUS');f64=np.ctypeslib.ndpointer(np.float64,ndim=1,flags='C_CONTIGUOUS');f32=np.ctypeslib.ndpointer(np.float32,flags='C_CONTIGUOUS')
        fn.argtypes=[u16,ctypes.c_int,ctypes.c_int,ctypes.c_int,f64,f64,f64,f64,ctypes.c_double,ctypes.c_int,ctypes.c_int,ctypes.c_double,f64,ctypes.c_double,ctypes.c_double,f32,f32];fn.restype=None
        v=np.ascontiguousarray(np.where(self.support,self.v,0),np.uint16)
        bb=np.argwhere(self.core);center=(bb.min(0)+bb.max(0))[::-1]/2
        font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17);stats={}
        views=[('exterior-front',[-.7,-1,.05],None),('exterior-back',[.7,1,-.02],None),('long-axis-cut',[0,-1,-.03],230),('cross-axis-cut',[-1,0,-.02],250)]
        for name,offset,cut in views:
            offset=np.array(offset,float);offset/=np.linalg.norm(offset);direction=-offset
            up=np.array([0.,0.,-1.]);right=np.cross(direction,up);right/=np.linalg.norm(right);up=np.cross(right,direction);origin=center+offset*600
            normal=np.zeros(3,float);clip=0.
            if cut is not None:
                axis=1 if name.startswith('long') else 0;normal[axis]=-1
                clip=-(cut+.375)/(self.src[axis]-1)*(self.dims[axis]-1)
            width,height=520,700;hits=np.full((height,width,3),-1,np.float32);shade=np.zeros((height,width),np.float32)
            fn(v,*v.shape[::-1],origin,right,up,direction,.48,width,height,float(self.guides['supportThreshold']),normal,float(clip),0.,hits,shade)
            valid=hits[:,:,0]>=0;idx=np.minimum(np.maximum(np.rint(hits),0).astype(int),self.dims-1)
            lab=self.labels[idx[:,:,2],idx[:,:,1],idx[:,:,0]]
            sheet=Image.new('RGB',(1040,740),'#0b1114');draw=ImageDraw.Draw(sheet)
            for col,color in enumerate([np.tile(PALETTE[0],(*lab.shape,1)),PALETTE[lab]]):
                rgb=color*(shade[:,:,None]*.86+.14);rgb[~valid]=[11,17,20]
                sheet.paste(Image.fromarray(np.uint8(np.clip(rgb,0,255))),(col*520,35))
                draw.text((col*520+10,7),self.slug+' '+name+' / '+('source surface' if col==0 else 'approximate colors'),font=font,fill='white')
            sheet.save(self.docs/(name+'.jpg'),quality=92)
            stats[name]={'visiblePixels':int(valid.sum()),'neutralVisiblePixels':int((valid&(lab==0)).sum()),'visibleLabelCounts':{str(k):int((valid&(lab==k)).sum()) for k in range(7)}}
        save_json(self.docs/'surface-review.json',{'rendering':'Native CPU raycast of this donor source; geometry held fixed. Not a website screenshot.','views':stats})

    def package(self):
        raw=self.labels.tobytes();packed=gzip.compress(raw,compresslevel=9,mtime=0);digest=hashlib.sha256(raw).hexdigest()
        filename=f'labels-v17-{digest[:12]}.raw.gz';(self.output/filename).write_bytes(packed)
        records=[]
        for k in range(7):
            coords=np.argwhere(self.labels==k);n=int(len(coords))
            bounds=None if not n else [(coords.min(0)[::-1]/(self.dims-1)).tolist(),(coords.max(0)[::-1]/(self.dims-1)).tolist()]
            records.append({'id':k,'key':KEYS[k],'name':NAMES[k],'color':COLORS[k],
                'confidence':'Unassigned / uncertain' if k==0 else 'Approximate source-guided region; not expert validated',
                'description':'Uncertain transitions and tissue without a supported regional assignment.' if k==0 else 'Regional tissue association from this donor; covering tissue shares its underlying region color.',
                'method':'Donor-specific cavity continuity, myocardial contour and constrained tissue propagation',
                'voxelCount':n,'boundsNormalizedXYZ':bounds})
        meta=self.meta.copy();meta.update({
            'schemaVersion':2,'revision':self.slug+'-source-regions-v17','title':'Approximate donor-specific chamber and outflow regions',
            'dimensions':self.dims.tolist(),'volumeUrl':'./assets/donors/'+self.slug+'/anatomy/'+filename,
            'labelGridSpacingUmXYZ':(self.gridspacing*1000).tolist(),'compressedBytes':len(packed),'decodedBytes':len(raw),
            'sha256':digest,'compressedSha256':hashlib.sha256(packed).hexdigest(),'sourceReviewed':True,
            'segmentationAvailable':True,'anatomicIdentityAssigned':True,'expertValidated':False,
            'supportsQuantification':False,'clinicalPresetsReviewed':False,'geometricComparisonOnly':True,
            'reviewStatus':'Approximate donor-specific source review; clinical presets remain geometric',
            'generatedDate':'2026-11-05','generator':'scripts/anatomy-donors-v17.py',
            'derivativeType':'Regional educational annotation of measured tissue',
            'sourceCoordinateOffsetToOriginalS4XYZ':[-.375,-.375,-.375],
            'method':'Independent donor-specific source cavity extraction and intensity-weighted tissue propagation. A manually reviewed compact LV envelope protects thick septum; an RV-facing surface shell follows the RV cavity. Atrial regions follow their own donor inlet continuity; great-vessel roots are identified by oblique LVOT/RVOT continuity and restricted to source-supported walls. Three candidate approaches were compared. No labels from another donor were used.',
            'validation':'Orthogonal source/overlay panels, oblique ventricular-to-root continuity panels and four native source-derived surface/cutaway views. Internal checks establish consistency and provenance, not expert ground-truth accuracy.',
            'septalDisplayConvention':'The shared compact interventricular septum is displayed with the LV myocardial body. A thin RV-facing source surface and adjacent RV trabeculae are colored RV. This is regional display ownership, not a histological layer measurement.',
            'epicardialDisplayConvention':'Outer colors indicate associated regional territory; epicardial covering, fat and small vessels are not separately classified.',
            'limitations':[
                'Approximate source-guided regional annotations without expert ground-truth segmentation.',
                'Atrioventricular and great-vessel transition gates are visually estimated; uncertain shared transition tissue remains neutral.',
                'Valve leaflets, coronary arteries, individual pulmonary/caval veins, appendages and fat are not separately segmented.',
                'The compact septal body and RV-facing shell use an explicit shared-septum display convention.',
                'These labels do not validate any geometric preset as a clinical TTE/TEE window and do not register an independent ultrasound recording to this donor.',
                'Not for diagnostic, procedural, chamber-volume, wall-thickness or other quantitative measurements.'
            ],'labels':records})
        save_json(self.output/'manifest.json',meta)
        review={k:meta[k] for k in ['datasetId','specimen','datasetUrl','geometricComparisonOnly',
            'anatomicIdentityAssigned','clinicalPresetsReviewed','expertValidated','reviewStatus',
            'sourceDoi','sourceLicense','sourceAttribution','segmentationAvailable','revision','supportsQuantification']}
        review.update(assignedVoxelCount=int(np.count_nonzero(self.labels)),
            explanation='Independent source-guided approximate chamber and great-vessel regional colors are available. Geometric comparison presets remain unvalidated as clinical windows.',
            evidenceDirectory='docs/anatomy-donors-v17/'+self.slug,
            previousReview='The v10 all-neutral comparison state is superseded for regional color display only. Clinical correspondence remains unreviewed.')
        save_json(ROOT/'docs/donors'/self.slug/'anatomy-review.json',review)
        save_json(self.docs/'asset-validation.json',{'revision':meta['revision'],'rawSha256':digest,'compressedSha256':meta['compressedSha256'],
            'dimensionsXYZ':self.dims.tolist(),'bytes':len(packed),'decodedBytes':len(raw),
            'gzipRoundTripExact':gzip.decompress(packed)==raw,'nonzeroLabelValues':list(map(int,np.unique(self.labels))),
            'outsideSupportLabeledVoxels':int(np.count_nonzero((self.labels>0)&~self.support)),
            'sourceSha256':sha(self.rawpath),'otherDonorLabelsUsed':False,'expertValidated':False,'supportsQuantification':False})
        print(self.slug,'asset',filename,'compressed',len(packed),'decoded',len(raw),flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--donor',choices=['s-20-29','s-20-28','all'],default='all')
    p.add_argument('--work',type=Path,default=Path('/workspace/data/anatomy-s-v17'));p.add_argument('--data-root',type=Path,default=Path('/workspace/data'))
    p.add_argument('--stage',choices=['build','review','package','all'],default='all');a=p.parse_args()
    for slug in ['s-20-29','s-20-28'] if a.donor=='all' else [a.donor]:
        d=Donor(slug,a.work,a.data_root);t=time.time();d.prepare()
        if a.stage in ['build','all']:d.extract_cavities();d.candidates()
        else:d.labels=np.load(d.work/'hybrid.npy')
        if a.stage in ['review','all']:d.source_reviews();d.surface_reviews()
        if a.stage in ['package','all']:d.package()
        print(slug,a.stage,round(time.time()-t,2),'seconds',flush=True)

if __name__=='__main__':main()
