"use strict";

const $ = (id) => document.getElementById(id);

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const read = (k, d = null) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};

const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

function fmt(t) {
  if (t == null || !isFinite(t)) return "—";
  t = Math.max(0, Math.round(t));
  if (t >= 3600) {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }
  return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s`;
}

function dir(d) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
}

function xy(lat, lon, olat, olon) {
  return {
    x: (lon - olon) * KM_PER_LAT * Math.cos(olat * D2R),
    y: (lat - olat) * KM_PER_LAT,
  };
}

function brg(lat1, lon1, lat2, lon2) {
  const dL = (lon2 - lon1) * D2R;
  const y = Math.sin(dL) * Math.cos(lat2 * D2R);
  const x =
    Math.cos(lat1 * D2R) * Math.sin(lat2 * D2R) -
    Math.sin(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos(dL);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
