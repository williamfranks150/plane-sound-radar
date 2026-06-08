"use strict";

function recompute() {
  const order = { audible: 0, approaching: 1, clear: 2, "no-risk": 3, high: 4 };
  state.analyzed = state.adsb.planes
    .map(analyze)
    .filter(Boolean)
    .sort(
      (a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.h - b.h,
    );

  // Record contamination events as the live analysis updates.
  if (typeof psUpdateContaminationLog === "function") {
    psUpdateContaminationLog(Date.now());
  }
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
  $("logPanel").classList.toggle("hidden", state.activePanel !== "log");
  $("tabMics").classList.toggle("active", state.activePanel === "mics");
  $("tabAircraft").classList.toggle("active", state.activePanel === "aircraft");
  $("tabLocation").classList.toggle("active", state.activePanel === "location");
  $("tabLog").classList.toggle("active", state.activePanel === "log");

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
  psRenderSceneSelector();
  if (typeof psRenderLiveInputControl === "function")
    psRenderLiveInputControl();
  if (state.activePanel === "log" && typeof psRenderLog === "function")
    psRenderLog();
}

// Inject a scene-tolerance selector into the mic panel once, and keep it in
// sync. The scene sets the protected ambient floor that drives the
// contamination threshold (a quiet exterior protects a far lower floor than a
// city street, so aircraft become a problem from much further away).
function psRenderSceneSelector() {
  const panel = $("micPanel");
  if (!panel || typeof PS_SCENE_PROFILES === "undefined") return;

  let host = $("sceneSelectBlock");
  if (!host) {
    host = document.createElement("div");
    host.id = "sceneSelectBlock";
    host.className = "sblock";
    host.style.marginBottom = "10px";
    const options = Object.entries(PS_SCENE_PROFILES)
      .filter(([, p]) => !p.hidden)
      .map(([key, p]) => `<option value="${key}">${esc(p.label)}</option>`)
      .join("");
    host.innerHTML = `<label class="lbl" for="sceneSelect" style="display:block;margin-bottom:4px">AMBIENT NOISE FLOOR</label>
      <select id="sceneSelect" class="input" style="width:100%">${options}</select>`;
    panel.insertBefore(host, panel.firstChild);

    $("sceneSelect").addEventListener("change", (e) => {
      state.settings.scene = e.target.value;
      write(STORE_SETTINGS, state.settings);
      render();
      if (state.loc && typeof fetchFeed === "function") fetchFeed();
    });
  }

  const current = (state.settings && state.settings.scene) || "quiet_exterior";
  const sel = $("sceneSelect");
  if (sel && sel.value !== current) sel.value = current;
}

function renderErr() {
  const el = $("err");
  el.classList.add("hidden");
  el.innerHTML = "";
}

// Confidence tier from the engine's 0..0.92 confidence.
function psConfidenceTier(conf) {
  const c = Number(conf || 0);
  if (c >= 0.6) return { label: "HIGH CONF", cls: "conf-high", low: false };
  if (c >= 0.35) return { label: "MED CONF", cls: "conf-med", low: false };
  return { label: "LOW CONF", cls: "conf-low", low: true };
}

function psSourceTierLabel(sourceType) {
  if (sourceType === "verified-npd") return "VERIFIED NPD";
  if (sourceType === "verified") return "VERIFIED";
  if (sourceType === "proxy") return "PROXY DATA";
  if (sourceType === "estimated") return "ESTIMATED";
  return "";
}

function psRegimeHint(p) {
  const refr = String(p.refractionRegime || "");
  if (refr === "downwind") return "wind carrying sound in";
  if (refr === "upwind") return "wind shadowing sound";
  return "";
}

// Format a heard-time value with its uncertainty band, suppressing false
// precision when confidence is low.
function psTimeWithBand(seconds, bandSeconds, sign, lowConf) {
  if (seconds == null || !isFinite(seconds)) return "—";

  let t = Math.max(0, seconds);
  let band = Number(bandSeconds) || 0;

  if (lowConf) {
    t = Math.round(t / 15) * 15; // coarse rounding, no false precision
    band = Math.max(band, 20);
  }

  const main = (sign || "") + fmt(t);

  if (band >= 5) {
    return `${main} ±${fmt(band)}`;
  }

  return main;
}

function planeCard(p) {
  const label =
    p.status === "audible"
      ? "In mic range"
      : p.status === "approaching"
        ? "Approaching"
        : p.status === "clear"
          ? "Tracked"
          : p.status === "no-risk"
            ? "Below threshold"
            : "High";

  const tier = psConfidenceTier(p.confidence);
  const sourceLabel = psSourceTierLabel(p.acoustic && p.acoustic.sourceType);
  const regimeHint = psRegimeHint(p);

  let timing = "—";
  if (p.status === "audible" && p.exit != null) {
    timing = psTimeWithBand(p.exit, p.exitBand, "-", tier.low);
  } else if (p.status === "approaching" && p.entry != null) {
    timing = psTimeWithBand(p.entry, p.entryBand, "+", tier.low);
  }

  const showTiming = p.status === "audible" || p.status === "approaching";

  const confRow = showTiming
    ? `<div><span class="lbl">CONF</span><span class="val ${tier.cls}">${tier.label}${sourceLabel ? " · " + sourceLabel : ""}</span></div>`
    : "";
  const regimeRow =
    showTiming && regimeHint
      ? `<div class="planeNote">${esc(regimeHint)}</div>`
      : "";

  // Received-vs-threshold dB line: the actual number a mixer can judge against.
  const ac = p.acoustic || {};
  const levelRow =
    showTiming && isFinite(ac.receiverDba) && isFinite(ac.thresholdDba)
      ? `<div><span class="lbl">LEVEL</span><span class="val">${Math.round(ac.receiverDba)} dBA vs ${Math.round(ac.thresholdDba)} thr</span></div>`
      : "";
  const ti = ac.thresholdInfo;
  const thrNote =
    showTiming && ti
      ? `<div class="planeNote">${esc(ti.sceneKey)} · noise floor ${Math.round(ti.protectedFloorDba)} dBA (${esc(ti.bound)})</div>`
      : "";

  return `<div class="planeCard ${p.status}">
    <div class="planeHead"><span class="callsign">${esc(p.callsign)}</span><span class="pill">${label}</span></div>
    <div class="grid">
      <div><span class="lbl">DIST</span><span class="val">${p.h.toFixed(1)} km ${dir(p.bearing)}</span></div>
      <div><span class="lbl">TIME</span><span class="val">${timing}</span></div>
      <div><span class="lbl">${esc(p.altLabel || "ALT")}</span><span class="val">${Math.round(p.altFt).toLocaleString()} ft${p.altLowConfidence ? " LOW CONF" : ""}</span></div>
      <div><span class="lbl">TYPE</span><span class="val">${esc(p.type)}</span></div>
      <div><span class="lbl">SPD</span><span class="val">${Math.round(p.gs)} kt</span></div>
      <div><span class="lbl">HDG</span><span class="val">${Math.round(p.track)}° ${dir(p.track)}</span></div>
      ${levelRow}
      ${confRow}
    </div>
    ${regimeRow}
    ${thrNote}
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
