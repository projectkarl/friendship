import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const host = document.getElementById('avatar3dHost');
const fallback = document.getElementById('avatarFallback');
const badge = document.getElementById('modelBadge');
if (!host) throw new Error('avatar3dHost missing');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
camera.position.set(0, 0.70, 6.45);
camera.lookAt(0, 0.46, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = 'avatar3d-canvas';
host.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xfff5ef, 0x151824, 1.55));
const key = new THREE.DirectionalLight(0xffeadf, 3.3); key.position.set(-2.6, 4.4, 4.8); key.castShadow = true; scene.add(key);
const rim = new THREE.DirectionalLight(0xaebfff, 2.0); rim.position.set(3.4, 3.0, -1.4); scene.add(rim);
const fill = new THREE.PointLight(0xffcfc7, 1.15, 10); fill.position.set(1.4, 2.0, 3.4); scene.add(fill);

const modelAnchor = new THREE.Group();
scene.add(modelAnchor);
const lookTarget = new THREE.Vector2(0, 0);
const clock = new THREE.Clock();

let modelRoot = null;
let vrm = null;
let modelKind = 'loading';
let modelSource = '';
let morphSlots = new Map();
let bones = {};
let irises = [];
let pupils = [];
let outfitMaterials = [];
let rest = new Map();
let modelAudit = null;

let mood = 'warm';
let speaking = false;
let speakText = '';
let speakIndex = 0;
let speakTimer = 0;
let externalAudioLevel = 0;
let externalVisemeKey = null;
let externalVisemeUntil = 0;
let externalVisemeIntensity = 0;
let blinkStart = 0;
let blinking = false;
let nextBlink = performance.now() + 1400;

const canonical = ['Blink', 'Smile', 'A', 'I', 'U', 'E', 'O'];
const aliases = {
  Blink: ['blink','blinkleft','blinkright','eye_blink','eyeblink'],
  Smile: ['smile','happy','joy','mouth_smile'],
  A: ['a','aa','viseme_aa','mouth_a'],
  I: ['i','ih','viseme_ih','mouth_i'],
  U: ['u','ou','viseme_ou','mouth_u'],
  E: ['e','ee','viseme_ee','mouth_e'],
  O: ['o','oh','viseme_oh','mouth_o']
};

const morphValue = Object.fromEntries(canonical.map(k => [k, 0]));
const morphTarget = Object.fromEntries(canonical.map(k => [k, 0]));

function normName(s='') { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function canonicalFor(name) {
  const n = normName(name);
  for (const key of canonical) if (aliases[key].some(a => normName(a) === n)) return key;
  return null;
}

function setBadge(text, state='loading') {
  if (!badge) return;
  badge.textContent = text;
  badge.dataset.state = state;
}

function captureRest(obj) {
  rest.set(obj.uuid, { position: obj.position.clone(), quaternion: obj.quaternion.clone(), scale: obj.scale.clone() });
}

function collectModel(root) {
  morphSlots = new Map(canonical.map(k => [k, []]));
  bones = {}; irises = []; pupils = []; outfitMaterials = []; rest = new Map();
  let meshCount = 0, triCount = 0, boneCount = 0;
  const morphNames = new Set();

  root.traverse(obj => {
    captureRest(obj);
    if (obj.isBone) {
      boneCount++;
      bones[normName(obj.name)] = obj;
    }
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    meshCount++;
    obj.castShadow = true; obj.receiveShadow = true;
    if (obj.geometry?.index) triCount += obj.geometry.index.count / 3;
    else if (obj.geometry?.attributes?.position) triCount += obj.geometry.attributes.position.count / 3;

    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(mat => {
        if (mat.map) { mat.map.colorSpace = THREE.SRGBColorSpace; mat.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); }
        if (/top|shirt|outfit|cloth|body/i.test(mat.name || '') || /BodyMesh|Torso/i.test(obj.name || '')) outfitMaterials.push(mat);
      });
    }

    const dict = obj.morphTargetDictionary || {};
    Object.entries(dict).forEach(([name, index]) => {
      morphNames.add(name);
      const key = canonicalFor(name);
      if (key) morphSlots.get(key).push({ mesh: obj, index });
    });

    if (/iris/i.test(obj.name)) irises.push({ obj, base: obj.position.clone() });
    if (/pupil/i.test(obj.name)) pupils.push({ obj, base: obj.position.clone() });
  });

  const required = ['Blink','Smile','A','I','U','E','O'];
  const missing = required.filter(k => !(morphSlots.get(k)?.length) && !(vrm && hasVRMExpression(k)));
  return { source: modelSource, kind: modelKind, meshCount, triangles: Math.round(triCount), boneCount, morphNames: [...morphNames], missing, pass: boneCount >= 5 && missing.length === 0 };
}

