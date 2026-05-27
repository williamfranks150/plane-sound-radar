"use strict";

function psEnsureAudioSourceBadge() {
  let el = document.getElementById("audioSourceBadge");

  if (el) return el;

  const selected = document.getElementById("selectedMicList");
  const parent =
    (selected && selected.parentElement) ||
    (document.getElementById("radar") &&
      document.getElementById("radar").parentElement) ||
    document.body;

  if (parent && parent.style) parent.style.position = "relative";

  el = document.createElement("button");
  el.id = "audioSourceBadge";
  el.type = "button";
  el.className = "audio-source-badge unavailable";
  el.setAttribute("aria-label", "Audio source");
  el.textContent = "DEVICE MIC";

  parent.appendChild(el);

  return el;
}

function psAudioBadgeMode() {
  if (typeof psAudioSourceMode === "function") return psAudioSourceMode();

  return "device";
}

function psAudioBadgeText(mode) {
  if (mode === "mixer") return "SOUND DEPT";
  if (mode === "manual") return "NO MIC";

  return "DEVICE MIC";
}

function psAudioBadgeAvailable(mode) {
  const monitor =
    typeof PS_AUDIO_MONITOR === "object" && PS_AUDIO_MONITOR
      ? PS_AUDIO_MONITOR
      : null;

  if (mode === "manual") return false;
  if (!monitor || !monitor.available || monitor.denied || !monitor.active)
    return false;

  if (mode === "mixer") {
    return (
      monitor.activeSourceKind === "mixer" && monitor.mixerDetected === true
    );
  }

  return monitor.activeSourceKind === "device";
}

function psRenderAudioSourceBadge() {
  const el = psEnsureAudioSourceBadge();

  if (!el) return;

  const mode = psAudioBadgeMode();
  const available = psAudioBadgeAvailable(mode);

  el.className =
    "audio-source-badge " +
    mode +
    " " +
    (available ? "available" : "unavailable");

  el.textContent = psAudioBadgeText(mode);
}

function psNextAudioSourceMode(mode) {
  if (mode === "device") return "mixer";
  if (mode === "mixer") return "manual";

  return "device";
}

function psAudioSourceBadgePressed() {
  const current = psAudioBadgeMode();
  const next = psNextAudioSourceMode(current);

  if (typeof psSetAudioSourceMode === "function") {
    psSetAudioSourceMode(next);
  }

  psRenderAudioSourceBadge();
}

function psBootAudioSourceBadge() {
  const el = psEnsureAudioSourceBadge();

  if (el && !el.dataset.boundAudioBadge) {
    el.dataset.boundAudioBadge = "true";
    el.addEventListener("click", psAudioSourceBadgePressed);
  }

  psRenderAudioSourceBadge();
}

document.addEventListener("DOMContentLoaded", psBootAudioSourceBadge);
window.addEventListener("load", psBootAudioSourceBadge);
setInterval(psRenderAudioSourceBadge, 500);
