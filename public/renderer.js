/** True scalar-volume renderer. No synthetic geometry or anatomical model. */
import {clipPlane} from './planes.js';
import {buildAnatomyPalette,DEFAULT_WINDOW_SETTINGS,windowParameters} from './render-styles.js';
import {pickVolume} from './volume-picking.js';
import {validAcceleration} from './render-v5-acceleration.js';
import {LOCAL_REFINEMENT_GLSL} from './local-surface-refinement.js';
import {REVIEWED_MASK_GLSL,REVIEWED_MASK_UNIFORMS,ReviewedMaskAtlas,cancelReviewedMaskAtlas} from './reviewed-mask-atlas.js';
import {SCENE_DEPTH_GLSL} from './render-depth.js';
import {activeCoronaryField,validateCoronaryField} from './coronary-rendering.js';
import {getDeviceResourcePolicy} from './device-resources.js';

/** Display samples, never a change to the measured source or mesh geometry. */
export function renderOutputPixelBudget(quality='auto',profile='interactive',fineSurface=false,resourcePolicy=getDeviceResourcePolicy()){
 let pixels;
 if(quality==='low')pixels=450000;
 else if(profile==='reconstruction'){
  // The main pane can be several times larger than a paired Echo/lab pane.
  // A shared 1.5M ceiling stretched its pixels across that larger area and
  // concealed detail already present in both donor volumes and prepared meshes.
  // Keep explicit, bounded ceilings; specialized workbenches retain their
  // established budgets and latest-only oblique scheduling.
  pixels=quality==='high'?(fineSurface?8000000:6000000):(fineSurface?6000000:4000000);
 }else pixels=quality==='high'?2600000:1500000;
 return Math.min(pixels,resourcePolicy.maxRenderPixels);
}
const vertexSource = `#version 300 es
layout(location=0) in vec2 position;
void main(){gl_Position=vec4(position,0.,1.);}`;
const fragmentSource = `#version 300 es
precision highp float;
precision highp sampler3D;
precision highp sampler2D;
out vec4 fragColor;
uniform sampler3D volume, coronaryTexture;
uniform int coronaryReady;
uniform vec3 coronaryDimensions;
uniform float coronaryThreshold;
uniform sampler3D cleanupTexture, anatomyTexture, accelerationTexture;
uniform int lumenMaskField0, lumenMaskField1, lumenMaskField2, lumenMaskField3;
uniform int lumenCleanupReady, lumenCleanupEnabled, lumenMaskCount, lumenMaskBitPacked;
uniform vec3 lumenFineDimensions, lumenMaskOrigin0, lumenMaskOrigin1, lumenMaskOrigin2, lumenMaskOrigin3;
uniform vec3 lumenMaskDimensions0, lumenMaskDimensions1, lumenMaskDimensions2, lumenMaskDimensions3;
uniform sampler2D capTexture;
uniform vec2 resolution;
uniform vec3 dimensions, extent, eye, forward, right, up;
uniform vec3 textureDimensions, textureOffset;
uniform float fov, threshold, opacity, stepSize, clipPosition;
uniform int mode, palette, clipAxis, clipFlip, showPlanes;
uniform vec3 planeNormal, capCenter, capRight, capUp;
uniform float planeDistance, capContrast;
uniform int windowEnabled;
uniform float windowLow, windowHigh, windowGamma, cutFaceExposure;
uniform vec2 capSize, capRasterSize;
uniform int capReady, capCleaned, skipCap;
uniform float cameraAspect;
uniform int cleanupReady, cleanupEnabled, anatomyReady, anatomySelected;
uniform vec3 cleanupDimensions, anatomyDimensions, anatomyColors[16];
uniform vec3 accelerationDimensions;
uniform float accelerationBlockSize;
uniform int accelerationReady, surfaceSmoothing;
uniform float anatomyOpacity;
uniform vec3 slicePositions;
${SCENE_DEPTH_GLSL}
vec3 toTex(vec3 p){return vec3(p.x/extent.x+.5,.5-p.z/extent.z,p.y/extent.y+.5);}
vec3 fromTex(vec3 p){return vec3((p.x-.5)*extent.x,(p.z-.5)*extent.y,(.5-p.y)*extent.z);}
${REVIEWED_MASK_GLSL}
float lumenExcluded(vec3 p){
 if(lumenCleanupReady==0||lumenCleanupEnabled==0)return 0.;
 vec3 f=toTex(p)*(lumenFineDimensions-1.);
 float excluded=reviewedMaskAt(lumenMaskField0,f-lumenMaskOrigin0,lumenMaskDimensions0);
 if(lumenMaskCount==0||lumenMaskCount>1)excluded=max(excluded,reviewedMaskAt(lumenMaskField1,f-lumenMaskOrigin1,lumenMaskDimensions1));
 if(lumenMaskCount>2)excluded=max(excluded,reviewedMaskAt(lumenMaskField2,f-lumenMaskOrigin2,lumenMaskDimensions2));
 if(lumenMaskCount>3)excluded=max(excluded,reviewedMaskAt(lumenMaskField3,f-lumenMaskOrigin3,lumenMaskDimensions3));
 return excluded;
}
${LOCAL_REFINEMENT_GLSL}
float cleanupAt(vec3 p){
 if(cleanupReady==0||cleanupEnabled==0)return 1.;
 vec3 t=clamp(toTex(p),vec3(0.),vec3(1.));
 return step(.5,texture(cleanupTexture,(t*(cleanupDimensions-1.)+.5)/cleanupDimensions).r);
}
float surfaceThreshold(){return coronaryReady==1?coronaryThreshold:threshold;}
vec3 surfaceDimensions(){return coronaryReady==1?coronaryDimensions:dimensions;}
float sourceDensity(vec3 p){
 vec3 t=clamp(toTex(p),vec3(0.),vec3(1.));
 return texture(volume,(t*(dimensions-1.)-textureOffset+.5)/textureDimensions).r;
}
float density(vec3 p){
 if(cleanupAt(p)<.5||lumenExcluded(p)>.5||localRefinementExcluded(p)>.5)return 0.;
 if(coronaryReady==1){
  vec3 t=clamp(toTex(p),vec3(0.),vec3(1.));
  return texture(coronaryTexture,(t*(coronaryDimensions-1.)+.5)/coronaryDimensions).r;
 }
 return sourceDensity(p);
}
vec3 anatomyTint(vec3 p,vec3 base){
 if(palette!=5||anatomyReady==0)return base;
 vec3 t=clamp(toTex(p),vec3(0.),vec3(1.));
 int id=int(floor(texture(anatomyTexture,(t*(anatomyDimensions-1.)+.5)/anatomyDimensions).r*255.+.5));
 float luminance=dot(base,vec3(.2126,.7152,.0722));
 if(anatomySelected>0&&id!=anatomySelected)return mix(base,luminance*vec3(.50,.55,.59),.8);
 if(id<1||id>15)return base;
 return mix(base,anatomyColors[id]*(.30+1.02*luminance),anatomyOpacity);
}
float capDensity(vec3 p){
 // Optional reviewed display exclusion also removes the stippled 3D cut face.
 // It never changes the source texture or the separate measured 2D CT cards.
 if(lumenExcluded(p)>.5||localRefinementExcluded(p)>.5)return 0.;
 if(capReady==0)return cleanupAt(p)<.5?0.:sourceDensity(p);
 vec3 delta=p-capCenter;
 vec2 uv=vec2(dot(delta,capRight)/capSize.x+.5,.5-dot(delta,capUp)/capSize.y);
 // A focused CT image covers only part of the physical cut. Until the full
 // face arrives, sample the current source plane outside that image instead
 // of exposing an uncapped mesh. Never extend the crop's edge pixels.
 if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return cleanupAt(p)<.5?0.:sourceDensity(p);
 // Prepared fine images already carry their own source-resolution cleanup.
 // Applying the coarser volume support mask again would erase valid fine edges.
 if(capCleaned==0&&cleanupAt(p)<.5)return 0.;
 // Keep source-sized normalization, then map valid texel centers into the
 // reusable allocation. Neither new nor stale padding enters interpolation.
 vec2 storage=vec2(textureSize(capTexture,0));
 vec2 size=capRasterSize.x>0.?capRasterSize:storage;
 vec2 sourceUv=(uv*(size-1.)+.5)/size;
 vec2 texel=clamp(sourceUv*size,vec2(.5),size-.5);
 return texture(capTexture,texel/storage).r;
}
float exposeCutIntensity(float value){
 float v=clamp(value,0.,1.),e=cutFaceExposure>0.?clamp(cutFaceExposure,.5,3.):1.;
 return e==1.?v:e*v/(1.+(e-1.)*v);
}
// Optional soft rose/ivory intensity tint. No anatomical label or new source.
vec3 atlasTone(float value){
 float v=clamp(value,0.,1.);
 vec3 color=mix(vec3(.018,.020,.021),vec3(.43,.24,.22),smoothstep(.015,.30,v));
 color=mix(color,vec3(.74,.57,.48),smoothstep(.27,.60,v));
 color=mix(color,vec3(.93,.91,.85),smoothstep(.52,.87,v));
 return mix(color,vec3(.98,.97,.93),smoothstep(.87,1.,v));
}
vec3 capShade(vec3 p,float value){
 // A scan-intensity texture, without the glossy surface lighting that obscures myocardium.
 float v=clamp((value-.50)*capContrast+.48,.025,.96);
 // This transfer changes color only. Thresholding, normals and sampling keep measured density.
 if(windowEnabled==1){float q=pow(clamp((value-windowLow)/max(.0001,windowHigh-windowLow),0.,1.),windowGamma);v=clamp((q-.5)*capContrast+.5,0.,1.);}
 v=exposeCutIntensity(v);
 vec3 color=vec3(v);
 if(palette==0)color*=vec3(1.,.92,.80);
 if(palette==1)color*=vec3(1.,.68,.49);
 if(palette==3)color=mix(vec3(.10,.18,.20),vec3(.97,.94,.86),v);
 if(palette==4){float q=windowEnabled==1?v:exposeCutIntensity(clamp((value-.48)*capContrast*1.12+.58,.015,.98));color=mix(vec3(.015,.035,.045),vec3(.98,.96,.88),q);}
 if(palette==5)color=mix(vec3(.09,.12,.14),vec3(.87,.89,.89),v);
 if(palette==6)color=atlasTone(v);
 color=anatomyTint(p,color);
 // Cap-only gamut shoulder retains label hue; the lit 3D surface is unchanged.
 if(palette==5&&anatomyReady==1){float peak=max(color.r,max(color.g,color.b));if(peak>.94)color*=(1.-.06*exp(-(peak-.94)/.06))/peak;}
 float facing=abs(dot(planeNormal,normalize(eye-p)));
 return color*(.91+.09*facing);
}
float rawVoxel(vec3 q){
 if(coronaryReady==1)return texture(coronaryTexture,(clamp(q,vec3(0.),coronaryDimensions-1.)+.5)/coronaryDimensions).r;
 return texture(volume,(clamp(q,vec3(0.),dimensions-1.)-textureOffset+.5)/textureDimensions).r;
}
float rawWorld(vec3 p){return rawVoxel(toTex(p)*(surfaceDimensions()-1.));}
vec3 centralGradient(vec3 p,float radius){
 vec3 grid=surfaceDimensions();
 vec3 d=vec3(extent.x/(grid.x-1.),extent.y/(grid.z-1.),extent.z/(grid.y-1.))*radius;
 return vec3(rawWorld(p-vec3(d.x,0,0))-rawWorld(p+vec3(d.x,0,0)),rawWorld(p-vec3(0,d.y,0))-rawWorld(p+vec3(0,d.y,0)),rawWorld(p-vec3(0,0,d.z))-rawWorld(p+vec3(0,0,d.z)))/(2.*d);
}
// Eight linear texture reads evaluate each cubic derivative. These normals
// are continuous through voxel boundaries; the isosurface and cap stay raw.
float cubicSum(vec3 lo,vec3 hi,vec3 g0,vec3 g1){
 float a=rawVoxel(vec3(lo.x,lo.y,lo.z))*g0.x+rawVoxel(vec3(hi.x,lo.y,lo.z))*g1.x;
 float b=rawVoxel(vec3(lo.x,hi.y,lo.z))*g0.x+rawVoxel(vec3(hi.x,hi.y,lo.z))*g1.x;
 float c=rawVoxel(vec3(lo.x,lo.y,hi.z))*g0.x+rawVoxel(vec3(hi.x,lo.y,hi.z))*g1.x;
 float d=rawVoxel(vec3(lo.x,hi.y,hi.z))*g0.x+rawVoxel(vec3(hi.x,hi.y,hi.z))*g1.x;
 return (a*g0.y+b*g1.y)*g0.z+(c*g0.y+d*g1.y)*g1.z;
}
vec3 cubicGradient(vec3 p){
 vec3 grid=surfaceDimensions();
 vec3 q=clamp(toTex(p)*(grid-1.),vec3(0.),grid-1.),f=fract(q),base=floor(q)-1.;
 vec3 f2=f*f,f3=f2*f,one=1.-f;
 vec3 w0=one*one*one/6.,w1=(3.*f3-6.*f2+4.)/6.,w2=(-3.*f3+3.*f2+3.*f+1.)/6.,w3=f3/6.;
 vec3 g0=w0+w1,g1=w2+w3,lo=base+w1/g0,hi=base+2.+w3/g1;
 vec3 dw0=-.5*one*one,dw1=1.5*f2-2.*f,dw2=-1.5*f2+f+.5,dw3=.5*f2;
 vec3 dg0=dw0+dw1,dg1=dw2+dw3,dlo=base+dw1/dg0,dhi=base+2.+dw3/dg1;
 float gx=cubicSum(vec3(dlo.x,lo.y,lo.z),vec3(dhi.x,hi.y,hi.z),vec3(dg0.x,g0.y,g0.z),vec3(dg1.x,g1.y,g1.z));
 float gy=cubicSum(vec3(lo.x,dlo.y,lo.z),vec3(hi.x,dhi.y,hi.z),vec3(g0.x,dg0.y,g0.z),vec3(g1.x,dg1.y,g1.z));
 float gz=cubicSum(vec3(lo.x,lo.y,dlo.z),vec3(hi.x,hi.y,dhi.z),vec3(g0.x,g0.y,dg0.z),vec3(g1.x,g1.y,dg1.z));
 return vec3(-gx*(grid.x-1.)/extent.x,-gz*(grid.z-1.)/extent.y,gy*(grid.y-1.)/extent.z);
}
vec3 gaussianGradient(vec3 p){
 // Separable five-tap Gaussian derivative (sigma 1.15 voxels), paired into
 // linear reads. Its entire footprint fits the retained three-voxel halo.
 vec3 grid=surfaceDimensions();
 vec3 q=clamp(toTex(p)*(grid-1.),vec3(0.),grid-1.);
 float g1=exp(-1./(2.*1.15*1.15)),g2=exp(-4./(2.*1.15*1.15));
 float total=1.+2.*g1+2.*g2,outer=(g1+g2)/total,center=1./total;
 float a=1.+g2/(g1+g2),d=1.+2.*g2/(g1+2.*g2);
 vec3 g=vec3(0.);
 for(int i=0;i<3;i++)for(int j=0;j<3;j++){
  float u=float(i-1)*a,v=float(j-1)*a,w=(i==1?center:outer)*(j==1?center:outer);
  g.x+=w*(rawVoxel(q+vec3(-d,u,v))-rawVoxel(q+vec3(d,u,v)));
  g.y+=w*(rawVoxel(q+vec3(u,-d,v))-rawVoxel(q+vec3(u,d,v)));
  g.z+=w*(rawVoxel(q+vec3(u,v,-d))-rawVoxel(q+vec3(u,v,d)));
 }
 return vec3(g.x*(grid.x-1.)/extent.x,g.z*(grid.z-1.)/extent.y,-g.y*(grid.y-1.)/extent.z);
}
vec3 gradient(vec3 p){
 if(surfaceSmoothing==0||mode!=0)return centralGradient(p,1.5);
 if(surfaceSmoothing==1)return cubicGradient(p);
 return gaussianGradient(p);
}
vec3 tissue(float v){
 float t=clamp((v-surfaceThreshold())*1.9+.22,0.,1.);
 if(palette==1)return mix(vec3(.40,.145,.095),vec3(.94,.67,.49),t);
 if(palette==2)return mix(vec3(.34,.37,.40),vec3(.92,.94,.95),t);
 if(palette==3)return mix(vec3(.66,.73,.73),vec3(.97,.94,.86),.46+.44*t);
 if(palette==4)return mix(vec3(.55,.68,.70),vec3(.98,.96,.88),.54+.38*t);
 if(palette==5)return mix(vec3(.44,.50,.53),vec3(.85,.87,.85),t);
 if(palette==6){
  float q=clamp((v-surfaceThreshold())*1.6,0.,1.);
  vec3 color=mix(vec3(.61,.37,.34),vec3(.73,.48,.42),smoothstep(.03,.34,q));
  color=mix(color,vec3(.85,.66,.53),smoothstep(.30,.66,q));
  return mix(color,vec3(.94,.91,.83),smoothstep(.63,.93,q));
 }
 return mix(vec3(.50,.34,.24),vec3(.96,.84,.68),t);
}
vec3 shade(vec3 p,float v,vec3 n,vec3 rd,bool cut){
 vec3 base=anatomyTint(p,tissue(v)), light=normalize(-forward*.85+up*.62+right*.46);
 if(length(n)<.01)n=-rd; else n=normalize(n);
 if(palette==6){
  // Isovertices share one threshold. Recover local tonal variation from the
  // already-resident measured field on both sides of the actual surface normal.
  // Symmetric sampling is view/normal-sign independent; it changes no geometry.
  vec3 grid=surfaceDimensions();
  float sampleDistance=1.25*min(extent.x/(grid.x-1.),min(extent.y/(grid.z-1.),extent.z/(grid.y-1.)));
  float support=max(v,max(rawWorld(p-n*sampleDistance),rawWorld(p+n*sampleDistance)));
  base=tissue(support);
 }
 if(dot(n,rd)>0.)n=-n;
 float diffuse=max(dot(n,light),0.);
 float fill=max(dot(n,normalize(-forward-right*.8-up*.1)),0.);
 float rim=pow(1.-max(dot(n,-rd),0.),2.4);
 float spec=pow(max(dot(n,normalize(light-rd)),0.),34.);
 float ao=1.;
 if(!cut){
  float occlusion=0.;
  for(int i=1;i<=4;i++){
   float v2=density(p+n*float(i)*.006);
   occlusion+=smoothstep(surfaceThreshold()-.025,surfaceThreshold()+.08,v2)/float(i);
  }
  ao=1.-clamp(occlusion*.18,0.,.6);
 }
 if(cut){base=mix(base,vec3(.94,.81,.66),.12);spec*=.1;}
 if(palette==6){
  // Neutral fill keeps recesses readable without changing their geometry.
  vec3 lightColor=mix(vec3(.78,.80,.82),vec3(1.,.985,.96),smoothstep(0.,.70,diffuse));
  return base*lightColor*(.30+.63*diffuse+.20*fill)*mix(1.,ao,.65)+vec3(1.,.985,.96)*spec*.04+base*rim*.04;
 }
 if(palette>=3){
  vec3 lightColor=mix(vec3(.63,.78,.85),vec3(1.,.98,.92),smoothstep(0.,.75,diffuse));
  float lightness=palette==4?(.10+.90*diffuse+.13*fill):(.23+.74*diffuse+.22*fill);
  return base*lightColor*lightness*ao+vec3(.96,.98,1.)*spec*.09+base*rim*.08;
 }
 return base*(.27+.79*diffuse+.21*fill)*ao + vec3(.98,.83,.69)*spec*.16 + base*rim*.14;
}
vec2 intersectBox(vec3 ro,vec3 rd,vec3 lo,vec3 hi){
 vec3 inv=1./rd, a=(lo-ro)*inv,b=(hi-ro)*inv;
 vec3 mn=min(a,b),mx=max(a,b);
 return vec2(max(max(mn.x,mn.y),mn.z),min(min(mx.x,mx.y),mx.z));
}
// Return only distances proven empty by a maximum over the cell and all its
// interpolation-boundary voxels. The sample lattice is retained after a skip.
vec2 cellRange(vec3 p,vec3 rayVoxel){
 vec3 q=clamp(toTex(p)*(dimensions-1.),vec3(0.),dimensions-1.);
 ivec3 cell=ivec3(clamp(floor(q/accelerationBlockSize),vec3(0.),accelerationDimensions-1.));
 float maximum=texelFetch(accelerationTexture,cell,0).r;
 vec3 boundary=(vec3(cell)+step(vec3(0.),rayVoxel))*accelerationBlockSize;
 vec3 d=vec3(1.e20);
 if(abs(rayVoxel.x)>.000001)d.x=(boundary.x-q.x)/rayVoxel.x;
 if(abs(rayVoxel.y)>.000001)d.y=(boundary.y-q.y)/rayVoxel.y;
 if(abs(rayVoxel.z)>.000001)d.z=(boundary.z-q.z)/rayVoxel.z;
 return vec2(maximum,max(0.,min(d.x,min(d.y,d.z))));
}
void main(){
 gl_FragDepth=1.;
 vec2 uv=gl_FragCoord.xy/resolution*2.-1.;
 vec3 bg=mix(vec3(.035,.043,.050),vec3(.075,.083,.089),max(0.,1.-length(uv*vec2(.66,.7))));
 if(palette>=3)bg=mix(vec3(.018,.029,.037),vec3(.051,.073,.082),max(0.,1.-length(uv*vec2(.66,.7))));
 if(palette==4)bg=mix(vec3(.004,.007,.011),vec3(.012,.022,.029),max(0.,1.-length(uv*vec2(.66,.7))));
 if(palette==6)bg=mix(vec3(.008,.009,.010),vec3(.021,.022,.022),max(0.,1.-length(uv*vec2(.66,.7))));
 float aspect=cameraAspect>0.?cameraAspect:resolution.x/resolution.y;
 vec3 rd=normalize(forward+right*uv.x*aspect*fov+up*uv.y*fov);
 vec3 lo=-extent*.5,hi=extent*.5;
 vec2 hit=intersectBox(eye,rd,lo,hi);
 bool capAtEntry=false;
 if(clipAxis>=0){
  float side=dot(planeNormal,eye)-planeDistance,denom=dot(planeNormal,rd);
  if(abs(denom)<.000001){if(side>0.){fragColor=vec4(pow(bg,vec3(.89)),1);return;}}
  else {
   float planeT=-side/denom;
   if(denom<0.){capAtEntry=planeT>=max(hit.x,0.)-.000001;hit.x=max(hit.x,planeT);}
   else hit.y=min(hit.y,planeT);
  }
 }
 if(hit.y<=max(hit.x,0.)){fragColor=vec4(pow(bg,vec3(.89)),1);return;}
 float entry=max(0.,hit.x), len=hit.y-entry;
 float dt=stepSize;
 vec3 rayVoxel=vec3(rd.x/extent.x,-rd.z/extent.z,rd.y/extent.y)*(dimensions-1.);
 vec4 acc=vec4(0.);
 float best=0.,bestT=entry,foundT=hit.y;
 bool found=false;
 if(mode==0){
  if(capAtEntry&&skipCap==0){
   vec3 p=eye+rd*entry;float v=capDensity(p);
   if(v>threshold){acc=vec4(capShade(p,v),1.);found=true;foundT=entry;}
  }
  float prev=entry,cellEnd=entry,cellMaximum=1.;int sampleIndex=0;
  for(int i=0;i<2048;i++){
   if(found)break;
   float t=entry+float(sampleIndex)*dt;if(t>hit.y)break;
   if(sampleIndex==0&&capAtEntry){sampleIndex++;continue;}
   vec3 p=eye+rd*t;
   if(accelerationReady==1&&t>=cellEnd-.0000001){vec2 range=cellRange(p,rayVoxel);cellMaximum=range.x;cellEnd=t+range.y;}
   float skip=accelerationReady==1&&cellMaximum<=threshold-.000001?max(0.,cellEnd-t):0.;
   if(skip>dt*1.01){int jump=max(1,int(floor(skip/dt)));prev=entry+float(sampleIndex+jump-1)*dt;sampleIndex+=jump;continue;}
   float v=density(p);
   if(v>surfaceThreshold()){
    bool cap=false;
    float a=prev,b=t;
    for(int j=0;j<6;j++){float c=(a+b)*.5;if(density(eye+rd*c)>surfaceThreshold())b=c;else a=c;}
    t=cap?entry:(a+b)*.5;p=eye+rd*t;v=density(p);
    vec3 n=gradient(p);
    vec3 color=shade(p,v,n,rd,cap);
    // Recessed cavity walls stay visible, but read darker than the tissue face.
    if(palette==4&&capAtEntry)color*=.30+.70*exp(-max(0.,t-entry)*5.);
    acc=vec4(color,1.);found=true;foundT=t;break;
   }
   prev=t;sampleIndex++;
  }
 }else{
  float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
  int sampleIndex=0;float cellEnd=entry,cellMaximum=1.;
  for(int i=0;i<2048;i++){
   float t=entry+(float(sampleIndex)+jitter)*dt;if(t>hit.y||acc.a>.985)break;
   vec3 p=eye+rd*t;
   if(accelerationReady==1&&t>=cellEnd-.0000001){vec2 range=cellRange(p,rayVoxel);cellMaximum=range.x;cellEnd=t+range.y;}
   float cutoff=mode==2?best:threshold-.035;
   float skip=accelerationReady==1&&cellMaximum<=cutoff-.000001?max(0.,cellEnd-t):0.;
   if(skip>dt*1.01){sampleIndex+=max(1,int(floor(skip/dt)));continue;}
   float v=density(p);sampleIndex++;
   if(mode==2){if(v>best){best=v;bestT=t;}continue;}
   float a=smoothstep(threshold-.035,threshold+.1,v)*opacity*dt*110.;
   if(a>.001){
    vec3 n=gradient(p),c=shade(p,v,n,rd,false);
    a=clamp(a,0.,.65);
    acc.rgb+=(1.-acc.a)*c*a;acc.a+=(1.-acc.a)*a;
    if(!found&&acc.a>.38){found=true;foundT=t;}
   }
  }
  if(mode==2){float b=smoothstep(threshold,1.,best);vec3 c=mix(vec3(.10,.14,.17),palette==1?vec3(.98,.66,.43):vec3(.86,.95,.96),b);if(palette==4)c=mix(vec3(.015,.035,.045),vec3(.98,.96,.88),b);if(palette==6)c=atlasTone(b);c=anatomyTint(eye+rd*bestT,c);acc=vec4(c*b,b);foundT=bestT;}
 }
 if(showPlanes==1){
  vec3 ps=fromTex(slicePositions);
  vec3 ts=(ps-eye)/rd;
  for(int i=0;i<3;i++){
   float t=ts[i];vec3 p=eye+rd*t,tx=toTex(p);
   if(t>entry&&t<hit.y&&t<foundT&&all(greaterThanEqual(tx,vec3(0.)))&&all(lessThanEqual(tx,vec3(1.)))){
    float v=sourceDensity(p);vec3 col=i==0?vec3(.88,.42,.35):(i==1?vec3(.45,.70,.94):vec3(.52,.80,.63));
    float a=.15+.14*smoothstep(.05,.65,v);col=mix(col,vec3(v),.66);
    acc.rgb=mix(acc.rgb,col,a);acc.a=max(acc.a,a);
   }
  }
 }
 vec3 color=acc.rgb+bg*(1.-acc.a);
 color=pow(max(color,vec3(0)),vec3(.89));
 if(found||(mode==2&&acc.a>.38))gl_FragDepth=sceneWindowDepth(foundT*dot(rd,forward));
 fragColor=vec4(color,1.);
}`;

