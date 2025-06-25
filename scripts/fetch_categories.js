import fs from 'fs';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ▶️ Eingabedatei (default: place_ids.json)
const inputFile = process.argv[2] || 'data/place_ids.json';
if (!fs.existsSync(inputFile)) {
  console.error(`❌ Datei nicht gefunden: ${inputFile}`);
  process.exit(1);
}

const placeIds = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// 🔤 Zielsprachen
const languages = ['en', 'de', 'it', 'fr', 'hr'];

async function fetchTranslatedNames(placeId) {
  const names = {};
  for (const lang of languages) {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&language=${lang}&key=${GOOGLE_API_KEY}`;
    try {
      const res = await axios.get(url);
      names[`name_${lang}`] = res.data.result?.name || null;
    } catch (err) {
      console.warn(`⚠️ Fehler bei Sprachabruf (${lang}) für ${placeId}: ${err.message}`);
      names[`name_${lang}`] = null;
    }
  }
  return names;
}

async function ensureCategory(type, originPlaceId) {
  const { data: existing } = await supabase
    .from('categories')
    .select('id')
    .eq('google_cat_id', type)
    .maybeSingle();

  if (existing) {
    console.log(`✅ Kategorie bereits vorhanden: ${type}`);
    return false;
  }

  console.log(`🌐 Neuer Typ entdeckt: ${type} – Sprachdaten werden geladen ...`);
  const translations = await fetchTranslatedNames(originPlaceId);

  const newCat = {
    google_cat_id: type,
    icon: type,
    active: true,
    sort_order: 9999,
    ...translations
  };

  const { data, error } = await supabase
    .from('categories')
    .insert(newCat)
    .select()
    .single();

  if (error) {
    console.error(`❌ Fehler beim Einfügen der Kategorie ${type}: ${error.message}`);
    return false;
  } else {
    console.log(`➕ Neue Kategorie angelegt: ${type} (${translations.name_en || 'keine Übersetzung'})`);
    return true;
  }
}

async function run() {
  console.log(`📂 Kategorienprüfung für Datei: ${inputFile}`);

  for (const entry of placeIds) {
    const placeId =
      typeof entry === 'string'
        ? entry
        : entry.place_id || entry.placeId || entry.id || entry.place || undefined;

    if (!placeId) {
      console.warn(`⚠️ Ungültiger Eintrag in place_ids.json: ${JSON.stringify(entry)}`);
      continue;
    }

    console.log(`📌 Verarbeite Place ID: ${placeId}`);

    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&language=en&key=${GOOGLE_API_KEY}`;
      const res = await axios.get(url);
      const result = res.data.result;

      if (!result) {
        console.warn(`⚠️ Kein result für Place ID: ${placeId}`);
        continue;
      }

      const types = result.types || [];
      if (types.length === 0) {
        console.log(`🔍 types ist leer ([])`);
        continue;
      } else {
        console.log(`🔍 types: ${types.join(', ')}`);
      }

      for (const type of types) {
        await ensureCategory(type, placeId);
      }
    } catch (err) {
      console.error(`❌ Fehler bei Place ${placeId}:`, err.message);
    }
  }

  console.log(`✅ Kategorie-Sync abgeschlossen für ${placeIds.length} Einträge.`);
}

run();
