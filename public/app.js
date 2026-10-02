const $ = (s) => document.querySelector(s);
const canvas = $('#avatar');
const stage = $('#stage');
const stateLabel = $('#stateLabel');
const gl = canvas.getContext('webgl', {
  alpha: true,
  antialias: true,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
});

if (!gl) {
  stateLabel.textContent = '此瀏覽器無法啟用 WebGL';
  throw new Error('WebGL unavailable');
}

gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

const IMAGE_W = 1122;
const IMAGE_H = 1402;
const IMAGE_AR = IMAGE_W / IMAGE_H;

const BASE_VS = `
attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uLook;
uniform float uBreath;
uniform float uHeadStrength;
float bell(vec2 p, vec2 c, vec2 r, float k) {
  vec2 d = (p - c) / r;
  return exp(-dot(d,d) * k);
}
void main(){
  vec2 uv = aUv;
  vec2 p = aPos;
  float head = bell(uv, vec2(.445,.72), vec2(.25,.28), 2.7);
  float face = bell(uv, vec2(.445,.72), vec2(.20,.21), 3.5);
  float chest = bell(uv, vec2(.53,.28), vec2(.42,.26), 3.0);
  float yaw = uLook.x * .27 * uHeadStrength;
  float pitch = uLook.y * .14 * uHeadStrength;
  float nx = (uv.x - .445) / .24;
  float ny = (uv.y - .72) / .27;
  float z = max(0., 1. - nx*nx*.70 - ny*ny*.60) * face;
  p.x += head * (sin(yaw) * z * .17 + uLook.x * .006 * uHeadStrength);
  p.y += head * (pitch * z * .060 + uLook.y * .004 * uHeadStrength);
  p.y += chest * uBreath * .006;
  gl_Position = vec4(p, 0., 1.);
  vUv = uv;
}`;

const TEX_FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
void main(){
  vec4 c = texture2D(uTex, vUv);
  c.a *= uAlpha;
  gl_FragColor = c;
}`;

const LAYER_VS = `
attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
uniform vec4 uRect;
uniform vec2 uLook;
uniform vec4 uShape; // open, wide, round, smile
uniform float uBlink;
uniform float uKind; // 0 eye, 1 mouth, 2 upper lid, 3 lower lid
uniform float uStrength;
void main(){
  vec2 q = aPos;
  float open = uShape.x * uStrength;
  float wide = uShape.y * uStrength;
  float round = uShape.z * uStrength;
  float smile = uShape.w;
  if (uKind < .5) {
    // open-eye layer stays geometrically stable; gaze is UV-local in fragment shader
  } else if (uKind < 1.5) {
    q.y *= 1. + open * .32;
    q.x *= 1. + wide * .22 - round * .24;
    q.y += smile * (abs(q.x) - .45) * .035;
  } else if (uKind < 2.5) {
    q.y -= uBlink * .36;
  } else if (uKind < 3.5) {
    q.y += uBlink * .18;
  } else {
    // closed-eye overlay: no geometric squash, only alpha cross-fade
  }
  vec2 p = uRect.xy + q * uRect.zw * .5;
  // All facial layers follow the same subtle head parallax as the base.
  p.x += uLook.x * .010;
  p.y += uLook.y * .0055;
  gl_Position = vec4(p,0.,1.);
  vUv = aUv;
}`;

const LAYER_FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uLook;
uniform float uKind;
uniform float uAlpha;
void main(){
  vec2 uv = vUv;
  // Eye texture stays in place; only iris neighborhood shifts for gaze.
  if (uKind < .5) {
    vec2 d = uv - vec2(.5,.5);
    float iris = exp(-dot(d/vec2(.20,.24), d/vec2(.20,.24))*5.0);
    uv.x -= uLook.x * .026 * iris;
    uv.y -= uLook.y * .018 * iris;
  }
  vec4 c = texture2D(uTex, uv);
  c.a *= uAlpha;
  gl_FragColor = c;
}`;

