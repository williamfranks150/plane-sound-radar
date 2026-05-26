const fs = require("fs");

const files = [
  "data/aircraft-type-profiles.json",
  "data/aircraft-engine-profiles.json",
  "data/helicopter-profiles.json"
];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error("Missing:", file);
    process.exit(1);
  }

  JSON.parse(fs.readFileSync(file, "utf8"));
}

const typeData = JSON.parse(fs.readFileSync("data/aircraft-type-profiles.json", "utf8"));

if (!Array.isArray(typeData.profiles) || !typeData.profiles.length) {
  console.error("aircraft-type-profiles.json has no profiles.");
  process.exit(1);
}

for (const [index, profile] of typeData.profiles.entries()) {
  if (!Array.isArray(profile.codes) || !profile.codes.length) {
    console.error("Missing codes at profile", index);
    process.exit(1);
  }

  if (!Number.isFinite(Number(profile.dbaAt305m))) {
    console.error("Missing dbaAt305m at profile", index);
    process.exit(1);
  }

  if (!profile.engineClass) {
    console.error("Missing engineClass at profile", index);
    process.exit(1);
  }
}

console.log("Validated Acoustic Engine v3 data.");

