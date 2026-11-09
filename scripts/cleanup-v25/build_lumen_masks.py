#!/usr/bin/env python3
"""Source-constrained, reversible display exclusions requested by the user.

The atrial candidate is reviewed across serial measured planes, including its
bright core. It is not classified as thrombus or acquisition artifact. Polygons
bound this particular object, not a whole chamber. Source intensities and all
earlier assets remain immutable. Mask arrays use the original fine sample grid.
"""
from pathlib import Path
import gzip, hashlib, json, sys
import numpy as np
from scipy import ndimage as ndi
from matplotlib.path import Path as Polygon
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
OUT=ROOT/'docs/cleanup-v25'
PUBLIC=ROOT/'public/assets/cleanup-v25'

# Reviewed XZ envelopes in full 79.4-µm source coordinates. A signed-distance
# interpolation joins them along Y; only measured foreground and its two-sample
# isosurface margin are selected. The bright portion at Y=1216..1248 is included
# deliberately, as requested, rather than protected simply for being bright.
ATRIAL={
  820:[[1202,474],[1227,486],[1260,550],[1279,624],[1272,667],[1248,651],[1231,592],[1214,546]],
  840:[[1175,476],[1210,487],[1230,555],[1267,645],[1274,711],[1247,706],[1224,645],[1204,581],[1180,540]],
  880:[[1154,496],[1194,506],[1230,559],[1250,661],[1270,751],[1250,766],[1221,739],[1200,674],[1181,609],[1162,544]],
  920:[[1139,533],[1171,548],[1200,586],[1228,647],[1247,745],[1284,812],[1272,833],[1244,818],[1206,762],[1188,693],[1167,617],[1144,566]],
  944:[[1126,550],[1172,580],[1219,649],[1241,740],[1259,823],[1297,895],[1301,1007],[1288,1064],[1306,1120],[1192,1140],[1159,1102],[1223,1041],[1238,965],[1219,876],[1198,775],[1178,694],[1138,619]],
  960:[[1126,555],[1172,576],[1220,636],[1240,724],[1256,817],[1308,920],[1306,1037],[1305,1125],[1200,1144],[1152,1115],[1174,1060],[1235,1013],[1241,947],[1214,867],[1203,768],[1182,694],[1135,620]],
 1000:[[1137,608],[1174,626],[1208,657],[1212,718],[1268,754],[1287,808],[1271,863],[1244,897],[1248,1002],[1262,1088],[1262,1142],[1200,1150],[1144,1108],[1159,1026],[1199,958],[1203,884],[1180,796],[1136,741]],
 1040:[[1139,618],[1154,656],[1191,708],[1203,772],[1242,811],[1270,833],[1269,872],[1258,918],[1247,986],[1254,1041],[1264,1122],[1211,1144],[1163,1128],[1140,1090],[1155,1017],[1156,963],[1126,887],[1110,817],[1104,755],[1110,697]],
 1080:[[1111,660],[1147,688],[1174,728],[1208,759],[1230,793],[1228,852],[1212,901],[1207,947],[1234,998],[1258,1043],[1304,1076],[1302,1111],[1259,1133],[1211,1130],[1183,1100],[1184,1059],[1127,1021],[1117,971],[1126,919],[1133,860],[1131,808],[1111,748]],
 1120:[[1127,705],[1163,720],[1189,752],[1199,803],[1224,842],[1230,897],[1212,940],[1233,981],[1253,1012],[1269,1041],[1327,1070],[1363,1071],[1352,1094],[1290,1108],[1240,1106],[1200,1084],[1193,1036],[1152,1008],[1148,954],[1155,901],[1161,843],[1148,795]],
 1152:[[1151,698],[1212,683],[1225,709],[1200,728],[1230,751],[1252,795],[1273,837],[1264,893],[1245,938],[1245,987],[1271,1025],[1339,1037],[1320,1064],[1262,1083],[1205,1067],[1179,1033],[1175,980],[1178,923],[1171,869],[1156,821],[1137,770]],
 1184:[[1167,739],[1202,752],[1219,767],[1220,730],[1274,735],[1291,771],[1274,796],[1292,797],[1333,807],[1338,828],[1303,824],[1271,825],[1265,850],[1252,914],[1249,967],[1260,1007],[1294,1023],[1341,1016],[1345,1038],[1289,1054],[1233,1044],[1200,1015],[1192,964],[1198,917],[1204,861],[1185,820]],
 1200:[[1194,774],[1228,789],[1245,802],[1299,783],[1324,808],[1293,824],[1269,832],[1261,858],[1259,884],[1297,887],[1321,928],[1298,979],[1261,1018],[1235,1025],[1213,989],[1214,945],[1223,903],[1220,852]],
 1216:[[1194,777],[1220,796],[1245,817],[1275,836],[1315,838],[1345,863],[1356,914],[1343,964],[1317,1006],[1284,1023],[1253,1008],[1258,975],[1254,942],[1235,901],[1218,858]],
 1236:[[1208,790],[1234,816],[1266,843],[1304,849],[1331,871],[1345,913],[1330,947],[1302,957],[1277,933],[1256,907],[1240,865]],
 1244:[[1228,815],[1250,833],[1280,855],[1312,868],[1337,900],[1345,931],[1318,952],[1288,936],[1270,908],[1250,873]],
 1252:[[1275,868],[1295,878],[1318,904],[1322,922],[1304,924],[1285,905]],
 1256:[[1297,901],[1299,900],[1300,902],[1298,903]],
}

