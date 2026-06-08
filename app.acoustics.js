"use strict";

const PS_ACOUSTIC_REFERENCE_DISTANCE_M = 305;
const PS_BASE_AIR_ABSORPTION_DB_PER_KM = 1.2;

let PS_AIRCRAFT_NOISE_PROFILE_DATA = {
  schema: "plane-sound-aircraft-noise-profiles-v1",
  mode: "verified-data-required",
  sources: [],
  profiles: [],
};

async function psLoadAircraftNoiseProfiles() {
  try {
    const response = await fetch("data/aircraft-noise-profiles.json", {
      cache: "no-store",
    });

    if (!response.ok)
      throw new Error("Aircraft noise profile file unavailable.");

    const data = await response.json();

    if (!data || !Array.isArray(data.profiles)) {
      throw new Error("Aircraft noise profile file has invalid structure.");
    }

    PS_AIRCRAFT_NOISE_PROFILE_DATA = data;
  } catch (err) {
    console.warn("Aircraft noise profiles unavailable:", err.message);
  }
}

async function psBootAcousticEngine() {
  await Promise.allSettled([
    psLoadAircraftNoiseProfiles(),
    typeof psLoadAircraftProfileData === "function"
      ? psLoadAircraftProfileData()
      : null,
    typeof psLoadSpectralClasses === "function"
      ? psLoadSpectralClasses()
      : null,
  ]);

  if (state.loc && typeof psPrimeWeatherForLocation === "function") {
    psPrimeWeatherForLocation(state.loc).then(() => {
      render();
      if (state.loc) fetchFeed();
    });
  }

  if (typeof psInitAudioMonitor === "function") {
    psInitAudioMonitor();
  }
}

function psHasVerifiedAircraftNoiseData() {
  return (
    PS_AIRCRAFT_NOISE_PROFILE_DATA &&
    Array.isArray(PS_AIRCRAFT_NOISE_PROFILE_DATA.profiles) &&
    PS_AIRCRAFT_NOISE_PROFILE_DATA.profiles.some(
      (profile) => profile && profile.sourceType === "verified",
    )
  );
}

function psFindVerifiedAircraftNoiseProfile(type) {
  const t = String(type || "")
    .toUpperCase()
    .trim();

  if (!t || t === "?") return null;

  return (
    PS_AIRCRAFT_NOISE_PROFILE_DATA.profiles.find((profile) => {
      if (!profile || profile.sourceType !== "verified") return false;

      const codes = Array.isArray(profile.aircraftTypeCodes)
        ? profile.aircraftTypeCodes
        : [];

      return codes.some((code) => String(code).toUpperCase() === t);
    }) || null
  );
}

function psFallbackAircraftNoiseProfile(type) {
  const t = String(type || "")
    .toUpperCase()
    .trim();

  let dbaAt305m = 84;
  let label = "Estimated generic aircraft";
  let confidence = 0.25;
  let engine = {
    directivity: "generic",
    climbDba: 2,
    descentDba: 0.5,
    speedDba: 1,
  };

  if (t.includes("A388")) {
    dbaAt305m = 96;
    label = "Estimated super-heavy jet";
    confidence = 0.35;
    engine = {
      directivity: "jet",
      climbDba: 3.5,
      descentDba: 0.8,
      speedDba: 2.2,
    };
  } else if (/^(B74|B77|B78|A34|A35|A33|MD11|DC10)/.test(t)) {
    dbaAt305m = 91;
    label = "Estimated heavy jet";
    confidence = 0.34;
    engine = { directivity: "jet", climbDba: 3, descentDba: 0.7, speedDba: 2 };
  } else if (/^(B75|B76|A30|A31)/.test(t)) {
    dbaAt305m = 89;
    label = "Estimated medium jet";
    confidence = 0.33;
    engine = { directivity: "jet", climbDba: 3, descentDba: 0.8, speedDba: 2 };
  } else if (/^(B73|B38|A32|A22|BCS|E19|E29)/.test(t)) {
    dbaAt305m = 85;
    label = "Estimated narrowbody jet";
    confidence = 0.32;
    engine = {
      directivity: "jet",
      climbDba: 2.4,
      descentDba: 0.5,
      speedDba: 1.6,
    };
  } else if (/^(E17|E75|CRJ)/.test(t)) {
    dbaAt305m = 81;
    label = "Estimated regional jet";
    confidence = 0.28;
    engine = {
      directivity: "jet",
      climbDba: 2.4,
      descentDba: 0.6,
      speedDba: 1.6,
    };
  } else if (/^(DH8|AT4|AT7|SF3|BE9)/.test(t)) {
    dbaAt305m = 78;
    label = "Estimated turboprop";
    confidence = 0.26;
    engine = {
      directivity: "propeller",
      climbDba: 2.8,
      descentDba: 1.2,
      speedDba: 1.3,
    };
  } else if (/^(H|R44|R66|B06|EC|AS|S76|S92|A139|AW139)/.test(t)) {
    dbaAt305m = 82;
    label = "Estimated helicopter";
    confidence = 0.24;
    engine = {
      directivity: "rotor",
      climbDba: 2,
      descentDba: 1.5,
      speedDba: 1.2,
    };
  } else if (/^(C1|C2|C3|P28|SR2|BE|PA)/.test(t)) {
    dbaAt305m = 72;
    label = "Estimated light aircraft";
    confidence = 0.22;
    engine = {
      directivity: "propeller",
      climbDba: 2,
      descentDba: 0.5,
      speedDba: 0.8,
    };
  }

  return {
    sourceType: "estimated",
    label,
    dbaAt305m,
    confidence,
    engine,
    directivity: engine.directivity,
  };
}

