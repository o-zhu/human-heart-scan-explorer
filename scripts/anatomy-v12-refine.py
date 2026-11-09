"""Source-supported ventricular surface ownership and epicardial completion.

This changes regional annotation bytes only. It never changes scan intensities,
surface geometry, physical registration, or any source asset.
"""
from pathlib import Path
import argparse, gzip, hashlib, importlib.util, json, shutil, time
import numpy as np
from scipy import ndimage as ndi
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs/anatomy-v12'
SRC = np.array([475,475,530])
DIMS = np.array([317,317,354])
SCALE = (DIMS-1)/(SRC-1)
SPACING = 0.3176 / SCALE
PALETTE = np.array([[155,169,176],[227,109,115],[84,166,230],[242,179,107],[99,199,186],[196,153,232],[97,204,224]],np.uint8)

def module(name, file):
    spec=importlib.util.spec_from_file_location(name, ROOT/'scripts'/file)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result

base=module('anatomy_v4', 'prepare_anatomy.py')
methods=module('anatomy_v5', 'anatomy-v5-methods.py')

def save_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, allow_nan=False)+'\n')

def fetch_source(work):
    """Download all original s4 N5 blocks, retaining their byte hashes."""
    import urllib.request, struct, concurrent.futures
    import blosc2
    work.mkdir(parents=True,exist_ok=True)
    source_manifest=json.loads((ROOT/'public/assets/manifest.json').read_text())
    url=source_manifest['sourceHttp']+'s4/'
    attrs=json.loads(urllib.request.urlopen(url+'attributes.json',timeout=45).read())
    if attrs['dimensions']!=SRC.tolist() or attrs['dataType']!='uint16' or attrs['compression']['type']!='blosc':
        raise ValueError('Unreviewed source layout')
    save_json(work/'source-s4-attributes.json',attrs)
    shape=tuple(SRC[::-1]);block=np.array(attrs['blockSize']);counts=(SRC+block-1)//block
    coords=[(x,y,z) for z in range(counts[2]) for y in range(counts[1]) for x in range(counts[0])]
    output=np.lib.format.open_memmap(work/'source-s4.npy',mode='w+',dtype=np.uint16,shape=shape)
    def chunk(c):
        path=work/'source-chunks'/('_'.join(map(str,c))+'.n5');path.parent.mkdir(exist_ok=True)
        for attempt in range(4):
            try:
                payload=path.read_bytes() if path.exists() else urllib.request.urlopen(url+'/'.join(map(str,c)),timeout=45).read()
                if not path.exists():path.write_bytes(payload)
                mode,ndim=struct.unpack('>HH',payload[:4]);dims=struct.unpack('>III',payload[4:16])
                if mode!=0 or ndim!=3 or any(d<1 or d>b for d,b in zip(dims,block)):raise ValueError('Invalid N5 header')
                raw=blosc2.decompress(payload[16:])
                if len(raw)!=int(np.prod(dims))*2:raise ValueError('Invalid decoded block byte count')
                return c,np.frombuffer(raw,dtype='>u2').reshape(dims[::-1]),hashlib.sha256(payload).hexdigest(),len(payload)
            except Exception:
                if attempt==3:raise
                time.sleep(attempt+1)
    records=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for i,(c,array,digest,nbytes) in enumerate(pool.map(chunk,coords)):
            x,y,z=np.array(c)*block;dz,dy,dx=np.minimum(array.shape,np.array(shape)-[z,y,x])
            # N5 edge blocks are padded to the source block size.
            output[z:z+dz,y:y+dy,x:x+dx]=array[:dz,:dy,:dx]
            records.append({'coordinateXYZ':c,'sha256':digest,'bytes':nbytes})
            if i%8==7:print('Fetched',i+1,'/',len(coords),flush=True)
    output.flush();save_json(work/'source-chunks.json',{'source':url,'chunks':records})

