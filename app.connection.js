"use strict";

const CONNECTION_LOST_DELAY_MS = 30000;

function psTimeMs(value) {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function psFeedAgeMs() {
  const last = psTimeMs(state.adsb.lastFetch);
  if (!last) return Infinity;
  return Date.now() - last;
}

function psConnectionLostVisible() {
  if (state.adsb.state !== "error") {
    state.adsb.errorSince = null;
    return false;
  }

  const now = Date.now();

  if (!state.adsb.errorSince) {
    state.adsb.errorSince = now;
  }

  const errorAge = now - state.adsb.errorSince;
  const feedAge = psFeedAgeMs();

  if (state.adsb.lastFetch) {
    return feedAge >= CONNECTION_LOST_DELAY_MS;
  }

  return errorAge >= CONNECTION_LOST_DELAY_MS;
}
