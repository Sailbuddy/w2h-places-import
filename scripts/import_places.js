import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_API_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PLACE_IDS_PATH = './data/place_ids.json';

const HEADERS = {
  apikey: SUPABASE_API_KEY,
  Authorization: `Bearer ${SUPABASE_API_KEY}`,
  'Content-Type': 'application/json',
};

const fallbackNames = {
  de: 'Leider fehlt hier der Name',
  en: 'Unfortunately, the name is missing',
  fr: 'Malheureusement, le nom est absent',
  hr: 'Nažalost, ime nedostaje',
  it: 'Purtroppo manca il nome',
};

const insertLocation = async (data) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/locations`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(data),
  });
  return response;
};

const insertLocationValues = async (locationId, translations) => {
  const values = Object.entries(translations).map(([lang, name]) => ({
    location_id: locationId,
    language_code: lang,
    name,
  }));

  const response = await fetch(`${SUPABASE_URL}/rest/v1/location_values`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(values),
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
      const languages = ['de', 'en', 'fr', 'hr', 'it'];
      const translations = {};
      let mainResult = null;

      for (const lang of languages) {
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}&language=${lang}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.status !== 'OK') {
          console.warn(`⚠️ Fehler für Sprache ${lang}:`, data.status);
          translations[lang] = fallbackNames[lang];
          continue;
        }

        const name = data.result?.name?.trim();
        translations[lang] = name || fallbackNames[lang];

        if (lang === 'de') {
          mainResult = data.result;
        }
      }

      if (!mainResult) {
        console.error('❌ Kein gültiges Ergebnis für Hauptsprache erhalten.');
        continue;
      }

      const location = {
        google_place_id: placeId,
        display_name: mainResult.name || fallbackNames.de,
        address: mainResult.formatted_address || null,
        lat: mainResult.geometry?.location?.lat || null,
        lng: mainResult.geometry?.location?.lng || null,
        source_type: 'google_places',
        active: true,
        phone: mainResult.formatted_phone_number || null,
        website: mainResult.website || null,
        rating: mainResult.rating || null,
        price_level: mainResult.price_level || null,
        category_id: 9,
      };

      const insertRes = await insertLocation(location);
      const insertData = await insertRes.json();

      if (!insertRes.ok) {
        console.error('❌ Fehler beim Schreiben in Supabase:', insertRes.status, insertData);
        continue;
      }

      const locationId = insertData[0]?.id;
      if (!locationId) {
        console.error('❌ Kein ID erhalten nach Insert');
        continue;
      }

      const valueRes = await insertLocationValues(locationId, translations);
      if (!valueRes.ok) {
        const err = await valueRes.text();
        console.error('❌ Fehler beim Schreiben in location_values:', err);
      } else {
        console.log('✅ Erfolgreich gespeichert:', translations.de);
      }
    } catch (error) {
      console.error('💥 Unerwarteter Fehler:', error.message);
    }
  }

  // 👉 Leeren der Datei wurde entfernt (manuelle Kontrolle)
  // fs.writeFileSync(PLACE_IDS_PATH, JSON.stringify([]));
};

importPlaces();
