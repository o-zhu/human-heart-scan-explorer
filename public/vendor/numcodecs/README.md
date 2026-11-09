# numcodecs 0.3.2

The two JavaScript files in this directory are copied unmodified from the
published `numcodecs@0.3.2` npm package. `blosc.js` contains the bundled
WebAssembly codec. It is loaded only by the ultra-section worker.

- Upstream: <https://github.com/manzt/numcodecs.js>
- Package: <https://www.npmjs.com/package/numcodecs/v/0.3.2>
- License: MIT; see `LICENSE` in this directory.
- npm tarball integrity:
  `sha512-6YSPnmZgg0P87jnNhi3s+FVLOcIn3y+1CTIgUulA3IdASzK9fJM87sUFkpyA+be9GibGRaST2wCgkD+6U+fWKw==`

Only the Blosc codec and its shared base64 helper are included. The application
does not depend on a remote JavaScript CDN at runtime.

The upstream build script uses c-blosc 1.18.1. Notices for its bundled codecs
(including bitshuffle, LZ4, Snappy, zlib, and Zstd 1.4.4) are retained in the
`licenses/` directory.