def landmark_checks(array):
    groups={}
    for name,key in [('independent-flow-landmarks-v5.json','landmarks'),('targeted-landmarks-v5.json','points')]:
        records=json.loads((ROOT/'docs/anatomy'/name).read_text())[key]
        groups[name]=[(p['name'],p['sourceXYZ'],p['expectedRegion']) for p in records]
    prior=json.loads((ROOT/'docs/anatomy/boundary-validation.json').read_text())
    for key in ['independentLandmarks','refinementLandmarks']:
        groups['v4-'+key]=[(p.get('name','outer-contour-control'),p['sourceXYZ'],p['expectedReviewedRegion']) for p in prior[key]['points']]
    result={}
    for name,points in groups.items():
        records=[]
        for title,xyz,expected in points:
            x,y,z=np.rint(np.array(xyz)*SCALE).astype(int);actual=int(array[z,y,x])
            records.append({'name':title,'sourceXYZ':xyz,'expected':expected,'actual':actual,'matched':actual==expected})
        result[name]={'matched':sum(p['matched'] for p in records),'total':len(records),'points':records}
    return result

def prepare(work, source):
    work.mkdir(parents=True,exist_ok=True); DOCS.mkdir(exist_ok=True)
    v=base.load_working_volume(source,work)
    labels=np.frombuffer(gzip.decompress((DOCS/'baseline/labels.raw.gz').read_bytes()),np.uint8).reshape(tuple(DIMS[::-1])).copy()
    np.save(work/'baseline.npy',labels)
    yy,xx=np.indices(v.shape[1:]);main=methods.largest_component((v>17500)&((xx-158)**2+(yy-158)**2<140**2)[None,:,:])
    np.save(work/'tissue-core.npy',main)
    tracks={int(k):s for k,s in json.loads((ROOT/'docs/anatomy/cavity-tracks.json').read_text()).items()}
    cavity,records=base.cavity_seeds(v,main,tracks)
    np.save(work/'cavities.npy',cavity)
    save_json(DOCS/'cavity-extraction.json',{'method':'Measured low-density components inside closed tissue sections, identified by previously reviewed cavity trajectories.','source':str(source),'components':records})
    for k in [1,2]:
        d=ndi.distance_transform_edt(cavity!=k,sampling=SPACING[::-1]).astype(np.float32)
        np.save(work/f'cavity-{k}-distance-mm.npy',d)
    print('Prepared source-derived cavities and physical distances',flush=True)

def compare(work):
    """Run three materially different annotation candidates on the same volume."""
    v=np.load(work/'working-volume.npy'); old=np.load(work/'baseline.npy')
    dl=np.load(work/'cavity-1-distance-mm.npy');dr=np.load(work/'cavity-2-distance-mm.npy')
    core=np.load(work/'tissue-core.npy')
    # Cleanup support is obtained independently from measured tissue, not from
    # the old labels. The former v5 mask could not recover unclassified tissue.
    organ_support=ndi.binary_dilation(core,iterations=4)
    measured=(v>=17100)&organ_support
    support=ndi.binary_dilation(measured,iterations=1)&organ_support
    dist_old,ind=ndi.distance_transform_edt(old==0,sampling=SPACING[::-1],return_indices=True)
    nearest=old[tuple(ind)];del ind
    extension=(old==0)&support&(dist_old<=3.5)
    # Diagnostic A: unconstrained nearest-cavity territory. This can divide
    # compact septum inappropriately; it is retained for review, not selected.
    euclidean=old.copy()
    ventricular=(old==1)|(old==2)
    euclidean[ventricular]=np.where(dl[ventricular]<dr[ventricular],1,2)
    euclidean[extension]=nearest[extension]
    np.save(work/'nearest-cavity.npy',euclidean)
    # Diagnostic B: source-intensity geodesic propagation for exterior only,
    # while keeping all pre-existing identities fixed.
    markers=np.where((old>0)&measured,old,0).astype(np.uint8)
    allowed=np.full(old.shape,127,np.uint8)
    # Never jump beyond a narrow physical collar around reviewed annotations.
    mask=support&((old>0)|(dist_old<=3.5))
    geodesic,distance=methods.geodesic(v,mask,markers,work,edge_scale=950,gap_penalty=3,max_cost=15)
    exterior=old.copy();exterior[extension]=geodesic[extension]
    np.save(work/'exterior-geodesic.npy',exterior)
    # Candidate C: the same exterior support plus local RV surface ownership.
    # An endocardial shell reflects the chamber faced by a tissue surface;
    # compact intervening septum remains with the LV body. Only LV/RV labels
    # can change, so old atrial, arterial and valve-transition regions are held.
    hybrid=exterior.copy()
    z=np.linspace(0,529,DIMS[2])[:,None,None]
    # Avoid fixed cutoffs at the base by tapering the shell across the basal
    # transition. This only gates an existing source-cavity distance, it does
    # not invent an anatomical boundary or split a chamber with a halfspace.
    shell=1.9*np.clip((z-238)/28,0,1)*np.clip((485-z)/25,0,1)
    rv_facing=(hybrid==1)&(dr<=shell)&(dl>=dr+1.0)&support
    # Include RV trabecular protrusions only if they are attached to the
    # measured RV-facing shell and lie close to the source-extracted RV cavity.
    rv_thin=(hybrid==1)&(dr<2.9)&(dl>dr+2.6)&support
    rv_thin&=ndi.binary_dilation(rv_facing,iterations=2)
    rv_facing|=rv_thin
    hybrid[rv_facing]=2
    np.save(work/'hybrid.npy',hybrid)
    np.save(work/'rv-facing-shell.npy',rv_facing)
    np.save(work/'annotation-support.npy',support)
    statistics={}
    for name,a in [('nearest-cavity',euclidean),('exterior-geodesic',exterior),('hybrid',hybrid)]:
        statistics[name]={'changedVoxels':int(np.count_nonzero(a!=old)),
                         'newlyAnnotatedVoxels':int(np.count_nonzero((old==0)&(a>0))),
                         'LVtoRV':int(np.count_nonzero((old==1)&(a==2))),
                         'RVtoLV':int(np.count_nonzero((old==2)&(a==1))),
                         'counts':{str(k):int(np.count_nonzero(a==k)) for k in range(7)}}
    save_json(DOCS/'method-comparison.json',statistics)
    print(json.dumps(statistics,indent=2),flush=True)

