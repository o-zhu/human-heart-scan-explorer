"""Build/run a bounded, explicitly constrained variant of the vendored QEM.

The unchanged upstream MIT header is pinned by SHA256. The small generated
patch freezes open boundaries, applies the interior-edge link condition, and
bounds accumulated original-vertex displacement using a conservative radius.
It deliberately stops above the requested face count when constraints bind.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import struct
import subprocess
import tempfile

import numpy as np

HERE = Path(__file__).resolve().parent
UPSTREAM_SHA = '4168edd04021ceb761d2237867224a1cb0514757f404fc642476bfa43021364d'

HELPER = r'''
    // Heart Explorer v23: interior manifold edge-link test. Freezing all open
    // boundaries prevents slab contour drift. The tetrahedron exception keeps
    // the last closed four-face component from collapsing into duplicate faces.
    double maximum_radius_mm = .25;
    double frozen_min_z = -DBL_MAX, frozen_max_z = DBL_MAX;
    unsigned long long radius_rejections = 0, link_rejections = 0;
    bool valid_link(int a, int b) {
        static std::vector<int> left, right, common, opposite;
        left.clear(); right.clear(); common.clear(); opposite.clear();
        Vertex &va = vertices[a], &vb = vertices[b];
        int live_a=0, live_b=0, edge_faces=0;
        for (int j=0;j<va.tcount;++j) {
            Triangle &t=triangles[refs[va.tstart+j].tid];
            if(t.deleted) continue;
            ++live_a;
            bool has_b=false;
            for (int k=0;k<3;++k) {
                if(t.v[k]==b) has_b=true;
                if(t.v[k]!=a && t.v[k]!=b) left.push_back(t.v[k]);
            }
            if(has_b) {
                ++edge_faces;
                for(int k=0;k<3;++k) if(t.v[k]!=a && t.v[k]!=b) opposite.push_back(t.v[k]);
            }
        }
        if(edge_faces!=2 || opposite.size()!=2 || opposite[0]==opposite[1]) return false;
        for (int j=0;j<vb.tcount;++j) {
            Triangle &t=triangles[refs[vb.tstart+j].tid];
            if(t.deleted) continue;
            ++live_b;
            for (int k=0;k<3;++k) if(t.v[k]!=a && t.v[k]!=b) right.push_back(t.v[k]);
        }
        if(live_a<=3 && live_b<=3) return false;
        std::sort(left.begin(),left.end()); left.erase(std::unique(left.begin(),left.end()),left.end());
        std::sort(right.begin(),right.end()); right.erase(std::unique(right.begin(),right.end()),right.end());
        std::set_intersection(left.begin(),left.end(),right.begin(),right.end(),std::back_inserter(common));
        if(common.size()!=2) return false;
        return (common[0]==opposite[0] && common[1]==opposite[1]) ||
               (common[1]==opposite[0] && common[0]==opposite[1]);
    }
'''


def patched_header():
    raw = (HERE / 'vendor/Simplify.upstream.h').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == UPSTREAM_SHA
    text = raw.decode()
    replacements = [
        ('struct Vertex { vec3f p;int tstart,tcount;SymetricMatrix q;int border;};',
         'struct Vertex { vec3f p;int tstart,tcount;SymetricMatrix q;int border; double radius=0; bool locked=false;};'),
        ('\t// Helper functions\n', HELPER+'\n\t// Helper functions\n'),
        ('if(v0.border != v1.border)  continue;', 'if(v0.border || v1.border || v0.locked || v1.locked) continue;'),
        ('calculate_error(i0,i1,p); // p is the optimal point to collapse to',
         '''calculate_error(i0,i1,p); // p is the optimal point to collapse to
                    double radius = std::max(v0.radius+(p-v0.p).length(),v1.radius+(p-v1.p).length());
                    if(p.z<=frozen_min_z || p.z>=frozen_max_z) {
                        t.err[j]=DBL_MAX; t.err[3]=min(t.err[0],min(t.err[1],t.err[2])); continue;
                    }
                    if(!std::isfinite(radius) || radius>maximum_radius_mm) {
                        ++radius_rejections; t.err[j]=DBL_MAX;
                        t.err[3]=min(t.err[0],min(t.err[1],t.err[2])); continue;
                    }
                    if(!valid_link(i0,i1)) {
                        ++link_rejections; t.err[j]=DBL_MAX;
                        t.err[3]=min(t.err[0],min(t.err[1],t.err[2])); continue;
                    }'''),
        ('v0.p=p; // set the optimal point to collapse to',
         'v0.radius=radius; v0.p=p; // constrained original-vertex radius follows the collapse'),
        ('collapses.push_back(std::vector<int>({i0,i1}));', '// No collapse-log allocation; radius bound records the required invariant.'),
        ('vertices[dst].p=vertices[i].p;', 'vertices[dst].p=vertices[i].p; vertices[dst].radius=vertices[i].radius;'),
    ]
    # Rejected edges are reconsidered when an incident triangle is updated.
    # Caching a rejection can stop more conservatively after a neighbor change;
    # it never bypasses the geometry or link constraints.
    for before, after in replacements:
        assert before in text, before
        text = text.replace(before, after)
    return '#include <algorithm>\n#include <iterator>\n#include <cmath>\n'+text


def build(work):
    work = Path(work); work.mkdir(parents=True, exist_ok=True)
    header = patched_header()
    code = (HERE/'constrained_qem.cpp').read_bytes()
    fingerprint = hashlib.sha256(header.encode()+code).hexdigest()
    binary = work/'constrained-qem'
    marker = work/'constrained-qem-build.json'
    if binary.exists() and marker.exists() and json.loads(marker.read_text()).get('fingerprint') == fingerprint:
        binary.chmod(0o755)
        return binary
    (work/'Simplify.constrained.h').write_text(header)
    subprocess.run(['g++','-O3','-std=c++17','-I',str(work),str(HERE/'constrained_qem.cpp'),'-o',str(binary)],check=True)
    binary.chmod(0o755)
    marker.write_text(json.dumps(dict(fingerprint=fingerprint,upstreamSha256=UPSTREAM_SHA,compiler='g++ -O3 -std=c++17'),indent=2)+'\n')
    return binary


def simplify(points, faces, work, radius_mm=.25, target=1, aggressiveness=7.):
    work = Path(work)
    binary = build(work)
    with tempfile.TemporaryDirectory(prefix='qem-',dir=work) as temp:
        temp=Path(temp); source=temp/'source.bin'; output=temp/'output.bin'
        with source.open('wb') as stream:
            stream.write(struct.pack('<QQ',len(points),len(faces)))
            np.ascontiguousarray(points,dtype='<f4').tofile(stream)
            np.ascontiguousarray(faces,dtype='<u4').tofile(stream)
        completed = subprocess.run([str(binary),str(source),str(output),str(target),str(radius_mm),str(aggressiveness)],check=True,text=True,capture_output=True)
        record=json.loads(completed.stdout)
        with output.open('rb') as stream:
            nv,nf=struct.unpack('<QQ',stream.read(16))
            p=np.fromfile(stream,dtype='<f4',count=nv*3).reshape(nv,3)
            f=np.fromfile(stream,dtype='<u4',count=nf*3).reshape(nf,3)
            assert not stream.read(1)
        assert np.isfinite(p).all() and (not len(f) or f.max()<len(p))
        return p,f,record
