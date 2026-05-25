const fs = require("fs");

const outFile = "data/aircraft-noise-profiles.json";

const data = {
  schema: "plane-sound-aircraft-noise-profiles-v1",
  mode: "verified-data-required",
  sources: [],
  profiles: []
};

fs.writeFileSync(outFile, JSON.stringify(data, null, 2) + "\n");

console.log("Created empty verified aircraft-noise profile database.");
console.log("Import verified ANP/AEDT/NPD records here only after the source data is available.");
