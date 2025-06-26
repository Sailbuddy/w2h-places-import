// scripts/fill_names_and_descriptions.js

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const googleApiKey = process.env.GOOGLE_API_KEY;

if (!supabaseUrl || !supabaseKey || !googleApiKey) {
  throw new Error('❌ SUPABASE_URL, SUPABASE_KEY und GOOGLE_API_KEY sind erforderlich.');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const languages = ['de', 'en', 'fr', 'it', 'hr'];

async function fetchGoogleData(placeId, language) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&language=${language}&fields=name,editorial_summary&key=${googleApiKey}`;
  try {
    const response = await axios.get(url);
    if (response.data.status !== 'OK') {
      console.warn(`⚠️ Google API-Fehler bei ${placeId} (${language}): ${response.data.status}`);
      return null;
    }
    return response.data.result;
  } catch (err) {
    console.warn(`❌ Netzwerkfehler bei ${placeId} (${language}): ${err.message}`);
    return null;
  }
}

async function updateLocation(id, updates) {
  const { error } = await supabase
    .from('locations')
    .update(updates)
    .eq('id', id);

  if (error) {
    console.error(`❌ Fehler beim Aktualisieren von Location ID ${id}: ${error.message}`);
  }
}

async function main() {
  const { data: locations, error } = await supabase
    .from('locations')
    .select('id, google_place_id');

  if (error) throw new Error(`❌ Fehler beim Abruf der Locations: ${error.message}`);

  for (const location of locations) {
    const placeId = location.google_place_id;
    const updates = {};

    for (const lang of languages) {
      const result = await fetchGoogleData(placeId, lang);
      if (!result) continue;

      const nameField = `name_${lang}`;
      const descField = `description_${lang}`;

      if (result.name) {
        updates[nameField] = result.name;
      }

      if (result.editorial_summary?.overview) {
        updates[descField] = result.editorial_summary.overview;
      }
    }

    if (Object.keys(updates).length > 0) {
      await updateLocation(location.id, updates);
      console.log(`✅ Aktualisiert: ${placeId}`);
    } else {
      console.log(`➖ Keine Änderungen für: ${placeId}`);
    }
  }

  console.log('🎉 Name + Beschreibung Import abgeschlossen.');
}

main().catch((err) => console.error('❌ Hauptfehler:', err));
