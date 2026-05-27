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
  el.className = "audio-source-badge manual";
  el.setAttribute("aria-label", "Audio source");
  el.textContent = "NO MIC";

  parent.appendChild(el);

  return el;
}

function psAudioSourceBadgeMode() {
  const monitor =
    typeof PS_AUDIO_MONITOR === "object" && PS_AUDIO_MONITOR
      ? PS_AUDIO_MONITOR
      : null;

  if (typeof psIsManualAudioMode === "function" && psIsManualAudioMode()) {
    return "manual";
  }

  if (!monitor || !monitor.available || monitor.denied || !monitor.active) {
    return "manual";
  }

  if (monitor.activeSourceKind === "mixer") return "mixer";

  return "phone";
}

function psAudioSourceBadgeText() {
  const mode = psAudioSourceBadgeMode();

  if (mode === "mixer") return "SOUND DEPT";
  if (mode === "phone") return "IPHONE MIC";

  return "NO MIC";
}

function psRenderAudioSourceBadge() {
  const el = psEnsureAudioSourceBadge();

  if (!el) return;

  const mode = psAudioSourceBadgeMode();

  el.className = "audio-source-badge " + mode;
  el.textContent = psAudioSourceBadgeText();
}

function psAudioSourceBadgePressed() {
  const mode = psAudioSourceBadgeMode();

  if (mode === "manual") {
    if (typeof psSetAudioSourceMode === "function")
      psSetAudioSourceMode("auto");
    if (typeof psStartAudioMonitor === "function") psStartAudioMonitor();
  } else if (typeof psSetAudioSourceMode === "function") {
    psSetAudioSourceMode("manual");
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

  if (
    typeof psIsManualAudioMode === "function" &&
    !psIsManualAudioMode() &&
    typeof psStartAudioMonitor === "function"
  ) {
    psStartAudioMonitor();
  }
}

document.addEventListener("DOMContentLoaded", psBootAudioSourceBadge);
window.addEventListener("load", psBootAudioSourceBadge);
setInterval(psRenderAudioSourceBadge, 500);
