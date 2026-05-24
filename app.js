'use strict';


const state={
  loc:null,
  savedLoc:null,
  activePanel:null,
  settings:{package:'none',active:[]},
  hiddenMics:[],
  adsb:{state:'idle',source:null,preferred:null,lastFetch:null,planes:[],error:null},
  search:{loading:false,results:[]},
  analyzed:[],
  sweep:0,
  prevSweep:0,
  rafLast:null,
  timer:null
};

function micIds(){
  return (state.settings.active||[]).filter(id=>MICS[id]);
}

function packageIds(){
  return PACKAGES[state.settings.package]?.mics||[];
}

function activeMicIds(){
  return micIds().filter(id => MICS[id] && psMicHasUsableRange(MICS[id]));
}

function hiddenMicSet(){
  return new Set(state.hiddenMics||[]);
}

function visibleMicEntries(){
  const hidden=hiddenMicSet();
  return Object.entries(MICS).filter(([id])=>!hidden.has(id));
}

function hideOrDeleteMic(id){
  if(!MICS[id])return;

  const micName=MICS[id].name||MICS[id].short||"this mic";
  const confirmed=window.confirm("Delete " + micName + " from the mic list?");

  if(!confirmed)return;

  const active=new Set(activeMicIds());
  active.delete(id);
  state.settings.package='custom';
  state.settings.active=[...active];

  if(id.startsWith('custom_')){
    delete MICS[id];
    saveCustomMics();
  }else{
    const hidden=hiddenMicSet();
    hidden.add(id);
    state.hiddenMics=[...hidden];
    write(STORE_HIDDEN,state.hiddenMics);
  }

  write(STORE_SETTINGS,state.settings);
  render();
  if(state.loc)fetchFeed();
}

function selectedMics(){
  const ids=activeMicIds();
  if(!ids.length)return [HUMAN_BASELINE];
  return ids.map((id,i)=>({id,...MICS[id],color:RING_COLORS[i%RING_COLORS.length]}));
}

function rangeSettings(){
  const mics=selectedMics();
  let mic=HUMAN_BASELINE.mic,hot=HUMAN_BASELINE.hot,tail=HUMAN_BASELINE.tail,ceil=HUMAN_BASELINE.ceil;
  mics.forEach(m=>{mic=Math.max(mic,m.mic);hot=Math.max(hot,m.hot);tail=Math.max(tail,m.tail);ceil=Math.max(ceil,m.ceil)});
  // Keep extra radar space so aircraft about 60 seconds before mic-range entry remain visible.
  const oneMinuteLeadKm=18;
  const radar=Math.max(12,Math.ceil(Math.max(mic*1.55,mic+oneMinuteLeadKm)/4)*4);
  return {mic,hot,tail,ceil,radar,mics,usingHuman:!activeMicIds().length};
}

function syncPackage(id){
  state.settings.package=id;
  if(id!=='custom')state.settings.active=[...PACKAGES[id].mics];
  write(STORE_SETTINGS,state.settings);
}

function saveCustomMics(){
  const custom={};
  Object.entries(MICS).forEach(([id,m])=>{if(id.startsWith('custom_'))custom[id]=m});
  write(STORE_CUSTOM,custom);
}

function normText(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
}

function findMicMatch(query){
  const q=normText(query);
  if(!q)return null;
  return Object.entries(MICS).find(([id,m])=>{
    const n=normText(m.name);
    const sh=normText(m.short);
    const aliases=(m.aliases||[]).map(normText);
    return n.includes(q)||q.includes(n)||sh.includes(q)||q.includes(sh)||aliases.some(a=>a&&((a.includes(q)||q.includes(a))));
  })||null;
}

function isVerifiedMicRecord(raw){
  if(!raw||typeof raw!=='object')return false;
  const status=String(raw.status||raw.confidence||'').toLowerCase();
  if(!(status==='verified'||status==='verified-database'||status==='verified_database'))return false;

  const required=[raw.name,raw.mic,raw.hot,raw.tail,raw.ceil];
  if(required.some(v=>v===undefined||v===null||String(v).trim()===''))return false;

  const mic=Number(raw.mic),hot=Number(raw.hot),tail=Number(raw.tail),ceil=Number(raw.ceil);
  if(!isFinite(mic)||!isFinite(hot)||!isFinite(tail)||!isFinite(ceil))return false;
  if(mic<=0||mic>80||hot<=0||hot>mic||tail<0||tail>600||ceil<1000||ceil>50000)return false;
  return true;
}

function normalizeMicRecord(raw){
  if(!isVerifiedMicRecord(raw))return null;
  const name=String(raw.name||'').trim();
  return {
    name,
    short:String(raw.short||name).replace(/\s+/g,' ').slice(0,22),
    kind:String(raw.kind||'verified'),
    mic:Math.round(Number(raw.mic)*10)/10,
    hot:Math.round(Number(raw.hot)*10)/10,
    tail:Math.round(Number(raw.tail)),
    ceil:Math.round(Number(raw.ceil)/500)*500,
    manufacturer:raw.manufacturer||'',
    sensitivity:raw.sensitivity ?? raw.sensitivityMvPa ?? null,
    selfNoiseDba:raw.selfNoiseDba ?? null,
    aliases:Array.isArray(raw.aliases)?raw.aliases:[],
    status:'verified',
    confidence:String(raw.confidence||'verified-database')
  };
}

async function lookupFromSameOriginDatabase(query){
  try{
    const res=await fetch(SAME_ORIGIN_MIC_DB,{cache:'no-store'});
    if(!res.ok)return null;
    const data=await res.json();
    const list=Array.isArray(data)?data:Object.values(data||{});
    const q=normText(query);
    const raw=list.find(m=>{
      const n=normText(m.name);
      const sh=normText(m.short);
      const aliases=(m.aliases||[]).map(normText);
      return n===q||sh===q||aliases.includes(q)||q.includes(sh)||aliases.some(a=>a&&q.includes(a));
    });
    return normalizeMicRecord(raw);
  }catch{return null}
}

async function lookupFromEndpoint(query){
  if(!MIC_LOOKUP_ENDPOINT)return null;
  try{
    const res=await fetch(MIC_LOOKUP_ENDPOINT+'?model='+encodeURIComponent(query),{cache:'no-store'});
    if(!res.ok)return null;
    return normalizeMicRecord(await res.json());
  }catch{return null}
}

async function lookupMicModel(query){
  const local=findMicMatch(query);
  if(local)return local;

  const endpoint=await lookupFromEndpoint(query);
  const sameOrigin= endpoint ? null : await lookupFromSameOriginDatabase(query);
  const record=endpoint||sameOrigin;
  if(!record)return null;

  const id='custom_'+normText(record.name).slice(0,28)+'_'+Date.now().toString(36);
  MICS[id]=record;
  saveCustomMics();
  return [id,record];
}

async function addManualMic(){
  const name=$('customMicName').value.trim();
  const msg=$('customMicMsg');
  msg.classList.remove('hidden');
  msg.className='msg';
  if(!name){msg.textContent='Enter a mic model.';return}

  $('customMicBtn').disabled=true;
  $('customMicBtn').textContent='Searching';
  try{
    const found=await lookupMicModel(name);
    if(!found){
      msg.textContent='mic unknown';
      return;
    }
    const [id,m]=found;
    const active=new Set(activeMicIds());
    active.add(id);
    state.settings.package='custom';
    state.settings.active=[...active];
    write(STORE_SETTINGS,state.settings);
    msg.className='msg ok';
    msg.textContent=`Added ${m.name}.`;
    $('customMicName').value='';
    render();
    if(state.loc)fetchFeed();
  }finally{
    $('customMicBtn').disabled=false;
    $('customMicBtn').textContent='Search';
  }
}

