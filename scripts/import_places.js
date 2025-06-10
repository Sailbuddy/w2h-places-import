import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 🔎 Abruf der Live-Daten von Google Places
async function fetchGooglePlaceData(placeId) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,website,url,types,opening_hours&language=de&key=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK') {
    throw new Error(`❌ Fehler beim Abruf der Place Details: ${data.status}`);
  }

  const result = data.result;

  return {
    name: result.name || '(ohne Namen)',
    address: result.formatted_address || '(keine Adresse)',
    website: result.website || null,
    maps_url: result.url || null,
    types: result.types || [],
    opening_hours: result.opening_hours || null
  };
}

// 📥 Hauptfunktion zum Einfügen einer Location
async function insertLocation(placeId) {
  const placeDetails = await fetchGooglePlaceData(placeId);

  const categoryId = 9; // Dummy – wird später durch echte Logik ersetzt

  const { data, error } = await supabase.from('locations').insert([{
    place_id: placeId,
    display_name: placeDetails.name,
    address: placeDetails.address,
    website: placeDetails.website,
    maps_url: placeDetails.maps_url,
    category_id: categoryId,
    opening_hours: placeDetails.opening_hours ? JSON.stringify(placeDetails.opening_hours) : null
  }]).select().single();

  if (error) {
    throw new Error(`❌ Fehler beim Einfügen in 'locations': ${error.message}`);
  }

  console.log(`✅ Ort eingefügt: ${placeDetails.name}`);
  return data;
}

// 🌍 Einfügen der Sprachvarianten (Platzhalter)
async function insertLocationValues(locationId, translations) {
  const { error } = await supabase.from('location_values').insert([
    {
      location_id: locationId,
      lang: 'de',
      name: translations.de
    },
    {
      location_id: locationId,
      lang: 'en',
      name: translations.en
    },
    {
      location_id: locationId,
      lang: 'hr',
      name: translations.hr
    },
    {
      location_id: locationId,
      lang: 'it',
      name: translations.it
    }
  ]);

  if (error) {
    throw new Error(`❌ Fehler beim Einfügen in 'location_values': ${error.message}`);
  }

  console.log(`🌍 Sprachvarianten gespeichert`);
}

// 🔁 Verarbeitet alle Place IDs aus JSON-Datei (steuerbar über Umgebungsvariable)
async function processPlaces() {
  const inputFile = process.env.PLACE_IDS_FILE || 'place_ids.json';

  if (!fs.existsSync(inputFile)) {
    throw new Error(`❌ Datei ${inputFile} nicht gefunden.`);
  }

  const raw = fs.readFileSync(inputFile);
  const placeIds = JSON.parse(raw);

  for (const placeId of placeIds) {
    try {
      const location = await insertLocation(placeId);

      await insertLocationValues(location.id, {
        de: location.display_name,
        en: location.display_name,
        hr: location.display_name,
        it: location.display_name
      });

    } catch (error) {
      console.error(error.message);
    }
  }

  console.log(`✅ Importlauf abgeschlossen für Datei: ${inputFile}`);
}

// ▶️ Start
processPlaces();
