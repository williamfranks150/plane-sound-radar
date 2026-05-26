"use strict";

let PS_AIRCRAFT_PROFILE_DB = {
  schema: "plane-sound-aircraft-type-profiles-v1",
  profiles: [],
};

let PS_AIRCRAFT_ENGINE_DB = {
  schema: "plane-sound-aircraft-engine-profiles-v1",
  profiles: {},
};

async function psFetchJsonFile(path, fallback) {
  try {
    const res = await fetch(path, { cache: "no-store" });

    if (!res.ok) throw new Error(path + " " + res.status);

    return await res.json();
  } catch (err) {
    console.warn("Profile data unavailable:", err.message);
    return fallback;
  }
}

async function psLoadAircraftProfileData() {
  const [types, engines] = await Promise.all([
    psFetchJsonFile("data/aircraft-type-profiles.json", PS_AIRCRAFT_PROFILE_DB),
    psFetchJsonFile(
      "data/aircraft-engine-profiles.json",
      PS_AIRCRAFT_ENGINE_DB,
    ),
  ]);

  if (types && Array.isArray(types.profiles)) PS_AIRCRAFT_PROFILE_DB = types;
  if (engines && engines.profiles && typeof engines.profiles === "object") {
    PS_AIRCRAFT_ENGINE_DB = engines;
  }
}

function psNormalizeAircraftTypeCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function psAircraftProfileFor(ac) {
  const type = psNormalizeAircraftTypeCode(ac && ac.t);

  if (!type) return null;

  const profile = PS_AIRCRAFT_PROFILE_DB.profiles.find((candidate) => {
    const codes = Array.isArray(candidate.codes) ? candidate.codes : [];

    return codes.some((code) => psNormalizeAircraftTypeCode(code) === type);
  });

  if (!profile) return null;

  const engine =
    PS_AIRCRAFT_ENGINE_DB.profiles[profile.engineClass] ||
    PS_AIRCRAFT_ENGINE_DB.profiles.narrowbody_turbofan ||
    {};

  return {
    typeCode: type,
    label: profile.label || type,
    category: profile.category || "aircraft",
    sourceType: "proxy",
    dbaAt305m: Number(profile.dbaAt305m || 84),
    confidence: Number(profile.confidence || 0.35),
    engineClass: profile.engineClass || "unknown",
    engine,
    directivity: engine.directivity || "generic",
  };
}
