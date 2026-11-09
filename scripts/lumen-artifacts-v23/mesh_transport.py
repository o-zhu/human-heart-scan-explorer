"""Bounded local decoding of the final ordered HFM1 gzip byte-range transport.

Parts are consecutive ranges of ONE gzip stream. This module imports no EGL
fixture and performs no I/O until ``load_mesh_arrays`` is explicitly called.
It does not reconstruct a packed copy or a full float-position array.
"""
from pathlib import Path
import hashlib
import struct
import zlib
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
MAX_PACKED=256*1024**2
MAX_DECODED=512*1024**2
CHUNK=1024**2
INFLATE_CHUNK=8*1024**2


def local_public_path(url,root=ROOT):
    assert isinstance(url,str) and url.startswith('./assets/'),url
    public=(root/'public').resolve()
    path=(public/url.removeprefix('./')).resolve()
    assert public in path.parents and path.is_file(),path
    return path


def load_mesh_arrays(manifest,lod,root=ROOT):
    """Verify transport and return zero-copy quantized array views for upload.

    The returned dictionary owns one decoded bytearray. After ``glBufferData``
    finishes for all three arrays, callers may discard positions/normals/indices
    and ``_rawOwner`` while retaining only GPU buffers and small metadata.
    """
    packed_size=int(lod['compressedBytes']);decoded_size=int(lod['decodedBytes'])
    assert 0<packed_size<=MAX_PACKED and 32<=decoded_size<=MAX_DECODED
    entries=lod.get('parts') or [lod]
    assert 1<=len(entries)<=16
    assert sum(int(e['compressedBytes']) for e in entries)==packed_size
    raw=bytearray(decoded_size);raw_view=memoryview(raw)
    joined_hash=hashlib.sha256();decoded_hash=hashlib.sha256()
    inflater=zlib.decompressobj(wbits=31)
    used=0;packed_total=0;receipts=[]

    def append_decoded(piece):
        nonlocal used
        end=used+len(piece)
        assert end<=decoded_size,'Decoded HFM exceeds manifest length.'
        raw_view[used:end]=piece;decoded_hash.update(piece);used=end

    for entry in entries:
        path=local_public_path(entry['url'],root)
        assert path.stat().st_size==entry['compressedBytes']
        part_hash=hashlib.sha256();part_total=0
        with path.open('rb') as stream:
            for chunk in iter(lambda:stream.read(CHUNK),b''):
                part_total+=len(chunk);packed_total+=len(chunk)
                part_hash.update(chunk);joined_hash.update(chunk)
                pending=chunk
                while pending:
                    piece=inflater.decompress(pending,INFLATE_CHUNK)
                    append_decoded(piece)
                    remaining=inflater.unconsumed_tail
                    assert len(remaining)<len(pending) or piece,'Gzip decode made no progress.'
                    pending=remaining
                assert not inflater.unused_data,'Unexpected trailing or concatenated gzip payload.'
        assert part_total==entry['compressedBytes']
        assert part_hash.hexdigest()==entry['sha256'],('Part checksum mismatch',path)
        receipts.append(dict(path=str(path.relative_to(root)),bytes=part_total,sha256=part_hash.hexdigest()))
    append_decoded(inflater.flush())
    assert inflater.eof and not inflater.unused_data and not inflater.unconsumed_tail
    assert packed_total==packed_size and joined_hash.hexdigest()==lod['sha256']
    assert used==decoded_size and decoded_hash.hexdigest()==lod['decodedSha256']
    magic,version,nv,ni,po,no,io,reserved=struct.unpack_from('<8I',raw)
    assert (magic,version,reserved)==(0x314d4648,1,0)
    assert nv==lod['vertices'] and ni==lod['triangles']*3 and nv>0 and ni>0
    assert po>=32 and not any(n%4 for n in [po,no,io])
    assert po+nv*6<=no and no+nv*6<=io and io+ni*4==decoded_size
    positions=np.frombuffer(raw,'<u2',nv*3,po).reshape(nv,3)
    normals=np.frombuffer(raw,'<i2',nv*3,no).reshape(nv,3)
    indices=np.frombuffer(raw,'<u4',ni,io)
    assert int(indices.max())<nv
    normal_error=0.
    for start in range(0,nv,250_000):
        lengths=np.linalg.norm(normals[start:start+250_000].astype(np.float32)/32767,axis=1)
        assert float(lengths.min(initial=1.))>.99
        normal_error=max(normal_error,float(np.abs(lengths-1).max(initial=0.)))
    assert normal_error<.00008
    for array in [positions,normals,indices]:array.flags.writeable=False
    receipt=dict(orderedParts=receipts,compressedBytes=packed_total,decodedBytes=used,
                 sha256=joined_hash.hexdigest(),decodedSha256=decoded_hash.hexdigest(),
                 oneGzipStream=True,fullPackedCopyAllocated=False,floatPositionArrayAllocated=False,
                 maximumReadChunkBytes=CHUNK,maximumInflateChunkBytes=INFLATE_CHUNK,
                 decodedBufferCount=1,maximumNormalLengthError=normal_error)
    return dict(positions=positions,normals=normals,indices=indices,
                bounds=lod.get('bounds',manifest['bounds']),vertexCount=nv,indexCount=ni,
                bytes=packed_total,normalError=normal_error,_rawOwner=raw,_transport=receipt)
