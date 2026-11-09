#!/usr/bin/env python3
"""Second source-constrained, reversible lumen/fragment display review.

The source and previous v25 artifacts are immutable. Bit packing stores every
79.4-µm logical mask sample exactly; it does not downsample the reviewed masks.
"""
from pathlib import Path
import argparse,gc,gzip,hashlib,importlib.util,json,sys,time
import numpy as np
from scipy import ndimage as ndi
from matplotlib.path import Path as Polygon
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
spec=importlib.util.spec_from_file_location('v25_masks',ROOT/'scripts/cleanup-v25/build_lumen_masks.py')
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
PUBLIC=ROOT/'public/assets/cleanup-v26';DOCS=ROOT/'docs/cleanup-v26'
BASE=json.loads((ROOT/'public/assets/cleanup-v25/lumen-manifest.json').read_text())
MARGIN=9 # Eight-source-sample conservative vertex-cluster radius plus rounding.
TISSUE_GUARD=10
START=time.monotonic()

def log(**kwargs):print(json.dumps(dict(seconds=round(time.monotonic()-START,2),**kwargs)),flush=True)
def digest(data):return hashlib.sha256(data).hexdigest()
def disk(radius):
    z,x=np.ogrid[-radius:radius+1,-radius:radius+1]
    return x*x+z*z<=radius*radius
def old_mask(name,lo,hi):
    item=next(x for x in BASE['masks'] if x['id']==name)
    p=ROOT/'public'/item['url'].removeprefix('./');encoded=p.read_bytes()
    assert digest(encoded)==item['sha256']
    raw=gzip.decompress(encoded);assert digest(raw)==item['decodedSha256']
    a=np.frombuffer(raw,np.uint8).reshape(item['dimensionsXYZ'][::-1])!=0
    result=np.zeros(tuple((hi-lo)[::-1]),bool)
    lower=np.array(item['lowerFullFineXYZ'])-lo;upper=lower+item['dimensionsXYZ']
    assert np.all(lower>=0) and np.all(upper<=hi-lo)
    result[lower[2]:upper[2],lower[1]:upper[1],lower[0]:upper[0]]=a
    return result

def fields(polygons,lo,hi):
    z,x=np.mgrid[lo[2]:hi[2],lo[0]:hi[0]];points=np.column_stack([x.ravel(),z.ravel()])
    values={}
    for y,vertices in polygons.items():
        inside=Polygon(vertices).contains_points(points).reshape(z.shape)
        values[y]=(ndi.distance_transform_edt(~inside)-ndi.distance_transform_edt(inside)).astype(np.float32)
    return values

def interpolate(values,y):
    keys=sorted(values)
    if y<keys[0] or y>keys[-1]:return None
    right=min(int(np.searchsorted(keys,y,side='right')),len(keys)-1);left=max(0,right-1)
    yl,yr=keys[left],keys[right];t=0 if yr==yl else (y-yl)/(yr-yl)
    return values[yl]*(1-t)+values[yr]*t

def anchored_support(raw,f05,f08,envelope):
    strong=(raw>=190)|(f05>=135)|(f08>=135)
    labels,_=ndi.label(strong,structure=np.ones((3,3),bool))
    anchors=np.unique(labels[~envelope]);anchors=anchors[anchors!=0]
    protected=np.isin(labels,anchors)
    return protected