function hasVRMExpression(key) {
  if (!vrm?.expressionManager) return false;
  const map = { Blink:'blink', Smile:'happy', A:'aa', I:'ih', U:'ou', E:'ee', O:'oh' };
  try { return !!vrm.expressionManager.getExpression(map[key]); } catch { return true; }
}

function setRawExpression(key, value) {
  const v = THREE.MathUtils.clamp(value, 0, 1);
  if (vrm?.expressionManager) {
    const map = { Blink:'blink', Smile:'happy', A:'aa', I:'ih', U:'ou', E:'ee', O:'oh' };
    try { vrm.expressionManager.setValue(map[key], v); } catch {}
  }
  for (const slot of morphSlots.get(key) || []) {
    if (slot.mesh.morphTargetInfluences) slot.mesh.morphTargetInfluences[slot.index] = v;
  }
}

function setMorphTarget(key, value) { morphTarget[key] = THREE.MathUtils.clamp(value, 0, 1); }

function charViseme(ch='') {
  if (/[啊阿哈咖卡嘎巴爸媽嗎a]/i.test(ch)) return 'A';
  if (/[衣一你咪比皮西其雞i]/i.test(ch)) return 'I';
  if (/[嗚屋烏五無夫u]/i.test(ch)) return 'U';
  if (/[欸誒耶也e]/i.test(ch)) return 'E';
  if (/[喔哦歐偶我o]/i.test(ch)) return 'O';
  return ['A','I','U','E','O'][Math.abs(ch.codePointAt?.(0) || 0) % 5];
}

function updateSpeech(dt) {
  ['A','I','U','E','O'].forEach(k => setMorphTarget(k, 0));
  if (!speaking) return;
  if (externalVisemeKey && performance.now() < externalVisemeUntil) {
    setMorphTarget(externalVisemeKey, externalVisemeIntensity);
    return;
  }
  speakTimer += dt;
  if (speakTimer > 0.085) { speakTimer = 0; speakIndex = (speakIndex + 1) % Math.max(1, speakText.length); }
  const key = charViseme(speakText[speakIndex] || '啊');
  const pulse = externalAudioLevel > .01 ? THREE.MathUtils.clamp(.18 + externalAudioLevel * 1.35, .18, 1) : .62 + .18 * Math.sin(performance.now() * .022);
  setMorphTarget(key, pulse);
}

function updateBlink(now) {
  if (!blinking && now >= nextBlink) { blinking = true; blinkStart = now; }
  if (!blinking) { setMorphTarget('Blink', 0); return; }
  const t = (now - blinkStart) / 155;
  const v = t < .46 ? t / .46 : Math.max(0, 1 - (t - .46) / .54);
  setMorphTarget('Blink', v);
  if (t >= 1) { blinking = false; nextBlink = now + 2300 + Math.random() * 3500; setMorphTarget('Blink', 0); }
}

function updateMood() {
  setMorphTarget('Smile', mood === 'happy' ? .42 : mood === 'thinking' ? .08 : .16);
}

function updateMorphs(dt) {
  for (const key of canonical) {
    const speed = key === 'Blink' ? 24 : 13;
    morphValue[key] = THREE.MathUtils.damp(morphValue[key], morphTarget[key], speed, dt);
    setRawExpression(key, morphValue[key]);
  }
  vrm?.expressionManager?.update?.();
}

