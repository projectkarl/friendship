"""Rebuild NEULI 2.5D facial/hair layers from haneul_cutout.png.
Runtime does not depend on Python; this is an authoring utility only.
"""
from PIL import Image, ImageFilter, ImageDraw
import numpy as np
import cv2
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public" / "assets"
SRC = ROOT / "haneul_cutout.png"
REGIONS = {
    "eye_left": (315, 305, 450, 395),
    "eye_right": (455, 270, 590, 360),
    "mouth": (385, 435, 565, 550),
}

def ellipse_mask(size, feather=8, inset=8):
    w, h = size
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    d.ellipse((inset, inset, w-inset-1, h-inset-1), fill=255)
    return m.filter(ImageFilter.GaussianBlur(feather))

def closed_eye(name, cy, rx, ry, slope):
    p = Image.open(ROOT / f"{name}.png").convert("RGBA")
    a = np.array(p).astype(np.float32)
    h, w = a.shape[:2]
    out = a.copy()
    yy, xx = np.mgrid[0:h, 0:w]
    ell = ((xx-w/2)/rx)**2 + ((yy-cy)/ry)**2
    mask = np.clip(1-(ell-.70)/.30, 0, 1)
    mask = np.where(ell < .70, 1, mask)
    top_y = max(0, int(cy-ry-7)); bot_y = min(h-1, int(cy+ry+7))
    top = np.mean(a[max(0,top_y-3):min(h,top_y+4),:,:3], axis=0)
    bottom = np.mean(a[max(0,bot_y-3):min(h,bot_y+4),:,:3], axis=0)
    t = np.clip((yy-(cy-ry))/(2*ry),0,1)[...,None]
    fill = top[None,:,:]*(1-t) + bottom[None,:,:]*t
    fill = np.array(Image.fromarray(np.uint8(np.clip(fill,0,255))).filter(ImageFilter.GaussianBlur(1.8))).astype(np.float32)
    m = mask[...,None]
    out[:,:,:3] = out[:,:,:3]*(1-m) + fill*m
    im = Image.fromarray(np.uint8(np.clip(out,0,255)))
    scale=4
    hi=im.resize((w*scale,h*scale),Image.Resampling.LANCZOS)
    d=ImageDraw.Draw(hi,"RGBA")
    pts=[]
    for x in np.linspace(w*.20,w*.82,120):
        tt=(x-w*.51)/(w*.33)
        y=cy+slope*(x-w*.5)+2.7*(tt*tt)
        pts.append((x*scale,y*scale))
    d.line(pts,fill=(78,46,45,165),width=scale)
    d.line([(x,y-.7*scale) for x,y in pts],fill=(45,28,30,55),width=scale)
    hi.resize((w,h),Image.Resampling.LANCZOS).save(ROOT / f"{name}_closed.png")

def main():
    img = Image.open(SRC).convert("RGBA")
    arr = np.array(img)
    H, W = arr.shape[:2]
    for name, box in REGIONS.items():
        crop = img.crop(box)
        ma = np.array(ellipse_mask(crop.size, 8, 8 if "eye" in name else 10), dtype=np.uint8)
        ca = np.array(crop)
        ca[:,:,3] = (ca[:,:,3].astype(np.uint16)*ma.astype(np.uint16)//255).astype(np.uint8)
        Image.fromarray(ca).save(ROOT / f"{name}.png")

    rgb = cv2.cvtColor(arr[:,:,:3], cv2.COLOR_RGB2BGR)
    mask = np.zeros((H,W),np.uint8)
    for box in REGIONS.values():
        x0,y0,x1,y1=box; cx=(x0+x1)//2; cy=(y0+y1)//2
        cv2.ellipse(mask,(cx,cy),((x1-x0)//2-8,(y1-y0)//2-7),0,0,360,255,-1)
    inp = cv2.cvtColor(cv2.inpaint(rgb,mask,5,cv2.INPAINT_TELEA),cv2.COLOR_BGR2RGB)
    Image.fromarray(np.dstack([inp,arr[:,:,3]])).save(ROOT / "haneul_base_no_features.png")

    alpha=arr[:,:,3].astype(np.float32)/255.0
    Y,X=np.mgrid[0:H,0:W]
    geom=(((Y<430)&(X>150)&(X<760))|((X<360)&(Y<900)&(X>80)&(Y>120))|((X>560)&(X<820)&(Y<760)&(Y>100))|((X<470)&(Y>450)&(Y<1120)&(X>80)))
    face=((X-460)/185)**2+((Y-370)/205)**2<1
    hair=(geom & (~face) & (arr[:,:,:3].mean(axis=2)<145)).astype(np.uint8)*255
    hair=(hair.astype(np.float32)*alpha).astype(np.uint8)
    hair=np.array(Image.fromarray(hair).filter(ImageFilter.GaussianBlur(2)))
    h=arr.copy(); h[:,:,3]=(arr[:,:,3].astype(np.uint16)*hair.astype(np.uint16)//255).astype(np.uint8)
    Image.fromarray(h).save(ROOT / "hair_front.png")

    closed_eye("eye_left",63,55,21,-.06)
    closed_eye("eye_right",50,54,20,-.10)
    print("Layer assets rebuilt in", ROOT)

if __name__ == "__main__":
    main()
