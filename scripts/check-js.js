const fs = require("fs");

const files = [
  "config.js",
  "app.constants.js",
  "app.data.js",
  "app.utils.js",
  "app.aircraft-db.js",
  "app.propagation.js",
  "app.spectral.js",
  "app.weather.js",
  "app.audio-monitor.js",
  "app.audio-source.js",
  "app.threshold.js",
  "app.acoustics.js",
  "app.aircraft.js",
  "app.mics.js",
  "app.selected-mics.js",
  "app.connection.js",
  "app.render.js",
  "app.forecast-log.js",
  "app.radar.js",
  "app.location.js",
  "app.loop.js",
  "app.mic-specs.js",
  "app.search.js",
  "app.feed.js",
  "app.js",
  "worker-index.js"
];

let failed = false;

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error("MISSING:", file);
    failed = true;
    continue;
  }

  const { spawnSync } = require("child_process");
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("All JavaScript syntax checks passed.");

