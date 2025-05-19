// scripts/import_places.js
import fetch from 'node-fetch';
import fs from 'fs';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PLACE_IDS_FILE = './data/place_ids.json';

console.log("🌍 Starte Importvorgang...");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_API_KEY) {
  console.error("❌ Fehlende Umgebungsvariablen. Bitte .env prüfen.");
  process.exit(1);
}

let placeIds = [];
try {
  const fileContent = fs.readFileSync(PLACE_IDS_FILE, 'utf-8');
  placeIds = JSON.parse(fileContent);
  console.log("📥 Geladene Place-IDs:", placeIds);
} catch (error) {
  console.error("❌ Fehler beim Einlesen der place_ids.json:", error.message);
  process.exit(1);
}

for (const placeId of placeIds) {
  console.log(`🔍 Verarbeite: ${placeId}`);

  const googleRes = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&language=en&key=${GOOGLE_API_KEY}`);
  const placeDetails = await googleRes.json();
  const result = placeDetails.result;

  if (!result) {
    console.warn(`⚠️ Keine Daten für ${placeId}`);
    continue;
  }

  console.log("📡 Google Place Details:", result.name, "-", result.place_id);

  const response = await fetch(`${SUPABASE_URL}/rest/v1/locations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({
      google_place_id: result.place_id,
      name_en: result.name,
      name_de: result.name,
      name_it: result.name,
      name_fr: result.name,
      name_hr: result.name,
      translations: {
        en: result.name,
        de: result.name,
        it: result.name,
        fr: result.name,
        hr: result.name,
      },
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      address: result.formatted_address || null,
      source_type: 'google_places',
      sync_enabled: true,
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("❌ Fehler beim Schreiben in Supabase:", response.status, errText);
  } else {
    const supaResult = await response.json();
    console.log("✅ Supabase gespeichert:", supaResult);
  }
}
