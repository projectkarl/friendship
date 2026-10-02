from __future__ import annotations
import io, json, math, struct
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageEnhance

ROOT = Path('/mnt/data/NEULI_v0.4_REAL_AVATAR')
REF = ROOT / 'tools/reference/haneul_reference.png'
OUT = ROOT / 'public/assets/haneul.glb'
SKIN_PREVIEW = ROOT / 'tools/output/haneul_skin_preview.png'

# ---------- texture ----------
def build_skin_texture() -> bytes:
    ref = Image.open(REF).convert('RGB')
    w,h = ref.size
    # crop the generated Haneul face, then partially symmetrize for an equirectangular head texture
    crop = ref.crop((int(w*.24), int(h*.09), int(w*.72), int(h*.49)))
    crop = ImageOps.fit(crop, (760,760), method=Image.Resampling.LANCZOS, centering=(.5,.48))
    # Keep the original generated face; mirroring a tilted single view creates ghost features.
    crop = crop.rotate(-6.0, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(232,198,188))
    crop = ImageEnhance.Color(crop).enhance(.92)
    crop = ImageEnhance.Contrast(crop).enhance(.96)

    tex = Image.new('RGB', (2048,1024), (232,198,188))
    # subtle vertical skin gradient
    arr=np.array(tex).astype(np.float32)
    yy=np.linspace(0,1,1024)[:,None,None]
    grad=np.array([[[12,9,8]]],dtype=np.float32)*(0.5-np.abs(yy-.5))*0.30
    arr=np.clip(arr+grad,0,255).astype(np.uint8)
    tex=Image.fromarray(arr,'RGB')

    face = crop.resize((760,760), Image.Resampling.LANCZOS)
    mask = Image.new('L', face.size, 0)
    from PIL import ImageDraw
    d=ImageDraw.Draw(mask)
    d.ellipse((55,18,705,750), fill=235)
    mask=mask.filter(ImageFilter.GaussianBlur(54))
    tex.paste(face,(644,122),mask)

    # feather the side/back toward a warm neutral skin color
    tex=tex.filter(ImageFilter.GaussianBlur(.28))
    tex.save(SKIN_PREVIEW)
    buf=io.BytesIO(); tex.save(buf, format='PNG', optimize=True)
    return buf.getvalue()

# ---------- geometry helpers ----------
def compute_normals(pos: np.ndarray, faces: np.ndarray) -> np.ndarray:
    n=np.zeros_like(pos,dtype=np.float64)
    p0=pos[faces[:,0]]; p1=pos[faces[:,1]]; p2=pos[faces[:,2]]
    fn=np.cross(p1-p0,p2-p0)
    ln=np.linalg.norm(fn,axis=1,keepdims=True); fn=fn/np.maximum(ln,1e-12)
    for k in range(3): np.add.at(n, faces[:,k], fn)
    ln=np.linalg.norm(n,axis=1,keepdims=True)
    return (n/np.maximum(ln,1e-12)).astype(np.float32)

def uv_sphere(seg_u=128, seg_v=96):
    pos=[]; uv=[]
    for j in range(seg_v+1):
        v=j/seg_v; theta=v*math.pi
        st,ct=math.sin(theta),math.cos(theta)
        y=.92*ct
        for i in range(seg_u+1):
            u=i/seg_u; phi=(u-.5)*2*math.pi
            x=.72*st*math.sin(phi); z=.66*st*math.cos(phi)
            # feminine face proportions: taper jaw/chin, fuller upper cheeks, flatter back
            if y < .10:
                taper=1.0-0.22*min(1,max(0,(-y+.05)/.92))
                x*=taper
            cheek=1+.055*math.exp(-((y+.02)/.26)**2)*math.exp(-((abs(phi)-.56)/.72)**2)
            x*=cheek
            if y < -.56:
                x*=.88 + .12*((y+.92)/.36)
                z+=.035*(1-(abs(x)/.45)**2 if abs(x)<.45 else 0)
            if z<0: z*=.88
            # soften forehead / temple
            if y>.45: x*=.96
            pos.append((x,y,z)); uv.append((u,1-v))
    faces=[]
    stride=seg_u+1
    for j in range(seg_v):
        for i in range(seg_u):
            a=j*stride+i; b=a+1; c=(j+1)*stride+i; d=c+1
            faces += [(a,c,b),(b,c,d)]
    pos=np.array(pos,np.float32); faces=np.array(faces,np.uint32); uv=np.array(uv,np.float32)
    normals=compute_normals(pos,faces)
    return pos,normals,uv,faces