function psAircraftNoiseProfile(ac) {
  const type = typeof ac === "object" ? ac.t : ac;
  const verified = psFindVerifiedAircraftNoiseProfile(type);

  if (verified) {
    return {
      sourceType: "verified",
      label: verified.label || type,
      dbaAt305m: Number.isFinite(Number(verified.dbaAt305m))
        ? Number(verified.dbaAt305m)
        : null,
      npd: verified.npd || null,
      confidence: Number(verified.confidence || 0.85),
      engine: verified.engine || {},
      directivity: verified.directivity || "generic",
      spectralApproachClass: verified.spectralApproachClass,
      spectralDepartureClass: verified.spectralDepartureClass,
    };
  }

  if (typeof psAircraftProfileFor === "function" && typeof ac === "object") {
    const profile = psAircraftProfileFor(ac);

    if (profile) {
      return {
        sourceType: "proxy",
        label: profile.label,
        dbaAt305m: profile.dbaAt305m,
        confidence: profile.confidence,
        engine: profile.engine || {},
        directivity: profile.directivity || "generic",
      };
    }
  }

  return psFallbackAircraftNoiseProfile(type);
}

function psParseSensitivityMvPa(value) {
  const text = String(value || "").toUpperCase();
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*MV\s*\/\s*PA/);

  return match ? Number(match[1]) : null;
}

function psMicAcousticProfile(mic) {
  if (!mic || mic.human) {
    return {
      name: "Human hearing",
      thresholdDba: 45,
      sensitivityMvPa: null,
      confidence: 0.55,
    };
  }

  const kind = String(mic.kind || "").toLowerCase();
  const pattern = String(mic.pickupPattern || "").toLowerCase();
  const sensitivityMvPa = psParseSensitivityMvPa(mic.sensitivity);

  let thresholdDba = 58;

  if (kind.includes("lav")) thresholdDba = 54;
  if (kind.includes("shotgun")) thresholdDba = 57;
  if (kind.includes("dialogue") || kind.includes("interior")) thresholdDba = 55;

  if (pattern.includes("omni")) thresholdDba -= 1;
  if (pattern.includes("supercardioid") || pattern.includes("lob"))
    thresholdDba += 1;

  if (sensitivityMvPa) {
    const sensitivityAdjustment = clamp(
      20 * Math.log10(Math.max(0.1, sensitivityMvPa) / 10),
      -2,
      2,
    );

    thresholdDba -= sensitivityAdjustment;
  }

  return {
    name: mic.displayName || mic.name || mic.short || "Selected mic",
    thresholdDba: clamp(thresholdDba, 48, 64),
    sensitivityMvPa,
    confidence: sensitivityMvPa ? 0.6 : 0.42,
  };
}

function psActiveAcousticMics() {
  const ids = typeof activeMicIds === "function" ? activeMicIds() : [];

  return ids.map((id) => MICS[id]).filter(Boolean);
}

