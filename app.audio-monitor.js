"use strict";

// ---------------------------------------------------------------------------
// app.audio-monitor.js  (multi-source)
//
// Live Sound Input ASSIST. Captures one OR MORE microphone streams at the same
// time - the device's built-in mic AND/OR a plugged-in mixer/field-recorder -
// and listens to each for room ambience and aircraft-like low-frequency energy.
// Multiple sources can run simultaneously; enabling the mixer does NOT turn off
// the built-in mic.
//
// HONESTY: this measures relative level (dBFS), not calibrated dB SPL. It is an
// assist that nudges the contamination threshold and confidence; it is not a
// sound-level meter. A pro mixer feed is trusted more than a phone mic.
//
// Engine contract (unchanged): psInitAudioMonitor() and
// psAudioMonitorCorrection(context) keep their signatures; the correction now
// fuses across all active sources.
// ---------------------------------------------------------------------------

const STORE_AUDIO_ENABLED = "planeSound.audioSourcesEnabled.v5";
const STORE_AUDIO_DEVICE_ID = "planeSound.audioDeviceId.v4";

// The two source kinds the user can toggle independently.
const PS_AUDIO_KINDS = ["device", "mixer"];

function psMakeSourceState(kind) {
  return {
    kind,
    active: false,
    denied: false,
    stream: null,
    context: null,
    analyser: null,
    data: null,
    dbfs: null,
    floorDbfs: null,
    lowMidScore: 0,
    aircraftLikeScore: 0,
    startedAt: 0,
    lastUpdate: 0,
    deviceId: "",
    deviceLabel: "",
  };
}

const PS_AUDIO_MONITOR = {
  available: false,
  devices: [],
  mixerDetected: false,
  rafPending: false,
  // One independent capture per kind.
  sources: {
    device: psMakeSourceState("device"),
    mixer: psMakeSourceState("mixer"),
  },
};

// ---- Enabled-source set (replaces the old single "mode") -------------------

function psReadEnabledSet() {
  try {
    const raw = localStorage.getItem(STORE_AUDIO_ENABLED);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.filter((k) => PS_AUDIO_KINDS.includes(k));
      }
    }
  } catch {
    // ignore
  }
  return []; // default: live input OFF
}

function psWriteEnabledSet(set) {
  try {
    localStorage.setItem(
      STORE_AUDIO_ENABLED,
      JSON.stringify(set.filter((k) => PS_AUDIO_KINDS.includes(k))),
    );
  } catch {
    // ignore
  }
}

function psIsSourceEnabled(kind) {
  return psReadEnabledSet().includes(kind);
}

function psAnyAudioEnabled() {
  return psReadEnabledSet().length > 0;
}

function psAnyAudioActive() {
  return PS_AUDIO_KINDS.some((k) => PS_AUDIO_MONITOR.sources[k].active);
}

// Back-compat helper used by older callers / the badge: returns a coarse label.
function psAudioSourceMode() {
  const set = psReadEnabledSet();
  if (set.includes("mixer") && set.includes("device")) return "both";
  if (set.includes("mixer")) return "mixer";
  if (set.includes("device")) return "device";
  return "manual";
}

function psIsManualAudioMode() {
  return !psAnyAudioEnabled();
}

function psRenderAudioSourceBadgeSafe() {
  if (typeof psRenderAudioSourceBadge === "function") {
    psRenderAudioSourceBadge();
  }
  if (typeof psRenderLiveInputControl === "function") {
    psRenderLiveInputControl();
  }
}

// Enable/disable a single source without touching the others.
function psSetSourceEnabled(kind, on) {
  if (!PS_AUDIO_KINDS.includes(kind)) return;
  const set = new Set(psReadEnabledSet());
  if (on) set.add(kind);
  else set.delete(kind);
  psWriteEnabledSet([...set]);

  if (on) {
    PS_AUDIO_MONITOR.sources[kind].denied = false;
    psStartAudioSource(kind);
  } else {
    psStopAudioSource(kind);
  }
  psRenderAudioSourceBadgeSafe();
}

function psToggleSource(kind) {
  psSetSourceEnabled(kind, !psIsSourceEnabled(kind));
}

// ---- Device classification (unchanged logic) ------------------------------

