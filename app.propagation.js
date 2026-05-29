"use strict";

// ---------------------------------------------------------------------------
// app.propagation.js
// Physics core for sound propagation from aircraft to a ground microphone.
//
// Everything here is a pure function of inputs that are passed in (weather
// layers, geometry). It holds no fetch logic and no app state. app.weather.js
// owns fetching/parsing and feeds parsed layers into these functions.
//
// References:
//   - Speed of sound:        c = 331.3 * sqrt(1 + T_C/273.15)  (m/s)
//   - Atmospheric absorption: ISO 9613-1 (atmospheric absorption of sound)
//   - Refraction regime:      effective sound-speed gradient (temp lapse +
//                             wind component along path) -> upward bending
//                             (shadow zone) vs downward bending (ducting).
//
// The refraction term is a PARAMETRIC estimate, not a full ray trace. Its job
// is to (a) get the sign and elevation-angle dependence right and (b) report
// an honest uncertainty band (swingDb) so the timing layer can widen its
// confidence interval instead of pretending to a precision the atmosphere
// does not allow.
// ---------------------------------------------------------------------------

const PS_C0_REF_TEMP_C = 20; // reference temperature for c
const PS_PRESSURE_REF_KPA = 101.325;
const PS_TEMP_REF_K = 293.15; // 20 C, ISO 9613-1 reference
const PS_TEMP_TRIPLE_K = 273.16;

// Speed of sound in dry air at a given temperature (m/s).
function psSpeedOfSoundMs(tempC) {
  const t = Number.isFinite(Number(tempC)) ? Number(tempC) : PS_C0_REF_TEMP_C;

  return 331.3 * Math.sqrt(1 + t / 273.15);
}

// ISO 9613-1 atmospheric absorption coefficient at one frequency.
// tempC: C, rhPct: %, pressureKpa: kPa, freqHz: Hz. Returns dB/km.
function psIso9613AbsorptionDbPerKm(freqHz, tempC, rhPct, pressureKpa) {
  const f = Math.max(1, Number(freqHz) || 0);
  const T = (Number.isFinite(Number(tempC)) ? Number(tempC) : 15) + 273.15;
  const pa = Number.isFinite(Number(pressureKpa))
    ? Number(pressureKpa)
    : PS_PRESSURE_REF_KPA;
  const rh = Number.isFinite(Number(rhPct)) ? Number(rhPct) : 50;

  const pr = PS_PRESSURE_REF_KPA;
  const paOverPr = pa / pr;
  const Tratio = T / PS_TEMP_REF_K;

  // Saturation vapour pressure ratio (psat/pr), Annex form.
  const psatOverPr = Math.pow(
    10,
    -6.8346 * Math.pow(PS_TEMP_TRIPLE_K / T, 1.261) + 4.6151,
  );

  // Molar concentration of water vapour (%).
  const h = rh * (psatOverPr / paOverPr);

  // Relaxation frequencies for oxygen and nitrogen.
  const frO =
    paOverPr * (24 + (4.04e4 * h * (0.02 + h)) / (0.391 + h));
  const frN =
    paOverPr *
    Math.pow(Tratio, -0.5) *
    (9 + 280 * h * Math.exp(-4.17 * (Math.pow(Tratio, -1 / 3) - 1)));

  const f2 = f * f;

  const alphaNpPerM =
    f2 *
    (1.84e-11 * (1 / paOverPr) * Math.pow(Tratio, 0.5) +
      Math.pow(Tratio, -2.5) *
        ((0.01275 * Math.exp(-2239.1 / T)) / (frO + f2 / frO) +
          (0.1068 * Math.exp(-3352.0 / T)) / (frN + f2 / frN)));

  // 8.686 converts nepers/m to dB/m; *1000 to dB/km.
  return 8.686 * alphaNpPerM * 1000;
}

