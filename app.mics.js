"use strict";

function micIds() {
  return (state.settings.active || []).filter((id) => MICS[id]);
}

function activeMicIds() {
  return micIds().filter((id) => MICS[id] && psMicHasUsableRange(MICS[id]));
}

function hiddenMicSet() {
  return new Set(state.hiddenMics || []);
}

function visibleMicEntries() {
  const hidden = hiddenMicSet();
  return Object.entries(MICS).filter(([id]) => !hidden.has(id));
}

function hideOrDeleteMic(id) {
  if (!MICS[id]) return;

  const micName = MICS[id].name || MICS[id].short || "this mic";
  const confirmed = window.confirm("Delete " + micName + " from the mic list?");

  if (!confirmed) return;

  const active = new Set(activeMicIds());
  active.delete(id);
  state.settings.package = "custom";
  state.settings.active = [...active];

  if (id.startsWith("custom_")) {
    delete MICS[id];
    saveCustomMics();
  } else {
    const hidden = hiddenMicSet();
    hidden.add(id);
    state.hiddenMics = [...hidden];
    write(STORE_HIDDEN, state.hiddenMics);
  }

  write(STORE_SETTINGS, state.settings);
  render();
  if (state.loc) fetchFeed();
}

function selectedMics() {
  const ids = activeMicIds();

  return ids.map((id, i) => ({
    id,
    ...MICS[id],
    color: RING_COLORS[i % RING_COLORS.length],
  }));
}

function rangeSettings() {
  const mics = selectedMics();
  const noMicSelected = !mics.length;
  const tail = mics.reduce(
    (value, mic) => Math.max(value, Number(mic.tail) || 20),
    20,
  );
  const widestMicKm = mics.reduce(
    (value, mic) => Math.max(value, Number(mic.mic) || 0),
    0,
  );
  const radarBase = noMicSelected
    ? 32
    : Math.max(widestMicKm * 1.08, widestMicKm + 4.5);
  const radar = Math.max(12, Math.ceil(radarBase / 4) * 4);

  return {
    tail,
    radar,
    mics,
    noMicSelected,
  };
}

function saveCustomMics() {
  const custom = {};
  Object.entries(MICS).forEach(([id, m]) => {
    if (id.startsWith("custom_")) custom[id] = m;
  });
  write(STORE_CUSTOM, custom);
}
