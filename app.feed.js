"use strict";

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
      state.adsb = {
        ...state.adsb,
        state: "ok",
        source: data.source || "backend",
        preferred: null,
        lastFetch: Date.now(),
        planes: Array.isArray(data.ac) ? data.ac : [],
        error: null,
      };
      render();
      return;
    } catch (e) {
      state.adsb.state = "error";
      state.adsb.error =
        "backend:" +
        (e.name === "AbortError" ? "timeout" : e.message || "failed");
      render();
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
      state.adsb = {
        ...state.adsb,
        state: "ok",
        source: src.name,
        preferred: src.name,
        lastFetch: Date.now(),
        planes: src.parse(data),
        error: null,
      };
      render();
      return;
    } catch (e) {
      errs.push(
        src.name +
          ":" +
          (e.name === "AbortError" ? "timeout" : e.message || "failed"),
      );
    }
  }
  state.adsb.state = "error";
  state.adsb.error = errs.join(" · ");
  render();
}
