"use strict";

const PS_AIRCRAFT_TIMING_CACHE = new Map();

function psAircraftTimingKey(ac) {
  return String(ac && (ac.hex || ac.flight || "")).trim();
}

function psPruneAircraftTimingCache(now) {
  for (const [key, value] of PS_AIRCRAFT_TIMING_CACHE.entries()) {
    if (!value || now - Number(value.updatedAt || 0) > 180000) {
      PS_AIRCRAFT_TIMING_CACHE.delete(key);
    }
  }
}

function psApplyTimingContinuity(ac, result, now) {
  const key = psAircraftTimingKey(ac);

  if (!key || result.noSelectedMic || result.belowAcousticThreshold) {
    if (key) PS_AIRCRAFT_TIMING_CACHE.delete(key);
    return result;
  }

  const cached = PS_AIRCRAFT_TIMING_CACHE.get(key);

  if (
    result.status === "approaching" &&
    result.entry != null &&
    result.exit != null
  ) {
    PS_AIRCRAFT_TIMING_CACHE.set(key, {
      entryAt: now + Math.max(0, result.entry) * 1000,
      exitAt: now + Math.max(0, result.exit) * 1000,
      updatedAt: now,
    });

    return result;
  }

  if (result.status === "audible" && result.exit != null) {
    PS_AIRCRAFT_TIMING_CACHE.set(key, {
      entryAt: cached?.entryAt ?? now,
      exitAt: now + Math.max(0, result.exit) * 1000,
      updatedAt: now,
    });

    return result;
  }

  if (!cached) return result;

  const entryLeft = (Number(cached.entryAt || 0) - now) / 1000;
  const exitLeft = (Number(cached.exitAt || 0) - now) / 1000;

  if (exitLeft <= -5) {
    PS_AIRCRAFT_TIMING_CACHE.delete(key);
    return result;
  }

  if (entryLeft > 0) {
    return {
      ...result,
      status: "approaching",
      entry: entryLeft,
      exit: Math.max(entryLeft, exitLeft),
      pollutesSound: true,
    };
  }

  if (exitLeft > 0) {
    return {
      ...result,
      status: "audible",
      entry: 0,
      exit: exitLeft,
      pollutesSound: true,
    };
  }

  return result;
}

function planeNow(ac) {
  const dt = state.adsb.lastFetch
    ? (Date.now() - state.adsb.lastFetch) / 1000
    : 0;
  const gs = ((ac.gs || 0) * NM_TO_KM) / 3600;
  const tr = (ac.track || 0) * D2R;
  const vx = gs * Math.sin(tr);
  const vy = gs * Math.cos(tr);
  // Vertical rate (ft/min) -> km/s. Prefer geometric rate, then baro.
  const vrFtMin = Number(ac.geom_rate ?? ac.baro_rate ?? ac.vert_rate ?? 0);
  const vz = vrFtMin / FT_PER_M / 1000 / 60;
  let lat = ac.lat,
    lon = ac.lon;
  if (state.loc && dt > 0 && lat != null && lon != null) {
    lat += (vy * dt) / KM_PER_LAT;
    lon += (vx * dt) / (KM_PER_LAT * Math.cos(state.loc.lat * D2R));
  }
  return { ...ac, lat, lon, vx, vy, vz };
}

function psNumericAircraftAltitude(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function psLikelyCommercialTransport(type) {
  const t = String(type || "").toUpperCase();

  return /^(A2|A3|B3|B7|B8|BCS|E1|E2|CRJ|MD|DC)/.test(t);
}

function psAircraftAltitudeInfo(ac, horizontalKm) {
  const geomFt = psNumericAircraftAltitude(ac.alt_geom);
  const baroFt = psNumericAircraftAltitude(ac.alt_baro);
  const altFt = geomFt != null ? geomFt : baroFt;
  const source = geomFt != null ? "GEOM" : baroFt != null ? "BARO" : "";
  const commercial = psLikelyCommercialTransport(ac.t);
  const disagreement =
    geomFt != null && baroFt != null ? Math.abs(geomFt - baroFt) : 0;
  const suspiciousLowBaro =
    source === "BARO" &&
    altFt != null &&
    horizontalKm > 8 &&
    commercial &&
    altFt < 1500;
  const lowConfidence =
    source === "BARO" && (suspiciousLowBaro || disagreement > 1000);

  return {
    altFt,
    source,
    geomFt,
    baroFt,
    lowConfidence,
    label: source ? source + " ALT" : "ALT",
  };
}

// Solve |pos + v t|^2 = R^2 for t (seconds), pos/v in 3-D km / (km/s).
// Returns { entry, exit } emitted-time crossings (entry <= exit) or null.
function psSlantCrossings(pos, vel, R) {
  const v2 = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
  const p2 = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
  const b = 2 * (pos.x * vel.x + pos.y * vel.y + pos.z * vel.z);
  const c = p2 - R * R;

  if (v2 < 1e-12) {
    // Effectively stationary: inside forever or never.
    if (c <= 0) return { entry: -Infinity, exit: Infinity };
    return null;
  }

  const disc = b * b - 4 * v2 * c;

  if (disc < 0) return null;

  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * v2);
  const t2 = (-b + sq) / (2 * v2);

  return { entry: Math.min(t1, t2), exit: Math.max(t1, t2) };
}

