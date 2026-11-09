"""Revisit bounded TG candidate neighborhoods using explicit regional identity.

This reuses the prior measured candidates; it does not silently rerun or change
the original scientific search. Additional RV candidates are local rotations.
"""
from audit import *
from common import frame, rotated, contact_sheet, grid, world_frame

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    volume,source=load_volume();labels=load_labels();tracks=read('docs/anatomy/cavity-tracks.json')
    cat=read('public/assets/tee-atlas/plane-fit-v2.json');adaptive=read('docs/tee-plane-qc-v2/adaptive-level-review.json')
    report={}
    for key in ['tgpapillary','tgapicalsax','tgbasalsax','tgrvbasal','tgrvin']:
        f=source_frame(cat['views'][key]['frame'])
        pool=[dict(id='current',frame=f)]
        if key in adaptive['views']:
            pool += [dict(x,frame={k:np.asarray(v,float) if isinstance(v,list) else v for k,v in x['frame'].items()}) for x in adaptive['views'][key]]
        else:
            for yaw in [-8,0,8]:
                for pitch in [-8,0,8]:
                    for offset in [-2,0,2]:
                        if yaw==pitch==offset==0:continue
                        pool.append(dict(id=f'{yaw:+d}/{pitch:+d}/{offset:+d}',frame=rotated(f,yaw,pitch,offset,f['center'])))
        items=[];records=[]
        for p in pool:
            sf=p['frame'];a,b=sample(volume,sf,500,labels);m=metrics(a,b,sf,tracks)
            fr=m['regionalTissue'];lv=fr['LV']['fraction'];rv=fr['RV']['fraction']
            items.append((image(a,b,.7),f"{key} · {p['id']}",f"LV {lv:.1%} / RV {rv:.1%}; tissue only"))
            records.append(dict(id=p['id'],frame=world_frame(sf),metrics=m,offsetFromOriginalMm=p.get('offsetFromOriginalMm'),tiltDegrees=p.get('tiltDegrees')))
        contact_sheet(items,OUT/f'neighbors-{key}.jpg',f'{key} · measured candidate anatomy with v17 region identity',cols=4,cell=400,row=435)
        report[key]=records
        print(key,len(pool),'measured candidates',flush=True)
    (OUT/'neighbor-review.json').write_text(json.dumps(dict(source=source,labels='v17 approximate tissue-ownership; not papillary/valve identities',views=report),indent=2)+'\n')

if __name__=='__main__':main()
