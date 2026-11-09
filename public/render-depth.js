/** The same perspective depth convention is used by measured surfaces, source
 * rays, cut faces and spatial context. Coordinates are normalized donor units. */
export const SCENE_NEAR = .01;
export const SCENE_FAR = 10;
export const SCENE_DEPTH_GLSL = `
float sceneWindowDepth(float cameraDepth){
 return clamp(10./9.99-.1/(9.99*max(.000001,cameraDepth)),0.,1.);
}`;

export function sceneWindowDepth(cameraDepth){
 return Math.max(0,Math.min(1,SCENE_FAR/(SCENE_FAR-SCENE_NEAR)-SCENE_FAR*SCENE_NEAR/((SCENE_FAR-SCENE_NEAR)*Math.max(.000001,cameraDepth))));
}

export function sameDepthBasis(a,b,tolerance=1e-7){
 return Boolean(a&&b&&['eye','forward','right','up'].every(key=>a[key]?.length===3&&b[key]?.length===3&&a[key].every((v,i)=>Math.abs(v-b[key][i])<=tolerance)));
}
