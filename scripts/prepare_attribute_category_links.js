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
    .ilike('google_cat_id', googleType); // case-insensitive Vergleich

  if (error) {
    console.error(`❌ Fehler bei categories-Suche: ${error.message}`);
    return null;
  }

  return data?.[0]?.id || null;
}

async function run() {
  console.log(`📥 Starte Attribut-Zuordnung für Datei: ${inputPath}`);
  let placeIds = [];

  try {
    const raw = fs.readFileSync(inputPath, 'utf-8');
    const parsed = JSON.parse(raw);
    placeIds = parsed.map(entry => typeof entry === 'string' ? entry : entry.placeId);
  } catch (err) {
    console.error(`❌ Fehler beim Lesen der JSON-Datei: ${err.message}`);
    return;
  }

  const { data: attributes, error: attrErr } = await supabase
    .from('attribute_definitions')
    .select('attribute_id');

  if (attrErr || !attributes) {
    console.error(`❌ Fehler beim Laden der Attributliste: ${attrErr?.message}`);
    return;
  }

  for (const placeId of placeIds) {
    const googleType = await fetchGoogleType(placeId);
    if (!googleType) {
      console.warn(`⚠️ Kein gültiger Google-Typ für ${placeId} – übersprungen.`);
      continue;
    }

    const category_id = await findCategoryIdByGoogleType(googleType);
    if (!category_id) {
      console.warn(`⚠️ Kein Match in categories für Google-Typ "${googleType}" – ${placeId} übersprungen.`);
      continue;
    }

    const { data: existingLinks, error: linkErr } = await supabase
      .from('attributes_meet_categories')
      .select('attribute_id, category_id')
      .eq('category_id', category_id);

    if (linkErr) {
      console.error(`❌ Fehler beim Lesen vorhandener Links: ${linkErr.message}`);
      continue;
    }

    const existingSet = new Set(existingLinks.map(l => `${l.attribute_id}_${l.category_id}`));

    const newLinks = attributes
      .map(a => ({ attribute_id: a.attribute_id, category_id }))
      .filter(link => !existingSet.has(`${link.attribute_id}_${link.category_id}`));

    if (newLinks.length === 0) {
      console.log(`🟡 Keine neuen Zuordnungen nötig für ${placeId} (${googleType} → Kategorie ${category_id})`);
      continue;
    }

    const { error: insertErr } = await supabase
      .from('attributes_meet_categories')
      .insert(newLinks);

    if (insertErr) {
      console.error(`❌ Fehler beim Schreiben für ${placeId}: ${insertErr.message}`);
    } else {
      console.log(`🔗 ${newLinks.length} neue Links gespeichert für ${placeId} (${googleType} → Kategorie ${category_id})`);
    }
  }

  console.log('\n✅ Attribut-Zuordnung abgeschlossen!');
}

run();
