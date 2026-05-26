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

function psWindVectorToward(windSpeedKmh, windFromDeg) {
  if (!Number.isFinite(windSpeedKmh) || !Number.isFinite(windFromDeg)) {
    return { x: 0, y: 0 };
  }

  const toward = (windFromDeg + 180) * D2R;

  return {
    x: windSpeedKmh * Math.sin(toward),
    y: windSpeedKmh * Math.cos(toward),
  };
}

function psWeatherAbsorptionDbPerKm(layer) {
  if (!layer) return 1.2;

  const temp = Number(layer.temperatureC);
  const rh = Number(layer.humidityPct);
  const pressure = Number(layer.pressureHpa || layer.hpa);

  let value = 1.0;

  if (Number.isFinite(temp)) {
    if (temp < -10) value += 0.35;
    else if (temp < 0) value += 0.2;
    else if (temp > 25) value -= 0.1;
  }

  if (Number.isFinite(rh)) {
    if (rh < 30) value += 0.25;
    else if (rh > 75) value -= 0.12;
  }

  if (Number.isFinite(pressure) && pressure < 750) value -= 0.08;

  return clamp(value, 0.45, 1.75);
}

function psWeatherCorrectionForAircraft(context, sourceProfile) {
  const layer = psWeatherLayerForAltitudeFt(context.altFt);

  if (!layer) {
    return {
      dbaCorrection: 0,
      radiusCorrectionDba: 0,
      confidence: 0.15,
      reasonCodes: ["weather_unavailable"],
    };
  }

  const distanceKm = Math.max(0, Number(context.slantKm || 0));
  const absorptionDbPerKm = psWeatherAbsorptionDbPerKm(layer);
  const absorptionDelta =
    (1.2 - absorptionDbPerKm) * Math.max(0, distanceKm - 0.305);
  const wind = psWindVectorToward(
    Number(layer.windSpeedKmh),
    Number(layer.windFromDeg),
  );
  const h = Math.max(0.001, Number(context.horizontalKm || 0));
  const toListenerX = -Number(context.x || 0) / h;
  const toListenerY = -Number(context.y || 0) / h;
  const windComponentKmh = wind.x * toListenerX + wind.y * toListenerY;
  const windCorrection = clamp(windComponentKmh / 18, -4, 4);
  const dbaCorrection = clamp(absorptionDelta + windCorrection, -6, 6);

  return {
    dbaCorrection,
    radiusCorrectionDba: clamp(dbaCorrection, -4, 4),
    windComponentKmh,
    absorptionDbPerKm,
    confidence: 0.58,
    reasonCodes: [
      "weather_aloft",
      windCorrection >= 0 ? "downwind_sound_path" : "upwind_sound_path",
    ],
  };
}
