// Heart Explorer v23 constrained QEM wrapper. See vendor/LICENSE.
#include <fstream>
#include <stdexcept>
#include <chrono>
#include <sys/resource.h>
#include "Simplify.constrained.h"

int main(int argc,char **argv) {
    if(argc!=6) return 2;
    auto started=std::chrono::steady_clock::now();
    std::ifstream input(argv[1],std::ios::binary);
    uint64_t nv=0,nf=0;
    input.read(reinterpret_cast<char*>(&nv),8); input.read(reinterpret_cast<char*>(&nf),8);
    if(!input || nv>=INT32_MAX || nf>=INT32_MAX/3) return 3;
    Simplify::vertices.resize(nv); Simplify::triangles.resize(nf);
    for(uint64_t i=0;i<nv;++i) {
        float p[3];input.read(reinterpret_cast<char*>(p),12);
        Simplify::vertices[i].p=vec3f(p[0],p[1],p[2]);
    }
    if(nv) {
        double lo=Simplify::vertices[0].p.z,hi=lo;
        for(const auto &v:Simplify::vertices) {lo=std::min(lo,v.p.z);hi=std::max(hi,v.p.z);}
        Simplify::frozen_min_z=lo;Simplify::frozen_max_z=hi;
        for(auto &v:Simplify::vertices) v.locked=(v.p.z==lo || v.p.z==hi);
    }
    for(uint64_t i=0;i<nf;++i) {
        uint32_t f[3];input.read(reinterpret_cast<char*>(f),12);
        auto &t=Simplify::triangles[i];
        for(int k=0;k<3;++k) {if(f[k]>=nv) return 4;t.v[k]=f[k];}
        t.attr=0;t.deleted=0;t.dirty=0;
    }
    if(!input) return 5;
    input.close();
    Simplify::maximum_radius_mm=std::stod(argv[4]);
    Simplify::simplify_mesh(std::stoi(argv[3]),std::stod(argv[5]),false);
    uint64_t out_nv=Simplify::vertices.size(),out_nf=Simplify::triangles.size();
    double max_radius=0;
    std::ofstream output(argv[2],std::ios::binary);
    output.write(reinterpret_cast<const char*>(&out_nv),8);output.write(reinterpret_cast<const char*>(&out_nf),8);
    for(const auto &v:Simplify::vertices) {
        float p[3]={(float)v.p.x,(float)v.p.y,(float)v.p.z};
        output.write(reinterpret_cast<const char*>(p),12);
        max_radius=std::max(max_radius,v.radius);
    }
    for(const auto &t:Simplify::triangles) {
        uint32_t f[3]={(uint32_t)t.v[0],(uint32_t)t.v[1],(uint32_t)t.v[2]};
        output.write(reinterpret_cast<const char*>(f),12);
    }
    output.close(); if(!output) return 6;
    struct rusage usage;getrusage(RUSAGE_SELF,&usage);
    std::cout<<"{\"inputVertices\":"<<nv<<",\"inputTriangles\":"<<nf
             <<",\"vertices\":"<<out_nv<<",\"triangles\":"<<out_nf
             <<",\"conservativeRadiusLimitMm\":"<<Simplify::maximum_radius_mm
             <<",\"maximumConservativeRadiusMm\":"<<max_radius
             <<",\"radiusRejections\":"<<Simplify::radius_rejections
             <<",\"linkRejections\":"<<Simplify::link_rejections
             <<",\"frozenBoundaryVertices\":true,\"interiorEdgeLinkConstraint\":true"
             <<",\"seconds\":"<<std::chrono::duration<double>(std::chrono::steady_clock::now()-started).count()
             <<",\"peakRssMiB\":"<<usage.ru_maxrss/1024.<<"}"<<std::endl;
    return 0;
}
