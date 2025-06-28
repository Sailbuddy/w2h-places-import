// scripts/prepare_attribute_category_links.js

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const inputPath = process.argv[2] || 'data/place_ids_archive.json';

async function fetchGoogleType(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=types&key=${process.env.GOOGLE_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== 'OK') {
    console.warn(`⚠️ Google API Fehler für ${placeId}: ${data.status}`);
    return null;
  }

  const types = data.result.types;
  return Array.isArray(types) && types.length > 0 ? types[0].toLowerCase() : null;
}

async function findCategoryIdByGoogleType(googleType) {
  const { data, error } = await supabase
    .from('categories')
    .select('id, google_cat_id')
    .ilike('google_cat_id', googleType);

  if (error) {
    console.error(`❌ Fehler bei categories-Suche: ${error.message}`);
    return null;
  }

  return data?.[0]?.id || null;
}

async function run() {
  console.log(`📥 Starte Kategorie-Mapping aus Datei: ${inputPath}`);
  let placeIds = [];

  try {
    const raw = fs.readFileSync(inputPath, 'utf-8');
    const parsed = JSON.parse(raw);
    placeIds = parsed.map(entry => typeof entry === 'string' ? entry : entry.placeId);
  } catch (err) {
    console.error(`❌ Fehler beim Lesen der JSON-Datei: ${err.message}`);
    return;
  }

  const output = [];

  for (const placeId of placeIds) {
    const googleType = await fetchGoogleType(placeId);
    if (!googleType) {
      console.warn(`⚠️ Kein gültiger Google-Typ für ${placeId} – übersprungen.`);
      continue;
    }

    const category_id = await findCategoryIdByGoogleType(googleType);
    if (!category_id) {
      console.warn(`⚠️ Kein Match in categories für Typ "${googleType}" – ${placeId} übersprungen.`);
      continue;
    }

    output.push({ place_id: placeId, category_id });
    console.log(`✅ ${placeId} → ${googleType} → Kategorie ${category_id}`);
  }

  try {
    fs.writeFileSync('data/place_categories.json', JSON.stringify(output, null, 2));
    console.log('\n📝 Mapping gespeichert unter: data/place_categories.json');
  } catch (writeErr) {
    console.error(`❌ Fehler beim Speichern der Mapping-Datei: ${writeErr.message}`);
  }

  console.log('\n✅ Vorbereitung abgeschlossen!');
}

run();
