import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 🔎 Abruf der Live-Daten von Google Places
async function fetchGooglePlaceData(placeId, lang = 'de') {
  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,formatted_address,website,url,types,opening_hours,formatted_phone_number,rating,price_level&language=${lang}&key=${apiKey}`;

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
    opening_hours: result.opening_hours || null,
    phone_number: result.formatted_phone_number || null,
    rating: result.rating || null,
    price_level: result.price_level || null
  };
}

// 📥 Hauptfunktion zum Einfügen einer Location
async function insertLocation(placeId) {
  const placeDetails = await fetchGooglePlaceData(placeId);

  const categoryId = 9; // Dummy – später anpassen oder automatisch bestimmen

  const { data, error } = await supabase.from('locations').upsert({
    google_place_id: placeId,
    display_name: placeDetails.name,
    name_de: placeDetails.name,
    address: placeDetails.address,
    website: placeDetails.website,
    maps_url: placeDetails.maps_url,
    category_id: categoryId,
    rating: placeDetails.rating,
    price_level: placeDetails.price_level,
    phone: placeDetails.phone_number
  }, { onConflict: 'google_place_id' }).select().single();

  if (error) {
    throw new Error(`❌ Fehler beim Upsert in 'locations': ${error.message}`);
  }

  console.log(`✅ Ort eingefügt/aktualisiert: ${placeDetails.name}`);
  return data;
}

// 🌍 Einfügen der Sprachvarianten (Platzhalter)
async function insertLocationValues(locationId, translations) {
  // Lösche ggf. bestehende Einträge für diese Location und Sprachen vor dem Einfügen
  await supabase.from('location_values').delete().eq('location_id', locationId);

  const inserts = [];

  for (const [lang, name] of Object.entries(translations)) {
    inserts.push({
      location_id: locationId,
      lang: lang,
      name: name
    });
  }

  const { error } = await supabase.from('location_values').insert(inserts);

  if (error) {
    throw new Error(`❌ Fehler beim Einfügen in 'location_values': ${error.message}`);
  }

  console.log(`🌍 Sprachvarianten gespeichert für Location ID ${locationId}`);
}

// 🔁 Verarbeitet alle Place IDs aus JSON-Datei
async function processPlaces() {
  const raw = fs.readFileSync('data/place_ids.json');
  const placeIds = JSON.parse(raw);

  for (const placeId of placeIds) {
    try {
      const location = await insertLocation(placeId);

      await insertLocationValues(location.id, {
        de: location.name_de,
        en: location.name_en || location.name_de,
        hr: location.name_hr || location.name_de,
        it: location.name_it || location.name_de,
        fr: location.name_fr || location.name_de
      });

    } catch (error) {
      console.error(error.message);
    }
  }

  console.log('✅ Importlauf abgeschlossen');
}

// ▶️ Start
processPlaces();