// ---------------------------------------------------------------------------
// NPD (Noise-Power-Distance) source model.
//
// When a profile carries real NPD curves (Lmax in dB-A vs slant distance at
// discrete thrust settings, from ANP/AEDT data), we read the level directly by
// log-distance interpolation at the regime-appropriate thrust column. This is
// the precise path: it already includes spreading, emission angle and ANP's
// reference atmospheric absorption, so we do NOT re-apply spreading on top of
// it. Profiles without NPD fall back to the single-point + spreading model.
//
// Expected NPD shape on a profile:
//   npd: {
//     refMetric: "Lmax_dBA",
//     thrust: [
//       { setting: "departure"|"climb"|"cruise"|"approach"|"idle",
//         points: [ { distM: 305, dba: 90.2 }, { distM: 610, dba: 84.1 }, ... ] }
//     ]
//   }
// ---------------------------------------------------------------------------

function psRegimeToThrustSetting(regime) {
  switch (regime) {
    case "departure":
      return ["departure", "climb", "cruise"];
    case "climb":
      return ["climb", "departure", "cruise"];
    case "approach":
      return ["approach", "idle", "cruise"];
    case "descent":
      return ["approach", "idle", "cruise"];
    case "cruise":
      return ["cruise", "climb", "departure"];
    default:
      return ["cruise", "climb", "approach", "departure"];
  }
}

function psSelectNpdThrustColumn(npd, regime) {
  if (!npd || !Array.isArray(npd.thrust) || !npd.thrust.length) return null;

  const prefs = psRegimeToThrustSetting(regime);
  for (const want of prefs) {
    const col = npd.thrust.find(
      (t) => String(t.setting).toLowerCase() === want,
    );
    if (col && Array.isArray(col.points) && col.points.length) return col;
  }

  // Fall back to the first column with points.
  return (
    npd.thrust.find((t) => Array.isArray(t.points) && t.points.length) || null
  );
}

// Interpolate Lmax (dB-A) at a slant distance from an NPD column, linear in
// log10(distance) (the ANP convention). Clamps to the curve ends.
function psNpdLevelAtDistance(column, distanceM) {
  const pts = column.points
    .filter(
      (p) => Number.isFinite(Number(p.distM)) && Number.isFinite(Number(p.dba)),
    )
    .sort((a, b) => a.distM - b.distM);

  if (!pts.length) return null;

  const d = Math.max(1, distanceM);

  if (d <= pts[0].distM) return pts[0].dba;
  if (d >= pts[pts.length - 1].distM) {
    // Extrapolate beyond the last point with spherical spreading only (the
    // honest minimum), since ANP curves stop where data exists.
    const last = pts[pts.length - 1];
    return last.dba - 20 * Math.log10(d / last.distM);
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (d >= a.distM && d <= b.distM) {
      const la = Math.log10(a.distM);
      const lb = Math.log10(b.distM);
      const f = (Math.log10(d) - la) / (lb - la || 1);
      return a.dba + f * (b.dba - a.dba);
    }
  }

  return pts[pts.length - 1].dba;
}

// Returns a verified NPD-based received level (dB-A) for the aircraft at the
// current slant distance, or null when no NPD curve is available.
function psNpdReceiverDba(profile, regime, slantM) {
  const npd = profile && profile.npd;
  const column = psSelectNpdThrustColumn(npd, regime);
  if (!column) return null;

  const dba = psNpdLevelAtDistance(column, slantM);
  if (!Number.isFinite(dba)) return null;

  return {
    dba,
    thrustSetting: column.setting,
    refMetric: npd.refMetric || "Lmax_dBA",
  };
}

// Invert an NPD curve: find the slant distance (km) at which the regime's NPD
// level falls to the target threshold. Monotonic decreasing, so bisect.
function psInvertNpdRadiusKm(profile, regime, targetDba) {
  const npd = profile && profile.npd;
  const column = psSelectNpdThrustColumn(npd, regime);
  if (!column) return 0;

  const levelAt = (dM) => psNpdLevelAtDistance(column, dM);

  let lo = 30;
  let hi = 200000;

  if (!Number.isFinite(levelAt(lo)) || levelAt(lo) < targetDba) return 0;
  if (levelAt(hi) > targetDba) return clamp(hi / 1000, 0, 200);

  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (levelAt(mid) > targetDba) lo = mid;
    else hi = mid;
  }

  return clamp((lo + hi) / 2 / 1000, 0, 200);
}