function bone(name) { return bones[normName(name)]; }
function applyRestRotation(obj, ex, ey, ez) {
  if (!obj) return;
  const r = rest.get(obj.uuid); if (!r) return;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ex, ey, ez, 'YXZ'));
  obj.quaternion.copy(r.quaternion).multiply(q);
}

function updateRig(t) {
  const head = bone('Head') || bone('J_Bip_C_Head');
  const neck = bone('Neck') || bone('J_Bip_C_Neck');
  const chest = bone('Chest') || bone('UpperChest') || bone('J_Bip_C_Chest');
  const sway = Math.sin(t * .55) * .016;
  applyRestRotation(head, lookTarget.y * -.10 + Math.sin(t*.73)*.010, lookTarget.x * .16 + sway, lookTarget.x * -.025);
  applyRestRotation(neck, lookTarget.y * -.035, lookTarget.x * .055 + sway*.35, 0);
  applyRestRotation(chest, Math.sin(t*.84)*.006, 0, Math.sin(t*.49)*.005);

  const eyeX = lookTarget.x * .018, eyeY = -lookTarget.y * .012;
  [...irises, ...pupils].forEach(({obj, base}) => obj.position.set(base.x + eyeX, base.y + eyeY, base.z));
}

function updateBreath(t) {
  const chest = bone('Chest') || bone('UpperChest');
  if (!chest) return;
  const r = rest.get(chest.uuid); if (!r) return;
  const b = 1 + Math.sin(t * 1.45) * .004;
  chest.scale.set(r.scale.x * b, r.scale.y * (1 + (b-1)*.55), r.scale.z * b);
}

const outfitColors = { ivory:0xe1d3bd, black:0x202129, blue:0x8da9c3, rose:0xbe838f, denim:0x667f96, night:0x2c2630 };
function setOutfit(name) {
  const hex = outfitColors[name] ?? outfitColors.ivory;
  outfitMaterials.forEach(mat => { if (mat.color) { mat.color.setHex(hex); mat.needsUpdate = true; } });
}
function setMood(next) { mood = next || 'warm'; updateMood(); }
function startSpeaking(text='') { speaking = true; speakText = text; speakIndex = 0; speakTimer = 0; }
function stopSpeaking() { speaking = false; externalAudioLevel = 0; ['A','I','U','E','O'].forEach(k => setMorphTarget(k,0)); }
function setAudioLevel(level=0) { externalAudioLevel = THREE.MathUtils.clamp(Number(level) || 0, 0, 1); }
function setViseme(name='A', intensity=1, durationMs=120) {
  const key = canonicalFor(String(name)) || String(name).toUpperCase();
  if (!['A','I','U','E','O'].includes(key)) return;
  externalVisemeKey = key;
  externalVisemeIntensity = THREE.MathUtils.clamp(Number(intensity) || 0, 0, 1);
  externalVisemeUntil = performance.now() + Math.max(40, Number(durationMs) || 120);
}
function blink() { blinking = true; blinkStart = performance.now(); }

function publishAudit(audit) {
  modelAudit = audit;
  const detail = { ...audit, required: ['Blink','Smile','A','I','U','E','O'] };
  window.dispatchEvent(new CustomEvent('neuli-avatar-ready', { detail }));
  setBadge(audit.pass ? '3D Rig ✓' : '3D Rig !', audit.pass ? 'ok' : 'warn');
  const status = document.getElementById('modelStatusLine');
  if (status) status.textContent = `${audit.kind.toUpperCase()} · ${audit.meshCount} meshes · ${audit.boneCount} bones · ${audit.triangles.toLocaleString()} tris`;
  const list = document.getElementById('modelQaList');
  if (list) {
    const rows = [
      ['模型來源', audit.source], ['Mesh', audit.meshCount], ['Triangles', audit.triangles.toLocaleString()], ['Bones', audit.boneCount],
      ['Blink', audit.missing.includes('Blink') ? '缺少' : 'OK'], ['Smile', audit.missing.includes('Smile') ? '缺少' : 'OK'],
      ['A / I / U / E / O', ['A','I','U','E','O'].some(k=>audit.missing.includes(k)) ? '不完整' : 'OK']
    ];
    list.innerHTML = rows.map(([k,v]) => `<div class="qa-row"><span>${k}</span><b>${v}</b></div>`).join('');
  }
}

