/**
 * Strict reader for the public scan's N5 mode-0 uint16 / Blosc blocks.
 * N5 metadata and voxel bytes are big endian; the inner Blosc header is little
 * endian. Decompression uses the vendored, unmodified numcodecs 0.3.2 codec.
 */
import Blosc from './vendor/numcodecs/blosc.js';

const codec = new Blosc();
const MAX_RAW_BYTES = 128 * 128 * 128 * 2;

export function parseN5Header(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 32) {
    throw new Error('The source scan block has an incomplete header.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mode = view.getUint16(0, false), rank = view.getUint16(2, false);
  if (mode !== 0 || rank !== 3) throw new Error('Unsupported source N5 block layout.');
  const dimensions = [4, 8, 12].map(offset => view.getUint32(offset, false));
  if (dimensions.some(n => n < 1 || n > 128)) throw new Error('Invalid source scan block dimensions.');
  const n5HeaderBytes = 16;
  const blosc = parseBloscHeader(bytes.subarray(n5HeaderBytes));
  if (blosc.rawBytes !== dimensions.reduce((a, b) => a * b, 2)) {
    throw new Error('Source voxel dimensions and compressed data disagree.');
  }
  return {dimensions, n5HeaderBytes, ...blosc};
}

export function parseBloscHeader(bytes) {
  if (bytes.byteLength < 16) throw new Error('Incomplete Blosc header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0], flags = bytes[2], typeSize = bytes[3];
  const rawBytes = view.getUint32(4, true), blockBytes = view.getUint32(8, true);
  const compressedBytes = view.getUint32(12, true);
  if (version !== 2 || typeSize !== 2 || rawBytes < 2 || rawBytes > MAX_RAW_BYTES ||
      blockBytes < 2 || blockBytes > MAX_RAW_BYTES || compressedBytes < 16 ||
      compressedBytes > MAX_RAW_BYTES + 65536) {
    throw new Error('Unsupported or invalid Blosc source header.');
  }
  const uncompressed = Boolean(flags & 2);
  const count = Math.ceil(rawBytes / blockBytes);
  const headerBytes = uncompressed ? 16 : 16 + count * 4;
  if (bytes.byteLength < headerBytes) throw new Error('Incomplete Blosc offset table.');
  const offsets = uncompressed ? [] : Array.from({length: count}, (_, i) => view.getUint32(16 + 4 * i, true));
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] < headerBytes || offsets[i] >= compressedBytes ||
        offsets.indexOf(offsets[i]) !== i) {
      throw new Error('The source scan block contains an invalid offset table.');
    }
  }
  const sorted = [...offsets, compressedBytes].sort((a,b)=>a-b);
  const blockEnds = offsets.map(offset=>sorted[sorted.indexOf(offset)+1]);
  return {version, flags, typeSize, rawBytes, blockBytes, compressedBytes, count, headerBytes, offsets, blockEnds, uncompressed};
}

export async function decodeN5(bytes) {
  const header = parseN5Header(bytes);
  if (bytes.byteLength !== header.n5HeaderBytes + header.compressedBytes) {
    throw new Error('The source scan block was not completely downloaded.');
  }
  const data = await codec.decode(bytes.subarray(header.n5HeaderBytes));
  if (data.byteLength !== header.rawBytes) throw new Error('Decoded scan block has an unexpected size.');
  return {data, dimensions: header.dimensions, header, byteStart: 0};
}

/**
 * Rewrap one independent Blosc block for the reference codec. This lets axial
 * sections fetch one quarter of an ordinary source brick with HTTP Range.
 * `payload` contains that block's complete compressed byte span, including
 * Blosc split lengths. It is not a naked Zstd stream.
 */
export async function decodeBloscBlock(n5HeaderBytes, blockIndex, payload) {
  const header = parseN5Header(n5HeaderBytes);
  if (header.uncompressed || blockIndex < 0 || blockIndex >= header.count) {
    throw new Error('Cannot decode the requested source sub-block.');
  }
  const start = header.offsets[blockIndex];
  const end = header.blockEnds[blockIndex];
  if (payload.byteLength !== end - start) throw new Error('Incomplete source sub-block.');
  const rawBytes = Math.min(header.blockBytes, header.rawBytes - blockIndex * header.blockBytes);
  const packed = new Uint8Array(20 + payload.byteLength);
  packed.set(n5HeaderBytes.subarray(16, 32));
  const view = new DataView(packed.buffer);
  view.setUint32(4, rawBytes, true);
  view.setUint32(12, packed.length, true);
  view.setUint32(16, 20, true);
  packed.set(payload, 20);
  const data = await codec.decode(packed);
  if (data.byteLength !== rawBytes) throw new Error('Decoded source sub-block has an unexpected size.');
  return {data, dimensions: header.dimensions, header, byteStart: blockIndex * header.blockBytes};
}

export function readUint16BE(bytes, offset) {
  return bytes[offset] * 256 + bytes[offset + 1];
}

export function displayValue(value, window = [14640, 23545]) {
  return Math.max(0, Math.min(255, Math.round((value - window[0]) * 255 / (window[1] - window[0]))));
}
