const fs = require("fs");

const file = "data/aircraft-noise-profiles.json";

if (!fs.existsSync(file)) {
  console.error("Missing acoustic profile file:", file);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, "utf8"));

if (data.schema !== "plane-sound-aircraft-noise-profiles-v1") {
  console.error("Invalid acoustic profile schema.");
  process.exit(1);
}

if (!Array.isArray(data.profiles)) {
  console.error("profiles must be an array.");
  process.exit(1);
}

for (const [i, profile] of data.profiles.entries()) {
  const prefix = `profiles[${i}]`;

  if (profile.sourceType !== "verified") {
    console.error(`${prefix}.sourceType must be verified.`);
    process.exit(1);
  }

  if (!Array.isArray(profile.aircraftTypeCodes) || !profile.aircraftTypeCodes.length) {
    console.error(`${prefix}.aircraftTypeCodes missing.`);
    process.exit(1);
  }

  if (!Number.isFinite(Number(profile.dbaAt305m))) {
    console.error(`${prefix}.dbaAt305m missing or invalid.`);
    process.exit(1);
  }

  if (!profile.sourceName || !profile.sourceUrl) {
    console.error(`${prefix} sourceName/sourceUrl required.`);
    process.exit(1);
  }
}

console.log(`Validated ${data.profiles.length} verified aircraft acoustic profiles.`);
