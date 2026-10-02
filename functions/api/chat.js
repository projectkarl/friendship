export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  const message = String(body.message || '').trim();
  if (!message) return Response.json({error:'message required'}, {status:400});

  // Provider-agnostic Cloudflare Pages Function.
  // Configure AI_ENDPOINT, AI_API_KEY and AI_MODEL in Cloudflare environment variables.
  if (!context.env.AI_ENDPOINT || !context.env.AI_API_KEY || !context.env.AI_MODEL) {
    return Response.json({error:'AI provider not configured'}, {status:503});
  }

  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
  const messages = [
    {
      role: 'system',
      content: 'You are Haneul, a fictional 23-year-old adult virtual companion. Reply naturally in Traditional Chinese by default. Keep responses warm, concise, non-manipulative, and never pretend to be a real human. Do not pressure the user to depend on you or isolate from real people.'
    },
    ...history.map(x => ({role: x.role === 'assistant' ? 'assistant' : 'user', content: String(x.text || '')})),
    {role:'user', content:message}
  ];

  const upstream = await fetch(context.env.AI_ENDPOINT, {
    method:'POST',
    headers:{'content-type':'application/json','authorization':`Bearer ${context.env.AI_API_KEY}`},
    body:JSON.stringify({model:context.env.AI_MODEL,messages,temperature:.8})
  });

  if (!upstream.ok) return Response.json({error:'upstream failed'}, {status:502});
  const data = await upstream.json();
  const reply = data?.choices?.[0]?.message?.content || data?.reply || '';
  if (!reply) return Response.json({error:'empty upstream reply'}, {status:502});
  return Response.json({reply});
}
