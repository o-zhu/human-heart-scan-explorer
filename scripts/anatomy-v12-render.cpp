#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

// Native scientific ray casting for annotation review. No browser or website
// renderer is used, and both candidates use identical measured geometry.
extern "C" void render(const uint16_t* volume, int nx,int ny,int nz,
                        const double* origin,const double* right,const double* up,
                        const double* direction,double scale,int width,int height,
                        double threshold,const double* clipNormal,double clipDistance,
                        double perspectiveFov,float* hits,float* shade) {
  auto sample=[&](double x,double y,double z)->double {
    if(x<0||y<0||z<0||x>=nx-1||y>=ny-1||z>=nz-1)return 0;
    int ix=int(x),iy=int(y),iz=int(z); double ax=x-ix,ay=y-iy,az=z-iz;
    auto p=[&](int dx,int dy,int dz){return double(volume[((iz+dz)*ny+iy+dy)*nx+ix+dx]);};
    return (1-az)*((1-ay)*((1-ax)*p(0,0,0)+ax*p(1,0,0))+ay*((1-ax)*p(0,1,0)+ax*p(1,1,0)))+
              az*((1-ay)*((1-ax)*p(0,0,1)+ax*p(1,0,1))+ay*((1-ax)*p(0,1,1)+ax*p(1,1,1)));
  };
  #pragma omp parallel for
  for(int py=0;py<height;py++) for(int px=0;px<width;px++) {
    int q=py*width+px; hits[q*3]=hits[q*3+1]=hits[q*3+2]=-1;shade[q]=0;
    double o[3],d[3];
    for(int j=0;j<3;j++) {
      o[j]=origin[j];d[j]=direction[j];
      if(perspectiveFov>0)d[j]+=((px+.5)*2/width-1)*double(width)/height*perspectiveFov*right[j]-(2*(py+.5)/height-1)*perspectiveFov*up[j];
      else o[j]+=((px+.5)-width*.5)*scale*right[j]-(py+.5-height*.5)*scale*up[j];
    }
    double dnorm=std::sqrt(d[0]*d[0]+d[1]*d[1]+d[2]*d[2]);for(int j=0;j<3;j++)d[j]/=dnorm;
    double lo=0,hi=1500;const int dims[3]={nx,ny,nz};
    for(int j=0;j<3;j++) {
      if(std::abs(d[j])<1e-8) {if(o[j]<0||o[j]>dims[j]-1)hi=-1;continue;}
      double a=(0-o[j])/d[j],b=(dims[j]-1-o[j])/d[j];if(a>b)std::swap(a,b);
      lo=std::max(lo,a);hi=std::min(hi,b);
    }
    if(hi<=lo)continue;
    double planeT=-1e9;
    if(clipNormal[0]!=0||clipNormal[1]!=0||clipNormal[2]!=0) {
      double side=clipNormal[0]*o[0]+clipNormal[1]*o[1]+clipNormal[2]*o[2]-clipDistance;
      double den=clipNormal[0]*d[0]+clipNormal[1]*d[1]+clipNormal[2]*d[2];
      if(std::abs(den)<1e-9){if(side>0)continue;}
      else {planeT=-side/den;if(den<0)lo=std::max(lo,planeT);else hi=std::min(hi,planeT);}
    }
    if(hi<=lo)continue;
    double t=lo,prev=lo;
    for(;t<=hi;t+=.65) {
      double p[3];for(int j=0;j<3;j++)p[j]=o[j]+t*d[j];
      if(sample(p[0],p[1],p[2])<threshold){prev=t;continue;}
      double a=prev,b=t;
      for(int k=0;k<7;k++){double mid=(a+b)*.5; if(sample(o[0]+mid*d[0],o[1]+mid*d[1],o[2]+mid*d[2])>=threshold)b=mid;else a=mid;}
      t=(a+b)*.5;for(int j=0;j<3;j++){p[j]=o[j]+t*d[j];hits[q*3+j]=float(p[j]);}
      double n[3]={sample(p[0]-1.1,p[1],p[2])-sample(p[0]+1.1,p[1],p[2]),sample(p[0],p[1]-1.1,p[2])-sample(p[0],p[1]+1.1,p[2]),sample(p[0],p[1],p[2]-1.1)-sample(p[0],p[1],p[2]+1.1)};
      bool cap=std::abs(t-planeT)<.9;
      double norm=std::sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2])+1e-6;
      double lambert=std::max(0.,-(n[0]*d[0]+n[1]*d[1]+n[2]*d[2])/norm);
      shade[q]=float(cap ? .45+.5*std::clamp((sample(p[0],p[1],p[2])-15000)/8500,0.,1.) : .26+.74*lambert);
      break;
    }
  }
}
