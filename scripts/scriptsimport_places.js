// scripts/import_places.js
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
dotenv.config();

const fs = await import('fs/promises');

const PLACE_IDS_PATH = './data/place_ids.json';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SUPABASE_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

const LANGUAGES = ['de', 'en', 'it', 'hr', 'fr'];

async function fetchPlaceData(placeId, language) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&language=${language}&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  return json.result;
}

function buildTranslations(rawByLang) {
  const result = {};
  for (const lang of LANGUAGES) {
    const data = rawByLang[lang];
    result[lang] = {
      name: data?.name || null,
      address: data?.formatted_address || null,
    };
  }
  return result;
}

async function upsertLocation(placeId, rawDe, translations) {
  const payload = {
    google_place_id: placeId,
    name_de: rawDe.name || null,
    description_de: rawDe.formatted_address || null,
    lat: rawDe.geometry?.location?.lat || null,
    lng: rawDe.geometry?.location?.lng || null,
    translations,
    source_type: 'google_places',
    sync_enabled: true,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/locations?select=id&google_place_id=eq.${placeId}`, {
    headers: SUPABASE_HEADERS
  });
  const existing = await res.json();

  const method = existing.length > 0 ? 'PATCH' : 'POST';
  const url = `${SUPABASE_URL}/rest/v1/locations${method === 'PATCH' ? `?id=eq.${existing[0].id}` : ''}`;

  const upsertRes = await fetch(url, {
    method,
    headers: SUPABASE_HEADERS,
    body: JSON.stringify(payload)
  });

  const responseBody = await upsertRes.text();
  console.log(`→ ${method} ${placeId}:`, responseBody);
}

(async () => {
  const file = await fs.readFile(PLACE_IDS_PATH, 'utf-8');
  const placeIds = JSON.parse(file);

  for (const placeId of placeIds) {
    console.log(`\n📍 Fetching: ${placeId}`);

    const rawByLang = {};
    for (const lang of LANGUAGES) {
      rawByLang[lang] = await fetchPlaceData(placeId, lang);
    }

    const translations = buildTranslations(rawByLang);
    await upsertLocation(placeId, rawByLang['de'], translations);
  }
})();
