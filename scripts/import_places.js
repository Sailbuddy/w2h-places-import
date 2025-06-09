const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// --- Setup Supabase Client ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Kategorie-Fallback ---
function getCategoryIdOrDefault(categoryId) {
  // Falls keine Kategorie bekannt ist → Standardwert 9 ("nicht zugeordnet")
  return categoryId || 9;
}

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
    .eq('google_place_id', placeId)
    .maybeSingle();

  if (error) {
    console.error(`❌ Fehler beim Prüfen von ${placeId}:`, error.message);
    return false;
  }

  return !!data;
}

async function insertLocation(placeId) {
  const dummyName = `Ort für ${placeId}`;

  const { error } = await supabase
    .from('locations')
    .insert([{
      google_place_id: placeId,
      display_name: dummyName,
      category_id: getCategoryIdOrDefault(null)
    }]);

  if (error) {
    console.error(`❌ Fehler beim Einfügen von ${placeId}:`, error.message);
  } else {
    console.log(`✅ Neu eingefügt: ${placeId}`);
  }
}

async function updateLocation(placeId) {
  const { error } = await supabase
    .from('locations')
    .update({
      display_name: `Aktualisiert für ${placeId}`,
      updated_at: new Date().toISOString(),
      category_id: getCategoryIdOrDefault(null)
    })
    .eq('google_place_id', placeId);

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
      if (exists) {
        await updateLocation(placeId);  // 🛠️ Überschreiben
      } else {
        await insertLocation(placeId);  // ➕ Neu einfügen
      }
    } else {
      if (!exists) {
        await insertLocation(placeId);  // ➕ Nur wenn nicht vorhanden
      } else {
        console.log(`⚠️ Bereits vorhanden, übersprungen: ${placeId}`);
      }
    }
  }

  console.log('✅ Importlauf abgeschlossen.');
})();
