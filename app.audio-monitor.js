"use strict";

const STORE_AUDIO_SOURCE_MODE = "planeSound.audioSourceMode.v4";
const STORE_AUDIO_DEVICE_ID = "planeSound.audioDeviceId.v4";
const STORE_AUDIO_DEVICE_LABEL = "planeSound.audioDeviceLabel.v4";

const PS_AUDIO_MONITOR = {
  available: false,
  active: false,
  denied: false,
  startedAt: 0,
  lastUpdate: 0,
  dbfs: null,
  floorDbfs: null,
  lowMidScore: 0,
  aircraftLikeScore: 0,
  stream: null,
  context: null,
  analyser: null,
  data: null,
  devices: [],
  activeDeviceId: "",
  activeDeviceLabel: "",
  activeSourceKind: "device",
  mixerDetected: false,
};

function psAudioSourceMode() {
  const value = localStorage.getItem(STORE_AUDIO_SOURCE_MODE);

  if (value === "mixer") return "mixer";
  if (value === "manual") return "manual";

  return "device";
}

function psIsManualAudioMode() {
  return psAudioSourceMode() === "manual";
}

function psRenderAudioSourceBadgeSafe() {
  if (typeof psRenderAudioSourceBadge === "function") {
    psRenderAudioSourceBadge();
  }
}

function psSetAudioSourceMode(mode) {
  const safe = ["device", "mixer", "manual"].includes(mode) ? mode : "device";

  localStorage.setItem(STORE_AUDIO_SOURCE_MODE, safe);

  psStopAudioMonitor();

  if (safe !== "manual") {
    PS_AUDIO_MONITOR.denied = false;
    psStartAudioMonitor();
  }

  psRenderAudioSourceBadgeSafe();
}

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
    "r�decaster",
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

  return {
    audio,
    video: false,
  };
}

function psStopAudioMonitor() {
  if (PS_AUDIO_MONITOR.stream) {
    PS_AUDIO_MONITOR.stream.getTracks().forEach((track) => track.stop());
  }

  if (PS_AUDIO_MONITOR.context && PS_AUDIO_MONITOR.context.state !== "closed") {
    PS_AUDIO_MONITOR.context.close();
  }

  PS_AUDIO_MONITOR.active = false;
  PS_AUDIO_MONITOR.stream = null;
  PS_AUDIO_MONITOR.context = null;
  PS_AUDIO_MONITOR.analyser = null;
  PS_AUDIO_MONITOR.data = null;
  PS_AUDIO_MONITOR.activeDeviceId = "";
  PS_AUDIO_MONITOR.activeDeviceLabel = "";
  PS_AUDIO_MONITOR.activeSourceKind =
    psAudioSourceMode() === "mixer" ? "mixer" : "device";

  psRenderAudioSourceBadgeSafe();
}

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
        if (!psIsManualAudioMode()) {
          psSetAudioSourceMode(psAudioSourceMode());
        }

        psRenderAudioSourceBadgeSafe();
      });
    });
  }

  psListAudioInputDevices().then(() => {
    if (!psIsManualAudioMode()) {
      psStartAudioMonitor();
    }

    psRenderAudioSourceBadgeSafe();
  });
}

async function psStartAudioMonitor() {
  const mode = psAudioSourceMode();

  if (mode === "manual") return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

  try {
    const permissionStream = await navigator.mediaDevices.getUserMedia(
      psAudioConstraintsForDevice(""),
    );

    permissionStream.getTracks().forEach((track) => track.stop());

    const devices = await psListAudioInputDevices();
    const selected =
      mode === "mixer" ? psBestMixerDevice(devices) : psBestDeviceMic(devices);

    if (!selected) {
      PS_AUDIO_MONITOR.active = false;
      PS_AUDIO_MONITOR.activeSourceKind = mode === "mixer" ? "mixer" : "device";
      psRenderAudioSourceBadgeSafe();
      return;
    }

    psStopAudioMonitor();

    const stream = await navigator.mediaDevices.getUserMedia(
      psAudioConstraintsForDevice(selected.deviceId || ""),
    );
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();

    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);

    PS_AUDIO_MONITOR.stream = stream;
    PS_AUDIO_MONITOR.context = context;
    PS_AUDIO_MONITOR.analyser = analyser;
    PS_AUDIO_MONITOR.data = new Uint8Array(analyser.frequencyBinCount);
    PS_AUDIO_MONITOR.active = true;
    PS_AUDIO_MONITOR.denied = false;
    PS_AUDIO_MONITOR.startedAt = Date.now();
    PS_AUDIO_MONITOR.activeDeviceId = selected.deviceId || "";
    PS_AUDIO_MONITOR.activeDeviceLabel = selected.label || "";
    PS_AUDIO_MONITOR.activeSourceKind = mode === "mixer" ? "mixer" : "device";
    PS_AUDIO_MONITOR.mixerDetected = devices.some(psLikelySoundDeptAudioDevice);

    if (selected.deviceId) {
      localStorage.setItem(STORE_AUDIO_DEVICE_ID, selected.deviceId);
      localStorage.setItem(STORE_AUDIO_DEVICE_LABEL, selected.label || "");
    }

    psRenderAudioSourceBadgeSafe();
    psAudioMonitorTick();
  } catch (err) {
    PS_AUDIO_MONITOR.denied = true;
    PS_AUDIO_MONITOR.active = false;
    console.warn("Audio monitor unavailable:", err.message || err);
    psRenderAudioSourceBadgeSafe();
  }
}