function aircraftTypeFactor(t){
  t=String(t||'').toUpperCase();
  if(!t||t==='?')return 1;
  if(t.includes('A388'))return 1.8;
  if(t.includes('B748')||t.includes('B744'))return 1.65;
  if(/^B77|^B78|^A35|^A34|^A33/.test(t))return 1.45;
  if(/^B76|^B75|^A30|^A31/.test(t))return 1.3;
  if(/^B73|^A32|^A22|^E19|^E29|^BCS/.test(t))return 1.08;
  if(/^E17|^E75|^CRJ|^DH8|^AT[47]/.test(t))return .85;
  if(/^C1|^C2|^P28|^SR2|^BE|^PA/.test(t))return .65;
  if(/^H|^R44|^R66/.test(t))return .9;
  return 1;
}

function planeNow(ac){
  const dt=state.adsb.lastFetch?(Date.now()-state.adsb.lastFetch)/1000:0;
  const gs=(ac.gs||0)*NM_TO_KM/3600;
  const tr=(ac.track||0)*D2R;
  const vx=gs*Math.sin(tr);
  const vy=gs*Math.cos(tr);
  let lat=ac.lat,lon=ac.lon;
  if(state.loc&&dt>0&&lat!=null&&lon!=null){
    lat+=vy*dt/KM_PER_LAT;
    lon+=vx*dt/(KM_PER_LAT*Math.cos(state.loc.lat*D2R));
  }
  return {...ac,lat,lon,vx,vy};
}

function analyze(ac){
  if(!state.loc||ac.lat==null||ac.lon==null)return null;
  const rs=rangeSettings();
  const altFt=typeof ac.alt_baro==='number'?ac.alt_baro:null;
  if(altFt==null||altFt<0)return null;

  const p=planeNow(ac);
  const pos=xy(p.lat,p.lon,state.loc.lat,state.loc.lon);
  const h=Math.hypot(pos.x,pos.y);
  const altKm=(altFt/FT_PER_M)/1000;
  const slant=Math.hypot(h,altKm);
  const tooHigh=altFt>rs.ceil||rs.mic<=altKm;

  let entry=null,exit=null,inMic=false;
  if(!tooHigh){
    const hT=Math.sqrt(Math.max(0,rs.mic*rs.mic-altKm*altKm));
    const v2=p.vx*p.vx+p.vy*p.vy;
    inMic=h<=hT;
    if(v2>1e-9){
      const b=2*(pos.x*p.vx+pos.y*p.vy);
      const c=h*h-hT*hT;
      const disc=b*b-4*v2*c;
      if(disc>=0){
        const sq=Math.sqrt(disc);
        const t1=(-b-sq)/(2*v2);
        const t2=(-b+sq)/(2*v2);
        if(t2>=0){entry=t1>0?t1:0;exit=t2+rs.tail}
      }
    }else if(inMic){entry=0;exit=rs.tail}
  }

  const status=tooHigh?'high':inMic?'audible':(entry!=null?'approaching':'clear');
  const typeFactor=aircraftTypeFactor(ac.t);
  const altFactor=clamp(1.25-(altFt/rs.ceil),.28,1.12);
  const distFactor=status==='audible'
    ? clamp(1.2-(h/rs.mic),.2,1.15)
    : status==='approaching'
      ? clamp(1-(Math.max(0,entry)/900),.15,.75)
      : .12;
  const risk=clamp(typeFactor*altFactor*distFactor, .1, 1.55);

  return {
    raw:ac,
    icao:ac.hex||Math.random().toString(36),
    callsign:(ac.flight||'').trim()||(ac.hex||'').toUpperCase(),
    type:ac.t||'?',
    altFt,gs:ac.gs||0,track:ac.track||0,
    x:pos.x,y:pos.y,vx:p.vx,vy:p.vy,h,slant,
    bearing:brg(state.loc.lat,state.loc.lon,p.lat,p.lon),
    soundDelay:slant*1000/SOUND_SPEED,
    entry,exit,status,tooHigh,typeFactor,risk
  };
}

function recompute(){
  state.analyzed=state.adsb.planes
    .map(analyze)
    .filter(Boolean)
    .sort((a,b)=>({audible:0,approaching:1,clear:2,high:3}[a.status]-{audible:0,approaching:1,clear:2,high:3}[b.status])||a.h-b.h);
}

function counts(){
  const audible=state.analyzed.filter(p=>p.status==='audible').length;
  const approaching=state.analyzed.filter(p=>p.status==='approaching').length;
  const tracked=state.analyzed.length;
  return {audible,approaching,tracked};
}

function render(){
  recompute();
  renderMeta();
  renderBanner();
  renderPanels();
  renderErr();
  renderAircraftList();
  resizeCanvas();
}

function renderMeta(){
  // intentionally hidden in the main interface
}


function fitHeadline(){
  const h=$('headline');
  const banner=$('banner');
  if(!h||!banner)return;

  const rect=banner.getBoundingClientRect();
  const style=getComputedStyle(banner);
  const padX=parseFloat(style.paddingLeft)+parseFloat(style.paddingRight);
  const padY=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom);

  const availableW=Math.max(120,rect.width-padX-16);
  const availableH=Math.max(34,rect.height-padY-4);
  const label=h.textContent||'';
  const isClear=label==='CLEAR';

  h.style.setProperty('width','100%','important');
  h.style.setProperty('max-width','100%','important');
  h.style.setProperty('text-align','center','important');
  h.style.setProperty('white-space','nowrap','important');
  h.style.setProperty('overflow','hidden','important');
  h.style.setProperty('text-overflow','clip','important');
  h.style.setProperty('line-height','.9','important');

  const canvas=fitHeadline._canvas||(fitHeadline._canvas=document.createElement('canvas'));
  const ctx=canvas.getContext('2d');

  const maxSize=isClear?110:104;
  const minSize=16;
  let chosen=minSize;

  for(let s=maxSize;s>=minSize;s--){
    ctx.font='800 '+s+'px -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif';
    const measured=ctx.measureText(label).width;
    const fitsWidth=measured<=availableW;
    const fitsHeight=(s*.92)<=availableH;

    if(fitsWidth&&fitsHeight){
      chosen=s;
      break;
    }
  }

  h.style.setProperty('font-size',chosen+'px','important');
}


// === Plane Sound delayed connection lost logic ===
// Do not show CONNECTION LOST for short feed hiccups.
// Keep using last known aircraft state until the feed is stale enough that movement prediction is no longer trustworthy.
const CONNECTION_LOST_DELAY_MS = 30000;

function psTimeMs(value){
  if(!value)return null;
  if(typeof value==='number' && Number.isFinite(value))return value;
  const parsed=Date.parse(value);
  return Number.isFinite(parsed)?parsed:null;
}

function psFeedAgeMs(){
  const last=psTimeMs(state.adsb.lastFetch);
  if(!last)return Infinity;
  return Date.now()-last;
}

