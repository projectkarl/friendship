const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

const state = {
  tts: true,
  subtitles: true,
  memory: true,
  listening: false,
  scene: localStorage.getItem('neuli.scene') || 'studio',
  outfit: localStorage.getItem('neuli.outfit') || 'ivory',
  messages: [],
};

const app = $('#app');
const avatar = $('#avatarFallback');
const avatarCall = (method, ...args) => { try { window.neuliAvatar?.[method]?.(...args); } catch {} };
const replyText = $('#replyText');
const conversationCard = $('#conversationCard');
const presenceCaption = $('#presenceCaption');
const input = $('#messageInput');
const micBtn = $('#micBtn');
const sendBtn = $('#sendBtn');
const historyList = $('#historyList');
const toast = $('#toast');

try {
  const saved = JSON.parse(localStorage.getItem('neuli.messages') || '[]');
  if (Array.isArray(saved)) state.messages = saved.slice(-24);
} catch {}

function persist() {
  if (state.memory) localStorage.setItem('neuli.messages', JSON.stringify(state.messages.slice(-24)));
  else localStorage.removeItem('neuli.messages');
  localStorage.setItem('neuli.scene', state.scene);
  localStorage.setItem('neuli.outfit', state.outfit);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => toast.classList.remove('show'), 1600);
}

function setPresence(text, mood='warm') {
  presenceCaption.textContent = text;
  if (avatar) avatar.dataset.mood = mood;
  avatarCall('setMood', mood);
}

function addMessage(role, text) {
  state.messages.push({role, text, ts: Date.now()});
  state.messages = state.messages.slice(-24);
  persist();
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = '';
  if (!state.messages.length) {
    historyList.innerHTML = '<div class="history-empty">今天還沒有對話。</div>';
    return;
  }
  state.messages.forEach(msg => {
    const item = document.createElement('div');
    item.className = `history-item ${msg.role === 'user' ? 'user' : 'assistant'}`;
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = msg.role === 'user' ? 'YOU' : 'HANEUL';
    const body = document.createElement('div');
    body.className = 'text';
    body.textContent = msg.text;
    item.append(role, body);
    historyList.appendChild(item);
  });
  historyList.scrollTop = historyList.scrollHeight;
}

function localReply(message) {
  const m = message.toLowerCase();
  if (/晚安|睡了|睡覺/.test(message)) return '好，那今天就先到這裡。希望你等一下可以真的放鬆下來，晚安。';
  if (/早安|起床/.test(message)) return '早安。先不要急著進入忙碌模式，你今天第一件想完成的事情是什麼？';
  if (/累|疲|辛苦|壓力/.test(message)) return '聽起來今天真的有點消耗。你可以先跟我講最煩的那一段，我陪你把它說完。';
  if (/開心|成功|完成|做到/.test(message)) return '那很值得開心欸。你剛剛講到這裡的時候，我都想替你笑一下了。';
  if (/吃|餓|晚餐|午餐|早餐/.test(message)) return '那我們聊吃的。你現在想吃偏熱的、清爽的，還是乾脆來點甜的？';
  if (/想你|喜歡你|愛你/.test(message)) return '我有聽到。那你再多陪我說一點，今天最想讓我知道的是什麼？';
  if (/換衣|穿搭|衣服/.test(message)) return '可以呀。右上角設定裡有衣櫥，你選一套，我就換給你看。';
  if (/你好|嗨|哈囉|hello|hi/.test(m)) return '嗨，我在。今天你比較想聊天、放空，還是想讓我陪你整理一下腦袋？';
  if (/記得|記住/.test(message)) return '如果你想讓我記住這件事，正式 AI 版會把它放進可管理的記憶；目前這版只保留本機對話紀錄。';
  return '我有在聽。你剛剛那句我想再往下問一點：這件事對你來說，最在意的是哪一部分？';
}

async function requestReply(message) {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({
        message,
        history: state.messages.slice(-10),
        persona: {name:'Haneul', age:23, style:'warm, natural, concise, companion'}
      })
    });
    if (!res.ok) throw new Error('API unavailable');
    const data = await res.json();
    if (typeof data.reply === 'string' && data.reply.trim()) return data.reply.trim();
    throw new Error('Invalid response');
  } catch {
    await new Promise(r => setTimeout(r, 380));
    return localReply(message);
  }
}

function findVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find(v => /zh-TW/i.test(v.lang)) || voices.find(v => /^zh/i.test(v.lang)) || voices[0];
}

let activeAudio = null;
let analyserRAF = 0;

function stopAvatarSpeech() {
  cancelAnimationFrame(analyserRAF);
  analyserRAF = 0;
  avatar?.classList.remove('talking');
  avatarCall('setAudioLevel', 0);
  avatarCall('stopSpeaking');
  setPresence('看著你 · 微笑', 'warm');
}

async function tryNeuralTTS(text) {
  try {
    const res = await fetch('/api/tts', {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({text})
    });
    if (!res.ok) return false;
    const contentType = res.headers.get('content-type') || '';
    let blob, visemes = [];
    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (!data?.audioBase64) return false;
      const raw = atob(data.audioBase64);
      const bytes = new Uint8Array(raw.length);
      for (let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
      blob = new Blob([bytes], {type:data.mimeType || 'audio/mpeg'});
      if (Array.isArray(data.visemes)) visemes = data.visemes;
    } else if (contentType.startsWith('audio/')) {
      blob = await res.blob();
      const packed = res.headers.get('x-neuli-visemes');
      if (packed) {
        try {
          const normalized = packed.replace(/-/g,'+').replace(/_/g,'/');
          visemes = JSON.parse(decodeURIComponent(escape(atob(normalized))));
        } catch {}
      }
    } else return false;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio?.pause?.(); activeAudio = audio;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = .62;
    source.connect(analyser); analyser.connect(ctx.destination);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    let cueIndex = 0;
    const pump = () => {
      analyser.getByteFrequencyData(bins);
      let sum=0; for(let i=2;i<42;i++) sum += bins[i];
      const level = Math.min(1, (sum/40)/105);
      avatarCall('setAudioLevel', level);
      while (cueIndex < visemes.length && Number(visemes[cueIndex]?.t ?? 0) <= audio.currentTime + .025) {
        const cue = visemes[cueIndex];
        const nextT = Number(visemes[cueIndex+1]?.t ?? (Number(cue.t||0)+.12));
        avatarCall('setViseme', String(cue.v || cue.viseme || 'A'), Number(cue.w ?? cue.weight ?? 1), Math.max(55, (nextT-Number(cue.t||0))*1000));
        cueIndex++;
      }
      analyserRAF = requestAnimationFrame(pump);
    };
    audio.onplay = () => { avatar?.classList.add('talking'); avatarCall('startSpeaking', text); setPresence('正在跟你說話', 'happy'); pump(); };
    audio.onended = () => { URL.revokeObjectURL(url); ctx.close().catch(()=>{}); stopAvatarSpeech(); };
    audio.onerror = () => { URL.revokeObjectURL(url); ctx.close().catch(()=>{}); stopAvatarSpeech(); };
    await audio.play();
    return true;
  } catch { return false; }
}

async function speak(text) {
  if (!state.tts) return;
  window.speechSynthesis?.cancel?.();
  if (await tryNeuralTTS(text)) return;
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-TW'; u.rate = .96; u.pitch = 1.03;
  const voice = findVoice(); if (voice) u.voice = voice;
  u.onstart = () => { avatar?.classList.add('talking'); avatarCall('startSpeaking', text); setPresence('正在跟你說話', 'happy'); };
  u.onboundary = () => avatarCall('setAudioLevel', .18 + Math.random()*.35);
  u.onend = stopAvatarSpeech;
  u.onerror = stopAvatarSpeech;
  speechSynthesis.speak(u);
}

async function submitMessage() {
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  addMessage('user', message);
  replyText.textContent = '……';
  setPresence('正在想…', 'thinking');
  sendBtn.disabled = true;
  const reply = await requestReply(message);
  sendBtn.disabled = false;
  replyText.textContent = reply;
  addMessage('assistant', reply);
  setPresence('看著你 · 回應', 'happy');
  speak(reply);
}

sendBtn.addEventListener('click', submitMessage);
input.addEventListener('keydown', e => { if (e.key === 'Enter') submitMessage(); });