function psLikelySoundDeptAudioDevice(device) {
  const label = String(
    device && device.label ? device.label : "",
  ).toLowerCase();

  if (!label) return false;

  const consumerMicTerms = [
    "airpods",
    "bluetooth",
    "headphone",
    "headphones",
    "headset",
    "earbuds",
    "earbud",
    "hands-free",
    "handsfree",
    "wireless",
    "webcam",
    "camera",
    "logitech",
    "brio",
    "c920",
    "c922",
    "iphone microphone",
    "ipad microphone",
    "macbook",
    "built-in",
    "built in",
    "internal microphone",
    "default - microphone",
    "realtek",
    "array",
    "communications",
  ];
  if (consumerMicTerms.some((term) => label.includes(term))) return false;

  const productionAudioTerms = [
    "sound devices",
    "mixpre",
    "scorpio",
    "833",
    "888",
    "688",
    "633",
    "664",
    "552",
    "442",
    "302",
    "zoom f8",
    "zoom f6",
    "zoom f4",
    "f8n",
    "f8n pro",
    "tascam",
    "rodecaster",
    "focusrite",
    "scarlett",
    "behringer",
    "motu",
    "presonus",
    "ssl",
    "m-audio",
    "audient",
    "steinberg",
    "roland",
    "apollo",
    "ua-",
    "audio interface",
    "interface",
    "mixer",
    "recorder",
    "field recorder",
    "multitrack",
  ];
  return productionAudioTerms.some((term) => label.includes(term));
}

async function psListAudioInputDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices)
    return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  PS_AUDIO_MONITOR.devices = inputs;
  PS_AUDIO_MONITOR.mixerDetected = inputs.some(psLikelySoundDeptAudioDevice);
  return inputs;
}

function psBestDeviceMic(devices) {
  const inputs = Array.isArray(devices) ? devices : [];
  return (
    inputs.find((device) => !psLikelySoundDeptAudioDevice(device)) ||
    inputs[0] ||
    null
  );
}

function psBestMixerDevice(devices) {
  const inputs = Array.isArray(devices) ? devices : [];
  return inputs.find(psLikelySoundDeptAudioDevice) || null;
}

function psAudioConstraintsForDevice(deviceId) {
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio, video: false };
}

function psPickDeviceForKind(kind, devices) {
  return kind === "mixer"
    ? psBestMixerDevice(devices)
    : psBestDeviceMic(devices);
}

// ---- Per-source capture ---------------------------------------------------

function psStopAudioSource(kind) {
  const src = PS_AUDIO_MONITOR.sources[kind];
  if (!src) return;
  if (src.stream) src.stream.getTracks().forEach((t) => t.stop());
  if (src.context && src.context.state !== "closed") src.context.close();
  const fresh = psMakeSourceState(kind);
  // preserve denied flag so the UI can explain a refusal
  fresh.denied = src.denied;
  PS_AUDIO_MONITOR.sources[kind] = fresh;
}

async function psStartAudioSource(kind) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  if (!psIsSourceEnabled(kind)) return;

  const src = PS_AUDIO_MONITOR.sources[kind];
  if (src.active) return;

  try {
    // Prompt for permission (labels are hidden until granted).
    const permStream = await navigator.mediaDevices.getUserMedia(
      psAudioConstraintsForDevice(""),
    );
    const devices = await psListAudioInputDevices();
    const chosen = psPickDeviceForKind(kind, devices);

    // If the user asked for a mixer but none is detected, surface that rather
    // than silently grabbing the built-in mic.
    if (kind === "mixer" && !chosen) {
      permStream.getTracks().forEach((t) => t.stop());
      const s = PS_AUDIO_MONITOR.sources[kind];
      s.active = false;
      s.denied = false;
      s.deviceLabel = "no mixer detected";
      psRenderAudioSourceBadgeSafe();
      return;
    }

    permStream.getTracks().forEach((t) => t.stop());

    const stream = await navigator.mediaDevices.getUserMedia(
      psAudioConstraintsForDevice(chosen ? chosen.deviceId || "" : ""),
    );
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const context = new Ctx();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);

    const s = PS_AUDIO_MONITOR.sources[kind];
    s.stream = stream;
    s.context = context;
    s.analyser = analyser;
    s.data = new Uint8Array(analyser.frequencyBinCount);
    s.active = true;
    s.denied = false;
    s.startedAt = Date.now();
    s.lastUpdate = Date.now();
    s.deviceId = chosen ? chosen.deviceId || "" : "";
    s.deviceLabel = chosen ? chosen.label || "" : "";
    s.floorDbfs = null;

    if (kind === "device" && s.deviceId) {
      try {
        localStorage.setItem(STORE_AUDIO_DEVICE_ID, s.deviceId);
      } catch {
        // ignore
      }
    }

    psEnsureMonitorTick();
    psRenderAudioSourceBadgeSafe();
  } catch (err) {
    const s = PS_AUDIO_MONITOR.sources[kind];
    s.denied = true;
    s.active = false;
    psRenderAudioSourceBadgeSafe();
  }
}

function psStartEnabledSources() {
  for (const kind of psReadEnabledSet()) psStartAudioSource(kind);
}

function psStopAllAudioSources() {
  for (const kind of PS_AUDIO_KINDS) psStopAudioSource(kind);
}

// ---- DSP (per source) -----------------------------------------------------

