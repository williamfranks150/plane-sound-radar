'use strict';

const D2R=Math.PI/180;
const KM_PER_LAT=111.32;
const NM_TO_KM=1.852;
const FT_PER_M=3.28084;
const SOUND_SPEED=343;
const REFRESH_MS=8000;
const SWEEP_SPEED=44;

const STORE_LOC='aircraftRadar.loc.v10';
const STORE_SETTINGS='aircraftRadar.settings.v14';
const STORE_UI='aircraftRadar.ui.v14';
const STORE_CUSTOM='aircraftRadar.customMics.v14';
const STORE_HIDDEN='aircraftRadar.hiddenMics.v28';
const MIC_LOOKUP_ENDPOINT=(window.APP_CONFIG&&window.APP_CONFIG.MIC_LOOKUP_ENDPOINT)||'';
const GEOCODE_ENDPOINT=(window.APP_CONFIG&&window.APP_CONFIG.GEOCODE_ENDPOINT)||'';
const AIRCRAFT_ENDPOINT=(window.APP_CONFIG&&window.APP_CONFIG.AIRCRAFT_ENDPOINT)||'';
const SAME_ORIGIN_MIC_DB='mic-specs.json';
