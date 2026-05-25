"use strict";

function psSelectedMicDisplayItems() {
  const ids = typeof activeMicIds === "function" ? activeMicIds() : [];

  return ids
    .map((id) => (typeof MICS === "object" && MICS ? MICS[id] : null))
    .filter(Boolean)
    .map((mic) => mic.short || mic.name || mic.displayName || "MIC");
}

function psRenderSelectedMicList() {
  const el = document.getElementById("selectedMicList");

  if (!el) return;

  const parent = el.parentElement;

  if (parent) {
    parent.style.position = "relative";
  }

  const items = psSelectedMicDisplayItems();

  const list = items.length ? items : ["NO MIC SELECTED"];

  el.innerHTML =
    '<div class="selected-mic-list-title">SELECTED MICS</div>' +
    list
      .map((item) => {
        const safe = String(item)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

        const emptyClass =
          safe === "NO MIC SELECTED" ? " selected-mic-list-empty" : "";

        return (
          '<div class="selected-mic-list-item' +
          emptyClass +
          '">' +
          safe +
          "</div>"
        );
      })
      .join("");
}

document.addEventListener("DOMContentLoaded", psRenderSelectedMicList);
setInterval(psRenderSelectedMicList, 1000);
