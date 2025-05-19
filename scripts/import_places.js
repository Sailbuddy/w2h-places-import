// scripts/import_places.js
import 'dotenv/config';
import fs from 'fs/promises';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

// Load env variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const LANGUAGE_CODES = ['de', 'en', 'it', 'hr', 'fr'];

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchPlaceDetails(placeId, language = 'en') {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&language=${language}&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.result;
}

async function upsertLocation(result, translations) {
  const { place_id, geometry, website, formatted_phone_number } = result;

  const { data, error } = await supabase
    .from('locations')
    .upsert({
      google_place_id: place_id,
      lat: geometry.location.lat,
      lng: geometry.location.lng,
      name_en: translations.en?.name || null,
      name_de: translations.de?.name || null,
      name_it: translations.it?.name || null,
      name_hr: translations.hr?.name || null,
      name_fr: translations.fr?.name || null,
      description_en: translations.en?.formatted_address || null,
      description_de: translations.de?.formatted_address || null,
      description_it: translations.it?.formatted_address || null,
      description_hr: translations.hr?.formatted_address || null,
      description_fr: translations.fr?.formatted_address || null,
      translations,
      sync_enabled: true,
      source_type: 'google',
      website: website || null,
      phone: formatted_phone_number || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'google_place_id' })
    .select();

  if (error) {
    console.error('❌ Error upserting location:', error);
  } else {
    console.log(`✅ Upserted location: ${result.name}`);
  }
}

async function run() {
  const raw = await fs.readFile('./data/place_ids.json', 'utf-8');
  const placeIds = JSON.parse(raw);

  for (const placeId of placeIds) {
    const translations = {};
    for (const lang of LANGUAGE_CODES) {
      try {
        const details = await fetchPlaceDetails(placeId, lang);
        translations[lang] = details;
      } catch (err) {
        console.warn(`⚠️ Could not fetch language ${lang} for ${placeId}:`, err);
      }
    }

    if (translations.en) {
      await upsertLocation(translations.en, translations);
    } else {
      console.warn(`⚠️ No data in English for ${placeId}, skipping.`);
    }
  }
}

run();