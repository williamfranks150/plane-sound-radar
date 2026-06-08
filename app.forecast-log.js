"use strict";

// ---------------------------------------------------------------------------
// app.forecast-log.js
//
// Two professional-workflow features built on the live analysis the engine
// already produces:
//
//   1. CLEAR-WINDOW FORECAST - a glanceable bar answering "how long until a
//      take is at risk?" / "how long until it's clear again?". It projects the
//      aircraft currently being tracked forward along their tracks and merges
//      their contamination windows into a timeline.
//
//      HONESTY: this can only account for aircraft currently detected. A plane
//      still beyond detection range and inbound is not in the forecast until
//      it is picked up. The bar always states how many aircraft it is based on
//      and that it is a live projection, so it never implies a guarantee.
//
//   2. CONTAMINATION LOG - records each time an aircraft was loud enough to
//      contaminate the mic (start, end, peak level, aircraft), survives
//      refreshes, and exports a plain-text summary ("what flew over during
//      this scene") to copy or download.
// ---------------------------------------------------------------------------

const STORE_LOG = "aircraftRadar.contamLog.v1";

// Grace period (ms): an aircraft must be gone this long before its log event
// is closed, so a single dropped poll doesn't split one flyover into two.
const PS_LOG_CLOSE_GRACE_MS = 7000;
const PS_LOG_MAX_EVENTS = 500;
// The log behaves like a rolling cache for one shoot day: events older than
// this are dropped automatically (on load and as new events close), so it
// never grows without bound. The count cap above is a hard backstop.
const PS_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;

let PS_LOG = { events: [], open: {} };

// Drop events whose start is older than the retention window.
function psPurgeOldLogEvents(now) {
  now = now || Date.now();
  const cutoff = now - PS_LOG_RETENTION_MS;
  const before = PS_LOG.events.length;
  PS_LOG.events = PS_LOG.events.filter((e) => Number(e.startTs || 0) >= cutoff);
  return PS_LOG.events.length !== before;
}

function psLoadLog() {
  const saved = read(STORE_LOG, null);
  if (saved && Array.isArray(saved.events)) {
    PS_LOG = { events: saved.events, open: saved.open || {} };
  }
  if (psPurgeOldLogEvents(Date.now())) psPersistLog();
}

function psPersistLog() {
  write(STORE_LOG, PS_LOG);
}

// ---- Forecast -------------------------------------------------------------

// Merge contamination intervals (seconds-from-now). Starts clamped to >=0;
// intervals already ended are dropped.
function psMergeIntervals(intervals) {
  const iv = intervals
    .filter((p) => p[1] > 0)
    .map((p) => [Math.max(0, p[0]), p[1]])
    .sort((a, b) => a[0] - b[0]);

  const out = [];
  for (const [s, e] of iv) {
    if (!out.length || s > out[out.length - 1][1]) out.push([s, e]);
    else out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
  }
  return out;
}

function psComputeForecast() {
  const analyzed = Array.isArray(state.analyzed) ? state.analyzed : [];
  const noMic = analyzed.some((p) => p.noSelectedMic) || analyzed.length === 0;

  // Build contamination intervals from polluting aircraft.
  const intervals = [];
  let soonest = null; // soonest-starting polluting aircraft (for labelling)
  for (const p of analyzed) {
    let startS = null;
    let endS = null;
    if (p.status === "audible" && p.exit != null) {
      startS = 0;
      endS = Math.max(0, p.exit);
    } else if (p.status === "approaching" && p.entry != null) {
      startS = Math.max(0, p.entry);
      endS = Math.max(startS, p.exit != null ? p.exit : startS);
    }
    if (startS == null) continue;
    intervals.push([startS, endS]);
    if (!soonest || startS < soonest.startS) {
      soonest = { startS, p };
    }
  }

  const merged = psMergeIntervals(intervals);
  const inRange = analyzed.filter(
    (p) => !p.noSelectedMic && p.status !== "clear",
  ).length;
  const trackedTotal = analyzed.filter((p) => !p.noSelectedMic).length;

  const horizonS = merged.length ? merged[merged.length - 1][1] : 0;
  const contaminatedNow = merged.length > 0 && merged[0][0] <= 0.5;

  let clearForS = null; // (clear now) seconds until first contamination
  let clearInS = null; // (contaminated now) seconds until it clears
  let nextClearGapStartS = null; // (contaminated now) when next clear period starts == clearInS
  let nextContamAfterGapS = null; // (contaminated now) when contamination resumes

  if (contaminatedNow) {
    clearInS = merged[0][1];
    nextClearGapStartS = merged[0][1];
    nextContamAfterGapS = merged.length > 1 ? merged[1][0] : null;
  } else if (merged.length) {
    clearForS = merged[0][0];
  }

  return {
    noMic,
    contaminatedNow,
    clearForS,
    clearInS,
    nextContamAfterGapS,
    horizonS,
    inRange,
    trackedTotal,
    soonest,
  };
}

