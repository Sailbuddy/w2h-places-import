import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

if (!supabaseKey) throw new Error('supabaseKey is required.');

const readPlaceIds = (filePath) => {
  const fullPath = path.resolve(filePath);
  const raw = fs.readFileSync(fullPath);
  return JSON.parse(raw);
};

const fillAttributesForPlaces = async (places, attributes) => {
  for (const place of places) {
    const placeId = place.placeId; // <-- hier angepasst
    if (!placeId) {
      console.warn('⚠️ Keine gültige placeId im Datensatz:', place);
      continue;
    }

    const { data: location, error } = await supabase
      .from('locations')
      .select('id')
      .eq('google_place_id', placeId)
      .single();

    if (error || !location) {
      console.warn(`⚠️ Keine Location gefunden für Place ID: ${placeId}`);
      continue;
    }

    const insertValues = attributes.map((attr) => ({
      location_id: location.id,
      attribute_key: attr.key,
      value: attr.default_value || '',
      language_code: 'de', // optional erweiterbar
    }));

    const { error: insertError } = await supabase
      .from('location_values')
      .insert(insertValues);

    if (insertError) {
      console.error(`❌ Fehler beim Einfügen der Attribute für ${placeId}:`, insertError);
    } else {
      console.log(`✅ Attributwerte erfolgreich eingetragen für ${placeId}`);
    }
  }
};

const main = async () => {
  const placeData = readPlaceIds(process.argv[2]);

  const { data: attributes, error: attrError } = await supabase
    .from('attribute_definitions')
    .select('*')
    .eq('is_active', true);

  if (attrError || !attributes) {
    console.error('❌ Fehler beim Abrufen der Attribute:', attrError);
    return;
  }

  await fillAttributesForPlaces(placeData, attributes);
};

main();
