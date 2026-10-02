export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  const text = String(body.text || '').trim().slice(0, 1200);
  if (!text) return Response.json({error:'text required'}, {status:400});

  // Provider-agnostic neural TTS proxy.
  // Audio-only upstream: return audio/*; an optional x-neuli-visemes header is forwarded.
  // Rich upstream: return JSON { audioBase64, mimeType, visemes:[{t,v,w?}] }.
  // v is A/I/U/E/O and t is seconds from the start of audio.
  if (!context.env.TTS_ENDPOINT || !context.env.TTS_API_KEY) {
    return Response.json({error:'neural TTS not configured'}, {status:503});
  }

  const upstream = await fetch(context.env.TTS_ENDPOINT, {
    method:'POST',
    headers:{
      'content-type':'application/json',
      'authorization':`Bearer ${context.env.TTS_API_KEY}`
    },
    body:JSON.stringify({
      text,
      voice: context.env.TTS_VOICE || 'female_zh_tw',
      language:'zh-TW',
      format:'mp3',
      visemes:true
    })
  });
  if (!upstream.ok) return Response.json({error:'TTS upstream failed'}, {status:502});

  const type = upstream.headers.get('content-type') || '';
  if (type.startsWith('audio/')) {
    const headers = {'content-type':type,'cache-control':'no-store'};
    const visemeHeader = upstream.headers.get('x-neuli-visemes');
    if (visemeHeader) headers['x-neuli-visemes'] = visemeHeader;
    return new Response(upstream.body, {headers});
  }

  if (type.includes('application/json')) {
    const data = await upstream.json().catch(() => null);
    if (!data?.audioBase64) return Response.json({error:'TTS JSON requires audioBase64'}, {status:502});
    const visemes = Array.isArray(data.visemes) ? data.visemes.slice(0, 400).map(x => ({
      t: Math.max(0, Number(x.t) || 0),
      v: String(x.v || x.viseme || 'A').toUpperCase().slice(0,1),
      w: Math.max(0, Math.min(1, Number(x.w ?? x.weight ?? 1)))
    })) : [];
    return Response.json({
      audioBase64: String(data.audioBase64),
      mimeType: String(data.mimeType || 'audio/mpeg'),
      visemes
    }, {headers:{'cache-control':'no-store'}});
  }

  return Response.json({error:'TTS upstream did not return audio or supported JSON'}, {status:502});
}