// Effective broadband absorption for the distant-aircraft spectrum.
// Distant aircraft A-weighted energy concentrates in the 250-1000 Hz region
// (higher bands are absorbed away first over km paths). We blend a few bands
// with weights that favour that region, energetically. Returns dB/km.
function psBroadbandAircraftAbsorptionDbPerKm(tempC, rhPct, pressureKpa) {
  const bands = [
    { f: 250, w: 0.35 },
    { f: 500, w: 0.35 },
    { f: 1000, w: 0.22 },
    { f: 2000, w: 0.08 },
  ];

  let acc = 0;
  let wsum = 0;

  for (const b of bands) {
    acc += b.w * psIso9613AbsorptionDbPerKm(b.f, tempC, rhPct, pressureKpa);
    wsum += b.w;
  }

  return clamp(acc / (wsum || 1), 0.2, 12);
}

// Horizontal wind component blowing TOWARD the listener (km/h), positive when
// the wind carries sound from the aircraft toward the mic. Geometry is the
// unit vector from aircraft to listener in canvas-free world space.
function psWindTowardListenerKmh(windSpeedKmh, windFromDeg, context) {
  if (
    !Number.isFinite(Number(windSpeedKmh)) ||
    !Number.isFinite(Number(windFromDeg))
  )
    return 0;

  // Meteorological convention: windFromDeg is the direction the wind comes
  // FROM. The vector it blows toward is +180 deg.
  const toward = (Number(windFromDeg) + 180) * D2R;
  const wx = Number(windSpeedKmh) * Math.sin(toward);
  const wy = Number(windSpeedKmh) * Math.cos(toward);

  const h = Math.max(0.001, Number(context.horizontalKm || 0));
  const toListenerX = -Number(context.x || 0) / h;
  const toListenerY = -Number(context.y || 0) / h;

  return wx * toListenerX + wy * toListenerY;
}

// Elevation angle of the aircraft above the listener's horizon (radians).
function psElevationAngleRad(context) {
  const h = Math.max(0.0001, Number(context.horizontalKm || 0));
  const z = Math.max(0, Number(context.altKm || 0));

  return Math.atan2(z, h);
}

// Path-averaged speed of sound from ground to the aircraft, including the
// along-path wind advection. Returns m/s. layers: parsed pressure levels
// (each {geopotentialM, temperatureC, windSpeedKmh, windFromDeg}); surface:
// {temperatureC, windSpeedKmh, windFromDeg}; context carries geometry.
function psPathAverageSoundSpeedMs(altFt, surface, layers, context) {
  const altM = Math.max(0, Number(altFt || 0) / FT_PER_M);
  const elev = psElevationAngleRad(context);
  const cosElev = Math.cos(elev);

  const samples = [];

  if (surface && Number.isFinite(Number(surface.temperatureC))) {
    samples.push({
      z: 0,
      c: psSpeedOfSoundMs(surface.temperatureC),
      windToward: psWindTowardListenerKmh(
        surface.windSpeedKmh,
        surface.windFromDeg,
        context,
      ),
    });
  }

  (layers || [])
    .filter(
      (l) =>
        Number.isFinite(Number(l.geopotentialM)) &&
        Number.isFinite(Number(l.temperatureC)) &&
        Number(l.geopotentialM) <= altM + 200,
    )
    .forEach((l) => {
      samples.push({
        z: Number(l.geopotentialM),
        c: psSpeedOfSoundMs(l.temperatureC),
        windToward: psWindTowardListenerKmh(
          l.windSpeedKmh,
          l.windFromDeg,
          context,
        ),
      });
    });

  if (!samples.length) return psSpeedOfSoundMs(15);

  // Mean c plus mean along-path wind advection (wind toward listener,
  // projected onto the slant path by cos(elevation)). km/h -> m/s = /3.6.
  let cSum = 0;
  let windSum = 0;

  for (const s of samples) {
    cSum += s.c;
    windSum += s.windToward;
  }

  const meanC = cSum / samples.length;
  const meanWindMs = windSum / samples.length / 3.6;

  return clamp(meanC + meanWindMs * cosElev, 280, 360);
}

