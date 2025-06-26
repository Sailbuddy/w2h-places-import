// scripts/fill_names_and_descriptions.js

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const googleApiKey = process.env.GOOGLE_API_KEY;

if (!supabaseUrl || !supabaseKey || !googleApiKey) {
  throw new Error('SUPABASE_URL, SUPABASE_KEY und GOOGLE_API_KEY sind erforderlich.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const languages = ['de', 'en', 'fr', 'it', 'hr'];

async function fetchGoogleData(placeId, language) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&language=${language}&key=${googleApiKey}`;
  const response = await axios.get(url);
  return response.data?.result;
}

async function updateLocation(id, updates) {
  const { error } = await supabase
    .from('locations')
    .update(updates)
    .eq('id', id);

  if (error) {
    console.error(`❌ Fehler beim Aktualisieren von ID ${id}:`, error.message);
  }
}

async function main() {
  const { data, error } = await supabase
    .from('locations')
    .select('id, google_place_id');

  if (error) throw error;

  for (const location of data) {
    const placeId = location.google_place_id;
    const updates = {};

    for (const lang of languages) {
      try {
        const result = await fetchGoogleData(placeId, lang);
        if (!result) continue;

        const nameField = `name_${lang}`;
        const descriptionField = `description_${lang}`;

        if (result.name) {
          updates[nameField] = result.name;
        }

        if (result.editorial_summary?.overview) {
          updates[descriptionField] = result.editorial_summary.overview;
        }

      } catch (err) {
        console.warn(`⚠️ Fehler bei ${placeId} (${lang}): ${err.message}`);
      }
    }

    if (Object.keys(updates).length > 0) {
      await updateLocation(location.id, updates);
      console.log(`✅ Aktualisiert: ${placeId}`);
    } else {
      console.log(`➖ Keine Änderungen für: ${placeId}`);
    }
  }

  console.log('🎉 Fertig!');
}

main().catch((err) => console.error('❌ Hauptfehler:', err));
