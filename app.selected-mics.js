"use strict";

function psSelectedMicDisplayItems() {
  const byId = new Map();

  function addMic(id, mic) {
    if (!mic) return;

    const label = mic.short || mic.name || mic.displayName || id || "MIC";

    if (label) byId.set(String(id || label), String(label).toUpperCase());
  }

  if (typeof activeMicIds === "function") {
    activeMicIds().forEach((id) => {
      addMic(id, typeof MICS === "object" && MICS ? MICS[id] : null);
    });
  }

  if (!byId.size && typeof rangeSettings === "function") {
    const rs = rangeSettings();

    if (rs && Array.isArray(rs.mics)) {
      rs.mics.forEach((mic, index) => addMic(mic.id || index, mic));
    }
  }

  return [...byId.values()];
}

function psEscapeSelectedMicLabel(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function psRenderSelectedMicList() {
  const el = document.getElementById("selectedMicList");

  if (!el) return;

  const parent = el.parentElement;

  if (parent) parent.style.position = "relative";

  const items = psSelectedMicDisplayItems();

  if (!items.length) {
    // No mic models chosen: hide the box entirely (don't show a placeholder),
    // so the top-left of the radar is clean until the user selects a mic.
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }

  el.style.display = "";
  el.innerHTML =
    '<div class="selected-mic-list-title">SELECTED MICS</div>' +
    items
      .map((item) => {
        return (
          '<div class="selected-mic-list-item">' +
          psEscapeSelectedMicLabel(item) +
          "</div>"
        );
      })
      .join("");
}

document.addEventListener("DOMContentLoaded", psRenderSelectedMicList);
window.addEventListener("storage", psRenderSelectedMicList);
setInterval(psRenderSelectedMicList, 500);