// The moving scene can be cheaper, while the measured cut face is evaluated
// at every output pixel. Shared GLSL keeps color, sampling and mask provenance
// identical to the regular single-pass renderer.
const capCompositeSource = fragmentSource.slice(0,fragmentSource.indexOf('void main(){')) + `
uniform sampler2D sceneTexture;
uniform sampler2D sceneDepthTexture;
uniform int sceneDepthReady;
float compositeSceneDepth(vec2 screen){
 if(sceneDepthReady==0)return 1.;
 ivec2 size=textureSize(sceneDepthTexture,0);
 if(all(greaterThanEqual(vec2(size),resolution)))return texture(sceneDepthTexture,screen).r;
 // The moving scene's color is linearly enlarged. Every contributing source
 // pixel containing heart tissue must also block a rear context fragment;
 // nearest depth alone lets outlines bleed into the interpolated silhouette.
 vec2 p=screen*vec2(size)-.5,f=fract(p);ivec2 base=ivec2(floor(p));float result=1.;
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  float weight=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
  if(weight>0.)result=min(result,texelFetch(sceneDepthTexture,clamp(base+ivec2(x,y),ivec2(0),size-1),0).r);
 }
 return result;
}
void main(){
 vec2 screen=gl_FragCoord.xy/resolution;
 vec3 color=texture(sceneTexture,screen).rgb;
 gl_FragDepth=compositeSceneDepth(screen);
 // If native fine pixels are still loading, the resident measured volume
 // supplies the current plane through the same unlit cut-face transfer.
 // Keep this pass at output resolution instead of waiting on a stale plane.
 if(mode==0&&clipAxis>=0){
  vec2 uv=screen*2.-1.;
  float aspect=cameraAspect>0.?cameraAspect:resolution.x/resolution.y;
  vec3 rd=normalize(forward+right*uv.x*aspect*fov+up*uv.y*fov);
  vec2 hit=intersectBox(eye,rd,-extent*.5,extent*.5);
  float side=dot(planeNormal,eye)-planeDistance,denom=dot(planeNormal,rd);
  if(denom<-.000001){
   float planeT=-side/denom;
   bool capAtEntry=planeT>=max(hit.x,0.)-.000001;
   float entry=max(0.,max(hit.x,planeT));
   if(capAtEntry&&hit.y>entry){
    vec3 p=eye+rd*entry;float value=capDensity(p);
    if(value>threshold){color=pow(max(capShade(p,value),vec3(0.)),vec3(.89));gl_FragDepth=sceneWindowDepth(entry*dot(rd,forward));}
   }
  }
 }
 fragColor=vec4(color,1.);
}`;