// Compact m:ss / h:mm:ss for the forecast bar (tighter than fmt()).
function psFmtClock(t) {
  if (t == null || !isFinite(t)) return "—";
  t = Math.max(0, Math.round(t));
  const s = t % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return h + ":" + pad(m) + ":" + pad(s);
  return m + ":" + pad(s);
}

function psForecastLabelFor(p) {
  if (!p) return "";
  const cs = (p.callsign || "").trim();
  const ty = (p.type || "").trim();
  if (cs && ty && ty !== "?") return cs + " " + ty;
  if (cs) return cs;
  if (ty && ty !== "?") return ty;
  return "aircraft";
}

function renderBanner() {
  const el = document.getElementById("forecastBar");
  if (!el) return;

  // Only meaningful once a location is set.
  if (!state.loc) {
    el.classList.add("hidden");
    return;
  }

  const f = psComputeForecast();
  el.classList.remove("hidden");

  if (f.noMic) {
    el.className = "forecast neutral";
    el.innerHTML =
      '<div class="forecast-main">Select your recording mic to begin</div>';
    return;
  }

  let cls = "clear";
  let main = "";
  let sub = "";

  if (f.contaminatedNow) {
    cls = "alert";
    main = "OVERHEAD &middot; clears " + psFmtClock(f.clearInS);
    if (f.nextContamAfterGapS != null) {
      const gap = Math.max(0, f.nextContamAfterGapS - f.clearInS);
      sub = "then ~" + psFmtClock(gap) + " clear";
    } else {
      sub = "";
    }
  } else if (f.clearForS == null) {
    cls = "clear";
    main = "CLEAR";
    sub = "";
  } else {
    // Clear now, contamination coming.
    cls = f.clearForS <= 60 ? "warn" : "clear";
    main = "CLEAR &middot; next in " + psFmtClock(f.clearForS);
    const who = psForecastLabelFor(f.soonest && f.soonest.p);
    sub = who ? esc(who) : "";
  }

  const basis =
    f.trackedTotal > 0
      ? "live projection &middot; " + f.trackedTotal + " aircraft"
      : "live projection";

  el.className = "forecast " + cls;
  el.innerHTML =
    '<div class="forecast-main">' +
    main +
    "</div>" +
    (sub ? '<div class="forecast-sub">' + sub + "</div>" : "") +
    '<div class="forecast-basis">' +
    basis +
    "</div>";
}

// ---- Contamination log ----------------------------------------------------

function psUpdateContaminationLog(now) {
  if (!Array.isArray(state.analyzed)) return;
  now = now || Date.now();

  const audible = state.analyzed.filter((p) => p.status === "audible");
  const seen = new Set();

  for (const p of audible) {
    const key = p.icao || p.callsign || "";
    if (!key) continue;
    seen.add(key);
    const recv =
      p.acoustic && Number.isFinite(Number(p.acoustic.receiverDba))
        ? Number(p.acoustic.receiverDba)
        : null;
    const thr =
      p.acoustic && Number.isFinite(Number(p.acoustic.thresholdDba))
        ? Number(p.acoustic.thresholdDba)
        : null;

    if (PS_LOG.open[key]) {
      const ev = PS_LOG.open[key];
      ev.lastSeen = now;
      if (recv != null) ev.peakDba = Math.max(ev.peakDba ?? -Infinity, recv);
    } else {
      PS_LOG.open[key] = {
        callsign: (p.callsign || "").trim(),
        type: (p.type || "").trim(),
        startTs: now,
        lastSeen: now,
        peakDba: recv,
        thresholdDba: thr,
      };
    }
  }

  // Close events whose aircraft has been gone past the grace period.
  let changed = false;
  for (const key of Object.keys(PS_LOG.open)) {
    const ev = PS_LOG.open[key];
    if (
      !seen.has(key) &&
      now - Number(ev.lastSeen || 0) > PS_LOG_CLOSE_GRACE_MS
    ) {
      PS_LOG.events.push({
        callsign: ev.callsign,
        type: ev.type,
        startTs: ev.startTs,
        endTs: ev.lastSeen,
        peakDba: ev.peakDba,
        thresholdDba: ev.thresholdDba,
      });
      delete PS_LOG.open[key];
      changed = true;
    }
  }

  if (psPurgeOldLogEvents(now)) changed = true;

  if (PS_LOG.events.length > PS_LOG_MAX_EVENTS) {
    PS_LOG.events = PS_LOG.events.slice(-PS_LOG_MAX_EVENTS);
    changed = true;
  }

  // Persist when something opened/closed (cheap; once/sec at most).
  if (changed || audible.length || Object.keys(PS_LOG.open).length) {
    psPersistLog();
  }
}