const HAIR_VS = `
attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uLook;
uniform float uHairStrength;
void main(){
  vec2 p = aPos;
  vec2 uv = aUv;
  float side = smoothstep(.08,.36,abs(uv.x-.47));
  float lower = smoothstep(.28,.86,1.-uv.y);
  float sway = sin(uTime*.82 + uv.y*5.4 + uv.x*2.1) * .0045 * uHairStrength;
  p.x += side * lower * sway;
  p.x += uLook.x * .008;
  p.y += uLook.y * .004;
  gl_Position = vec4(p,0.,1.);
  vUv = uv;
}`;

function compile(type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s,src);
  gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(vs,fs){
  const p=gl.createProgram();
  gl.attachShader(p,compile(gl.VERTEX_SHADER,vs));
  gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const baseProgram = program(BASE_VS,TEX_FS);
const layerProgram = program(LAYER_VS,LAYER_FS);
const hairProgram = program(HAIR_VS,TEX_FS);

function grid(nx,ny){
  const pos=[],uv=[],idx=[];
  for(let y=0;y<=ny;y++) for(let x=0;x<=nx;x++){
    pos.push(x/nx*2-1,y/ny*2-1);
    uv.push(x/nx,y/ny);
  }
  for(let y=0;y<ny;y++) for(let x=0;x<nx;x++){
    const a=y*(nx+1)+x,b=a+1,c=a+nx+1,d=c+1;
    idx.push(a,b,c,b,d,c);
  }
  return {pos:new Float32Array(pos),uv:new Float32Array(uv),idx:new Uint16Array(idx)};
}
const baseGrid=grid(72,90);
const layerGrid=grid(14,10);
const hairGrid=grid(48,60);

function buffers(g){
  const pos=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,pos); gl.bufferData(gl.ARRAY_BUFFER,g.pos,gl.STATIC_DRAW);
  const uv=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,uv); gl.bufferData(gl.ARRAY_BUFFER,g.uv,gl.STATIC_DRAW);
  const idx=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,g.idx,gl.STATIC_DRAW);
  return {pos,uv,idx,count:g.idx.length};
}
const baseBuffers=buffers(baseGrid), layerBuffers=buffers(layerGrid), hairBuffers=buffers(hairGrid);

function bind(programObj,b){
  const pLoc=gl.getAttribLocation(programObj,'aPos');
  gl.bindBuffer(gl.ARRAY_BUFFER,b.pos); gl.enableVertexAttribArray(pLoc); gl.vertexAttribPointer(pLoc,2,gl.FLOAT,false,0,0);
  const uvLoc=gl.getAttribLocation(programObj,'aUv');
  gl.bindBuffer(gl.ARRAY_BUFFER,b.uv); gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc,2,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.idx);
}

function loadTexture(url){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>{
      const tex=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      resolve(tex);
    };
    image.onerror=reject;
    image.src=url;
  });
}

const assets={
  base:'/assets/haneul_base_no_features.png',
  eyeL:'/assets/eye_left.png', eyeR:'/assets/eye_right.png',
  eyeLC:'/assets/eye_left_closed.png', eyeRC:'/assets/eye_right_closed.png',
  mouth:'/assets/mouth.png', hair:'/assets/hair_front.png',
};
const textures={};
let ready=false;
Promise.all(Object.entries(assets).map(async([k,url])=>{textures[k]=await loadTexture(url);})).then(()=>{
  ready=true; stateLabel.textContent='看著你 · 分層 Live Rig'; resize();
}).catch((e)=>{console.error(e); stateLabel.textContent='角色素材載入失敗';});

function rectFromPixels(x0,y0,x1,y1){
  const cx=(x0+x1)/2/IMAGE_W*2-1;
  const cy=1-(y0+y1)/2/IMAGE_H*2;
  const sx=(x1-x0)/IMAGE_W*2;
  const sy=(y1-y0)/IMAGE_H*2;
  return [cx,cy,sx,sy];
}
const RECT={
  eyeL:rectFromPixels(315,305,450,395),
  eyeR:rectFromPixels(455,270,590,360),
  mouth:rectFromPixels(385,435,565,550),
};

