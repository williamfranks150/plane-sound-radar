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

  el = document.createElement("div");
  el.id = "audioSourceBadge";
  el.className = "audio-source-badge unavailable";
  el.setAttribute("aria-label", "Live sound input status");
  el.style.display = "none";

  parent.appendChild(el);

  return el;
}

function psAudioBadgeText() {
  // Combined status across all active sources. Empty string = nothing active.
  const m =
    typeof PS_AUDIO_MONITOR === "object" && PS_AUDIO_MONITOR
      ? PS_AUDIO_MONITOR
      : null;
  if (!m) return "";

  const mixerOn = m.sources && m.sources.mixer && m.sources.mixer.active;
  const deviceOn = m.sources && m.sources.device && m.sources.device.active;

  if (mixerOn && deviceOn) return "LISTENING: DEVICE + LINE IN";
  if (mixerOn) return "LISTENING: LINE IN";
  if (deviceOn) return "LISTENING: DEVICE";
  return "";
}

function psAudioBadgeAvailable() {
  return psAudioBadgeText() !== "";
}

function psRenderAudioSourceBadge() {
  const el = psEnsureAudioSourceBadge();
  if (!el) return;
  const text = psAudioBadgeText();
  if (!text) {
    // No live mic active: hide the badge entirely (clearer than "LIVE: OFF").
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "";
  el.className = "audio-source-badge available";
  el.textContent = text;
}

function psBootAudioSourceBadge() {
  // Read-only status indicator. The control lives in the Mics tab.
  psEnsureAudioSourceBadge();
  psRenderAudioSourceBadge();
}

document.addEventListener("DOMContentLoaded", psBootAudioSourceBadge);
window.addEventListener("load", psBootAudioSourceBadge);
setInterval(psRenderAudioSourceBadge, 500);

// ---------------------------------------------------------------------------
// Live Sound Input control (lives in the Mics tab).
//
// Independent toggles: the phone/tablet mic and a plugged-in mixer can each be
// switched on or off separately and run AT THE SAME TIME. The radar badge just
// reports the combined status. Honest framing: this is a live ASSIST that
// listens to room ambience and nudges the threshold; it is not a calibrated
// SPL meter.
// ---------------------------------------------------------------------------
function psLiveInputSources() {
  return [
    { kind: "device", label: "Device mic" },
    { kind: "mixer", label: "Line in" },
  ];
}

function psRenderLiveInputControl() {
  const panel = document.getElementById("micPanel");
  if (!panel) return;

  let host = document.getElementById("liveInputBlock");
  if (!host) {
    host = document.createElement("div");
    host.id = "liveInputBlock";
    host.className = "sblock";
    host.style.marginBottom = "10px";
    host.innerHTML =
      '<label class="lbl" style="display:block;margin-bottom:4px">LIVE SOUND INPUT</label>' +
      '<div id="liveInputBtns" class="live-input-btns"></div>';
    const scene = document.getElementById("sceneSelectBlock");
    if (scene && scene.nextSibling) {
      panel.insertBefore(host, scene.nextSibling);
    } else if (scene) {
      panel.appendChild(host);
    } else {
      panel.insertBefore(host, panel.firstChild);
    }
  }

  const monitor =
    typeof PS_AUDIO_MONITOR === "object" && PS_AUDIO_MONITOR
      ? PS_AUDIO_MONITOR
      : null;
  const enabledFor = (kind) =>
    typeof psIsSourceEnabled === "function" && psIsSourceEnabled(kind);

  const btns = document.getElementById("liveInputBtns");
  if (btns) {
    btns.innerHTML = psLiveInputSources()
      .map((m) => {
        const on = enabledFor(m.kind);
        return (
          '<button type="button" class="live-input-btn' +
          (on ? " active" : "") +
          '" data-live-kind="' +
          m.kind +
          '">' +
          m.label +
          (on ? " ✓" : "") +
          "</button>"
        );
      })
      .join("");
    btns.querySelectorAll("[data-live-kind]").forEach((b) => {
      b.onclick = () => {
        const kind = b.getAttribute("data-live-kind");
        if (typeof psToggleSource === "function") psToggleSource(kind);
        psRenderLiveInputControl();
      };
    });
  }
}
