'use strict';

function psAudioSourceBadgeMode() {
  if (typeof psIsManualAudioMode === 'function' && psIsManualAudioMode()) {
    return 'manual';
  }

  const monitor =
    typeof PS_AUDIO_MONITOR === 'object' && PS_AUDIO_MONITOR ? PS_AUDIO_MONITOR : null;

  if (!monitor || !monitor.available) return 'manual';
  if (monitor.denied) return 'manual';
  if (!monitor.active) return 'manual';
  if (monitor.activeSourceKind === 'mixer') return 'mixer';

  return 'phone';
}

function psAudioSourceDisplayValue() {
  const mode = psAudioSourceBadgeMode();

  if (mode === 'mixer') return 'SOUND DEPT';
  if (mode === 'phone') return 'IPHONE MIC';

  return 'NO MIC';
}

function psRenderAudioSourceBadge() {
  const el = document.getElementById('audioSourceBadge');

  if (!el) return;

  const mode = psAudioSourceBadgeMode();

  el.className = 'audio-source-badge ' + mode;
  el.textContent = psAudioSourceDisplayValue();
}

function psAudioSourceBadgePressed() {
  const mode = psAudioSourceBadgeMode();

  if (mode === 'manual') {
    if (typeof psSetAudioSourceMode === 'function') psSetAudioSourceMode('auto');
    return;
  }

  if (typeof psSetAudioSourceMode === 'function') psSetAudioSourceMode('manual');

  psRenderAudioSourceBadge();
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('audioSourceBadge');

  if (el) {
    el.addEventListener('click', psAudioSourceBadgePressed);
  }

  psRenderAudioSourceBadge();
});

setInterval(psRenderAudioSourceBadge, 500);