def head_morphs(base: np.ndarray):
    out={}
    x,y,z=base[:,0],base[:,1],base[:,2]
    front=np.clip((z-.20)/.48,0,1)
    cheek=np.exp(-((np.abs(x)-.34)/.16)**2 - ((y+.06)/.20)**2)*front
    mouth=np.exp(-(x/.30)**2 - ((y+.34)/.16)**2)*front
    smile=np.zeros_like(base); smile[:,1]+=0.030*cheek; smile[:,0]+=np.sign(x)*0.012*cheek; smile[:,1]+=0.018*mouth*(np.abs(x)/.30)
    out['Smile']=smile.astype(np.float32)
    # subtle lower-face deformation complements the lip mesh visemes
    for name,open_amt,width,forward in [
        ('A',.045,.00,.006),('I',.010,.020,.000),('U',.022,-.018,.016),('E',.016,.016,.002),('O',.035,-.012,.014)]:
        d=np.zeros_like(base)
        d[:,1]-=open_amt*mouth*np.clip((-y-.20)/.40,0,1)
        d[:,0]+=np.sign(x)*width*mouth
        d[:,2]+=forward*mouth
        out[name]=d.astype(np.float32)
    return out

def ellipsoid(center, radii, seg_u=48, seg_v=32):
    cx,cy,cz=center; rx,ry,rz=radii
    pos=[]; uv=[]
    for j in range(seg_v+1):
        v=j/seg_v; th=v*math.pi; st,ct=math.sin(th),math.cos(th)
        for i in range(seg_u+1):
            u=i/seg_u; ph=(u-.5)*2*math.pi
            pos.append((cx+rx*st*math.sin(ph),cy+ry*ct,cz+rz*st*math.cos(ph)))
            uv.append((u,1-v))
    faces=[]; stride=seg_u+1
    for j in range(seg_v):
        for i in range(seg_u):
            a=j*stride+i;b=a+1;c=(j+1)*stride+i;d=c+1
            faces += [(a,c,b),(b,c,d)]
    pos=np.array(pos,np.float32); faces=np.array(faces,np.uint32)
    return pos,compute_normals(pos,faces),np.array(uv,np.float32),faces

def lips_mesh(seg_t=72, seg_s=10):
    def make(rx=.225, ry=.045, fwd=0.0):
        pts=[]
        for i in range(seg_t):
            t=2*math.pi*i/seg_t
            ct,st=math.cos(t),math.sin(t)
            cx=rx*ct; cy=-.345+ry*st
            for j in range(seg_s):
                s=2*math.pi*j/seg_s
                # slightly fuller lower lip
                thick=.020*(1.15 if st<0 else 1.0)
                pts.append((cx + thick*math.cos(s)*ct,
                            cy + thick*math.cos(s)*st,
                            .697+fwd + .018*math.sin(s)))
        return np.array(pts,np.float32)
    base=make()
    faces=[]
    for i in range(seg_t):
        ni=(i+1)%seg_t
        for j in range(seg_s):
            nj=(j+1)%seg_s
            a=i*seg_s+j;b=ni*seg_s+j;c=i*seg_s+nj;d=ni*seg_s+nj
            faces += [(a,b,c),(c,b,d)]
    faces=np.array(faces,np.uint32)
    normals=compute_normals(base,faces)
    uv=[]
    for i in range(seg_t):
        for j in range(seg_s): uv.append((i/seg_t,j/seg_s))
    uv=np.array(uv,np.float32)
    morph={}
    targets={'Smile':(.255,.034,0.0),'A':(.205,.100,.006),'I':(.265,.030,0.0),'U':(.145,.055,.025),'E':(.255,.043,.002),'O':(.145,.105,.024)}
    for name,(rx,ry,fwd) in targets.items():
        targ=make(rx,ry,fwd)
        if name=='Smile':
            for i in range(seg_t):
                t=2*math.pi*i/seg_t; lift=.045*(abs(math.cos(t))**2)
                targ[i*seg_s:(i+1)*seg_s,1]+=lift
        morph[name]=(targ-base).astype(np.float32)
    return base,normals,uv,faces,morph

