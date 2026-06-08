"use strict";

// ---------------------------------------------------------------------------
// Feed fetch with last-good-data persistence.
//
// TRUST RULE: a single empty or failed poll must NEVER wipe the display. Live
// ADS-B sources routinely return a 200 with an empty list for a moment (the
// upstream is mid-update, rate-limited, or the proxy fell through to a source
// with thinner coverage). The old code overwrote state.adsb.planes with [] on
// every such response, so the radar flickered between "5 aircraft" and "none"
// across refreshes. That destroys user confidence in an app whose whole job is
// to be trusted on set.
//
// New behaviour:
//   - A successful poll WITH aircraft replaces the set and stamps lastGoodAt.
//   - A successful poll with ZERO aircraft is treated as "no new data": we keep
//     the last good set (still position-predicted by planeNow) until it is too
//     old to trust, then and only then do we clear to empty.
//   - A failed poll keeps the last good set under the same staleness rule.
//   - The set is only allowed to actually empty once the last good data is
//     older than PS_FEED_STALE_MS, at which point showing nothing is correct.
// ---------------------------------------------------------------------------

// How long a last-known aircraft set stays on screen with no fresh confirming
// data. Position is dead-reckoned from velocity (see planeNow); past ~45 s that
// extrapolation is no longer trustworthy for a fast jet, so we clear.
const PS_FEED_STALE_MS = 45000;

function psFeedReplaceWithGood(planes, source) {
  const now = Date.now();
  state.adsb = {
    ...state.adsb,
    state: "ok",
    source,
    lastFetch: now,
    lastGoodAt: now,
    planes,
    error: null,
    errorSince: null,
  };
}

// A poll returned no usable aircraft (empty success, or a failure). Decide
// whether to keep showing the last good set or, if it is now too stale, clear.
function psFeedHoldOrClear(meta) {
  const now = Date.now();
  const lastGoodAt = Number(state.adsb.lastGoodAt || 0);
  const haveGood =
    Array.isArray(state.adsb.planes) && state.adsb.planes.length > 0;
  const stale = !lastGoodAt || now - lastGoodAt > PS_FEED_STALE_MS;

  if (haveGood && !stale) {
    // Keep the last good set on screen; just record the poll outcome. We do
    // NOT bump lastGoodAt (the data did not get re-confirmed), but we do mark
    // a successful round-trip so the connection layer doesn't cry wolf for an
    // empty-but-healthy feed.
    state.adsb = {
      ...state.adsb,
      state: meta.ok ? "ok" : "error",
      source: meta.source ?? state.adsb.source,
      lastFetch: meta.ok ? now : state.adsb.lastFetch,
      error: meta.ok ? null : meta.error || "feed unavailable",
      errorSince: meta.ok ? null : state.adsb.errorSince || now,
      stalePredicted: true,
    };
    render();
    return;
  }

  // No good data, or it is too old to trust: showing an empty scope is the
  // honest result now.
  state.adsb = {
    ...state.adsb,
    state: meta.ok ? "ok" : "error",
    source: meta.source ?? state.adsb.source,
    lastFetch: meta.ok ? now : state.adsb.lastFetch,
    planes: [],
    error: meta.ok ? null : meta.error || "feed unavailable",
    errorSince: meta.ok ? null : state.adsb.errorSince || now,
    stalePredicted: false,
  };
  render();
}

async function fetchFeed() {
  if (!state.loc) return;
  state.adsb.state = "loading";
  renderMeta();
  const rs = rangeSettings();
  const nm = Math.max(25, Math.ceil((rs.radar * 1.85) / NM_TO_KM));

  if (AIRCRAFT_ENDPOINT) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 12000);
      const url =
        AIRCRAFT_ENDPOINT +
        "?lat=" +
        encodeURIComponent(state.loc.lat) +
        "&lon=" +
        encodeURIComponent(state.loc.lon) +
        "&radiusNm=" +
        encodeURIComponent(nm);
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(to);
      if (!res.ok) throw Error(res.status);
      const data = await res.json();
      const planes = Array.isArray(data.ac) ? data.ac : [];

      if (planes.length > 0) {
        psFeedReplaceWithGood(planes, data.source || "backend");
        render();
      } else {
        // Empty success: hold last good (or clear if stale).
        psFeedHoldOrClear({ ok: true, source: data.source || "backend" });
      }
      return;
    } catch (e) {
      const err =
        "backend:" +
        (e.name === "AbortError" ? "timeout" : e.message || "failed");
      psFeedHoldOrClear({ ok: false, error: err });
      return;
    }
  }

  const sources = state.adsb.preferred
    ? [...ADSB].sort(
        (a, b) =>
          (a.name === state.adsb.preferred ? -1 : 0) -
          (b.name === state.adsb.preferred ? -1 : 0),
      )
    : ADSB;
  const errs = [];
  let sawEmptyOk = false;
  for (const src of sources) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(src.url(state.loc.lat, state.loc.lon, nm), {
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (!res.ok) throw Error(res.status);
      const data = await res.json();
      const planes = src.parse(data);

      if (planes.length > 0) {
        state.adsb.preferred = src.name;
        psFeedReplaceWithGood(planes, src.name);
        render();
        return;
      }

      // Empty but OK from this source: remember, and try the NEXT source in
      // case it has coverage this aircraft set. Only if all sources come back
      // empty do we hold-or-clear as an empty success.
      sawEmptyOk = true;
    } catch (e) {
      errs.push(
        src.name +
          ":" +
          (e.name === "AbortError" ? "timeout" : e.message || "failed"),
      );
    }
  }

  if (sawEmptyOk && !errs.length) {
    psFeedHoldOrClear({ ok: true, source: state.adsb.preferred });
  } else {
    psFeedHoldOrClear({ ok: false, error: errs.join(" · ") });
  }
}