function analyze(ac) {
  const now = Date.now();

  psPruneAircraftTimingCache(now);

  if (!state.loc || ac.lat == null || ac.lon == null) return null;

  const rs = rangeSettings();
  const p = planeNow(ac);
  const pos = xy(p.lat, p.lon, state.loc.lat, state.loc.lon);
  const h = Math.hypot(pos.x, pos.y);
  const altitude = psAircraftAltitudeInfo(ac, h);
  const altFt = altitude.altFt;

  if (altFt == null || altFt < 0) return null;

  const altKm = altFt / FT_PER_M / 1000;
  const slant = Math.hypot(h, altKm);

  const acoustic = psEstimateAircraftNoise(ac, {
    aircraft: p,
    horizontalKm: h,
    slantKm: slant,
    altKm,
    altFt,
    x: pos.x,
    y: pos.y,
    rangeSettings: rs,
  });

  const slantRadiusKm = Number.isFinite(Number(acoustic.slantRadiusKm))
    ? Math.max(0, Number(acoustic.slantRadiusKm))
    : 0;
  const acousticRadiusKm = Number.isFinite(Number(acoustic.radiusKm))
    ? Math.max(0, Number(acoustic.radiusKm))
    : 0;

  acoustic.displayRadiusKm = acousticRadiusKm;

  const noSelectedMic = acoustic.noSelectedMic === true;
  const belowAcousticThreshold =
    !noSelectedMic && (acoustic.tooHigh || slantRadiusKm <= 0);

  // Speed of sound along the path (m/s), and the propagation delay added at
  // the threshold-crossing geometry (slant == slantRadiusKm there).
  const soundSpeedMs = Number(acoustic.soundSpeedMs) || 343;
  const crossingDelayS = (slantRadiusKm * 1000) / soundSpeedMs;
  const nowDelayS = (slant * 1000) / soundSpeedMs;

  let entry = null; // heard-time seconds until pollution begins
  let exit = null; // heard-time seconds until pollution clears
  let inMic = false;
  let entryBand = null;
  let exitBand = null;

  if (!belowAcousticThreshold && slantRadiusKm > 0) {
    const pos3 = { x: pos.x, y: pos.y, z: altKm };
    const vel3 = { x: p.vx, y: p.vy, z: p.vz || 0 };
    const cross = psSlantCrossings(pos3, vel3, slantRadiusKm);

    if (cross) {
      // Convert emitted-time crossings to heard (arrival) time by adding the
      // propagation delay at the crossing geometry.
      const heardEntry = cross.entry + crossingDelayS;
      const heardExit = cross.exit + crossingDelayS;

      if (heardExit > 0) {
        if (heardEntry <= 0) {
          inMic = true;
          entry = 0;
          exit = heardExit;
        } else {
          entry = heardEntry;
          exit = heardExit;
        }

        // Timing uncertainty: a level swing of levelSwingDb maps to a slant
        // radius uncertainty (spreading-dominated: dd/d ~ 10^(dL/20)-1), which
        // maps to a time band via the radial closing speed.
        const levelSwingDb = Number(acoustic.levelSwingDb) || 6;
        const radiusFrac = Math.pow(10, levelSwingDb / 20) - 1;
        const radiusBandKm = slantRadiusKm * clamp(radiusFrac, 0.05, 1.2);
        const closingKmps = Math.max(
          0.02,
          Math.abs(pos3.x * vel3.x + pos3.y * vel3.y + pos3.z * vel3.z) /
            Math.max(0.001, slant),
        );
        const windowS = entry > 0 ? Math.max(30, entry + exit) : exit;
        const band = clamp(radiusBandKm / closingKmps, 3, windowS * 0.6);

        entryBand = entry > 0 ? band : 0;
        exitBand = band;
      }
    }
  }

  const status = noSelectedMic
    ? "clear"
    : belowAcousticThreshold
      ? "no-risk"
      : inMic
        ? "audible"
        : entry != null
          ? "approaching"
          : "clear";

  const safeMarginDba = Number.isFinite(Number(acoustic.marginDba))
    ? Number(acoustic.marginDba)
    : belowAcousticThreshold
      ? -24
      : -12;
  const marginFactor = clamp((safeMarginDba + 12) / 24, 0.1, 1.55);
  const timeFactor =
    status === "audible"
      ? 1.1
      : status === "approaching"
        ? clamp(1 - Math.max(0, entry) / 900, 0.15, 0.75)
        : status === "clear"
          ? 0.22
          : 0.08;

  // Risk now driven by the acoustic margin (real dB), not a type multiplier.
  const risk = clamp(marginFactor * timeFactor * 1.05, 0.1, 1.55);

  const result = {
    raw: ac,
    icao:
      ac.hex ||
      (ac.flight || "").trim() ||
      "anon-" +
        String(ac.t || "?") +
        "-" +
        Math.round((ac.lat || 0) * 100) +
        "-" +
        Math.round((ac.lon || 0) * 100),
    callsign: (ac.flight || "").trim() || (ac.hex || "").toUpperCase(),
    type: ac.t || "?",
    altFt,
    altSource: altitude.source,
    altLabel: altitude.label,
    altGeomFt: altitude.geomFt,
    altBaroFt: altitude.baroFt,
    altLowConfidence: altitude.lowConfidence,
    gs: ac.gs || 0,
    track: ac.track || 0,
    x: pos.x,
    y: pos.y,
    vx: p.vx,
    vy: p.vy,
    vz: p.vz || 0,
    h,
    slant,
    slantRadiusKm,
    bearing: brg(state.loc.lat, state.loc.lon, p.lat, p.lon),
    soundDelay: nowDelayS,
    soundSpeedMs,
    entry,
    exit,
    entryBand,
    exitBand,
    status,
    regime: acoustic.regime,
    refractionRegime: acoustic.refractionRegime,
    levelSwingDb: acoustic.levelSwingDb,
    confidence: acoustic.confidence,
    tooHigh: belowAcousticThreshold,
    belowAcousticThreshold,
    noSelectedMic,
    pollutesSound: status === "audible" || status === "approaching",
    risk,
    acoustic,
  };

  return psApplyTimingContinuity(ac, result, now);
}
