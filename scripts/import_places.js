// scripts/import_places.js
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_API_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PLACE_IDS_PATH = './data/place_ids.json';

const HEADERS = {
  'apikey': SUPABASE_API_KEY,
  'Authorization': `Bearer ${SUPABASE_API_KEY}`,
  'Content-Type': 'application/json'
};

const insertLocation = async (data) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/locations?returning=representation`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(data)
  });
  return response;
};

const insertLocationValues = async (locationId, translations) => {
  const values = Object.entries(translations).map(([lang, name]) => ({
    location_id: locationId,
    language_code: lang,
    name
  }));

  const response = await fetch(`${SUPABASE_URL}/rest/v1/location_values`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(values)
  });
  return response;
};

const importPlaces = async () => {
  console.log('🧭 Starte Importvorgang...');
  const placeIds = JSON.parse(fs.readFileSync(PLACE_IDS_PATH));
  console.log('📂 Geladene Place-IDS:', placeIds);

  for (const placeId of placeIds) {
    console.log('🔄 Verarbeite:', placeId);
    try {
      const googleRes = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}&language=de`);
      const googleData = await googleRes.json();

      if (googleData.status !== 'OK') {
        console.warn('⚠️ Fehler bei Verarbeitung:', googleData.status);
        continue;
      }

      const result = googleData.result;

      const location = {
        google_place_id: placeId,
        display_name: result.name,
        address: result.formatted_address || null,
        lat: result.geometry?.location?.lat || null,
        lng: result.geometry?.location?.lng || null,
        source_type: 'google_places',
        active: true,
        phone: result.formatted_phone_number || null,
        website: result.website || null,
        rating: result.rating || null,
        price_level: result.price_level || null,
        category_id: 9 // Platzhalter-Kategorie
      };

      const insertRes = await insertLocation(location);
      const insertData = await insertRes.json().catch(() => null);

      if (!insertRes.ok || !insertData || !Array.isArray(insertData) || !insertData[0]?.id) {
        console.error('❌ Fehler beim Schreiben in Supabase:', insertRes.status, insertData);
        continue;
      }

      const locationId = insertData[0].id;

      const translations = {
        de: result.name,
        en: result.name,
        fr: result.name,
        hr: result.name
      };

      const valueRes = await insertLocationValues(locationId, translations);
      if (!valueRes.ok) {
        const err = await valueRes.text();
        console.error('❌ Fehler beim Schreiben in location_values:', err);
      } else {
        console.log('✅ Erfolgreich gespeichert:', result.name);
      }

    } catch (error) {
      console.error('💥 Unerwarteter Fehler:', error.message);
    }
  }
};

importPlaces();