// Flight regime inferred from altitude, vertical rate and speed. Drives both
// source level (thrust + airframe configuration) and a human-readable label.
function psInferAircraftRegime(ac, context) {
  const altFt = Number(context && context.altFt) || 0;
  const gs = Number(ac.gs || 0);
  const vr = Number(ac.geom_rate ?? ac.baro_rate ?? ac.vert_rate ?? 0);

  if (altFt < 6000 && vr > 600 && gs > 110) {
    return { regime: "departure", climbing: true, descending: false };
  }
  if (altFt < 7000 && vr < -350 && gs < 320) {
    return { regime: "approach", climbing: false, descending: true };
  }
  if (vr > 900) return { regime: "climb", climbing: true, descending: false };
  if (vr < -900)
    return { regime: "descent", climbing: false, descending: true };
  if (altFt > 24000)
    return { regime: "cruise", climbing: false, descending: false };

  return { regime: "level", climbing: false, descending: false };
}

function psAircraftSourceAdjustment(ac, profile, context, regimeInfo) {
  const gs = Number(ac.gs || 0);
  const engine = profile.engine || {};
  const regime = regimeInfo ? regimeInfo.regime : "level";
  let adjustment = 0;

  if (gs > 430) adjustment += Number(engine.speedDba || 1.8);
  else if (gs > 300) adjustment += Number(engine.speedDba || 1.8) * 0.6;
  else if (gs < 120) adjustment -= 1.5;

  // Regime-specific thrust / airframe noise.
  if (regime === "departure") {
    adjustment += Number(engine.climbDba || 2.4) + 1.5; // high thrust, low alt
  } else if (regime === "climb") {
    adjustment += Number(engine.climbDba || 2.4);
  } else if (regime === "approach") {
    // Reduced thrust but gear/flaps add broadband airframe noise.
    adjustment += Number(engine.descentDba || 0.8) + 2.0;
  } else if (regime === "descent") {
    adjustment += Number(engine.descentDba || 0.8);
  } else if (regime === "cruise") {
    adjustment -= 0.5;
  }

  adjustment += psAircraftDirectivityAdjustment(ac, profile, context);

  return adjustment;
}

function psAircraftDirectivityAdjustment(ac, profile, context) {
  const directivity = String(
    profile.directivity || profile.engine?.directivity || "generic",
  );

  if (!context || !Number.isFinite(context.x) || !Number.isFinite(context.y))
    return 0;
  if (directivity === "rotor") return 0.5;

  const h = Math.max(0.001, Number(context.horizontalKm || 0));
  const heading = Number(ac.track || 0) * D2R;
  const noseX = Math.sin(heading);
  const noseY = Math.cos(heading);
  const listenerX = -Number(context.x || 0) / h;
  const listenerY = -Number(context.y || 0) / h;
  const dot = noseX * listenerX + noseY * listenerY;

  if (directivity === "jet") {
    if (dot < -0.45) return 2.8;
    if (dot > 0.55) return -1.2;
  }

  if (directivity === "propeller") {
    if (dot > 0.4) return 1.2;
    if (dot < -0.55) return -0.4;
  }

  return 0;
}

function psPropagatedDba(
  dbaAt305m,
  distanceM,
  weatherCorrectionDba,
  absorptionDbPerKm,
) {
  const d = Math.max(30, distanceM);
  const a = Number.isFinite(Number(absorptionDbPerKm))
    ? Number(absorptionDbPerKm)
    : PS_BASE_AIR_ABSORPTION_DB_PER_KM;
  const spreadingLoss = 20 * Math.log10(d / PS_ACOUSTIC_REFERENCE_DISTANCE_M);
  const airLoss =
    Math.max(0, (d - PS_ACOUSTIC_REFERENCE_DISTANCE_M) / 1000) * a;

  return (
    dbaAt305m - spreadingLoss - airLoss + Number(weatherCorrectionDba || 0)
  );
}

