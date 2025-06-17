import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Liste der erlaubten Felder laut Google Place Details API
const fieldsList = [
  "address_component",
  "adr_address",
  "alt_id",
  "formatted_address",
  "geometry",
  "icon",
  "name",
  "permanently_closed",
  "photo",
  "place_id",
  "plus_code",
  "type",
  "url",
  "utc_offset",
  "vicinity",
  "formatted_phone_number",
  "opening_hours",
  "website",
  "price_level",
  "rating",
  "review",
  "user_ratings_total"
];

const fieldsParam = fieldsList.join(',');

// --- Google Places Daten holen (mit expliziten Feldern) ---
async function fetchGooglePlaceData(placeId, language = 'de') {
  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fieldsParam}&language=${language}&key=${apiKey}`;

  console.log(`Request URL: ${url}`);

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK') {
    console.error(`API Antwort bei Fehler: ${JSON.stringify(data)}`);
    throw new Error(`Fehler beim Abruf der Place Details: ${data.status}`);
  }

  return data.result;
}

// --- Rekursive Key-Extraktion aus Objekt ---
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

// --- Datentyp bestimmen ---
function determineType(obj, keyPath) {
  const keys = keyPath.split('.');
  let val = obj;
  for (const k of keys) {
    val = val ? val[k] : undefined;
  }
  if (val === null || val === undefined) return 'text';

  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'number') return 'number';
  if (typeof val === 'object') return 'json';

  return 'text';
}

// --- Prüfen ob Attribut existiert ---
async function attributeExists(key) {
  const { data, error } = await supabase
    .from('attribute_definitions')
    .select('key')
    .eq('key', key)
    .single();

  if (error && error.code !== 'PGRST116') { // 'No rows found' error
    throw new Error(`DB Fehler beim Prüfen von Attribut ${key}: ${error.message}`);
  }
  return !!data;
}

// --- Neues Attribut anlegen ---
async function insertAttributeDefinition(key, input_type) {
  const { error } = await supabase.from('attribute_definitions').insert({
    category_id: 1,
    key,
    name_de: key,
    description_de: '',
    input_type,
    is_active: false
  });

  if (error) {
    console.error(`Fehler beim Einfügen von Attribut ${key}: ${error.message}`);
  } else {
    console.log(`Neues Attribut eingefügt: ${key} (${input_type})`);
  }
}

// --- Hauptfunktion für mehrere Place IDs ---
async function scanAttributesFromJsonFile(jsonPath = 'data/place_ids_archive.json') {
  let raw;
  try {
    raw = fs.readFileSync(jsonPath, 'utf-8');
  } catch (err) {
    console.error(`Datei ${jsonPath} nicht gefunden oder kann nicht gelesen werden: ${err.message}`);
    return;
  }

  const rawData = JSON.parse(raw);
  // Erwarte Array von Place IDs (strings) oder Objekte mit placeId
  const placeIds = rawData.map(entry => (typeof entry === 'string') ? entry : entry.placeId);

  for (const placeId of placeIds) {
    console.log(`\n=== Starte Scan für Place ID: ${placeId} ===`);
    try {
      const placeDetails = await fetchGooglePlaceData(placeId);
      const keys = extractKeys(placeDetails);

      for (const key of keys) {
        const exists = await attributeExists(key);
        if (!exists) {
          const input_type = determineType(placeDetails, key);
          await insertAttributeDefinition(key, input_type);
        }
      }
      console.log(`Scan und Eintrag abgeschlossen für Place ID: ${placeId}`);
    } catch (error) {
      console.error(`Fehler beim Scan für Place ID ${placeId}: ${error.message}`);
    }
  }

  console.log('\n✅ Attribut-Import für alle Place IDs abgeschlossen!');
}

// ▶️ Start (kann direkt so ausgeführt werden)
scanAttributesFromJsonFile()
  .then(() => console.log('Fertig!'))
  .catch(console.error);
