import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- 1. Google Places Daten holen ---
async function fetchGooglePlaceData(placeId) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=*&language=de&key=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK') {
    throw new Error(`Fehler beim Abruf der Place Details: ${data.status}`);
  }

  return data.result;
}

// --- 2. Rekursive Key-Extraktion ---
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

// --- 3. Datentyp bestimmen ---
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

// --- 4. Prüfen ob Attribut existiert ---
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

// --- 5. Neues Attribut anlegen ---
async function insertAttributeDefinition(key, input_type) {
  const { error } = await supabase.from('attribute_definitions').insert({
    category_id: 1, // Beispiel-Kategorie, anpassen falls nötig
    key,
    name_de: key,
    description_de: '',
    name_en: key,
    description_en: '',
    name_it: key,
    description_it: '',
    name_hr: key,
    description_hr: '',
    name_fr: key,
    description_fr: '',
    input_type,
    is_active: false // Neu = inaktiv
  });

  if (error) {
    console.error(`Fehler beim Einfügen von Attribut ${key}: ${error.message}`);
  } else {
    console.log(`Neues Attribut eingefügt: ${key} (${input_type})`);
  }
}

// --- 6. Hauptfunktion ---
async function scanAndInsertAttributes(placeId) {
  console.log(`Starte Scan für Place ID: ${placeId}`);

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
}

// Beispiel-Aufruf (Place ID anpassen)
const examplePlaceId = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

scanAndInsertAttributes(examplePlaceId)
  .then(() => console.log('Fertig!'))
  .catch(console.error);
