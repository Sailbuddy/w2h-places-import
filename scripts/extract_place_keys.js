// scripts/extract_place_keys.js

import axios from 'axios';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// ❗ Diese Variablen müssen mit import_places.js & import_places.yml übereinstimmen:
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;  // Wichtig: NICHT SERVICE_ROLE_KEY
const googleApiKey = process.env.GOOGLE_API_KEY;

if (!supabaseKey) throw new Error('❌ SUPABASE_KEY ist erforderlich.');
if (!googleApiKey) throw new Error('❌ GOOGLE_API_KEY ist erforderlich.');

const supabase = createClient(supabaseUrl, supabaseKey);

// 🔎 Rekursive Key-Extraktion aus einem Objekt
function extractKeys(obj, prefix = '') {
  let keys = [];
  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;
    const value = obj[key];
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys = keys.concat(extractKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

// 🔧 Typbestimmung
function determineType(obj, keyPath) {
  const keys = keyPath.split('.');
  let val = obj;
  for (const k of keys) val = val?.[k];
  if (val === null || val === undefined) return 'text';
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'number') return 'number';
  if (typeof val === 'object') return 'json';
  return 'text';
}

// 🌐 Google Place Details API aufrufen
async function fetchPlaceDetails(placeId, language = 'de') {
  const fields = 'address_component,adr_address,formatted_address,geometry,icon,name,opening_hours,photos,place_id,plus_code,type,url,vicinity,formatted_phone_number,website,price_level,rating,user_ratings_total';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=${language}&key=${googleApiKey}`;

  const res = await axios.get(url);
  if (res.data.status !== 'OK') throw new Error(`Google API Fehler: ${res.data.status}`);
  return res.data.result;
}

// 🔐 Attributexistenz prüfen
async function attributeExists(key) {
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
    key,
    name_de: key,
    description_de: '',
    input_type,
    is_active: false
  });
  if (error) throw new Error(`Insert-Fehler: ${error.message}`);
}

// ▶️ Hauptfunktion
async function scanPlaceIdsFromFile(path = 'data/place_ids_archive.json') {
  const raw = await import(`file:///${process.cwd()}/${path}`, {
    assert: { type: 'json' }
  });
  const ids = raw.default.map(e => typeof e === 'string' ? e : e.placeId);

  for (const placeId of ids) {
    console.log(`▶️ Scanne ${placeId}`);
    try {
      const details = await fetchPlaceDetails(placeId);
      const keys = extractKeys(details);

      for (const key of keys) {
        if (!(await attributeExists(key))) {
          const type = determineType(details, key);
          await insertAttributeDefinition(key, type);
          console.log(`➕ Neues Attribut: ${key} (${type})`);
        }
      }
    } catch (err) {
      console.error(`⚠️ Fehler bei ${placeId}: ${err.message}`);
    }
  }

  console.log('✅ Attributscan abgeschlossen.');
}

scanPlaceIdsFromFile().catch(console.error);