def object_mask(reader,lo,hi,polygons,expansion,baseline=None,additional_seed_polygons=None):
    use_baseline_seed=baseline is not None and polygons is old.ATRIAL
    result=np.zeros(tuple((hi-lo)[::-1]),bool) if baseline is None else baseline
    previous=int(result.sum());pad=13;signed=fields(polygons,lo-pad,hi+pad);metrics=[]
    extra_fields=fields(additional_seed_polygons,lo-pad,hi+pad) if additional_seed_polygons else None
    def object_envelope(y):
        distance=interpolate(signed,y)
        envelope=np.zeros((int(hi[2]-lo[2]+2*pad),int(hi[0]-lo[0]+2*pad)),bool) if distance is None else distance<=expansion
        extra_distance=interpolate(extra_fields,y) if extra_fields else None
        if extra_distance is not None:envelope|=extra_distance<=MARGIN
        return distance,extra_distance,envelope
    for start in range(int(lo[1]),int(hi[1]),32):
        stop=min(start+32,int(hi[1]));a=lo.copy()-pad;b=hi.copy()+pad;a[1]=start-pad;b[1]=stop+pad
        raw=reader.region(a,b);f05=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)
        f08=ndi.gaussian_filter(raw.astype(np.float32),.8,truncate=3)
        protected=np.zeros(raw.shape,bool)
        for j,y in enumerate(range(start-pad,stop+pad)):
            distance,extra_distance,envelope=object_envelope(y)
            protected[:,j,:]=anchored_support(raw[:,j,:],f05[:,j,:],f08[:,j,:],envelope)
        # Both margins are truly 3D. The source halo includes filtering support
        # as well as the largest distance query, so slab boundaries cannot
        # create a different accepted core mask.
        guard3=ndi.distance_transform_edt(~protected)<=TISSUE_GUARD
        support3=ndi.distance_transform_edt(~(f05>=71.4))<=MARGIN
        del raw,f05,f08,protected;gc.collect()
        for j,y in enumerate(range(start,stop)):
            distance,extra_distance,envelope=object_envelope(y)
            if distance is None and extra_distance is None:continue
            guard=guard3[:,j+pad,:]
            allowed=envelope&~guard
            # A larger outline can overlap low-density spaces inside a nearby
            # myocardial wall. Only expand through the allowed spatial region
            # connected to the prior reviewed object, never into those pockets.
            labels,_=ndi.label(allowed,structure=np.ones((3,3),bool))
            if use_baseline_seed:
                seeds=np.zeros(allowed.shape,bool);seeds[pad:-pad,pad:-pad]=result[:,y-lo[1],:]
            else:seeds=distance<=0
            if extra_distance is not None:seeds|=extra_distance<=0
            components=np.unique(labels[seeds&allowed]);components=components[components!=0]
            allowed=np.isin(labels,components)
            # Isosurface movement can be eight fine samples; v25's two-sample
            # support halo missed visible retained fragments. The reviewed
            # envelope and dense-wall guard bound this larger support margin.
            support=support3[:,j+pad,:]
            selected=allowed&support
            result[:,y-lo[1],:]|=selected[pad:-pad,pad:-pad]
            if y in signed or extra_fields and y in extra_fields:metrics.append(dict(y=y,selectedSamples=int(np.count_nonzero(selected[pad:-pad,pad:-pad])),newSelectionDenseGuardOverlap=int(np.count_nonzero(selected&guard))))
        log(stage='object-slab',yStart=start,yStop=stop)
    return result,dict(**({'inheritedV25MaskedSamples':previous} if use_baseline_seed else {'newParticleSeedMaskSamples':previous}),addedObjectMaskSamples=int(result.sum())-previous,reviewedYKeyframes=polygons,envelopeExpansionFineSamples=expansion,
      meshSupportMarginFineSamples=MARGIN,denseGuardFineSamples=TISSUE_GUARD,serialChecks=metrics,
      **({'additionalReviewedObjectSeeds':additional_seed_polygons,'additionalObjectEnvelopeExpansionFineSamples':MARGIN,'additionalObjectPurpose':'Separately seed the porous and bright core of the same user-selected intraluminal LA object. It was disconnected from the previous exclusion by the wall-protection geodesic rule. Source serial planes and production position readback define these seeds.'} if additional_seed_polygons else {}),
      newSelectionDenseGuardOverlap=0,sourcePaddingFineSamples=pad,distanceMetrics='3D Euclidean for source support and dense-tissue guard; serial 2D signed-distance envelope interpolation',
      method='Serial reviewed object envelopes with source-foreground support; source sigma0.5 and sigma0.8 plus raw190 anchored dense tissue protection. Expansion is geodesically connected to the reviewed object and cannot enter isolated wall pockets.'+(' Existing v25 atrial exclusions are retained exactly.' if use_baseline_seed else ' The initial particle mask is newly computed v26 source-component cleanup, not an inherited v25 valve exclusion.'))