function psTwoDigit(n) {
  return (n < 10 ? "0" : "") + n;
}

function psClockTime(ts) {
  const d = new Date(ts);
  return (
    psTwoDigit(d.getHours()) +
    ":" +
    psTwoDigit(d.getMinutes()) +
    ":" +
    psTwoDigit(d.getSeconds())
  );
}

function psDurationText(ms) {
  return fmt(Math.max(0, Math.round(ms / 1000)));
}

// All events, newest first, including any still-open one as "ongoing".
function psAllLogEntries() {
  const open = Object.values(PS_LOG.open).map((ev) => ({
    callsign: ev.callsign,
    type: ev.type,
    startTs: ev.startTs,
    endTs: null,
    peakDba: ev.peakDba,
    thresholdDba: ev.thresholdDba,
    ongoing: true,
  }));
  return [...PS_LOG.events, ...open].sort(
    (a, b) => (b.startTs || 0) - (a.startTs || 0),
  );
}

// Shared report metadata (mics, scene, location) for both the plain-text and
// the branded HTML exports.
function psLogReportMeta() {
  const micNames = (typeof activeMicIds === "function" ? activeMicIds() : [])
    .map((id) => {
      const m = (typeof MICS !== "undefined" && MICS[id]) || null;
      return m ? m.displayName || m.name || m.short || id : id;
    })
    .filter(Boolean)
    .join(", ");
  const sceneKey = (state.settings && state.settings.scene) || "quiet_exterior";
  const sceneLabel =
    (typeof PS_SCENE_PROFILES !== "undefined" &&
      PS_SCENE_PROFILES[sceneKey] &&
      PS_SCENE_PROFILES[sceneKey].label) ||
    sceneKey;
  const loc = state.loc
    ? state.loc.label ||
      Number(state.loc.lat).toFixed(4) + ", " + Number(state.loc.lon).toFixed(4)
    : "unknown";
  return { micNames, sceneLabel, loc, exported: new Date() };
}

function psHtmlEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Branded, self-contained HTML report (dark/neon, inline SVG wordmark, no
// external assets) that the user can open and Print -> Save as PDF. This is
// the "real product" deliverable to hand a director or post.
function psLogReportHtml() {
  const meta = psLogReportMeta();
  const entries = psAllLogEntries().slice().reverse(); // chronological

  const rows = entries.length
    ? entries
        .map((e) => {
          const peak = e.peakDba != null ? Math.round(e.peakDba) + " dBA" : "—";
          const thr =
            e.thresholdDba != null ? Math.round(e.thresholdDba) + " dBA" : "—";
          const who =
            psHtmlEscape((e.callsign || "").trim() || "(no callsign)") +
            ' <span class="ty">' +
            psHtmlEscape((e.type || "").trim() || "?") +
            "</span>";
          const dur = e.ongoing
            ? '<span class="ongoing">ongoing</span>'
            : psDurationText((e.endTs || e.startTs) - e.startTs);
          return (
            "<tr><td>" +
            psHtmlEscape(psClockTime(e.startTs)) +
            "</td><td>" +
            who +
            '</td><td class="num">' +
            peak +
            '</td><td class="num">' +
            thr +
            '</td><td class="num">' +
            dur +
            "</td></tr>"
          );
        })
        .join("")
    : '<tr><td colspan="5" class="empty">No contamination events logged.</td></tr>';

  const wordmark =
    '<svg viewBox="0 0 320 56" xmlns="http://www.w3.org/2000/svg" class="mark" role="img" aria-label="Plane Sound">' +
    '<defs><filter id="g"><feGaussianBlur stdDeviation="1.4" result="b"/>' +
    '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
    '<g filter="url(#g)" fill="none" stroke="#00ff8a" stroke-width="2.4">' +
    '<rect x="2" y="10" width="214" height="36" rx="9"/>' +
    '<circle cx="270" cy="28" r="24"/>' +
    '<path d="M270 10 l5 14 16 4 -16 4 -5 14 -5 -14 -16 -4 16 -4z" fill="#00ff8a" stroke="none"/>' +
    "</g>" +
    '<text x="20" y="36" font-family="Menlo,Consolas,monospace" font-size="22" font-weight="800" letter-spacing="2" fill="#00ff8a">PLANE SOUND</text>' +
    "</svg>";

  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    "<title>Plane Sound — Aircraft Noise Log</title>" +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<style>" +
    "*{box-sizing:border-box}" +
    "body{margin:0;background:#020907;color:#d6efe6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:28px}" +
    ".sheet{max-width:760px;margin:0 auto}" +
    "header{display:flex;align-items:center;gap:16px;border-bottom:1px solid rgba(0,255,138,.25);padding-bottom:16px;margin-bottom:18px}" +
    ".mark{width:230px;height:40px;flex:none}" +
    "h1{font-size:15px;font-weight:700;letter-spacing:.5px;margin:0 0 2px;color:#9fb0a8;text-transform:uppercase}" +
    ".meta{font-size:12.5px;color:#7f968c;line-height:1.6}" +
    ".meta b{color:#cfe7dd;font-weight:600}" +
    "table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}" +
    "th{text-align:left;text-transform:uppercase;font-size:10.5px;letter-spacing:.5px;color:#6f8a7e;border-bottom:1px solid rgba(0,255,138,.2);padding:8px 10px}" +
    "td{padding:8px 10px;border-bottom:1px solid rgba(120,140,130,.12)}" +
    ".num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}" +
    ".ty{color:#7f968c}" +
    ".ongoing{color:#ff5050;font-weight:700}" +
    ".empty{color:#7f968c;text-align:center;padding:24px}" +
    "tr:nth-child(even) td{background:rgba(6,18,14,.5)}" +
    "footer{margin-top:18px;padding-top:12px;border-top:1px solid rgba(0,255,138,.2);font-size:11px;color:#62786e;line-height:1.6}" +
    "@media print{body{background:#fff;color:#111;padding:0}.mark text,.mark rect,.mark circle{stroke:#0a7a4f}.mark path{fill:#0a7a4f}h1,.meta,.ty{color:#444}.meta b{color:#111}th{color:#333;border-color:#999}td{border-color:#ddd}tr:nth-child(even) td{background:#f4f4f4}.ongoing{color:#c00}footer{color:#666;border-color:#ccc}}" +
    '</style></head><body><div class="sheet">' +
    "<header>" +
    wordmark +
    '<div><h1>Aircraft Noise Log</h1><div class="meta">' +
    "<b>Exported</b> " +
    psHtmlEscape(meta.exported.toLocaleString()) +
    "<br><b>Location</b> " +
    psHtmlEscape(meta.loc) +
    (meta.micNames ? "<br><b>Mic(s)</b> " + psHtmlEscape(meta.micNames) : "") +
    "<br><b>Ambient noise floor</b> " +
    psHtmlEscape(meta.sceneLabel) +
    "</div></div></header>" +
    "<table><thead><tr><th>Time</th><th>Aircraft</th><th>Peak</th><th>Threshold</th><th>Duration</th></tr></thead>" +
    "<tbody>" +
    rows +
    "</tbody></table>" +
    "<footer>" +
    psHtmlEscape(entries.length + " event(s) logged.") +
    " &nbsp;·&nbsp; Generated by Plane Sound. Levels use EASA ANP aircraft-noise data and ISO 9613-1 atmospheric absorption over live ADS-B positions and weather. Times are local. Peak is the highest received level at the microphone during each pass." +
    "</footer>" +
    "</div></body></html>"
  );
}

