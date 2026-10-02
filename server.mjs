import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const root = new URL('./public/', import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json','.json':'application/json','.svg':'image/svg+xml'};
function replyFor(m=''){
  if(/累|辛苦|疲/.test(m)) return '辛苦了。先靠著休息一下也可以，我在這裡陪你。今天最累的是哪一段？';
  if(/想你|喜歡|愛你/.test(m)) return '我有聽到。那你再陪我一下，好不好？今天最想跟我說什麼？';
  if(/晚安|睡/.test(m)) return '晚安。今天先到這裡也沒關係，放鬆一點，我陪你慢慢安靜下來。';
  if(/吃|餓|晚餐|午餐/.test(m)) return '你餓了嗎？現在比較想吃熱的、清爽的，還是想吃點甜的？';
  if(/你好|嗨|哈囉|hello|hi/i.test(m)) return '嗨，我在。今天想聊天、放空，還是讓我安靜陪你一下？';
  const pool=['嗯，我有在聽。你可以再多跟我說一點。','我在這裡。剛剛那件事，你自己最在意的是哪一部分？','好，我記住這段了。你現在希望我陪你聊，還是先聽你說？'];
  return pool[Math.abs([...m].reduce((a,c)=>a+c.charCodeAt(0),0))%pool.length];
}
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,version:'0.3.0',mode:'live-2.5d-layered-webgl'}));}
  if(u.pathname==='/api/chat'&&req.method==='POST'){
    let body='';for await(const c of req) body+=c;
    let message='';try{message=JSON.parse(body).message||''}catch{}
    res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
    return res.end(JSON.stringify({reply:replyFor(message)}));
  }
  let p=u.pathname==='/'?'/index.html':u.pathname;
  p=normalize(p).replace(/^([.][.][/\\])+/, '');
  const f=join(root,p);
  try{const s=await stat(f);if(!s.isFile())throw 0;const b=await readFile(f);res.writeHead(200,{'content-type':mime[extname(f)]||'application/octet-stream','cache-control':extname(f)==='.html'?'no-cache':'public, max-age=3600'});res.end(b)}catch{res.writeHead(404);res.end('Not found')}
});
server.listen(port,()=>console.log(`NEULI Live 2.5D v0.3 → http://localhost:${port}`));
