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

// === Plane Sound delayed connection lost logic ===
// Do not show CONNECTION LOST for short feed hiccups.
// Keep using last known aircraft state until the feed is stale enough that movement prediction is no longer trustworthy.
// === End delayed connection lost logic ===

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

function setPanel(name){
  state.activePanel=state.activePanel===name?null:name;
  write(STORE_UI,{activePanel:state.activePanel});
  render();
}


// === Plane Sound strict mic lookup override ===
// Rules:
// - Exact normalized model/name/alias match only.
// - Unknown or unverified mic returns "mic unknown".
// - Existing built-in mic is restored if previously hidden.
// - Existing built-in mic is selected instead of duplicated.

// === End strict mic lookup override ===


// === Plane Sound manual mic spec editor ===
// === Plane Sound mic spec prefill helpers ===
// === End mic spec prefill helpers ===


// === Plane Sound built-in mic spec preload ===
// === End built-in mic spec preload ===

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
