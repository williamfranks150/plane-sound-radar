"use strict";

const state = {
  loc: null,
  savedLoc: null,
  activePanel: null,
  settings: { package: "none", active: [] },
  hiddenMics: [],
  adsb: {
    state: "idle",
    source: null,
    preferred: null,
    lastFetch: null,
    planes: [],
    error: null,
  },
  search: { loading: false, results: [] },
  analyzed: [],
  sweep: 0,
  prevSweep: 0,
  rafLast: null,
  timer: null,
};

function setPanel(name) {
  state.activePanel = state.activePanel === name ? null : name;
  write(STORE_UI, { activePanel: state.activePanel });
  render();
}

function init() {
  if (typeof psBootAcousticEngine === "function") {
    psBootAcousticEngine().then(() => {
      render();
      if (state.loc) fetchFeed();
    });
  } else if (typeof psLoadAircraftNoiseProfiles === "function") {
    psLoadAircraftNoiseProfiles().then(() => {
      render();
      if (state.loc) fetchFeed();
    });
  }
  if (typeof psApplySeedMicSpecs === "function") psApplySeedMicSpecs();
  state.savedLoc = read(STORE_LOC, null);
  const custom = read(STORE_CUSTOM, {});
  if (custom && typeof custom === "object") Object.assign(MICS, custom);
  removeDeprecatedMics();
  const ss = read(STORE_SETTINGS, null);
  if (ss) state.settings = { ...state.settings, ...ss };
  state.hiddenMics = read(STORE_HIDDEN, []).filter((id) => MICS[id]);
  if (typeof psRemoveDuplicateCustomMics === "function")
    psRemoveDuplicateCustomMics();
  const ui = read(STORE_UI, null);
  if (ui) state.activePanel = ui.activePanel || null;

  $("tabMics").onclick = () => setPanel("mics");
  $("tabAircraft").onclick = () => setPanel("aircraft");
  $("tabLocation").onclick = () => setPanel("location");
  $("searchBtn").onclick = doSearch;
  $("searchInput").onkeydown = (e) => {
    if (e.key === "Enter") doSearch();
  };
  $("results").onclick = (e) => {
    const b = e.target.closest(".result");
    if (b) setLoc(state.search.results[+b.dataset.i]);
  };
  $("gpsBtn").onclick = () => gps(false);
  psWireMicSpecEditor();

  $("chipGrid").onclick = (e) => {
    const del = e.target.closest("[data-delete-mic]");
    if (del) {
      e.stopPropagation();
      hideOrDeleteMic(del.dataset.deleteMic);
      return;
    }
    const b = e.target.closest(".chip");
    if (!b) return;
    const id = b.dataset.mic;
    const active = new Set(activeMicIds());
    active.has(id) ? active.delete(id) : active.add(id);
    state.settings.package = "custom";
    state.settings.active = [...active];
    write(STORE_SETTINGS, state.settings);
    render();
    if (state.loc) fetchFeed();
  };

  window.addEventListener("resize", () => {
    resizeCanvas();
    fitHeadline();
  });
  window.visualViewport?.addEventListener("resize", () => {
    resizeCanvas();
    fitHeadline();
  });

  const q = new URLSearchParams(location.search);
  const lat = parseFloat(q.get("lat"));
  const lon = parseFloat(q.get("lon"));
  if (isFinite(lat) && isFinite(lon)) {
    state.loc = {
      lat,
      lon,
      shortLabel: q.get("label") || "URL Location",
      fullLabel: "URL coordinates",
      source: "url",
    };
  } else if (state.savedLoc) {
    state.loc = state.savedLoc;
  }

  render();
  if (state.loc) startLoop();
  maybeAutoGps();
  requestAnimationFrame(anim);
}

document.readyState === "loading"
  ? document.addEventListener("DOMContentLoaded", init)
  : init();
