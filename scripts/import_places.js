// Dummy update to trigger commit
// scripts/import_places.js
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const PLACE_IDS_PATH = path.join('data', 'place_ids.json');

async function fetchPlaceDetails(placeId, language = 'en') {
  const url = `https://places.googleapis.com/v1/places/${placeId}?fields=id,displayName,location,formattedAddress,websiteUri,nationalPhoneNumber&languageCode=${language}&key=${GOOGLE_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google API request failed: ${res.statusText}`);
  return res.json();
}

async function importPlaces() {
  console.log('📦 Starte Importvorgang...');

  const raw = fs.readFileSync(PLACE_IDS_PATH, 'utf8');
  const placeIds = JSON.parse(raw);
  console.log('📄 Geladene Place-IDS:', placeIds);

  for (const placeId of placeIds) {
    try {
      console.log('🔍 Verarbeite:', placeId);

      const [details_en, details_de, details_it, details_hr, details_fr] = await Promise.all([
        fetchPlaceDetails(placeId, 'en'),
        fetchPlaceDetails(placeId, 'de'),
        fetchPlaceDetails(placeId, 'it'),
        fetchPlaceDetails(placeId, 'hr'),
        fetchPlaceDetails(placeId, 'fr')
      ]);

      const name = details_en.displayName?.text || 'Unknown';
      const translations = {
        en: details_en.displayName?.text,
        de: details_de.displayName?.text,
        it: details_it.displayName?.text,
        hr: details_hr.displayName?.text,
        fr: details_fr.displayName?.text
      };

      const payload = {
        google_place_id: placeId,
        category_id: 9,
        source_type: 'google_places',
        sync_enabled: true,
        name_en: translations.en,
        name_de: translations.de,
        name_it: translations.it,
        name_hr: translations.hr,
        name_fr: translations.fr,
        translations,
        address: details_en.formattedAddress || null,
        phone: details_en.nationalPhoneNumber || null,
        website: details_en.websiteUri || null,
        lat: details_en.location?.latitude || null,
        lng: details_en.location?.longitude || null,
      };

      const supabaseResponse = await fetch(`${SUPABASE_URL}/rest/v1/locations`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });

      const result = await supabaseResponse.json();
      if (!supabaseResponse.ok) {
        console.error('❌ Fehler beim Schreiben in Supabase:', supabaseResponse.status, result);
      } else {
        console.log('✅ Super Erfolgreich gespeichert:', result);
      }

    } catch (err) {
      console.error('⚠️ Fehler bei Verarbeitung:', err.message);
    }
  }
}

importPlaces();