const st={
  target:[0,0],look:[0,0],lastPointer:performance.now(),
  blink:0,blinkAt:performance.now()+1700,smile:.10,
  vis:[0,0,0,0,0],head:.68,breath:.52,hair:.46,gaze:.75,lip:.82,
  speaking:false,
};

function resize(){
  const d=Math.min(devicePixelRatio||1,2);
  const r=stage.getBoundingClientRect();
  const stageAR=r.width/r.height;
  let w,h;
  if(stageAR>IMAGE_AR){h=r.height*1.035;w=h*IMAGE_AR}else{w=r.width*1.035;h=w/IMAGE_AR}
  canvas.style.width=w+'px'; canvas.style.height=h+'px';
  canvas.width=Math.max(1,Math.round(w*d)); canvas.height=Math.max(1,Math.round(h*d));
  gl.viewport(0,0,canvas.width,canvas.height);
}
addEventListener('resize',resize);

function pointer(e){
  const r=stage.getBoundingClientRect();
  st.target=[
    Math.max(-1,Math.min(1,((e.clientX-r.left)/r.width-.5)*2)),
    Math.max(-1,Math.min(1,-((e.clientY-r.top)/r.height-.5)*2)),
  ];
  st.lastPointer=performance.now();
}
stage.addEventListener('pointermove',pointer);
stage.addEventListener('pointerdown',pointer);
stage.addEventListener('pointerleave',()=>{st.lastPointer=0;});

function useTexture(tex,prog){
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,tex);
  const loc=gl.getUniformLocation(prog,'uTex'); if(loc)gl.uniform1i(loc,0);
}
function drawBase(time,breath){
  gl.useProgram(baseProgram); bind(baseProgram,baseBuffers); useTexture(textures.base,baseProgram);
  gl.uniform1f(gl.getUniformLocation(baseProgram,'uTime'),time);
  gl.uniform2f(gl.getUniformLocation(baseProgram,'uLook'),st.look[0],st.look[1]);
  gl.uniform1f(gl.getUniformLocation(baseProgram,'uBreath'),breath);
  gl.uniform1f(gl.getUniformLocation(baseProgram,'uHeadStrength'),st.head);
  gl.uniform1f(gl.getUniformLocation(baseProgram,'uAlpha'),1);
  gl.drawElements(gl.TRIANGLES,baseBuffers.count,gl.UNSIGNED_SHORT,0);
}
function mouthShape(){
  const [A,I,U,E,O]=st.vis;
  return {
    open:A*.92+I*.20+U*.38+E*.28+O*.72,
    wide:A*.12+I*.72-U*.22+E*.60-O*.20,
    round:U*.76+O*.94,
  };
}
function drawLayer(tex,rect,kind,alpha=1){
  gl.useProgram(layerProgram); bind(layerProgram,layerBuffers); useTexture(tex,layerProgram);
  gl.uniform4f(gl.getUniformLocation(layerProgram,'uRect'),...rect);
  gl.uniform2f(gl.getUniformLocation(layerProgram,'uLook'),st.look[0]*st.gaze,st.look[1]*st.gaze);
  const m=mouthShape();
  gl.uniform4f(gl.getUniformLocation(layerProgram,'uShape'),m.open,m.wide,m.round,st.smile);
  gl.uniform1f(gl.getUniformLocation(layerProgram,'uBlink'),st.blink);
  gl.uniform1f(gl.getUniformLocation(layerProgram,'uKind'),kind);
  gl.uniform1f(gl.getUniformLocation(layerProgram,'uStrength'),st.lip);
  gl.uniform1f(gl.getUniformLocation(layerProgram,'uAlpha'),alpha);
  gl.drawElements(gl.TRIANGLES,layerBuffers.count,gl.UNSIGNED_SHORT,0);
}
function drawHair(time){
  gl.useProgram(hairProgram); bind(hairProgram,hairBuffers); useTexture(textures.hair,hairProgram);
  gl.uniform1f(gl.getUniformLocation(hairProgram,'uTime'),time);
  gl.uniform2f(gl.getUniformLocation(hairProgram,'uLook'),st.look[0],st.look[1]);
  gl.uniform1f(gl.getUniformLocation(hairProgram,'uHairStrength'),st.hair);
  gl.uniform1f(gl.getUniformLocation(hairProgram,'uAlpha'),.72);
  gl.drawElements(gl.TRIANGLES,hairBuffers.count,gl.UNSIGNED_SHORT,0);
}

