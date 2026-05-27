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
      dbaAt305m: Number(verified.dbaAt305m),
      confidence: Number(verified.confidence || 0.85),
      engine: verified.engine || {},
      directivity: verified.directivity || "generic",
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

function psAircraftSourceAdjustment(ac, profile, context) {
  const gs = Number(ac.gs || 0);
  const engine = profile.engine || {};
  let adjustment = 0;

  if (gs > 430) adjustment += Number(engine.speedDba || 1.8);
  else if (gs > 300) adjustment += Number(engine.speedDba || 1.8) * 0.6;
  else if (gs < 120) adjustment -= 1.5;

  const vr = Number(ac.baro_rate || ac.geom_rate || ac.vert_rate || 0);

  if (vr > 900) adjustment += Number(engine.climbDba || 2.4);
  else if (vr < -900) adjustment += Number(engine.descentDba || 0.8);

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

function psPropagatedDba(dbaAt305m, distanceM, weatherCorrectionDba) {
  const d = Math.max(30, distanceM);
  const spreadingLoss = 20 * Math.log10(d / PS_ACOUSTIC_REFERENCE_DISTANCE_M);
  const airLoss =
    Math.max(0, (d - PS_ACOUSTIC_REFERENCE_DISTANCE_M) / 1000) *
    PS_BASE_AIR_ABSORPTION_DB_PER_KM;

  return (
    dbaAt305m - spreadingLoss - airLoss + Number(weatherCorrectionDba || 0)
  );
}

function psThresholdRadiusKm(sourceDbaAt305m, thresholdDba, altKm) {
  const rawDistanceM =
    PS_ACOUSTIC_REFERENCE_DISTANCE_M *
    Math.pow(10, (sourceDbaAt305m - thresholdDba) / 20);

  const slantKm = clamp(rawDistanceM / 1000, 0, 120);

  if (slantKm <= altKm) return 0;

  return Math.sqrt(Math.max(0, slantKm * slantKm - altKm * altKm));
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
      confidence: 0,
      tooHigh: false,
      noSelectedMic: true,
      reasonCodes: ["no_selected_mic"],
    };
  }

  const profile = psAircraftNoiseProfile(ac);
  const sourceDbaAt305m =
    profile.dbaAt305m + psAircraftSourceAdjustment(ac, profile, context);
  const distanceM = Math.max(1, context.slantKm * 1000);
  const weather =
    typeof psWeatherCorrectionForAircraft === "function"
      ? psWeatherCorrectionForAircraft(context, profile)
      : {
          dbaCorrection: 0,
          radiusCorrectionDba: 0,
          confidence: 0.15,
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
  const receiverDba = psPropagatedDba(
    sourceDbaAt305m,
    distanceM,
    weather.dbaCorrection,
  );

  let best = null;

  for (const mic of mics) {
    const micProfile = psMicAcousticProfile(mic);
    const thresholdDba = micProfile.thresholdDba + audioThresholdAdjustmentDba;
    const marginDba = receiverDba - thresholdDba;
    const radiusKm = psThresholdRadiusKm(
      sourceDbaAt305m + Number(weather.radiusCorrectionDba || 0),
      thresholdDba,
      context.altKm,
    );

    const result = {
      micName: micProfile.name,
      thresholdDba,
      sensitivityMvPa: micProfile.sensitivityMvPa,
      marginDba,
      radiusKm,
      confidence: clamp(
        Math.min(profile.confidence, micProfile.confidence) +
          Number(weather.confidence || 0) * 0.18 +
          Number(audio.confidenceBoost || 0) * audioReliability,
        0,
        0.92,
      ),
      sourceType: profile.sourceType,
    };

    if (!best || result.marginDba > best.marginDba) {
      best = result;
    }
  }

  const tooHigh = !best || best.radiusKm <= 0;

  return {
    model: "acoustic-engine-v3",
    aircraftLabel: profile.label,
    sourceType: profile.sourceType,
    sourceDbaAt305m,
    receiverDba,
    weatherCorrectionDba: weather.dbaCorrection,
    windComponentKmh: weather.windComponentKmh,
    absorptionDbPerKm: weather.absorptionDbPerKm,
    audioEvidence: {
      ...audio,
      reliability: audioReliability,
      appliedThresholdAdjustmentDba: audioThresholdAdjustmentDba,
    },
    micName: best ? best.micName : "Unknown",
    thresholdDba: best ? best.thresholdDba : 40,
    marginDba: best ? best.marginDba : -Infinity,
    radiusKm: best ? best.radiusKm : 0,
    confidence: best ? best.confidence : 0.2,
    reasonCodes: [
      "aircraft_profile_" + profile.sourceType,
      ...(weather.reasonCodes || []),
      ...(audio.reasonCodes || []),
    ],
    tooHigh,
  };
}