function psLogSummaryText() {
  const entries = psAllLogEntries().slice().reverse(); // chronological
  const micNames = (typeof activeMicIds === "function" ? activeMicIds() : [])
    .map((id) => {
      const m = (typeof MICS !== "undefined" && MICS[id]) || null;
      return m ? m.displayName || m.name || m.short || id : id;
    })
    .join(", ");
  const scene = (state.settings && state.settings.scene) || "quiet_exterior";
  const loc = state.loc
    ? state.loc.label ||
      Number(state.loc.lat).toFixed(4) + ", " + Number(state.loc.lon).toFixed(4)
    : "unknown";

  const lines = [];
  lines.push("Plane Sound - Aircraft Noise Log");
  lines.push("Exported: " + new Date().toLocaleString());
  lines.push("Location: " + loc);
  if (micNames) lines.push("Mic(s): " + micNames);
  lines.push("Scene profile: " + scene);
  lines.push("".padEnd(52, "-"));

  if (!entries.length) {
    lines.push("No contamination events logged.");
  } else {
    for (const e of entries) {
      const peak =
        e.peakDba != null ? Math.round(e.peakDba) + " dBA" : "-- dBA";
      const thr =
        e.thresholdDba != null ? "/ thr " + Math.round(e.thresholdDba) : "";
      const who =
        ((e.callsign || "").trim() || "(no callsign)") +
        " (" +
        ((e.type || "").trim() || "?") +
        ")";
      const dur = e.ongoing
        ? "ongoing"
        : psDurationText((e.endTs || e.startTs) - e.startTs);
      lines.push(
        psClockTime(e.startTs) +
          "  " +
          who.padEnd(22) +
          "  peak " +
          peak +
          " " +
          thr +
          "  dur " +
          dur,
      );
    }
    lines.push("".padEnd(52, "-"));
    lines.push(entries.length + " event(s) logged.");
  }
  return lines.join("\n");
}

function psRenderLog() {
  const list = document.getElementById("logList");
  if (!list) return;
  const entries = psAllLogEntries();

  if (!entries.length) {
    list.innerHTML = '<div class="msg">No events logged yet.</div>';
  } else {
    list.innerHTML = entries
      .map((e) => {
        const peak = e.peakDba != null ? Math.round(e.peakDba) + " dBA" : "--";
        const dur = e.ongoing
          ? "ongoing"
          : psDurationText((e.endTs || e.startTs) - e.startTs);
        const who =
          esc((e.callsign || "").trim() || "(no callsign)") +
          " " +
          esc((e.type || "").trim() || "?");
        return (
          '<div class="planeCard ' +
          (e.ongoing ? "audible" : "") +
          '"><div class="planeHead"><span class="callsign">' +
          who +
          '</span><span class="pill">' +
          (e.ongoing ? "ONGOING" : psClockTime(e.startTs)) +
          "</span></div>" +
          '<div class="grid">' +
          '<div><span class="lbl">PEAK</span><span class="val">' +
          peak +
          "</span></div>" +
          '<div><span class="lbl">DURATION</span><span class="val">' +
          dur +
          "</span></div>" +
          "</div></div>"
        );
      })
      .join("");
  }

  const copyBtn = document.getElementById("logCopyBtn");
  const dlBtn = document.getElementById("logDownloadBtn");
  const clearBtn = document.getElementById("logClearBtn");
  const msg = document.getElementById("logMsg");

  if (copyBtn) {
    copyBtn.onclick = async () => {
      const text = psLogSummaryText();
      try {
        await navigator.clipboard.writeText(text);
        if (msg) {
          msg.textContent = "Summary copied to clipboard.";
          msg.classList.remove("hidden");
          setTimeout(() => msg.classList.add("hidden"), 2500);
        }
      } catch {
        // Fallback: show the text so it can be selected manually.
        if (msg) {
          msg.textContent = text;
          msg.classList.remove("hidden");
        }
      }
    };
  }

  if (dlBtn) {
    dlBtn.onclick = () => {
      const html = psLogReportHtml();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      a.href = url;
      a.download = "plane-sound-log-" + stamp + ".html";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }

  if (clearBtn) {
    clearBtn.onclick = () => {
      if (msg && msg.dataset.confirm !== "1") {
        msg.dataset.confirm = "1";
        msg.textContent = "Tap Clear again to erase the log.";
        msg.classList.remove("hidden");
        setTimeout(() => {
          msg.dataset.confirm = "0";
          msg.classList.add("hidden");
        }, 4000);
        return;
      }
      PS_LOG = { events: [], open: {} };
      psPersistLog();
      if (msg) {
        msg.dataset.confirm = "0";
        msg.textContent = "Log cleared.";
        setTimeout(() => msg.classList.add("hidden"), 2000);
      }
      psRenderLog();
    };
  }
}