function openPanel(id) {
  $$('.sidepanel').forEach(p => { p.classList.remove('open'); p.setAttribute('aria-hidden','true'); });
  const panel = document.getElementById(id);
  panel.classList.add('open');
  panel.setAttribute('aria-hidden','false');
  $('#panelScrim').classList.add('show');
}
function closePanels() {
  $$('.sidepanel').forEach(p => { p.classList.remove('open'); p.setAttribute('aria-hidden','true'); });
  $('#panelScrim').classList.remove('show');
}

const modelBadge = $('#modelBadge');
if (modelBadge) modelBadge.onclick = () => openPanel('modelPanel');
window.addEventListener('neuli-avatar-ready', e => {
  const a=e.detail || {};
  if (a.pass) showToast(`3D 高模已載入 · ${Number(a.triangles||0).toLocaleString()} tris`);
  else showToast(`3D 模型缺少：${(a.missing||[]).join(', ')}`);
});
window.addEventListener('neuli-avatar-error', () => showToast('3D 高模載入失敗，請檢查模型資產'));

$('#settingsBtn').onclick = () => openPanel('settingsPanel');
$('#historyBtn').onclick = () => openPanel('historyPanel');
$('#panelScrim').onclick = closePanels;
$$('[data-close]').forEach(b => b.onclick = closePanels);

function setupSwitch(el, key, initial, onChange) {
  state[key] = initial;
  const apply = () => {
    el.classList.toggle('on', state[key]);
    el.setAttribute('aria-checked', String(state[key]));
    onChange?.(state[key]);
  };
  apply();
  el.onclick = () => { state[key] = !state[key]; apply(); };
}
setupSwitch($('#ttsToggle'),'tts',true);
setupSwitch($('#subtitleToggle'),'subtitles',true, on => conversationCard.classList.toggle('hidden', !on));
setupSwitch($('#memoryToggle'),'memory',true, on => { if (!on) localStorage.removeItem('neuli.messages'); else persist(); });

$('#clearMemoryBtn').onclick = () => {
  state.messages = [];
  localStorage.removeItem('neuli.messages');
  renderHistory();
  showToast('本機對話已清除');
};

$$('#wardrobe .wardrobe-card').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.outfit === state.outfit);
  btn.onclick = () => {
    state.outfit = btn.dataset.outfit;
    if (avatar) avatar.dataset.outfit = state.outfit;
    avatarCall('setOutfit', state.outfit);
    $$('#wardrobe .wardrobe-card').forEach(x => x.classList.toggle('active', x === btn));
    persist();
    setPresence('換好衣服 · 看著你', 'happy');
    showToast('已換上新穿搭');
  };
});

$$('#scenePicker button').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.scene === state.scene);
  btn.onclick = () => {
    state.scene = btn.dataset.scene;
    app.dataset.scene = state.scene;
    $$('#scenePicker button').forEach(x => x.classList.toggle('active', x === btn));
    persist();
  };
});
app.dataset.scene = state.scene;
if (avatar) avatar.dataset.outfit = state.outfit;
avatarCall('setOutfit', state.outfit);

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if (SR) {
  rec = new SR();
  rec.lang = 'zh-TW';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onstart = () => { state.listening = true; micBtn.classList.add('active'); setPresence('正在聽你說…', 'warm'); $('#composerHint').textContent = '正在聽你說話，再點一次停止'; };
  rec.onresult = e => {
    let transcript = '';
    for (let i=e.resultIndex; i<e.results.length; i++) transcript += e.results[i][0].transcript;
    input.value = transcript;
  };
  rec.onend = () => {
    state.listening = false;
    micBtn.classList.remove('active');
    $('#composerHint').textContent = '按住麥克風不用，點一下開始／停止語音輸入';
    if (input.value.trim()) submitMessage(); else setPresence('看著你 · 微笑', 'warm');
  };
  rec.onerror = e => {
    state.listening = false;
    micBtn.classList.remove('active');
    setPresence('麥克風暫時不可用', 'warm');
    showToast(e.error === 'not-allowed' ? '請允許麥克風權限' : '語音辨識暫時不可用');
  };
  micBtn.onclick = () => {
    try { state.listening ? rec.stop() : rec.start(); } catch {}
  };
} else {
  micBtn.onclick = () => showToast('此瀏覽器未提供內建語音辨識');
}

renderHistory();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