// Slant distance (km) at which the propagated level equals the threshold.
// Solves spreading + air absorption (linear in distance) by bisection, instead
// of inverting spreading only, so distant high-absorption cases are accurate.
function psSolveThresholdSlantKm(sourceDba, thresholdDba, absorptionDbPerKm) {
  const budget = sourceDba - thresholdDba;

  if (!Number.isFinite(budget) || budget <= 0) return 0;

  const a = Number.isFinite(Number(absorptionDbPerKm))
    ? Math.max(0.05, Number(absorptionDbPerKm))
    : PS_BASE_AIR_ABSORPTION_DB_PER_KM;

  const loss = (dM) => {
    const d = Math.max(PS_ACOUSTIC_REFERENCE_DISTANCE_M, dM);
    return (
      20 * Math.log10(d / PS_ACOUSTIC_REFERENCE_DISTANCE_M) +
      ((d - PS_ACOUSTIC_REFERENCE_DISTANCE_M) / 1000) * a
    );
  };

  let lo = PS_ACOUSTIC_REFERENCE_DISTANCE_M;
  let hi = 200000;

  if (loss(hi) < budget) return clamp(hi / 1000, 0, 200);

  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (loss(mid) < budget) lo = mid;
    else hi = mid;
  }

  return clamp((lo + hi) / 2 / 1000, 0, 200);
}

