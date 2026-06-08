# Changelog

## v2.4-copy-and-clarity

- Ambient Noise Floor presets are now Quiet exterior / Loud exterior / Quiet interior / Loud interior / Studio. Saved older selections migrate automatically.
- Removed instructional notes from the Mics tab (live input) and trimmed the log empty-state message. Less UI clutter.
- Rewrote About copy to be broader and more confident: no film-only terms (take, post, recordist), no em-dashes, and removed the work-in-progress "limits" disclaimer section.
- Forecast no-mic prompt shortened to "Select a mic".
- Radar live-input badge now hides entirely when no live mic is on, and shows the plain source name ("INTERNAL MIC" / "EXTERNAL MIC" / "INTERNAL + EXTERNAL MIC") when on.
- Privacy is now an in-app overlay matching the About panel (dark/neon card, Close button); the standalone privacy.html page was removed.

## v2.3-ui-cleanup

- Renamed live-input sources to "Internal mic" / "External mic"; badge shows LIVE: INTERNAL / EXTERNAL / INT + EXT / OFF.
- Simplified Ambient Noise Floor presets to Quiet exterior / Exterior / Loud exterior / Interior (dBA values and per-option description line removed for a cleaner UI). Underlying acoustic profiles unchanged.

## v2.2-pro-refinements

- Log now self-clears as a rolling 24h cache (per shoot day), with a 500-event hard cap as backstop.
- Log download is now a branded HTML report (neon theme, logo, formatted table, Print to PDF) instead of plain text; Copy summary still gives quick plain text.
- Added an About / How it works panel (circled-i icon) that names the standards used (EASA ANP, ISO 9613-1, ADS-B, live weather) for trust without revealing how they are combined. Privacy moved into this panel.
- Renamed "Scene / Protected Floor" to "Ambient Noise Floor" (native sound-recordist terminology).
- Selected-mics box (top-left of radar) now hides entirely when no mic models are selected.
- Radar badge relabelled to live-input status ("LIVE: OFF / PHONE MIC / MIXER / MIXER + MIC"), read-only; the control moved into the Mics tab.
- Live Sound Input is now TRUE MULTI-SOURCE: the device mic and a plugged-in mixer can run at the same time as independent toggles, and their readings are fused (mixer weighted higher). Honest framing kept: assist, not a calibrated SPL meter.
- Forecast headline simplified for small screens (e.g. "CLEAR · next in 6:30", "OVERHEAD · clears 0:45") and the repeated "in range" wording removed.

## v2.1-forecast-and-log

- Added a clear-window forecast bar: glanceable readout of how long until a take is at risk, or (when an aircraft is overhead) how long until it clears, projected from currently-tracked traffic. Honestly labelled as a live projection from the aircraft in range.
- Added an automatic contamination log: records each aircraft that crossed the mic threshold (time, callsign/type, peak dBA, duration), survives refreshes, bridges brief feed dropouts so one flyover isn't split, and exports a plain-text summary (copy or download) for handing to a director or post.
- New Log tab; new app.forecast-log.js module. No change to the acoustic engine or verified data.

## v2.0-easa-anp-verified-and-spectral

- Added EASA ANP database v9 verified noise curves for 14 modern aircraft (A320neo, A321neo, A330-900neo, A350-1000, 747-400, 767-300ER, 777-300ER, 787-9, E190-E2, E195-E2, Falcon 900EX, G650ER, plus an A330ceo); retained the legacy A320ceo curve for 15 verified aircraft total.
- Added EASA ANP v9 Spectral Classes (1/3-octave aircraft noise spectra) and per-aircraft, per-frequency atmospheric absorption. Estimated/proxy aircraft now attenuate by their real frequency content; verified curves are not double-counted.
- New app.spectral.js module and data/spectral-classes.json; data/aircraft-noise-profiles.json now carries each verified aircraft's spectral class IDs.
- Added scripts/convert-easa-anp-xlsx.py to regenerate verified data and spectra from the EASA workbooks.
- Fixed audible-aircraft flicker at the contamination threshold with hysteresis (a dead-band so an aircraft hovering at the line reads steadily instead of blinking each refresh).
- Honest scope: v9 covers modern types only; common workhorses (737-800, A320ceo, CRJ, E175, Dash 8, A220) remain clearly-labelled ESTIMATES.

## v1.9-dev-docs

- Added README development commands.
- Documented npm.cmd workflow for PowerShell.
- Documented local check, format, format check, and serve commands.

## v1.8-npm-scripts

- Added package.json.
- Added package-lock.json.
- Added npm scripts for syntax check, formatting, format check, and local server.
- Added .gitignore for node_modules and OS files.

## v1.7-formatted-split-app

- Formatted split app modules with Prettier.
- Added reusable JavaScript syntax check script.
- Confirmed split-file app structure.

## v1.6-wide-logo-pre-refactor

- Added wide transparent Plane Sound logo header.
- Preserved working split app before cleanup/refactor work.

## Earlier v1 updates

- Added verified mic database workflow.
- Added manual mic add/edit/delete controls.
- Added delete confirmation.
- Added custom mic copies for edited built-in mics.
- Removed visible mic tolerance text.
- Delayed CONNECTION LOST message until feed data is stale.
- Improved radar label spacing and range display.
