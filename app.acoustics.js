"use strict";

const PS_ACOUSTIC_REFERENCE_DISTANCE_M = 305;
const PS_AIR_ABSORPTION_DB_PER_KM = 1.2;

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

  if (t.includes("A388")) {
    dbaAt305m = 96;
    label = "Estimated super-heavy jet";
    confidence = 0.35;
  } else if (/^(B74|B77|B78|A34|A35|A33|MD11|DC10)/.test(t)) {
    dbaAt305m = 92;
    label = "Estimated heavy jet";
    confidence = 0.34;
  } else if (/^(B75|B76|A30|A31)/.test(t)) {
    dbaAt305m = 89;
    label = "Estimated medium jet";
    confidence = 0.33;
  } else if (/^(B73|B38|A32|A22|BCS|E19|E29)/.test(t)) {
    dbaAt305m = 86;
    label = "Estimated narrowbody jet";
    confidence = 0.32;
  } else if (/^(E17|E75|CRJ)/.test(t)) {
    dbaAt305m = 81;
    label = "Estimated regional jet";
    confidence = 0.28;
  } else if (/^(DH8|AT4|AT7|SF3|BE9)/.test(t)) {
    dbaAt305m = 78;
    label = "Estimated turboprop";
    confidence = 0.26;
  } else if (/^(H|R44|R66|B06|EC|AS|S76)/.test(t)) {
    dbaAt305m = 82;
    label = "Estimated helicopter";
    confidence = 0.24;
  } else if (/^(C1|C2|C3|P28|SR2|BE|PA)/.test(t)) {
    dbaAt305m = 74;
    label = "Estimated light aircraft";
    confidence = 0.22;
  }

  return {
    sourceType: "estimated",
    label,
    dbaAt305m,
    confidence,
  };
}

function psAircraftNoiseProfile(type) {
  const verified = psFindVerifiedAircraftNoiseProfile(type);

  if (verified) {
    return {
      sourceType: "verified",
      label: verified.label || type,
      dbaAt305m: Number(verified.dbaAt305m),
      confidence: Number(verified.confidence || 0.85),
    };
  }

  return psFallbackAircraftNoiseProfile(type);
}

function psParseSensitivityMvPa(value) {
  const text = String(value || "").toUpperCase();
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*MV\s*\/\s*PA/);

  return match ? Number(match[1]) : null;
}

function psMicAcousticProfile(mic) {
  // This is a production contamination threshold, not a raw microphone audibility threshold.
  // The earlier 28-32 dBA threshold made the calculated radius unrealistically huge.
  // Microphone sensitivity affects output voltage, but it does not make distant aircraft
  // magically contaminate dialogue at 25-100 km. The practical threshold is the aircraft SPL
  // at the recording position becoming high enough to matter in production sound.

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

  // Keep sensitivity influence intentionally small.
  // Large sensitivity corrections created unrealistic aircraft ranges.
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
  const selected = ids.map((id) => MICS[id]).filter(Boolean);

  return selected.length ? selected : [HUMAN_BASELINE];
}

function psAircraftSourceAdjustment(ac) {
  const gs = Number(ac.gs || 0);
  let adjustment = 0;

  if (gs > 430) adjustment += 3;
  else if (gs > 300) adjustment += 1.5;
  else if (gs < 120) adjustment -= 2;

  const vr = Number(ac.baro_rate || ac.geom_rate || ac.vert_rate || 0);

  if (vr > 900) adjustment += 2;
  else if (vr < -900) adjustment += 1;

  return adjustment;
}

function psPropagatedDba(dbaAt305m, distanceM) {
  const d = Math.max(30, distanceM);
  const spreadingLoss = 20 * Math.log10(d / PS_ACOUSTIC_REFERENCE_DISTANCE_M);
  const airLoss =
    Math.max(0, (d - PS_ACOUSTIC_REFERENCE_DISTANCE_M) / 1000) *
    PS_AIR_ABSORPTION_DB_PER_KM;

  return dbaAt305m - spreadingLoss - airLoss;
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
  const profile = psAircraftNoiseProfile(ac.t);
  const sourceDbaAt305m = profile.dbaAt305m + psAircraftSourceAdjustment(ac);
  const distanceM = Math.max(1, context.slantKm * 1000);
  const receiverDba = psPropagatedDba(sourceDbaAt305m, distanceM);
  const mics = psActiveAcousticMics();

  let best = null;

  for (const mic of mics) {
    const micProfile = psMicAcousticProfile(mic);
    const marginDba = receiverDba - micProfile.thresholdDba;
    const radiusKm = psThresholdRadiusKm(
      sourceDbaAt305m,
      micProfile.thresholdDba,
      context.altKm,
    );

    const result = {
      micName: micProfile.name,
      thresholdDba: micProfile.thresholdDba,
      sensitivityMvPa: micProfile.sensitivityMvPa,
      marginDba,
      radiusKm,
      confidence: Math.min(profile.confidence, micProfile.confidence),
      sourceType: profile.sourceType,
    };

    if (!best || result.marginDba > best.marginDba) {
      best = result;
    }
  }

  const tooHigh = !best || best.radiusKm <= 0;

  return {
    model: psHasVerifiedAircraftNoiseData()
      ? "verified-aircraft-noise-profile"
      : "estimated-aircraft-class-profile",
    aircraftLabel: profile.label,
    sourceType: profile.sourceType,
    sourceDbaAt305m,
    receiverDba,
    micName: best ? best.micName : "Unknown",
    thresholdDba: best ? best.thresholdDba : 40,
    marginDba: best ? best.marginDba : -Infinity,
    radiusKm: best ? best.radiusKm : 0,
    confidence: best ? best.confidence : 0.2,
    tooHigh,
  };
}
