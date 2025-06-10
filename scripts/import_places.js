import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Hilfsfunktion: Sprachen, die du unterstützt
const supportedLangs = ['de', 'en', 'it', 'hr', 'fr'];

// Abruf der Google Places-Daten (mit mehreren Sprachen)
async function fetchGooglePlaceData(placeId, lang) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,website,url,types,opening_hours,phone_number,rating,price_level&language=${lang}&key=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK') {
    throw new Error(`Fehler beim Abruf der Place Details für Sprache ${lang}: ${data.status}`);
  }

  return data.result;
}

// Einfügen oder Updaten der Location mit festen Spalten
async function upsertLocation(placeId, placeDetailsByLang) {
  // Extrahiere aus placeDetailsByLang die festen Felder je Sprache
  const locationData = {
    google_place_id: placeId,
    category_id: 9, // Dummy, anpassen wenn Logik fertig
    name_de: placeDetailsByLang.de?.name || null,
    name_en: placeDetailsByLang.en?.name || null,
    name_it: placeDetailsByLang.it?.name || null,
    name_hr: placeDetailsByLang.hr?.name || null,
    name_fr: placeDetailsByLang.fr?.name || null,
    description_de: placeDetailsByLang.de?.formatted_address || null,
    description_en: placeDetailsByLang.en?.formatted_address || null,
    description_it: placeDetailsByLang.it?.formatted_address || null,
    description_hr: placeDetailsByLang.hr?.formatted_address || null,
    description_fr: placeDetailsByLang.fr?.formatted_address || null,
    address: placeDetailsByLang.de?.formatted_address || null,
    phone: placeDetailsByLang.de?.phone_number || null,
    website: placeDetailsByLang.de?.website || null,
    rating: placeDetailsByLang.de?.rating || null,
    price_level: placeDetailsByLang.de?.price_level || null,
    maps_url: placeDetailsByLang.de?.url || null
  };

  // Upsert in locations (insert oder update falls google_place_id schon existiert)
  const { data, error } = await supabase
    .from('locations')
    .upsert(locationData, { onConflict: 'google_place_id' })
    .select()
    .single();

  if (error) {
    throw new Error(`Fehler beim Upsert der Location: ${error.message}`);
  }

  return data;
}

// Flexible Attribute (alle Sprachen) in location_values speichern
async function insertLocationAttributes(locationId, placeDetailsByLang) {
  for (const lang of supportedLangs) {
    const placeDetails = placeDetailsByLang[lang];
    if (!placeDetails) continue;

    // Hier Beispiel für dynamisches Einfügen einiger Attribute (erweitern nach Bedarf)
    const attributesToSave = {
      opening_hours: placeDetails.opening_hours ? JSON.stringify(placeDetails.opening_hours) : null,
      // weitere dynamische Attribute hier ergänzen ...
    };

    for (const [key, value] of Object.entries(attributesToSave)) {
      if (value === null) continue;

      // Insert oder Update in location_values, je nach Schema anpassen
      const { error } = await supabase.from('location_values').upsert({
        location_id: locationId,
        key,
        value_text: value,
        language_code: lang
      }, { onConflict: ['location_id', 'key', 'language_code'] });

      if (error) {
        console.error(`Fehler beim Speichern von ${key} für Sprache ${lang}: ${error.message}`);
      }
    }
  }
}

// Hauptfunktion: verarbeitet Place IDs, holt mehrsprachige Daten, speichert Location + Attribute
async function processPlaces() {
  const inputFile = process.env.PLACE_IDS_FILE || 'place_ids.json';
  const fullPath = `data/${inputFile}`;

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Datei ${fullPath} nicht gefunden.`);
  }

  const raw = fs.readFileSync(fullPath);
  const placeIds = JSON.parse(raw);

  for (const placeId of placeIds) {
    try {
      // Für jede Sprache Place Details holen
      const placeDetailsByLang = {};
      for (const lang of supportedLangs) {
        try {
          placeDetailsByLang[lang] = await fetchGooglePlaceData(placeId, lang);
        } catch (e) {
          console.warn(`Warnung: Keine Daten für ${placeId} in Sprache ${lang}: ${e.message}`);
        }
      }

      // Location upserten
      const location = await upsertLocation(placeId, placeDetailsByLang);

      // Sprachvarianten für Name in location_values (optional, je nach Schema)
      for (const lang of supportedLangs) {
        if (!placeDetailsByLang[lang]) continue;
        const { error } = await supabase.from('location_values').upsert({
          location_id: location.id,
          key: 'display_name',
          value_text: placeDetailsByLang[lang].name,
          language_code: lang
        }, { onConflict: ['location_id', 'key', 'language_code'] });
        if (error) {
          console.error(`Fehler beim Speichern display_name für ${lang}: ${error.message}`);
        }
      }

      // Flexible Attribute speichern
      await insertLocationAttributes(location.id, placeDetailsByLang);

      console.log(`✅ Import erfolgreich für Place ID: ${placeId}`);
    } catch (error) {
      console.error(`❌ Fehler bei Place ID ${placeId}: ${error.message}`);
    }
  }
}

// ▶️ Start
processPlaces();