// Path-weighted effective sound-speed gradient between ground and the
// aircraft, toward the listener (units: (m/s)/m). Refraction is dominated by
// the near-ground layers where the ray travels most horizontally, so we
// weight lower layers more heavily (weight ~ 1/(1+z/zScale)). Returns the
// gradient plus the surface effective sound speed used as c0.
function psEffectiveGradient(context, surface, layers) {
  const altM = Math.max(50, Number(context.altKm || 0) * 1000);
  const zScale = 600; // m; near-ground emphasis

  const cSurf =
    psSpeedOfSoundMs(surface.temperatureC) +
    psWindTowardListenerKmh(
      surface.windSpeedKmh,
      surface.windFromDeg,
      context,
    ) /
      3.6;

  const samples = [{ z: 0, c: cSurf }];

  (layers || [])
    .filter(
      (l) =>
        Number.isFinite(Number(l.temperatureC)) &&
        Number.isFinite(Number(l.geopotentialM)) &&
        Number(l.geopotentialM) > 0 &&
        Number(l.geopotentialM) <= altM + 300,
    )
    .forEach((l) => {
      samples.push({
        z: Number(l.geopotentialM),
        c:
          psSpeedOfSoundMs(l.temperatureC) +
          psWindTowardListenerKmh(l.windSpeedKmh, l.windFromDeg, context) /
            3.6,
      });
    });

  if (samples.length < 2) {
    return { gradient: 0, c0: cSurf, samples: samples.length };
  }

  // Weighted least-squares slope of c vs z, weights emphasising low layers.
  let sw = 0,
    swz = 0,
    swc = 0,
    swzz = 0,
    swzc = 0;

  for (const s of samples) {
    const w = 1 / (1 + s.z / zScale);
    sw += w;
    swz += w * s.z;
    swc += w * s.c;
    swzz += w * s.z * s.z;
    swzc += w * s.z * s.c;
  }

  const denom = sw * swzz - swz * swz;
  const gradient = Math.abs(denom) < 1e-9 ? 0 : (sw * swzc - swz * swc) / denom;

  return { gradient, c0: cSurf, samples: samples.length };
}

