"""Conservative camera culling for offline review; never edits runtime assets."""
import numpy as np

def unit(v):return v/np.linalg.norm(v)
def world_point(p):return (np.asarray(p,dtype=float)-[948,948,1058])[[0,2,1]]*[1,1,-1]/2116

def camera(case):
    axis=case['axis'];xyz=[948,948,1058];xyz[axis]=case['coordinate']
    normal=np.array([[1.,0,0],[0,0,-1.],[0,1.,0]][axis])
    planar_right=np.array([[0,0,-1.],[1.,0,0],[1.,0,0]][axis])
    planar_up=np.array([[0,-1.,0],[0,-1.,0],[0,0,1.]][axis])
    target=world_point(case['target'])
    direction=unit(np.array(case.get('direction',normal+.08*planar_right+.025*planar_up)))
    eye=target+direction*case['distance'];forward=unit(target-eye)
    right=unit(np.cross(forward,planar_up));up=unit(np.cross(right,forward))
    return dict(eye=eye,forward=forward,right=right,up=up,normal=normal,center=world_point(xyz))

def cull_review_triangles(arrays,case,width,height):
    """Drop a triangle only when all three vertices fail the same half-space.

    Production perspective has near=.01, far=10, fov=.32. The same source
    quantization bounds and camera basis are used. A positive safety margin
    keeps borderline triangles. Intersecting triangles and all normals,
    positions, vertex flags and source scalar textures stay unchanged.
    """
    view=camera(case);lo=np.asarray(arrays['bounds']['min']);span=np.asarray(arrays['bounds']['max'])-lo
    faces=arrays['indices'].reshape(-1,3);kept=[];epsilon=1e-5;fov=.32;aspect=width/height
    for start in range(0,len(faces),100_000):
        face=faces[start:start+100_000]
        points=lo+arrays['positions'][face].astype(np.float64)/65535*span
        d=points-view['eye'];x=d@view['right'];y=d@view['up'];z=d@view['forward']
        outside=np.all(z<.01-epsilon,axis=1)|np.all(z>10+epsilon,axis=1)
        outside|=np.all(x>z*fov*aspect+epsilon,axis=1)|np.all(x<-z*fov*aspect-epsilon,axis=1)
        outside|=np.all(y>z*fov+epsilon,axis=1)|np.all(y<-z*fov-epsilon,axis=1)
        if not case.get('whole',False):outside|=np.all((points-view['center'])@view['normal']>epsilon,axis=1)
        kept.append(face[~outside].copy())
    indices=np.concatenate(kept).ravel()
    receipt=dict(method='Conservative per-triangle view-frustum and retained-cut half-space rejection only.',
      sourceTriangles=len(faces),submittedTriangles=len(indices)//3,removedOffscreenOrClippedTriangles=len(faces)-len(indices)//3,
      sourceAttributesUnchanged=True,safetyMarginWorld=epsilon,camera=case)
    return {**arrays,'indices':indices,'indexCount':len(indices)},receipt
