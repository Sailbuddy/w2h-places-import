import fs from 'fs';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ▶️ Argument: JSON-Dateiname
const inputFile = process.argv[2] || 'data/place_ids.json';

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Datei nicht gefunden: ${inputFile}`);
  process.exit(1);
}

const placeIds = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

async function ensureCategory(type) {
  const { data: existing } = await supabase
    .from('categories')
    .select('id')
    .eq('google_cat_id', type)
    .maybeSingle();

  if (existing) {
    console.log(`✅ Bereits vorhanden: ${type}`);
    return;
  }

  const newCat = {
    name_en: type,
    icon: type,
    active: true,
    sort_order: 9999,
    google_cat_id: type
  };

  const { data, error } = await supabase
    .from('categories')
    .insert(newCat)
    .select()
    .single();

  if (error) {
    console.error(`❌ Fehler beim Einfügen ${type}:`, error.message);
  } else {
    console.log(`➕ Neue Kategorie eingefügt: ${type}`);
  }
}

async function run() {
  console.log(`📂 Kategorienprüfung für Datei: ${inputFile}`);

  for (const entry of placeIds) {
    const placeId = typeof entry === 'string' ? entry : entry.place_id;

    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}`;
      const res = await axios.get(url);
      const types = res.data.result?.types || [];

      for (const type of types) {
        await ensureCategory(type);
      }
    } catch (err) {
      console.error(`❌ Fehler bei Place ${placeId}:`, err.message);
    }
  }

  console.log(`✅ Kategorie-Sync abgeschlossen für ${placeIds.length} Einträge.`);
}

run();
