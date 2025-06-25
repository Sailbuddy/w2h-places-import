// scripts/extract_place_keys.js
More actions
import axios from 'axios';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// ❗ Diese Variablen müssen mit import_places.js & import_places.yml übereinstimmen:
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // WICHTIG: angepasst für bestehende YML
const supabaseKey = process.env.SUPABASE_KEY;  // Wichtig: NICHT SERVICE_ROLE_KEY
const googleApiKey = process.env.GOOGLE_API_KEY;

if (!supabaseKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.');
if (!googleApiKey) throw new Error('GOOGLE_API_KEY is required.');
if (!supabaseKey) throw new Error('❌ SUPABASE_KEY ist erforderlich.');
if (!googleApiKey) throw new Error('❌ GOOGLE_API_KEY ist erforderlich.');

const supabase = createClient(supabaseUrl, supabaseKey);

// Hilfsfunktionen
// 🔎 Rekursive Key-Extraktion aus einem Objekt
function extractKeys(obj, prefix = '') {
  let keys = [];
  for (const key in obj) {
@@ -29,6 +32,7 @@ function extractKeys(obj, prefix = '') {
  return keys;
}

// 🔧 Typbestimmung
function determineType(obj, keyPath) {
  const keys = keyPath.split('.');
  let val = obj;
@@ -40,23 +44,29 @@ function determineType(obj, keyPath) {
  return 'text';
}

// Place Details von Google abrufen
// 🌐 Google Place Details API aufrufen
async function fetchPlaceDetails(placeId, language = 'de') {
  const fields = 'address_component,adr_address,formatted_address,geometry,icon,name,opening_hours,photos,place_id,plus_code,type,url,vicinity,formatted_phone_number,website,price_level,rating,user_ratings_total';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=${language}&key=${googleApiKey}`;

  const res = await axios.get(url);
  if (res.data.status !== 'OK') throw new Error(`Google API Error: ${res.data.status}`);
  if (res.data.status !== 'OK') throw new Error(`Google API Fehler: ${res.data.status}`);
  return res.data.result;
}

// DB prüfen + einfügen
// 🔐 Attributexistenz prüfen
async function attributeExists(key) {
  const { data, error } = await supabase.from('attribute_definitions').select('key').eq('key', key).single();
  if (error && error.code !== 'PGRST116') throw new Error(`DB check error: ${error.message}`);
  const { data, error } = await supabase
    .from('attribute_definitions')
    .select('key')
    .eq('key', key)
    .single();

  if (error && error.code !== 'PGRST116') throw new Error(`DB-Fehler: ${error.message}`);
  return !!data;
}

// ➕ Attribut einfügen
async function insertAttributeDefinition(key, input_type) {
  const { error } = await supabase.from('attribute_definitions').insert({
    category_id: 1,
@@ -66,18 +76,18 @@ async function insertAttributeDefinition(key, input_type) {
    input_type,
    is_active: false
  });
  if (error) throw new Error(`Insert error: ${error.message}`);
  if (error) throw new Error(`Insert-Fehler: ${error.message}`);
}

// Hauptlogik
// ▶️ Hauptfunktion
async function scanPlaceIdsFromFile(path = 'data/place_ids_archive.json') {
  const raw = await import(`file:///${process.cwd()}/${path}`, {
    assert: { type: 'json' }
  });
  const ids = raw.default.map(e => typeof e === 'string' ? e : e.placeId);

  for (const placeId of ids) {
    console.log(`▶️ Scanning ${placeId}`);
    console.log(`▶️ Scanne ${placeId}`);
    try {
      const details = await fetchPlaceDetails(placeId);
      const keys = extractKeys(details);
@@ -86,15 +96,15 @@ async function scanPlaceIdsFromFile(path = 'data/place_ids_archive.json') {
        if (!(await attributeExists(key))) {
          const type = determineType(details, key);
          await insertAttributeDefinition(key, type);
          console.log(`➕ ${key} (${type})`);
          console.log(`➕ Neues Attribut: ${key} (${type})`);
        }
      }
    } catch (err) {
      console.error(`⚠️ Fehler bei ${placeId}: ${err.message}`);
    }
  }

  console.log('✅ Alle Attribute geprüft und ggf. ergänzt.');
  console.log('✅ Attributscan abgeschlossen.');
}

scanPlaceIdsFromFile().catch(console.error);
