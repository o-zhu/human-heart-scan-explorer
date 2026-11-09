"""Native production-GLSL review of the measured main-view starts.

Resident 317.6 um source is intentional here: this verifies orientation,
retained half and camera composition, not browser performance or Ultra detail.
"""
from pathlib import Path
import sys,json,copy,itertools
import audit as aq
ROOT=aq.ROOT
fixture=ROOT/'tests/renderer-responsiveness-v16-native.py'
sys.argv=[sys.argv[0],'--output',str(ROOT/'docs/main-view-qc-v3/native')]
__file__=str(fixture)
setup=fixture.read_text().split('checks=[]')[0].replace('W, H, VW, VH = 490, 590, 180, 217','W, H, VW, VH = 662, 600, 180, 164')
exec(compile(setup,str(fixture),'exec'))

review=read_json(ROOT/'public/assets/main-view-qc-v3.json')
donor=next(d for d in donors if d['id']=='ladaf-2021-17')
manifest=read_json(public_path(donor['manifestUrl']));level=manifest['levels']['high'];resident=load_volume(level);texture(0,resident,True)
cleanup=read_json(public_path(donor['cleanupManifestUrl']));texture(2,np.frombuffer(gzip.decompress(public_path(cleanup['volumeUrl']).read_bytes()),np.uint8).reshape(*cleanup['dimensions'][::-1]).copy())
labels=aq.qc.load_labels();texture(3,np.ascontiguousarray(labels));colors=node('import {buildAnatomyPalette} from "./public/render-styles.js";console.log(JSON.stringify(buildAnatomyPalette()));');palette_array=np.asarray(colors,np.float32)
base_configure=configure

def configure(program,out,level,cleanup,world,*args,**kwargs):
    fn('glBindBuffer',None,[U,U])(0x8892,buf)
    base_configure(program,out,level,cleanup,world,*args,**kwargs)
    b=world['_basis'];normal=np.array(world['normal'])*(-1 if world.get('_flip') else 1)
    for name,value in b.items():u3(program,name,value)
    u3(program,'planeNormal',normal);uf(program,'planeDistance',np.dot(normal,world['center']))
    ui(program,'lumenCleanupReady',0);ui(program,'palette',world['_palette']);ui(program,'anatomyReady',1);ui(program,'anatomySelected',0);uf(program,'anatomyOpacity',.65);u3(program,'anatomyDimensions',labels.shape[::-1]);fn('glUniform3fv',None,[I,I,P])(loc(program,b'anatomyColors[0]'),16,palette_array.ctypes.data)

original=read_json(ROOT/'public/assets/flow-views-v5.json')['presets'];presets=node('import fs from "node:fs";import {applyMainViewReview,reviewedStartingCamera} from "./public/main-view-review.js";const ps=JSON.parse(fs.readFileSync("public/assets/flow-views-v5.json")).presets,review=JSON.parse(fs.readFileSync("public/assets/main-view-qc-v3.json"));console.log(JSON.stringify(applyMainViewReview(ps,review,{datasetId:"1659197537"}).map(p=>({...p,camera:reviewedStartingCamera(p,p.world,{flip:p.flip,aspect:1.104})}))));')
results=[]
for p in presets:
    for state in (['previous','reviewed'] if p['id'] in ['rv-outflow','la-outflow'] else ['reviewed']):
        world=copy.deepcopy(p['world']);camera=p['camera'];flip=p['flip']
        if state=='previous':
            old=next(o for o in original if o['id']==p['id']);world=copy.deepcopy(old['world']);flip=old['flip'];n=np.asarray(world['normal'])*(-1 if flip else 1);n=unit(n+np.asarray(world['right'])*.24*(-1 if flip else 1)+np.asarray(world['up'])*.10);u=unit(np.asarray(world['up'])-n*np.dot(n,world['up']));camera=dict(normal=n,up=u,target=world['target'],distance=old['cameraDistance'])
        normal=np.asarray(camera['normal']);up=np.asarray(camera['up']);forward=-normal;right=unit(np.cross(forward,up));eye=np.asarray(camera['target'])+normal*camera['distance'];basis=dict(eye=eye,forward=forward,right=right,up=up)
        cap=aq.qc.sample(resident,aq.qc.source_frame(world),1000);texture(1,np.ascontiguousarray(cap),True)
        items=[]
        for palette in [4,5]:
            world.update(_basis=basis,_flip=flip,_palette=palette)
            im=draw(programs['volume'],full,level,cleanup,world,donor['displayWindow'],p['threshold'],cap.shape,ready=1)
            image=Image.fromarray(im).convert('RGB');image.save(OUT/f"{p['id']}-{state}-palette{palette}.jpg",quality=93)
            items.append((image,'Measured resident source' if palette==4 else 'Approximate regional labels',f"Distance {camera['distance']:.3f} · {state} starting camera"))
        aq.qc.contact_sheet(items,OUT/f"{p['id']}-{state}.jpg",p['id']+' · '+state+' · production scalar GLSL',cols=2,cell=W,row=H+70)
        item=dict(id=p['id'],state=state,camera={k:np.asarray(value).tolist() for k,value in camera.items()},glError=fn('glGetError',U,[])());results.append(item);print(json.dumps(item),flush=True)
(OUT/'review.json').write_text(json.dumps(dict(productionShaders=True,scope=__doc__,sourceSpacingUm=317.6,checks=results),indent=2)+'\n')

# Conservative rectangles observed in the actual 944 x 856 main canvas.
# Eight pixels are reserved beyond each overlay's measured dimensions.
clearance={}
for key in [p['id'] for p in presets]:
    path=OUT/f"{key}-reviewed-palette4.jpg";im=Image.open(path);a=np.asarray(im);mask=a.max(2)>45
    width,height=im.size;intro=(round(373/944*width),round(228/856*height));toolbar=(round(278/944*width),round(98/856*height))
    ys,xs=np.nonzero(mask);item=dict(tissuePixels=int(mask.sum()),introOverlapPixels=int(mask[:intro[1],:intro[0]].sum()),toolbarOverlapPixels=int(mask[:toolbar[1],width-toolbar[0]:].sum()),renderedBounds=[[int(xs.min()),int(ys.min())],[int(xs.max()),int(ys.max())]])
    clearance[key]=item;guide=ImageDraw.Draw(im);guide.rectangle([0,0,*intro],outline='#be7465',width=2);guide.rectangle([width-toolbar[0],0,width-1,toolbar[1]],outline='#be7465',width=2);im.save(OUT/f"{key}-overlay-clearance.jpg",quality=93)
(OUT/'overlay-clearance.json').write_text(json.dumps(dict(referenceCanvas=[944,856],introRect=[0,0,365,220],toolbarRect=[674,0,944,90],guardPixels=8,threshold=45,checks=clearance),indent=2)+'\n')
