/** Illustrative, smooth donor-space motion. This is not measured cardiac motion.
 * Geometry is sampled once. Connectivity, source values and source assets stay fixed.
 * The cavity-aware map is analytically orientation preserving at the allowed settings.
 */
export const RIG = Object.freeze({ base: -0.07, low: -0.10, high: 0.22, centerX: 0.055, centerZ: -0.045, axial: 0.10, radial: 0.44, radius: 0.145, twist: 0.22 });

export function cycleAmount(phase) {
  const t = ((phase % 1) + 1) % 1;
  if (t < .38) return Math.sin(Math.PI * t / .76) ** 2;
  if (t < .88) return Math.cos(Math.PI * (t - .38)) ** 2;
  return 0;
}

export function deformPoint(p, amount, mode = 2, twist = true) {
  if (!mode || !amount) return p.slice();
  const { base, low, high, centerX, centerZ, axial, radial, radius } = RIG;
  const v = Math.max(0, Math.min(1, (p[1] - low) / (high - low)));
  const w = v * v * v * (10 + v * (-15 + 6 * v)), wy = v > 0 && v < 1 ? 30 * v * v * (1 - v) ** 2 / (high - low) : 0;
  const y = p[1] - base, d = 1 - axial * amount * (w + y * wy);
  const x = p[0] - centerX, z = p[2] - centerZ, q = (x * x + z * z) / (radius * radius);
  const f = q < 1e-4 ? 1 - q / 2 + q * q / 6 : -Math.expm1(-q) / q;
  const k = mode === 1 ? 1 - .13 * amount * w : Math.sqrt((1 - radial * amount * w * f) / d);
  const angle = twist ? RIG.twist * amount * w : 0, c = Math.cos(angle), s = Math.sin(angle);
  return [centerX + k * (c * x - s * z), p[1] - axial * amount * w * y, centerZ + k * (s * x + c * z)];
}

export function jacobianDeterminant(p, amount, mode = 2) {
  if (!mode || !amount) return 1;
  const v = Math.max(0, Math.min(1, (p[1] - RIG.low) / (RIG.high - RIG.low)));
  const w = v * v * v * (10 + v * (-15 + 6 * v)), wy = v > 0 && v < 1 ? 30 * v * v * (1 - v) ** 2 / (RIG.high - RIG.low) : 0;
  const d = 1 - RIG.axial * amount * (w + (p[1] - RIG.base) * wy);
  if (mode === 1) return (1 - .13 * amount * w) ** 2 * d;
  const q = ((p[0] - RIG.centerX) ** 2 + (p[2] - RIG.centerZ) ** 2) / RIG.radius ** 2;
  return 1 - RIG.radial * amount * w * Math.exp(-q);
}

// Literal GLSL is shared by the browser renderer and the EGL verification.
export const fieldGLSL = `
void motion(vec3 p, vec3 n, out vec3 o, out vec3 normal){
 if(uMode==0 || uAmount==0.0){o=p;normal=n;return;}
 float v=clamp((p.y+0.10)/0.32,0.0,1.0);
 float w=v*v*v*(10.0+v*(-15.0+6.0*v));
 float wy=(v>0.0&&v<1.0)?30.0*v*v*(1.0-v)*(1.0-v)/0.32:0.0;
 float wyy=(v>0.0&&v<1.0)?60.0*v*(2.0*v*v-3.0*v+1.0)/(0.32*0.32):0.0;
 float y=p.y+0.07;
 float d=1.0-0.10*uAmount*(w+y*wy);
 float dy=-0.10*uAmount*(2.0*wy+y*wyy);
 vec2 xz=p.xz-vec2(0.055,-0.045);
 float q=dot(xz,xz)/(0.145*0.145);
 float e=exp(-q);
 float f=q<0.001?1.0-q/2.0+q*q/6.0:(1.0-e)/q;
 float fq=q<0.001?-0.5+q/3.0-q*q/8.0:(e*(q+1.0)-1.0)/(q*q);
 float b=0.44*uAmount*w,by=0.44*uAmount*wy;
 float k,kr,ky;
 if(uMode==1){k=1.0-0.13*uAmount*w;kr=0.0;ky=-0.13*uAmount*wy;}
 else{
  k=sqrt((1.0-b*f)/d);
  kr=-b*fq/(2.0*k*d*0.145*0.145);
  ky=(-by*f/d-(1.0-b*f)*dy/(d*d))/(2.0*k);
 }
 float angle=0.22*uAmount*w*uTwist,ay=0.22*uAmount*wy*uTwist;
 float c=cos(angle),s=sin(angle);
 vec2 r=vec2(c*xz.x-s*xz.y,s*xz.x+c*xz.y);
 o=vec3(0.055+k*r.x,p.y-0.10*uAmount*w*y,-0.045+k*r.y);
 vec3 jx=vec3(k*c+2.0*xz.x*kr*r.x,0.0,k*s+2.0*xz.x*kr*r.y);
 vec3 jy=vec3(ky*r.x-k*ay*r.y,d,ky*r.y+k*ay*r.x);
 vec3 jz=vec3(-k*s+2.0*xz.y*kr*r.x,0.0,k*c+2.0*xz.y*kr*r.y);
 normal=normalize(n.x*cross(jy,jz)+n.y*cross(jz,jx)+n.z*cross(jx,jy));
}
`;
