import { parseNativeMesh, MAX_NATIVE_MESH_BYTES } from './native-mesh-format.js';

const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
async function boundedRead(stream, limit) {
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Native surface exceeds its declared size.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
self.onmessage = async ({ data }) => {
  try {
    const { url, sha256, decodedSha256, compressedBytes, expectedBytes } = data;
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes > MAX_NATIVE_MESH_BYTES || expectedBytes < 32 || !Number.isSafeInteger(compressedBytes) || compressedBytes < 1 || compressedBytes > MAX_NATIVE_MESH_BYTES) throw new Error('Native surface size is unsupported.');
    const response = await fetch(url, { priority: 'high' });
    if (!response.ok || !response.body) throw new Error(`Native surface download failed (${response.status}).`);
    let bytes = await boundedRead(response.body, compressedBytes);
    if (bytes.length !== compressedBytes || await hash(bytes) !== sha256) throw new Error('Native surface checksum did not match.');
    if (bytes[0] === 31 && bytes[1] === 139) {
      if (!self.DecompressionStream) throw new Error('This browser cannot decompress the native surface.');
      bytes = await boundedRead(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), expectedBytes);
    }
    if (decodedSha256 && await hash(bytes) !== decodedSha256) throw new Error('Decoded native surface checksum did not match.');
    const decoded = parseNativeMesh(bytes.buffer, expectedBytes);
    self.postMessage(decoded, [decoded.buffer]);
  } catch (error) { self.postMessage({ error: error.message || 'Native surface could not load.' }); }
};
