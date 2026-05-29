# Aircraft noise profiles — verified NPD ingest

`data/aircraft-noise-profiles.json` holds VERIFIED aircraft noise data. When a
tracked aircraft's ICAO type matches a profile here that carries an `npd`
block, the acoustic engine reads the received level directly from the
Noise-Power-Distance curve (Lmax dB-A vs slant distance, by thrust setting).
That path is tagged `VERIFIED NPD` in the UI and is the most accurate source.

Profiles without a match fall back to the proxy DB
(`aircraft-type-profiles.json`) and then to estimated class profiles. Those are
tagged `PROXY DATA` / `ESTIMATED` and carry lower confidence on purpose.

## Getting real data

You qualify as a modelling user under Reg. (EU) 598/2014 Art. 7(3). Request the
EASA ANP data (or download the legacy EUROCONTROL ANP v2.3 set) and export the
`NPD_data` table to CSV. You want the LAMAX rows.

## Converting

```
node scripts/convert-anp-npd.js path\to\NPD_data.csv path\to\ICAO_to_ANPID.csv > data\aircraft-noise-profiles.json
```

- `NPD_data.csv` — the ANP NPD table. The converter auto-detects the descriptor
  column by its values (it keeps LAMAX rows), the ANP-id column, the
  operation-mode column (A/D), and the ten standard distance columns
  (200..25000 ft, converted to metres).
- `ICAO_to_ANPID.csv` — a two-column map `ICAO,ANPID` (e.g. `B738,737800`) so the
  curves attach to the type codes ADS-B reports. Build it for the types you care
  about; rows without a mapping are still imported but won't match live traffic
  until mapped.

## Schema

```json
{
  "schema": "plane-sound-aircraft-noise-profiles-v1",
  "mode": "verified-data-required",
  "sources": [ { "name": "...", "metric": "LAMAX", "note": "..." } ],
  "profiles": [
    {
      "sourceType": "verified",
      "label": "737800",
      "aircraftTypeCodes": ["B738"],
      "anpId": "737800",
      "confidence": 0.85,
      "npd": {
        "refMetric": "Lmax_dBA",
        "thrust": [
          { "setting": "departure", "points": [ { "distM": 61, "dba": 99.2 }, ... ] },
          { "setting": "approach",  "points": [ { "distM": 61, "dba": 94.1 }, ... ] }
        ]
      }
    }
  ]
}
```

The engine selects the thrust column by inferred flight regime (departure/climb
→ departure column; approach/descent → approach column; level/cruise → cruise),
interpolates Lmax linearly in log10(distance), and only adds the live refraction
correction on top — it does NOT re-apply spreading, because the NPD curve
already includes it.