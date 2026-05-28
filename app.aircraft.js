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

function aircraftTypeFactor(t) {
  t = String(t || "").toUpperCase();
  if (!t || t === "?") return 1;
  if (t.includes("A388")) return 1.8;
  if (t.includes("B748") || t.includes("B744")) return 1.65;
  if (/^B77|^B78|^A35|^A34|^A33/.test(t)) return 1.45;
  if (/^B76|^B75|^A30|^A31/.test(t)) return 1.3;
  if (/^B73|^A32|^A22|^E19|^E29|^BCS/.test(t)) return 1.08;
  if (/^E17|^E75|^CRJ|^DH8|^AT[47]/.test(t)) return 0.85;
  if (/^C1|^C2|^P28|^SR2|^BE|^PA/.test(t)) return 0.65;
  if (/^H|^R44|^R66/.test(t)) return 0.9;
  return 1;
}

function planeNow(ac) {
  const dt = state.adsb.lastFetch
    ? (Date.now() - state.adsb.lastFetch) / 1000
    : 0;
  const gs = ((ac.gs || 0) * NM_TO_KM) / 3600;
  const tr = (ac.track || 0) * D2R;
  const vx = gs * Math.sin(tr);
  const vy = gs * Math.cos(tr);
  let lat = ac.lat,
    lon = ac.lon;
  if (state.loc && dt > 0 && lat != null && lon != null) {
    lat += (vy * dt) / KM_PER_LAT;
    lon += (vx * dt) / (KM_PER_LAT * Math.cos(state.loc.lat * D2R));
  }
  return { ...ac, lat, lon, vx, vy };
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

  const acousticRadiusKm = Number.isFinite(Number(acoustic.radiusKm))
    ? Math.max(0, Number(acoustic.radiusKm))
    : 0;

  acoustic.displayRadiusKm = acousticRadiusKm;

  const noSelectedMic = acoustic.noSelectedMic === true;
  const belowAcousticThreshold =
    !noSelectedMic && (acoustic.tooHigh || acousticRadiusKm <= 0);

  let entry = null;
  let exit = null;
  let inMic = false;

  if (!belowAcousticThreshold && acousticRadiusKm > 0) {
    const hT = acousticRadiusKm;
    const v2 = p.vx * p.vx + p.vy * p.vy;

    inMic = h <= hT;

    if (v2 > 1e-9) {
      const b = 2 * (pos.x * p.vx + pos.y * p.vy);
      const c = h * h - hT * hT;
      const disc = b * b - 4 * v2 * c;

      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const t1 = (-b - sq) / (2 * v2);
        const t2 = (-b + sq) / (2 * v2);

        if (t2 >= 0) {
          entry = t1 > 0 ? t1 : 0;
          exit = t2 + rs.tail;
        }
      }
    } else if (inMic) {
      entry = 0;
      exit = rs.tail;
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

  const typeFactor = aircraftTypeFactor(ac.t);
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

  const risk = clamp(typeFactor * marginFactor * timeFactor, 0.1, 1.55);

  const result = {
    raw: ac,
    icao: ac.hex || Math.random().toString(36),
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
    h,
    slant,
    bearing: brg(state.loc.lat, state.loc.lon, p.lat, p.lon),
    soundDelay: (slant * 1000) / SOUND_SPEED,
    entry,
    exit,
    status,
    tooHigh: belowAcousticThreshold,
    belowAcousticThreshold,
    noSelectedMic,
    pollutesSound: status === "audible" || status === "approaching",
    typeFactor,
    risk,
    acoustic,
  };

  return psApplyTimingContinuity(ac, result, now);
}