def package(work,source):
    old=np.load(work/'baseline.npy');chosen=np.load(work/'hybrid.npy')
    if chosen.shape!=tuple(DIMS[::-1]) or chosen.dtype!=np.uint8 or chosen.max()>6:
        raise ValueError('Invalid categorical volume')
    checks=landmark_checks(chosen)
    if any(s['matched']!=s['total'] for s in checks.values()):
        raise ValueError('A previously reviewed source landmark regressed')
    if not np.array_equal(chosen[old>=3],old[old>=3]):
        raise ValueError('Existing atrial/arterial identities changed')
    raw=chosen.tobytes();packed=gzip.compress(raw,compresslevel=9,mtime=0)
    digest=hashlib.sha256(raw).hexdigest();filename=f'labels-v12-{digest[:12]}.raw.gz'
    output=ROOT/'public/assets/anatomy';(output/filename).write_bytes(packed)
    meta=json.loads((DOCS/'baseline/manifest.json').read_text())
    meta.update({'revision':'surface-ownership-v12','volumeUrl':'./assets/anatomy/'+filename,
                 'compressedBytes':len(packed),'decodedBytes':len(raw),'sha256':digest,
                 'compressedSha256':hashlib.sha256(packed).hexdigest(),
                 'generatedDate':'2026-11-05','generator':'scripts/anatomy-v12-refine.py',
                 'method':'Retains the source-guided ventricular envelope, tricuspid junction, arterial cores and pulmonary hinge of v5. Recovers unclassified low-intensity outer tissue by a bounded, intensity-weighted geodesic on independently measured organ support. A local surface-ownership layer follows the measured RV cavity while preserving compact septal core and existing atrial/arterial labels. Unrestricted nearest-cavity and exterior-only alternatives were compared. Source values, reconstruction geometry and registration are unchanged.',
                 'septalDisplayConvention':'The compact interventricular septum remains a shared structure. Its compact core is displayed with the LV myocardial body; the thin tissue surface facing the source-extracted RV cavity is displayed as RV, along with adjacent RV trabecular protrusions. This is regional surface ownership, not a measured histological layer or a claim that the whole septum belongs to one ventricle.',
                 'epicardialDisplayConvention':'Colors on the outer heart indicate the associated regional territory, including its immediate source-supported covering. Fat, coronary vessels and myocardium are not separately classified by these colors. Uncertain distant or disconnected structures remain neutral.',
                 'validation':'All 43 pre-existing targeted source-review control points remain satisfied (12 independent v5 controls, 5 v5 correction controls, 20 earlier boundary controls, and 6 earlier contour-refinement controls). Seven orthogonal source sections and five native source-derived 3D projections, including the actual RV-inflow preset, compare the same intensities and geometry before/after. These checks establish regression consistency and coverage, not expert ground truth or a global accuracy score.'})
    meta['methodParameters']={'baselineRevision':'continuity-gated-v5','baselineSha256':hashlib.sha256(old.tobytes()).hexdigest(),
        'gridDimensionsXYZ':DIMS.tolist(),'workingGaussianSigma':.35,
        'sourceTissueThreshold':17100,'sourceCoreThreshold':17500,
        'coreConnectivity':18,'independentSupportDilationWorkingVoxels':4,
        'sourceSupportGuardWorkingVoxels':1,'maximumExteriorDistanceMm':3.5,
        'geodesicConnectivity':6,'edgeDifferenceScale':950,'lowDensityGapPenalty':3,'maximumGeodesicCost':15,
        'rvSurfaceOwnershipThicknessMm':1.9,'rvSurfaceLVProtectionMarginMm':1.0,
        'rvTrabecularMaximumCavityDistanceMm':2.9,'rvTrabecularLVProtectionMarginMm':2.6,
        'rvTrabecularConnectivityDilationWorkingVoxels':2,
        'rvSurfaceBasalTaperSourceZ':[238,266],'rvSurfaceApicalTaperSourceZ':[460,485]}
    meta['limitations']=[
        'Approximate source-supported regional annotations; no expert reference segmentation or trained segmentation model.',
        'The RV-facing septal surface and compact septal core use the explicit shared-septum display convention. The layer thickness is an annotation parameter, not a measured anatomical boundary.',
        'Outer color denotes regional association; it does not distinguish epicardial fat, myocardium or coronary vessels.',
        'Pulmonary hinge, tricuspid and LV/atrial/root transitions are visually estimated. Shared fibrous tissue, valve attachment zones and small vessels remain uncertain.',
        'Valves, coronary vessels, individual pulmonary veins, caval veins and appendages are not separately segmented.',
        'No fiber tractography, deformation, slice realignment or synthetic anatomical reconstruction is performed.',
        'These labels are not for quantitative chamber volume, wall thickness, procedural or diagnostic measurements.']
    descriptions={1:'LV myocardial body and source-supported exterior territory, with compact septal core retained under the stated shared-septum convention. The RV-facing endocardial surface is assigned to RV surface ownership.',2:'RV free wall, muscular outflow, measured-cavity-facing septal surface and connected nearby trabecular protrusions. The compact central septum remains shared anatomy and is displayed with LV.',3:'Collapsed LA territory and immediate source-supported exterior; basal transition boundaries remain provisional.',4:'RA wall, pectinate territory and immediate source-supported exterior, ending at the previously reviewed curved tricuspid junction.',5:'Connected aortic arterial wall and proximal root. Existing source-reviewed arterial identities are retained; immediate source-supported exterior coverage is completed.',6:'Pulmonary arterial wall and root beyond the previously reviewed pulmonary hinge, with immediate source-supported exterior coverage. The muscular ventricular outflow remains RV.'}
    for label in meta['labels']:
        k=label['id']
        if k==0:continue
        coordinates=np.argwhere(chosen==k)[:,::-1];lo=coordinates.min(axis=0);hi=coordinates.max(axis=0)
        label['voxelCount']=int(len(coordinates));label['boundsNormalizedXYZ']=[(lo/(DIMS-1)).tolist(),(hi/(DIMS-1)).tolist()]
        label['description']=descriptions[k]
        label['method']='Source-guided v5 regions with bounded measured-tissue exterior propagation and explicit RV-facing surface ownership.'
        x,y,z=np.rint(np.array(label['referenceAnchorSourceXYZ'])*SCALE).astype(int)
        if chosen[z,y,x]!=k:raise ValueError('A retained reference anchor left its region')
    save_json(output/'manifest.json',meta)
    components={}
    for k in range(1,7):
        cc,n=ndi.label(chosen==k,structure=ndi.generate_binary_structure(3,2));sizes=np.bincount(cc.ravel());sizes[0]=0
        components[str(k)]={'componentCount':n,'largestFraction':float(sizes.max()/sizes.sum())}
    source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
    checks_out={'scope':'Targeted regression controls, not a clinical accuracy estimate. All controls predate v12; earlier contour-refinement points were not independent v4 validation.',
                'landmarkGroups':checks,'existingAtrialArterialVoxelsPreserved':True,'components':components}
    save_json(DOCS/'verification.json',checks_out)
    record={'revision':meta['revision'],'asset':filename,'sha256':digest,'compressedSha256':meta['compressedSha256'],'decodedBytes':len(raw),'compressedBytes':len(packed),'sourceNpySha256':source_hash,'sourceValuesModified':False,'sourceGeometryModified':False,'registrationModified':False,'baselineSha256':meta['methodParameters']['baselineSha256'],'sourceShapeZYX':[530,475,475],'sourceDtype':'uint16'}
    save_json(DOCS/'packaging.json',record)
    for name in ['source-chunks.json','source-s4-attributes.json']:
        shutil.copyfile(work/name,DOCS/name)
    print(json.dumps(record,indent=2),flush=True)

