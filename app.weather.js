"use strict";

const PS_WEATHER_CACHE_MS = 20 * 60 * 1000;
const PS_WEATHER_LEVELS_HPA = [1000, 925, 850, 700, 500, 300];

const PS_WEATHER_STATE = {
  key: null,
  fetchedAt: 0,
  data: null,
  loading: false,
  error: null,
};

function psWeatherCacheKey(loc) {
  if (!loc) return "";

  return (
    Math.round(Number(loc.lat) * 20) / 20 +
    "," +
    Math.round(Number(loc.lon) * 20) / 20
  );
}

function psWeatherVariableList() {
  const pressureVars = PS_WEATHER_LEVELS_HPA.flatMap((level) => [
    "temperature_" + level + "hPa",
    "relative_humidity_" + level + "hPa",
    "wind_speed_" + level + "hPa",
    "wind_direction_" + level + "hPa",
    "geopotential_height_" + level + "hPa",
  ]);

  return [
    "temperature_2m",
    "relative_humidity_2m",
    "surface_pressure",
    "wind_speed_10m",
    "wind_direction_10m",
    ...pressureVars,
  ].join(",");
}

function psWeatherUrl(loc) {
  const params = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    hourly: psWeatherVariableList(),
    forecast_days: "1",
    wind_speed_unit: "kmh",
    timezone: "UTC",
  });

  return "https://api.open-meteo.com/v1/forecast?" + params.toString();
}

function psNearestWeatherHourIndex(hourly) {
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length) return 0;

  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;

  hourly.time.forEach((time, index) => {
    const parsed = Date.parse(String(time) + "Z");
    const diff = Math.abs(parsed - now);

    if (diff < bestDiff) {
      best = index;
      bestDiff = diff;
    }
  });

  return best;
}

function psParseWeatherPayload(payload) {
  const hourly = payload && payload.hourly ? payload.hourly : {};
  const index = psNearestWeatherHourIndex(hourly);

  const surface = {
    temperatureC: Number(hourly.temperature_2m?.[index]),
    humidityPct: Number(hourly.relative_humidity_2m?.[index]),
    pressureHpa: Number(hourly.surface_pressure?.[index]),
    windSpeedKmh: Number(hourly.wind_speed_10m?.[index]),
    windFromDeg: Number(hourly.wind_direction_10m?.[index]),
  };

  const levels = PS_WEATHER_LEVELS_HPA.map((hpa) => ({
    hpa,
    temperatureC: Number(hourly["temperature_" + hpa + "hPa"]?.[index]),
    humidityPct: Number(hourly["relative_humidity_" + hpa + "hPa"]?.[index]),
    windSpeedKmh: Number(hourly["wind_speed_" + hpa + "hPa"]?.[index]),
    windFromDeg: Number(hourly["wind_direction_" + hpa + "hPa"]?.[index]),
    geopotentialM: Number(
      hourly["geopotential_height_" + hpa + "hPa"]?.[index],
    ),
  })).filter((level) => Number.isFinite(level.temperatureC));

  return {
    time: hourly.time?.[index] || null,
    surface,
    levels,
  };
}

async function psPrimeWeatherForLocation(loc) {
  if (
    !loc ||
    !Number.isFinite(Number(loc.lat)) ||
    !Number.isFinite(Number(loc.lon))
  )
    return null;

  const key = psWeatherCacheKey(loc);
  const fresh =
    PS_WEATHER_STATE.key === key &&
    PS_WEATHER_STATE.data &&
    Date.now() - PS_WEATHER_STATE.fetchedAt < PS_WEATHER_CACHE_MS;

  if (fresh || PS_WEATHER_STATE.loading) return PS_WEATHER_STATE.data;

  PS_WEATHER_STATE.loading = true;

  try {
    const res = await fetch(psWeatherUrl(loc), { cache: "no-store" });

    if (!res.ok) throw new Error("weather " + res.status);

    const payload = await res.json();
    PS_WEATHER_STATE.key = key;
    PS_WEATHER_STATE.fetchedAt = Date.now();
    PS_WEATHER_STATE.data = psParseWeatherPayload(payload);
    PS_WEATHER_STATE.error = null;
  } catch (err) {
    PS_WEATHER_STATE.error = err.message || "weather unavailable";
  } finally {
    PS_WEATHER_STATE.loading = false;
  }

  return PS_WEATHER_STATE.data;
}