function psConnectionLostVisible(){
  if(state.adsb.state!=='error'){
    state.adsb.errorSince=null;
    return false;
  }

  const now=Date.now();

  if(!state.adsb.errorSince){
    state.adsb.errorSince=now;
  }

  const errorAge=now-state.adsb.errorSince;
  const feedAge=psFeedAgeMs();

  if(state.adsb.lastFetch){
    return feedAge>=CONNECTION_LOST_DELAY_MS;
  }

  return errorAge>=CONNECTION_LOST_DELAY_MS;
}
// === End delayed connection lost logic ===

function renderBanner(){
  const c=counts();
  const banner=$('banner');
  const rs=rangeSettings();

  banner.className='banner no-count';
  $('bigCount').textContent='';
  $('countLabel').textContent='';
  $('statusLeft').textContent='';
  $('statusRight').textContent='';

  if(!state.loc){
    $('headline').textContent='NO LOCATION';
    fitHeadline();
    return;
  }

  if(typeof psConnectionLostVisible==='function' && psConnectionLostVisible()){
    banner.className='banner bad no-count';
    $('headline').textContent='CONNECTION LOST';
    fitHeadline();
    return;
  }

  if(c.audible>0){
    banner.className='banner bad no-count';
    const rangeText=rs.usingHuman?'HEARING RANGE':'MIC RANGE';
    $('headline').textContent=c.audible+' AIRCRAFT IN '+rangeText;
  }else{
    banner.className='banner clear no-count';
    $('headline').textContent='CLEAR';
  }

  fitHeadline();
}

function renderPanels(){
  $('micPanel').classList.toggle('hidden',state.activePanel!=='mics');
  $('aircraftPanel').classList.toggle('hidden',state.activePanel!=='aircraft');
  $('locationPanel').classList.toggle('hidden',state.activePanel!=='location');
  $('tabMics').classList.toggle('active',state.activePanel==='mics');
  $('tabAircraft').classList.toggle('active',state.activePanel==='aircraft');
  $('tabLocation').classList.toggle('active',state.activePanel==='location');

  const active=new Set(activeMicIds());

  $('chipGrid').innerHTML=visibleMicEntries().map(([id,m])=>{
    const pending=typeof psMicRangePending==='function'?psMicRangePending(m):false;
    return `<button class="chip ${active.has(id)?'active':''} ${pending?'pending':''}" data-mic="${id}">
      ${esc(m.displayName||m.name||m.short||id)}
      <span class="chip-edit" data-edit-mic="${id}" title="Edit mic specs">EDIT</span>
      <span class="chip-x" data-delete-mic="${id}" title="Remove mic">DEL</span>
    </button>`;
  }).join('');

  $('rangeRead').innerHTML='';

  $('results').classList.toggle('hidden',!state.search.results.length);
  $('results').innerHTML=state.search.results.map((r,i)=>
    `<button class="result" data-i="${i}"><div class="rmain">${esc(r.shortLabel)}</div><div class="rsub">${esc(r.fullLabel)}</div></button>`
  ).join('');

  if(typeof psWireMicSpecEditor==='function')psWireMicSpecEditor();
}

function renderErr(){
  const el=$('err');
  el.classList.add('hidden');
  el.innerHTML='';
}

function planeCard(p){
  const label=p.status==='audible'?'In mic range':p.status==='approaching'?'Approaching':p.status==='clear'?'Tracked':'High';
  const timing=p.status==='audible'&&p.exit!=null?'-'+fmt(p.exit):p.entry!=null?'+'+fmt(p.entry):'—';
  return `<div class="planeCard ${p.status}">
    <div class="planeHead"><span class="callsign">${esc(p.callsign)}</span><span class="pill">${label}</span></div>
    <div class="grid">
      <div><span class="lbl">DIST</span><span class="val">${p.h.toFixed(1)} km ${dir(p.bearing)}</span></div>
      <div><span class="lbl">TIME</span><span class="val">${timing}</span></div>
      <div><span class="lbl">ALT</span><span class="val">${Math.round(p.altFt).toLocaleString()} ft</span></div>
      <div><span class="lbl">TYPE</span><span class="val">${esc(p.type)}</span></div>
      <div><span class="lbl">SPD</span><span class="val">${Math.round(p.gs)} kt</span></div>
      <div><span class="lbl">HDG</span><span class="val">${Math.round(p.track)}° ${dir(p.track)}</span></div>
    </div>
  </div>`;
}

function renderAircraftList(){
  if(!state.analyzed.length){
    $('aircraftList').innerHTML='<div class="empty">No aircraft in current radar range</div>';
    return;
  }
  $('aircraftList').innerHTML=state.analyzed.slice(0,18).map(planeCard).join('');
}

function resizeCanvas(){
  const c=$('radar');
  const wrap=c.parentElement;
  const dpr=window.devicePixelRatio||1;
  const vv=window.visualViewport?.height||window.innerHeight;
  const app=document.querySelector('.app');
  const nonRadar=[...app.children].filter(el=>el!==wrap&&!el.classList.contains('hidden'));
  const used=nonRadar.reduce((s,el)=>s+el.getBoundingClientRect().height,0)+(nonRadar.length+1)*6+16;
  const availH=Math.max(280,vv-used);
  const w=Math.floor(Math.max(280,wrap.clientWidth-8));
  const h=Math.floor(availH);
  c.width=Math.floor(w*dpr);
  c.height=Math.floor(h*dpr);
  c.style.width=w+'px';
  c.style.height=h+'px';
}