function fitExternalModel(root, kind) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0) return;
  // Our bundled GLB is authored at the intended scale; normalize other assets to a comparable bust scale.
  if (!/haneul\.glb$/i.test(modelSource)) {
    const scale = 3.9 / size.y;
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(root);
    const c2 = b2.getCenter(new THREE.Vector3());
    root.position.x -= c2.x;
    root.position.y -= c2.y - .35;
    root.position.z -= c2.z;
  }
}

const loader = new GLTFLoader();
loader.register(parser => new VRMLoaderPlugin(parser));

function loadURL(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

async function exists(url) {
  try { const r = await fetch(url, { method: 'HEAD', cache: 'no-store' }); return r.ok; } catch { return false; }
}

async function loadAvatar() {
  setBadge('3D loading', 'loading');
  const candidates = ['/assets/haneul.vrm', '/assets/haneul.glb'];
  let lastError = null;
  for (const url of candidates) {
    if (!(await exists(url))) continue;
    try {
      modelSource = url;
      const gltf = await loadURL(url);
      vrm = gltf.userData?.vrm || null;
      modelKind = vrm ? 'vrm' : 'glb';
      modelRoot = vrm ? vrm.scene : gltf.scene;
      if (vrm) {
        VRMUtils.removeUnnecessaryVertices?.(vrm.scene);
        VRMUtils.combineSkeletons?.(vrm.scene);
      }
      fitExternalModel(modelRoot, modelKind);
      modelAnchor.add(modelRoot);
      const audit = collectModel(modelRoot);
      setOutfit(localStorage.getItem('neuli.outfit') || 'ivory');
      setMood('warm');
      fallback?.classList.add('hidden');
      publishAudit(audit);
      return;
    } catch (err) { lastError = err; console.error('avatar load failed', url, err); }
  }
  modelKind = 'error';
  setBadge('3D asset error', 'warn');
  fallback?.classList.remove('hidden');
  const status = document.getElementById('modelStatusLine'); if (status) status.textContent = '高模載入失敗，已停止假裝載入 3D。';
  window.dispatchEvent(new CustomEvent('neuli-avatar-error', { detail: { error: String(lastError || 'model missing') } }));
}

function resize() {
  const r = host.getBoundingClientRect();
  const w = Math.max(2, r.width), h = Math.max(2, r.height);
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host); resize();

host.addEventListener('pointermove', e => {
  const r = host.getBoundingClientRect();
  lookTarget.x = THREE.MathUtils.clamp(((e.clientX-r.left)/r.width-.5)*2, -1, 1);
  lookTarget.y = THREE.MathUtils.clamp(((e.clientY-r.top)/r.height-.5)*2, -1, 1);
});
host.addEventListener('pointerleave', () => lookTarget.set(0,0));

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(.05, clock.getDelta());
  const t = clock.elapsedTime;
  if (modelRoot) {
    updateBlink(performance.now()); updateMood(); updateSpeech(dt); updateMorphs(dt); updateRig(t); updateBreath(t);
    vrm?.update?.(dt);
  }
  renderer.render(scene, camera);
}
animate();
loadAvatar();

const publicAvatarAPI = { setOutfit, setMood, startSpeaking, stopSpeaking, setAudioLevel, setViseme, blink, getAudit: () => modelAudit };
window.neuliAvatar = publicAvatarAPI;
window.NEULI_AVATAR = publicAvatarAPI;
window.dispatchEvent(new Event('neuli-avatar-api-ready'));
