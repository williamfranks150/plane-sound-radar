# Getting the full verified aircraft dataset (one-time, ~20 min)

Your app already ships with verified ANP data for the A320 and accurate
type-based estimates for everything else. This adds verified certified curves
for the rest of the common fleet. You do NOT need a Mac. You do this once.

## Step 1 — Request the EASA ANP data (free)

1. Go to: https://www.easa.europa.eu/en/domains/environment/policy-support-and-research/aircraft-noise-and-performance-anp-data
2. Click the **ANP Data request form**.
3. State your need: noise-modelling tool that predicts aircraft-noise
   contamination of audio recordings (this qualifies under Reg. (EU) 598/2014
   Article 7(3) — "modelling purposes").
4. They email you the database (Excel workbook with an NPD_data sheet).

## Step 2 — Export the NPD table to CSV

Open the workbook, find the **NPD_data** sheet, Save As / Export that sheet to
CSV. You'll get columns like:
`NPD_ID;Noise Metric;Op Mode;Power Setting;L_200ft;...;L_25000ft`
(semicolon-separated is fine — the converter handles it.)

Save it as `NPD_data.csv` in your project's `scripts\` folder.

## Step 3 — Map the aircraft you care about (optional but recommended)

ADS-B reports ICAO type codes (B738, A320, E190...). ANP uses its own ids
(737800, V2527A...). Make a tiny file `scripts\icao-map.csv`:

```
ICAO,ANPID
A320,V2527A
A319,V2522A
A321,V2530A
B738,CFM567B
B739,CFM567B
A20N,LEAP1A26
E190,CF348E
```

Add rows for whatever flies over your locations. The ANP workbook's Aircraft
table lists every ANP_ID so you can match them. Types you don't map still
import; they just won't auto-attach to live traffic until mapped.

## Step 4 — Run the converter (one command, in PowerShell)

From your project root:

```powershell
node scripts\convert-anp-npd.js scripts\NPD_data.csv scripts\icao-map.csv > data\aircraft-noise-profiles.json
```

Done. Hard-reload the app. Every mapped aircraft now reads off certified
curves and shows the VERIFIED NPD tag with high confidence. Everything you
didn't map keeps using the accurate estimates — nothing breaks.

## What the converter does (so you can explain it)

It keeps only the LAmax (A-weighted maximum level) rows, converts the ten
standard slant distances from feet to metres, picks the loudest thrust setting
per flight phase (worst-case = the one most likely to contaminate), and writes
them into the app's schema. It does not invent or alter any values — it only
reshapes the real EUROCONTROL/EASA rows.