function psEstimateAircraftNoise(ac, context) {
  const mics = psActiveAcousticMics();

  if (!mics.length) {
    return {
      model: "no-selected-mic",
      aircraftLabel: "Aircraft only",
      sourceType: "none",
      sourceDbaAt305m: null,
      receiverDba: null,
      micName: "",
      thresholdDba: null,
      marginDba: -Infinity,
      radiusKm: 0,
      slantRadiusKm: 0,
      regime: "level",
      soundSpeedMs: psSpeedOfSoundMs(15),
      levelSwingDb: 8,
      confidence: 0,
      tooHigh: false,
      noSelectedMic: true,
      reasonCodes: ["no_selected_mic"],
    };
  }

  const profile = psAircraftNoiseProfile(ac);
  const regimeInfo = psInferAircraftRegime(ac, context);
  if (profile) profile.regime = regimeInfo.regime;
  const hasSinglePoint = Number.isFinite(Number(profile.dbaAt305m));
  const sourceDbaAt305m = hasSinglePoint
    ? profile.dbaAt305m +
      psAircraftSourceAdjustment(ac, profile, context, regimeInfo)
    : null;
  const distanceM = Math.max(1, context.slantKm * 1000);
  const weather =
    typeof psWeatherCorrectionForAircraft === "function"
      ? psWeatherCorrectionForAircraft(context, profile)
      : {
          dbaCorrection: 0,
          radiusCorrectionDba: 0,
          confidence: 0.15,
          absorptionDbPerKm: PS_BASE_AIR_ABSORPTION_DB_PER_KM,
          refractionRegime: "calm",
          refractionSwingDb: 6,
          soundSpeedMs: psSpeedOfSoundMs(15),
          reasonCodes: ["weather_unavailable"],
        };
  const audio =
    typeof psAudioMonitorCorrection === "function"
      ? psAudioMonitorCorrection(context)
      : {
          thresholdDbaAdjustment: 0,
          confidenceBoost: 0,
          reasonCodes: ["phone_mic_unavailable"],
        };
  const audioReliability = clamp(
    Number(
      audio.reliability ??
        (audio.sourceKind === "mixer"
          ? 0.75
          : audio.sourceKind === "device"
            ? 0.18
            : 0),
    ),
    0,
    1,
  );
  const audioThresholdAdjustmentDba =
    Number(audio.thresholdDbaAdjustment || 0) * audioReliability;
  const absorptionDbPerKm = Number.isFinite(Number(weather.absorptionDbPerKm))
    ? Number(weather.absorptionDbPerKm)
    : PS_BASE_AIR_ABSORPTION_DB_PER_KM;

  // Receiver level. Prefer a verified NPD curve (already includes spreading +
  // emission angle + ANP reference absorption); only the refraction correction
  // is added on top. Otherwise use the single-point source + spreading +
  // weather-driven absorption model.
  const npd = psNpdReceiverDba(profile, regimeInfo.regime, distanceM);
  const usingNpd = !!npd;
  const receiverDba = usingNpd
    ? npd.dba + Number(weather.refractionExcessDb || weather.dbaCorrection || 0)
    : psPropagatedDba(
        sourceDbaAt305m,
        distanceM,
        weather.dbaCorrection,
        absorptionDbPerKm,
      );

  let best = null;

  for (const mic of mics) {
    // Scene-aware contamination threshold (protected noise floor) when the
    // threshold module is present; otherwise the legacy mic-profile threshold.
    let thresholdInfo = null;
    let baseThreshold;
    let micName;
    let micThresholdConfidence;

    if (typeof psContaminationThreshold === "function") {
      thresholdInfo = psContaminationThreshold(mic);
      baseThreshold = thresholdInfo.thresholdDba;
      micName = mic.displayName || mic.name || mic.short || "Selected mic";
      micThresholdConfidence = thresholdInfo.confidence;
    } else {
      const micProfile = psMicAcousticProfile(mic);
      baseThreshold = micProfile.thresholdDba;
      micName = micProfile.name;
      micThresholdConfidence = micProfile.confidence;
    }

    const thresholdDba = baseThreshold + audioThresholdAdjustmentDba;
    const marginDba = receiverDba - thresholdDba;

    // Threshold radius. With NPD we invert the NPD curve numerically; without
    // it we use the analytic spreading+absorption solver.
    let slantRadiusKm;
    if (usingNpd) {
      slantRadiusKm = psInvertNpdRadiusKm(
        profile,
        regimeInfo.regime,
        thresholdDba -
          Number(weather.refractionExcessDb || weather.dbaCorrection || 0),
      );
    } else {
      slantRadiusKm = psSolveThresholdSlantKm(
        sourceDbaAt305m + Number(weather.radiusCorrectionDba || 0),
        thresholdDba,
        absorptionDbPerKm,
      );
    }

    const altKm = Math.max(0, Number(context.altKm || 0));
    const radiusKm =
      slantRadiusKm > altKm
        ? Math.sqrt(slantRadiusKm * slantRadiusKm - altKm * altKm)
        : 0;

    const result = {
      micName,
      thresholdDba,
      thresholdInfo,
      marginDba,
      radiusKm,
      slantRadiusKm,
      micConfidence: micThresholdConfidence,
      confidence: clamp(
        Math.min(profile.confidence, micThresholdConfidence) +
          Number(weather.confidence || 0) * 0.18 +
          Number(audio.confidenceBoost || 0) * audioReliability +
          (usingNpd ? 0.12 : 0),
        0,
        0.95,
      ),
      sourceType: usingNpd ? "verified-npd" : profile.sourceType,
    };

    if (!best || result.marginDba > best.marginDba) {
      best = result;
    }
  }

  const tooHigh = !best || best.radiusKm <= 0;

  // Level uncertainty band (dB) for the timing/confidence layer: combine the
  // refraction swing, the source-level uncertainty (lower profile confidence
  // -> wider), and a mic-threshold term, in quadrature.
  const refractionSwing = Number(weather.refractionSwingDb || 5);
  const sourceSwing = clamp((1 - profile.confidence) * 9, 1.5, 8);
  const micSwing = clamp((1 - (best ? best.micConfidence : 0.4)) * 5, 1, 4);
  const levelSwingDb = clamp(
    Math.sqrt(
      refractionSwing * refractionSwing +
        sourceSwing * sourceSwing +
        micSwing * micSwing,
    ),
    2,
    18,
  );

  return {
    model: "acoustic-engine-v3",
    aircraftLabel: profile.label,
    sourceType: usingNpd ? "verified-npd" : profile.sourceType,
    usingNpd,
    npdThrustSetting: usingNpd ? npd.thrustSetting : null,
    sourceDbaAt305m,
    receiverDba,
    weatherCorrectionDba: weather.dbaCorrection,
    windComponentKmh: weather.windComponentKmh,
    absorptionDbPerKm,
    regime: regimeInfo.regime,
    refractionRegime: weather.refractionRegime,
    refractionSwingDb: weather.refractionSwingDb,
    soundSpeedMs: weather.soundSpeedMs || psSpeedOfSoundMs(15),
    levelSwingDb,
    thresholdInfo: best ? best.thresholdInfo : null,
    audioEvidence: {
      ...audio,
      reliability: audioReliability,
      appliedThresholdAdjustmentDba: audioThresholdAdjustmentDba,
    },
    micName: best ? best.micName : "Unknown",
    thresholdDba: best ? best.thresholdDba : 40,
    marginDba: best ? best.marginDba : -Infinity,
    radiusKm: best ? best.radiusKm : 0,
    slantRadiusKm: best ? best.slantRadiusKm : 0,
    confidence: best ? best.confidence : 0.2,
    reasonCodes: [
      "aircraft_profile_" + (usingNpd ? "verified_npd" : profile.sourceType),
      "regime_" + regimeInfo.regime,
      ...(weather.reasonCodes || []),
      ...(audio.reasonCodes || []),
    ],
    tooHigh,
  };
}
