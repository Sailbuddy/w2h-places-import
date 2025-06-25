// scripts/fill_location_values.js
import fs from 'fs';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('supabaseUrl or supabaseKey is missing in environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const filePath = process.argv[2];
if (!filePath) {
  console.error('❌ Kein Pfad zur JSON-Datei angegeben.');
  process.exit(1);
}

const rawData = fs.readFileSync(filePath);
const places = JSON.parse(rawData);

const ATTRIBUTE_KEY = 'preferred_name';

async function run() {
  for (const place of places) {
    const placeId = place.placeId;
    const preferredName = place.preferredName;

    if (!placeId || !preferredName) {
      console.warn('⚠️ Ungültiger Eintrag (fehlende ID oder Name):');
      console.warn(`placeId: '${placeId}',`);
      console.warn(`preferredName: '${preferredName}'`);
      continue;
    }

    // Hole location.id anhand der Google Place ID
    const { data: locationRow, error: locationError } = await supabase
      .from('locations')
      .select('id')
      .eq('google_place_id', placeId)
      .maybeSingle();

    if (!locationRow) {
      console.warn(`⚠️ Keine Location gefunden für Place ID: ${placeId}`);
      continue;
    }

    const locationId = locationRow.id;

    // Prüfe, ob Attribut bereits existiert
    let { data: attributeDef, error: attrErr } = await supabase
      .from('attribute_definitions')
      .select('id')
      .eq('key', ATTRIBUTE_KEY)
      .maybeSingle();

    let attributeId;
    if (!attributeDef) {
      // Lege Attribut neu an
      const { data: insertedAttr, error: insertErr } = await supabase
        .from('attribute_definitions')
        .insert([
          {
            key: ATTRIBUTE_KEY,
            name_de: 'Bevorzugter Name',
            name_en: 'Preferred Name',
            name_it: 'Nome preferito',
            name_hr: 'Preferirano ime',
            name_fr: 'Nom préféré',
            category_id: 1,         // Fallback-Kategorie "Unbestimmt"
            is_active: true
          }
        ])
        .select()
        .maybeSingle();

      if (insertErr || !insertedAttr) {
        console.error(`❌ Fehler beim Anlegen des Attributs:`, insertErr);
        continue;
      }

      attributeId = insertedAttr.id;
    } else {
      attributeId = attributeDef.id;
    }

    // Füge Wert in location_values ein
    const { error: valueErr } = await supabase.from('location_values').insert([
      {
        location_id: locationId,
        attribute_id: attributeId,
        value_text: preferredName,
        language_code: 'de',
        name: 'preferred_name'
      }
    ]);

    if (valueErr) {
      console.error(`❌ Fehler beim Einfügen der Attribute für ${placeId}:`, valueErr);
    } else {
      console.log(`✅ Attributwert erfolgreich eingetragen für ${placeId}`);
    }
  }

  console.log('🎉 Fertig!');
}

run();
