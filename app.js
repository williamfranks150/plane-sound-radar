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