function drawRadar(){
  const c=$('radar');
  const dpr=window.devicePixelRatio||1;
  const ctx=c.getContext('2d');
  const W=c.width/dpr,H=c.height/dpr;
  const cx=W/2,cy=H/2;
  const pad=18;

  // Use one uniform scale so radar geometry stays true circular.
  // gridR is kept inside the panel so the outer radar rings are never clipped.
  // effectR reaches the farthest panel corner so glow/sweep still fill the rectangle.
  const farR=Math.hypot(Math.max(cx,W-cx),Math.max(cy,H-cy))+18;
  const effectR=Math.max(120,farR);
  const gridR=Math.max(120,Math.min(W,H)/2-pad);
  const baseR=gridR;
  const uiScale=clamp(baseR/420,.55,1.12);
  const rs=rangeSettings();
  const scale=gridR/rs.radar;

  ctx.clearRect(0,0,c.width,c.height);
  ctx.save();
  ctx.scale(dpr,dpr);
  ctx.fillStyle='#020907';
  ctx.fillRect(0,0,W,H);

  // Full-panel atmospheric glow.
  const bg=ctx.createRadialGradient(cx,cy,0,cx,cy,effectR);
  bg.addColorStop(0,'#061510');
  bg.addColorStop(.58,'#03100b');
  bg.addColorStop(1,'#020907');
  ctx.fillStyle=bg;
  ctx.fillRect(0,0,W,H);

  // Circular radar grid. Circles remain round and fully visible inside the panel.
  ctx.strokeStyle='rgba(0,100,60,.17)';
  ctx.lineWidth=.7;
  [.25,.5,.75,1].forEach(k=>{
    ctx.beginPath();
    ctx.arc(cx,cy,gridR*k,0,Math.PI*2);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.moveTo(cx,0);ctx.lineTo(cx,H);
  ctx.moveTo(0,cy);ctx.lineTo(W,cy);
  ctx.stroke();

  // Selected mic/hearing rings: always perfect circles.
  rs.mics
    .slice()
    .sort((a,b)=>b.mic-a.mic)
    .forEach((m,idx)=>{
      const rr=m.mic*scale;
      ctx.setLineDash([8,6]);
      ctx.strokeStyle=m.color;
      ctx.lineWidth=2.2;
      ctx.beginPath();
      ctx.arc(cx,cy,rr,0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
      if(!rs.usingHuman && !m.human){
        const label=`${m.short}`;
        const angle=(-90+idx*18)*D2R;
        let lx=cx+Math.cos(angle)*rr;
        let ly=cy+Math.sin(angle)*rr;
        ctx.font=`bold ${Math.round(20*uiScale)}px 'Saira Condensed'`;
        ctx.textAlign='center';
        const tw=ctx.measureText(label).width+(10*uiScale);
        const bh=24*uiScale;
        lx=clamp(lx,tw/2+4,W-tw/2-4);
        ly=clamp(ly,bh*.75+4,H-bh*.25-4);
        ctx.fillStyle='rgba(0,12,8,.78)';
        ctx.fillRect(lx-tw/2,ly-bh*.55,tw,bh);
        ctx.fillStyle=m.color;
        ctx.fillText(label,lx,ly+6*uiScale);
      }
    });

  // Sweep fan reaches the farthest rectangle corner while rings stay fully visible.
  const sr=(state.sweep-90)*D2R;
  for(let i=0;i<30;i++){
    const t=i/30;
    const a0=sr-(1-t+1/30)*1.1;
    const a1=sr-(1-t)*1.1;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,effectR,a0,a1);
    ctx.closePath();
    ctx.fillStyle=`rgba(0,255,110,${(1-t)*.055})`;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx,cy);
  ctx.lineTo(cx+effectR*Math.cos(sr),cy+effectR*Math.sin(sr));
  ctx.strokeStyle='rgba(0,255,100,.92)';
  ctx.lineWidth=1.5;
  ctx.stroke();

  // Cardinal labels sit against the rectangular panel edges.
  ctx.fillStyle='rgba(80,150,95,.6)';
  ctx.font=`bold ${Math.round(13*uiScale)}px 'Saira Condensed'`;
  ctx.textAlign='center';
  ctx.fillText('N',cx,pad);
  ctx.fillText('S',cx,H-pad+4*uiScale);
  ctx.fillText('E',W-pad,cy+4*uiScale);
  ctx.fillText('W',pad,cy+4*uiScale);

  state.analyzed.forEach(p=>{
    if(p.status==='high'&&p.h>rs.radar)return;
    const px=cx+p.x*scale;
    const py=cy-p.y*scale;
    const margin=80*uiScale;
    if(px < -margin || px > W + margin || py < -margin || py > H + margin)return;

    const col=p.status==='audible'?'#ff5050':p.status==='approaching'?'#ffd040':p.status==='clear'?'#00ff8a':'#607070';

    if(p.entry!=null&&p.exit!=null){
      ctx.beginPath();
      ctx.moveTo(px,py);
      ctx.lineTo(cx+(p.x+p.vx*120)*scale,cy-(p.y+p.vy*120)*scale);
      ctx.strokeStyle=p.status==='audible'?'rgba(255,80,80,.35)':'rgba(255,210,60,.3)';
      ctx.setLineDash([4,6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const size=clamp((9+p.risk*8)*uiScale,5,22*uiScale);
    ctx.save();
    ctx.translate(px,py);
    ctx.rotate(p.track*D2R);
    ctx.beginPath();
    ctx.moveTo(0,-size);
    ctx.lineTo(size*.58,size*.78);
    ctx.lineTo(0,size*.35);
    ctx.lineTo(-size*.58,size*.78);
    ctx.closePath();
    ctx.fillStyle=col;
    ctx.shadowColor=col;
    ctx.shadowBlur=p.status==='audible'?12:6;
    ctx.globalAlpha=p.status==='high'?0.55:1;
    ctx.fill();
    ctx.restore();

    let tag='';
    if(p.status==='audible'&&p.exit!=null)tag='-'+fmt(p.exit);
    else if(p.entry!=null)tag='+'+fmt(p.entry);

    if(tag){
      const tagFont=Math.round(16*uiScale);
      const tagPad=5*uiScale;
      const tagH=24*uiScale;
      ctx.font=`bold ${tagFont}px 'JetBrains Mono'`;
      ctx.textAlign='left';
      const w=ctx.measureText(tag).width+tagPad*2;
      let x=px+size*.7;
      let y=py-size-(16*uiScale);
      x=clamp(x,4,W-w-4);
      y=clamp(y,4,H-tagH-4);
      ctx.fillStyle='rgba(0,0,0,.78)';
      ctx.fillRect(x,y,w,tagH);
      ctx.strokeStyle=col;
      ctx.strokeRect(x,y,w,tagH);
      ctx.fillStyle=col;
      ctx.fillText(tag,x+tagPad,y+tagH*.7);
    }
  });

  ctx.beginPath();ctx.arc(cx,cy,5,0,Math.PI*2);ctx.fillStyle='#d4a017';ctx.fill();
  ctx.beginPath();ctx.arc(cx,cy,11,0,Math.PI*2);ctx.strokeStyle='rgba(212,160,23,.35)';ctx.stroke();

  ctx.restore();
}

async function geocode(q){
  const ctrl=new AbortController();
  const to=setTimeout(()=>ctrl.abort(),10000);
  try{
    const url=GEOCODE_ENDPOINT
      ? GEOCODE_ENDPOINT+'?q='+encodeURIComponent(q)
      : 'https://nominatim.openstreetmap.org/search?q='+encodeURIComponent(q)+'&format=json&limit=6&addressdetails=1';
    const res=await fetch(url,{signal:ctrl.signal,headers:{'Accept-Language':'en'}});
    clearTimeout(to);
    if(!res.ok)throw Error(res.status);
    const data=await res.json();
    return data.map(r=>{
      const a=r.address||{};
      const place=a.house_number&&a.road?a.house_number+' '+a.road:a.road||a.neighbourhood||a.suburb||a.city||a.town||a.village||a.county||r.shortLabel||'Location';
      const region=a.city||a.town||a.village||a.county||'';
      const country=a.country_code?a.country_code.toUpperCase():'';
      return {
        lat:+(r.lat ?? r.latitude),
        lon:+(r.lon ?? r.longitude),
        shortLabel:r.shortLabel||[place,region!==place?region:null,country].filter(Boolean).join(', '),
        fullLabel:r.fullLabel||r.display_name||r.name||'Location',
        source:'search'
      };
    }).filter(r=>isFinite(r.lat)&&isFinite(r.lon));
  }catch(e){
    clearTimeout(to);
    throw e;
  }
}

async function doSearch(){
  const q=$('searchInput').value.trim();
  if(!q)return;
  state.search.loading=true;
  $('searchBtn').disabled=true;
  $('searchMsg').classList.add('hidden');
  try{
    state.search.results=await geocode(q);
    if(!state.search.results.length){
      $('searchMsg').textContent='No matches found.';
      $('searchMsg').classList.remove('hidden');
    }
  }catch(e){
    $('searchMsg').textContent='Search failed.';
    $('searchMsg').classList.remove('hidden');
  }finally{
    state.search.loading=false;
    $('searchBtn').disabled=false;
    renderPanels();
  }
}

function setLoc(loc){
  state.loc=loc;
  state.savedLoc=loc;
  state.activePanel=null;
  write(STORE_LOC,loc);
  state.search.results=[];
  $('searchInput').value='';
  render();
  startLoop();
}

function gps(auto=false){
  if(!navigator.geolocation){
    $('gpsMsg').textContent='GPS not supported.';
    $('gpsMsg').classList.remove('hidden');
    return;
  }
  $('gpsBtn').disabled=true;
  $('gpsMsg').textContent=auto?'Requesting location…':'Getting location…';
  $('gpsMsg').className='msg ok';
  $('gpsMsg').classList.remove('hidden');

  navigator.geolocation.getCurrentPosition(
    p=>{
      setLoc({
        lat:p.coords.latitude,
        lon:p.coords.longitude,
        shortLabel:'Phone GPS',
        fullLabel:'Phone GPS',
        accuracy:p.coords.accuracy,
        source:'gps'
      });
      $('gpsBtn').disabled=false;
    },
    e=>{
      let msg=e.code===1?'GPS permission denied. Enable location for this browser.':'GPS failed.';
      $('gpsMsg').textContent=msg;
      $('gpsMsg').className='msg';
      $('gpsBtn').disabled=false;
      if(auto)state.activePanel='location';
      renderPanels();
    },
    {enableHighAccuracy:true,timeout:20000,maximumAge:60000}
  );
}

function maybeAutoGps(){
  if(!navigator.geolocation)return;
  gps(true);
}

function manual(){
  const lat=parseFloat($('latInput').value);
  const lon=parseFloat($('lonInput').value);
  if(!isFinite(lat)||!isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return;
  setLoc({lat,lon,shortLabel:'Manual Location',fullLabel:`${lat}, ${lon}`,source:'manual'});
}

async function fetchFeed(){
  if(!state.loc)return;
  state.adsb.state='loading';
  renderMeta();
  const rs=rangeSettings();
  const nm=Math.max(25,Math.ceil(rs.radar*1.85/NM_TO_KM));

  if(AIRCRAFT_ENDPOINT){
    try{
      const ctrl=new AbortController();
      const to=setTimeout(()=>ctrl.abort(),12000);
      const url=AIRCRAFT_ENDPOINT+'?lat='+encodeURIComponent(state.loc.lat)+'&lon='+encodeURIComponent(state.loc.lon)+'&radiusNm='+encodeURIComponent(nm);
      const res=await fetch(url,{signal:ctrl.signal,cache:'no-store'});
      clearTimeout(to);
      if(!res.ok)throw Error(res.status);
      const data=await res.json();
      state.adsb={...state.adsb,state:'ok',source:data.source||'backend',preferred:null,lastFetch:Date.now(),planes:Array.isArray(data.ac)?data.ac:[],error:null};
      render();
      return;
    }catch(e){
      state.adsb.state='error';
      state.adsb.error='backend:'+(e.name==='AbortError'?'timeout':e.message||'failed');
      render();
      return;
    }
  }

  const sources=state.adsb.preferred?[...ADSB].sort((a,b)=>(a.name===state.adsb.preferred?-1:0)-(b.name===state.adsb.preferred?-1:0)):ADSB;
  const errs=[];
  for(const src of sources){
    try{
      const ctrl=new AbortController();
      const to=setTimeout(()=>ctrl.abort(),12000);
      const res=await fetch(src.url(state.loc.lat,state.loc.lon,nm),{signal:ctrl.signal});
      clearTimeout(to);
      if(!res.ok)throw Error(res.status);
      const data=await res.json();
      state.adsb={...state.adsb,state:'ok',source:src.name,preferred:src.name,lastFetch:Date.now(),planes:src.parse(data),error:null};
      render();
      return;
    }catch(e){
      errs.push(src.name+':'+(e.name==='AbortError'?'timeout':e.message||'failed'));
    }
  }
  state.adsb.state='error';
  state.adsb.error=errs.join(' · ');
  render();
}

function startLoop(){
  if(state.timer)clearInterval(state.timer);
  fetchFeed();
  state.timer=setInterval(fetchFeed,REFRESH_MS);
}

function anim(ts){
  if(!state.rafLast)state.rafLast=ts;
  const dt=Math.min((ts-state.rafLast)/1000,.1);
  state.rafLast=ts;
  state.prevSweep=state.sweep;
  state.sweep=(state.sweep+SWEEP_SPEED*dt)%360;
  if(Math.floor(ts/1000)!==Math.floor((ts-dt*1000)/1000)){
    recompute();
    renderMeta();
    renderBanner();
    if(state.activePanel==='aircraft')renderAircraftList();
  }
  drawRadar();
  requestAnimationFrame(anim);
}

function setPanel(name){
  state.activePanel=state.activePanel===name?null:name;
  write(STORE_UI,{activePanel:state.activePanel});
  render();
}


function removeDeprecatedMics(){
  const banned=['atr1100','audio-technica atr1100x','atr1100x','audio technica atr1100x'];
  const bannedNorm=banned.map(normText);
  Object.keys(MICS).forEach(id=>{
    const m=MICS[id]||{};
    const values=[id,m.name,m.short,...(m.aliases||[])].map(normText);
    if(values.some(v=>bannedNorm.includes(v)||v.includes('audiotechnicaatr1100'))){
      delete MICS[id];
    }
  });
  const active=(state.settings.active||[]).filter(id=>MICS[id]);
  if(active.length!==(state.settings.active||[]).length){
    state.settings.active=active;
    write(STORE_SETTINGS,state.settings);
  }
  saveCustomMics();
}


// === Plane Sound strict mic lookup override ===
// Rules:
// - Exact normalized model/name/alias match only.
// - Unknown or unverified mic returns "mic unknown".
// - Existing built-in mic is restored if previously hidden.
// - Existing built-in mic is selected instead of duplicated.

function psMicKey(s){
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function psMicKeys(m){
  if (!m) return [];
  return [
    m.name,
    m.short,
    ...(Array.isArray(m.aliases) ? m.aliases : [])
  ].map(psMicKey).filter(Boolean);
}

function psMicMatchesQuery(query, m){
  const q = psMicKey(query);
  if (!q || !m) return false;
  return psMicKeys(m).includes(q);
}

function psMicRecordsMatch(a, b){
  const ak = psMicKeys(a);
  const bk = psMicKeys(b);
  return ak.some(k => bk.includes(k));
}

function findMicMatch(query){
  return Object.entries(MICS).find(([id, m]) => psMicMatchesQuery(query, m)) || null;
}

function psExistingMicIdForRecord(record){
  for (const [id, m] of Object.entries(MICS)) {
    if (psMicRecordsMatch(record, m)) return id;
  }
  return null;
}

function psUnhideMic(id){
  if (!id || !MICS[id]) return;

  const hidden = new Set(state.hiddenMics || []);
  if (hidden.has(id)) {
    hidden.delete(id);
    state.hiddenMics = [...hidden];
    write(STORE_HIDDEN, state.hiddenMics);
  }
}

function psRemoveDuplicateCustomMics(){
  const seenCustom = [];

  for (const [id, m] of Object.entries(MICS)) {
    if (!id.startsWith("custom_")) continue;

    // Preserve deliberate manual spec copies of built-in mics.
    if (m && (m.baseMicId || m.status === "spec_record")) {
      seenCustom.push(m);
      continue;
    }

    const duplicatesCustom = seenCustom.some(c => psMicRecordsMatch(m, c));

    if (duplicatesCustom) {
      delete MICS[id];
    } else {
      seenCustom.push(m);
    }
  }

  state.settings.active = (state.settings.active || []).filter(id => MICS[id]);
  write(STORE_SETTINGS, state.settings);
  saveCustomMics();
}

async function lookupFromSameOriginDatabase(query){
  try {
    const res = await fetch("mic-specs.json", { cache: "no-store" });
    if (!res.ok) return null;

    const list = await res.json();
    if (!Array.isArray(list)) return null;

    const raw = list.find(m => psMicMatchesQuery(query, m));
    return raw ? normalizeMicRecord(raw) : null;
  } catch {
    return null;
  }
}

async function lookupFromEndpoint(query){
  if (!MIC_LOOKUP_ENDPOINT) return null;

  try {
    const res = await fetch(MIC_LOOKUP_ENDPOINT + "?model=" + encodeURIComponent(query), { cache: "no-store" });
    if (!res.ok) return null;

    const record = normalizeMicRecord(await res.json());
    if (!record) return null;

    return psMicMatchesQuery(query, record) ? record : null;
  } catch {
    return null;
  }
}

async function lookupMicModel(query){
  const local = findMicMatch(query);
  if (local) {
    const [id, m] = local;
    psUnhideMic(id);
    return [id, m];
  }

  const sameOrigin = await lookupFromSameOriginDatabase(query);
  const endpoint = sameOrigin ? null : await lookupFromEndpoint(query);
  const record = sameOrigin || endpoint;

  if (!record) return null;

  const existingId = psExistingMicIdForRecord(record);
  if (existingId) {
    psUnhideMic(existingId);
    return [existingId, MICS[existingId]];
  }

  const id = "custom_" + psMicKey(record.name).slice(0, 28) + "_" + Date.now().toString(36);
  MICS[id] = record;
  saveCustomMics();

  return [id, record];
}

async function addManualMic(){
  const name = $("customMicName").value.trim();
  const msg = $("customMicMsg");

  msg.classList.remove("hidden");
  msg.className = "msg";

  if (!name) {
    msg.textContent = "Enter a mic model.";
    return;
  }

  $("customMicBtn").disabled = true;
  $("customMicBtn").textContent = "Searching";

  try {
    const found = await lookupMicModel(name);

    if (!found) {
      msg.textContent = "mic unknown";
      return;
    }

    const [id, m] = found;

    psUnhideMic(id);
    psRemoveDuplicateCustomMics();

    const active = new Set(activeMicIds());
    active.add(id);

    state.settings.package = "custom";
    state.settings.active = [...active];

    write(STORE_SETTINGS, state.settings);

    msg.className = "msg ok";
    msg.textContent = "Added " + m.name + ".";
    $("customMicName").value = "";

    render();
    if (state.loc) fetchFeed();
  } finally {
    $("customMicBtn").disabled = false;
    $("customMicBtn").textContent = "Search";
  }
}
// === End strict mic lookup override ===


// === Plane Sound manual mic spec editor ===
function psMicHasUsableRange(m){
  if(!m)return false;
  if(m.rangeStatus==='pending')return false;
  if(m.status==='spec_record')return false;

  const vals=[m.mic,m.hot,m.tail,m.ceil].map(Number);
  if(vals.some(v=>!Number.isFinite(v)))return false;

  const mic=vals[0],hot=vals[1],tail=vals[2],ceil=vals[3];
  return mic>0 && hot>0 && hot<=mic && tail>=0 && ceil>0;
}

function psMicRangePending(m){
  return !psMicHasUsableRange(m);
}

function psSpecKey(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
}

function psSpecMsg(text, ok=false){
  const msg=$('micSpecMsg');
  if(!msg)return;
  msg.classList.remove('hidden');
  msg.className=ok?'msg ok':'msg';
  msg.textContent=text;
}

function psShortFromModel(manufacturer,model){
  const clean=String(model||'').trim();
  return clean.slice(0,22) || String(manufacturer||'Mic').slice(0,22);
}

function psSpecManufacturer(m){
  const explicit = psSpecValue(m, ['manufacturer','brand','make']);
  if (explicit) return explicit;

  const name = String((m && (m.name || m.short)) || '').trim();
  if (!name) return '';

  const brands = [
    'Sennheiser',
    'Schoeps',
    'DPA',
    'Sanken',
    'Countryman',
    'Shure',
    'Audio-Technica',
    'Rode',
    'RODE',
    'Deity',
    'Sony',
    'Neumann',
    'AKG',
    'Beyerdynamic'
  ];

  for (const brand of brands) {
    if (name.toLowerCase().startsWith(brand.toLowerCase() + ' ')) {
      return brand === 'RODE' ? 'Rode' : brand;
    }
  }

  return '';
}

function psSpecModel(m){
  if (!m) return '';

  const name = String(m.name || m.short || '').trim();
  const manufacturer = psSpecManufacturer(m);

  if (!name) return '';

  if (manufacturer) {
    const lowerName = name.toLowerCase();
    const lowerBrand = manufacturer.toLowerCase();

    if (lowerName.startsWith(lowerBrand + ' ')) {
      return name.slice(manufacturer.length).trim();
    }
  }

  return name;
}

function psModelFromMicRecord(m){
  return psSpecModel(m);
}


// === Plane Sound mic spec prefill helpers ===
function psSpecValue(m, keys){
  for (const k of keys) {
    const v = m && m[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function psSpecManufacturer(m){
  const explicit = psSpecValue(m, ['manufacturer','brand','make']);
  if (explicit) return explicit;

  const name = String((m && (m.name || m.short)) || '').trim();
  if (!name) return '';

  const brands = [
    'Sennheiser',
    'Schoeps',
    'DPA',
    'Sanken',
    'Countryman',
    'Shure',
    'Audio-Technica',
    'Rode',
    'Deity',
    'Sony',
    'Neumann',
    'AKG',
    'Beyerdynamic'
  ];

  for (const brand of brands) {
    if (name.toLowerCase().startsWith(brand.toLowerCase() + ' ')) {
      return brand;
    }
  }

  return '';
}

function psSpecModel(m){
  if (!m) return '';

  const name = String(m.name || m.short || '').trim();
  const manufacturer = psSpecManufacturer(m);

  if (!name) return '';

  if (manufacturer) {
    const lowerName = name.toLowerCase();
    const lowerBrand = manufacturer.toLowerCase();

    if (lowerName.startsWith(lowerBrand + ' ')) {
      return name.slice(manufacturer.length).trim();
    }
  }

  return name;
}
// === End mic spec prefill helpers ===


// === Plane Sound built-in mic spec preload ===
function psApplySeedMicSpecs(){
  const seedSpecs = {
  "Sennheiser MKH 416": {
    "transducerType": "RF CONDENSER",
    "pickupPattern": "SUPERCARDIOID / LOBAR",
    "frequencyResponse": "40 HZ - 20 KHZ",
    "sensitivity": "25 MV/PA"
  },
  "Sennheiser MKH 8060": {
    "transducerType": "RF CONDENSER",
    "pickupPattern": "SUPERCARDIOID / LOBAR",
    "frequencyResponse": "50 HZ - 25 KHZ",
    "sensitivity": "-24 DBV/PA, 63 MV/PA"
  },
  "Sennheiser MKH 50": {
    "transducerType": "RF CONDENSER",
    "pickupPattern": "SUPERCARDIOID",
    "frequencyResponse": "40 HZ - 20 KHZ",
    "sensitivity": "25 MV/PA"
  },
  "Schoeps CMIT 5U": {
    "transducerType": "CONDENSER",
    "pickupPattern": "SUPERCARDIOID / LOBE-SHAPED",
    "frequencyResponse": "40 HZ - 20 KHZ",
    "sensitivity": "17 MV/PA"
  },
  "Schoeps MiniCMIT": {
    "transducerType": "CONDENSER",
    "pickupPattern": "SUPERCARDIOID / LOBE-SHAPED",
    "frequencyResponse": "60 HZ - 20 KHZ",
    "sensitivity": "-35 DB (V/PA), 17 MV/PA"
  },
  "Schoeps CMC/MK 41": {
    "transducerType": "CONDENSER",
    "pickupPattern": "SUPERCARDIOID",
    "frequencyResponse": "40 HZ - 26 KHZ",
    "sensitivity": "-36 DB (V/PA), 16 MV/PA"
  },
  "DPA 4017": {
    "transducerType": "PRE-POLARIZED CONDENSER",
    "pickupPattern": "SUPERCARDIOID / LOBE-SHAPED",
    "frequencyResponse": "20 HZ - 20 KHZ",
    "sensitivity": "19 MV/PA, -34.4 DB RE 1 V/PA"
  },
  "DPA 4018": {
    "transducerType": "PRE-POLARIZED CONDENSER",
    "pickupPattern": "SUPERCARDIOID",
    "frequencyResponse": "20 HZ - 20 KHZ",
    "sensitivity": "25 MV/PA, -32 DB RE 1 V/PA"
  },
  "Sanken COS-11D": {
    "transducerType": "SELF-POLARIZED CONDENSER",
    "pickupPattern": "OMNIDIRECTIONAL",
    "frequencyResponse": "50 HZ - 20 KHZ",
    "sensitivity": "NORMAL SENSITIVITY VERSION"
  },
  "DPA 4060": {
    "transducerType": "PRE-POLARIZED CONDENSER",
    "pickupPattern": "OMNIDIRECTIONAL",
    "frequencyResponse": "20 HZ - 20 KHZ",
    "sensitivity": "20 MV/PA, -34 DB RE 1 V/PA"
  },
  "DPA 6060": {
    "transducerType": "PRE-POLARIZED CONDENSER",
    "pickupPattern": "OMNIDIRECTIONAL",
    "frequencyResponse": "20 HZ - 20 KHZ",
    "sensitivity": "20 MV/PA, -34 DB RE 1 V/PA"
  },
  "Countryman B6": {
    "transducerType": "CONDENSER",
    "pickupPattern": "OMNIDIRECTIONAL",
    "frequencyResponse": "20 HZ - 20 KHZ",
    "sensitivity": "16.0 MV/PA, STANDARD SENSITIVITY"
  },
  "Sennheiser MKE 2": {
    "transducerType": "PRE-POLARIZED CONDENSER",
    "pickupPattern": "OMNIDIRECTIONAL",
    "frequencyResponse": "20 HZ - 20 KHZ",
    "sensitivity": "5 MV/PA"
  },
  "Shure TwinPlex TL47": {
    "transducerType": "DUAL-DIAPHRAGM PREPOLARIZED CONDENSER",
    "pickupPattern": "OMNIDIRECTIONAL",
    "frequencyResponse": "20 HZ - 20 KHZ",
    "sensitivity": "-45.0 DBV, 5.62 MV/PA"
  }
};

  for (const m of Object.values(MICS)) {
    if (!m || !m.name) continue;
    const spec = seedSpecs[m.name];
    if (!spec) continue;

    for (const [k, v] of Object.entries(spec)) {
      if (m[k] === undefined || m[k] === null || String(m[k]).trim() === '') {
        m[k] = v;
      }
    }
  }
}
// === End built-in mic spec preload ===

function psOpenMicSpecForm(id=''){
  if(typeof psApplySeedMicSpecs==='function')psApplySeedMicSpecs();

  const form=$('micSpecForm');
  if(!form)return;

  form.classList.remove('hidden');
  form.dataset.initializedClosed='1';
  form.dataset.currentEditMic=id||'';

  $('micSpecEditId').value=id||'';

  const m=id&&MICS[id]?MICS[id]:null;

  [
    'specManufacturer',
    'specModel',
    'specTransducer',
    'specPattern',
    'specFreq',
    'specSensitivity'
  ].forEach(fieldId=>{
    if($(fieldId))$(fieldId).value='';
  });

  $('specManufacturer').value=m?psSpecManufacturer(m):'';
  $('specModel').value=m?psSpecModel(m):'';

  $('specTransducer').value=m?psSpecValue(m,[
    'transducerType',
    'transducer',
    'capsuleType',
    'principle'
  ]):'';

  $('specPattern').value=m?psSpecValue(m,[
    'pickupPattern',
    'polarPattern',
    'pattern'
  ]):'';

  $('specFreq').value=m?psSpecValue(m,[
    'frequencyResponse',
    'freqResponse',
    'frequency'
  ]):'';

  $('specSensitivity').value=m?psSpecValue(m,[
    'sensitivity',
    'sensitivityMvPa',
    'sensitivityMVPA'
  ]):'';

  if($('micSpecSave'))$('micSpecSave').textContent=id?'SAVE MIC SPECS':'ADD MIC';

  psSpecMsg(id?'EDITING '+(m?.name||m?.short||'MIC')+'.':'ENTER MANUFACTURER SPEC VALUES.', true);
  form.scrollIntoView({block:'nearest',behavior:'smooth'});
}

function psSaveMicSpec(){
  const editId=$('micSpecEditId').value.trim();

  const manufacturer=$('specManufacturer').value.trim();
  const model=$('specModel').value.trim();
  const transducerType=$('specTransducer').value.trim();
  const pickupPattern=$('specPattern').value.trim();
  const frequencyResponse=$('specFreq').value.trim();
  const sensitivity=$('specSensitivity').value.trim();

  if(!manufacturer||!model||!transducerType||!pickupPattern||!frequencyResponse||!sensitivity){
    psSpecMsg('MISSING REQUIRED FIELD.');
    return;
  }

  const baseName=manufacturer+' '+model;
  const editingBuiltIn=editId && MICS[editId] && !editId.startsWith('custom_');

  const record={
    manufacturer,
    name:baseName,
    displayName:editingBuiltIn ? baseName+' (CUSTOM)' : baseName,
    short:psShortFromModel(manufacturer,model),
    kind:pickupPattern+' '+transducerType,
    transducerType,
    pickupPattern,
    frequencyResponse,
    sensitivity,
    aliases:[],
    status:'spec_record',
    confidence:'manual-spec-entry',
    rangeStatus:'pending'
  };

  const recordKey=psSpecKey(record.name);

  let id='';

  if(editId && editId.startsWith('custom_') && MICS[editId]){
    // Editing an existing manual/custom mic updates that custom record in place.
    id=editId;
    record.baseMicId=MICS[editId].baseMicId||'';
    if(record.baseMicId){
      record.displayName=baseName+' (CUSTOM)';
    }
  }else if(editingBuiltIn){
    // Editing a built-in mic creates/updates one local copy.
    record.baseMicId=editId;

    const existingCopy=Object.entries(MICS).find(([existingId,m])=>
      existingId.startsWith('custom_') &&
      m &&
      m.baseMicId===editId
    );

    id=existingCopy
      ? existingCopy[0]
      : 'custom_spec_'+recordKey.slice(0,32)+'_'+Date.now().toString(36);
  }else{
    // New manual mic. Block exact duplicate custom records, but do not block built-ins.
    const duplicateCustom=Object.entries(MICS).find(([existingId,m])=>
      existingId.startsWith('custom_') &&
      m &&
      psSpecKey(m.name)===recordKey &&
      existingId!==editId
    );

    if(duplicateCustom){
      psSpecMsg('MIC ALREADY EXISTS.');
      return;
    }

    id='custom_spec_'+recordKey.slice(0,32)+'_'+Date.now().toString(36);
  }

  MICS[id]=record;
  saveCustomMics();

  // Keep built-in originals untouched and visible.
  // Pending spec records do not participate in radar range calculations.
  state.settings.package='custom';
  state.settings.active=(state.settings.active||[]).filter(mid=>MICS[mid]&&psMicHasUsableRange(MICS[mid]));
  write(STORE_SETTINGS,state.settings);

  psSpecMsg(editingBuiltIn ? 'CUSTOM MIC COPY SAVED. ORIGINAL KEPT.' : 'MIC SPECS SAVED. RANGE PENDING.', true);

  [
    'specManufacturer',
    'specModel',
    'specTransducer',
    'specPattern',
    'specFreq',
    'specSensitivity'
  ].forEach(fieldId=>{ if($(fieldId))$(fieldId).value=''; });

  $('micSpecEditId').value='';
  $('micSpecForm').classList.add('hidden');

  render();
  if(state.loc)fetchFeed();
}

function psCancelMicSpec(){
  const form=$('micSpecForm');
  if(!form)return;

  [
    'specManufacturer',
    'specModel',
    'specTransducer',
    'specPattern',
    'specFreq',
    'specSensitivity'
  ].forEach(id=>{ if($(id)) $(id).value=''; });

  $('micSpecEditId').value='';
  form.classList.add('hidden');

  const msg=$('micSpecMsg');
  if(msg){
    msg.classList.add('hidden');
    msg.textContent='';
  }
}

function psWireMicSpecEditor(){
  const add=$('micSpecAddToggle');
  const form=$('micSpecForm');
  const save=$('micSpecSave');
  const cancel=$('micSpecCancel');
  const grid=$('chipGrid');

  const oldSearch=$('customMicName');
  if(oldSearch){
    const row=oldSearch.closest('.row')||oldSearch.parentElement;
    if(row)row.style.display='none';
  }

  if($('customMicMsg'))$('customMicMsg').style.display='none';
  if($('results'))$('results').style.display='none';

  if(form && !form.dataset.initializedClosed){
    form.classList.add('hidden');
    form.dataset.initializedClosed='1';
  }

  if(add && !add.dataset.specAddWired){
    add.dataset.specAddWired='1';
    add.onclick=()=>{
      if(!form)return;
      if(form.classList.contains('hidden')){
        psOpenMicSpecForm('');
      }else{
        psCancelMicSpec();
      }
    };
  }

  if(save && !save.dataset.specSaveWired){
    save.dataset.specSaveWired='1';
    save.onclick=psSaveMicSpec;
  }

  if(cancel && !cancel.dataset.specCancelWired){
    cancel.dataset.specCancelWired='1';
    cancel.onclick=psCancelMicSpec;
  }

  if(grid && !grid.dataset.specEditorWired){
    grid.dataset.specEditorWired='1';

    grid.addEventListener('click',e=>{
      const edit=e.target.closest('[data-edit-mic]');
      if(edit){
        e.preventDefault();
        e.stopPropagation();
        psOpenMicSpecForm(edit.dataset.editMic);
        return;
      }

      const del=e.target.closest('[data-delete-mic]');
      if(del)return;

      const chip=e.target.closest('.chip');
      if(chip && chip.dataset.mic && MICS[chip.dataset.mic] && typeof psMicRangePending==='function' && psMicRangePending(MICS[chip.dataset.mic])){
        e.preventDefault();
        e.stopPropagation();
        psOpenMicSpecForm(chip.dataset.mic);
      }
    },true);
  }
}
// === End manual mic spec editor ===

function init(){
  if(typeof psApplySeedMicSpecs==='function')psApplySeedMicSpecs();
  state.savedLoc=read(STORE_LOC,null);
  const custom=read(STORE_CUSTOM,{});
  if(custom&&typeof custom==='object')Object.assign(MICS,custom);
  removeDeprecatedMics();
  const ss=read(STORE_SETTINGS,null);
  if(ss)state.settings={...state.settings,...ss};
  state.hiddenMics=read(STORE_HIDDEN,[]).filter(id=>MICS[id]);
  if (typeof psRemoveDuplicateCustomMics === 'function') psRemoveDuplicateCustomMics();
  const ui=read(STORE_UI,null);
  if(ui)state.activePanel=ui.activePanel||null;

  $('tabMics').onclick=()=>setPanel('mics');
  $('tabAircraft').onclick=()=>setPanel('aircraft');
  $('tabLocation').onclick=()=>setPanel('location');
  $('searchBtn').onclick=doSearch;
  $('searchInput').onkeydown=e=>{if(e.key==='Enter')doSearch()};
  $('results').onclick=e=>{
    const b=e.target.closest('.result');
    if(b)setLoc(state.search.results[+b.dataset.i]);
  };
  $('gpsBtn').onclick=()=>gps(false);
  $('customMicBtn').onclick=addManualMic;
  psWireMicSpecEditor();
  $('customMicName').onkeydown=e=>{if(e.key==='Enter')addManualMic()};

  $('chipGrid').onclick=e=>{
    const del=e.target.closest('[data-delete-mic]');
    if(del){
      e.stopPropagation();
      hideOrDeleteMic(del.dataset.deleteMic);
      return;
    }
    const b=e.target.closest('.chip');
    if(!b)return;
    const id=b.dataset.mic;
    const active=new Set(activeMicIds());
    active.has(id)?active.delete(id):active.add(id);
    state.settings.package='custom';
    state.settings.active=[...active];
    write(STORE_SETTINGS,state.settings);
    render();
    if(state.loc)fetchFeed();
  };

  window.addEventListener('resize',()=>{resizeCanvas();fitHeadline();});
  window.visualViewport?.addEventListener('resize',()=>{resizeCanvas();fitHeadline();});

  const q=new URLSearchParams(location.search);
  const lat=parseFloat(q.get('lat'));
  const lon=parseFloat(q.get('lon'));
  if(isFinite(lat)&&isFinite(lon)){
    state.loc={lat,lon,shortLabel:q.get('label')||'URL Location',fullLabel:'URL coordinates',source:'url'};
  }else if(state.savedLoc){
    state.loc=state.savedLoc;
  }

  render();
  if(state.loc)startLoop();
  maybeAutoGps();
  requestAnimationFrame(anim);
}

document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
