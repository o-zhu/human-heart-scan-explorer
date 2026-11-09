// Read-only, whole-mesh component audit. Compiled by debris_build.py.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>

static uint32_t find_root(std::vector<uint32_t>& parent, uint32_t a) {
    while (parent[a] != a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
}

extern "C" uint32_t debris_labels(uint32_t nv, uint32_t nt,
                                  const uint32_t* f, uint32_t* labels) {
    std::vector<uint32_t> parent(nv), mapping(nv, UINT32_MAX);
    std::vector<uint8_t> rank(nv, 0), used(nv, 0);
    for (uint32_t i=0; i<nv; ++i) parent[i]=i;
    auto unite = [&](uint32_t a, uint32_t b) {
        a=find_root(parent,a); b=find_root(parent,b);
        if(a==b) return;
        if(rank[a]<rank[b]) std::swap(a,b);
        parent[b]=a; if(rank[a]==rank[b]) ++rank[a];
    };
    for(uint32_t t=0; t<nt; ++t) {
        const auto* tri=f+size_t(t)*3;
        used[tri[0]]=used[tri[1]]=used[tri[2]]=1;
        unite(tri[0],tri[1]); unite(tri[0],tri[2]);
    }
    uint32_t nc=0;
    for(uint32_t i=0; i<nv; ++i) {
        if(!used[i]) { labels[i]=UINT32_MAX; continue; }
        uint32_t r=find_root(parent,i);
        if(mapping[r]==UINT32_MAX) mapping[r]=nc++;
        labels[i]=mapping[r];
    }
    return nc;
}

// Stats columns: vertices, triangles, min xyz, max xyz, sum xyz,
// sum xx yy zz xy xz yz, triangle area, quantized-boundary vertex count.
extern "C" void debris_stats(uint32_t nv, uint32_t nt, uint32_t nc,
                              const uint16_t* q, const uint32_t* f,
                              const uint32_t* labels, const double* scale,
                              double* stats) {
    for(uint32_t c=0;c<nc;++c) {
        auto* s=stats+size_t(c)*19;
        for(int j=0;j<19;++j) s[j]=0;
        for(int j=0;j<3;++j) {s[2+j]=1e30; s[5+j]=-1e30;}
    }
    for(uint32_t i=0;i<nv;++i) {
        uint32_t c=labels[i]; if(c==UINT32_MAX) continue;
        auto* s=stats+size_t(c)*19; const auto* v=q+size_t(i)*3;
        double p[3]={v[0]*scale[0],v[1]*scale[1],v[2]*scale[2]};
        ++s[0];
        bool boundary=false;
        for(int j=0;j<3;++j) {
            s[2+j]=std::min(s[2+j],p[j]); s[5+j]=std::max(s[5+j],p[j]);
            s[8+j]+=p[j]; boundary|=v[j]==0||v[j]==65535;
        }
        s[11]+=p[0]*p[0]; s[12]+=p[1]*p[1]; s[13]+=p[2]*p[2];
        s[14]+=p[0]*p[1]; s[15]+=p[0]*p[2]; s[16]+=p[1]*p[2];
        s[18]+=boundary;
    }
    for(uint32_t t=0;t<nt;++t) {
        const auto* tri=f+size_t(t)*3; auto* s=stats+size_t(labels[tri[0]])*19;
        ++s[1]; double a[3],b[3];
        for(int j=0;j<3;++j) {
            a[j]=(double(q[size_t(tri[1])*3+j])-q[size_t(tri[0])*3+j])*scale[j];
            b[j]=(double(q[size_t(tri[2])*3+j])-q[size_t(tri[0])*3+j])*scale[j];
        }
        double x=a[1]*b[2]-a[2]*b[1], y=a[2]*b[0]-a[0]*b[2], z=a[0]*b[1]-a[1]*b[0];
        s[17]+=.5*std::sqrt(x*x+y*y+z*z);
    }
}