def sample(labels, axis, n):
    # Endpoint registration, nearest categorical interpolation.
    axes=[0,1,2]; ai={'x':2,'y':1,'z':0}[axis];axes.remove(ai)
    a=np.arange(SRC[::-1][axes[0]]);b=np.arange(SRC[::-1][axes[1]])
    aa,bb=np.meshgrid(a,b,indexing='ij'); coords=[None,None,None]
    coords[axes[0]]=aa*SCALE[::-1][axes[0]];coords[axes[1]]=bb*SCALE[::-1][axes[1]]
    coords[ai]=np.full(aa.shape,n*SCALE[::-1][ai])
    return ndi.map_coordinates(labels,coords,order=0,prefilter=False)

def plane(v, axis, n):
    return v[:,:,n] if axis=='x' else v[:,n,:] if axis=='y' else v[n,:,:]

def overlay(raw,labels, cavity=False):
    gray=np.clip((raw.astype(np.float32)-15000)/8500,0,1)
    rgb=np.repeat((gray*255)[...,None],3,axis=2)
    mask=(labels>0)&((raw>17100) if not cavity else (raw<18100))
    rgb[mask]=rgb[mask]*.35+PALETTE[labels[mask]]*(.40+.60*gray[mask,None])*.65
    return Image.fromarray(np.uint8(np.clip(rgb,0,255)))

