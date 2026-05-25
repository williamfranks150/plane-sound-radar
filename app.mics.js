"use strict";

function micIds() {
  return (state.settings.active || []).filter((id) => MICS[id]);
}

function packageIds() {
  return PACKAGES[state.settings.package]?.mics || [];
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
  if (!ids.length) return [HUMAN_BASELINE];
  return ids.map((id, i) => ({
    id,
    ...MICS[id],
    color: RING_COLORS[i % RING_COLORS.length],
  }));
}

function rangeSettings() {
  const mics = selectedMics();
  let mic = HUMAN_BASELINE.mic,
    hot = HUMAN_BASELINE.hot,
    tail = HUMAN_BASELINE.tail,
    ceil = HUMAN_BASELINE.ceil;
  mics.forEach((m) => {
    mic = Math.max(mic, m.mic);
    hot = Math.max(hot, m.hot);
    tail = Math.max(tail, m.tail);
    ceil = Math.max(ceil, m.ceil);
  });
  // Keep extra radar space so aircraft about 60 seconds before mic-range entry remain visible.
  const oneMinuteLeadKm = 18;
  const radar = Math.max(
    12,
    Math.ceil(Math.max(mic * 1.08, mic + oneMinuteLeadKm * 0.25) / 4) * 4,
  );
  return {
    mic,
    hot,
    tail,
    ceil,
    radar,
    mics,
    usingHuman: !activeMicIds().length,
  };
}

function syncPackage(id) {
  state.settings.package = id;
  if (id !== "custom") state.settings.active = [...PACKAGES[id].mics];
  write(STORE_SETTINGS, state.settings);
}

function saveCustomMics() {
  const custom = {};
  Object.entries(MICS).forEach(([id, m]) => {
    if (id.startsWith("custom_")) custom[id] = m;
  });
  write(STORE_CUSTOM, custom);
}

function normText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isVerifiedMicRecord(raw) {
  if (!raw || typeof raw !== "object") return false;

  const status = String(raw.status || raw.confidence || "").toLowerCase();
  if (
    !(
      status === "verified" ||
      status === "verified-database" ||
      status === "verified_database" ||
      status === "spec_record"
    )
  )
    return false;

  const name = String(raw.name || "").trim();
  if (!name) return false;

  const rangeFields = [raw.mic, raw.hot, raw.tail, raw.ceil];
  const hasRange = rangeFields.every(
    (v) => v !== undefined && v !== null && String(v).trim() !== "",
  );

  if (!hasRange) {
    const specFields = [
      raw.manufacturer,
      raw.brand,
      raw.make,
      raw.transducerType,
      raw.pickupPattern,
      raw.frequencyResponse,
      raw.sensitivity,
      raw.sensitivityMvPa,
      raw.selfNoiseDba,
    ];
    return specFields.some(
      (v) => v !== undefined && v !== null && String(v).trim() !== "",
    );
  }

  const mic = Number(raw.mic),
    hot = Number(raw.hot),
    tail = Number(raw.tail),
    ceil = Number(raw.ceil);
  if (
    !Number.isFinite(mic) ||
    !Number.isFinite(hot) ||
    !Number.isFinite(tail) ||
    !Number.isFinite(ceil)
  )
    return false;
  if (
    mic <= 0 ||
    mic > 80 ||
    hot <= 0 ||
    hot > mic ||
    tail < 0 ||
    tail > 600 ||
    ceil < 1000 ||
    ceil > 50000
  )
    return false;

  return true;
}

function normalizeMicRecord(raw) {
  if (!isVerifiedMicRecord(raw)) return null;

  const name = String(raw.name || "").trim();
  const rangeFields = [raw.mic, raw.hot, raw.tail, raw.ceil];
  const hasRange = rangeFields.every(
    (v) => v !== undefined && v !== null && String(v).trim() !== "",
  );

  const base = {
    name,
    short: String(raw.short || name)
      .replace(/\s+/g, " ")
      .slice(0, 22),
    kind: String(raw.kind || "verified"),
    manufacturer: raw.manufacturer || raw.brand || raw.make || "",
    transducerType: raw.transducerType || null,
    pickupPattern: raw.pickupPattern || null,
    frequencyResponse: raw.frequencyResponse || null,
    sensitivity: raw.sensitivity ?? raw.sensitivityMvPa ?? null,
    selfNoiseDba: raw.selfNoiseDba ?? null,
    aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
    confidence: String(raw.confidence || "verified-database"),
  };

  if (!hasRange) {
    return {
      ...base,
      status: "spec_record",
      rangeStatus: "pending",
    };
  }

  return {
    ...base,
    mic: Math.round(Number(raw.mic) * 10) / 10,
    hot: Math.round(Number(raw.hot) * 10) / 10,
    tail: Math.round(Number(raw.tail)),
    ceil: Math.round(Number(raw.ceil) / 500) * 500,
    status: "verified",
    rangeStatus: "verified",
  };
}
