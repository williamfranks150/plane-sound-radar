"use strict";

function psSelectedMicDisplayItems() {
  const byId = new Map();

  function addMic(id, mic) {
    if (!mic) return;

    const label = mic.short || mic.name || mic.displayName || id || "MIC";

    if (!label) return;

    byId.set(String(id || label), String(label).toUpperCase());
  }

  if (typeof activeMicIds === "function") {
    activeMicIds().forEach((id) => {
      addMic(id, typeof MICS === "object" && MICS ? MICS[id] : null);
    });
  }

  if (!byId.size && typeof rangeSettings === "function") {
    const rs = rangeSettings();

    if (rs && Array.isArray(rs.mics)) {
      rs.mics.forEach((mic, index) => {
        addMic(mic.id || index, mic);
      });
    }
  }

  return [...byId.values()];
}

function psRenderSelectedMicList() {
  const el = document.getElementById("selectedMicList");

  if (!el) return;

  const parent = el.parentElement;

  if (parent) {
    parent.style.position = "relative";
  }

  const items = psSelectedMicDisplayItems();

  if (!items.length) {
    el.innerHTML =
      '<div class="selected-mic-list-item selected-mic-list-empty">NO MICS SELECTED</div>';
    return;
  }

  el.innerHTML =
    '<div class="selected-mic-list-title">SELECTED MICS</div>' +
    items
      .map((item) => {
        const safe = String(item)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

        return '<div class="selected-mic-list-item">' + safe + "</div>";
      })
      .join("");
}

document.addEventListener("DOMContentLoaded", psRenderSelectedMicList);
window.addEventListener("storage", psRenderSelectedMicList);
setInterval(psRenderSelectedMicList, 500);
