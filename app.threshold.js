"use strict";

// ---------------------------------------------------------------------------
// app.threshold.js
// Microphone contamination-threshold model.
//
// The question is NOT "how sensitive is the mic" but "at what received SPL at
// the capsule does aircraft noise contaminate THIS take." That is governed by
// the quietest thing being protected: the location's ambient noise floor (the
// "bed"), which can never sit below the mic's own self-noise. Once aircraft
// noise rises to within a small headroom of that protected floor, it is
// audible in the gaps and contaminates the recording.
//
//   threshold_dBA = max(ambientBed, selfNoise + selfNoiseHeadroom) + headroom
//
// ambientBed comes from the selected scene profile, or from a live measurement
// supplied by the audio monitor (sound-dept feed or device mic). selfNoise is
// the verified equivalent noise level (A-weighted) from the mic spec record.
// ---------------------------------------------------------------------------

// Scene profiles set the protected ambient bed (dB-A SPL) and the headroom
// above it at which aircraft noise becomes a problem. Quiet rural exteriors
// protect a very low floor (a boom take is wrecked at ~33 dBA); urban beds are
// already so loud aircraft rarely dominate.
const PS_SCENE_PROFILES = {
  quiet_exterior: {
    label: "Quiet exterior",
    ambientBedDba: 30,
    headroomDba: 4,
    note: "",
  },
  loud_exterior: {
    label: "Loud exterior",
    ambientBedDba: 58,
    headroomDba: 7,
    note: "",
  },
  quiet_interior: {
    label: "Quiet interior",
    ambientBedDba: 32,
    headroomDba: 4,
    note: "",
  },
  loud_interior: {
    label: "Loud interior",
    ambientBedDba: 46,
    headroomDba: 6,
    note: "",
  },
  studio: {
    label: "Studio",
    ambientBedDba: 24,
    headroomDba: 3,
    note: "",
  },
};

const PS_DEFAULT_SCENE_KEY = "quiet_exterior";

function psSceneProfile() {
  const key =
    (state &&
      state.settings &&
      (state.settings.scene || state.settings.sceneKey)) ||
    PS_DEFAULT_SCENE_KEY;

  return PS_SCENE_PROFILES[key] || PS_SCENE_PROFILES[PS_DEFAULT_SCENE_KEY];
}

// Parse a self-noise / equivalent-noise-level value (dB-A SPL) from a mic spec
// record. Accepts an explicit numeric field or a string like "13 dB-A",
// "14 dBA", "equivalent noise level 23 dB(A)". Returns { dba, confidence,
// source } or null when nothing usable is present. We do NOT invent values:
// absence yields null and the caller falls back to a class band.
function psParseMicSelfNoiseDba(mic) {
  if (!mic) return null;

  const direct =
    mic.selfNoiseDba ??
    mic.equivalentNoiseDbA ??
    mic.equivalentNoiseDba ??
    mic.selfNoise ??
    null;

  if (direct != null && Number.isFinite(Number(direct))) {
    return { dba: Number(direct), confidence: 0.8, source: "spec-field" };
  }

  const fields = [mic.selfNoiseText, mic.equivalentNoise, mic.noise, mic.notes]
    .filter((v) => typeof v === "string")
    .join(" ");

  if (fields) {
    // Prefer an A-weighted figure when one is present.
    const aw = fields.match(/([0-9]{1,2}(?:\.[0-9])?)\s*dB[\s-]*\(?a\)?/i);
    if (aw) {
      return { dba: Number(aw[1]), confidence: 0.78, source: "spec-text-A" };
    }
    const generic = fields.match(/([0-9]{1,2}(?:\.[0-9])?)\s*dB/i);
    if (generic) {
      // Unweighted/CCIR figure: treat as approximate, lower confidence.
      return {
        dba: Number(generic[1]),
        confidence: 0.5,
        source: "spec-text-unweighted",
      };
    }
  }

  return null;
}

// Class fallback self-noise band (dB-A) by transducer/kind when the spec
// record has no usable figure. These are CLASS RANGES, not invented per-mic
// specs; confidence is deliberately low so the engine widens its band.
function psClassSelfNoiseDba(mic) {
  const kind = String((mic && mic.kind) || "").toLowerCase();
  const transducer = String((mic && mic.transducerType) || "").toLowerCase();

  if (kind.includes("lav") || kind.includes("lavalier")) {
    return { dba: 26, confidence: 0.3, source: "class-lav" };
  }
  if (kind.includes("shotgun") || kind.includes("boom")) {
    return { dba: 15, confidence: 0.32, source: "class-boom" };
  }
  if (kind.includes("interior") || kind.includes("dialogue")) {
    return { dba: 14, confidence: 0.32, source: "class-dialogue" };
  }
  if (transducer.includes("rf condenser") || transducer.includes("condenser")) {
    return { dba: 16, confidence: 0.28, source: "class-condenser" };
  }

  return { dba: 20, confidence: 0.22, source: "class-generic" };
}

