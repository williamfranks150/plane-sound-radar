"use strict";

function recompute() {
  state.analyzed = state.adsb.planes
    .map(analyze)
    .filter(Boolean)
    .sort(
      (a, b) =>
        ({ audible: 0, approaching: 1, clear: 2, high: 3 })[a.status] -
          { audible: 0, approaching: 1, clear: 2, high: 3 }[b.status] ||
        a.h - b.h,
    );
}

function counts() {
  const audible = state.analyzed.filter((p) => p.status === "audible").length;
  const approaching = state.analyzed.filter(
    (p) => p.status === "approaching",
  ).length;
  const tracked = state.analyzed.length;
  return { audible, approaching, tracked };
}

function render() {
  recompute();
  renderMeta();
  renderPanels();
  renderErr();
  renderAircraftList();
  resizeCanvas();
}

function renderMeta() {
  // intentionally hidden in the main interface
}

function renderPanels() {
  $("micPanel").classList.toggle("hidden", state.activePanel !== "mics");
  $("aircraftPanel").classList.toggle(
    "hidden",
    state.activePanel !== "aircraft",
  );
  $("locationPanel").classList.toggle(
    "hidden",
    state.activePanel !== "location",
  );
  $("tabMics").classList.toggle("active", state.activePanel === "mics");
  $("tabAircraft").classList.toggle("active", state.activePanel === "aircraft");
  $("tabLocation").classList.toggle("active", state.activePanel === "location");

  const active = new Set(activeMicIds());

  $("chipGrid").innerHTML = visibleMicEntries()
    .map(([id, m]) => {
      const pending =
        typeof psMicRangePending === "function" ? psMicRangePending(m) : false;
      return `<button class="chip ${active.has(id) ? "active" : ""} ${pending ? "pending" : ""}" data-mic="${id}">
      ${esc(m.displayName || m.name || m.short || id)}
      <span class="chip-edit" data-edit-mic="${id}" title="Edit mic specs">EDIT</span>
      <span class="chip-x" data-delete-mic="${id}" title="Remove mic">DEL</span>
    </button>`;
    })
    .join("");

  $("rangeRead").innerHTML = "";

  $("results").classList.toggle("hidden", !state.search.results.length);
  $("results").innerHTML = state.search.results
    .map(
      (r, i) =>
        `<button class="result" data-i="${i}"><div class="rmain">${esc(r.shortLabel)}</div><div class="rsub">${esc(r.fullLabel)}</div></button>`,
    )
    .join("");

  if (typeof psWireMicSpecEditor === "function") psWireMicSpecEditor();
}

function renderErr() {
  const el = $("err");
  el.classList.add("hidden");
  el.innerHTML = "";
}

function planeCard(p) {
  const label =
    p.status === "audible"
      ? "In mic range"
      : p.status === "approaching"
        ? "Approaching"
        : p.status === "clear"
          ? "Tracked"
          : "High";
  const timing =
    p.status === "audible" && p.exit != null
      ? "-" + fmt(p.exit)
      : p.entry != null
        ? "+" + fmt(p.entry)
        : "—";
  return `<div class="planeCard ${p.status}">
    <div class="planeHead"><span class="callsign">${esc(p.callsign)}</span><span class="pill">${label}</span></div>
    <div class="grid">
      <div><span class="lbl">DIST</span><span class="val">${p.h.toFixed(1)} km ${dir(p.bearing)}</span></div>
      <div><span class="lbl">TIME</span><span class="val">${timing}</span></div>
      <div><span class="lbl">ALT</span><span class="val">${Math.round(p.altFt).toLocaleString()} ft</span></div>
      <div><span class="lbl">TYPE</span><span class="val">${esc(p.type)}</span></div>
      <div><span class="lbl">SPD</span><span class="val">${Math.round(p.gs)} kt</span></div>
      <div><span class="lbl">HDG</span><span class="val">${Math.round(p.track)}° ${dir(p.track)}</span></div>
    </div>
  </div>`;
}

function renderAircraftList() {
  if (!state.analyzed.length) {
    $("aircraftList").innerHTML =
      '<div class="empty">No aircraft in current radar range</div>';
    return;
  }
  $("aircraftList").innerHTML = state.analyzed
    .slice(0, 18)
    .map(planeCard)
    .join("");
}