# A second source-reviewed seed for the residual rounded core. It appears as
# porous material before Y1200, then becomes very bright, and tapers by Y1256.
# This is an explicit object selection, not an intensity-based identity claim.
ATRIAL_CORE={
 1168:[[1335,943],[1341,943],[1345,950],[1340,956],[1335,951]],
 1184:[[1315,940],[1335,940],[1353,955],[1369,974],[1363,987],[1342,980],[1330,963],[1314,957]],
 1196:[[1284,831],[1308,831],[1326,850],[1330,883],[1333,918],[1354,938],[1379,953],[1385,975],[1367,992],[1348,984],[1328,956],[1307,943],[1295,913],[1295,872],[1284,855]],
 1208:[[1250,842],[1281,832],[1318,840],[1338,863],[1355,899],[1370,925],[1367,963],[1353,986],[1334,982],[1321,949],[1295,934],[1278,913],[1271,878],[1250,858]],
 1216:[[1251,843],[1283,837],[1323,847],[1344,878],[1359,919],[1355,951],[1338,976],[1317,968],[1291,945],[1268,915],[1260,876]],
 1228:[[1243,846],[1280,846],[1312,862],[1334,890],[1350,932],[1345,964],[1320,973],[1292,952],[1269,926],[1250,891]],
 1240:[[1248,860],[1276,860],[1304,880],[1326,913],[1338,942],[1323,958],[1299,945],[1279,921],[1262,896]],
 1252:[[1271,867],[1296,875],[1322,901],[1328,926],[1310,934],[1285,909]],
 1256:[[1295,898],[1302,898],[1306,904],[1299,908]],
}

def atrial(reader):
    lo=np.array([1080,820,460]);hi=np.array([1390,1257,1160])
    baseline=old_mask('atrial',lo,hi)
    mask,policy=object_mask(reader,lo,hi,old.ATRIAL,42.5,baseline,ATRIAL_CORE)
    return lo,hi,mask,policy

# Deliberately bounded interiors above the semilunar valve apparatus. Seeds
# select connected source-derived lumens in each serial plane, not a solid
# anatomical chamber model. The large arterial walls are retained.
ARTERY_SEEDS={
 'aortic':{940:[880,625],960:[865,590],1000:[815,560],1040:[780,520],1080:[750,510],1120:[735,460],1160:[710,445],1200:[690,420],1240:[690,420],1280:[690,430]},
 'pulmonary':{920:[1060,300],960:[1055,310],1000:[1040,330],1040:[1030,350],1080:[1020,390],1120:[1020,420],1160:[1020,460],1200:[1010,490],1240:[1020,550],1280:[1050,610]},
}

def seed_at(values,y):
    keys=sorted(values)
    if y<keys[0] or y>keys[-1]:return None
    return np.array([np.interp(y,keys,[values[k][d] for k in keys]) for d in range(2)])