def sha(x):return hashlib.sha256(x).hexdigest()
def sphere(radius):
    z,y,x=np.ogrid[-radius:radius+1,-radius:radius+1,-radius:radius+1]
    return x*x+y*y+z*z<=radius*radius

def atrial(reader):
    lo=np.array([1080,820,460]);hi=np.array([1370,1257,1160])
    width=hi-lo;shape=tuple(width[::-1]);result=np.zeros(shape,np.uint8)
    z,x=np.mgrid[lo[2]:hi[2],lo[0]:hi[0]];points=np.column_stack([x.ravel(),z.ravel()])
    keys=sorted(ATRIAL);fields={}
    for y,vertices in ATRIAL.items():
        inside=Polygon(vertices).contains_points(points).reshape(z.shape)
        fields[y]=(ndi.distance_transform_edt(~inside)-ndi.distance_transform_edt(inside)).astype(np.float32)
    metrics=[];protected_wall_samples=0
    for start in range(lo[1],hi[1],40):
        stop=min(start+40,hi[1]);a=lo.copy();b=hi.copy();a[1]=start-3;b[1]=stop+3
        raw=reader.region(a,b);field=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)
        support=ndi.binary_dilation(field>=.28*255,structure=sphere(2))[:,3:-3,:]
        for j,y in enumerate(range(start,stop)):
            right=min(int(np.searchsorted(keys,y,side='right')),len(keys)-1);left=max(0,right-1)
            yl,yr=keys[left],keys[right];t=0 if yr==yl else (y-yl)/(yr-yl)
            distance=fields[yl]*(1-t)+fields[yr]*t
            envelope=distance<=2.5;source=raw[:,j+3,:]
            strong=(source>=190)|(field[:,j+3,:]>=135)
            labels,_=ndi.label(strong,structure=np.ones((3,3),bool))
            anchor_ids=np.unique(labels[~envelope]);anchor_ids=anchor_ids[anchor_ids!=0]
            # A per-plane anchored-wall guard prevents a polygon edge from
            # shaving the neighboring chamber wall. An isolated bright core
            # inside the selected material is included with the whole object.
            anchors=np.isin(labels,anchor_ids)
            guard=ndi.binary_dilation(anchors,iterations=3)
            selected=envelope&support[:,j,:]&~guard
            protected_wall_samples+=int(np.count_nonzero(envelope&support[:,j,:]&guard))
            result[:,y-lo[1],:]=selected.astype(np.uint8)*255
            if y in keys or y==1236:
                metrics.append(dict(y=y,maskedVoxels=int(selected.sum()),strongSourceSamples=int(np.count_nonzero(selected&(source>=190))),sourceMean=float(source[selected].mean()) if selected.any() else None))
        print('atrial',start,stop,flush=True)
    return lo,hi,result,dict(method='Reviewed serial XZ object envelopes with signed-distance interpolation, restricted to sigma0.5 source foreground plus two fine samples. Per-plane strong source anchored outside the envelope and a three-sample guard are retained.',reviewedYKeyframes=ATRIAL,serialMetrics=metrics,wallGuardSamplesRetained=protected_wall_samples,includesBrightCore=True,materialIdentity='unverified; user-requested reversible exclusion')

def outflow(reader):
    lo=np.array([890,920,210]);hi=np.array([1150,1160,440])
    raw=reader.region(lo,hi);field=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)
    z,y,x=np.ogrid[lo[2]:hi[2],lo[1]:hi[1],lo[0]:hi[0]]
    envelope=((x-1010)/105)**2+((y-1045)/95)**2+((z-307)/82)**2<=1
    # Retain the strong vessel wall connected beyond the reviewed envelope.
    strong=(field>=135)|(raw>=190)
    labels,n=ndi.label(strong,structure=np.ones((3,3,3),bool))
    anchors=np.unique(labels[~envelope]);anchors=anchors[anchors!=0]
    protected=np.isin(labels,anchors)
    del labels
    field08=ndi.gaussian_filter(raw.astype(np.float32),.8,truncate=3)
    labels,n=ndi.label((field08>=135)|(raw>=190),structure=np.ones((3,3,3),bool))
    anchors=np.unique(labels[~envelope]);anchors=anchors[anchors!=0]
    protected|=np.isin(labels,anchors)
    del labels,field08
    guard=ndi.binary_dilation(protected,structure=sphere(4))
    core=(field>=.28*255)&envelope&~guard
    mask=ndi.binary_dilation(core,structure=sphere(2))&envelope&~guard
    return lo,hi,mask.astype(np.uint8)*255,dict(method='All measured foreground in the reviewed upper outflow envelope, with sigma0.5/sigma0.8 anchored strong wall protection and 0.3176-mm guard.',protectedSupportOverlap=int(np.count_nonzero(mask&protected)),protectedGuardOverlap=int(np.count_nonzero(mask&guard)),reviewEnvelope=dict(center=[1010,1045,307],radius=[105,95,82]))

