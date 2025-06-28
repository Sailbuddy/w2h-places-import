// scripts/import_attribute_definitions.js

import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const fieldsList = [
  "address_component", "adr_address", "alt_id", "formatted_address", "geometry", "icon", "name",
  "permanently_closed", "photo", "place_id", "plus_code", "type", "url", "utc_offset", "vicinity",
  "formatted_phone_number", "opening_hours", "website", "price_level", "rating", "review", "user_ratings_total"
];
const fieldsParam = fieldsList.join(',');

// --- Google Places Daten holen ---
async function fetchGooglePlaceData(placeId, language = 'de') {
  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fieldsParam}&language=${language}&key=${apiKey}`;

  console.log(`➡️  Scan für: ${placeId}`);
  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK') {
    console.error(`⚠️ API Antwortfehler: ${JSON.stringify(data)}`);
    throw new Error(`Fehler bei Place Details: ${data.status}`);
  }

  return data.result;
}

// --- Schlüssel extrahieren ---
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

// --- Typ bestimmen ---
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

// --- Attribut prüfen ---
async function attributeExists(key) {
  const { data, error } = await supabase
    .from('attribute_definitions')
    .select('key')
    .eq('key', key)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`❌ DB Fehler bei Attribut-Check (${key}): ${error.message}`);
  }
  return !!data;
}

// --- Attribut einfügen ---
async function insertAttributeDefinition(key, input_type, category_id) {
  const { error } = await supabase.from('attribute_definitions').insert({
    category_id,
    key,
    name_de: key,
    description_de: '',
    input_type,
    is_active: false
  });

  if (error) {
    console.error(`❌ Fehler bei Insert ${key}: ${error.message}`);
  } else {
    console.log(`✅ Neues Attribut: ${key} (${input_type}) für Kategorie ${category_id}`);
  }
}

// --- Kategorie-Mapping laden ---
function loadCategoryMap(path = 'data/place_categories.json') {
  try {
    const raw = fs.readFileSync(path, 'utf-8');
    const array = JSON.parse(raw);
    return Object.fromEntries(array.map(entry => [entry.place_id, entry.category_id]));
  } catch (err) {
    console.error(`❌ Fehler beim Laden von place_categories.json: ${err.message}`);
    return {};
  }
}

// --- Hauptfunktion ---
async function scanAttributesFromJsonFile(jsonPath = 'data/place_ids_archive.json') {
  let raw;
  try {
    raw = fs.readFileSync(jsonPath, 'utf-8');
  } catch (err) {
    console.error(`❌ Datei nicht lesbar (${jsonPath}): ${err.message}`);
    return;
  }

  let rawData;
  try {
    rawData = JSON.parse(raw);
  } catch (e) {
    console.error(`❌ JSON Parse-Fehler: ${e.message}`);
    return;
  }

  const categoryMap = loadCategoryMap('data/place_categories.json');
  const placeIds = rawData.map(entry => typeof entry === 'string' ? entry : entry.placeId);

  for (const placeId of placeIds) {
    const category_id = categoryMap[placeId];
    if (!category_id) {
      console.warn(`⚠️ Keine Kategorie für ${placeId} – Attributzuordnung übersprungen.`);
      continue;
    }

    try {
      const details = await fetchGooglePlaceData(placeId);
      const keys = extractKeys(details);

      for (const key of keys) {
        const exists = await attributeExists(key);
        if (!exists) {
          const type = determineType(details, key);
          await insertAttributeDefinition(key, type, category_id);
        }
      }

      console.log(`✔️ Fertig mit ${placeId}`);
    } catch (error) {
      console.error(`❌ Fehler bei ${placeId}: ${error.message}`);
    }
  }

  console.log('\n🎉 Attributscan abgeschlossen!');
}

// ▶️ Ausführung starten
const inputPath = process.argv[2] || 'data/place_ids_archive.json';
scanAttributesFromJsonFile(inputPath).catch(console.error);
