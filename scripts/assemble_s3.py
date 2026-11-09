"""Decode authentic HOA N5 s3/Blosc chunks into a contiguous Z,Y,X uint16 volume."""
import argparse, hashlib, json, pathlib, struct, time
import blosc2
import numpy as np
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data-root', type=pathlib.Path, default=pathlib.Path.cwd() / 'heart-data')
args = parser.parse_args()
ROOT = args.data_root.resolve()
ROOT.mkdir(parents=True, exist_ok=True)
NX, NY, NZ = 951, 951, 1060
started = time.monotonic()
vol = np.lib.format.open_memmap(ROOT/'s3-volume-u16.npy',mode='w+',dtype=np.uint16,shape=(NZ,NY,NX))
records=[]
for z in range(9):
 for y in range(8):
  for x in range(8):
   path=ROOT/'chunks-s3'/f'{x}_{y}_{z}.bin'
   payload=path.read_bytes()
   mode,nd=struct.unpack('>HH',payload[:4]); assert mode==0 and nd==3,(path,mode,nd)
   dims=struct.unpack('>III',payload[4:16]); raw=blosc2.decompress(payload[16:])
   assert len(raw)==np.prod(dims)*2,(path,dims,len(raw))
   chunk=np.frombuffer(raw,dtype='>u2').reshape(dims[::-1])
   dx,dy,dz=(min(dims[0],NX-x*128),min(dims[1],NY-y*128),min(dims[2],NZ-z*128))
   vol[z*128:z*128+dz,y*128:y*128+dy,x*128:x*128+dx]=chunk[:dz,:dy,:dx]
   records.append({'path':path.name,'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest(),'dimensionsXYZ':list(dims)})
 print(f'Z chunk row {z+1}/9, {time.monotonic()-started:.1f}s',flush=True)
vol.flush()
vals=np.asarray(vol[::6,::6,::6]).ravel()
summary={'dimensionsXYZ':[NX,NY,NZ],'arrayOrder':'ZYX in numpy; X fastest','dtype':'uint16','spacingUm':158.8,'downsampleFactor':8,'sourceWindow':[14640,23545],'percentiles':dict(zip(['0','1','5','10','25','50','75','90','95','99','100'],map(float,np.percentile(vals,[0,1,5,10,25,50,75,90,95,99,100])))),'elapsedSeconds':time.monotonic()-started}
(ROOT/'s3-volume-summary.json').write_text(json.dumps(summary,indent=2))
(ROOT/'s3-chunk-provenance.json').write_text(json.dumps(records,indent=2))
(ROOT/'cap-detail-status.json').write_text(json.dumps({'status':'s3 assembly complete','summary':summary,'volume':str(ROOT/'s3-volume-u16.npy'),'next':'Encode high fidelity orthogonal sections'},indent=2))
print(json.dumps(summary,indent=2))
