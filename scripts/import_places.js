import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- 1. Google Places Daten holen ---
async function fetchGooglePlaceData(placeId, language) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,website,url,types,opening_hours,formatted_phone_number,rating,price_level&language=${language}&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      console.warn(`Warnung: Fehler beim Abruf der Place Details für Place ID ${placeId} in Sprache ${language}: ${data.status}`);
      console.warn(`API Antwort: ${JSON.stringify(data)}`);
      throw new Error(`Fehler bei Place Details API: ${data.status}`);
    }

    return data.result;
  } catch (err) {
    console.error(`Fehler beim Abruf der Place Details für Place ID ${placeId} in Sprache ${language}: ${err.message}`);
    throw err;
  }
}

// --- Attribute Scan: Rekursive Key-Extraktion ---
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
    category_id: 1, // Beispiel-Kategorie anpassen falls nötig
    key,
    name_de: key,
    description_de: '',
    input_type,
    is_active: false // Neu = inaktiv, manuell aktivieren
  });

  if (error) {
    console.error(`Fehler beim Einfügen von Attribut ${key}: ${error.message}`);
  } else {
    console.log(`Neues Attribut eingefügt: ${key} (${input_type})`);
  }
}

// --- Scan und Insert aller Attribute ---
async function scanAndInsertAttributes(placeId) {
  console.log(`Starte Attribut-Scan für Place ID: ${placeId}`);

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

// 📥 Hauptfunktion zum Einfügen oder Updaten einer Location
async function insertOrUpdateLocation(placeEntry, placeDetails) {
  const displayName = placeEntry.preferredName || placeDetails.name || '(ohne Namen)';

  const { data, error } = await supabase.from('locations').upsert([{
    google_place_id: placeEntry.placeId,
    display_name: displayName,
    address: placeDetails.formatted_address || null,
    website: placeDetails.website || null,
    maps_url: placeDetails.url || null,
    category_id: 9, // Dummy – später anpassen
    phone: placeDetails.formatted_phone_number || null,
    rating: placeDetails.rating || null,
    price_level: placeDetails.price_level || null,
  }], { onConflict: 'google_place_id' }).select().single();

  if (error) {
    throw new Error(`❌ Fehler beim Upsert der Location: ${error.message}`);
  }

  console.log(`✅ Import erfolgreich für Place ID: ${placeEntry.placeId} (${displayName})`);

  return data;
}

// 🌍 Sprachvarianten für Name und Beschreibung einfügen
async function insertLocationValues(locationId, placeDetails) {
  const languages = ['de', 'en', 'it', 'hr', 'fr'];
  const inserts = [];

  for (const lang of languages) {
    const nameKey = `name_${lang}`;
    const descriptionKey = `description_${lang}`;

    if (placeDetails[nameKey]) {
      inserts.push({
        location_id: locationId,
        key: 'name',
        value_text: placeDetails[nameKey],
        language_code: lang,
        updated_at: new Date().toISOString(),
      });
    }

    if (placeDetails[descriptionKey]) {
      inserts.push({
        location_id: locationId,
        key: 'description',
        value_text: placeDetails[descriptionKey],
        language_code: lang,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (inserts.length === 0) return;

  const { error } = await supabase.from('location_values').upsert(inserts);

  if (error) {
    throw new Error(`❌ Fehler beim Einfügen in 'location_values': ${error.message}`);
  }

  console.log(`🌍 Sprachvarianten gespeichert für Location ID ${locationId}`);
}

// 🔁 Verarbeitet alle Place IDs aus JSON-Datei
async function processPlaces() {
  let raw;
  try {
    raw = fs.readFileSync('data/place_ids.json', 'utf-8');
  } catch (err) {
    console.error(`Datei data/place_ids.json nicht gefunden oder kann nicht gelesen werden: ${err.message}`);
    return;
  }

  const rawData = JSON.parse(raw);

  // Array von Objekten mit placeId und optional preferredName
  const placeEntries = rawData.map(entry => {
    if (typeof entry === 'string') {
      return { placeId: entry, preferredName: null };
    }
    return { placeId: entry.placeId, preferredName: entry.preferredName || null };
  });

  for (const placeEntry of placeEntries) {
    try {
      // 1. Attribute scannen und eintragen
      await scanAndInsertAttributes(placeEntry.placeId);

      // 2. Für Sprachen alle Daten abfragen und später speichern
      const placeDetailsDe = await fetchGooglePlaceData(placeEntry.placeId, 'de');
      const placeDetailsEn = await fetchGooglePlaceData(placeEntry.placeId, 'en');
      const placeDetailsIt = await fetchGooglePlaceData(placeEntry.placeId, 'it');
      const placeDetailsHr = await fetchGooglePlaceData(placeEntry.placeId, 'hr');
      const placeDetailsFr = await fetchGooglePlaceData(placeEntry.placeId, 'fr');

      // 3. Location mit preferredName oder Name aus Google einfügen/updaten
      const location = await insertOrUpdateLocation(placeEntry, placeDetailsDe);

      // 4. Sprachvarianten zusammenbauen und speichern
      const placeDetailsAll = {
        name_de: placeDetailsDe.name || null,
        description_de: placeDetailsDe.formatted_address || null,
        name_en: placeDetailsEn.name || null,
        description_en: placeDetailsEn.formatted_address || null,
        name_it: placeDetailsIt.name || null,
        description_it: placeDetailsIt.formatted_address || null,
        name_hr: placeDetailsHr.name || null,
        description_hr: placeDetailsHr.formatted_address || null,
        name_fr: placeDetailsFr.name || null,
        description_fr: placeDetailsFr.formatted_address || null,
      };

      await insertLocationValues(location.id, placeDetailsAll);

    } catch (error) {
      console.error(`❌ Fehler bei Place ID ${placeEntry.placeId}: ${error.message}`);
    }
  }

  console.log('✅ Importlauf abgeschlossen');
}

// ▶️ Start
processPlaces();
