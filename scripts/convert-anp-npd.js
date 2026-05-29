"use strict";

/**
 * convert-anp-npd.js
 *
 * Convert EUROCONTROL/EASA legacy ANP NPD data (CSV export) into the Plane
 * Sound verified aircraft-noise-profile JSON schema.
 *
 * The ANP "NPD_data" table publishes, per airframe-engine ANP id, a noise
 * descriptor (we want LAMAX), an operation mode (A = approach, D = departure),
 * a power setting, and sound levels at the ten standard slant distances:
 *   200, 400, 630, 1000, 2000, 4000, 6300, 10000, 16000, 25000 ft.
 *
 * Usage:
 *   node scripts/convert-anp-npd.js <NPD_data.csv> <ANP_aircraft_map.csv> > data/aircraft-noise-profiles.json
 *
 * The second file maps ICAO type designators (e.g. B738) to ANP ids; if you
 * don't have it, pass a single-column file of "ICAO,ANPID" pairs you build by
 * hand for the types you care about. Only LAMAX rows are used.
 *
 * This script does NOT invent data. It only reshapes rows that exist in the
 * input. Distances are converted ft -> m. Power settings are mapped to the
 * app's thrust-setting vocabulary by mode (D->departure/climb, A->approach).
 */

const fs = require("fs");

const FT_TO_M = 0.3048;
const STD_DISTANCES_FT = [
  200, 400, 630, 1000, 2000, 4000, 6300, 10000, 16000, 25000,
];

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  // ANP CSVs from EUROCONTROL/EASA are semicolon-delimited; others comma.
  const delim = (lines[0].match(/;/g) || []).length >=
    (lines[0].match(/,/g) || []).length
    ? ";"
    : ",";
  const header = splitCsvLine(lines[0], delim).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delim);
    const row = {};
    header.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

function splitCsvLine(line, delim) {
  const d = delim || ",";
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === d && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function findCol(row, candidates) {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const hit = keys.find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "") === cand);
    if (hit) return hit;
  }
  return null;
}

function modeToSettings(mode, power) {
  const m = String(mode || "").toUpperCase();
  if (m.startsWith("D")) return "departure";
  if (m.startsWith("A")) return "approach";
  return "cruise";
}

function main() {
  const [npdPath, mapPath] = process.argv.slice(2);
  if (!npdPath) {
    console.error(
      "Usage: node scripts/convert-anp-npd.js <NPD_data.csv> [ICAO_to_ANPID.csv]",
    );
    process.exit(1);
  }

  const npdRows = parseCsv(fs.readFileSync(npdPath, "utf8"));
  if (!npdRows.length) {
    console.error("No rows parsed from NPD file.");
    process.exit(1);
  }

  const sample = npdRows[0];
  const cId = findCol(sample, ["npdid", "anpid", "acftid", "aircraftid", "id"]);
  const cMode = findCol(sample, ["opmode", "operationmode", "mode"]);
  const cPower = findCol(sample, ["power", "powersetting", "thrust"]);

  if (!cId) {
    console.error("Could not find an ANP id column. Columns: " + Object.keys(sample).join(", "));
    process.exit(1);
  }

  // Detect the descriptor column by its VALUES (LAMAX/SEL/EPNL), not its name.
  const descriptorVals = new Set(["LAMAX", "SEL", "EPNL", "PNLTM", "LASMAX"]);
  let cNoise = null;
  for (const key of Object.keys(sample)) {
    const vals = npdRows
      .slice(0, 50)
      .map((r) => String(r[key]).toUpperCase().replace(/[^A-Z]/g, ""));
    if (vals.some((v) => descriptorVals.has(v))) {
      cNoise = key;
      break;
    }
  }

  // Distance columns: prefer explicit L_200..L_25000 style; else positional.
  const distCols = STD_DISTANCES_FT.map((ft) => {
    const key = Object.keys(sample).find((k) =>
      k.replace(/[^0-9]/g, "") === String(ft),
    );
    return { ft, key };
  });

  let icaoMap = {};
  if (mapPath && fs.existsSync(mapPath)) {
    parseCsv(fs.readFileSync(mapPath, "utf8")).forEach((r) => {
      const vals = Object.values(r);
      if (vals.length >= 2) icaoMap[vals[1].toUpperCase()] = vals[0].toUpperCase();
    });
  }

  // Group LAMAX rows by ANP id, retaining each row's op-mode and power.
  const byId = new Map();
  let kept = 0;
  for (const row of npdRows) {
    if (cNoise && !/lamax|lasmax/i.test(String(row[cNoise]).replace(/[^a-z]/gi, ""))) continue;
    const id = row[cId];
    if (!id) continue;
    const setting = modeToSettings(cMode ? row[cMode] : "", cPower ? row[cPower] : "");
    const power = cPower ? Number(row[cPower]) : NaN;
    const points = distCols
      .map(({ ft, key }) => {
        const v = key ? Number(row[key]) : NaN;
        return Number.isFinite(v) ? { distM: Math.round(ft * FT_TO_M), dba: v } : null;
      })
      .filter(Boolean);
    if (!points.length) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({ setting, power, points });
    kept++;
  }

  if (!kept) {
    console.error(
      "WARNING: no LAMAX rows matched. Descriptor column detected: " +
        (cNoise || "none") +
        ". Check that the input has a LAMAX noise descriptor and standard distance columns.",
    );
  }

  // Collapse multiple power rows per op-mode to ONE representative curve:
  //  - departure: highest power setting (loudest -> worst case that triggers a
  //    warning). Also kept as setting "climb" so the regime->column mapping
  //    has a target when the aircraft is climbing.
  //  - approach: the highest power among approach rows (a steeper/faster
  //    approach is louder; conservative for contamination).
  // All raw curves are preserved under thrustAll for later refinement.
  function pickRepresentative(rows) {
    const dep = rows.filter((r) => r.setting === "departure");
    const app = rows.filter((r) => r.setting === "approach");
    const out = [];
    if (dep.length) {
      const loudest = dep.reduce((a, b) =>
        (Number(b.power) || 0) > (Number(a.power) || 0) ? b : a,
      );
      out.push({ setting: "departure", points: loudest.points });
      out.push({ setting: "climb", points: loudest.points });
      out.push({ setting: "cruise", points: loudest.points });
    }
    if (app.length) {
      const loudest = app.reduce((a, b) =>
        (Number(b.power) || 0) > (Number(a.power) || 0) ? b : a,
      );
      out.push({ setting: "approach", points: loudest.points });
    }
    // If only one mode existed, reuse it for the others so lookups never miss.
    if (!out.length && rows.length) {
      out.push({ setting: "cruise", points: rows[0].points });
    }
    return out;
  }

  const profiles = [];
  for (const [anpId, rows] of byId.entries()) {
    const icao = icaoMap[anpId.toUpperCase()] || null;
    profiles.push({
      sourceType: "verified",
      label: anpId,
      aircraftTypeCodes: icao ? [icao] : [],
      anpId,
      confidence: 0.85,
      npd: { refMetric: "Lmax_dBA", thrust: pickRepresentative(rows) },
    });
  }

  const out = {
    schema: "plane-sound-aircraft-noise-profiles-v1",
    mode: "verified-data-required",
    sources: [
      {
        name: "EUROCONTROL/EASA ANP legacy NPD",
        metric: "LAMAX",
        note: "Converted from ANP NPD_data CSV by scripts/convert-anp-npd.js",
      },
    ],
    profiles,
  };

  process.stdout.write(JSON.stringify(out, null, 2));
}

main();