function psAnalyseSource(src) {
  if (!src.active || !src.analyser || !src.context) return;

  const analyser = src.analyser;
  const data = src.data;
  analyser.getByteFrequencyData(data);

  let total = 0;
  let lowMid = 0;
  let lowMidCount = 0;
  const nyquist = src.context.sampleRate / 2;

  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 255;
    total += v * v;
    const hz = (i * nyquist) / data.length;
    if (hz >= 80 && hz <= 1200) {
      lowMid += v * v;
      lowMidCount++;
    }
  }

  const rms = Math.sqrt(total / Math.max(1, data.length));
  const lowMidRms = Math.sqrt(lowMid / Math.max(1, lowMidCount));
  const dbfs = 20 * Math.log10(Math.max(0.000001, rms));
  const lowMidDbfs = 20 * Math.log10(Math.max(0.000001, lowMidRms));

  if (src.floorDbfs == null) {
    src.floorDbfs = dbfs;
  } else {
    const alpha = dbfs < src.floorDbfs ? 0.08 : 0.008;
    src.floorDbfs = src.floorDbfs * (1 - alpha) + dbfs * alpha;
  }

  const rise = dbfs - src.floorDbfs;
  const lowMidBias = lowMidDbfs - dbfs;

  src.dbfs = dbfs;
  src.lowMidScore = clamp((lowMidBias + 8) / 12, 0, 1);
  src.aircraftLikeScore = clamp((rise / 12) * src.lowMidScore, 0, 1);
  src.lastUpdate = Date.now();
}

function psEnsureMonitorTick() {
  if (PS_AUDIO_MONITOR.rafPending) return;
  PS_AUDIO_MONITOR.rafPending = true;
  requestAnimationFrame(psAudioMonitorTick);
}

function psAudioMonitorTick() {
  PS_AUDIO_MONITOR.rafPending = false;
  let anyActive = false;
  for (const kind of PS_AUDIO_KINDS) {
    const src = PS_AUDIO_MONITOR.sources[kind];
    if (src.active) {
      psAnalyseSource(src);
      anyActive = true;
    }
  }
  if (anyActive) psEnsureMonitorTick();
}

// ---- Fused correction for the engine (unchanged contract) -----------------

function psSourceReliability(kind) {
  return kind === "mixer" ? 0.75 : 0.18;
}

function psAudioMonitorCorrection(context) {
  const now = Date.now();
  const live = PS_AUDIO_KINDS.map((k) => PS_AUDIO_MONITOR.sources[k]).filter(
    (s) => s.active && now - s.lastUpdate <= 2500,
  );

  if (!live.length) {
    return {
      thresholdDbaAdjustment: 0,
      confidenceBoost: 0,
      reliability: 0,
      reasonCodes: ["live_audio_inactive"],
    };
  }

  // Highest ambient floor across sources drives the threshold lift (the
  // noisiest reliable observation wins, conservatively).
  let bestAdj = 0;
  let bestReliability = 0;
  let detected = false;
  const kinds = [];

  for (const s of live) {
    const floor = Number(s.floorDbfs);
    const adj = Number.isFinite(floor) ? clamp((floor + 52) / 8, 0, 3) : 0;
    const rel = psSourceReliability(s.kind);
    // Weight the ambient adjustment by reliability so a phone mic doesn't
    // overcorrect, but a mixer can.
    const weightedAdj = adj * (0.5 + 0.5 * rel);
    if (weightedAdj > bestAdj) bestAdj = weightedAdj;
    if (rel > bestReliability) bestReliability = rel;
    if (s.aircraftLikeScore > 0.55) detected = true;
    kinds.push(s.kind);
  }

  // Two independent sources agreeing is worth slightly more confidence.
  const multiBonus = live.length > 1 ? 0.04 : 0;

  return {
    thresholdDbaAdjustment: bestAdj,
    confidenceBoost: (detected ? 0.14 : 0.04) + multiBonus,
    reliability: Math.min(0.85, bestReliability + multiBonus),
    reasonCodes: [
      detected ? "live_audio_aircraft_like_energy" : "live_audio_noise_floor",
      kinds.includes("mixer") ? "sound_dept_feed" : "device_mic_helper",
      live.length > 1 ? "multi_source" : "single_source",
    ],
    sources: live.map((s) => ({
      kind: s.kind,
      dbfs: s.dbfs,
      floorDbfs: s.floorDbfs,
      aircraftLikeScore: s.aircraftLikeScore,
      deviceLabel: s.deviceLabel,
    })),
  };
}

// ---- Boot (unchanged signature) -------------------------------------------

function psInitAudioMonitor() {
  PS_AUDIO_MONITOR.available =
    !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia;

  if (!PS_AUDIO_MONITOR.available) {
    psRenderAudioSourceBadgeSafe();
    return;
  }

  if (navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      psListAudioInputDevices().then(() => {
        // Restart any enabled source so it re-picks the right device.
        for (const kind of psReadEnabledSet()) {
          psStopAudioSource(kind);
          psStartAudioSource(kind);
        }
        psRenderAudioSourceBadgeSafe();
      });
    });
  }

  psListAudioInputDevices().then(() => {
    psStartEnabledSources();
    psRenderAudioSourceBadgeSafe();
  });
}
