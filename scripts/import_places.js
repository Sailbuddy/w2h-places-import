import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Liste der erlaubten Felder laut Google Place Details API (für Importzwecke)
const fieldsList = [
  "name",
  "formatted_address",
  "website",
  "url",
  "types",
  "opening_hours",
  "formatted_phone_number",
  "rating",
  "price_level"
];
const fieldsParam = fieldsList.join(',');

// 🔎 Abruf der Live-Daten von Google Places mit geändertem Feld formatted_phone_number
async function fetchGooglePlaceData(placeId, language) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fieldsParam}&language=${language}&key=${apiKey}`;

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

// 🔄 Attribute Mapping laden (key → attribute_id)
async function loadAttributeMapping() {
  const { data, error } = await supabase
    .from('attribute_definitions')
    .select('id, key')
    .eq('is_active', true);

  if (error) {
    throw new Error(`Fehler beim Laden des Attribute-Mappings: ${error.message}`);
  }

  const mapping = {};
  data.forEach(attr => {
    mapping[attr.key] = attr.id;
  });

  return mapping;
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

// 🌍 Sprachvarianten für Name und Beschreibung einfügen (mit attribute_id Mapping)
async function insertLocationValues(locationId, placeDetails, attributeMapping) {
  const languages = ['de', 'en', 'it', 'hr', 'fr'];
  const inserts = [];

  for (const lang of languages) {
    const nameKey = `name_${lang}`;
    const descriptionKey = `description_${lang}`;

    if (placeDetails[nameKey]) {
      const attrId = attributeMapping['name'];
      if (attrId) {
        inserts.push({
          location_id: locationId,
          attribute_id: attrId,
          value_text: placeDetails[nameKey],
          language_code: lang,
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (placeDetails[descriptionKey]) {
      const attrId = attributeMapping['description'];
      if (attrId) {
        inserts.push({
          location_id: locationId,
          attribute_id: attrId,
          value_text: placeDetails[descriptionKey],
          language_code: lang,
          updated_at: new Date().toISOString(),
        });
      }
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

  // Attribute Mapping laden (key → id)
  const attributeMapping = await loadAttributeMapping();

  // Array von Objekten mit placeId und optional preferredName
  const placeEntries = rawData.map(entry => {
    if (typeof entry === 'string') {
      return { placeId: entry, preferredName: null };
    }
    return { placeId: entry.placeId, preferredName: entry.preferredName || null };
  });

  for (const placeEntry of placeEntries) {
    try {
      // Für Sprachen alle Daten abfragen und später speichern
      const placeDetailsDe = await fetchGooglePlaceData(placeEntry.placeId, 'de');
      const placeDetailsEn = await fetchGooglePlaceData(placeEntry.placeId, 'en');
      const placeDetailsIt = await fetchGooglePlaceData(placeEntry.placeId, 'it');
      const placeDetailsHr = await fetchGooglePlaceData(placeEntry.placeId, 'hr');
      const placeDetailsFr = await fetchGooglePlaceData(placeEntry.placeId, 'fr');

      // Location mit preferredName oder Name aus Google einfügen/updaten
      const location = await insertOrUpdateLocation(placeEntry, placeDetailsDe);

      // Sprachvarianten zusammenbauen
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

      await insertLocationValues(location.id, placeDetailsAll, attributeMapping);

    } catch (error) {
      console.error(`❌ Fehler bei Place ID ${placeEntry.placeId}: ${error.message}`);
    }
  }

  console.log('✅ Importlauf abgeschlossen');
}

// ▶️ Start
processPlaces();