// Seed of verified manufacturer A-weighted equivalent-noise figures for the
// mics in the built-in database. These are published datasheet values; treat
// as a starting point to VERIFY against your own datasheets, not gospel.
// Keyed by uppercased short name / alias. Override any time by adding a
// selfNoiseDba field to the mic spec record (that always wins).
const PS_MIC_SELF_NOISE_SEED = {
  "MKH 416": 13,
  MKH416: 13,
  "MKH 8060": 13,
  MKH8060: 13,
  "MKH 50": 12,
  MKH50: 12,
  "CMIT 5U": 14,
  CMIT: 14,
  CMIT5U: 14,
  MINICMIT: 14,
  "MINI CMIT": 14,
  "MK 41": 14,
  MK41: 14,
  "DPA 4060": 23,
  DPA4060: 23,
  "DPA 6060": 23,
  DPA6060: 23,
  "COS-11D": 28,
  COS11D: 28,
  B6: 30,
};

function psSeedSelfNoiseDba(mic) {
  const candidates = [mic && mic.short, mic && mic.name, mic && mic.id]
    .concat(Array.isArray(mic && mic.aliases) ? mic.aliases : [])
    .filter(Boolean)
    .map((s) => String(s).toUpperCase().trim());

  for (const c of candidates) {
    if (Number.isFinite(PS_MIC_SELF_NOISE_SEED[c])) {
      return {
        dba: PS_MIC_SELF_NOISE_SEED[c],
        confidence: 0.7,
        source: "datasheet-seed-A",
      };
    }
  }

  return null;
}

function psMicSelfNoise(mic) {
  return (
    psParseMicSelfNoiseDba(mic) ||
    psSeedSelfNoiseDba(mic) ||
    psClassSelfNoiseDba(mic)
  );
}

// Live measured ambient bed (dB-A) from the audio monitor, when a reliable
// source is supplying one. Returns { dba, reliability } or null.
function psMeasuredAmbientBed() {
  if (typeof psAudioMonitorAmbientBed === "function") {
    const m = psAudioMonitorAmbientBed();
    if (m && Number.isFinite(Number(m.dba))) {
      return {
        dba: Number(m.dba),
        reliability: clamp(Number(m.reliability ?? 0.4), 0, 1),
      };
    }
  }
  return null;
}

// Contamination threshold (dB-A received at the capsule) for one mic, given
// the active scene and any live ambient measurement.
function psContaminationThreshold(mic) {
  const scene = psSceneProfile();
  const selfNoise = psMicSelfNoise(mic);
  const measured = psMeasuredAmbientBed();

  // Protected ambient bed: live measurement (if trustworthy) blended with the
  // scene preset; otherwise the scene preset alone.
  let ambientBed = scene.ambientBedDba;
  let ambientConfidence = 0.45;
  let ambientSource = "scene_preset";

  if (measured && measured.reliability >= 0.35) {
    const w = clamp(measured.reliability, 0, 0.85);
    ambientBed = w * measured.dba + (1 - w) * scene.ambientBedDba;
    ambientConfidence = clamp(0.4 + 0.5 * measured.reliability, 0.4, 0.85);
    ambientSource = "measured_blend";
  }

  // The bed can never sit below the mic self-noise + a small margin.
  const selfNoiseFloor = selfNoise.dba + 6;
  const protectedFloor = Math.max(ambientBed, selfNoiseFloor);

  const thresholdDba = protectedFloor + scene.headroomDba;

  // Confidence: limited by whichever input is weakest.
  const confidence = clamp(
    Math.min(ambientConfidence, 0.4 + selfNoise.confidence * 0.45),
    0.15,
    0.85,
  );

  return {
    thresholdDba,
    protectedFloorDba: protectedFloor,
    ambientBedDba: ambientBed,
    ambientSource,
    selfNoiseDba: selfNoise.dba,
    selfNoiseSource: selfNoise.source,
    sceneKey: scene.label,
    headroomDba: scene.headroomDba,
    confidence,
    bound: selfNoiseFloor >= ambientBed ? "self-noise" : "ambient",
  };
}