function psWeatherSnapshot() {
  return PS_WEATHER_STATE.data || null;
}

function psWeatherLayerForAltitudeFt(altFt) {
  const data = PS_WEATHER_STATE.data;

  if (!data) return null;

  const altM = Number(altFt || 0) / FT_PER_M;
  const usable = data.levels.filter((level) =>
    Number.isFinite(level.geopotentialM),
  );

  if (!usable.length) return data.surface || null;

  return usable.reduce((best, level) => {
    const diff = Math.abs(level.geopotentialM - altM);
    const bestDiff = Math.abs((best.geopotentialM || 0) - altM);

    return diff < bestDiff ? level : best;
  }, usable[0]);
}

// Path-averaged speed of sound (m/s) from ground to the aircraft, including
// along-path wind advection. Used by the timing layer to convert geometric
// crossing times into heard-by-the-mic times. Falls back to a 15 C standard
// atmosphere value when no weather is loaded.
function psSoundSpeedForContextMs(context) {
  const data = PS_WEATHER_STATE.data;

  if (!data) return psSpeedOfSoundMs(15);

  return psPathAverageSoundSpeedMs(
    context.altFt,
    data.surface,
    data.levels,
    context,
  );
}

// Weather correction for the acoustic engine. Now backed by ISO 9613-1
// absorption and a refraction band derived from the vertical wind/temperature
// profile, instead of bucketed heuristics. Return shape is a superset of the
// previous version so the engine keeps working unchanged.
function psWeatherCorrectionForAircraft(context, sourceProfile) {
  const data = PS_WEATHER_STATE.data;

  if (!data || !data.surface) {
    return {
      dbaCorrection: 0,
      radiusCorrectionDba: 0,
      windComponentKmh: 0,
      absorptionDbPerKm: 1.2,
      refractionRegime: "calm",
      refractionExcessDb: 0,
      refractionSwingDb: 6,
      soundSpeedMs: psSpeedOfSoundMs(15),
      confidence: 0.12,
      reasonCodes: ["weather_unavailable"],
    };
  }

  const layer = psWeatherLayerForAltitudeFt(context.altFt) || data.surface;

  // Absorption is now applied as a true dB/km over distance by the propagator
  // and the threshold-distance solver. We pass the coefficient downstream and
  // do NOT fold a distance-dependent offset into the correction here (doing so
  // would double-count absorption).
  const pressureKpa = Number.isFinite(Number(layer.pressureHpa))
    ? Number(layer.pressureHpa) / 10
    : Number.isFinite(Number(layer.hpa))
      ? Number(layer.hpa) / 10
      : PS_PRESSURE_REF_KPA;
  const absorptionDbPerKm = psBroadbandAircraftAbsorptionDbPerKm(
    layer.temperatureC,
    layer.humidityPct,
    pressureKpa,
  );

  const refraction = psRefractionBand(context, data.surface, data.levels);

  const windComponentKmh = psWindTowardListenerKmh(
    data.surface.windSpeedKmh,
    data.surface.windFromDeg,
    context,
  );

  // Correction carries only the refraction term (a level shift). Absorption is
  // handled separately via absorptionDbPerKm.
  const dbaCorrection = clamp(refraction.excessDb, -26, 8);

  const soundSpeedMs = psPathAverageSoundSpeedMs(
    context.altFt,
    data.surface,
    data.levels,
    context,
  );

  return {
    dbaCorrection,
    radiusCorrectionDba: clamp(dbaCorrection, -26, 8),
    windComponentKmh,
    absorptionDbPerKm,
    refractionRegime: refraction.regime,
    refractionExcessDb: refraction.excessDb,
    refractionSwingDb: refraction.swingDb,
    soundSpeedMs,
    confidence: clamp(0.5 * refraction.confidence + 0.3, 0.15, 0.75),
    reasonCodes: [
      "weather_aloft",
      windComponentKmh >= 0 ? "downwind_sound_path" : "upwind_sound_path",
      ...(refraction.reasonCodes || []),
    ],
  };
}
