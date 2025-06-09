const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// --- Setup Supabase Client ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Modus erkennen ---
const mode = process.argv[2]; // z. B. "archive"
const isAutoRun = mode === 'archive';

console.log(`🟡 Starte Import im Modus: ${isAutoRun ? 'ARCHIV (auto-update)' : 'MANUELL (nur neu)'}`);

// --- Datei wählen ---
const filePath = isAutoRun
  ? path.join(__dirname, '../data/place_ids_archive.json')
  : path.join(__dirname, '../data/place_ids.json');

// --- Daten einlesen ---
let placeIds;
try {
  placeIds = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (error) {
  console.error(`❌ Fehler beim Lesen der Datei ${filePath}:`, error.message);
  process.exit(1);
}

// --- Importlogik ---
async function checkIfLocationExists(placeId) {
  const { data, error } = await supabase
    .from('locations')
    .select('id')
    .eq('place_id', placeId)
    .maybeSingle();

  if (error) {
    console.error(`❌ Fehler beim Prüfen von ${placeId}:`, error.message);
    return false;
  }

  return !!data;
}

async function insertLocation(placeId) {
  // Beispiel-Insert – muss durch echten Google Places Fetch ersetzt werden
  const dummyName = `Ort für ${placeId}`;

  const { data, error } = await supabase
    .from('locations')
    .insert([{ place_id: placeId, display_name: dummyName }]);

  if (error) {
    console.error(`❌ Fehler beim Einfügen von ${placeId}:`, error.message);
  } else {
    console.log(`✅ Neu eingefügt: ${placeId}`);
  }
}

async function updateLocation(placeId) {
  // Beispiel-Update – hier könnten später Öffnungszeiten etc. aktualisiert werden
  const { error } = await supabase
    .from('locations')
    .update({ updated_at: new Date().toISOString() })
    .eq('place_id', placeId);

  if (error) {
    console.error(`❌ Fehler beim Aktualisieren von ${placeId}:`, error.message);
  } else {
    console.log(`🔁 Aktualisiert: ${placeId}`);
  }
}

// --- Hauptlauf ---
(async () => {
  for (const placeId of placeIds) {
    const exists = await checkIfLocationExists(placeId);

    if (isAutoRun) {
      // Nachtlauf: Update oder Insert
      if (exists) {
        await updateLocation(placeId);
      } else {
        await insertLocation(placeId);
      }
    } else {
      // Manuell: Nur neue Einträge
      if (!exists) {
        await insertLocation(placeId);
      } else {
        console.log(`⚠️ Bereits vorhanden, übersprungen: ${placeId}`);
      }
    }
  }

  console.log('✅ Importlauf abgeschlossen.');
})();
