// Multi-source path-length propagation restricted to measured connected tissue.
// This assigns regional annotations; it never modifies scan density.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <queue>
#include <vector>

struct Visit {float d; int p; bool operator<(const Visit& b) const {return d>b.d;}};
extern "C" void propagate(const uint16_t* image,const uint8_t* mask,const uint8_t* markers,const uint8_t* allowed,
 int nx,int ny,int nz,float edge_scale,float gap_penalty,float max_cost,
 uint8_t* result,float* distance) {
 const int n=nx*ny*nz,xy=nx*ny;
 const int steps[6]={-1,1,-nx,nx,-xy,xy};
 std::priority_queue<Visit> queue;
 for(int i=0;i<n;i++){result[i]=mask[i]?markers[i]:0;distance[i]=result[i]?0:std::numeric_limits<float>::infinity();}
 for(int z=1;z<nz-1;z++)for(int y=1;y<ny-1;y++)for(int x=1;x<nx-1;x++){
  int p=x+nx*y+xy*z;if(!markers[p]||!mask[p])continue;
  for(int q:steps)if(mask[p+q]&&!markers[p+q]){queue.push({0,p});break;}
 }
 while(!queue.empty()){
  const Visit next=queue.top();queue.pop();const int p=next.p;
  if(next.d>distance[p])continue;
  const int x=p%nx,y=(p/nx)%ny,z=p/xy;
  if(x<1||x>=nx-1||y<1||y>=ny-1||z<1||z>=nz-1)continue;
  for(int step:steps){const int q=p+step;if(!mask[q]||markers[q]||!(allowed[q]&(1<<result[p])))continue;
   const float contrast=std::abs(float(image[p])-float(image[q]));
   const float gap=std::max(0.f,(17450.f-std::min(float(image[p]),float(image[q])))/900.f);
   const float cost=next.d+1+std::min(contrast/edge_scale,6.f)+gap_penalty*std::min(gap,3.f);
   if(cost<distance[q]&&cost<=max_cost){distance[q]=cost;result[q]=result[p];queue.push({cost,q});}
  }
 }
}