/** Used by native offscreen shader verification; no browser automation is needed. */
export const volumeShaderSources = {vertex:vertexSource,volume:fragmentSource,composite:capCompositeSource};

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const mul=(a,s)=>a.map(v=>v*s);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const norm=a=>mul(a,1/Math.hypot(...a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rotate=(v,k,t)=>add(add(mul(v,Math.cos(t)),mul(cross(k,v),Math.sin(t))),mul(k,dot(k,v)*(1-Math.cos(t))));
function orientCamera(camera,normal,up){
 const n=norm(normal);camera.yaw=Math.atan2(n[0],n[2]);camera.pitch=Math.asin(clamp(n[1],-1,1));
 const forward=mul(n,-1);let r0=cross(forward,[0,1,0]);if(Math.hypot(...r0)<1e-7)r0=[Math.cos(camera.yaw),0,-Math.sin(camera.yaw)];r0=norm(r0);
 const u0=norm(cross(r0,forward));camera.roll=Math.atan2(-dot(up,r0),dot(up,u0));
}
const cameraKey=c=>[c.yaw,c.pitch,c.roll??Math.PI,c.distance,...c.pan].join(',');
const sameSetting=(a,b)=>a===b||Boolean(a&&b&&typeof a==='object'&&typeof b==='object'&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>Object.hasOwn(b,key)&&sameSetting(a[key],b[key])));
const sceneKey=(settings,extent)=>{
 const plane=clipPlane(settings,extent);
 return [settings.mode,settings.threshold,settings.coronaryReveal===true,plane?.distance??'',...(plane?.normal||[])].join(',');
};
const isOrthogonalSurface=s=>s.mode===0&&s.clipAxis>=0&&s.clipAxis<3&&!s.showPlanes;

export class VolumeRenderer {
 constructor(canvas,onChange=()=>{},{resourcePolicy=getDeviceResourcePolicy()}={}){
  this.canvas=canvas;this.onChange=onChange;this.resourcePolicy=resourcePolicy;
  this.gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  if(!this.gl)throw new Error('This browser does not support WebGL 2. Open the full-resolution atlas or try a recent Chrome, Safari, Firefox, or Edge browser.');
  this.settings={mode:0,palette:4,threshold:.3,opacity:.8,clipAxis:-1,clipPosition:.5,clipFlip:0,showPlanes:0,slices:[.5,.5,.5],quality:'auto',capContrast:1.8,...DEFAULT_WINDOW_SETTINGS,cleanupEnabled:true,lumenCleanupEnabled:false,anatomyOpacity:.65,anatomySelected:0,surfaceSmoothing:1};
  this.camera={yaw:.32,pitch:.12,roll:Math.PI,distance:1.65,pan:[0,0,0]};
  this.extent=[.9,1,.9];this.dimensions=[1,1,1];this.autoRotate=false;
  this.program=this.createProgram(vertexSource,fragmentSource);
  this.compositeProgram=this.createProgram(vertexSource,capCompositeSource);
  const gl=this.gl;gl.useProgram(this.program);
  const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const pos=gl.getAttribLocation(this.program,'position');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
  const names=['volume','resolution','dimensions','textureDimensions','textureOffset','extent','eye','forward','right','up','fov','cameraAspect','threshold','opacity','stepSize','clipPosition','mode','palette','clipAxis','clipFlip','showPlanes','slicePositions','capTexture','capReady','capCleaned','skipCap','capCenter','capRight','capUp','capSize','capRasterSize','capContrast','windowEnabled','windowLow','windowHigh','windowGamma','cutFaceExposure','planeNormal','planeDistance','cleanupTexture','cleanupReady','cleanupEnabled','cleanupDimensions','anatomyTexture','anatomyReady','anatomyDimensions','anatomyOpacity','anatomySelected','accelerationTexture','accelerationReady','accelerationDimensions','accelerationBlockSize','surfaceSmoothing','sceneTexture'];
  names.push('sceneDepthTexture','sceneDepthReady','coronaryTexture','coronaryReady','coronaryDimensions','coronaryThreshold');
  names.push('lumenCleanupReady','lumenCleanupEnabled','lumenFineDimensions','lumenMaskCount','lumenMaskBitPacked');
  for(let i=0;i<4;i++)names.push('lumenMaskField'+i,'lumenMaskOrigin'+i,'lumenMaskDimensions'+i);
  names.push(...REVIEWED_MASK_UNIFORMS);
  names.push('refinementReady','refinementCount');
  for(let i=0;i<4;i++)names.push('refinementField'+i,'refinementOrigin'+i,'refinementDimensions'+i,'refinementMin'+i,'refinementMax'+i);
  const uniforms=program=>Object.fromEntries([...names.map(name=>[name,gl.getUniformLocation(program,['reviewedMaskOffsets','reviewedMaskGrids'].includes(name)?name+'[0]':name)]),['anatomyColors',gl.getUniformLocation(program,'anatomyColors[0]')]]);
  this.uniforms=uniforms(this.program);this.compositeUniforms=uniforms(this.compositeProgram);
  this.anatomyColors=buildAnatomyPalette();
  this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_3D,this.texture);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE);
  this.capTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.capTexture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,1,1,0,gl.RED,gl.UNSIGNED_BYTE,new Uint8Array([0]));
  for(const [name,unit,value] of [['cleanupTexture',2,255],['anatomyTexture',3,0],['accelerationTexture',4,255]]){
   this[name]=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_3D,this[name]);
   gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   for(const wrap of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,wrap,gl.CLAMP_TO_EDGE);
   gl.texImage3D(gl.TEXTURE_3D,0,gl.R8,1,1,1,0,gl.RED,gl.UNSIGNED_BYTE,new Uint8Array([value]));
  }
  this.emptyReviewedMaskAtlas=new ReviewedMaskAtlas(gl);
  this.timerExtension=gl.getExtension('EXT_disjoint_timer_query_webgl2');this.gpuQueries=[];this.interactionPixels=160000;
  this.viewRevision=0;this.displayedRevision=-1;this.refineRequested=false;
  this.cameraQuality=false;this.requestedCameraKey=cameraKey(this.camera);
  this.bindControls();
  this.observer=new ResizeObserver(()=>this.requestRender());this.observer.observe(canvas);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.disposeReviewedMaskAtlas();this.onChange({error:'The graphics context was interrupted. Reload to restore the 3D view.'});});
 }
 createProgram(vs,fs){
  const gl=this.gl,p=gl.createProgram(),shaders=[];
  if(!p)throw new Error('The graphics device could not allocate a shader program.');
  try{
   for(const [type,src] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){
    const s=gl.createShader(type);if(!s)throw new Error('The graphics device could not allocate a shader.');shaders.push(s);
    gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Volume shader: '+gl.getShaderInfoLog(s));gl.attachShader(p,s);
   }
   gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;
  }catch(error){gl.deleteProgram(p);throw error;}
  finally{for(const shader of shaders)gl.deleteShader(shader);}
 }
 load(data,meta,acceleration=null,gpuCrop=null){
  const firstLoad=!this.loaded,gl=this.gl,dims=meta.dimensions,max=gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
  const sameSectionGrid=sameSetting(this.meta?.dimensions,dims)&&sameSetting(this.meta?.spacingUm,meta.spacingUm);
  const cropValid=gpuCrop&&gpuCrop.data instanceof Uint8Array&&Array.isArray(gpuCrop.dimensions)&&gpuCrop.dimensions.length===3&&Array.isArray(gpuCrop.offset)&&gpuCrop.offset.length===3&&gpuCrop.dimensions.every((d,i)=>Number.isInteger(d)&&d>1&&Number.isInteger(gpuCrop.offset[i])&&gpuCrop.offset[i]>=0&&gpuCrop.offset[i]+d<=dims[i])&&gpuCrop.data.length===gpuCrop.dimensions.reduce((a,b)=>a*b,1);
  const textureDimensions=cropValid?gpuCrop.dimensions:dims;
  if(Math.max(...textureDimensions)>max)throw new Error('This volume exceeds the graphics device’s 3D texture limit. Select the fast-resolution view.');
  const size=dims.map((d,i)=>(d-1)*(Array.isArray(meta.spacingUm)?meta.spacingUm[i]:meta.spacingUm));
  const longest=Math.max(...size),extent=[size[0]/longest,size[2]/longest,size[1]/longest];
  const pixels=cropValid?gpuCrop.data:data,texture=gl.createTexture(),previous=this.texture;
  if(!texture)throw new Error('The graphics device could not allocate this volume. Select a smaller resolution.');
  // Preserve the complete working preview until every replacement upload has
  // succeeded. An out-of-memory texImage3D must never damage its texture.
  try{
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,texture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
   gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   for(const wrap of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,wrap,gl.CLAMP_TO_EDGE);
   // Only texture storage is cropped. Spatial, label, camera and clipping
   // calculations retain the original acquisition grid and physical extent.
   gl.texImage3D(gl.TEXTURE_3D,0,gl.R8,...textureDimensions,0,gl.RED,gl.UNSIGNED_BYTE,pixels);
   const err=gl.getError();if(err!==gl.NO_ERROR)throw new Error('The graphics device could not load this volume (WebGL '+err+'). Select a smaller resolution.');
   this.setAccelerationData(acceleration,dims);
  }catch(error){
   gl.deleteTexture(texture);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,previous||null);throw error;
  }
  this.texture=texture;this.dimensions=dims;this.data=data;this.meta=meta;this.extent=extent;
  this.textureDimensions=textureDimensions;this.textureOffset=cropValid?gpuCrop.offset:[0,0,0];this.textureBytes=pixels.length;
  if(previous)gl.deleteTexture(previous);
  // First views and changed physical source grids remain bounded. A measured
  // phase on the same grid keeps section quality while using the new texture
  // installed above. Established manual camera quality survives source upgrades.
  this.loaded=true;this.requestRender(firstLoad||this.sectionQuality&&!sameSectionGrid?'scene':undefined);
 }
 coronaryActive(){return activeCoronaryField(this);}
 setCoronaryData(data,meta){
  validateCoronaryField(this,data,meta);
  if(this.coronaryField?.data===data&&this.coronaryField.meta.rawSha256===meta.rawSha256)return;
  const gl=this.gl;
  if(Math.max(...meta.dimensions)>gl.getParameter(gl.MAX_3D_TEXTURE_SIZE))throw new Error('The coronary view exceeds this device’s texture limit.');
  const texture=gl.createTexture();
  if(!texture)throw new Error('The graphics device could not allocate the coronary view.');
  try{
   gl.activeTexture(gl.TEXTURE0+8);gl.bindTexture(gl.TEXTURE_3D,texture);
   gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
   gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   for(const wrap of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,wrap,gl.CLAMP_TO_EDGE);
   gl.texImage3D(gl.TEXTURE_3D,0,gl.R8,...meta.dimensions,0,gl.RED,gl.UNSIGNED_BYTE,data);
   const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error('The graphics device could not prepare the coronary view (WebGL '+error+').');
  }catch(error){gl.deleteTexture(texture);throw error;}
  const previous=this.coronaryField;this.coronaryField={data,meta,texture};
  if(previous?.texture)gl.deleteTexture(previous.texture);
 }
 setAccelerationData(acceleration,dimensions=this.dimensions){
  if(!validAcceleration(acceleration,dimensions)){this.acceleration=null;return;}
  const gl=this.gl,texture=gl.createTexture(),previous=this.accelerationTexture;
  if(!texture)throw new Error('The graphics device could not allocate volume acceleration. Select a smaller resolution.');
  try{
   gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_3D,texture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
   gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   for(const wrap of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,wrap,gl.CLAMP_TO_EDGE);
   gl.texImage3D(gl.TEXTURE_3D,0,gl.R8,...acceleration.dimensions,0,gl.RED,gl.UNSIGNED_BYTE,acceleration.maxima);
   const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error('The graphics device could not load volume acceleration (WebGL '+error+'). Select a smaller resolution.');
  }catch(error){
   gl.deleteTexture(texture);gl.bindTexture(gl.TEXTURE_3D,previous||null);throw error;
  }
  this.acceleration=acceleration;this.accelerationTexture=texture;if(previous)gl.deleteTexture(previous);
 }
 basis(){
  const c=this.camera,offset=[Math.sin(c.yaw)*Math.cos(c.pitch),Math.sin(c.pitch),Math.cos(c.yaw)*Math.cos(c.pitch)];
  const forward=mul(offset,-1),r0=norm(cross(forward,[0,1,0])),u0=norm(cross(r0,forward));
  const roll=c.roll??Math.PI,cr=Math.cos(roll),sr=Math.sin(roll),right=add(mul(r0,cr),mul(u0,sr)),up=add(mul(u0,cr),mul(r0,-sr));
  return {eye:add(c.pan,mul(offset,c.distance)),forward,right,up};
 }
 minimumCameraDistance(){
  // Hiding a focused native region must not make the next zoom gesture jump.
  return this.nativeMainDetail?.hasActiveRegion?.() ? .045 : Math.max(.045,Math.min(.34,this.camera.distance));
 }
 bindControls(){
  const c=this.canvas,pointers=new Map(),doc=c.ownerDocument;
  c.style.touchAction='none';
  c.addEventListener('pointerdown',e=>{
   if(!Number.isFinite(e.clientX+e.clientY))return;
   pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,button:e.button});
   try{c.setPointerCapture?.(e.pointerId);}catch{}
   this.interacting=true;this.lastInteraction=performance.now();
  });
  c.addEventListener('pointermove',e=>{
   if(!pointers.has(e.pointerId)||!Number.isFinite(e.clientX+e.clientY))return;
   const before=[...pointers.values()];
   const p=pointers.get(e.pointerId),dx=e.clientX-p.x,dy=e.clientY-p.y;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,button:p.button});
   if(!dx&&!dy)return;
   if(pointers.size>1){
    // Use the previous positions of the same two contacts, including their
    // initial pointerdown positions. Adding/lifting a finger never reuses an
    // old pinch baseline, and the first movement is not silently discarded.
    const [a,b]=before,[u,v]=[...pointers.values()];
    const prior=Math.hypot(a.x-b.x,a.y-b.y),next=Math.hypot(u.x-v.x,u.y-v.y),distance=this.camera.distance;
    if(prior>1&&next>1)this.camera.distance=clamp(distance*prior/next,this.minimumCameraDistance(),5);
    const rect=c.getBoundingClientRect(),scale=.64/Math.max(1,rect.height),cx=(rect.left||0)+rect.width/2,cy=(rect.top||0)+rect.height/2;
    const x0=(a.x+b.x)/2-cx,y0=cy-(a.y+b.y)/2,x1=(u.x+v.x)/2-cx,y1=cy-(u.y+v.y)/2;
    const {right,up}=this.basis();
    // The renderer's perspective uses tan(FOV/2)=.32. Pan at the camera's
    // target depth in CSS pixels, so the model follows the fingers at every
    // pane size and pixel ratio. Pinch keeps their midpoint anchored too.
    this.camera.pan=add(this.camera.pan,add(mul(right,(x0*distance-x1*this.camera.distance)*scale),mul(up,(y0*distance-y1*this.camera.distance)*scale)));
   }
   else if(e.shiftKey||p.button===2||p.button===1){const {right,up}=this.basis(),scale=this.camera.distance*.0012;this.camera.pan=add(this.camera.pan,add(mul(right,-dx*scale),mul(up,dy*scale)));}
   else this.orbit(dx,dy);
   this.lastInteraction=performance.now();this.requestRender('camera');this.onChange({camera:true});
  });
  const finish=()=>{this.interacting=false;if(this.queueFrame)this.queueFrame();else this.requestRender();};
  const end=e=>{if(pointers.delete(e.pointerId)&&!pointers.size)finish();};
  const cancel=()=>{if(!pointers.size)return;pointers.clear();finish();};
  c.addEventListener('pointerup',end);c.addEventListener('pointercancel',end);c.addEventListener('lostpointercapture',end);
  doc?.defaultView?.addEventListener('blur',cancel);
  doc?.addEventListener('visibilitychange',()=>{if(doc.hidden)cancel();});
  doc?.addEventListener('pointerlockchange',()=>{if(doc.pointerLockElement)cancel();});
  c.addEventListener('contextmenu',e=>e.preventDefault());
  c.addEventListener('wheel',e=>{e.preventDefault();this.camera.distance=clamp(this.camera.distance*Math.exp(e.deltaY*.001),this.minimumCameraDistance(),5);this.lastInteraction=performance.now();this.requestRender('camera');this.onChange({camera:true});},{passive:false});
  c.addEventListener('dblclick',()=>this.reset());
  c.addEventListener('keydown',e=>{
   let used=true;if(e.key==='ArrowLeft')this.orbit(-12,0);else if(e.key==='ArrowRight')this.orbit(12,0);else if(e.key==='ArrowUp')this.orbit(0,-12);else if(e.key==='ArrowDown')this.orbit(0,12);else if(e.key==='+'||e.key==='=')this.camera.distance=clamp(this.camera.distance*.88,this.minimumCameraDistance(),5);else if(e.key==='-')this.camera.distance=clamp(this.camera.distance*1.12,this.minimumCameraDistance(),5);else if(e.key.toLowerCase()==='r')this.reset();else used=false;
   if(used){e.preventDefault();this.lastInteraction=performance.now();this.requestRender('camera');}
  });
 }
 set(values){
  // Repeated settings callbacks need not schedule another full camera frame.
  if(Object.entries(values).every(([key,value])=>sameSetting(this.settings[key],value))&&this.requestedCameraKey===cameraKey(this.camera))return;
  const previous=sceneKey(this.settings,this.extent),mode=this.settings.mode,threshold=this.settings.threshold;
  Object.assign(this.settings,values);
  const changed=previous!==sceneKey(this.settings,this.extent);
  const orthogonalSurface=isOrthogonalSurface(this.settings);
  // Scrolling the main section cards must not replace every surrounding
  // surface with an enlarged preview. Keep the chosen ray grid for those
  // plane-only changes; oblique probe/echo work retains its bounded policy.
  const section=changed&&this.loaded&&orthogonalSurface&&mode===this.settings.mode&&threshold===this.settings.threshold;
  this.requestRender(changed?(section?'section':'scene'):this.sectionQuality&&!orthogonalSurface?'scene':undefined);
 }
 setCapData(cap){
  // Keep the plane/data snapshot immediately visible to the application, but
  // upload only the latest accepted cap when a new GPU frame can actually run.
  // Uploading here can synchronize with the preceding frame and sends unused
  // intermediate slices when several scroll events arrive before one RAF.
  this.cap=cap;this.requestRender();
 }
 uploadCapData(){
  const cap=this.cap;if(!cap)return false;
  if(this.uploadedCapData===cap.data&&this.uploadedCapWidth===cap.width&&this.uploadedCapHeight===cap.height)return false;
  const gl=this.gl;gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.capTexture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
  // Cropped neighboring sections have slightly different sizes. Retain one
  // grow-only allocation, rounded to 256 pixels, instead of reallocating on
  // almost every crop change. capRasterSize maps only the valid texel centers;
  // old pixels beyond that rectangle can never bleed into the measured face.
  const width=Math.max(this.capTextureWidth||0,Math.ceil(cap.width/256)*256);
  const height=Math.max(this.capTextureHeight||0,Math.ceil(cap.height/256)*256);
  if(this.capTextureWidth!==width||this.capTextureHeight!==height){
   gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,width,height,0,gl.RED,gl.UNSIGNED_BYTE,null);
   this.capTextureWidth=width;this.capTextureHeight=height;
  }
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,cap.width,cap.height,gl.RED,gl.UNSIGNED_BYTE,cap.data);
  this.uploadedCapData=cap.data;this.uploadedCapWidth=cap.width;this.uploadedCapHeight=cap.height;return true;
 }
 clearCapData(){this.cap=null;this.requestRender();}
 setCleanupData(map){
  this.cleanup=map;
  if(map){const gl=this.gl;gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_3D,this.cleanupTexture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage3D(gl.TEXTURE_3D,0,gl.R8,...map.dimensions,0,gl.RED,gl.UNSIGNED_BYTE,map.data);}
  this.requestRender();
 }
 setAnatomyData(map){
  this.anatomy=map;this.anatomyColors=buildAnatomyPalette(map?.palette||map?.labels);
  if(map){const gl=this.gl;gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_3D,this.anatomyTexture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage3D(gl.TEXTURE_3D,0,gl.R8,...map.dimensions,0,gl.RED,gl.UNSIGNED_BYTE,map.data);}
  this.requestRender();
 }
 setReviewedMaskAtlas(collection,options){
  if(!collection){this.reviewedMaskAtlas?.dispose();this.reviewedMaskAtlas=null;this.requestRender('scene');return;}
  if(!collection.manifest.extent.every((n,i)=>Math.abs(n-this.extent[i])<.000001))throw new Error('The completed model masks do not match this source extent.');
  const next=new ReviewedMaskAtlas(this.gl,collection,options),previous=this.reviewedMaskAtlas;
  this.reviewedMaskAtlas=next;previous?.dispose();this.requestRender('scene');
 }
 disposeReviewedMaskAtlas(){cancelReviewedMaskAtlas(this);this.reviewedMaskAtlas?.dispose();this.emptyReviewedMaskAtlas?.dispose();this.reviewedMaskAtlas=this.emptyReviewedMaskAtlas=null;}
 setLumenCleanupData(collection){
  if(!collection){this.lumenCleanup=null;this.lumenMaskFields=[];this.settings.lumenCleanupEnabled=false;this.requestRender('scene');return;}
  if(!Array.isArray(collection.masks)||collection.masks.length<1||collection.masks.length>4||!Array.isArray(collection.fullDimensionsXYZ)||collection.fullDimensionsXYZ.length!==3||!collection.fullDimensionsXYZ.every(n=>Number.isInteger(n)&&n>0)||!Array.isArray(collection.extent)||!collection.extent.every((n,i)=>Number.isFinite(n)&&Math.abs(n-this.extent[i])<.000001)||collection.bitPacked!==true)throw new Error('The lumen review does not match this source.');
  const atlas=this.reviewedMaskAtlas;if(!atlas?.ready)throw new Error('The completed model masks must be ready before lumen cleanup activates.');
  const sparse=!!collection.sparseAtlas;
  if(sparse&&collection.sparseAtlas!==atlas.collection)throw new Error('The CPU lumen atlas must match the displayed masks.');
  let totalBytes=0;const fields=[];
  for(const mask of collection.masks){
   const dims=mask.dimensionsXYZ,origin=mask.lowerFullFineXYZ,storage=mask.storageDimensionsXYZ;
   if(!Array.isArray(dims)||dims.length!==3||!dims.every((n,k)=>Number.isInteger(n)&&n>0&&Number.isInteger(origin?.[k])&&origin[k]>=0&&origin[k]+n<=collection.fullDimensionsXYZ[k])||!Array.isArray(storage)||storage.length!==3||!storage.every((n,k)=>Number.isInteger(n)&&n>0&&n===(k===0?Math.ceil(dims[0]/8):dims[k]))||(!sparse&&(!(mask.data instanceof Uint8Array)||mask.data.length!==storage.reduce((a,b)=>a*b,1)||(totalBytes+=mask.data.length)>128*1024*1024)))throw new Error('Invalid lumen display mask.');
   const field=atlas.fieldIndex('lumen:'+mask.id,mask);if(field<0)throw new Error('The completed model atlas does not match this lumen mask.');fields.push(field);
  }
  // Mobile CPU picking shares the exact sparse atlas instead of retaining
  // 81.8 MB of dense masks. Desktop retains its original verified source views.
  this.lumenCleanup=collection;this.lumenMaskFields=fields;this.requestRender('scene');
 }
 inspectAt(x,y){return pickVolume(this,x,y);}
 orbit(dx,dy){
  const b=this.basis(),horizontal=-dx*.008,vertical=-dy*.007;
  const r=norm(rotate(b.right,b.up,horizontal)),n=norm(rotate(rotate(mul(b.forward,-1),b.up,horizontal),r,vertical)),u=norm(rotate(b.up,r,vertical));
  orientCamera(this.camera,n,u);
 }
 alignPlane(normal,up,center=[0,0,0],{followScene=false}={}){
  // A following camera retains the selected workload: native orthogonal cuts
  // or bounded oblique Echo/probe work. Explicit views use camera quality.
  const reason=followScene?(this.sectionQuality&&isOrthogonalSurface(this.settings)?'section':'scene'):'camera';
  orientCamera(this.camera,normal,up);this.camera.pan=[...center];this.autoRotate=false;this.requestRender(reason);this.onChange({camera:true});
 }
 reset(){this.camera={yaw:.32,pitch:.12,roll:Math.PI,distance:1.65,pan:[0,0,0]};this.requestRender('camera');this.onChange({camera:true});}
 view(name){
  const a={front:[0,0],back:[Math.PI,0],left:[-Math.PI/2,0],right:[Math.PI/2,0],top:[0,1.53]};
  if(a[name]){[this.camera.yaw,this.camera.pitch]=a[name];this.camera.pan=[0,0,0];this.requestRender('camera');}
 }
 setContextLayer(layer){
  if(this.contextLayer===layer)return;
  this.contextLayer=layer||null;this.requestRender();
 }
 getContextOcclusion(){
  // WebGL context belongs in its shared depth pass. If that optional pass
  // cannot initialize, never fall back to an unoccluded 2D anatomy overlay.
  return {pending:true,unavailable:true,revision:this.contextFrameRevision||0};
 }
 // Context is submitted only with a newly presented heart frame, after its
 // exact cap. It therefore cannot inherit an older camera or source depth.
 drawContextLayer(w,h,b,aspect){
  this.contextFrameRevision=(this.contextFrameRevision||0)+1;
  if(!this.contextLayer)return;
  const gl=this.gl,rect=this.canvas.getBoundingClientRect();
  try{this.contextLayer.draw({renderer:this,gl,basis:b,width:rect.width,height:rect.height,pixelWidth:w,pixelHeight:h,aspect});}
  catch(error){this.contextLayer.onError?.(error);}
  finally{
   gl.bindVertexArray(null);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.disable(gl.DEPTH_TEST);gl.depthMask(true);
   gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);
  }
 }
 prepareSceneDepth(){
  const gl=this.gl;
  if(this.contextLayer){gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.ALWAYS);gl.depthMask(true);}
  else gl.disable(gl.DEPTH_TEST);
 }
 ensureSceneDepth(target,width,height){
  if(!this.contextLayer&&!target.depthTexture)return;
  const gl=this.gl;
  if(!target.depthTexture){
   target.depthTexture=gl.createTexture();if(!target.depthTexture)throw new Error('Spatial depth storage is unavailable.');
   gl.activeTexture(gl.TEXTURE0+14);gl.bindTexture(gl.TEXTURE_2D,target.depthTexture);
   for(const [name,value]of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,name,value);
  }
  if(target.depthWidth!==width||target.depthHeight!==height){
   gl.activeTexture(gl.TEXTURE0+14);gl.bindTexture(gl.TEXTURE_2D,target.depthTexture);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,width,height,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,target.depthTexture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Spatial depth target is unavailable.');
   target.depthWidth=width;target.depthHeight=height;
  }
 }
 requestRender(reason){
  const key=cameraKey(this.camera);
  const rotatingDuringSection=this.autoRotate&&this.requestedAutoRotate&&this.sectionQuality&&performance.now()-(this.lastSceneChange??-Infinity)<170;
  if(reason==='scene'||reason==='section'){this.cameraQuality=false;this.sectionQuality=reason==='section';this.lastSceneChange=performance.now();}
  else if(reason==='camera'||!rotatingDuringSection&&(this.autoRotate&&!this.requestedAutoRotate||this.requestedCameraKey!==undefined&&this.requestedCameraKey!==key)){this.cameraQuality=true;this.sectionQuality=false;}
  this.requestedAutoRotate=this.autoRotate;
  this.requestedCameraKey=key;
  this.viewRevision=(this.viewRevision||0)+1;this.refinement=null;this.refineRequested=false;
  this.queueFrame();
  // Do not submit a monolithic idle raymarch during short pauses between
  // gestures. Refinement is interruptible and never advances this revision.
  clearTimeout(this.refineTimer);this.refineTimer=setTimeout(()=>{this.lastInteraction=0;if(this.completedRevision===this.viewRevision)return;this.refineRequested=true;this.queueFrame();},260);
 }
 queueFrame(){
  if(!this.pending)this.pending=requestAnimationFrame(()=>{this.pending=0;this.render();});
 }
 noteBusyFence(){
  const frame=this.submittedFrame;if(!frame)return;
  frame.waits++;const elapsed=performance.now()-frame.started;
  // Safari need not expose the timer-query extension. Repeated unsignaled
  // fence polls still prove that this batch is too expensive. This is a lower
  // bound on completion latency, not a GPU timer or a browser FPS measurement.
  if(frame.waits>=2&&elapsed>32&&!frame.adjusted){
   // Stable camera/orthogonal-section frames retain the chosen quality even
   // on a slower device. They cannot shrink the independent preview budget.
   if(frame.kind==='camera'||frame.kind==='section'){
    frame.adjusted=true;
    if(frame.kind==='camera')this.cameraWaitLowerBoundMs=elapsed;else this.sectionWaitLowerBoundMs=elapsed;
    return;
   }
   this.interactionPixels=Math.min(this.interactionPixels||160000,clamp(frame.workPixels*18/elapsed,35000,600000));
   frame.adjusted=true;this.fenceWaitLowerBoundMs=elapsed;
  }
 }
 finishGpuFrame(workPixels,kind){
  const gl=this.gl;this.renderFence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
  this.submittedFrame={started:performance.now(),workPixels,kind,waits:0,adjusted:false};
 }
 pollGpuTimers(){
  const gl=this.gl,ext=this.timerExtension;if(!ext)return;
  const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);
  for(let i=this.gpuQueries.length-1;i>=0;i--){
   const item=this.gpuQueries[i],ready=gl.getQueryParameter(item.query,gl.QUERY_RESULT_AVAILABLE);
   if(!ready&&!disjoint)continue;
   if(ready&&!disjoint){const ms=gl.getQueryParameter(item.query,gl.QUERY_RESULT)/1e6;if(ms>0&&ms<5000){
    const cost=ms/item.pixels;
    if(item.kind==='refinement'){
     // Cheap empty bands or fine-cap early exits are not representative of a
     // complete moving scene. Never let idle timing inflate its next budget.
     this.refinementGpuCost=this.refinementGpuCost==null?cost:Math.max(cost,this.refinementGpuCost*.9);
     this.refinementPixels=clamp(14/this.refinementGpuCost,35000,160000);
    }else if(item.kind==='camera')this.cameraFrameMs=ms;
    else if(item.kind==='section')this.sectionFrameMs=ms;
    else if(item.kind!=='snapshot'){
     this.gpuCost=this.gpuCost==null?cost:Math.max(cost,this.gpuCost*.9);
     this.interactionPixels=clamp(18/this.gpuCost,35000,600000);
    }
    this.performanceStats={backend:'webgl2',frameMs:ms,pixels:item.pixels,outputPixels:item.outputPixels||item.pixels,fullResolutionCap:item.fullResolutionCap,interactionPixels:Math.round(this.interactionPixels),accelerated:item.accelerated,kind:item.kind||'preview'};
   }}
   gl.deleteQuery(item.query);this.gpuQueries.splice(i,1);
  }
 }
 bindSceneUniforms(program,u,w,h,b,aspect,skipCap=false){
  const gl=this.gl,s=this.settings,coronary=this.coronaryActive();
  gl.useProgram(program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,this.texture);
  gl.uniform1i(u.volume,0);gl.uniform2f(u.resolution,w,h);gl.uniform3fv(u.dimensions,this.dimensions);gl.uniform3fv(u.textureDimensions,this.textureDimensions||this.dimensions);gl.uniform3fv(u.textureOffset,this.textureOffset||[0,0,0]);gl.uniform3fv(u.extent,this.extent);
  gl.activeTexture(gl.TEXTURE0+8);gl.bindTexture(gl.TEXTURE_3D,coronary?.texture||this.texture);
  gl.uniform1i(u.coronaryTexture,8);gl.uniform1i(u.coronaryReady,coronary?1:0);
  gl.uniform3fv(u.coronaryDimensions,coronary?.meta.dimensions||this.dimensions);gl.uniform1f(u.coronaryThreshold,coronary?.meta.threshold||.5);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.capTexture);gl.uniform1i(u.capTexture,1);
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_3D,this.cleanupTexture);gl.uniform1i(u.cleanupTexture,2);
  gl.uniform1i(u.cleanupReady,this.cleanup?1:0);gl.uniform1i(u.cleanupEnabled,s.cleanupEnabled===false?0:1);gl.uniform3fv(u.cleanupDimensions,this.cleanup?.dimensions||[1,1,1]);
  gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_3D,this.anatomyTexture);gl.uniform1i(u.anatomyTexture,3);
  gl.uniform1i(u.anatomyReady,this.anatomy?1:0);gl.uniform3fv(u.anatomyDimensions,this.anatomy?.dimensions||[1,1,1]);gl.uniform1f(u.anatomyOpacity,s.anatomyOpacity??.65);gl.uniform1i(u.anatomySelected,s.anatomySelected??0);gl.uniform3fv(u.anatomyColors,this.anatomyColors.flat());
  const atlas=this.reviewedMaskAtlas||this.emptyReviewedMaskAtlas;if(atlas)atlas.bindScene(u);else gl.uniform1i(u.reviewedMaskReady,0);
  const lumen=this.reviewedMaskAtlas?.ready&&this.lumenCleanup?.extent.every((n,i)=>Math.abs(n-this.extent[i])<.000001)?this.lumenCleanup:null;
  gl.uniform1i(u.lumenCleanupReady,lumen?1:0);gl.uniform1i(u.lumenCleanupEnabled,s.lumenCleanupEnabled===true?1:0);gl.uniform3fv(u.lumenFineDimensions,lumen?.fullDimensionsXYZ||[1,1,1]);
  gl.uniform1i(u.lumenMaskCount,lumen?.masks.length||0);gl.uniform1i(u.lumenMaskBitPacked,lumen?.bitPacked?1:0);
  for(let i=0;i<4;i++){
   gl.uniform1i(u['lumenMaskField'+i],lumen?this.lumenMaskFields[i]??-1:-1);
   gl.uniform3fv(u['lumenMaskOrigin'+i],lumen?.masks[i]?.lowerFullFineXYZ||[0,0,0]);gl.uniform3fv(u['lumenMaskDimensions'+i],lumen?.masks[i]?.dimensionsXYZ||[1,1,1]);
  }
  if(this.localSurfaceRefinement)this.localSurfaceRefinement.bindScene(u);
  else {gl.uniform1i(u.refinementReady,0);gl.uniform1i(u.refinementCount,0);}
  // Conservative CPU skipping is a clear win there, but the equivalent GPU
  // branches did not help every tested view. Keep GPU skipping opt-in until
  // actual device measurements justify enabling it for that device.
  const accelerated=Boolean(!coronary&&this.acceleration&&s.accelerationEnabled===true);
  gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_3D,this.accelerationTexture);gl.uniform1i(u.accelerationTexture,4);gl.uniform1i(u.accelerationReady,accelerated?1:0);gl.uniform3fv(u.accelerationDimensions,this.acceleration?.dimensions||[1,1,1]);gl.uniform1f(u.accelerationBlockSize,this.acceleration?.blockSize||8);gl.uniform1i(u.surfaceSmoothing,clamp(Math.round(coronary?(s.coronarySmoothing??2):(s.surfaceSmoothing??1)),0,2));
  const plane=clipPlane(s,this.extent),cp=this.cap?.plane;
  gl.uniform3fv(u.planeNormal,plane?.normal||[0,0,1]);gl.uniform1f(u.planeDistance,plane?.distance||0);
  gl.uniform1i(u.capCleaned,this.cap?.cleaned===true?1:0);gl.uniform1i(u.skipCap,skipCap?1:0);gl.uniform1f(u.cameraAspect,aspect);
  gl.uniform1i(u.capReady,this.cap?1:0);gl.uniform3fv(u.capCenter,cp?.center||[0,0,0]);gl.uniform3fv(u.capRight,cp?.right||[1,0,0]);gl.uniform3fv(u.capUp,cp?.up||[0,1,0]);gl.uniform2fv(u.capSize,cp?[cp.width,cp.height]:[1,1]);gl.uniform2f(u.capRasterSize,this.cap?.width||1,this.cap?.height||1);gl.uniform1f(u.capContrast,s.capContrast??1.8);
  const windowing=windowParameters(s);gl.uniform1i(u.windowEnabled,windowing.windowEnabled?1:0);for(const name of ['windowLow','windowHigh','windowGamma','cutFaceExposure'])gl.uniform1f(u[name],windowing[name]);
  for(const n of ['eye','forward','right','up'])gl.uniform3fv(u[n],b[n]);gl.uniform1f(u.fov,.32);
  for(const n of ['threshold','opacity','clipPosition'])gl.uniform1f(u[n],s[n]);
  for(const n of ['mode','palette','clipAxis','clipFlip','showPlanes'])gl.uniform1i(u[n],s[n]);
  gl.uniform3fv(u.slicePositions,s.slices);
  const grid=coronary?.meta.dimensions||this.dimensions;
  const voxel=Math.min(this.extent[0]/(grid[0]-1),this.extent[1]/(grid[2]-1),this.extent[2]/(grid[1]-1));
  // The physical sample step, lighting, normals and cap contrast remain the
  // same for both programs and for idle versus interaction frames.
  gl.uniform1f(u.stepSize,voxel*(s.quality==='high'?.65:.9));
  return accelerated;
 }
 ensureMotionTarget(width,height){
  if(this.motionTargetUnsupported)return false;
  const gl=this.gl;
  try{
   if(!this.motionTarget){
    const texture=gl.createTexture(),framebuffer=gl.createFramebuffer();
    if(!texture||!framebuffer)throw new Error('Motion target allocation failed.');
    this.motionTarget={texture,framebuffer,width:0,height:0};
    gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,texture);
    for(const [name,value] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,name,value);
   }
   const target=this.motionTarget;
   gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);
   if(target.width!==width||target.height!==height){
    gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,target.texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target.texture,0);
    target.width=width;target.height=height;
    this.ensureSceneDepth(target,width,height);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Motion target is unavailable.');
   }
   this.ensureSceneDepth(target,width,height);
   return true;
  }catch{
   // A device without the extra target retains a sharp, single-pass image.
   // It may render fewer frames, but never replaces source texture detail.
   if(this.motionTarget){gl.deleteTexture(this.motionTarget.texture);if(this.motionTarget.depthTexture)gl.deleteTexture(this.motionTarget.depthTexture);gl.deleteFramebuffer(this.motionTarget.framebuffer);}
   this.motionTarget=null;this.motionTargetUnsupported=true;gl.bindFramebuffer(gl.FRAMEBUFFER,null);return false;
  }
 }
 ensureRefinementTarget(width,height){
  if(this.refinementTargetUnsupported)return false;
  const gl=this.gl;
  try{
   if(!this.refinementTarget){
    const texture=gl.createTexture(),framebuffer=gl.createFramebuffer();
    if(!texture||!framebuffer)throw new Error('Refinement target allocation failed.');
    this.refinementTarget={texture,framebuffer,width:0,height:0};
    gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,texture);
    for(const [name,value] of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,name,value);
   }
   const target=this.refinementTarget;gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);
   if(target.width!==width||target.height!==height){
    gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,target.texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target.texture,0);
    target.width=width;target.height=height;
    this.ensureSceneDepth(target,width,height);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Refinement target is unavailable.');
   }
   this.ensureSceneDepth(target,width,height);
   return true;
  }catch{
   if(this.refinementTarget){gl.deleteTexture(this.refinementTarget.texture);if(this.refinementTarget.depthTexture)gl.deleteTexture(this.refinementTarget.depthTexture);gl.deleteFramebuffer(this.refinementTarget.framebuffer);}
   this.refinementTarget=null;this.refinementTargetUnsupported=true;gl.bindFramebuffer(gl.FRAMEBUFFER,null);return false;
  }
 }
 compositeScene(texture,w,h,b,aspect,depthTexture=null){
  const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);
  this.prepareSceneDepth();
  this.bindSceneUniforms(this.compositeProgram,this.compositeUniforms,w,h,b,aspect,false);
  gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(this.compositeUniforms.sceneTexture,5);
  gl.activeTexture(gl.TEXTURE0+14);gl.bindTexture(gl.TEXTURE_2D,depthTexture||this.capTexture);
  gl.uniform1i(this.compositeUniforms.sceneDepthTexture,14);gl.uniform1i(this.compositeUniforms.sceneDepthReady,depthTexture&&this.contextLayer?1:0);
  gl.drawArrays(gl.TRIANGLES,0,3);
 }
 refineScene(w,h,b,aspect){
  if(!this.ensureRefinementTarget(w,h))return false;
  const gl=this.gl,revision=this.viewRevision||0;
  if(!this.refinement||this.refinement.revision!==revision||this.refinement.width!==w||this.refinement.height!==h){
   this.refinement={revision,width:w,height:h,nextRow:0};
  }
  const state=this.refinement,budget=Math.min(160000,this.interactionPixels||160000,this.refinementPixels||160000);
  const rows=Math.min(h-state.nextRow,Math.max(1,Math.floor(budget/w))),workPixels=w*rows;
  // Full viewport/uniform coordinates preserve the exact source rays. Only
  // raster work is bounded; unfinished bands never reach the visible canvas.
  gl.viewport(0,0,w,h);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,state.nextRow,w,rows);
  this.prepareSceneDepth();
  const accelerated=this.bindSceneUniforms(this.program,this.uniforms,w,h,b,aspect,false);
  let query=null;if(this.timerExtension&&this.gpuQueries.length<4){query=gl.createQuery();gl.beginQuery(this.timerExtension.TIME_ELAPSED_EXT,query);}
  try{gl.drawArrays(gl.TRIANGLES,0,3);}finally{gl.disable(gl.SCISSOR_TEST);}
  state.nextRow+=rows;const complete=state.nextRow>=h;
  if(complete){
   this.compositeScene(this.refinementTarget.texture,w,h,b,aspect,this.refinementTarget.depthTexture);
   this.drawContextLayer(w,h,b,aspect);
   this.completedRevision=revision;this.refineRequested=false;this.refinement=null;
  }else gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  const fullResolutionCap=this.settings.mode===0&&this.settings.clipAxis>=0;
  this.renderStats={outputWidth:w,outputHeight:h,volumeWidth:w,volumeHeight:h,outputPixels:w*h,volumePixels:workPixels,
   capPixels:fullResolutionCap?w*h:0,fullResolutionCap,composite:complete,passes:complete?2:1,motion:false,
   refining:!complete,presented:complete,workPixels,refinementRows:state.nextRow,refinementTotalRows:h,
   targetBytes:(this.motionTarget?this.motionTarget.width*this.motionTarget.height*4:0)+w*h*4};
  if(query){gl.endQuery(this.timerExtension.TIME_ELAPSED_EXT);this.gpuQueries.push({query,pixels:workPixels,outputPixels:w*h,fullResolutionCap,accelerated,kind:'refinement'});}
  this.finishGpuFrame(workPixels,'refinement');if(!complete)this.queueFrame();return true;
 }
 render(forceHigh=false){
  if(!this.loaded)return;
  const gl=this.gl,c=this.canvas,s=this.settings,rect=c.getBoundingClientRect();if(rect.width<2||rect.height<2)return;
  if(forceHigh){
   // A snapshot supersedes queued idle bands. Do not let their old callback
   // repaint a coarse preview over the completed capture on the next frame.
   if(this.pending)globalThis.cancelAnimationFrame?.(this.pending);this.pending=0;
   clearTimeout(this.refineTimer);this.refineRequested=false;this.refinement=null;
  }
  this.pollGpuTimers();
  // Keep at most one ordinary frame in flight. New input replaces queued view
  // state instead of building up a backlog of expensive old GPU frames.
  if(this.renderFence){const state=gl.clientWaitSync(this.renderFence,0,0);
   if(!forceHigh&&state===gl.TIMEOUT_EXPIRED){this.noteBusyFence();this.queueFrame();return;}
   gl.deleteSync(this.renderFence);this.renderFence=null;
  }
  this.uploadCapData();
  const key=cameraKey(this.camera),cameraMoved=this.requestedCameraKey!==undefined&&this.requestedCameraKey!==key;
  // Auto-rotation cannot overrule active section input. Resume its native
  // camera grid after the same short interaction interval used by the viewer.
  const rotatingWhileScrubbing=this.autoRotate&&this.cameraQuality===false&&performance.now()-(this.lastSceneChange??-Infinity)<170;
  if((cameraMoved||this.autoRotate)&&!rotatingWhileScrubbing){this.cameraQuality=true;this.sectionQuality=false;}
  this.requestedCameraKey=key;
  const active=this.interacting||this.autoRotate||(performance.now()-(this.lastInteraction||0)<170);
  const fineSurfaceActive=!!this.fineSurface?.activeFor(this);
  const outputProfile=s.mode===0&&this.renderProfile==='reconstruction'?'reconstruction':'interactive';
  const resourcePolicy=this.resourcePolicy||getDeviceResourcePolicy();
  const maxPixels=renderOutputPixelBudget(s.quality,outputProfile,fineSurfaceActive,resourcePolicy);
  // Camera gestures and orthogonal surface sections retain the actual ray grid.
  // Oblique/volumetric work keeps its bounded scene and full-output cut face.
  const outputRatio=Math.min(window.devicePixelRatio||1,resourcePolicy.maxPixelRatio,Math.sqrt(maxPixels/(rect.width*rect.height)));
  const w=Math.max(2,Math.round(rect.width*outputRatio)),h=Math.max(2,Math.round(rect.height*outputRatio));
  if(c.width!==w||c.height!==h){c.width=w;c.height=h;this.displayedRevision=-1;this.completedRevision=undefined;this.refinement=null;}
  const aspect=rect.width/rect.height,b=this.basis(),revision=this.viewRevision||0;
  // Optional offline fine isosurface: native output grid throughout movement.
  // Its geometry is fixed to the measured extraction threshold. Other display
  // modes/thresholds keep the original scalar renderer and its current cap.
  if(fineSurfaceActive){
   clearTimeout(this.refineTimer);this.refineRequested=false;this.refinement=null;
   let drawn=false;
   try{this.fineSurface.draw(this,w,h,b,aspect);drawn=true;}
   catch(error){
    // Optional mesh resources must not take away the existing usable viewer.
    this.fineSurface.enabled=false;gl.bindVertexArray(null);gl.disable(gl.DEPTH_TEST);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    this.completedRevision=undefined;this.fineSurface.onError?.(error);
   }
   if(drawn){
   this.drawContextLayer(w,h,b,aspect);
   this.displayedRevision=revision;this.completedRevision=revision;
   this.renderStats={outputWidth:w,outputHeight:h,volumeWidth:w,volumeHeight:h,outputPixels:w*h,volumePixels:0,
    fullResolutionCap:s.clipAxis>=0,capPixels:s.clipAxis>=0?w*h:0,meshTriangles:this.fineSurface.indexCount/3,
    fineSurface:true,cameraQuality:true,presented:true,motion:Boolean(active),passes:3,
    outputProfile,maxOutputPixels:maxPixels,outputPixelRatio:outputRatio};
   this.canvas.dataset.rendered='true';
   if(!forceHigh)this.finishGpuFrame(w*h,'camera');
   if(this.autoRotate){const now=performance.now();this.camera.yaw+=Math.min(100,now-(this.lastFrame||now))*.00018;this.lastFrame=now;this.queueFrame();}
   return;
   }
  }
  // Releasing the pointer or a completed idle timer must not redraw a cheap
  // preview over a sharp camera frame. The pending latest pose still runs once.
  if(!forceHigh&&!this.autoRotate&&!cameraMoved&&this.completedRevision===revision){this.refineRequested=false;return;}
  if(!forceHigh&&!active&&s.quality!=='low'&&this.refineRequested&&this.displayedRevision===revision&&this.completedRevision!==revision){
   if(this.refineScene(w,h,b,aspect))return;
   // An unavailable optional refinement target keeps the usable sharp-cap
   // preview. A deliberate snapshot still supports a complete single pass.
   this.refineRequested=false;
  }
  // Startup and oblique/volumetric edits keep bounded work and idle refinement.
  // Orthogonal surface cuts use the same rays as the finished image. The
  // one-frame fence coalesces scrolls and cap arrivals to the newest state;
  // no stale cut geometry is reused and no expensive frame queue is built.
  const cameraFrame=!forceHigh&&this.cameraQuality===true;
  const sectionFrame=!forceHigh&&this.sectionQuality===true;
  const budget=forceHigh||cameraFrame||sectionFrame?maxPixels:Math.min(maxPixels,this.interactionPixels||160000);
  const volumeRatio=Math.min(outputRatio,Math.sqrt(budget/(rect.width*rect.height)));
  let vw=Math.max(2,Math.round(rect.width*volumeRatio)),vh=Math.max(2,Math.round(rect.height*volumeRatio));
  const composite=(vw<w||vh<h)&&this.ensureMotionTarget(vw,vh);
  if(!composite){vw=w;vh=h;gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
  gl.viewport(0,0,vw,vh);
  this.prepareSceneDepth();
  const accelerated=this.bindSceneUniforms(this.program,this.uniforms,vw,vh,b,aspect,composite);
  let query=null;if(this.timerExtension&&this.gpuQueries.length<4){query=gl.createQuery();gl.beginQuery(this.timerExtension.TIME_ELAPSED_EXT,query);}
  gl.drawArrays(gl.TRIANGLES,0,3);
  if(composite){
   this.compositeScene(this.motionTarget.texture,w,h,b,aspect,this.motionTarget.depthTexture);
  }
  this.drawContextLayer(w,h,b,aspect);
  const fullResolutionCap=s.mode===0&&s.clipAxis>=0;
  this.displayedRevision=revision;this.refinement=null;
  if(!composite){this.completedRevision=revision;this.refineRequested=false;}
  else this.completedRevision=undefined;
  this.renderStats={outputWidth:w,outputHeight:h,volumeWidth:vw,volumeHeight:vh,outputPixels:w*h,
   volumePixels:vw*vh,capPixels:fullResolutionCap?w*h:0,fullResolutionCap,composite:Boolean(composite),
   passes:composite?2:1,motion:Boolean(active),cameraQuality:cameraFrame,sectionQuality:sectionFrame,presented:true,refining:false,workPixels:vw*vh,
   capSource:this.cap?'prepared-image':'resident-volume',targetBytes:(this.motionTarget?this.motionTarget.width*this.motionTarget.height*4:0)+(this.refinementTarget?this.refinementTarget.width*this.refinementTarget.height*4:0),
   outputProfile,maxOutputPixels:maxPixels,outputPixelRatio:outputRatio};
  const kind=forceHigh?'snapshot':cameraFrame?'camera':sectionFrame?'section':'preview';
  if(query){gl.endQuery(this.timerExtension.TIME_ELAPSED_EXT);this.gpuQueries.push({query,pixels:vw*vh,outputPixels:w*h,fullResolutionCap,accelerated,kind});}
  if(!forceHigh)this.finishGpuFrame(vw*vh,kind);
  this.canvas.dataset.rendered='true';
  if(this.autoRotate){const now=performance.now();this.camera.yaw+=(Math.min(100,now-(this.lastFrame||now))*.00018);this.lastFrame=now;this.queueFrame();}else{this.lastFrame=0;if(!forceHigh&&this.refineRequested&&!active&&composite)this.queueFrame();}
 }
 snapshot(){this.render(true);return this.canvas.toDataURL('image/png');}
}
