"use strict";

async function geocode(q) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 10000);
  try {
    const url = GEOCODE_ENDPOINT
      ? GEOCODE_ENDPOINT + "?q=" + encodeURIComponent(q)
      : "https://nominatim.openstreetmap.org/search?q=" +
        encodeURIComponent(q) +
        "&format=json&limit=6&addressdetails=1";
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "Accept-Language": "en" },
    });
    clearTimeout(to);
    if (!res.ok) throw Error(res.status);
    const data = await res.json();
    return data
      .map((r) => {
        const a = r.address || {};
        const place =
          a.house_number && a.road
            ? a.house_number + " " + a.road
            : a.road ||
              a.neighbourhood ||
              a.suburb ||
              a.city ||
              a.town ||
              a.village ||
              a.county ||
              r.shortLabel ||
              "Location";
        const region = a.city || a.town || a.village || a.county || "";
        const country = a.country_code ? a.country_code.toUpperCase() : "";
        return {
          lat: +(r.lat ?? r.latitude),
          lon: +(r.lon ?? r.longitude),
          shortLabel:
            r.shortLabel ||
            [place, region !== place ? region : null, country]
              .filter(Boolean)
              .join(", "),
          fullLabel: r.fullLabel || r.display_name || r.name || "Location",
          source: "search",
        };
      })
      .filter((r) => isFinite(r.lat) && isFinite(r.lon));
  } catch (e) {
    clearTimeout(to);
    throw e;
  }
}

async function doSearch() {
  const q = $("searchInput").value.trim();
  if (!q) return;
  state.search.loading = true;
  $("searchBtn").disabled = true;
  $("searchMsg").classList.add("hidden");
  try {
    state.search.results = await geocode(q);
    if (!state.search.results.length) {
      $("searchMsg").textContent = "No matches found.";
      $("searchMsg").classList.remove("hidden");
    }
  } catch (e) {
    $("searchMsg").textContent = "Search failed.";
    $("searchMsg").classList.remove("hidden");
  } finally {
    state.search.loading = false;
    $("searchBtn").disabled = false;
    renderPanels();
  }
}
