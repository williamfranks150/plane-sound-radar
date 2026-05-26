"use strict";

function setLoc(loc) {
  state.loc = loc;
  state.savedLoc = loc;
  state.activePanel = null;
  write(STORE_LOC, loc);
  state.search.results = [];
  $("searchInput").value = "";
  render();
  startLoop();

  if (typeof psPrimeWeatherForLocation === "function") {
    psPrimeWeatherForLocation(loc).then(() => {
      render();
      if (state.loc) fetchFeed();
    });
  }
}

function gps(auto = false) {
  if (!navigator.geolocation) {
    $("gpsMsg").textContent = "GPS not supported.";
    $("gpsMsg").classList.remove("hidden");
    return;
  }
  $("gpsBtn").disabled = true;
  $("gpsMsg").textContent = "";
  $("gpsMsg").classList.add("hidden");
  $("gpsMsg").className = "msg ok";
  $("gpsMsg").classList.remove("hidden");

  navigator.geolocation.getCurrentPosition(
    (p) => {
      setLoc({
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        shortLabel: "Phone GPS",
        fullLabel: "Phone GPS",
        accuracy: p.coords.accuracy,
        source: "gps",
      });
      $("gpsBtn").disabled = false;
    },
    (e) => {
      let msg =
        e.code === 1
          ? "GPS permission denied. Enable location for this browser."
          : "GPS failed.";
      $("gpsMsg").textContent = msg;
      $("gpsMsg").className = "msg";
      $("gpsBtn").disabled = false;
      if (auto) state.activePanel = "location";
      renderPanels();
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
  );
}

function maybeAutoGps() {
  if (!navigator.geolocation) return;
  gps(true);
}

function manual() {
  const lat = parseFloat($("latInput").value);
  const lon = parseFloat($("lonInput").value);
  if (
    !isFinite(lat) ||
    !isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    return;
  setLoc({
    lat,
    lon,
    shortLabel: "Manual Location",
    fullLabel: `${lat}, ${lon}`,
    source: "manual",
  });
}
