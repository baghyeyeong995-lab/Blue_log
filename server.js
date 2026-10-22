const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const WebSocket=require('ws');
const PORT=process.env.PORT||3000;
const root=path.join(__dirname,'public');
const dataPath=process.env.DATA_PATH||path.join(__dirname,'profiles.json');
let profiles={};try{profiles=JSON.parse(fs.readFileSync(dataPath,'utf8'))}catch{}
const persist=()=>{try{fs.writeFileSync(dataPath,JSON.stringify(profiles))}catch(e){console.error('저장 실패',e.message)}};
let timer;const saveSoon=()=>{clearTimeout(timer);timer=setTimeout(persist,450)};
const srv=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');let rel=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname.slice(1));const p=path.resolve(root,rel);if(!p.startsWith(root+path.sep)&&p!==path.join(root,'index.html')){res.writeHead(403).end();return}fs.readFile(p,(e,data)=>{if(e){res.writeHead(404).end('Not found');return}res.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.js')?'application/javascript':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data)})});
const wss=new WebSocket.Server({server:srv,maxPayload:20000});const sessions=new Map();
const send=(ws,obj)=>{if(ws.readyState===1)ws.send(JSON.stringify(obj))};
const validName=n=>typeof n==='string'&&n.trim().length>=1&&n.trim().length<=16;
const colors=['#f7b78b','#e1a5cb','#8cd9df','#b5a0ee','#efdb85','#93d49a'];
const publicPlayer=(s)=>({id:s.id,nick:s.nick,avatar:s.avatar,spot:s.spot,x:s.x,y:s.y,z:s.z,diving:s.diving});
function broadcast(){const list=[...sessions.values()].map(publicPlayer);for(const ws of sessions.keys())send(ws,{type:'players',players:list})}
function aggregate(d){const arr=(d||[]).slice(-150).map(x=>({seconds:Math.max(0,Math.min(10800,Number(x.seconds)||0)),restBefore:x.restBefore==null?null:Math.max(0,Math.min(86400,Number(x.restBefore)||0)),place:String(x.place||'바다').slice(0,40),at:String(x.at||'').slice(0,40)}));const times=arr.map(x=>x.seconds);const rests=arr.filter(x=>x.restBefore!==null).map(x=>x.restBefore);return {dives:arr.length,average:times.length?Math.round(times.reduce((a,b)=>a+b,0)/times.length):0,longest:Math.max(0,...times),total:Math.round(times.reduce((a,b)=>a+b,0)),avgRest:rests.length?Math.round(rests.reduce((a,b)=>a+b,0)/rests.length):0,log:arr.slice(-12).reverse()}}
wss.on('connection',ws=>{let hello=false;ws.on('message',buf=>{let m;try{m=JSON.parse(buf)}catch{return}if(!m||typeof m!=='object')return;if(m.type==='hello'){
 if(!validName(m.nick)||!Number.isInteger(m.avatar)||m.avatar<0||m.avatar>5)return send(ws,{type:'error',message:'닉네임이나 캐릭터를 다시 확인해 주세요.'});
 let token=String(m.token||'');if(!/^[a-f0-9]{64}$/.test(token)){token=crypto.randomBytes(32).toString('hex')}
 // Private random token is the credential. Never use nickname as authentication.
 const id=crypto.createHash('sha256').update(token).digest('hex').slice(0,20);
 for(const [other,s] of sessions)if(s.id===id&&other!==ws){send(other,{type:'error',message:'다른 기기에서 같은 프로필로 접속했어요.'});other.close(4000,'replaced')}
 const profile=profiles[id]||{log:[]};profile.nick=m.nick.trim();profile.avatar=m.avatar;profiles[id]=profile;
 sessions.set(ws,{id,nick:profile.nick,avatar:profile.avatar,spot:0,x:620,y:122,z:.55,diving:false});hello=true;send(ws,{type:'welcome',id,token,profile:{nick:profile.nick,avatar:profile.avatar},stats:aggregate(profile.log)});saveSoon();broadcast();return;
 }
 const s=sessions.get(ws);if(!hello||!s)return;
 if(m.type==='move'){s.spot=Math.max(0,Math.min(10,Math.round(Number(m.spot)||0)));s.x=Math.max(0,Math.min(5600,Number(m.x)||620));s.y=Math.max(0,Math.min(3400,Number(m.y)||122));s.z=Math.max(.18,Math.min(.95,Number(m.z)||.55));s.diving=Boolean(m.diving);return}
 if(m.type==='record'&&Array.isArray(m.log)){profiles[s.id].log=m.log.slice(-150);saveSoon();send(ws,{type:'saved',stats:aggregate(profiles[s.id].log)});return}
 if(m.type==='inspect'){const target=profiles[String(m.id||'')];if(!target)return;send(ws,{type:'inspect',id:String(m.id),nick:target.nick,avatar:target.avatar,stats:aggregate(target.log)})}
 if(m.type==='profile'&&validName(m.nick)&&Number.isInteger(m.avatar)&&m.avatar>=0&&m.avatar<=5){s.nick=m.nick.trim();s.avatar=m.avatar;profiles[s.id].nick=s.nick;profiles[s.id].avatar=s.avatar;saveSoon();broadcast()}
 });ws.on('close',()=>{if(sessions.has(ws)){sessions.delete(ws);broadcast()}})});
setInterval(broadcast,180);
srv.listen(PORT,'0.0.0.0',()=>console.log('BLUE LOG multiplayer running on :'+PORT));
