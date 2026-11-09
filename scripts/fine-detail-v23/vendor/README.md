# Vendored QEM source

`Simplify.upstream.h` is the unchanged MIT-licensed header from
`pyvista/fast-simplification` tag `v0.1.13`:

https://github.com/pyvista/fast-simplification/blob/v0.1.13/fast_simplification/Simplify.h

SHA256:
`4168edd04021ceb761d2237867224a1cb0514757f404fc642476bfa43021364d`

The header credits Sven Forstmann's Fast Quadric Mesh Simplification work and
Chris Rorden's portable version. The accompanying PyVista distribution's MIT
license is retained in `LICENSE`; the upstream copyright notice remains in the
header.

`constrained_qem.py` does not edit this file. It generates a separate build
header containing explicitly documented Heart Explorer constraints: frozen
boundaries and slab planes, an interior edge-link test, preservation of the last
tetrahedron, and a conservative accumulated original-vertex movement radius.
Rejected edges are cached until incident geometry updates; this can make a
result more conservative but cannot bypass a constraint. The generated header
and wrapper are fingerprinted together before compilation.