// Refraction band via the analytic linear sound-speed-gradient ray model.
//
// For c_eff(z) = c0 + g*z, rays are circular arcs of radius R = c0/|g|.
//   g > 0  downward refraction  -> sound bends toward ground, no shadow,
//          bounded near-ground enhancement (mild ducting).
//   g < 0  upward refraction    -> a geometric shadow forms beyond a skip
//          distance  x_s = sqrt(2R) * (sqrt(h_src) + sqrt(h_rcv)).
//          Inside x_s the receiver is illuminated; beyond it, in shadow, with
//          attenuation growing with depth past the boundary (diffraction).
//
// The point estimate is now physics, not a tuned coefficient. The honest
// uncertainty (diffraction into deep shadow, turbulent scattering filling the
// shadow, multi-layer ducting) is carried in swingDb.
function psRefractionBand(context, surface, layers) {
  if (!surface || !Number.isFinite(Number(surface.temperatureC))) {
    return {
      excessDb: 0,
      swingDb: 6,
      regime: "calm",
      confidence: 0.12,
      reasonCodes: ["refraction_no_profile"],
    };
  }

  const elev = psElevationAngleRad(context);
  const elevDeg = elev / D2R;
  const hSrcM = Math.max(1, Number(context.altKm || 0) * 1000);
  const hRcvM = 2.5; // mic/boom height above ground (m)
  const horizM = Math.max(1, Number(context.horizontalKm || 0) * 1000);

  const eff = psEffectiveGradient(context, surface, layers);
  const g = eff.gradient; // (m/s)/m, toward listener
  const c0 = eff.c0;
  const haveAloft = eff.samples >= 2;

  // Wind-only gradient sets the DIRECTION label (so it stays meaningful even
  // when an isotropic temperature lapse dominates the total magnitude).
  const windGrad = psWindGradientToward(context, surface, layers);

  let regime = "calm";
  if (elevDeg >= 35) regime = "overhead";
  else if (windGrad > 0.0008) regime = "downwind";
  else if (windGrad < -0.0008) regime = "upwind";

  // Overhead / steep angles: refraction negligible.
  if (elevDeg >= 35 || Math.abs(g) < 1e-6) {
    return {
      excessDb: 0,
      swingDb: clamp(1.5 + 0.05 * (35 - Math.min(elevDeg, 35)), 1.5, 3),
      regime: elevDeg >= 35 ? "overhead" : regime,
      gradient: g,
      windGradient: windGrad,
      confidence: clamp(haveAloft ? 0.55 : 0.25, 0.1, 0.6),
      reasonCodes: [
        "refraction_" + (elevDeg >= 35 ? "overhead" : regime),
        haveAloft ? "refraction_profile_aloft" : "refraction_surface_only",
      ],
    };
  }

  const R = c0 / Math.abs(g); // ray curvature radius (m)
  let excessDb = 0;
  let swingDb = 3;

  if (g >= 0) {
    // Downward refraction: no shadow. Near-ground focusing gives a bounded
    // enhancement that grows with how strongly the rays curve down over the
    // path. Cap at a few dB (a true duct needs a trapped mode; we don't claim
    // more than mild reinforcement).
    const curveOverPath = clamp(horizM / (2 * R), 0, 0.5);
    excessDb = clamp(curveOverPath * 8, 0, 4);
    swingDb = clamp(2 + curveOverPath * 6, 2, 6);
  } else {
    // Upward refraction: skip distance to the shadow boundary.
    const xShadow = Math.sqrt(2 * R) * (Math.sqrt(hSrcM) + Math.sqrt(hRcvM));

    if (horizM <= xShadow) {
      // Illuminated but past partial divergence: small loss approaching the
      // boundary.
      const frac = clamp(horizM / Math.max(1, xShadow), 0, 1);
      excessDb = clamp(-3 * frac * frac, -3, 0);
      swingDb = clamp(2 + 3 * frac, 2, 6);
    } else {
      // Shadow zone. Attenuation grows with depth past the boundary. Standard
      // ground-shadow behaviour is order tens of dB; we use a depth term in
      // units of the boundary distance and cap at -25 dB, with a wide band
      // because diffraction/turbulence fill the shadow unpredictably.
      const depth = (horizM - xShadow) / Math.max(200, xShadow);
      excessDb = clamp(-(3 + 14 * depth), -25, 0);
      swingDb = clamp(4 + 10 * clamp(depth, 0, 1.2), 4, 14);
    }
  }

  const confidence = clamp(
    (haveAloft ? 0.5 : 0.2) -
      (regime === "upwind" ? 0.08 : 0) -
      swingDb * 0.012,
    0.1,
    0.6,
  );

  return {
    excessDb,
    swingDb,
    regime,
    gradient: g,
    windGradient: windGrad,
    curvatureRadiusM: R,
    elevDeg,
    confidence,
    reasonCodes: [
      "refraction_" + regime,
      haveAloft ? "refraction_profile_aloft" : "refraction_surface_only",
    ],
  };
}

// Wind-only effective gradient toward the listener (sign carries direction).
function psWindGradientToward(context, surface, layers) {
  const altM = Math.max(50, Number(context.altKm || 0) * 1000);
  const uSurf =
    psWindTowardListenerKmh(
      surface.windSpeedKmh,
      surface.windFromDeg,
      context,
    ) / 3.6;

  const aloft =
    (layers || [])
      .filter(
        (l) =>
          Number.isFinite(Number(l.windSpeedKmh)) &&
          Number.isFinite(Number(l.geopotentialM)),
      )
      .reduce((best, l) => {
        if (!best) return l;
        const d = Math.abs(Number(l.geopotentialM) - altM);
        const bd = Math.abs(Number(best.geopotentialM) - altM);
        return d < bd ? l : best;
      }, null) || null;

  if (!aloft) return 0;

  const uAloft =
    psWindTowardListenerKmh(aloft.windSpeedKmh, aloft.windFromDeg, context) /
    3.6;

  return (uAloft - uSurf) / Math.max(50, altM);
}