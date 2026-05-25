"use strict";

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

function analyze(ac) {
  if (!state.loc || ac.lat == null || ac.lon == null) return null;

  const rs = rangeSettings();
  const altFt = typeof ac.alt_baro === "number" ? ac.alt_baro : null;

  if (altFt == null || altFt < 0) return null;

  const p = planeNow(ac);
  const pos = xy(p.lat, p.lon, state.loc.lat, state.loc.lon);
  const h = Math.hypot(pos.x, pos.y);
  const altKm = altFt / FT_PER_M / 1000;
  const slant = Math.hypot(h, altKm);

  const acoustic = psEstimateAircraftNoise(ac, {
    aircraft: p,
    horizontalKm: h,
    slantKm: slant,
    altKm,
    altFt,
    rangeSettings: rs,
  });

  // Aircraft-specific acoustic threshold.
  // Do not clamp this to the visible blue mic reference ring.
  // Each aircraft gets its own range based on source level, altitude, distance, and selected mic.
  const acousticRadiusKm = Number.isFinite(Number(acoustic.radiusKm))
    ? Math.max(0, Number(acoustic.radiusKm))
    : 0;

  acoustic.displayRadiusKm = acousticRadiusKm;

  const tooHigh = acoustic.tooHigh || acousticRadiusKm <= 0;

  let entry = null;
  let exit = null;
  let inMic = false;

  if (!tooHigh && acousticRadiusKm > 0) {
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

  const status = tooHigh
    ? "high"
    : inMic
      ? "audible"
      : entry != null
        ? "approaching"
        : "clear";

  const typeFactor = aircraftTypeFactor(ac.t);
  const marginFactor = clamp((acoustic.marginDba + 12) / 24, 0.1, 1.55);
  const timeFactor =
    status === "audible"
      ? 1.1
      : status === "approaching"
        ? clamp(1 - Math.max(0, entry) / 900, 0.15, 0.75)
        : 0.12;

  const risk = clamp(typeFactor * marginFactor * timeFactor, 0.1, 1.55);

  return {
    raw: ac,
    icao: ac.hex || Math.random().toString(36),
    callsign: (ac.flight || "").trim() || (ac.hex || "").toUpperCase(),
    type: ac.t || "?",
    altFt,
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
    tooHigh,
    typeFactor,
    risk,
    acoustic,
  };
}
