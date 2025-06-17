import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

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

// --- 1. Google Places Daten holen (mit expliziten Feldern) ---
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

// --- 2. Rekursive Key-Extraktion aus Objekt ---
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

// Hilfsfunktion, um options als JSON zu erzeugen, wenn Wert Objekt oder Array ist
function getOptionsValue(obj, keyPath) {
  const keys = keyPath.split('.');
  let val = obj;
  for (const k of keys) {
    val = val ? val[k] : undefined;
  }
  if (val && typeof val === 'object') {
    return JSON.stringify(val);
  }
  return null;
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
async function insertAttributeDefinition(key, input_type, placeDetails, keys) {
  // Mehrsprachige Namen und Beschreibungen aus placeDetails holen (wenn vorhanden)
  // Wir nehmen die erste vorhandene Sprache, die im keys Array für name/description vorkommt
  function findLocalizedValue(baseKey) {
    const languages = ['de', 'en', 'it', 'hr', 'fr'];
    for (const lang of languages) {
      const keyName = `${baseKey}_${lang}`;
      if (keys.includes(keyName) && placeDetails[keyName]) {
        return placeDetails[keyName];
      }
    }
    return '';
  }

  const nameDe = findLocalizedValue('name');
  const descriptionDe = findLocalizedValue('description');

  const nameEn = placeDetails['name_en'] || '';
  const descriptionEn = placeDetails['description_en'] || '';
  const nameIt = placeDetails['name_it'] || '';
  const descriptionIt = placeDetails['description_it'] || '';
  const nameHr = placeDetails['name_hr'] || '';
  const descriptionHr = placeDetails['description_hr'] || '';
  const nameFr = placeDetails['name_fr'] || '';
  const descriptionFr = placeDetails['description_fr'] || '';

  const optionsValue = getOptionsValue(placeDetails, key);

  const { error } = await supabase.from('attribute_definitions').insert({
    category_id: 1, // Beispiel-Kategorie anpassen falls nötig
    key,
    name_de: nameDe || key,
    description_de: descriptionDe || '',
    name_en: nameEn,
    description_en: descriptionEn,
    name_it: nameIt,
    description_it: descriptionIt,
    name_hr: nameHr,
    description_hr: descriptionHr,
    name_fr: nameFr,
    description_fr: descriptionFr,
    input_type,
    options: optionsValue,
    is_active: false // Neu = inaktiv, manuell aktivieren
  });

  if (error) {
    console.error(`Fehler beim Einfügen von Attribut ${key}: ${error.message}`);
  } else {
    console.log(`Neues Attribut eingefügt: ${key} (${input_type})`);
  }
}

// --- 6. Hauptfunktion ---
async function scanAndInsertAttributes() {
  // Lese Place ID aus Environment oder CLI Argument ein
  const placeIdFromEnv = process.env.PLACE_ID;
  const placeIdFromArg = process.argv[2]; // z.B. "node import_attribute_definitions.js PLACE_ID"

  const placeId = placeIdFromArg || placeIdFromEnv;
  if (!placeId) {
    console.error('❌ Keine Place ID angegeben. Bitte als ENV PLACE_ID oder CLI Argument übergeben.');
    process.exit(1);
  }

  console.log(`Starte Scan für Place ID: ${placeId}`);

  try {
    const placeDetails = await fetchGooglePlaceData(placeId);
    const keys = extractKeys(placeDetails);

    for (const key of keys) {
      const exists = await attributeExists(key);
      if (!exists) {
        const input_type = determineType(placeDetails, key);
        await insertAttributeDefinition(key, input_type, placeDetails, keys);
      }
    }

    console.log(`Scan und Eintrag abgeschlossen für Place ID: ${placeId}`);
  } catch (error) {
    console.error(`Fehler beim Scan für Place ID ${placeId}: ${error.message}`);
  }
}

// Starten
scanAndInsertAttributes()
  .then(() => console.log('✅ Attribute Import fertig!'))
  .catch(console.error);
