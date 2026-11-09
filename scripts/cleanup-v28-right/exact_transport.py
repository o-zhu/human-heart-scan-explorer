"""Bounded exact transport for whole files or concatenated encoded-byte parts.

Policies retain the original logical filename and hashes. A .parts.json sidecar
is consulted only when that whole file is absent. No data is recompressed.
"""
from pathlib import Path
import gzip
import hashlib
import io
import json
import re

MAX_ENCODED_BYTES = 128 * 1024 * 1024
MAX_DECODED_BYTES = 256 * 1024 * 1024
MAX_PART_BYTES = 24 * 1024 * 1024
CHUNK_BYTES = 1024 * 1024


def require(value, message):
    if not value:
        raise ValueError(message)


def read_encoded(path, entry, *, max_bytes=MAX_ENCODED_BYTES):
    """Read exact compressed bytes, checking each part and the original hash."""
    path = Path(path)
    size, expected_sha = entry['compressedBytes'], entry['sha256']
    require(type(size) is int and 0 < size <= max_bytes, 'Encoded asset exceeds its bounded size.')
    require(isinstance(expected_sha, str) and re.fullmatch('[a-f0-9]{64}', expected_sha), 'Invalid encoded checksum.')
    if path.is_file():
        pieces = [(path, size, expected_sha)]
    else:
        sidecar = Path(str(path) + '.parts.json')
        require(sidecar.is_file() and sidecar.stat().st_size <= 1024 * 1024, 'Missing or oversized transport sidecar.')
        metadata = json.loads(sidecar.read_text())
        require(metadata.get('version') == 1 and metadata.get('format') == 'concatenated-encoded-parts', 'Unknown split transport.')
        require(metadata.get('file') == path.name and metadata.get('compressedBytes') == size
                and metadata.get('sha256') == expected_sha, 'Sidecar differs from the pinned logical asset.')
        parts = metadata.get('parts')
        require(isinstance(parts, list) and 1 <= len(parts) <= 64, 'Invalid transport part count.')
        pieces = []
        for number, part in enumerate(parts, 1):
            require(part.get('file') == f'{path.name}.part-{number:03d}', 'Unsafe or unordered transport part name.')
            count, digest = part.get('bytes'), part.get('sha256')
            require(type(count) is int and 0 < count <= MAX_PART_BYTES, 'Transport part exceeds 24 MiB.')
            require(isinstance(digest, str) and re.fullmatch('[a-f0-9]{64}', digest), 'Invalid part checksum.')
            filename = path.parent / part['file']
            require(not filename.is_symlink() and filename.resolve().parent == path.parent.resolve(), 'Transport part escapes its directory.')
            pieces.append((filename, count, digest))
        require(sum(piece[1] for piece in pieces) == size, 'Transport part sizes do not equal the logical asset.')
    result = bytearray(size)
    offset = 0
    total_hash = hashlib.sha256()
    for filename, count, digest in pieces:
        require(filename.is_file() and filename.stat().st_size == count, 'Missing or wrong-sized transport part: ' + str(filename))
        part_hash = hashlib.sha256()
        consumed = 0
        with filename.open('rb') as stream:
            while consumed < count:
                block = stream.read(min(CHUNK_BYTES, count - consumed))
                require(bool(block), 'Truncated transport part.')
                result[offset:offset + len(block)] = block
                offset += len(block); consumed += len(block)
                part_hash.update(block); total_hash.update(block)
            require(not stream.read(1), 'Transport part grew during reading.')
        require(part_hash.hexdigest() == digest, 'Transport part checksum mismatch: ' + str(filename))
    require(offset == size and total_hash.hexdigest() == expected_sha, 'Logical encoded checksum mismatch.')
    return bytes(result)


def read_surface(path, entry, *, max_decoded_bytes=MAX_DECODED_BYTES):
    """Load a verified gzip surface/mask with an explicit decompression bound."""
    expected = entry['decodedBytes']
    require(type(expected) is int and 0 < expected <= max_decoded_bytes, 'Decoded asset exceeds its bounded size.')
    encoded = read_encoded(path, entry)
    with gzip.GzipFile(fileobj=io.BytesIO(encoded), mode='rb') as stream:
        decoded = stream.read(expected + 1)
        require(len(decoded) == expected and not stream.read(1), 'Decoded asset length mismatch.')
    require(hashlib.sha256(decoded).hexdigest() == entry['decodedSha256'], 'Decoded asset checksum mismatch.')
    return decoded