def save_item(id,label,lo,hi,data,policy):
    packed=gzip.compress(memoryview(np.ascontiguousarray(data)),compresslevel=9,mtime=0)
    p=PUBLIC/(id+'-reviewed.raw.gz');p.write_bytes(packed)
    nonzero=np.nonzero(data);a=[int(q.min()) for q in nonzero][::-1];b=[int(q.max()+1) for q in nonzero][::-1]
    return dict(id=id,label=label,url='./assets/cleanup-v25/'+p.name,format='gzip-u8-zyx',dimensionsXYZ=(hi-lo).tolist(),lowerFullFineXYZ=lo.tolist(),upperFullFineXYZ=hi.tolist(),nonzeroBoundsFullFineXYZ=[(lo+a).tolist(),(lo+b).tolist()],compressedBytes=len(packed),decodedBytes=data.nbytes,sha256=sha(packed),decodedSha256=sha(memoryview(data)),maskedVoxels=int(np.count_nonzero(data)),maskedVolumeMm3=float(np.count_nonzero(data)*.0794**3),policy=policy)

def review(reader,lo,hi,data,coordinates,name):
    fig,axes=plt.subplots(3,len(coordinates),figsize=(3.7*len(coordinates),16),constrained_layout=True)
    for col,y in enumerate(coordinates):
        a=lo.copy();b=hi.copy();a[1]=y;b[1]=y+1;p=reader.region(a,b)[:,0,:];m=data[:,y-lo[1],:]!=0
        extent=[lo[0],hi[0],hi[2],lo[2]]
        for row in range(3):
            ax=axes[row,col];q=p.copy()
            if row==2:q[m]=0
            ax.imshow(q,cmap='gray',vmin=40,vmax=200,extent=extent,interpolation='nearest')
            if row==1:
                rgba=np.zeros((*m.shape,4));rgba[m]=[1,.2,.06,.7];ax.imshow(rgba,extent=extent)
            ax.set(title=f'Y={y} · section {y/4+1:g}\n'+['Measured source','Reviewed exclusion (coral)','Displayed source after exclusion'][row],xlabel='Fine X',ylabel='Fine Z')
    fig.suptitle(name+' · source pixels remain unchanged; this is a reversible 3D display selection',fontsize=13)
    fig.savefig(OUT/(name+'-source-review.jpg'),dpi=135);plt.close(fig)

def main():
    OUT.mkdir(parents=True,exist_ok=True);PUBLIC.mkdir(parents=True,exist_ok=True)
    reader=FineSource(cache_bricks=16);items=[]
    for id,label,fn,planes in [('atrial','Extended atrial material',atrial,[920,1040,1152,1184,1216,1236,1248]),('outflow','Upper outflow material',outflow,[960,1000,1040,1080,1120])]:
        lo,hi,data,policy=fn(reader);item=save_item(id,label,lo,hi,data,policy);items.append(item)
        review(reader,lo,hi,data,planes,id)
        print(json.dumps({k:item[k] for k in ['id','compressedBytes','decodedBytes','maskedVoxels','maskedVolumeMm3']}),flush=True)
        del data
    old=json.loads((ROOT/'public/assets/lumen-cleanup-v23/manifest.json').read_text())
    meta={k:old[k] for k in ['donorId','sampling','sourceManifestUrl','sourceManifestSha256','sourceFullDimensionsXYZ','sourceSpacingUm','longestMm','extent','coordinateConvention','worldToFine','fineToMaskUv']}
    meta.update(version=2,id='ladaf-reviewed-lumen-display-v25',defaultEnabled=True,title='Reviewed lumen cleanup',description='User-requested display exclusion of extended atrial material, including its bright core through section310, and reviewed upper outflow material. Identity remains unverified. Original CT cards and source data are unchanged.',masks=items,limitations=['Display exclusions are not biological classification or validated anatomical segmentation.','Serial reviewed envelopes specifically target the unwanted object. Original geometry and source pixels remain recoverable.','Disconnected whole-heart debris is handled by an independent source-pinned topology mask.'])
    (PUBLIC/'lumen-manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
    (OUT/'lumen-build.json').write_text(json.dumps(dict(source=reader.receipt(),manifestSha256=sha((PUBLIC/'lumen-manifest.json').read_bytes()),items=items),indent=2)+'\n')

if __name__=='__main__':main()