def eyelid_mesh(cx: float):
    # skin ribbon above each eye; Blink morph moves/expands it down over the eyeball
    cols=28; rows=3; pts=[]; uv=[]
    for r in range(rows):
        fr=r/(rows-1)
        for i in range(cols):
            t=i/(cols-1)
            x=cx + (t-.5)*.35
            arch=.16 + .035*(1-((t-.5)/.5)**2)
            y=arch - fr*.025
            z=.655 - ((t-.5)**2)*.018 + fr*.008
            pts.append((x,y,z)); uv.append((t,fr))
    faces=[]
    for r in range(rows-1):
        for i in range(cols-1):
            a=r*cols+i;b=a+1;c=(r+1)*cols+i;d=c+1
            faces += [(a,c,b),(b,c,d)]
    pts=np.array(pts,np.float32); faces=np.array(faces,np.uint32); uv=np.array(uv,np.float32)
    normals=compute_normals(pts,faces)
    target=pts.copy()
    for r in range(rows):
        fr=r/(rows-1)
        for i in range(cols):
            idx=r*cols+i; t=i/(cols-1)
            target[idx,1]=.08-fr*.11 + .015*(1-((t-.5)/.5)**2)
            target[idx,2]=.665 + fr*.015
    return pts,normals,uv,faces,(target-pts).astype(np.float32)

