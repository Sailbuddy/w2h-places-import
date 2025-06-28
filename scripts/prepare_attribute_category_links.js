// scripts/prepare_attribute_category_links.js

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const inputPath = process.argv[2] || 'data/place_ids_archive.json';

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
    const { data: loc, error: locErr } = await supabase
      .from('locations')
      .select('category_id')
      .eq('google_place_id', placeId)
      .single();

    if (locErr || !loc?.category_id) {
      console.warn(`⚠️ Keine gültige Kategorie für ${placeId} gefunden – übersprungen.`);
      continue;
    }

    const category_id = loc.category_id;

    // Bestehende Kombinationen laden
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
      .map(a => ({
        attribute_id: a.attribute_id,
        category_id: category_id
      }))
      .filter(link => !existingSet.has(`${link.attribute_id}_${link.category_id}`));

    if (newLinks.length === 0) {
      console.log(`🟡 Keine neuen Links nötig für ${placeId} (Kategorie ${category_id})`);
      continue;
    }

    const { error: insertErr } = await supabase
      .from('attributes_meet_categories')
      .insert(newLinks);

    if (insertErr) {
      console.error(`❌ Fehler beim Speichern für ${placeId}: ${insertErr.message}`);
    } else {
      console.log(`🔗 ${newLinks.length} neue Links gespeichert für ${placeId} (Kategorie ${category_id})`);
    }
  }

  console.log('\n✅ Attribut-Zuordnung abgeschlossen!');
}

run();
