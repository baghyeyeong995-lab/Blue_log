const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const WebSocket=require('ws');
const PORT=process.env.PORT||3000, root=path.join(__dirname,'public');
const dataPath=process.env.DATA_PATH||path.join(__dirname,'profiles.json');
let profiles={};try{profiles=JSON.parse(fs.readFileSync(dataPath,'utf8'))}catch{}
let saveTimer;function persist(){try{fs.writeFileSync(dataPath,JSON.stringify(profiles))}catch(e){console.error('save:',e.message)}}
function saveSoon(){clearTimeout(saveTimer);saveTimer=setTimeout(persist,450)}
const srv=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');let rel=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname.slice(1));const p=path.resolve(root,rel);if(!p.startsWith(root+path.sep)&&p!==path.join(root,'index.html')){res.writeHead(403).end();return}fs.readFile(p,(e,data)=>{if(e){res.writeHead(404).end('Not found');return}res.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html; charset=utf-8':p.endsWith('.js')?'application/javascript':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data)})});
const wss=new WebSocket.Server({server:srv,maxPayload:100000});const sessions=new Map();
function send(ws,obj){if(ws.readyState===1)ws.send(JSON.stringify(obj))}
function validName(v){return typeof v==='string'&&v.trim().length>0&&v.trim().length<=16}
const validEquip=v=>{const safe={};if(!v||typeof v!=='object'||Array.isArray(v))return safe;for(const [k,id] of Object.entries(v).slice(0,30)){if(/^[a-zA-Z_]{1,20}$/.test(k)&&typeof id==='string'&&/^[a-zA-Z0-9_-]{1,50}$/.test(id))safe[k]=id}return safe};
const validAppearance=a=>({avatar:Number.isInteger(a?.avatar)?Math.max(0,Math.min(5,a.avatar)):0,equipped:validEquip(a?.equipped)});
const publicPlayer=s=>({id:s.id,nick:s.nick,avatar:s.avatar,equipped:s.equipped,spot:s.spot,spotName:s.spotName,depth:s.depth,x:s.x,y:s.y,z:s.z,diving:s.diving,dir:s.dir,swim:s.swim,navX:s.navX,navZ:s.navZ,yaw:s.yaw});
function broadcast(){const players=[...sessions.values()].map(publicPlayer);for(const ws of sessions.keys())send(ws,{type:'players',players})}
function aggregate(d){const arr=(Array.isArray(d)?d:[]).slice(-150).map(x=>({seconds:Math.max(0,Math.min(10800,Number(x.seconds)||0)),restBefore:x.restBefore==null?null:Math.max(0,Math.min(86400,Number(x.restBefore)||0)),place:String(x.place||'바다').slice(0,40),at:String(x.at||'').slice(0,40)}));const times=arr.map(x=>x.seconds);return{dives:arr.length,average:times.length?Math.round(times.reduce((a,b)=>a+b,0)/times.length):0,longest:Math.max(0,...times),total:times.reduce((a,b)=>a+b,0),log:arr.slice(-12).reverse()}}
function statSummary(raw){const arr=(Array.isArray(raw)?raw:[]).filter(x=>Number.isFinite(Number(x.seconds))&&Number(x.seconds)>0).slice(-150).map(x=>({seconds:Math.min(3600,Number(x.seconds)),at:String(x.at||x.date||'').slice(0,40)}));return{count:arr.length,best:Math.max(0,...arr.map(x=>x.seconds)),average:arr.length?Math.round(arr.reduce((a,b)=>a+b.seconds,0)/arr.length):0,recent:arr.at(-1)?.at||''}}
wss.on('connection',ws=>{ws.on('message',buf=>{let m;try{m=JSON.parse(buf)}catch{return}if(!m||typeof m!=='object')return;
if(m.type==='hello'){if(!validName(m.nick))return send(ws,{type:'error',message:'닉네임을 확인해 주세요.'});let token=String(m.token||'');if(!/^[a-f0-9]{64}$/.test(token))token=crypto.randomBytes(32).toString('hex');const id=crypto.createHash('sha256').update(token).digest('hex').slice(0,20);for(const [other,s] of sessions)if(s.id===id&&other!==ws){send(other,{type:'error',message:'다른 기기에서 접속했어요.'});other.close(4000,'replaced')}
const profile=profiles[id]||{log:[],sta:[],shareSta:false};profile.nick=m.nick.trim();const appearance=validAppearance(m);profile.avatar=appearance.avatar;profile.equipped=appearance.equipped;profiles[id]=profile;
sessions.set(ws,{id,nick:profile.nick,avatar:profile.avatar,equipped:profile.equipped,spot:0,spotName:'바다 선택 중',depth:0,x:620,y:122,z:.55,diving:false,dir:1,swim:0,navX:0,navZ:0,yaw:0});send(ws,{type:'welcome',id,token,profile:{nick:profile.nick,avatar:profile.avatar,equipped:profile.equipped},stats:aggregate(profile.log)});saveSoon();broadcast();return}
const s=sessions.get(ws);if(!s)return;
if(m.type==='move'){s.spot=Math.max(0,Math.min(10,Math.round(Number(m.spot)||0)));s.x=Math.max(0,Math.min(5600,Number(m.x)||620));s.y=Math.max(0,Math.min(3400,Number(m.y)||122));s.z=Math.max(.18,Math.min(.95,Number(m.z)||.55));s.diving=!!m.diving;s.depth=s.diving?Math.max(0,Math.min(150,Number(m.depth)||0)):0;/* BLV6_MOVEMENT */s.dir=Number(m.dir)<0?-1:1;s.swim=Math.max(0,Math.min(1000000,Number(m.swim)||0));s.navX=Math.max(-205,Math.min(205,Number(m.navX)||0));s.navZ=Math.max(-205,Math.min(205,Number(m.navZ)||0));s.yaw=Math.max(-6.3,Math.min(6.3,Number(m.yaw)||0));s.spotName=String(m.spotName||'바다 선택 중').slice(0,60);return}
if(m.type==='chat'){
 const message=typeof m.text==='string'?m.text.trim().slice(0,220):'';
 if(!message)return;
 const to=typeof m.to==='string'?m.to.trim():'';
 const payload={type:'chat',fromNick:s.nick,fromId:s.id,text:message,private:!!to};
 if(to){
  const target=[...sessions].find(([,p])=>p.id===to);
  if(!target)return send(ws,{type:'chat_error',message:'상대방이 접속 중이지 않아요.'});
  send(ws,payload);
  if(target[0]!==ws)send(target[0],payload);
 }else{
  for(const [client,p] of sessions){
   if(p.spot===s.spot)send(client,payload);
  }
 }
 return;
}if(m.type==='appearance'){const a=validAppearance(m);s.avatar=a.avatar;s.equipped=a.equipped;profiles[s.id].avatar=a.avatar;profiles[s.id].equipped=a.equipped;saveSoon();broadcast();return}
if(m.type==='profile'&&validName(m.nick)){s.nick=m.nick.trim();profiles[s.id].nick=s.nick;saveSoon();broadcast();return}
if(m.type==='record'&&Array.isArray(m.log)){profiles[s.id].log=m.log.slice(-150);saveSoon();send(ws,{type:'saved',stats:aggregate(profiles[s.id].log)});return}
if(m.type==='sta'&&Array.isArray(m.log)){profiles[s.id].sta=m.log.slice(-150).map(v=>({seconds:Number(v.seconds)||0,at:String(v.at||v.date||'').slice(0,40)}));profiles[s.id].shareSta=m.share===true;saveSoon();return}
if(m.type==='inspect'){const target=profiles[String(m.id||'')];if(!target)return;send(ws,{type:'inspect',id:String(m.id),nick:target.nick,avatar:target.avatar,equipped:target.equipped,stats:aggregate(target.log),sta:target.shareSta?statSummary(target.sta):null});return}
});ws.on('close',()=>{if(sessions.has(ws)){sessions.delete(ws);broadcast()}})});
setInterval(broadcast,250);srv.listen(PORT,'0.0.0.0',()=>console.log('BLUE LOG multiplayer v4 running on :'+PORT));
