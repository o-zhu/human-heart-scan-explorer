#!/usr/bin/env python3
"""Incremental immutable checkpoints for an already verified native surface run.

Only --upload writes to the existing Site, using UploadClient(workers=1) and
hidden stdin. A checkpoint contains completed records, their small overview NBE
bytes, original plans/configuration, source-object metadata and real native
upload receipts. Original intensities and native surface payloads are excluded.

Restore validates bounded local/remote objects into a staging directory, then
atomically exposes a new work directory. It never downloads source intensities
or native surfaces and never starts the reconstruction runner automatically.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import struct
import sys
import time
import zlib

import httpx
import numpy as np

from upload import API, SITE_URL, UploadClient, UploadError, read_access, validate_remote_path

ROOT = Path(__file__).resolve().parents[2]
PART_SCHEMA = 'guided-native-checkpoint-part-v21.1'
CONTROL_SCHEMA = 'guided-native-checkpoint-control-v21.1'
LEDGER_SCHEMA = 'guided-native-checkpoint-ledger-v21.1'
REFERENCE_SCHEMA = 'guided-native-checkpoint-reference-v21.1'
PROCESSING_FILES = ('source.py','prior.py','edge_codec.py','refine.py','tv_kernel.py','tv_kernel.c')
SHA = re.compile(r'^[0-9a-f]{64}$',re.ASCII)
COORD = re.compile(r'^(0|[1-9]\d?)_(0|[1-9]\d?)_(0|[1-9]\d?)$',re.ASCII)
MAX_OBJECT = 32*1024**2
MAX_PART_DECODED = 32*1024**2
MAX_CONTROL_DECODED = 96*1024**2
MAX_PLAN = 8*1024**2
MAX_SOURCE_LEDGER = 32*1024**2
MAX_RECORD = 256*1024
MAX_OVERVIEW = 256*1024
MAX_RECORDS = 60*60*67
MAX_PARTS = MAX_RECORDS


class CheckpointError(ValueError):
    pass


def require(condition, message):
    if not condition: raise CheckpointError(message)


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def checksum(value, label='checksum'):
    require(isinstance(value,str) and SHA.fullmatch(value) is not None,f'Invalid {label}.')
    return value


def integer(value, minimum, maximum, label):
    require(type(value) is int and minimum<=value<=maximum,f'Invalid {label}.')
    return value


def strict_json(data):
    def pairs(items):
        result={}
        for key,value in items:
            require(key not in result,'Duplicate JSON key in checkpoint data.')
            result[key]=value
        return result
    def number(value):
        parsed=float(value)
        require(math.isfinite(parsed),'Nonfinite JSON value.')
        return parsed
    try:
        return json.loads(data,object_pairs_hook=pairs,
            parse_float=number,
            parse_constant=lambda _:(_ for _ in ()).throw(CheckpointError('Nonfinite JSON value.')))
    except (UnicodeError,json.JSONDecodeError,RecursionError) as error:
        raise CheckpointError('Checkpoint JSON is malformed.') from error


def read_bytes(path, maximum):
    require(not Path(path).is_symlink(),'Checkpoint input cannot be a symbolic link.')
    with Path(path).open('rb') as stream: data=stream.read(maximum+1)
    require(len(data)<=maximum,f'Local checkpoint input exceeds its {maximum}-byte bound.')
    return data


def atomic_bytes(path, data, *, immutable=False):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    require(not path.is_symlink(),'Output cannot replace a symbolic link.')
    if immutable and path.exists():
        require(read_bytes(path,len(data))==data,'An existing immutable checkpoint has different bytes.')
        return
    temporary=path.with_name(path.name+f'.{os.getpid()}.partial')
    require(not temporary.exists(),'A checkpoint temporary file already exists.')
    try:
        with temporary.open('xb') as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
        directory=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        if temporary.exists():temporary.unlink()


def coordinates(value):
    require(isinstance(value,(list,tuple)) and len(value)==3,'Invalid checkpoint coordinate shape.')
    result=tuple(integer(n,0,limit-1,'source coordinate') for n,limit in zip(value,(60,60,67)))
    return result


def coordinate_key(value):
    return '_'.join(map(str,coordinates(value)))


def key_coordinates(value):
    require(isinstance(value,str) and COORD.fullmatch(value) is not None,'Invalid canonical tile name.')
    return coordinates(tuple(map(int,value.split('_'))))


def contained(root, relative):
    require(isinstance(relative,str) and relative and '\\' not in relative and '\x00' not in relative,'Invalid checkpoint relative path.')
    pure=PurePosixPath(relative)
    require(not pure.is_absolute() and str(pure)==relative and all(p not in ('.','..') for p in pure.parts),'Unsafe checkpoint path.')
    root=Path(root).resolve();path=root.joinpath(*pure.parts)
    require(path.resolve().is_relative_to(root),'Checkpoint path escapes its directory.')
    require(not path.is_symlink(),'Checkpoint path cannot be a symbolic link.')
    return path


def blob(data):
    return dict(bytes=len(data),sha256=digest(data),base64=base64.b64encode(data).decode('ascii'))


def unblob(value, maximum, label):
    require(isinstance(value,dict),f'Missing {label}.')
    size=integer(value.get('bytes'),0,maximum,f'{label} byte count')
    expected=checksum(value.get('sha256'),label+' checksum')
    encoded=value.get('base64')
    require(isinstance(encoded,str) and len(encoded)==4*((size+2)//3),f'Invalid {label} base64 length.')
    try:data=base64.b64decode(encoded,validate=True)
    except (ValueError,base64.binascii.Error) as error:raise CheckpointError(f'Invalid {label} base64.') from error
    require(len(data)==size and digest(data)==expected,f'{label} checksum did not match.')
    return data


def gunzip(data, maximum):
    try:
        decoder=zlib.decompressobj(16+zlib.MAX_WBITS)
        decoded=decoder.decompress(data,maximum+1)
        require(len(decoded)<=maximum and not decoder.unconsumed_tail,'Decoded checkpoint exceeds its bound.')
        require(decoder.eof and not decoder.unused_data,'Incomplete or concatenated gzip checkpoint.')
        return decoded
    except zlib.error as error:raise CheckpointError('Checkpoint gzip data are invalid.') from error


def validate_receipt(receipt, expected_sha, expected_bytes, *, kind):
    require(isinstance(receipt,dict) and receipt.get('verified') is True,'A real verified remote receipt is required.')
    require(receipt.get('sha256')==expected_sha and receipt.get('bytes')==expected_bytes,'Remote receipt does not match the artifact.')
    remote=receipt.get('path');maximum=validate_remote_path(remote,expected_sha)
    integer(expected_bytes,1,maximum,'remote artifact size')
    require(receipt.get('url')==SITE_URL+API+remote,'Remote receipt URL is not the exact verified Site object.')
    require(remote.startswith('tiles/') if kind=='native' else remote==f'manifest-{expected_sha}.json.gz','Remote object kind is incorrect.')
    try:when=datetime.fromisoformat(receipt.get('verifiedAt',''))
    except (ValueError,TypeError) as error:raise CheckpointError('Remote receipt has no verification timestamp.') from error
    require(when.tzinfo is not None,'Remote verification timestamp must have a timezone.')
    return receipt


def plan_values(data):
    require(0<len(data)<=MAX_PLAN,'Plan payload is empty or oversized.')
    try:
        stream=io.BytesIO(data);version=np.lib.format.read_magic(stream)
        require(version in ((1,0),(2,0)),'Unsupported original NPY version.')
        header=(np.lib.format.read_array_header_1_0 if version==(1,0) else np.lib.format.read_array_header_2_0)
        shape,_,dtype=header(stream,max_header_size=4096)
        require(len(shape)==2 and shape[1]==3 and 0<=shape[0]<=MAX_RECORDS and dtype.kind in 'iu' and dtype.itemsize<=8,
                'Invalid or oversized source-plan NPY header.')
        require(stream.tell()+shape[0]*3*dtype.itemsize==len(data),'Source-plan NPY length differs from its bounded header.')
        values=np.load(io.BytesIO(data),allow_pickle=False,max_header_size=4096)
    except (ValueError,EOFError) as error:raise CheckpointError('Plan is not a safe NPY array.') from error
    require(isinstance(values,np.ndarray) and values.ndim==2 and values.shape[1]==3 and values.dtype.kind in 'iu' and len(values)<=MAX_RECORDS,'Invalid source-plan array.')
    result={coordinates(row.tolist()) for row in values}
    require(len(result)==len(values),'Source plan has duplicate coordinates.')
    return result


def identity_for(run, input_data, core_data):
    return dict(inputPlan=digest(input_data),corePlan=digest(core_data),configuration=run['config'],
        processingCode={name:digest(read_bytes(Path(__file__).parent/name,4*1024**2)) for name in PROCESSING_FILES},
        priorManifest=digest(read_bytes(ROOT/'public/assets/ultra-volume-v7.json',32*1024**2)))


def identity_fingerprint(identity):
    # Exactly the runner's serialization, including its normal JSON separators.
    return digest(json.dumps(identity,sort_keys=True).encode())


def validate_run(run, input_data, core_data, identity=None):
    require(isinstance(run,dict) and run.get('schema')=='guided-native-run-v21.1','Unsupported native run manifest.')
    fingerprint=checksum(run.get('fingerprint'),'run fingerprint')
    require(isinstance(run.get('config'),dict) and run.get('sourceSpacingUm')==19.85 and run.get('nativeDimensionsXYZ')==[7614,7614,8480],'Run geometry or processing configuration is invalid.')
    inputs,cores=plan_values(input_data),plan_values(core_data)
    require(cores<=inputs and len(inputs)==run.get('inputBlocks') and len(cores)==run.get('coreBlocks'),'Original plans do not match the run manifest.')
    current=identity_for(run,input_data,core_data)
    if identity is not None:
        require(isinstance(identity,dict),'Invalid archived processing identity.')
        require(identity.get('inputPlan')==digest(input_data) and identity.get('corePlan')==digest(core_data) and identity.get('configuration')==run['config'],'Checkpoint fingerprint inputs do not match the original plans/configuration.')
        require(identity_fingerprint(identity)==fingerprint,'Archived processing identity does not match the run fingerprint.')
        require(current==identity,'Resume requires the original processing files and prior manifest; use the matching source checkout.')
    require(identity_fingerprint(current)==fingerprint,'The current processing files, prior manifest and original plans do not reproduce this run fingerprint.')
    return inputs,cores,current


def validate_source_ledger(data):
    require(len(data)<=MAX_SOURCE_LEDGER and (not data or data.endswith(b'\n')),'Source-object ledger is oversized or has an incomplete final line.')
    count=0
    for line in data.splitlines():
        require(0<len(line)<=8192,'Invalid source-object ledger line size.')
        item=strict_json(line);require(isinstance(item,dict),'Invalid source-object ledger record.')
        coordinates(item.get('coordinatesXYZ'));checksum(item.get('sha256'),'source-object checksum')
        integer(item.get('bytes'),16,8*1024**2,'original source-object byte count');count+=1
        require(count<=500000,'Source-object ledger has too many lines.')
    return count


def source_snapshot(run_root):
    path=run_root/'source-objects.jsonl'
    if not path.exists():return b'',dict(fileBytesAtSnapshot=0,droppedIncompleteTailBytes=0,lines=0)
    require(not path.is_symlink(),'Source-object ledger cannot be a symbolic link.')
    with path.open('rb') as stream:
        size=os.fstat(stream.fileno()).st_size
        require(size<=MAX_SOURCE_LEDGER,'Source-object ledger exceeds the 32 MiB snapshot bound.')
        data=stream.read(size)
    require(len(data)==size,'Source-object ledger was truncated during the snapshot.')
    end=data.rfind(b'\n')+1;prefix=data[:end]
    require(size-end<=8192,'Source-object ledger has an oversized incomplete tail.')
    return prefix,dict(fileBytesAtSnapshot=size,droppedIncompleteTailBytes=size-end,lines=validate_source_ledger(prefix))


def validate_overview(artifact, encoded, xyz):
    require(artifact.get('bytes')==len(encoded) and digest(encoded)==artifact.get('sha256'),'Overview compressed checksum did not match its completed record.')
    integer(len(encoded),1,MAX_OVERVIEW,'overview payload size')
    expected=integer(artifact.get('decodedBytes'),64,MAX_OVERVIEW,'decoded overview size')
    raw=gunzip(encoded,MAX_OVERVIEW)
    require(len(raw)==expected,'Decoded overview size differs from its completed record.')
    if artifact.get('decodedSha256'):require(digest(raw)==checksum(artifact['decodedSha256']),'Decoded overview checksum did not match.')
    h=struct.unpack('<16I',raw[:64]);view=memoryview(raw)
    require(h[:6]==(0x3145424e,1,33,33,33,5) and h[15]==4 and h[10:13]==tuple(n*128 for n in xyz),'Overview NBE header does not match the native block.')
    require(h[6]==(33**3+7)//8 and all(n<=32*33**2 for n in h[7:10]),'Overview edge dimensions are inconsistent.')
    require(64+h[6]+sum((n*5+7)//8 for n in h[7:10])==len(view),'Overview edge stream length is inconsistent.')
    threshold,spacing=struct.unpack('<ff',raw[52:60])
    require(abs(threshold-17133.4)<.01 and abs(spacing-79.4)<.001,'Overview threshold or spacing is inconsistent.')


def validate_record(raw, overview_bytes, fingerprint, cores, expected_xyz=None):
    require(0<len(raw)<=MAX_RECORD,'Completed record is empty or oversized.')
    record=strict_json(raw);require(isinstance(record,dict),'Invalid completed record.')
    xyz=coordinates(record.get('coordinatesXYZ'));key=coordinate_key(xyz)
    require(xyz in cores and (expected_xyz is None or xyz==expected_xyz),'Completed record lies outside its exact core plan or file name.')
    require(record.get('fingerprint')==fingerprint,'Completed record fingerprint differs from its run.')
    require(type(record.get('empty')) is bool and isinstance(record.get('artifacts'),list),'Completed record has no valid artifact set.')
    artifacts=record['artifacts'];require(len(artifacts)==(1 if record['empty'] else 2),'Completed record artifact count is inconsistent.')
    overview=None;native=None
    for artifact in artifacts:
        require(isinstance(artifact,dict),'Invalid artifact record.')
        checksum(artifact.get('sha256'),'artifact checksum')
        if artifact.get('role')=='overview':
            require(overview is None and artifact.get('path')==f'tiles/{key}.lod.nbe.gz','Unsafe or duplicated overview path.')
            overview=artifact
        elif artifact.get('role')=='native':
            require(native is None and not record['empty'] and artifact.get('path')==f'tiles/{key}.nbe.gz','Unsafe or duplicated native path.')
            integer(artifact.get('bytes'),1,4*1024**2,'native byte count')
            integer(artifact.get('decodedBytes'),64,5*1024**2,'native decoded byte count')
            receipt=validate_receipt(artifact.get('remote'),artifact['sha256'],artifact['bytes'],kind='native')
            require(receipt['path']==f'tiles/{key}-{artifact["sha256"]}.nbe.gz','Native receipt coordinates differ from the record.')
            native=artifact
        else:raise CheckpointError('Unrecognized artifact role in a completed record.')
    require(overview is not None and (record['empty'] or native is not None),'Completed record lacks its required overview or verified native receipt.')
    validate_overview(overview,overview_bytes,xyz)
    return xyz,record,overview


def entry_for(run_root, path, fingerprint, cores):
    raw=read_bytes(contained(run_root,'records/'+path.name),MAX_RECORD)
    xyz=key_coordinates(path.stem);key=coordinate_key(xyz)
    encoded=read_bytes(contained(run_root,f'tiles/{key}.lod.nbe.gz'),MAX_OVERVIEW)
    validate_record(raw,encoded,fingerprint,cores,xyz)
    return dict(xyz=list(xyz),record=blob(raw),overview=blob(encoded))


def object_metadata(metadata, *, decoded_limit=MAX_CONTROL_DECODED):
    require(isinstance(metadata,dict),'Missing immutable checkpoint metadata.')
    sha=checksum(metadata.get('sha256'),'checkpoint object checksum')
    require(metadata.get('file')==f'manifest-{sha}.json.gz','Checkpoint file name is not its content address.')
    integer(metadata.get('bytes'),1,MAX_OBJECT,'compressed checkpoint size')
    integer(metadata.get('decodedBytes'),1,decoded_limit,'decoded checkpoint size')
    checksum(metadata.get('decodedSha256'),'decoded checkpoint checksum')
    if 'remote' in metadata:
        validate_receipt(metadata['remote'],sha,metadata['bytes'],kind='checkpoint')
    return metadata


def validate_parts(parts, cores):
    require(isinstance(parts,list) and len(parts)<=MAX_PARTS,'Checkpoint has too many parts or no part list.')
    seen=set();objects=set()
    for part in parts:
        object_metadata(part,decoded_limit=MAX_PART_DECODED)
        require(part['sha256'] not in objects,'Checkpoint repeats an immutable part.')
        objects.add(part['sha256'])
        items=part.get('coordinatesXYZ')
        require(isinstance(items,list) and 0<len(items)<=MAX_RECORDS,'Invalid part coordinate list.')
        integer(part.get('recordCount'),1,MAX_RECORDS,'part record count')
        require(len(items)==part['recordCount'],'Part coordinate count does not match its record count.')
        for item in items:
            xyz=coordinates(item)
            require(xyz in cores and xyz not in seen,'Checkpoint repeats a coordinate or contains a coordinate outside its core plan.')
            seen.add(xyz)
    return seen


class PartBuilder:
    """One bounded gzip stream; compressor copies avoid repeatedly encoding a part."""
    def __init__(self, fingerprint, target):
        self.target=target
        self.compressor=zlib.compressobj(6,zlib.DEFLATED,31)
        prefix=b'{"schema":'+canonical(PART_SCHEMA)+b',"fingerprint":'+canonical(fingerprint)+b',"entries":['
        self.chunks=[self.compressor.compress(prefix)]
        self.compressed=sum(map(len,self.chunks));self.decoded=len(prefix)
        self.raw_hash=hashlib.sha256(prefix);self.coords=[]

    def append(self, entry):
        value=(b',' if self.coords else b'')+canonical(entry)
        if self.decoded+len(value)+2>MAX_PART_DECODED:return False
        trial=self.compressor.copy();chunk=trial.compress(value)
        ending=trial.copy();tail=ending.compress(b']}')+ending.flush()
        if self.compressed+len(chunk)+len(tail)>self.target:return False
        self.compressor=trial;self.chunks.append(chunk);self.compressed+=len(chunk)
        self.decoded+=len(value);self.raw_hash.update(value);self.coords.append(entry['xyz'])
        return True

    def finish(self, output):
        require(self.coords,'Cannot write an empty checkpoint part.')
        self.chunks.append(self.compressor.compress(b']}')+self.compressor.flush())
        self.raw_hash.update(b']}');self.decoded+=2
        encoded=b''.join(self.chunks);sha=digest(encoded)
        require(len(encoded)<=self.target<=MAX_OBJECT,'Checkpoint part exceeded its compressed size bound.')
        name=f'manifest-{sha}.json.gz'
        atomic_bytes(contained(output,name),encoded,immutable=True)
        return dict(file=name,sha256=sha,bytes=len(encoded),decodedBytes=self.decoded,
            decodedSha256=self.raw_hash.hexdigest(),recordCount=len(self.coords),coordinatesXYZ=self.coords)


def write_ledger(path, value):
    value=dict(value);value.pop('integritySha256',None)
    value['integritySha256']=digest(canonical(value))
    encoded=canonical(value)+b'\n'
    require(len(encoded)<=MAX_OBJECT,'Incremental checkpoint ledger exceeds its 32 MiB bound.')
    atomic_bytes(path,encoded)


def load_ledger(path, fingerprint, cores):
    if not path.exists():return dict(schema=LEDGER_SCHEMA,fingerprint=fingerprint,parts=[])
    ledger=strict_json(read_bytes(path,MAX_OBJECT))
    require(isinstance(ledger,dict) and ledger.get('schema')==LEDGER_SCHEMA,'Unsupported incremental checkpoint ledger.')
    saved=checksum(ledger.pop('integritySha256',None),'ledger integrity checksum')
    require(digest(canonical(ledger))==saved,'Incremental checkpoint ledger checksum did not match.')
    require(ledger.get('fingerprint')==fingerprint,'Incremental ledger belongs to another run.')
    validate_parts(ledger.get('parts'),cores)
    return ledger


class LedgerLock:
    def __init__(self,path):self.path=path.with_name(path.name+'.lock');self.stream=None
    def __enter__(self):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        require(not self.path.is_symlink(),'Checkpoint lock cannot be a symbolic link.')
        self.stream=self.path.open('a+b')
        try:fcntl.flock(self.stream.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError as error:
            self.stream.close();self.stream=None
            raise CheckpointError('Another checkpoint cycle holds this incremental ledger lock.') from error
        return self
    def __exit__(self,*_):
        if self.stream:
            fcntl.flock(self.stream.fileno(),fcntl.LOCK_UN);self.stream.close()


def compressed_object(data, output):
    raw=canonical(data)
    require(len(raw)<=MAX_CONTROL_DECODED,'Control checkpoint exceeds its 96 MiB decoded bound.')
    compressor=zlib.compressobj(6,zlib.DEFLATED,31)
    encoded=compressor.compress(raw)+compressor.flush()
    require(0<len(encoded)<=MAX_OBJECT,'Control checkpoint exceeds the 32 MiB API object limit.')
    sha=digest(encoded);name=f'manifest-{sha}.json.gz'
    atomic_bytes(contained(output,name),encoded,immutable=True)
    return dict(file=name,sha256=sha,bytes=len(encoded),decodedBytes=len(raw),decodedSha256=digest(raw))


def snapshot_plan(run_root, run, field, override):
    value=override or run.get(field)
    require(isinstance(value,(str,Path)) and str(value),'The original plan path is missing.')
    path=Path(value)
    if not path.is_absolute():path=run_root/path
    return read_bytes(path,MAX_PLAN),path.resolve()


def checkpoint(args):
    run_root=args.run.resolve();output=args.out.resolve();ledger_path=args.ledger.resolve()
    require(run_root.is_dir(),'The completed native run directory does not exist.')
    require(not args.out.is_symlink() and not args.ledger.is_symlink(),'Checkpoint output and ledger cannot be symbolic links.')
    protected=[run_root/'records',run_root/'tiles',run_root/'next-layer-cache']
    require(not any(output.is_relative_to(p) or ledger_path.is_relative_to(p) for p in protected),'Checkpoint output cannot overlap runner records, tiles or caches.')
    require(ledger_path not in (output/'control-latest.json',output/'control-receipt.json',run_root/'run.json',run_root/'source-objects.jsonl'),'The ledger path would overwrite a protected file.')
    output.mkdir(parents=True,exist_ok=True)
    start=time.monotonic()
    with LedgerLock(ledger_path):
        original_run=read_bytes(run_root/'run.json',MAX_RECORD);run=strict_json(original_run)
        require(isinstance(run,dict),'Invalid native run manifest.')
        input_data,input_path=snapshot_plan(run_root,run,'inputPlan',args.input_plan)
        core_data,core_path=snapshot_plan(run_root,run,'corePlan',args.core_plan)
        require(ledger_path not in (input_path,core_path),'The ledger path would overwrite an original plan.')
        _,cores,identity=validate_run(run,input_data,core_data)
        fingerprint=run['fingerprint'];ledger=load_ledger(ledger_path,fingerprint,cores)
        completed=validate_parts(ledger['parts'],cores);initial=len(completed)
        target=int(args.target_mib*1024**2)
        builder=PartBuilder(fingerprint,target);new_parts=0;new_records=0
        files=sorted((run_root/'records').glob('*.json'),key=lambda p:p.name)
        require(len(files)<=MAX_RECORDS,'Too many completed record files.')
        for path in files:
            xyz=key_coordinates(path.stem)
            if xyz in completed:continue
            if args.max_new_records is not None and new_records>=args.max_new_records:break
            entry=entry_for(run_root,path,fingerprint,cores)
            if not builder.append(entry):
                require(builder.coords,'A single completed record cannot fit this checkpoint target.')
                part=builder.finish(output);ledger['parts'].append(part);new_parts+=1
                write_ledger(ledger_path,ledger)
                builder=PartBuilder(fingerprint,target)
                require(builder.append(entry),'A single completed record cannot fit this checkpoint target.')
            completed.add(xyz);new_records+=1
        if builder.coords:
            ledger['parts'].append(builder.finish(output));new_parts+=1
            write_ledger(ledger_path,ledger)
        for part in ledger['parts']:
            if 'remote' not in part:
                pending=read_bytes(contained(output,part['file']),MAX_OBJECT)
                require(len(pending)==part['bytes'] and digest(pending)==part['sha256'],'An unuploaded checkpoint part is missing or corrupt; it will not be repacked.')
        # The source append log is captured through a complete line, after the
        # selected atomic records have been checked. Intensity caches are absent.
        source_data,source_info=source_snapshot(run_root)
        require(not completed or source_info['lines']>0,'Completed records require their source-object provenance ledger.')
        normalized_run=dict(run,inputPlan='resume/input-plan.npy',corePlan='resume/core-plan.npy')
        config_data=canonical(run['config'])+b'\n'
        def save_control():
            durable=all('remote' in part for part in ledger['parts'])
            control=dict(schema=CONTROL_SCHEMA,fingerprint=fingerprint,createdAt=datetime.now(timezone.utc).isoformat(),
                run=blob(canonical(normalized_run)+b'\n'),plans=dict(input=blob(input_data),core=blob(core_data)),
                configuration=blob(config_data),processingIdentity=identity,
                sourceObjects=blob(source_data),sourceSnapshot=source_info,parts=ledger['parts'],
                completedRecords=len(completed),plannedRecords=len(cores),partsDurable=durable,
                coverageComplete=completed==cores,originalRunSha256=digest(original_run),
                contents='Completed scientific records, local overview edges, public native receipts, exact plans and source-object metadata; no intensity or native surface payloads.')
            return compressed_object(control,output)
        if args.upload:
            access=read_access()
            with UploadClient.from_access(access,workers=1) as uploader:
                access.clear()
                for part in ledger['parts']:
                    if 'remote' in part:continue
                    local=contained(output,part['file'])
                    encoded=read_bytes(local,MAX_OBJECT)
                    require(len(encoded)==part['bytes'] and digest(encoded)==part['sha256'],'Pending checkpoint part is missing or corrupt; it will not be repacked.')
                    part['remote']=uploader.upload(local,part['file'],part['sha256'])
                    validate_receipt(part['remote'],part['sha256'],part['bytes'],kind='checkpoint')
                    write_ledger(ledger_path,ledger)
                metadata=save_control()
                metadata['remote']=uploader.upload(contained(output,metadata['file']),metadata['file'],metadata['sha256'])
                validate_receipt(metadata['remote'],metadata['sha256'],metadata['bytes'],kind='checkpoint')
                atomic_bytes(output/'control-receipt.json',canonical(metadata['remote'])+b'\n')
        else:metadata=save_control()
        reference=dict(schema=REFERENCE_SCHEMA,fingerprint=fingerprint,**metadata)
        atomic_bytes(output/'control-latest.json',canonical(reference)+b'\n')
        ledger['latestControl']=reference;write_ledger(ledger_path,ledger)
        result=dict(action='checkpoint',fingerprint=fingerprint,newRecords=new_records,previouslyBundledRecords=initial,
            completedRecords=len(completed),plannedRecords=len(cores),newParts=new_parts,parts=len(ledger['parts']),
            compressedPartBytes=sum(p['bytes'] for p in ledger['parts']),control=reference,
            durable=args.upload,coverageComplete=completed==cores,sourceSnapshot=source_info,
            sourceIntensityBytes=0,nativeSurfacePayloadBytes=0,seconds=round(time.monotonic()-start,3))
        return result


class CheckpointReader:
    """Only immutable checkpoint JSON may be read from the exact public Site."""
    def __init__(self):
        self.downloaded_bytes=0;self.objects=0
        self.client=httpx.Client(follow_redirects=False,http2=False,timeout=httpx.Timeout(90,connect=20),
            limits=httpx.Limits(max_connections=1,max_keepalive_connections=1),headers={'Accept-Encoding':'identity'})
    def __enter__(self):return self
    def __exit__(self,*_):self.client.close()

    def remote(self,url,expected_bytes=None):
        require(isinstance(url,str) and url.startswith(SITE_URL+API),'Restore URL must be a checkpoint on the exact existing public Site.')
        remote=url[len(SITE_URL+API):]
        match=re.fullmatch(r'manifest-([0-9a-f]{64})\.json\.gz',remote,re.ASCII)
        require(match is not None,'Only canonical content-addressed checkpoint URLs are accepted.')
        sha=match.group(1);validate_remote_path(remote,sha)
        maximum=integer(expected_bytes,1,MAX_OBJECT,'expected checkpoint size') if expected_bytes is not None else MAX_OBJECT
        for attempt in range(4):
            try:
                with self.client.stream('GET',url) as reply:
                    if reply.status_code in (408,429,500,502,503,504) and attempt<3:
                        time.sleep(min(2**attempt,4));continue
                    require(reply.status_code==200,f'Checkpoint download was not accepted (HTTP {reply.status_code}).')
                    require(not reply.headers.get('content-encoding'),'Checkpoint bytes must be served without HTTP content encoding.')
                    require(reply.headers.get('x-content-sha256')==sha,'Checkpoint server checksum header did not match its content address.')
                    length=reply.headers.get('content-length','')
                    require(re.fullmatch(r'[0-9]+',length) is not None,'Checkpoint server omitted its bounded content length.')
                    length=int(length);integer(length,1,maximum,'HTTP checkpoint byte count')
                    require(expected_bytes is None or length==expected_bytes,'Checkpoint HTTP length differs from its receipt.')
                    chunks=[];count=0;hashed=hashlib.sha256()
                    for chunk in reply.iter_raw(128*1024):
                        count+=len(chunk);require(count<=length,'Checkpoint response exceeded its advertised byte count.')
                        hashed.update(chunk);chunks.append(chunk)
                    require(count==length and hashed.hexdigest()==sha,'Downloaded checkpoint checksum or byte count did not match.')
                    self.downloaded_bytes+=count;self.objects+=1
                    return b''.join(chunks),sha
            except httpx.RequestError as error:
                if attempt==3:raise CheckpointError('The public checkpoint download could not be completed.') from error
                time.sleep(min(2**attempt,4))
        raise CheckpointError('The public checkpoint download could not be completed.')


def decode_object(encoded, metadata, limit):
    require(len(encoded)==metadata['bytes'] and digest(encoded)==metadata['sha256'],'Checkpoint object checksum or compressed byte count did not match.')
    raw=gunzip(encoded,limit)
    if 'decodedBytes' in metadata:
        require(len(raw)==metadata['decodedBytes'] and digest(raw)==metadata['decodedSha256'],'Checkpoint decoded checksum or byte count did not match.')
    value=strict_json(raw)
    require(isinstance(value,dict),'Checkpoint object must be a JSON object.')
    return value


def read_object(metadata, base, reader, limit):
    object_metadata(metadata,decoded_limit=limit)
    local=contained(base,metadata['file']) if base is not None else None
    if local is not None and local.exists():encoded=read_bytes(local,MAX_OBJECT)
    else:
        receipt=metadata.get('remote')
        validate_receipt(receipt,metadata['sha256'],metadata['bytes'],kind='checkpoint')
        encoded,_=reader.remote(receipt['url'],metadata['bytes'])
    return decode_object(encoded,metadata,limit)


def read_control(location, reader):
    """Accept a canonical URL, gzip object, decoded control, reference, or receipt."""
    if location.startswith('https://') or '://' in location:
        encoded,sha=reader.remote(location)
        metadata=dict(bytes=len(encoded),sha256=sha)
        return decode_object(encoded,metadata,MAX_CONTROL_DECODED),None,sha
    path=Path(location).absolute()
    require(not path.is_symlink(),'Control input cannot be a symbolic link.')
    maximum=MAX_OBJECT if path.name.endswith('.gz') else MAX_CONTROL_DECODED
    data=read_bytes(path,maximum);base=path.parent.resolve()
    if data.startswith(b'\x1f\x8b'):
        sha=digest(data)
        require(path.name==f'manifest-{sha}.json.gz','Local gzip control name does not match its content checksum.')
        return decode_object(data,dict(bytes=len(data),sha256=sha),MAX_CONTROL_DECODED),base,sha
    value=strict_json(data);require(isinstance(value,dict),'Invalid control JSON input.')
    if value.get('schema')==CONTROL_SCHEMA:return value,base,digest(data)
    if value.get('schema')==REFERENCE_SCHEMA:
        control=read_object(value,base,reader,MAX_CONTROL_DECODED)
        require(control.get('fingerprint')==value.get('fingerprint'),'Control reference fingerprint did not match.')
        return control,base,value['sha256']
    # A root-saved genuine UploadClient receipt is sufficient to find its
    # checksum-named control. It contains no credential or signed URL.
    sha=checksum(value.get('sha256'),'control receipt checksum')
    size=integer(value.get('bytes'),1,MAX_OBJECT,'control receipt size')
    validate_receipt(value,sha,size,kind='checkpoint')
    local=contained(base,f'manifest-{sha}.json.gz')
    encoded=read_bytes(local,MAX_OBJECT) if local.exists() else reader.remote(value['url'],size)[0]
    return decode_object(encoded,dict(bytes=size,sha256=sha),MAX_CONTROL_DECODED),base,sha


def validate_control(control):
    require(control.get('schema')==CONTROL_SCHEMA,'Unsupported restore control schema.')
    fingerprint=checksum(control.get('fingerprint'),'control fingerprint')
    run_data=unblob(control.get('run'),MAX_RECORD,'portable run manifest')
    run=strict_json(run_data);require(isinstance(run,dict),'Invalid portable run manifest.')
    require(run.get('inputPlan')=='resume/input-plan.npy' and run.get('corePlan')=='resume/core-plan.npy','Control run paths are not the required portable paths.')
    plans=control.get('plans');require(isinstance(plans,dict),'Missing original plans.')
    input_data=unblob(plans.get('input'),MAX_PLAN,'input plan')
    core_data=unblob(plans.get('core'),MAX_PLAN,'core plan')
    _,cores,_=validate_run(run,input_data,core_data,control.get('processingIdentity'))
    require(run['fingerprint']==fingerprint,'Control and run fingerprints differ.')
    config_data=unblob(control.get('configuration'),MAX_RECORD,'processing configuration')
    require(strict_json(config_data)==run['config'],'Portable configuration differs from the run fingerprint inputs.')
    source_data=unblob(control.get('sourceObjects'),MAX_SOURCE_LEDGER,'source-object ledger')
    lines=validate_source_ledger(source_data);source_info=control.get('sourceSnapshot')
    require(isinstance(source_info,dict),'Missing source-object snapshot metadata.')
    original_size=integer(source_info.get('fileBytesAtSnapshot'),0,MAX_SOURCE_LEDGER,'source ledger snapshot size')
    dropped=integer(source_info.get('droppedIncompleteTailBytes'),0,8192,'incomplete source ledger tail size')
    require(original_size==len(source_data)+dropped and source_info.get('lines')==lines,'Source-object snapshot metadata do not match its exact complete-line bytes.')
    complete=validate_parts(control.get('parts'),cores)
    require(not complete or lines>0,'Completed records require their source-object provenance ledger.')
    require(control.get('completedRecords')==len(complete) and control.get('plannedRecords')==len(cores),'Control coverage counts do not match its exact plan and part coordinates.')
    require(control.get('coverageComplete') is (complete==cores),'Control coverage-complete flag is inconsistent.')
    durable=all('remote' in part for part in control['parts'])
    require(control.get('partsDurable') is durable,'Control part durability flag is inconsistent.')
    return dict(run=run,run_data=run_data,input_data=input_data,core_data=core_data,config_data=config_data,
        source_data=source_data,cores=cores,completed=complete,fingerprint=fingerprint)


def restore(args):
    require(not args.upload,'Restore does not accept --upload or read any credentials.')
    target=args.run.absolute()
    require(not target.is_symlink(),'Restore destination cannot be a symbolic link.')
    target=target.resolve()
    require(not target.exists() or (target.is_dir() and not any(target.iterdir())),'Restore requires a new or empty work directory; existing runs are never overwritten.')
    target.parent.mkdir(parents=True,exist_ok=True)
    started=time.monotonic()
    with CheckpointReader() as reader:
        control,base,control_sha=read_control(args.restore,reader)
        checked=validate_control(control);fingerprint=checked['fingerprint'];cores=checked['cores']
        stage=target.with_name(target.name+'.restore-'+control_sha[:16])
        require(not stage.is_symlink(),'Restore staging directory cannot be a symbolic link.')
        marker=canonical(dict(schema='guided-native-restore-stage-v21.1',controlSha256=control_sha,fingerprint=fingerprint))+b'\n'
        if stage.exists():
            require(stage.is_dir() and read_bytes(stage/'restore-stage.json',MAX_RECORD)==marker,'An unrelated restore staging directory already exists.')
        else:stage.mkdir()
        atomic_bytes(stage/'restore-stage.json',marker,immutable=True)
        actual=set();native_receipts=0;overview_bytes=0
        for metadata in control['parts']:
            part=read_object(metadata,base,reader,MAX_PART_DECODED)
            require(part.get('schema')==PART_SCHEMA and part.get('fingerprint')==fingerprint,'Checkpoint part belongs to another schema or processing run.')
            entries=part.get('entries')
            require(isinstance(entries,list) and len(entries)==metadata['recordCount'],'Checkpoint part entry count differs from its immutable manifest.')
            part_coords=[]
            for entry in entries:
                require(isinstance(entry,dict),'Invalid checkpoint entry.')
                xyz=coordinates(entry.get('xyz'));key=coordinate_key(xyz)
                require(xyz not in actual,'Checkpoint part repeats a completed record.')
                raw=unblob(entry.get('record'),MAX_RECORD,'completed record')
                overview=unblob(entry.get('overview'),MAX_OVERVIEW,'overview payload')
                _,record,_=validate_record(raw,overview,fingerprint,cores,xyz)
                atomic_bytes(contained(stage,f'tiles/{key}.lod.nbe.gz'),overview,immutable=True)
                atomic_bytes(contained(stage,f'records/{key}.json'),raw,immutable=True)
                actual.add(xyz);part_coords.append(list(xyz));native_receipts+=int(not record['empty']);overview_bytes+=len(overview)
            require(part_coords==metadata['coordinatesXYZ'],'Checkpoint part coordinates differ from the control index.')
            del part,entries
        require(actual==checked['completed'],'Restored records do not match the complete control index.')
        for name,data in [('input-plan.npy',checked['input_data']),('core-plan.npy',checked['core_data']),
                          ('processing-config.json',checked['config_data']),('portable-run.json',checked['run_data'])]:
            atomic_bytes(contained(stage,'resume/'+name),data,immutable=True)
        # Preserve the immutable part/coordinate history across workspace loss.
        # A future checkpoint cycle must not repack these completed coordinates.
        recovered_ledger=dict(schema=LEDGER_SCHEMA,fingerprint=fingerprint,parts=control['parts'])
        write_ledger(contained(stage,'resume/checkpoint-ledger.json'),recovered_ledger)
        atomic_bytes(stage/'source-objects.jsonl',checked['source_data'],immutable=True)
        # The fingerprint hashes plan bytes, never path strings. The portable
        # archived run is retained; this working manifest uses its new location.
        restored_run=dict(checked['run'],inputPlan=str(target/'resume/input-plan.npy'),corePlan=str(target/'resume/core-plan.npy'))
        atomic_bytes(stage/'run.json',canonical(restored_run)+b'\n',immutable=True)
        command=[sys.executable,str(Path(__file__).parent/'runner.py'),'--work',str(target),
            '--plan',str(target/'resume/input-plan.npy'),'--core-plan',str(target/'resume/core-plan.npy'),
            '--config',str(target/'resume/processing-config.json'),'--workers','1','--download-workers','16',
            '--decoded-cache-blocks','16','--upload-workers','1','--reserve-mib','512','--upload']
        command_record=dict(schema='guided-native-resume-command-v21.1',fingerprint=fingerprint,argv=command,
            executed=False,credentials='Supply the existing exact Site access JSON through the runner hidden stdin; no credential is stored here.',
            note='Provisional bounded settings. Existing completed records are recognized from verified native receipts and restored local overviews.')
        atomic_bytes(stage/'resume-command.json',canonical(command_record)+b'\n')
        checkpoint_command=[sys.executable,str(Path(__file__).resolve()),'--run',str(target),
            '--out',str(target/'checkpoints'),'--ledger',str(target/'resume/checkpoint-ledger.json'),'--upload']
        checkpoint_command_record=dict(schema='guided-native-checkpoint-command-v21.1',fingerprint=fingerprint,
            argv=checkpoint_command,executed=False,
            note='Retain the recovered ledger: it references existing immutable parts and prevents repacking. A local-only checkpoint also needs its original local part directory as --out until those parts have real verified upload receipts.')
        atomic_bytes(stage/'checkpoint-command.json',canonical(checkpoint_command_record)+b'\n')
        summary=dict(action='restore',fingerprint=fingerprint,controlSha256=control_sha,restoredRecords=len(actual),
            plannedRecords=len(cores),nativeVerifiedReceipts=native_receipts,overviewBytes=overview_bytes,
            sourceLedgerBytes=len(checked['source_data']),checkpointObjectsDownloaded=reader.objects,
            checkpointBytesDownloaded=reader.downloaded_bytes,sourceIntensityBytesDownloaded=0,nativeSurfacePayloadBytesDownloaded=0,
            coverageComplete=actual==cores,partsDurable=control['partsDurable'],seconds=round(time.monotonic()-started,3),
            resumeCommandFile='resume-command.json',checkpointCommandFile='checkpoint-command.json',
            recoveredIncrementalLedger='resume/checkpoint-ledger.json')
        atomic_bytes(stage/'restore-report.json',canonical(summary)+b'\n')
        if target.exists():target.rmdir()
        os.replace(stage,target)
        directory=os.open(target.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
        # Keep the binding marker until the atomic rename has succeeded. A
        # failed/aborted exposure can then safely resume the same verified stage.
        (target/'restore-stage.json').unlink()
        directory=os.open(target,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
        return summary


def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--run',type=Path,required=True,help='Existing run to checkpoint, or new empty destination for --restore')
    parser.add_argument('--out',type=Path,help='Directory for immutable checkpoint objects and the latest control reference')
    parser.add_argument('--ledger',type=Path,help='Atomic incremental coordinate/part ledger; retain this for every checkpoint cycle')
    parser.add_argument('--upload',action='store_true',help='Upload via the existing exact Site using hidden stdin, one verified object at a time')
    parser.add_argument('--restore',metavar='CONTROL_URL_OR_LOCAL_JSON',help='Restore a control URL, local .json.gz, decoded control, reference, or real upload receipt')
    parser.add_argument('--target-mib',type=float,default=8,help='Compressed part target, 0.05–8 MiB (default 8)')
    parser.add_argument('--max-new-records',type=int,help='Optional bounded pilot/incremental cycle limit; existing bundled coordinates are always skipped')
    parser.add_argument('--input-plan',type=Path,help='Original byte-identical input NPY if the current run path has moved')
    parser.add_argument('--core-plan',type=Path,help='Original byte-identical core NPY if the current run path has moved')
    args=parser.parse_args()
    try:
        require(.05<=args.target_mib<=8,'Compressed part target must be between 0.05 and 8 MiB.')
        if args.max_new_records is not None:integer(args.max_new_records,1,MAX_RECORDS,'new-record limit')
        if args.restore:
            require(args.out is None and args.ledger is None and args.input_plan is None and args.core_plan is None,'Restore uses only --run and --restore; checkpoint paths and plan overrides are not accepted.')
            result=restore(args)
        else:
            require(args.out is not None and args.ledger is not None,'Checkpoint creation requires --out and --ledger.')
            result=checkpoint(args)
        print(json.dumps(result,sort_keys=True))
    except (CheckpointError,UploadError,OSError,ValueError,TypeError,KeyError) as error:
        # None of these messages contains credential input or HTTP response bodies.
        print(f'Checkpoint operation stopped: {error}',file=sys.stderr);return 1
    return 0


if __name__=='__main__':raise SystemExit(main())