let last=performance.now(),frames=0,fpsAt=last;
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min(.05,(now-last)/1000); last=now;
  if(now-st.lastPointer>3400&&!st.speaking){
    st.target[0]=Math.sin(now*.00039)*.23;
    st.target[1]=Math.sin(now*.00031+1.2)*.11;
  }
  st.look[0]+=(st.target[0]-st.look[0])*Math.min(1,dt*4.4);
  st.look[1]+=(st.target[1]-st.look[1])*Math.min(1,dt*4.4);
  if(now>st.blinkAt && st.blink<=.001){
    st.blink=.001;
    st.blinkAt=now+2300+Math.random()*4300;
  }
  if(st.blink>0){
    st.blink += dt*5.8;
    if(st.blink>=2)st.blink=0;
  }
  const blinkCurve=st.blink===0?0:Math.sin(Math.min(2,st.blink)*Math.PI/2);
  const blinkSaved=st.blink; st.blink=blinkCurve;
  const breath=(Math.sin(now*.00155)+1)*.5*st.breath;
  gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
  if(ready){
    drawBase(now/1000,breath);
    // Open-eye layers keep the same identity and gaze. Dedicated closed-eye
    // layers cross-fade over them during blink, avoiding the ghosting created
    // by vertically crushing the whole face texture.
    drawLayer(textures.eyeL,RECT.eyeL,0,1);
    drawLayer(textures.eyeR,RECT.eyeR,0,1);
    if(st.blink>.015){
      drawLayer(textures.eyeLC,RECT.eyeL,4,Math.min(1,st.blink*1.08));
      drawLayer(textures.eyeRC,RECT.eyeR,4,Math.min(1,st.blink*1.08));
    }
    drawLayer(textures.mouth,RECT.mouth,1,1);
    drawHair(now/1000);
  }
  st.blink=blinkSaved;
  $('#yaw').textContent=`YAW ${Math.round(st.look[0]*20*st.head)}°`;
  $('#pitch').textContent=`PITCH ${Math.round(st.look[1]*10*st.head)}°`;
  frames++;
  if(now-fpsAt>700){$('#fps').textContent=`${Math.round(frames*1000/(now-fpsAt))} FPS`;frames=0;fpsAt=now;}
}
requestAnimationFrame(frame);

const visNames=['A','I','U','E','O'];
function setVis(i,a=1){
  st.vis=[0,0,0,0,0];
  if(i>=0)st.vis[i]=a;
  $('#viseme').textContent=i<0?'VISEME —':`VISEME ${visNames[i]}`;
}
function visemeForChar(c,i=0){
  if(/[啊阿哈咖嘎卡]/.test(c))return 0;
  if(/[一衣你里其西知]/.test(c))return 1;
  if(/[屋烏無不夫]/.test(c))return 2;
  if(/[欸誒也耶]/.test(c))return 3;
  if(/[喔哦我多說]/.test(c))return 4;
  return (c.charCodeAt(0)+i*3)%5;
}
let visTimer=0;
function animateVisemes(text,duration){
  clearInterval(visTimer);
  const chars=[...text.replace(/\s/g,'')];
  const seq=(chars.length?chars:['啊','一','烏','欸','喔']).map(visemeForChar);
  let i=0; const step=Math.max(72,Math.min(135,duration/Math.max(1,seq.length)));
  setVis(seq[0],.82);
  visTimer=setInterval(()=>{setVis(seq[i%seq.length],.72+.22*Math.sin(i*.8));i++;},step);
}
function stopVisemes(){
  clearInterval(visTimer); setVis(-1); st.speaking=false; stateLabel.textContent='看著你 · 分層 Live Rig';
}
function pickVoice(){
  const vs=speechSynthesis.getVoices();
  return vs.find(v=>/zh-TW/i.test(v.lang)&&/female|Mei|Hsiao|Ting|Yating|美/i.test(v.name))||vs.find(v=>/zh-TW/i.test(v.lang))||vs.find(v=>/^zh/i.test(v.lang))||vs[0];
}
function speak(text){
  if(!('speechSynthesis' in window)){
    const dur=Math.max(1000,text.length*130); st.speaking=true; animateVisemes(text,dur); setTimeout(stopVisemes,dur); return;
  }
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text); u.lang='zh-TW'; u.rate=.96; u.pitch=1.06;
  const v=pickVoice(); if(v)u.voice=v;
  const dur=Math.max(1200,text.length*150);
  u.onstart=()=>{st.speaking=true;stateLabel.textContent='正在說話 · 分層嘴型';animateVisemes(text,dur);};
  u.onboundary=(e)=>{if(e.name==='word'||e.name==='sentence'){const c=text[Math.min(text.length-1,e.charIndex||0)]||'啊';setVis(visemeForChar(c,e.charIndex||0),.92);}};
  u.onend=stopVisemes; u.onerror=stopVisemes; speechSynthesis.speak(u);
}

