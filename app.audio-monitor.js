"use strict";

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
};

function psInitAudioMonitor() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

  PS_AUDIO_MONITOR.available = true;

  const startOnce = () => {
    psStartAudioMonitor();
    window.removeEventListener("pointerdown", startOnce);
    window.removeEventListener("keydown", startOnce);
  };

  window.addEventListener("pointerdown", startOnce, { once: true });
  window.addEventListener("keydown", startOnce, { once: true });
}

async function psStartAudioMonitor() {
  if (PS_AUDIO_MONITOR.active || PS_AUDIO_MONITOR.denied) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });

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
    PS_AUDIO_MONITOR.startedAt = Date.now();

    psAudioMonitorTick();
  } catch (err) {
    PS_AUDIO_MONITOR.denied = true;
    console.warn("Audio monitor unavailable:", err.message || err);
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
    !PS_AUDIO_MONITOR.active ||
    Date.now() - PS_AUDIO_MONITOR.lastUpdate > 2500
  ) {
    return {
      thresholdDbaAdjustment: 0,
      confidenceBoost: 0,
      reasonCodes: ["phone_mic_inactive"],
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
      detected ? "phone_mic_aircraft_like_energy" : "phone_mic_noise_floor",
    ],
    dbfs: PS_AUDIO_MONITOR.dbfs,
    floorDbfs: PS_AUDIO_MONITOR.floorDbfs,
    aircraftLikeScore: PS_AUDIO_MONITOR.aircraftLikeScore,
  };
}
