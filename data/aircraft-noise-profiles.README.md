# Aircraft noise profiles — verified data

`data/aircraft-noise-profiles.json` holds VERIFIED aircraft noise curves. When a
tracked aircraft's ICAO type matches a profile here, the engine reads the
received level directly from that aircraft's certified Noise-Power-Distance
(NPD) curve (LAmax dB-A vs slant distance, by thrust setting) and tags it
`VERIFIED NPD` in the UI. Aircraft with no match fall back to the proxy database
and then to estimated class profiles, tagged `PROXY DATA` / `ESTIMATED` with
lower confidence on purpose.

## What's currently verified (15 aircraft)

From the **EASA ANP database v9** (14 modern types):

| ICAO | Aircraft | ICAO | Aircraft |
|------|----------|------|----------|
| A20N | A320neo  | B744 | 747-400 |
| A21N | A321neo  | B763 | 767-300ER |
| A339 | A330-900neo | B77W | 777-300ER |
| A333 | A330 (Trent 772 — see note) | B789 | 787-9 |
| A35K | A350-1000 | E290 | E190-E2 |
| F900 | Falcon 900EX | E295 | E195-E2 |
| GLF6 | Gulfstream G650ER | | |

Plus one retained legacy curve: **A320** (A320ceo, IAE V2527-A5).

**Note on A333:** the v9 entry `A330-743L` (RR Trent 772B, a ceo-generation
engine) was mapped to ICAO `A333` as the most common A330ceo passenger variant.
If you see A330s labelled oddly, this is the mapping to double-check.

**Two A320neo engine variants** exist in v9 (LEAP and PW geared turbofan). ADS-B
reports both as `A20N`, so the louder of the two (the PW variant) carries the
`A20N` code; the other is kept in the file but not auto-matched.

## What is NOT verified (still estimated)

The v9 set is modern types only. Common workhorses are NOT in it and use
estimates: **737-800 / 737 MAX, A320ceo family (A319/A321ceo), CRJ regional
jets, E175, Dash 8 / Q400, A220.** These show as PROXY/ESTIMATED. That's honest:
the app never claims verified accuracy it doesn't have.

## Re-running the converter (when EASA updates the data)

```
pip install openpyxl
python scripts/convert-easa-anp-xlsx.py --npd EASA_ANP_database_NPD_Data_v9.xlsx --acft EASA_ANP_database_Aircraft_v9.xlsx --merge data/aircraft-noise-profiles.json --out data/aircraft-noise-profiles.json
```

It keeps only LAmax rows, takes the loudest power setting per operating mode
(worst case for contamination), converts the ten standard ANP distances from
feet to metres, and attaches ICAO codes from the mapping table inside the
script. It does not invent or alter any noise values.
