"use strict";

// ---------------------------------------------------------------------------
// app.spectral.js
//
// Per-aircraft, per-frequency atmospheric absorption using the EASA ANP v9
// 1/3-octave Spectral Classes. Air absorbs high frequencies far faster than
// low ones over distance, so a distant turboprop (low-frequency heavy) and a
// distant business jet (more high-frequency content) attenuate differently.
// The previous model used one fixed frequency blend for every aircraft; this
// replaces those arbitrary weights with weights derived from the aircraft's
// ACTUAL measured spectrum.
//
// IMPORTANT - no double counting: this only changes the broadband absorption
// COEFFICIENT used by the single-point (proxy/estimated) propagation path. The
// verified-NPD path reads received level straight off the certified curve
// (which already includes ANP reference absorption) and is not touched here.
//
// The data file (data/spectral-classes.json) holds each class spectrum; the
// engine looks up a class per aircraft: verified aircraft carry their real
// EASA approach/departure class IDs, everything else maps to a
// category-representative class by engine type.
// ---------------------------------------------------------------------------

let PS_SPECTRAL_CLASS_DATA = {
  schema: "plane-sound-spectral-classes-v1",
  freqsHz: [
    50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250,
    1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
  ],
  classes: {},
};

async function psLoadSpectralClasses() {
  try {
    const res = await fetch("data/spectral-classes.json", {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("spectral-classes " + res.status);
    const data = await res.json();
    if (data && data.classes) PS_SPECTRAL_CLASS_DATA = data;
  } catch (err) {
    console.warn("Spectral classes unavailable:", err.message);
  }
}

// A-weighting (IEC 61672) in dB at a frequency, used to weight bands by their
// contribution to the A-weighted level the mic and our threshold use.
function psAWeightingDb(f) {
  const f2 = f * f;
  const ra =
    (12194 * 12194 * f2 * f2) /
    ((f2 + 20.6 * 20.6) *
      Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) *
      (f2 + 12194 * 12194));
  return 20 * Math.log10(ra) + 2.0;
}

// Effective broadband absorption (dB/km) for a given 1/3-octave source
// spectrum and atmosphere. Each band's energy is weighted by its A-weighted
// share of the total, then by the relative loss it will incur, so the bands
// that actually carry the audible energy dominate the result. This is the
// spectrum-aware replacement for the old fixed-weight blend.
function psSpectralAbsorptionDbPerKm(levels, tempC, rhPct, pressureKpa) {
  const freqs = PS_SPECTRAL_CLASS_DATA.freqsHz || [];
  if (
    !Array.isArray(levels) ||
    !levels.length ||
    levels.length !== freqs.length
  ) {
    // Fall back to the generic broadband estimate if the spectrum is missing.
    return psBroadbandAircraftAbsorptionDbPerKm(tempC, rhPct, pressureKpa);
  }

  let wsum = 0;
  let accAlpha = 0;

  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    // A-weighted band energy (linear) = 10^((Lband + A(f))/10).
    const la = Number(levels[i]) + psAWeightingDb(f);
    const energy = Math.pow(10, la / 10);
    const alpha = psIso9613AbsorptionDbPerKm(f, tempC, rhPct, pressureKpa);
    accAlpha += energy * alpha;
    wsum += energy;
  }

  if (wsum <= 0) {
    return psBroadbandAircraftAbsorptionDbPerKm(tempC, rhPct, pressureKpa);
  }

  return clamp(accAlpha / wsum, 0.2, 14);
}

// Category -> representative EASA spectral class, by engine type, for aircraft
// that are not in the verified set (proxy/estimated). Uses approach-mode
// classes as the general default (the configuration most relevant when an
// aircraft is overhead/near a set); departure classes are similar in shape.
// These are real EASA class spectra, chosen by engine architecture, not made
// up. Keyed to the directivity/category the acoustic engine already assigns.
const PS_SPECTRAL_CATEGORY_CLASS = {
  jet: 205, // 2-Engine.HighByPass.Tfan (approach) - typical modern airliner
  jet_heavy: 245, // 4-Engine.Tfan (approach) - widebody/heavy
  jet_regional: 205, // high-bypass twin
  jet_business: 235, // 2-Engine.Tfan.Business
  turboprop: 210, // 2-Engine.Tprop (approach)
  piston: 215, // 1/2-Engine.Piston (approach)
  rotor: 210, // no rotor class in set; turboprop low-frequency shape is closest
  generic: 205,
};

function psSpectrumForCategory(category) {
  const id =
    PS_SPECTRAL_CATEGORY_CLASS[category] || PS_SPECTRAL_CATEGORY_CLASS.generic;
  const cls = PS_SPECTRAL_CLASS_DATA.classes[String(id)];
  return cls && Array.isArray(cls.levels) ? cls.levels : null;
}

// Resolve the spectrum to use for an aircraft's absorption. Verified aircraft
// pass their EASA class id(s) on the profile (spectralApproachClass /
// spectralDepartureClass); pick by regime. Otherwise map by category derived
// from the profile's directivity/label.
function psAircraftSpectrum(profile, regime) {
  if (profile) {
    const appId = profile.spectralApproachClass;
    const depId = profile.spectralDepartureClass;
    const wantDep =
      regime === "departure" || regime === "climb" || regime === "cruise";
    const id = wantDep ? depId || appId : appId || depId;
    if (id != null) {
      const cls = PS_SPECTRAL_CLASS_DATA.classes[String(id)];
      if (cls && Array.isArray(cls.levels)) return cls.levels;
    }
  }

  const category = psAircraftAcousticCategory(profile);
  return psSpectrumForCategory(category);
}

// Map a noise profile to a coarse acoustic category for spectrum selection.
function psAircraftAcousticCategory(profile) {
  const directivity = String(
    (profile &&
      (profile.directivity ||
        (profile.engine && profile.engine.directivity))) ||
      "",
  ).toLowerCase();
  const label = String((profile && profile.label) || "").toLowerCase();

  if (directivity === "rotor") return "rotor";
  if (directivity === "propeller" || label.includes("turboprop"))
    return "turboprop";
  if (label.includes("piston") || label.includes("light aircraft"))
    return "piston";
  if (
    label.includes("business") ||
    label.includes("falcon") ||
    label.includes("gulfstream")
  )
    return "jet_business";
  if (label.includes("heavy") || label.includes("super")) return "jet_heavy";
  if (label.includes("regional")) return "jet_regional";
  if (directivity === "jet") return "jet";
  return "generic";
}