const conv=$('#conversation'), input=$('#input');
function add(text,who){
  const d=document.createElement('div'); d.className='bubble '+who; d.textContent=text; conv.appendChild(d); conv.scrollTop=conv.scrollHeight;
  const log=JSON.parse(localStorage.getItem('neuli-live-log')||'[]'); log.push({who,text,t:Date.now()}); localStorage.setItem('neuli-live-log',JSON.stringify(log.slice(-40)));
}
async function send(){
  const m=input.value.trim(); if(!m)return; input.value=''; add(m,'me'); stateLabel.textContent='正在想…';
  try{const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:m})}); const j=await r.json(); add(j.reply,'her'); speak(j.reply);}
  catch{const x='我還在，只是聊天服務剛剛沒有連上。'; add(x,'her'); speak(x);}
}
$('#send').onclick=send; input.addEventListener('keydown',e=>{if(e.key==='Enter')send();});

document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{
  const a=b.dataset.action;
  if(a==='smile'){st.smile=st.smile>.35?.10:.72;stateLabel.textContent=st.smile>.35?'對你微笑':'看著你 · 分層 Live Rig';}
  if(a==='blink'){st.blink=.001;st.blinkAt=performance.now()+3200;}
  if(a==='talk')speak('嗨，這一版我的眼睛、眼皮、嘴唇和前髮已經分層控制了。');
  if(a==='reset'){st.smile=.10;st.target=[0,0];stopVisemes();}
});

const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
if(SR){
  const sr=new SR();sr.lang='zh-TW';sr.interimResults=true;sr.continuous=false;
  sr.onstart=()=>stateLabel.textContent='正在聽你說…';
  sr.onresult=e=>{let s='';for(let i=e.resultIndex;i<e.results.length;i++)s+=e.results[i][0].transcript;input.value=s;};
  sr.onend=()=>{if(input.value.trim())send();else stateLabel.textContent='看著你 · 分層 Live Rig';};
  sr.onerror=()=>stateLabel.textContent='麥克風暫時不可用'; $('#mic').onclick=()=>sr.start();
}else $('#mic').onclick=()=>alert('此瀏覽器沒有提供內建語音辨識，可改用鍵盤輸入。');

function bindRange(id,key){const el=$('#'+id),out=$('#'+id+'Out');el.oninput=()=>{st[key]=Number(el.value)/100;out.textContent=el.value+'%';};}
bindRange('head','head'); bindRange('breath','breath'); bindRange('hair','hair'); bindRange('gaze','gaze'); bindRange('lip','lip');
$('#settings').onclick=()=>$('#drawer').classList.add('open'); $('#close').onclick=()=>$('#drawer').classList.remove('open');
document.querySelectorAll('[data-scene]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-scene]').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#scene').className='scene scene-'+b.dataset.scene;});
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