def arterial(reader):
    lo=np.array([510,900,180]);hi=np.array([1160,1281,740]);mask=old_mask('outflow',lo,hi)
    review_cavity=np.zeros(mask.shape,bool)
    baseline=int(mask.sum());metrics=[];skipped=[]
    for start in range(lo[1],hi[1],32):
        stop=min(start+32,hi[1]);a=lo.copy();b=hi.copy();a[1]=start-4;b[1]=stop+4
        raw=reader.region(a,b);f05=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3);f08=ndi.gaussian_filter(raw.astype(np.float32),.8,truncate=3)
        for j,y in enumerate(range(start,stop)):
            strong=(raw[:,j+4,:]>=190)|(f05[:,j+4,:]>=135)|(f08[:,j+4,:]>=135)
            labels,n=ndi.label(strong,structure=np.ones((3,3),bool));counts=np.bincount(labels.ravel());large=counts>=400;large[0]=False
            # A large dense vessel wall is the anchor; disconnected bright
            # particles do not become a wall merely because they are bright.
            wall=large[labels];guard=ndi.distance_transform_edt(~wall)<=TISSUE_GUARD
            fence=ndi.distance_transform_edt(~wall)<=3;fence[[0,-1],:]=True;fence[:,[0,-1]]=True
            spaces,n=ndi.label(~fence,structure=np.ones((3,3),bool));sizes=np.bincount(spaces.ravel())
            cavity=np.zeros_like(strong)
            for name,values in ARTERY_SEEDS.items():
                point=seed_at(values,y)
                if point is None:continue
                x,z=np.rint(point-np.array([lo[0],lo[2]])).astype(int)
                label=int(spaces[z,x]);size=int(sizes[label]) if label else 0
                # A leaky boundary generally merges into the large outer air
                # region. Reject that plane rather than clearing outside tissue.
                if label and 1800<=size<=100000:cavity|=spaces==label
                else:skipped.append(dict(y=y,artery=name,seed=point.tolist(),componentPixels=size))
            fg=f05[:,j+4,:]>=71.4
            support=ndi.distance_transform_edt(~fg)<=MARGIN if fg.any() else fg
            selected=cavity&support&~guard
            review_cavity[:,y-lo[1],:]=cavity
            mask[:,y-lo[1],:]|=selected
            if y%20==0:metrics.append(dict(y=int(y),cavityPixels=int(cavity.sum()),selectedSamples=int(selected.sum()),guardOverlap=int(np.count_nonzero(selected&guard))))
        log(stage='arterial-slab',yStart=int(start),yStop=int(stop))
    data_dir=Path('/workspace/data/cleanup-v26');data_dir.mkdir(parents=True,exist_ok=True)
    cavity_bytes=np.packbits(review_cavity,axis=2,bitorder='little').tobytes()
    (data_dir/'arterial-review-cavity.bits.gz').write_bytes(gzip.compress(cavity_bytes,compresslevel=9,mtime=0))
    (data_dir/'arterial-review-cavity.json').write_text(json.dumps(dict(lowerFullFineXYZ=lo.tolist(),dimensionsXYZ=(hi-lo).tolist(),storageDimensionsXYZ=[int((hi[0]-lo[0]+7)//8),int(hi[1]-lo[1]),int(hi[2]-lo[2])],decodedSha256=digest(cavity_bytes),bitOrder='little',purpose='Reviewed lumen membership for complete detached mesh components; analysis intermediate, not display mask.'))+'\n')
    return lo,hi,mask,dict(method='Source-derived aortic and pulmonary lumen flood regions selected by reviewed serial seeds, above the valve apparatus; suppress supported interior fragments outside a ten-sample in-plane dense-wall guard. Reject leaky or absent lumen regions.',reviewedSeeds=ARTERY_SEEDS,meshSupportMarginFineSamples=MARGIN,denseGuardFineSamples=TISSUE_GUARD,distanceMetrics='2D in-plane Euclidean margins around the 3D-filtered arterial source',inheritedV25MaskedSamples=baseline,addedSamples=int(mask.sum())-baseline,newSelectionDenseGuardOverlap=0,serialChecks=metrics,rejectedPlaneSeeds=skipped)

VALVE_SHEET={
 1016:[[991,983],[1003,984],[1005,991],[994,992]],
 1028:[[973,975],[1014,976],[1033,995],[1067,1046],[1082,1068],[1064,1065],[1038,1042],[1019,1014],[987,1000],[967,991]],
 1040:[[956,979],[989,977],[1023,986],[1051,1023],[1080,1065],[1110,1084],[1100,1101],[1073,1094],[1037,1061],[1015,1031],[983,1010],[950,997]],
 1056:[[949,980],[980,976],[1017,983],[1038,1014],[1063,1055],[1090,1077],[1120,1086],[1114,1107],[1075,1102],[1037,1082],[1009,1048],[970,1019],[945,1004]],
 1080:[[974,966],[1029,964],[1062,984],[1094,1034],[1090,1051],[1047,1024],[1007,1004],[975,988]],
 1100:[[1006,970],[1035,968],[1063,980],[1097,1008],[1109,1025],[1096,1032],[1065,1007],[1035,994],[1008,987]],
 1120:[[1033,967],[1062,972],[1091,992],[1111,1010],[1112,1027],[1098,1025],[1078,1006],[1054,993],[1034,982]],
 1136:[[1073,998],[1085,1004],[1094,1017],[1087,1022],[1079,1014]],
 1140:[[1084,1010],[1088,1013],[1087,1016],[1084,1015]],
}

def detached_source_tile(reader,lo,hi,max_voxels,max_diagonal,max_spread):
    raw=reader.region(lo,hi);field=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3);foreground=field>=71.4
    del raw,field;gc.collect()
    labels,n=ndi.label(foreground,structure=np.ones((3,3,3),bool));counts=np.bincount(labels.ravel());boxes=ndi.find_objects(labels)
    removed=np.zeros(n+1,bool);records=[];boundary=0;shape_protected=0
    for c,box in enumerate(boxes,1):
        if not box or not 2<=counts[c]<=max_voxels:continue
        starts=np.array([s.start for s in box]);stops=np.array([s.stop for s in box])
        if np.any(starts==0) or np.any(stops==np.array(foreground.shape)):
            boundary+=1;continue
        diagonal=np.linalg.norm(stops-starts)*.0794
        if diagonal>max_diagonal:continue
        points=np.argwhere(labels[box]==c).astype(np.float64)*.0794
        cov=np.cov(points,rowvar=False,bias=True);eig=np.maximum(np.linalg.eigvalsh(cov),0)
        spread=float(np.sqrt((eig[2]+.0397**2)/(eig[0]+.0397**2)))
        if spread>=max_spread:shape_protected+=1;continue
        removed[c]=True
        if len(records)<100:records.append(dict(component=c,voxels=int(counts[c]),bboxDiagonalMm=float(diagonal),pcaSpread=spread,lowerFullFineXYZ=(lo+starts[::-1]).tolist(),upperFullFineXYZ=(lo+stops[::-1]).tolist()))
    core=removed[labels];retained=foreground&~core
    del labels,foreground,boxes;gc.collect()
    # The halo covers mesh displacement. Retained source support has the same
    # ten-sample guard, so this cannot erase a nearby chord just because a
    # candidate small island was selected next to it.
    support=ndi.distance_transform_edt(~core)<=MARGIN if core.any() else core.copy()
    guard=ndi.distance_transform_edt(~retained)<=TISSUE_GUARD
    mask=support&~guard
    return mask,dict(method='26-connected components of the complete local sigma0.5 source foreground. Only fully interior small candidates are selected; preserve elongated components and all crop-face components. Exact logical-grid mask includes a bounded mesh halo and a wider guard around every retained source component.',maximumVoxels=max_voxels,maximumBoundingBoxDiagonalMm=max_diagonal,maximumPcaSpreadExclusive=max_spread,selectedComponents=int(removed.sum()),selectedSourceVoxels=int(core.sum()),guardProtectedBoundaryCandidates=boundary,shapeProtectedCandidates=shape_protected,meshSupportMarginFineSamples=MARGIN,denseGuardFineSamples=TISSUE_GUARD,sampleCandidates=records,protectedSupportOverlap=int(np.count_nonzero(mask&guard)))

def detached_source_components(reader,lo,hi,max_voxels,max_diagonal,max_spread):
    result=np.zeros(tuple((hi-lo)[::-1]),bool);tiles=[]
    halo=40;core_depth=96
    assert halo>int(np.ceil(max_diagonal/.0794))+TISSUE_GUARD
    for start in range(int(lo[2]),int(hi[2]),core_depth):
        stop=min(start+core_depth,int(hi[2]));a=lo.copy();b=hi.copy()
        a[2]=max(int(lo[2]),start-halo);b[2]=min(int(hi[2]),stop+halo)
        tile,policy=detached_source_tile(reader,a,b,max_voxels,max_diagonal,max_spread)
        result[start-lo[2]:stop-lo[2]]=tile[start-a[2]:stop-a[2]]
        tiles.append(dict(coreLowerZ=start,coreUpperZ=stop,sampledLowerZ=int(a[2]),sampledUpperZ=int(b[2]),**policy))
        del tile;gc.collect();log(stage='detached-source-tile',zStart=start,zStop=stop)
    return result,dict(method='Bounded overlapping source slabs. Each 96-sample accepted core has 40 real fine samples of halo, greater than the allowed fragment extent plus retained-tissue guard. Components touching any processing boundary are retained. Only core pixels are committed, avoiding overlap double counts.',sourceTileCoreDepth=core_depth,sourceTileHalo=halo,maximumVoxels=max_voxels,maximumBoundingBoxDiagonalMm=max_diagonal,maximumPcaSpreadExclusive=max_spread,meshSupportMarginFineSamples=MARGIN,denseGuardFineSamples=TISSUE_GUARD,tiles=tiles,protectedSupportOverlap=0,componentCountCaveat='Per-tile candidate counts can repeat a component across overlapping samples; final mask voxel counts are unique.')

def valve(reader):
    lo=np.array([850,900,850]);hi=np.array([1280,1170,1320])
    particles,particle_policy=detached_source_components(reader,lo,hi,1200,1.8,5.)
    mask,policy=object_mask(reader,lo,hi,VALVE_SHEET,3.5,particles)
    policy['detachedPerivalvularParticles']=particle_policy
    policy['scope']='Reviewed sheet proximal to the aortic valve plus small fully detached particles near valve structures. Dense anchored leaflets are protected; source intensity is not whitened.'
    return lo,hi,mask,policy

def rv(reader):
    lo=np.array([450,780,1100]);hi=np.array([1020,1200,1810])
    mask,policy=detached_source_components(reader,lo,hi,1600,2.2,5.)
    policy['scope']='Small detached RV/apical and chordal-region fragments only; connected trabeculae, papillary muscles and long chord-like components retained.'
    return lo,hi,mask,policy

def save(name,label,lo,hi,mask,policy):
    dimensions=(hi-lo).tolist();packed=np.packbits(mask,axis=2,bitorder='little')
    assert packed.shape==tuple([dimensions[2],dimensions[1],(dimensions[0]+7)//8])
    # The last byte of each X row contains zero padding; no adjacent row shares
    # bits. Round-trip every sample, then independently test random coordinates.
    assert np.array_equal(np.unpackbits(packed,axis=2,count=dimensions[0],bitorder='little'),mask)
    encoded=gzip.compress(memoryview(np.ascontiguousarray(packed)),compresslevel=9,mtime=0)
    file=PUBLIC/(name+'.bits.gz');file.write_bytes(encoded)
    assert digest(gzip.decompress(encoded))==digest(memoryview(packed))
    nonzero=np.nonzero(mask);mn=[int(q.min()) for q in nonzero][::-1];mx=[int(q.max()+1) for q in nonzero][::-1]
    item=dict(id=name,label=label,url='./assets/cleanup-v26/'+file.name,format='gzip-bitset-x-zyx',bitOrder='little',dimensionsXYZ=dimensions,storageDimensionsXYZ=list(packed.shape[::-1]),lowerFullFineXYZ=lo.tolist(),upperFullFineXYZ=hi.tolist(),nonzeroBoundsFullFineXYZ=[(lo+mn).tolist(),(lo+mx).tolist()],compressedBytes=len(encoded),decodedBytes=packed.nbytes,sha256=digest(encoded),decodedSha256=digest(memoryview(packed)),logicalMaskSha256=digest(memoryview(mask)),maskedVoxels=int(mask.sum()),maskedVolumeMm3=float(mask.sum()*.0794**3),policy=policy)
    rng=np.random.default_rng(2606);samples=[]
    for point in rng.integers([0,0,0],np.array(dimensions),size=(200,3)):
        x,y,z=point;actual=int((int(packed[z,y,x//8])>>(x&7))&1);assert actual==int(mask[z,y,x])
        samples.append(dict(fineXYZ=(point+lo).tolist(),excluded=bool(actual)))
    for index in np.linspace(0,len(nonzero[0])-1,min(100,len(nonzero[0])),dtype=int):
        z,y,x=[int(q[index]) for q in nonzero];assert (int(packed[z,y,x//8])>>(x&7))&1
        samples.append(dict(fineXYZ=[int(x+lo[0]),int(y+lo[1]),int(z+lo[2])],excluded=True))
    (DOCS/(name+'-bit-parity.json')).write_text(json.dumps(dict(maskId=name,samples=samples,fullLogicalRoundTrip=True,paddingZero=True),indent=2)+'\n')
    log(stage='mask-complete',id=name,selected=item['maskedVoxels'],compressed=len(encoded),decoded=packed.nbytes)
    return item

def review(reader,lo,hi,mask,ys,name):
    fig,axes=plt.subplots(2,len(ys),figsize=(3.8*len(ys),9),constrained_layout=True)
    for col,y in enumerate(ys):
        a=lo.copy();b=hi.copy();a[1]=y;b[1]=y+1;source=reader.region(a,b)[:,0,:];selection=mask[:,y-lo[1],:]
        extent=[lo[0],hi[0],hi[2],lo[2]]
        for row in range(2):
            axes[row,col].imshow(source,cmap='gray',vmin=25,vmax=205,extent=extent,interpolation='nearest')
            if row:
                overlay=np.zeros((*selection.shape,4));overlay[selection]=[1,.24,.1,.65];axes[row,col].imshow(overlay,extent=extent,interpolation='nearest')
            axes[row,col].set(title=f'Y={y} · section {y/4+1:g}\n'+('Measured source' if row==0 else 'Reversible display exclusion'),xlabel='Fine X',ylabel='Fine Z')
    fig.suptitle(name+' · exact 79.4 µm logical mask; original source pixels retained')
    fig.savefig(DOCS/(name+'-mask-review.jpg'),dpi=125);plt.close(fig)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--case',action='append');args=parser.parse_args()
    PUBLIC.mkdir(parents=True,exist_ok=True);DOCS.mkdir(parents=True,exist_ok=True);reader=FineSource(cache_bricks=32);items=[]
    for name,label,fn,ys in [('atrial','Reviewed atrial material',atrial,[944,1152,1196,1216]),('arterial','Arterial lumen fragments',arterial,[960,1040,1140,1216]),('valve-region','Reviewed aortic sheet and valve fragments',valve,[1020,1040,1056,1080]),('rv','Detached RV and apical fragments',rv,[900,992,1020,1120])]:
        item_file=DOCS/(name+'-mask-build.json')
        if args.case and name not in args.case:
            if item_file.exists():items.append(json.loads(item_file.read_text()))
            continue
        lo,hi,mask,policy=fn(reader);item=save(name,label,lo,hi,mask,policy);items.append(item);item_file.write_text(json.dumps(item,indent=2)+'\n')
        review(reader,lo,hi,mask,ys,name);del mask;gc.collect()
    if len(items)==4:
        public_items=[]
        for item in items:
            policy=item['policy'];summary={k:v for k,v in policy.items() if k not in ['tiles','sampleCandidates','serialChecks','reviewedYKeyframes','reviewedSeeds','rejectedPlaneSeeds','detachedPerivalvularParticles','additionalReviewedObjectSeeds']}
            summary['fullPolicySha256']=digest(json.dumps(json.loads(json.dumps(policy)),sort_keys=True,separators=(',',':')).encode())
            if 'tiles' in policy:summary['reviewedSourceTiles']=len(policy['tiles'])
            if 'rejectedPlaneSeeds' in policy:summary['rejectedPlaneSeedCount']=len(policy['rejectedPlaneSeeds'])
            if 'reviewedYKeyframes' in policy:summary['reviewedYKeyframes']=sorted(policy['reviewedYKeyframes'])
            if 'additionalReviewedObjectSeeds' in policy:summary['additionalReviewedObjectYKeyframes']=sorted(policy['additionalReviewedObjectSeeds'])
            if 'detachedPerivalvularParticles' in policy:
                p=policy['detachedPerivalvularParticles'];summary['detachedPerivalvularParticles']={k:v for k,v in p.items() if k not in ['tiles','sampleCandidates']}
                summary['detachedPerivalvularParticles']['reviewedSourceTiles']=len(p.get('tiles',[]))
            public_items.append({**item,'policy':summary})
        meta={k:BASE[k] for k in ['donorId','sampling','sourceManifestUrl','sourceManifestSha256','sourceFullDimensionsXYZ','sourceSpacingUm','longestMm','extent','coordinateConvention','worldToFine']}
        meta.update(version=3,id='ladaf-reviewed-lumen-display-v26',defaultEnabled=True,title='Reviewed lumen cleanup',format='gzip-bitset-x-zyx',description='Reviewed atrial material, arterial lumen particles, a proximal aortic sheet and small detached perivalvular/RV fragments. Reversible 3D display selections, not anatomical classification.',fineToMaskUv='Nearest original fine sample; eight adjacent X samples per byte, least-significant bit first. No mask resampling.',masks=public_items,limitations=['Material identity and anatomical completeness are not validated.','Dense anchored walls and retained source structures are protected; connected ambiguous anatomy remains.','Original CT cards, voxel arrays and mesh payloads are unchanged.'])
        (PUBLIC/'lumen-manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
        (DOCS/'lumen-build.json').write_text(json.dumps(dict(source=reader.receipt(),manifestSha256=digest((PUBLIC/'lumen-manifest.json').read_bytes()),totalDecodedBytes=sum(x['decodedBytes'] for x in items),totalCompressedBytes=sum(x['compressedBytes'] for x in items),logicalSampleCounts=[int(np.prod(x['dimensionsXYZ'])) for x in items],losslessPacking=True,items=items),indent=2)+'\n')

if __name__=='__main__':main()