def hair_cards(n=52, seg=9):
    verts=[]; uvs=[]; faces=[]
    rng=np.random.default_rng(37)
    card=0
    # long side/back strands
    for side in (-1,1):
        for k in range(n//2):
            a=(k/(n//2-1))*1.15 + .42
            x0=side*(.32+.26*math.sin(a)); z0=.05+.52*math.cos(a)
            y0=.78+.45*math.cos((k/(n//2-1))*.9)
            length=1.55+rng.uniform(-.15,.15)
            width=.050+rng.uniform(-.010,.012)
            start=len(verts)
            for s in range(seg+1):
                t=s/seg
                y=y0-length*t
                wave=.055*math.sin(t*5.0+k*.63)
                x=x0 + side*(.08*t)+wave
                z=z0-.10*t+.025*math.sin(t*3+k)
                verts += [(x-width,y,z),(x+width,y,z+.006)]
                uvs += [(0,t),(1,t)]
            for s in range(seg):
                a0=start+s*2; b=a0+1;c=a0+2;d=a0+3
                faces += [(a0,c,b),(b,c,d)]
            card+=1
    # front bangs
    for k in range(18):
        t0=k/17; x0=(t0-.5)*.65; y0=.78+.08*math.cos((t0-.5)*math.pi); z0=.50+.10*(1-abs(t0-.5)*2)
        length=.42+.12*abs(t0-.5)*2; width=.028
        start=len(verts)
        for s in range(7):
            t=s/6; x=x0+.06*math.sin(t*2.8+(k%3)); y=y0-length*t; z=z0+.035*t
            verts += [(x-width,y,z),(x+width,y,z+.004)]; uvs += [(0,t),(1,t)]
        for s in range(6):
            a0=start+s*2;b=a0+1;c=a0+2;d=a0+3;faces += [(a0,c,b),(b,c,d)]
    verts=np.array(verts,np.float32); faces=np.array(faces,np.uint32); uvs=np.array(uvs,np.float32)
    normals=compute_normals(verts,faces)
    return verts,normals,uvs,faces

def torso_mesh(radial=72, rings=28):
    ys=np.linspace(-1.66,.47,rings)
    pos=[]; uv=[]; joints=[]; weights=[]
    for j,y in enumerate(ys):
        t=(y-ys[0])/(ys[-1]-ys[0])
        # shoulder/chest silhouette, modest knit top
        rx=.57 + .20*math.sin(math.pi*t) + .10*math.exp(-((y-.18)/.28)**2)
        rz=.32 + .08*math.sin(math.pi*t)
        for i in range(radial):
            a=2*math.pi*i/radial
            x=rx*math.cos(a); z=rz*math.sin(a)-.05
            pos.append((x,y,z)); uv.append((i/radial,t))
            # Hips(0), Spine(1), Chest(2), Neck(3)
            if y < -.85:
                f=np.clip((y+1.66)/.81,0,1); js=[0,1,0,0]; ws=[1-f,f,0,0]
            elif y < -.12:
                f=np.clip((y+.85)/.73,0,1); js=[1,2,0,0]; ws=[1-f,f,0,0]
            else:
                f=np.clip((y+.12)/.59,0,1); js=[2,3,0,0]; ws=[1-f,f,0,0]
            joints.append(js); weights.append(ws)
    faces=[]
    for j in range(rings-1):
        for i in range(radial):
            ni=(i+1)%radial; a=j*radial+i;b=j*radial+ni;c=(j+1)*radial+i;d=(j+1)*radial+ni
            faces += [(a,c,b),(b,c,d)]
    pos=np.array(pos,np.float32); faces=np.array(faces,np.uint32)
    return pos,compute_normals(pos,faces),np.array(uv,np.float32),faces,np.array(joints,np.uint16),np.array(weights,np.float32)

# ---------- GLB builder ----------
class GLB:
    def __init__(self):
        self.bin=bytearray(); self.views=[]; self.acc=[]
    def align(self):
        while len(self.bin)%4: self.bin.append(0)
    def view(self,data: bytes,target=None):
        self.align(); off=len(self.bin); self.bin.extend(data); idx=len(self.views)
        d={'buffer':0,'byteOffset':off,'byteLength':len(data)}
        if target: d['target']=target
        self.views.append(d); return idx
    def accessor(self,arr,ctype,type_,target=None,minmax=True,normalized=False):
        arr=np.ascontiguousarray(arr)
        vi=self.view(arr.tobytes(),target)
        count=arr.shape[0] if arr.ndim>1 else arr.size
        ac={'bufferView':vi,'byteOffset':0,'componentType':ctype,'count':int(count),'type':type_}
        if normalized: ac['normalized']=True
        if minmax and type_ in ('SCALAR','VEC2','VEC3','VEC4'):
            a=arr.reshape(count,-1)
            ac['min']=a.min(0).astype(float).tolist(); ac['max']=a.max(0).astype(float).tolist()
        idx=len(self.acc); self.acc.append(ac); return idx

def mat4_inv_translation(y):
    m=np.eye(4,dtype=np.float32); m[1,3]=-y; return m.T.reshape(-1) # glTF column-major bytes

def build_glb():
    skin_png=build_skin_texture()
    b=GLB()

    # Materials
    mats=[
      {'name':'Skin_PBR','pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':0.0,'roughnessFactor':0.48},'doubleSided':False},
      {'name':'Hair','pbrMetallicRoughness':{'baseColorFactor':[.085,.047,.052,1],'metallicFactor':0.0,'roughnessFactor':0.34},'doubleSided':True},
      {'name':'EyeWhite','pbrMetallicRoughness':{'baseColorFactor':[.98,.97,.95,1],'metallicFactor':0.0,'roughnessFactor':0.22}},
      {'name':'Iris','pbrMetallicRoughness':{'baseColorFactor':[.20,.10,.055,1],'metallicFactor':0.0,'roughnessFactor':0.18}},
      {'name':'Pupil','pbrMetallicRoughness':{'baseColorFactor':[.006,.004,.004,1],'metallicFactor':0.0,'roughnessFactor':0.15}},
      {'name':'Lips','pbrMetallicRoughness':{'baseColorFactor':[.66,.25,.28,1],'metallicFactor':0.0,'roughnessFactor':0.28}},
      {'name':'Mouth','pbrMetallicRoughness':{'baseColorFactor':[.10,.025,.035,1],'metallicFactor':0.0,'roughnessFactor':0.76}},
      {'name':'Top','pbrMetallicRoughness':{'baseColorFactor':[.84,.78,.69,1],'metallicFactor':0.0,'roughnessFactor':0.78}},
      {'name':'Brow','pbrMetallicRoughness':{'baseColorFactor':[.13,.075,.07,1],'metallicFactor':0.0,'roughnessFactor':0.7},'doubleSided':True},
    ]
    # embed skin texture
    img_view=b.view(skin_png)
    images=[{'name':'HaneulSkin','bufferView':img_view,'mimeType':'image/png'}]
    samplers=[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}]
    textures=[{'sampler':0,'source':0}]
    mats[0]['pbrMetallicRoughness']['baseColorTexture']={'index':0,'texCoord':0}

    meshes=[]; nodes=[]
    def add_mesh(name,pos,nrm,uv,idx,mat,morphs=None,joints=None,weights=None):
        attrs={
          'POSITION':b.accessor(pos,np_to_comp(pos.dtype),'VEC3',34962),
          'NORMAL':b.accessor(nrm,5126,'VEC3',34962),
          'TEXCOORD_0':b.accessor(uv,5126,'VEC2',34962)
        }
        if joints is not None:
            attrs['JOINTS_0']=b.accessor(joints,5123,'VEC4',34962,minmax=False)
            attrs['WEIGHTS_0']=b.accessor(weights,5126,'VEC4',34962,minmax=False)
        prim={'attributes':attrs,'indices':b.accessor(idx.reshape(-1),5125,'SCALAR',34963),'material':mat}
        mesh={'name':name,'primitives':[prim]}
        if morphs:
            targets=[]; names=[]
            for mn,delta in morphs.items():
                targets.append({'POSITION':b.accessor(delta.astype(np.float32),5126,'VEC3',34962,minmax=False)})
                names.append(mn)
            prim['targets']=targets; mesh['weights']=[0.0]*len(targets); mesh['extras']={'targetNames':names}
        mi=len(meshes); meshes.append(mesh); return mi

    def np_to_comp(dtype):
        if np.dtype(dtype)==np.float32: return 5126
        if np.dtype(dtype)==np.uint32: return 5125
        if np.dtype(dtype)==np.uint16: return 5123
        raise ValueError(dtype)

    # skeleton nodes first
    bone_defs=[
      ('Hips',None,[0,-1.55,0]),
      ('Spine',0,[0,.60,0]),
      ('Chest',1,[0,.65,0]),
      ('Neck',2,[0,.62,0]),
      ('Head',3,[0,.52,0]),
      ('LeftShoulder',2,[-.52,.38,0]),('LeftUpperArm',5,[-.45,-.05,0]),
      ('RightShoulder',2,[.52,.38,0]),('RightUpperArm',7,[.45,-.05,0]),
    ]
    bone_nodes=[]
    for name,parent,tr in bone_defs:
        idx=len(nodes); nodes.append({'name':name,'translation':tr}); bone_nodes.append(idx)
        if parent is not None:
            nodes[bone_nodes[parent]].setdefault('children',[]).append(idx)
    # Hips will be scene root; add meshes as its children or head children

    # torso skinned mesh
    p,n,u,f,j,w=torso_mesh(); torso_m=add_mesh('Haneul_Torso',p,n,u,f,7,joints=j,weights=w)
    torso_node=len(nodes); nodes.append({'name':'BodyMesh','mesh':torso_m,'skin':0})

    # head + morphs local to head bone
    p,n,u,f=uv_sphere(); hm=head_morphs(p); head_m=add_mesh('Haneul_Head',p,n,u,f,0,hm)
    head_node=len(nodes); nodes.append({'name':'FaceMesh','mesh':head_m,'translation':[0,.42,0]}); nodes[bone_nodes[4]].setdefault('children',[]).append(head_node)

    # eyes local to head bone
    eye_nodes=[]
    for side,cx in [('L',-.255),('R',.255)]:
        p,n,u,f=ellipsoid((cx,.47,.585),(.165,.105,.095),48,28); mi=add_mesh(f'EyeWhite_{side}',p,n,u,f,2)
        ni=len(nodes); nodes.append({'name':f'EyeWhite_{side}','mesh':mi}); nodes[bone_nodes[4]].setdefault('children',[]).append(ni); eye_nodes.append(ni)
        p,n,u,f=ellipsoid((cx,.47,.668),(.074,.074,.025),36,22); mi=add_mesh(f'Iris_{side}',p,n,u,f,3)
        ni=len(nodes); nodes.append({'name':f'Iris_{side}','mesh':mi}); nodes[bone_nodes[4]].setdefault('children',[]).append(ni)
        p,n,u,f=ellipsoid((cx,.47,.691),(.028,.028,.012),24,16); mi=add_mesh(f'Pupil_{side}',p,n,u,f,4)
        ni=len(nodes); nodes.append({'name':f'Pupil_{side}','mesh':mi}); nodes[bone_nodes[4]].setdefault('children',[]).append(ni)
        p,n,u,f,blink=eyelid_mesh(cx); mi=add_mesh(f'Eyelid_{side}',p,n,u,f,0,{'Blink':blink})
        ni=len(nodes); nodes.append({'name':f'Eyelid_{side}','mesh':mi}); nodes[bone_nodes[4]].setdefault('children',[]).append(ni)

    # lips and mouth cavity
    p,n,u,f,m=lips_mesh(); mi=add_mesh('Mouth_Lips',p,n,u,f,5,m); ni=len(nodes); nodes.append({'name':'MouthLips','mesh':mi}); nodes[bone_nodes[4]].setdefault('children',[]).append(ni)
    p,n,u,f=ellipsoid((0,-.345,.675),(.18,.063,.022),36,18); mi=add_mesh('Mouth_Cavity',p,n,u,f,6); ni=len(nodes); nodes.append({'name':'MouthCavity','mesh':mi}); nodes[bone_nodes[4]].setdefault('children',[]).append(ni)

    # nose as actual geometry
    p,n,u,f=ellipsoid((0,.20,.676),(.085,.16,.09),36,22); mi=add_mesh('Nose',p,n,u,f,0); ni=len(nodes); nodes.append({'name':'Nose','mesh':mi}); nodes[bone_nodes[4]].setdefault('children',[]).append(ni)

    # brows as slim ribbons
    for side,cx in [('L',-.255),('R',.255)]:
        verts=[]; uvs=[]; faces=[]; cols=30
        for r in range(2):
            for i in range(cols):
                t=i/(cols-1); x=cx+(t-.5)*.32; y=.69+.025*(1-((t-.5)/.5)**2)-r*.018; z=.632+r*.004
                verts.append((x,y,z)); uvs.append((t,r))
        for i in range(cols-1):
            a=i;bb=i+1;c=cols+i;d=c+1; faces += [(a,c,bb),(bb,c,d)]
        verts=np.array(verts,np.float32); faces=np.array(faces,np.uint32); uvs=np.array(uvs,np.float32); n=compute_normals(verts,faces)
        mi=add_mesh(f'Brow_{side}',verts,n,uvs,faces,8); ni=len(nodes); nodes.append({'name':f'Brow_{side}','mesh':mi}); nodes[bone_nodes[4]].setdefault('children',[]).append(ni)

    # hair cap + hair cards
    p,n,u,f=ellipsoid((0,.52,-.055),(.79,1.00,.69),72,52); mi=add_mesh('HairCap',p,n,u,f,1); ni=len(nodes); nodes.append({'name':'HairCap','mesh':mi}); nodes[bone_nodes[4]].setdefault('children',[]).append(ni)
    p,n,u,f=hair_cards(); mi=add_mesh('HairCards',p,n,u,f,1); ni=len(nodes); nodes.append({'name':'HairCards','mesh':mi}); nodes[bone_nodes[4]].setdefault('children',[]).append(ni)

    # inverse bind matrices for 9 joints (global y / x computed by hierarchy)
    global_pos=[]
    for idx,(name,parent,tr) in enumerate(bone_defs):
        tr=np.array(tr,float)
        if parent is None: gp=tr
        else: gp=global_pos[parent]+tr
        global_pos.append(gp)
    ib=[]
    for gp in global_pos:
        M=np.eye(4,dtype=np.float32); M[:3,3]=-gp
        ib.append(M.T.reshape(-1))
    ib=np.array(ib,np.float32)
    ib_acc=b.accessor(ib,5126,'MAT4',34962,minmax=False)
    skins=[{'name':'HaneulRig','inverseBindMatrices':ib_acc,'skeleton':bone_nodes[0],'joints':bone_nodes}]

    scene_roots=[bone_nodes[0], torso_node]
    gltf={
      'asset':{'version':'2.0','generator':'NEULI Haneul single-view reconstruction v0.4','extras':{'character':'Haneul','age':23,'note':'Generated fictional adult character; single-view reference reconstruction'}},
      'scene':0,'scenes':[{'name':'HaneulScene','nodes':scene_roots}],
      'nodes':nodes,'meshes':meshes,'skins':skins,'materials':mats,'images':images,'textures':textures,'samplers':samplers,
      'bufferViews':b.views,'accessors':b.acc,'buffers':[{'byteLength':0}],
      'extensionsUsed':[]
    }
    b.align(); gltf['buffers'][0]['byteLength']=len(b.bin)
    js=json.dumps(gltf,separators=(',',':'),ensure_ascii=False).encode('utf-8')
    while len(js)%4: js+=b' '
    binchunk=bytes(b.bin)
    while len(binchunk)%4: binchunk+=b'\x00'
    total=12+8+len(js)+8+len(binchunk)
    out=bytearray(struct.pack('<4sII',b'glTF',2,total))
    out += struct.pack('<I4s',len(js),b'JSON') + js
    out += struct.pack('<I4s',len(binchunk),b'BIN\x00') + binchunk
    OUT.write_bytes(out)
    return {'path':str(OUT),'bytes':len(out),'meshes':len(meshes),'nodes':len(nodes),'accessors':len(b.acc),'triangles':int(sum((b.acc[p['indices']]['count']//3) for m in meshes for p in m['primitives']))}

if __name__=='__main__':
    info=build_glb(); print(json.dumps(info,ensure_ascii=False,indent=2))
