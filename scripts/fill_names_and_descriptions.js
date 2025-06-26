// scripts/fill_names_and_descriptions.js

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import fs from 'fs';

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

async function updateLocation(placeId, updates) {
  const { error } = await supabase
    .from('locations')
    .update(updates)
    .eq('google_place_id', placeId);

  if (error) {
    console.error(`❌ Fehler beim Aktualisieren von ${placeId}: ${error.message}`);
  }
}

async function main() {
  const jsonPath = process.argv[2] || 'data/place_ids_archive.json';

  let rawData;
  try {
    const fileContent = fs.readFileSync(jsonPath, 'utf-8');
    rawData = JSON.parse(fileContent);
  } catch (err) {
    console.error(`❌ Fehler beim Einlesen von ${jsonPath}: ${err.message}`);
    return;
  }

  const placeIds = rawData.map(entry => typeof entry === 'string' ? entry : entry.placeId);

  for (const placeId of placeIds) {
    const updates = {};

    for (const lang of languages) {
      const result = await fetchGoogleData(placeId, lang);
      if (!result) continue;

      if (result.name) updates[`name_${lang}`] = result.name;
      if (result.editorial_summary?.overview) updates[`description_${lang}`] = result.editorial_summary.overview;
    }

    if (Object.keys(updates).length > 0) {
      await updateLocation(placeId, updates);
      console.log(`✅ Aktualisiert: ${placeId}`);
    } else {
      console.log(`➖ Keine Änderungen für: ${placeId}`);
    }
  }

  console.log('🎉 Name + Beschreibung Import abgeschlossen.');
}

main().catch((err) => console.error('❌ Hauptfehler:', err));
