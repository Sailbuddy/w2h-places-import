// scripts/fill_location_values.js

import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// ⚠️ ACHTUNG: Wir verwenden die gleichen Variablennamen wie in import_places.js
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL und SUPABASE_KEY sind erforderlich.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Funktion zum Laden der Attribute-Definitionen aus Supabase
async function getAttributeDefinitions() {
  const { data, error } = await supabase
    .from('attribute_definitions')
    .select('*')
    .eq('is_active', true);

  if (error) throw new Error('Fehler beim Abrufen der Attributdefinitionen: ' + error.message);
  return data;
}

// Funktion zum Laden der Location-Einträge aus der JSON-Datei
function readPlaceIds(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

// Funktion zur Verarbeitung und Eintragung
async function fillAttributesForPlaces(places, attributeDefs) {
  for (const place of places) {
    const placeId = place.google_place_id;
    const { data: location, error: locError } = await supabase
      .from('locations')
      .select('id, google_place_id')
      .eq('google_place_id', placeId)
      .maybeSingle();

    if (!location) {
      console.warn(`⚠️ Keine Location gefunden für Place ID: ${placeId}`);
      continue;
    }

    for (const def of attributeDefs) {
      const value = place[def.key];
      if (value === undefined || value === null) continue;

      const insert = {
        location_id: location.id,
        attribute_definition_id: def.id,
        value_text: String(value),
      };

      const { error: insertError } = await supabase
        .from('location_values')
        .upsert(insert, { onConflict: ['location_id', 'attribute_definition_id'] });

      if (insertError) {
        console.error(`❌ Fehler beim Schreiben von ${def.key} für ${placeId}: ${insertError.message}`);
      } else {
        console.log(`✅ Eingetragen: ${def.key} = ${value} für ${placeId}`);
      }
    }
  }
}

// 🏁 Hauptlauf
const main = async () => {
  try {
    const inputFile = process.argv[2];
    if (!inputFile) throw new Error('Bitte Pfad zur JSON-Datei angeben.');

    const placeData = readPlaceIds(inputFile);
    const attributes = await getAttributeDefinitions();
    await fillAttributesForPlaces(placeData, attributes);
    console.log('✅ Attributwerte erfolgreich eingetragen.');
  } catch (err) {
    console.error('❌ Fehler im Ablauf:', err.message);
    process.exit(1);
  }
};

main();
