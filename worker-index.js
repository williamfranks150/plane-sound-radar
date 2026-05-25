// Aircraft Radar backend starter.
// Endpoints:
//   GET /mic?model=Sennheiser%20MKH%20416
//   GET /geocode?q=2-150%20Wallace%20Ave%20Toronto
//   GET /aircraft?lat=43.66&lon=-79.44&radiusNm=25
//
// Notes:
// - /mic searches the built-in verified mic database and optional KV namespace.
// - /geocode proxies Nominatim with a proper User-Agent.
// - /aircraft proxies public ADS-B feeds to avoid browser/CORS brittleness.

import MIC_SPECS from "../data/mic-specs.json" assert { type: "json" };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=300",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function scoreMic(query, mic) {
  const q = norm(query);
  if (!q || q.length < 3) return 0;

  const names = [mic.name, mic.short, ...(mic.aliases || [])]
    .map(norm)
    .filter(Boolean);

  // Manufacturer alone must never match. A query like "Sennheiser HD 500 BAM"
  // must not resolve to MKH 416 just because both include "Sennheiser".
  let score = 0;
  for (const term of names) {
    if (term === q) score = Math.max(score, 100);
    else if (q.includes(term) && term.length >= 3) score = Math.max(score, 95);
    else if (term.includes(q) && q.length >= 5) score = Math.max(score, 80);
  }
  return score;
}

function normalizeMic(mic) {
  const required = [mic.name, mic.mic, mic.hot, mic.tail, mic.ceil];
  if (
    required.some(
      (v) => v === undefined || v === null || String(v).trim() === "",
    )
  ) {
    return null;
  }

  const micKm = Number(mic.mic);
  const hotKm = Number(mic.hot);
  const tailSeconds = Number(mic.tail);
  const ceilFt = Number(mic.ceil);

  if (
    !Number.isFinite(micKm) ||
    !Number.isFinite(hotKm) ||
    !Number.isFinite(tailSeconds) ||
    !Number.isFinite(ceilFt)
  )
    return null;
  if (
    micKm <= 0 ||
    micKm > 80 ||
    hotKm <= 0 ||
    hotKm > micKm ||
    tailSeconds < 0 ||
    tailSeconds > 600 ||
    ceilFt < 1000 ||
    ceilFt > 50000
  )
    return null;

  return {
    status: "verified",
    manufacturer: mic.manufacturer || "",
    name: mic.name,
    short: mic.short || mic.name,
    kind: mic.kind || "verified",
    mic: micKm,
    hot: hotKm,
    tail: tailSeconds,
    ceil: ceilFt,
    sensitivityMvPa: mic.sensitivityMvPa ?? null,
    selfNoiseDba: mic.selfNoiseDba ?? null,
    aliases: mic.aliases || [],
    confidence: mic.confidence || "verified-database",
  };
}

async function findMic(env, query) {
  const local = MIC_SPECS.map((mic) => ({ mic, score: scoreMic(query, mic) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  if (local) {
    const normalized = normalizeMic(local.mic);
    if (normalized) return normalized;
  }

  // Optional Cloudflare KV namespace binding:
  // [[kv_namespaces]]
  // binding = "MIC_DB"
  // id = "..."
  if (env.MIC_DB) {
    const key = norm(query);
    const stored = await env.MIC_DB.get(key, { type: "json" });
    if (stored) {
      const normalized = normalizeMic(stored);
      if (normalized) return normalized;
    }
  }

  return null;
}

async function handleMic(request, env) {
  const url = new URL(request.url);
  const model = url.searchParams.get("model") || "";
  const result = await findMic(env, model);
  if (!result)
    return json({ status: "not_found", error: "mic_not_found", model }, 404);
  return json(result);
}

async function handleGeocode(request, env) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  if (!q.trim()) return json({ error: "missing_q" }, 400);

  const endpoint =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({ q, format: "json", limit: "6", addressdetails: "1" });

  const res = await fetch(endpoint, {
    headers: {
      "Accept-Language": "en",
      "User-Agent":
        env.NOMINATIM_USER_AGENT ||
        "AircraftRadarSoundDept/0.1 contact:replace@example.com",
    },
  });

  if (!res.ok)
    return json({ error: "geocode_failed", status: res.status }, 502);
  return json(await res.json(), 200, {
    "Cache-Control": "public, max-age=86400",
  });
}

function openskyUrl(lat, lon, nm) {
  const NM_TO_KM = 1.852;
  const KM_PER_LAT = 111.32;
  const dLat = (nm * NM_TO_KM) / KM_PER_LAT;
  const dLon = (nm * NM_TO_KM) / (KM_PER_LAT * Math.cos((lat * Math.PI) / 180));
  return `https://opensky-network.org/api/states/all?lamin=${lat - dLat}&lomin=${lon - dLon}&lamax=${lat + dLat}&lomax=${lon + dLon}`;
}

function normalizeOpenSky(data) {
  if (!Array.isArray(data?.states)) return { ac: [] };
  const FT_PER_M = 3.28084;
  return {
    ac: data.states
      .map((s) => ({
        hex: s[0],
        flight: s[1] || "",
        lat: s[6],
        lon: s[5],
        alt_baro: s[7] != null ? s[7] * FT_PER_M : null,
        gs: s[9] != null ? s[9] / 0.5144 : 0,
        track: s[10] || 0,
        t: "?",
        r: null,
      }))
      .filter((a) => a.lat != null && a.lon != null),
  };
}

async function handleAircraft(request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const radiusNm = Math.max(
    1,
    Math.min(250, Number(url.searchParams.get("radiusNm") || 25)),
  );

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: "missing_lat_lon" }, 400);
  }

  const sources = [
    {
      name: "adsb.lol",
      url: `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${radiusNm}`,
      normalize: (d) => d,
    },
    {
      name: "airplanes.live",
      url: `https://api.airplanes.live/v2/point/${lat}/${lon}/${radiusNm}`,
      normalize: (d) => d,
    },
    {
      name: "opensky",
      url: openskyUrl(lat, lon, radiusNm),
      normalize: normalizeOpenSky,
    },
  ];

  const errors = [];
  for (const source of sources) {
    try {
      const res = await fetch(source.url, {
        cf: { cacheTtl: 5, cacheEverything: false },
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = source.normalize(await res.json());
      return json(
        { source: source.name, ...(data.ac ? data : { ac: [] }) },
        200,
        {
          "Cache-Control": "public, max-age=5",
        },
      );
    } catch (err) {
      errors.push(`${source.name}:${err.message}`);
    }
  }

  return json({ error: "aircraft_feeds_failed", details: errors }, 502);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/mic") return handleMic(request, env);
    if (url.pathname === "/geocode") return handleGeocode(request, env);
    if (url.pathname === "/aircraft") return handleAircraft(request, env);

    return json({
      service: "plane-sound-backend",
      endpoints: [
        "/mic?model=",
        "/geocode?q=",
        "/aircraft?lat=&lon=&radiusNm=",
      ],
    });
  },
};