function psAudioMonitorTick() {
  if (!PS_AUDIO_MONITOR.active || !PS_AUDIO_MONITOR.analyser) return;

  const analyser = PS_AUDIO_MONITOR.analyser;
  const data = PS_AUDIO_MONITOR.data;

  analyser.getByteFrequencyData(data);

  let total = 0;
  let lowMid = 0;
  let lowMidCount = 0;

  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 255;
    total += v * v;

    const hz = (i * (PS_AUDIO_MONITOR.context.sampleRate / 2)) / data.length;

    if (hz >= 80 && hz <= 1200) {
      lowMid += v * v;
      lowMidCount++;
    }
  }

  const rms = Math.sqrt(total / Math.max(1, data.length));
  const lowMidRms = Math.sqrt(lowMid / Math.max(1, lowMidCount));
  const dbfs = 20 * Math.log10(Math.max(0.000001, rms));
  const lowMidDbfs = 20 * Math.log10(Math.max(0.000001, lowMidRms));

  if (PS_AUDIO_MONITOR.floorDbfs == null) {
    PS_AUDIO_MONITOR.floorDbfs = dbfs;
  } else {
    const alpha = dbfs < PS_AUDIO_MONITOR.floorDbfs ? 0.08 : 0.008;
    PS_AUDIO_MONITOR.floorDbfs =
      PS_AUDIO_MONITOR.floorDbfs * (1 - alpha) + dbfs * alpha;
  }

  const rise = dbfs - PS_AUDIO_MONITOR.floorDbfs;
  const lowMidBias = lowMidDbfs - dbfs;

  PS_AUDIO_MONITOR.dbfs = dbfs;
  PS_AUDIO_MONITOR.lowMidScore = clamp((lowMidBias + 8) / 12, 0, 1);
  PS_AUDIO_MONITOR.aircraftLikeScore = clamp(
    (rise / 12) * PS_AUDIO_MONITOR.lowMidScore,
    0,
    1,
  );
  PS_AUDIO_MONITOR.lastUpdate = Date.now();

  requestAnimationFrame(psAudioMonitorTick);
}

function psAudioMonitorCorrection() {
  if (
    psIsManualAudioMode() ||
    !PS_AUDIO_MONITOR.active ||
    Date.now() - PS_AUDIO_MONITOR.lastUpdate > 2500
  ) {
    return {
      thresholdDbaAdjustment: 0,
      confidenceBoost: 0,
      reasonCodes: ["live_audio_inactive"],
    };
  }

  const floor = Number(PS_AUDIO_MONITOR.floorDbfs);
  const highAmbient = Number.isFinite(floor)
    ? clamp((floor + 52) / 8, 0, 3)
    : 0;
  const detected = PS_AUDIO_MONITOR.aircraftLikeScore > 0.55;

  return {
    thresholdDbaAdjustment: highAmbient,
    confidenceBoost: detected ? 0.12 : 0.04,
    reasonCodes: [
      detected ? "live_audio_aircraft_like_energy" : "live_audio_noise_floor",
      PS_AUDIO_MONITOR.activeSourceKind === "mixer"
        ? "sound_dept_feed"
        : "device_mic_feed",
    ],
    dbfs: PS_AUDIO_MONITOR.dbfs,
    floorDbfs: PS_AUDIO_MONITOR.floorDbfs,
    aircraftLikeScore: PS_AUDIO_MONITOR.aircraftLikeScore,
    sourceKind: PS_AUDIO_MONITOR.activeSourceKind,
    deviceLabel: PS_AUDIO_MONITOR.activeDeviceLabel,
  };
}