def review(work,source,names=None):
    raw=np.load(source,mmap_mode='r')
    names=names or ['baseline','cavities']
    arrays={n:np.load(work/(n+'.npy'),mmap_mode='r') for n in names}
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
    for axis,ns in [('x',[200,237,275]),('z',[300,340,380,420])]:
        width=480; height=570 if axis=='x' else 480
        fig=Image.new('RGB',(width*(len(names)+1),height*len(ns)),(11,17,20));draw=ImageDraw.Draw(fig)
        for row,n in enumerate(ns):
            p=plane(raw,axis,n)
            imgs=[overlay(p,np.zeros(p.shape,np.uint8))]+[overlay(p,sample(v,axis,n),k=='cavities') for k,v in arrays.items()]
            for col,img in enumerate(imgs):
                img.thumbnail((width-20,height-42));fig.paste(img,(col*width+(width-img.width)//2,row*height+38))
                draw.text((col*width+10,row*height+8),f'{axis.upper()}={n} / '+(['source']+names)[col],font=font,fill=(225,231,232))
        path=DOCS/f'{axis}-source-review.jpg';fig.save(path,quality=92)
        print('Wrote',path,flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--work',type=Path,default=Path('/workspace/data/anatomy-v12'))
    p.add_argument('--source',type=Path,default=Path('/workspace/data/anatomy-v12/source-s4.npy'))
    p.add_argument('--stage',choices=['fetch','prepare','compare','review','review-methods','package'],default='prepare')
    a=p.parse_args()
    if a.stage=='fetch':fetch_source(a.work)
    elif a.stage=='prepare':prepare(a.work,a.source)
    elif a.stage=='compare':compare(a.work)
    elif a.stage=='review-methods':review(a.work,a.source,['baseline','nearest-cavity','exterior-geodesic','hybrid'])
    elif a.stage=='package':package(a.work,a.source)
    else:review(a.work,a.source)

if __name__=='__main__':main()
