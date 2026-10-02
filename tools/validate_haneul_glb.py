import json, struct, sys
from pathlib import Path
P=Path(__file__).resolve().parents[1]/'public/assets/haneul.glb'
b=P.read_bytes()
assert len(b)>=20, 'GLB too small'
magic,ver,total=struct.unpack_from('<4sII',b,0)
assert magic==b'glTF' and ver==2 and total==len(b), 'invalid GLB header'
jlen,jtype=struct.unpack_from('<I4s',b,12)
assert jtype==b'JSON'
j=json.loads(b[20:20+jlen].decode('utf-8'))
assert j.get('scene') is not None and j.get('meshes') and j.get('nodes')
# binary chunk bounds
bo=20+jlen
blen,btype=struct.unpack_from('<I4s',b,bo)
assert btype==b'BIN\x00'
assert bo+8+blen<=len(b)
assert j['buffers'][0]['byteLength']<=blen
for v in j.get('bufferViews',[]):
    off=v.get('byteOffset',0); ln=v['byteLength']
    assert off>=0 and ln>=0 and off+ln<=j['buffers'][0]['byteLength']
# required rig
joint_names=[]
for s in j.get('skins',[]): joint_names += [j['nodes'][i].get('name','') for i in s.get('joints',[])]
required_bones={'Hips','Spine','Chest','Neck','Head'}
missing_bones=sorted(required_bones-set(joint_names))
targets=set()
for m in j['meshes']: targets.update(m.get('extras',{}).get('targetNames',[]))
required_expr={'Blink','Smile','A','I','U','E','O'}
missing_expr=sorted(required_expr-targets)
tris=0
for m in j['meshes']:
    for p in m.get('primitives',[]):
        ai=p.get('indices')
        if ai is not None: tris += j['accessors'][ai]['count']//3
assert not missing_bones, f'missing bones: {missing_bones}'
assert not missing_expr, f'missing expressions: {missing_expr}'
assert tris>=50000, f'triangle count unexpectedly low: {tris}'
assert any(img.get('mimeType')=='image/png' and 'bufferView' in img for img in j.get('images',[])), 'embedded skin texture missing'
print(json.dumps({
  'ok': True, 'file': str(P), 'bytes': len(b), 'meshes': len(j['meshes']), 'nodes': len(j['nodes']),
  'joints': len(joint_names), 'triangles': tris, 'expressions': sorted(required_expr), 'bones': joint_names
}, ensure_ascii=False, indent=2))
